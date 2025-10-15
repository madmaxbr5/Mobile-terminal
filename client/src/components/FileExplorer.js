import React, { useState, useEffect } from 'react';

function FileExplorer({ ws, onFileSelect }) {
  const [projects, setProjects] = useState([]);
  const [currentProject, setCurrentProject] = useState(null);
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDirectories, setShowDirectories] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [sessionInfo, setSessionInfo] = useState(null);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (ws) {
      ws.addEventListener('message', handleMessage);
      
      return () => {
        ws.removeEventListener('message', handleMessage);
      };
    }
  }, [ws]);

  const handleMessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'fileStructure') {
      setFiles(message.data);
      setLoading(false);
    } else if (message.type === 'projectSet') {
      loadDirectory(message.project.path);
    }
  };

  const loadProjects = async () => {
    try {
      const apiUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3001/api/projects'
        : `http://${window.location.hostname}:3001/api/projects`;
      const response = await fetch(apiUrl);
      const data = await response.json();
      setProjects(data);
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  };

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    
    try {
      const apiUrl = window.location.hostname === 'localhost'
        ? 'http://localhost:3001/api/projects'
        : `http://${window.location.hostname}:3001/api/projects`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName })
      });
      
      if (response.ok) {
        const project = await response.json();
        setShowNewProjectDialog(false);
        setNewProjectName('');
        await loadProjects();
        selectProject(project, true); // Pass true for new project
      } else {
        const error = await response.json();
        alert(error.error);
      }
    } catch (error) {
      console.error('Error creating project:', error);
    }
  };

  const selectProject = (project, isNew = false) => {
    setCurrentProject(project);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'setProject',
        project: project
      }));
      
      // Load the project directory
      loadDirectory(project.path);
      // Check for Claude Code session
      checkClaudeSession(project.name);
    }
  };

  const checkClaudeSession = async (projectName) => {
    try {
      const apiUrl = window.location.hostname === 'localhost'
        ? `http://localhost:3001/api/projects/${projectName}/claude-session`
        : `http://${window.location.hostname}:3001/api/projects/${projectName}/claude-session`;
      const response = await fetch(apiUrl);
      const data = await response.json();
      console.log('Claude session check result:', data);
      setSessionInfo(data);
    } catch (error) {
      console.error('Error checking Claude session:', error);
      setSessionInfo(null);
    }
  };

  const loadDirectory = (path) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      setLoading(true);
      setCurrentPath(path);
      ws.send(JSON.stringify({
        type: 'fileStructure',
        path: path
      }));
    }
  };

  const handleItemClick = (item) => {
    if (item.isDirectory) {
      loadDirectory(item.path);
    } else {
      onFileSelect(item);
    }
  };

  const goBack = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/');
    if (parentPath) {
      loadDirectory(parentPath);
    }
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (date) => {
    const d = new Date(date);
    const now = new Date();
    const diff = now - d;
    
    if (diff < 86400000) { // Less than 24 hours
      return 'Today';
    } else if (diff < 172800000) { // Less than 48 hours
      return 'Yesterday';
    } else {
      return d.toLocaleDateString();
    }
  };

  if (!currentProject) {
    return (
      <div className="h-full flex flex-col bg-gray-900">
        <div className="p-4">
          <button
            onClick={() => setShowNewProjectDialog(true)}
            className="w-full mb-4 p-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center"
          >
            <span className="text-2xl mr-2">+</span>
            <span>Create New Project</span>
          </button>

          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.name}
                onClick={() => selectProject(project)}
                className="w-full p-4 bg-gray-800 hover:bg-gray-700 rounded-lg text-left"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{project.name}</div>
                    <div className="text-sm text-gray-400">
                      Modified: {formatDate(project.modified)}
                    </div>
                  </div>
                  <span className="text-2xl">📁</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {showNewProjectDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-sm">
              <h3 className="text-lg font-medium mb-4">Create New Project</h3>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg mb-4"
                autoFocus
                onKeyPress={(e) => e.key === 'Enter' && createProject()}
              />
              <div className="flex space-x-2">
                <button
                  onClick={createProject}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowNewProjectDialog(false);
                    setNewProjectName('');
                  }}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const startClaudeCode = (resume = false) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'claudeCommand',
        resume: resume
      }));
    }
  };

  // Check if project has an existing Claude Code session
  const hasClaudeSession = () => {
    return sessionInfo && sessionInfo.hasSession;
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <div className="p-3 border-b border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => {
              setCurrentProject(null);
              setCurrentPath('');
              setFiles([]);
            }}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            ← Back to Projects
          </button>
          <div className="text-sm font-medium">{currentProject.name}</div>
        </div>
        
        <div className="mb-2 flex space-x-2">
          {hasClaudeSession() ? (
            <>
              <button
                onClick={() => startClaudeCode(true)}
                className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded flex items-center"
              >
                <span className="mr-1">🔄</span>
                Resume Session
              </button>
              <button
                onClick={() => startClaudeCode(false)}
                className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded"
              >
                New Session
              </button>
            </>
          ) : (
            <button
              onClick={() => startClaudeCode(false)}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center"
            >
              <span className="mr-1">🚀</span>
              Start Claude Code
            </button>
          )}
        </div>
        
        <button
          onClick={() => setShowDirectories(!showDirectories)}
          className="w-full text-left text-sm text-gray-400 hover:text-gray-300"
        >
          {showDirectories ? '▼' : '▶'} Show Directories
        </button>
      </div>

      {showDirectories && (
        <div className="flex-1 overflow-y-auto border-b border-gray-700">
          <div className="flex items-center p-3 border-b border-gray-700">
            <button
              onClick={goBack}
              className="mr-3 px-2 py-1 text-sm bg-gray-800 hover:bg-gray-700 rounded"
              disabled={!currentPath || currentPath === currentProject.path}
            >
              ← Back
            </button>
            <div className="flex-1 text-sm text-gray-400 truncate">
              {currentPath.replace(currentProject.path, '') || '/'}
            </div>
          </div>

          <div className="p-2">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="text-gray-500">Loading...</div>
              </div>
            ) : (
              files.map((file, index) => (
                <div
                  key={index}
                  onClick={() => handleItemClick(file)}
                  className="flex items-center p-3 hover:bg-gray-800 cursor-pointer rounded-lg mb-1"
                >
                  <div className="mr-3 text-2xl">
                    {file.isDirectory ? '📁' : '📄'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {file.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {file.isDirectory ? 'Folder' : formatSize(file.size)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default FileExplorer;