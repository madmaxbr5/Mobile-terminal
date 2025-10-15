import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { spawn } from 'node-pty';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const PROJECTS_DIR = path.join(os.homedir(), 'Desktop', 'claude_projects');
const LAST_PROJECT_FILE = path.join(__dirname, '.last_project.json');

const server = app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

const wss = new WebSocketServer({ server });

const terminals = new Map();
const taskQueues = new Map();
const currentProjects = new Map();
const claudeStartedProjects = new Set(); // Track which projects have had Claude started

// Ensure projects directory exists and has at least one project
function initializeProjectsDirectory() {
  // Create projects directory if it doesn't exist
  if (!fs.existsSync(PROJECTS_DIR)) {
    console.log('Creating projects directory...');
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  }

  // Check if any projects exist
  try {
    const projects = fs.readdirSync(PROJECTS_DIR)
      .filter(file => fs.statSync(path.join(PROJECTS_DIR, file)).isDirectory());
    
    // If no projects exist, create a default one
    if (projects.length === 0) {
      const defaultProjectName = 'default-project';
      const defaultProjectPath = path.join(PROJECTS_DIR, defaultProjectName);
      
      console.log(`No projects found. Creating default project: ${defaultProjectName}`);
      fs.mkdirSync(defaultProjectPath);
      
      // Initialize as git repo
      try {
        execAsync('git init', { cwd: defaultProjectPath });
        console.log(`Initialized git repository in ${defaultProjectName}`);
      } catch (error) {
        console.log('Git not available, skipping git init');
      }
      
      // Create a simple README
      const readmeContent = `# ${defaultProjectName}\n\nThis is your default project directory.\n\nYou can:\n- Create new files and folders here\n- Run commands in this directory\n- Use Claude Code to help with development\n\nTo create additional projects, use the Files tab in the mobile terminal.`;
      fs.writeFileSync(path.join(defaultProjectPath, 'README.md'), readmeContent);
      
      console.log(`Created default project with README at ${defaultProjectPath}`);
    }
  } catch (error) {
    console.error('Error checking projects directory:', error);
  }
}

initializeProjectsDirectory();

// Function to check if a project has a valid Claude Code session
function hasValidClaudeSession(projectPath) {
  console.log(`Checking for Claude session in: ${projectPath}`);
  
  // Check for .claude directory which is what Claude Code actually creates
  const claudeDir = path.join(projectPath, '.claude');
  if (fs.existsSync(claudeDir)) {
    try {
      const stats = fs.statSync(claudeDir);
      if (stats.isDirectory()) {
        // Check if there are any files in the .claude directory
        const claudeFiles = fs.readdirSync(claudeDir);
        console.log(`Found .claude directory with files: ${claudeFiles.join(', ')}`);
        if (claudeFiles.length > 0) {
          console.log('Valid Claude session found - .claude directory exists with files');
          return true;
        }
      }
    } catch (error) {
      console.log(`Error checking .claude directory:`, error.message);
    }
  }
  
  // Also check for legacy session files (older Claude versions)
  const legacySessionFiles = [
    '.claude_history',
    '.claude_chat_history', 
    '.claude_session',
    '.claude_conversation',
    '.claude.json',
    '.claude_context.json'
  ];
  
  for (const sessionFile of legacySessionFiles) {
    const sessionPath = path.join(projectPath, sessionFile);
    if (fs.existsSync(sessionPath)) {
      try {
        const stats = fs.statSync(sessionPath);
        console.log(`Found legacy session file: ${sessionFile}, size: ${stats.size} bytes`);
        if (stats.size > 0) {
          console.log('Valid Claude session found - legacy session file');
          return true;
        }
      } catch (error) {
        console.log(`Error checking ${sessionFile}:`, error.message);
      }
    }
  }
  
  console.log('No valid Claude session found');
  return false;
}

// Functions to manage last project tracking
function getLastProject() {
  try {
    if (fs.existsSync(LAST_PROJECT_FILE)) {
      const data = fs.readFileSync(LAST_PROJECT_FILE, 'utf8');
      const lastProject = JSON.parse(data);
      // Verify the project still exists
      if (fs.existsSync(lastProject.path)) {
        return lastProject;
      }
    }
  } catch (error) {
    console.error('Error reading last project:', error);
  }
  return null;
}

function setLastProject(project) {
  try {
    const data = {
      name: project.name,
      path: project.path,
      lastAccessed: new Date().toISOString()
    };
    fs.writeFileSync(LAST_PROJECT_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving last project:', error);
  }
}

function getInitialDirectory() {
  const lastProject = getLastProject();
  if (lastProject) {
    return lastProject.path;
  }
  
  // If no last project, get the most recent project from the projects directory
  try {
    const projects = fs.readdirSync(PROJECTS_DIR)
      .filter(file => fs.statSync(path.join(PROJECTS_DIR, file)).isDirectory())
      .map(name => {
        const projectPath = path.join(PROJECTS_DIR, name);
        const stats = fs.statSync(projectPath);
        return {
          name,
          path: projectPath,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.modified - a.modified);
    
    if (projects.length > 0) {
      const mostRecentProject = projects[0];
      console.log(`No last project found, using most recent: ${mostRecentProject.name}`);
      // Save it as the last project for next time
      setLastProject(mostRecentProject);
      return mostRecentProject.path;
    }
  } catch (error) {
    console.error('Error finding recent project:', error);
  }
  
  // Only fall back to home if no projects exist at all
  console.log('No projects found, falling back to home directory');
  return process.env.HOME;
}

// API endpoints for project management
app.get('/api/projects', (req, res) => {
  try {
    const projects = fs.readdirSync(PROJECTS_DIR)
      .filter(file => fs.statSync(path.join(PROJECTS_DIR, file)).isDirectory())
      .map(name => {
        const projectPath = path.join(PROJECTS_DIR, name);
        const stats = fs.statSync(projectPath);
        return {
          name,
          path: projectPath,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.modified - a.modified);
    
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: 'Invalid project name' });
    }
    
    const projectPath = path.join(PROJECTS_DIR, name);
    if (fs.existsSync(projectPath)) {
      return res.status(400).json({ error: 'Project already exists' });
    }
    
    fs.mkdirSync(projectPath);
    await execAsync('git init', { cwd: projectPath });
    
    res.json({ name, path: projectPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects/:name/claude-session', (req, res) => {
  try {
    const { name } = req.params;
    const projectPath = path.join(PROJECTS_DIR, name);
    
    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Use the same session detection logic as the main function
    const hasValidSession = hasValidClaudeSession(projectPath);
    let sessionInfo = null;
    
    if (hasValidSession) {
      // Check for .claude directory first
      const claudeDir = path.join(projectPath, '.claude');
      if (fs.existsSync(claudeDir)) {
        try {
          const stats = fs.statSync(claudeDir);
          const claudeFiles = fs.readdirSync(claudeDir);
          sessionInfo = {
            type: 'directory',
            directory: '.claude',
            files: claudeFiles,
            modified: stats.mtime
          };
        } catch (error) {
          // Continue to check legacy files
        }
      }
      
      // If no .claude directory, check legacy files
      if (!sessionInfo) {
        const sessionFiles = [
          '.claude_history',
          '.claude_chat_history', 
          '.claude_session',
          '.claude_conversation'
        ];
        
        for (const sessionFile of sessionFiles) {
          const sessionPath = path.join(projectPath, sessionFile);
          if (fs.existsSync(sessionPath)) {
            try {
              const stats = fs.statSync(sessionPath);
              if (stats.size > 0) {
                sessionInfo = {
                  type: 'file',
                  file: sessionFile,
                  size: stats.size,
                  modified: stats.mtime
                };
                break;
              }
            } catch (error) {
              // Continue checking other files
            }
          }
        }
      }
    }
    
    res.json({ 
      hasSession: hasValidSession, 
      sessionInfo: sessionInfo 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  
  const terminalId = Date.now().toString();
  let currentProject = null;
  
  // Get the initial directory (last project or home)
  const initialDir = getInitialDirectory();
  console.log(`Starting terminal in directory: ${initialDir}`);
  
  // Use tmux for better session persistence
  const ptyProcess = spawn(process.env.SHELL || 'zsh', [], {
    name: 'xterm-color',
    cols: 80,
    rows: 30,
    cwd: initialDir,
    env: { 
      ...process.env, 
      TERM: 'xterm-256color',
      // Prevent processes from being killed by SIGHUP
      TMUX: undefined // Don't inherit parent tmux session
    }
  });

  // Prevent the terminal from being killed by client disconnect
  ptyProcess.on('exit', (code, signal) => {
    console.log(`Terminal process exited with code ${code}, signal ${signal}`);
  });

  terminals.set(terminalId, ptyProcess);
  taskQueues.set(terminalId, []);

  // Check if we started in a project directory and set it as current
  const lastProject = getLastProject();
  if (lastProject && initialDir === lastProject.path) {
    currentProject = lastProject;
    currentProjects.set(terminalId, currentProject);
  } else if (initialDir.startsWith(PROJECTS_DIR)) {
    // We're in a project directory but it's not the saved last project
    // Create a project object from the directory
    const projectName = path.basename(initialDir);
    currentProject = {
      name: projectName,
      path: initialDir
    };
    currentProjects.set(terminalId, currentProject);
    console.log(`Started in project directory: ${projectName}`);
  }

  ws.send(JSON.stringify({ 
    type: 'connected', 
    terminalId,
    initialProject: currentProject 
  }));

  // Client-side will handle auto-start/resume logic
  if (currentProject) {
    console.log(`Connected to project: ${currentProject.name}`);
  }

  ptyProcess.onData((data) => {
    console.log('Terminal output:', data.slice(0, 100)); // Log first 100 chars
    
    // Detect when Claude Code exits and clear the started tracking
    if (currentProject && data.includes('Goodbye!') || data.includes('Session ended')) {
      claudeStartedProjects.delete(currentProject.path);
      console.log(`Claude session ended for ${currentProject.name}, ready for auto-start on next connection`);
    }
    
    ws.send(JSON.stringify({ type: 'terminal', data }));
  });

  ws.on('message', async (message) => {
    const msg = JSON.parse(message);
    
    switch (msg.type) {
      case 'ping':
        // Respond to ping to keep connection alive
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
        
      case 'terminal':
        console.log('Received terminal command:', msg.data.trim());
        ptyProcess.write(msg.data);
        break;
        
      case 'resize':
        ptyProcess.resize(msg.cols, msg.rows);
        break;
        
      case 'fileStructure':
        const structure = await getFileStructure(msg.path || process.env.HOME);
        ws.send(JSON.stringify({ type: 'fileStructure', data: structure }));
        break;
        
      case 'setProject':
        currentProject = msg.project;
        currentProjects.set(terminalId, currentProject);
        // Save as most recently accessed project
        setLastProject(currentProject);
        // Change terminal directory to project
        ptyProcess.write(`cd "${currentProject.path}"\n`);
        ptyProcess.write('clear\n');
        ws.send(JSON.stringify({ type: 'projectSet', project: currentProject }));
        break;
        
      case 'claudeCommand':
        if (currentProject) {
          const command = msg.resume ? 
            `claude --continue` :
            `claude`;
          ptyProcess.write(command + '\n');
          // Switch to terminal tab after starting Claude Code
          ws.send(JSON.stringify({ type: 'switchToTerminal' }));
        }
        break;
        
      case 'expertSession':
        // Handle expert session initialization
        try {
          const { task, sessionId } = msg;
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const sessionName = `expert-${sessionId || timestamp}`;
          const sessionPath = path.join(PROJECTS_DIR, sessionName);
          
          // Create session directory
          if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
          }
          
          // Store task info
          fs.writeFileSync(
            path.join(sessionPath, 'task.json'),
            JSON.stringify({ task, created: new Date().toISOString() }, null, 2)
          );
          
          // Set as current project
          currentProject = {
            name: sessionName,
            path: sessionPath
          };
          currentProjects.set(terminalId, currentProject);
          
          // Change to session directory
          ptyProcess.write(`cd "${sessionPath}"\n`);
          ptyProcess.write('clear\n');
          
          // Send response with session info
          ws.send(JSON.stringify({ 
            type: 'expertSessionCreated', 
            session: {
              name: sessionName,
              path: sessionPath,
              task
            }
          }));
          
          // Generate expert persona with Claude
          setTimeout(() => {
            // First create a task file for Claude to read
            const taskDescription = `Create a CLAUDE.md file that defines an expert persona best suited for this task: ${task}. The persona should include: expertise areas, communication style, analysis approach, and specific methodologies relevant to the task. Make the persona highly specialized and knowledgeable.`;
            fs.writeFileSync(
              path.join(sessionPath, 'persona-task.txt'),
              taskDescription
            );
            
            // Launch Claude Code
            ptyProcess.write('claude code\n');
            
            // After Claude starts, provide the task
            setTimeout(() => {
              ptyProcess.write(`cat persona-task.txt\n`);
            }, 3000);
          }, 1000);
        } catch (error) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: `Failed to create expert session: ${error.message}` 
          }));
        }
        break;
        
      case 'readFile':
        try {
          const content = fs.readFileSync(msg.path, 'utf8');
          const stats = fs.statSync(msg.path);
          ws.send(JSON.stringify({ 
            type: 'fileContent', 
            path: msg.path, 
            content,
            lastModified: stats.mtime.getTime()
          }));
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
        break;
        
      case 'checkFileModified':
        try {
          const content = fs.readFileSync(msg.path, 'utf8');
          const stats = fs.statSync(msg.path);
          const currentModified = stats.mtime.getTime();
          const lastKnownModified = msg.lastKnownModified || 0;
          const lastKnownContent = msg.lastKnownContent;
          
          // Check both timestamp and content changes for better detection
          const timestampChanged = currentModified > lastKnownModified;
          const contentChanged = content !== lastKnownContent;
          
          if (timestampChanged || contentChanged) {
            console.log(`[Server] File changed - timestamp: ${timestampChanged}, content: ${contentChanged}, path: ${msg.path}`);
            ws.send(JSON.stringify({ 
              type: 'fileContent', 
              path: msg.path, 
              content,
              lastModified: currentModified
            }));
          } else {
            console.log(`[Server] No changes detected for ${msg.path}`);
          }
        } catch (error) {
          console.log(`[Server] File check failed for ${msg.path}:`, error.message);
        }
        break;
        
      case 'claudeTask':
        const queue = taskQueues.get(terminalId);
        queue.push(msg.task);
        taskQueues.set(terminalId, queue);
        ws.send(JSON.stringify({ type: 'taskQueued', queue }));
        break;
        
      case 'executeTask':
        const tasks = taskQueues.get(terminalId);
        if (tasks && tasks.length > 0) {
          const task = tasks.shift();
          taskQueues.set(terminalId, tasks);
          
          try {
            const result = await execAsync(task.command, { cwd: task.cwd || process.env.HOME });
            ws.send(JSON.stringify({ 
              type: 'taskComplete', 
              task, 
              result: result.stdout,
              error: result.stderr,
              queue: tasks 
            }));
          } catch (error) {
            ws.send(JSON.stringify({ 
              type: 'taskError', 
              task, 
              error: error.message,
              queue: tasks 
            }));
          }
        }
        break;
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    if (terminals.has(terminalId)) {
      const terminal = terminals.get(terminalId);
      // Clear the started tracking when terminal closes so it can auto-start again
      if (currentProject) {
        claudeStartedProjects.delete(currentProject.path);
        console.log(`Cleared auto-start tracking for ${currentProject.name}`);
      }
      // Kill gracefully first, then force kill if needed
      terminal.kill('SIGTERM');
      setTimeout(() => {
        if (terminals.has(terminalId)) {
          terminal.kill('SIGKILL');
        }
      }, 2000);
      terminals.delete(terminalId);
      taskQueues.delete(terminalId);
      currentProjects.delete(terminalId);
    }
  });
});

async function getFileStructure(dirPath) {
  const items = [];
  
  try {
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
      if (file.startsWith('.')) continue;
      
      const fullPath = path.join(dirPath, file);
      const stats = fs.statSync(fullPath);
      
      items.push({
        name: file,
        path: fullPath,
        isDirectory: stats.isDirectory(),
        size: stats.size,
        modified: stats.mtime
      });
    }
  } catch (error) {
    console.error('Error reading directory:', error);
  }
  
  return items.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}