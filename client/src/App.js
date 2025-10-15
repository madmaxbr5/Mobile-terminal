import React, { useState, useEffect, useRef } from 'react';
import FileExplorer from './components/FileExplorer';
import Terminal from './components/Terminal';
import Preview from './components/Preview';
import TaskQueue from './components/TaskQueue';
import TerminalInput from './components/TerminalInput';
import PromptActionButtons from './components/PromptActionButtons';

function App() {
  const [activeTab, setActiveTab] = useState('terminal');
  const [ws, setWs] = useState(null);
  const [connected, setConnected] = useState(false);
  const [taskQueue, setTaskQueue] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [terminalId, setTerminalId] = useState(null);
  const [currentPath, setCurrentPath] = useState(null);
  const [currentProject, setCurrentProject] = useState(null);
  const [vibeValue, setVibeValue] = useState(5);
  const [vibeSliderOpen, setVibeSliderOpen] = useState(false);
  const vibeSliderRef = useRef(null);
  const vibeButtonRef = useRef(null);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 });
  const [claudeRunning, setClaudeRunning] = useState(false);
  const [recentTerminalOutput, setRecentTerminalOutput] = useState([]);
  const [userPromptActive, setUserPromptActive] = useState(false);
  const promptTimeoutRef = useRef(null);
  const lastPromptHideTime = useRef(0);
  const lastPromptContent = useRef('');

  // Mobile viewport height fix
  useEffect(() => {
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    
    setVH();
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', setVH);
    
    return () => {
      window.removeEventListener('resize', setVH);
      window.removeEventListener('orientationchange', setVH);
    };
  }, []);

  // Prevent mobile browser from sleeping and keep connection alive
  useEffect(() => {
    // Keep screen awake on mobile
    const keepAwake = () => {
      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen').catch(() => {
          // Wake lock not supported or denied
        });
      }
    };

    // Ping server periodically to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // Ping every 30 seconds

    // Prevent page unload/background events from closing connection
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Page became visible again, request wake lock
        keepAwake();
      }
    };

    const handleBeforeUnload = (e) => {
      // Prevent accidental page close
      e.preventDefault();
      e.returnValue = 'Are you sure? This will disconnect your terminal session.';
      return e.returnValue;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Initial wake lock request
    keepAwake();

    return () => {
      clearInterval(pingInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [ws]);

  // Close vibe slider when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (vibeSliderRef.current && !vibeSliderRef.current.contains(event.target)) {
        setVibeSliderOpen(false);
      }
    };

    if (vibeSliderOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [vibeSliderOpen]);

  // Auto-resume Claude whenever conditions are right
  useEffect(() => {
    const checkAndAutoResume = async () => {
      console.log('Auto-resume check:', {
        activeTab,
        currentProject: currentProject?.name,
        wsConnected: ws && ws.readyState === WebSocket.OPEN,
        claudeRunning
      });
      
      // Only auto-resume if:
      // 1. We're on the terminal tab
      // 2. We have a current project
      // 3. WebSocket is connected
      // 4. Claude is not already running
      if (activeTab === 'terminal' && currentProject && ws && ws.readyState === WebSocket.OPEN && !claudeRunning) {
        try {
          const apiUrl = window.location.hostname === 'localhost'
            ? `http://localhost:3001/api/projects/${currentProject.name}/claude-session`
            : `http://${window.location.hostname}:3001/api/projects/${currentProject.name}/claude-session`;
          
          const response = await fetch(apiUrl);
          const data = await response.json();
          
          if (data.hasSession) {
            console.log('Auto-resuming Claude session...');
            ws.send(JSON.stringify({ type: 'claudeCommand', resume: true }));
            // Don't set claudeRunning immediately - let terminal output detection handle it
          } else {
            console.log('Auto-starting new Claude session...');
            ws.send(JSON.stringify({ type: 'claudeCommand', resume: false }));
            // Don't set claudeRunning immediately - let terminal output detection handle it
          }
        } catch (error) {
          console.error('Error checking session for auto-resume:', error);
        }
      }
    };

    // Small delay to avoid rapid fire on state changes
    const timeoutId = setTimeout(checkAndAutoResume, 500);
    return () => clearTimeout(timeoutId);
  }, [activeTab, currentProject, ws, claudeRunning]);

  useEffect(() => {
    let websocket;
    let reconnectTimeout;

    const connect = () => {
      // Use window.location.hostname for mobile compatibility
      const wsUrl = window.location.hostname === 'localhost' 
        ? 'ws://localhost:3001' 
        : `ws://${window.location.hostname}:3001`;
      
      websocket = new WebSocket(wsUrl);
      
      websocket.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
        // Clear any pending reconnect
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
      };

      websocket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
          case 'connected':
            setTerminalId(message.terminalId);
            // If we have an initial project, we're already in a project directory
            if (message.initialProject) {
              console.log('Started in project:', message.initialProject.name);
              setCurrentProject(message.initialProject);
              setCurrentPath(message.initialProject.path);
            }
            // Note: currentPath will be set when the terminal starts running pwd or similar
            break;
          case 'projectSet':
            setCurrentProject(message.project);
            setCurrentPath(message.project.path);
            break;
          case 'terminal':
            // Monitor terminal output to detect Claude starting/stopping
            if (message.data) {
              // Capture recent terminal output for floating display
              setRecentTerminalOutput(prev => {
                // Extract text from existing objects or use strings directly
                const prevLines = prev.map(item => typeof item === 'string' ? item : item.text);
                const newOutput = [...prevLines, message.data];
                
                // Enhanced filtering to remove unwanted terminal output
                const filtered = newOutput
                  .map(line => {
                    // Ensure we're working with strings
                    const lineStr = typeof line === 'string' ? line : String(line);
                    // Remove all ANSI escape sequences comprehensively
                    return lineStr
                      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // Remove ANSI escape sequences
                      .replace(/\x1b\[[0-9;]*m/g, '') // Remove color codes
                      .replace(/\x1b\[[\d;]*[HJK]/g, '') // Remove cursor control
                      .replace(/\[[\d;]*[A-Za-z]/g, '') // Remove bracket sequences
                      .replace(/\?\d+[lh]/g, '') // Remove mode sequences
                      .replace(/\x1b\[[\d;]*~/g, '') // Remove other escape sequences
                      .trim();
                  })
                  .filter(line => {
                    return line.length > 3 && 
                           !line.match(/^[\s\r\n]*$/) && // Empty lines
                           !line.match(/^\[[\d;]*[A-Za-z]$/) && // Control sequences
                           !line.match(/^\?\d+[lh]$/) && // Bracket paste mode
                           !line.match(/^[%\s]*$/) && // Shell prompts
                           !line.match(/^Terminal output:/) && // Debug output
                           !line.match(/^[K\s]*$/) && // Clear sequences
                           !line.match(/^[\d;]*[mGKH]$/) && // Standalone sequences
                           !line.match(/^Auto-update failed/) && // System messages
                           !line.match(/^Try claude doctor/) && // System messages
                           !line.match(/^npm i -g/) && // Installation messages
                           !line.match(/^or npm i -g/) && // Installation messages
                           !line.match(/^\s*using Sonnet/) && // Model info
                           !line.includes('anthropic-ai/claude-code') && // Package names
                           !line.includes('esc to interrupt') && // Interrupt instructions
                           !line.match(/^[│╭╮╯╰─┤├\s]*$/) && // Box drawing characters only
                           !line.match(/^[│\s]*>\s*[│\s]*$/) && // Empty prompt boxes
                           !line.includes('Claude Opus') && // Model limit messages
                           !line.includes('Claude Sonnet') && // Model limit messages
                           !line.includes('limit reached') && // Limit notifications
                           !line.includes('now using') && // Model switching
                           line !== 'claude-code' && // Command echoes
                           line !== 'aude-code'; // Partial command echoes
                  })
                  .slice(-10) // Keep more lines to filter from
                  .map(line => {
                    // Mark interactive prompts for special highlighting
                    const isPrompt = line.includes('Do you want to') || 
                                   line.includes('❯ 1. Yes') ||
                                   line.includes('❯ 2. Yes') ||
                                   line.includes('❯ 3. No') ||
                                   line.match(/^\s*\d+\.\s+(Yes|No)/) ||
                                   line.includes('shift+tab') ||
                                   line.includes('(esc)') ||
                                   line.includes('Edit file') ||
                                   line.includes('make this edit');
                    
                    return {
                      text: line,
                      isPrompt: isPrompt
                    };
                  })
                  .slice(-5); // Then take last 5 meaningful lines
                
                // Only check for prompts in the CURRENT incoming message, not the entire buffer
                const currentMessage = message.data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
                
                // Broader prompt detection - look for numbered options pattern
                const hasNumberedOptions = currentMessage.includes('❯ 1.') && 
                                         (currentMessage.includes('2.') || currentMessage.includes('3.'));
                
                const hasPromptKeywords = currentMessage.includes('Do you want') ||
                                        currentMessage.includes('Should I') ||
                                        currentMessage.includes('Would you like') ||
                                        currentMessage.includes('make this edit') ||
                                        currentMessage.includes('Continue?') ||
                                        currentMessage.includes('Proceed?');
                
                const isNewPrompt = hasNumberedOptions && hasPromptKeywords;
                
                if (isNewPrompt) {
                  console.log('Prompt detected in message:', JSON.stringify(currentMessage));
                }
                
                const isResolution = currentMessage.includes('Edit applied') ||
                                   currentMessage.includes('Changes saved') ||
                                   currentMessage.includes('File updated') ||
                                   currentMessage.includes('Edit complete') ||
                                   currentMessage.includes('Successfully') ||
                                   currentMessage.match(/^[✓✅]/) ||
                                   currentMessage.includes('max@Maxwells-MacBook-Pro') ||
                                   currentMessage.includes('Continuing…') ||
                                   currentMessage.includes('Done');
                
                // Simple prompt state management
                if (isResolution && userPromptActive) {
                  console.log('Prompt resolved in current message, clearing action buttons');
                  setUserPromptActive(false);
                  if (promptTimeoutRef.current) {
                    clearTimeout(promptTimeoutRef.current);
                    promptTimeoutRef.current = null;
                  }
                } else if (isNewPrompt && !userPromptActive) {
                  const now = Date.now();
                  const timeSinceLastHide = now - lastPromptHideTime.current;
                  
                  // If within 15 seconds of last prompt, check for duplicates
                  if (timeSinceLastHide < 15000) {
                    // Normalize the prompt text for comparison
                    const normalizePrompt = (text) => {
                      return text
                        .replace(/\r\n/g, ' ')
                        .replace(/\s+/g, ' ')
                        .replace(/[│╭╮╯╰─┤├]/g, '') // Remove box drawing characters
                        .trim()
                        .toLowerCase();
                    };
                    
                    const currentNormalized = normalizePrompt(currentMessage);
                    const lastNormalized = normalizePrompt(lastPromptContent.current);
                    
                    // Calculate similarity (simple approach: check if they share significant content)
                    const isDuplicate = currentNormalized.length > 10 && 
                                      lastNormalized.length > 10 && 
                                      (currentNormalized.includes(lastNormalized.substring(0, 20)) ||
                                       lastNormalized.includes(currentNormalized.substring(0, 20)));
                    
                    if (isDuplicate) {
                      console.log('Duplicate prompt detected, ignoring');
                      return filtered;
                    } else {
                      console.log('New unique prompt detected within 15s window');
                    }
                  }
                  
                  console.log('Showing action buttons for new prompt');
                  setUserPromptActive(true);
                  lastPromptContent.current = currentMessage;
                  
                  // Set a timeout to auto-clear the prompt after 30 seconds
                  if (promptTimeoutRef.current) {
                    clearTimeout(promptTimeoutRef.current);
                  }
                  promptTimeoutRef.current = setTimeout(() => {
                    console.log('Prompt timeout, clearing action buttons');
                    setUserPromptActive(false);
                    lastPromptHideTime.current = Date.now();
                    promptTimeoutRef.current = null;
                  }, 30000);
                }
                
                return filtered;
              });
              
              if (message.data.includes('Welcome to Claude Code') || 
                  message.data.includes('claude-code') ||
                  message.data.includes('Claude Opus') ||
                  message.data.includes('Claude Sonnet')) {
                console.log('Detected Claude starting');
                setClaudeRunning(true);
              } else if (message.data.includes('max@Maxwells-MacBook-Pro') && 
                         message.data.includes('%') && 
                         !message.data.includes('claude')) {
                // Detect when we're back to shell prompt (but not running claude command)
                console.log('Detected shell prompt, Claude may have stopped');
                setClaudeRunning(false);
              }
            }
            break;
          case 'taskQueued':
          case 'taskComplete':
          case 'taskError':
            setTaskQueue(message.queue || []);
            break;
          case 'switchToTerminal':
            setActiveTab('terminal');
            break;
          case 'fileContent':
          case 'fileStructure':
          case 'error':
            // Pass these messages through to Preview component by re-dispatching
            window.dispatchEvent(new CustomEvent('websocket-message', { 
              detail: message 
            }));
            break;
          default:
            break;
        }
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      websocket.onclose = (event) => {
        console.log('WebSocket disconnected, code:', event.code, 'reason:', event.reason);
        setConnected(false);
        
        // Reconnect unless it was a clean close or we're already trying to reconnect
        if (event.code !== 1000 && !reconnectTimeout) {
          console.log('Attempting to reconnect in 3 seconds...');
          reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;
            connect();
          }, 3000);
        }
      };

      setWs(websocket);
    };

    connect();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (websocket) {
        websocket.close(1000); // Clean close
      }
    };
  }, []);

  const handleFileSelect = (file) => {
    setSelectedFile(file);
    if (!file.isDirectory) {
      setActiveTab('preview');
    }
  };

  const handleAddTask = (task) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // IMPORTANT: Terminal command execution requires two separate WebSocket messages:
      // 1. Send the command text first
      // 2. Send the enter key (\r) as a separate message with a delay
      // 
      // This mimics actual human typing behavior and works for both shell commands
      // and Claude Code commands. Sending them together (task + '\r') or other
      // combinations like '\n', '\r\n' do NOT work reliably.
      // 
      // The 50ms delay ensures the terminal processes the command text before
      // receiving the enter keypress, which is crucial for proper execution.
      
      ws.send(JSON.stringify({ type: 'terminal', data: task }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'terminal', data: '\r' }));
      }, 50);
      
      // Don't switch tabs - let the user stay where they are
    }
  };

  const handleExecuteTask = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'executeTask' }));
    }
  };


  const tabs = [
    { id: 'files', label: 'Files', icon: '📁' },
    { id: 'terminal', label: 'Terminal', icon: '⌨️' },
    { id: 'preview', label: 'Preview', icon: '👁️' }
  ];

  return (
    <div className="flex flex-col bg-gray-900 text-gray-100 mobile-full-height" style={{ height: '100vh' }}>
      <div className="flex border-b border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-400'
                : 'bg-gray-900 text-gray-400 hover:bg-gray-800'
            }`}
          >
            <span className="mr-2">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        <div className={activeTab === 'files' ? 'h-full' : 'hidden'}>
          <FileExplorer ws={ws} onFileSelect={handleFileSelect} />
        </div>
        <div className={activeTab === 'terminal' ? 'h-full' : 'hidden'}>
          <Terminal ws={ws} connected={connected} currentPath={currentPath} currentProject={currentProject} />
        </div>
        <div className={activeTab === 'preview' ? 'h-full' : 'hidden'}>
          <Preview ws={ws} file={selectedFile} currentProject={currentProject} />
        </div>
      </div>

      <div className="border-t border-gray-700 bg-gray-800">
        {activeTab !== 'terminal' && (
          <TaskQueue 
            tasks={taskQueue} 
            onExecute={handleExecuteTask}
          />
        )}
        
        {/* Terminal Navigation Controls - Only show on terminal tab */}
        {activeTab === 'terminal' && (
          <div className={`p-2 border-b transition-all ${
            userPromptActive 
              ? 'border-yellow-500 bg-yellow-900/10' 
              : 'border-gray-700'
          }`}>
            {userPromptActive && (
              <div className="text-center text-yellow-300 text-xs mb-2 flex items-center justify-center">
                <span className="mr-1">⚠️</span>
                Claude is waiting for your response - use buttons below
              </div>
            )}
            <div className="flex items-center justify-center space-x-1 overflow-x-auto">
              {/* Quick Select Numbers - Highlight when user prompt is active */}
              <div className="flex space-x-1">
                <button
                  onClick={() => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'terminal', data: '1' }))}
                  className={`w-8 h-8 rounded text-xs text-white flex items-center justify-center transition-all ${
                    userPromptActive 
                      ? 'bg-green-600 hover:bg-green-700 animate-pulse border-2 border-green-400' 
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                  title={userPromptActive ? "Yes - Accept edit" : "Option 1"}
                >
                  1
                </button>
                <button
                  onClick={() => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'terminal', data: '2' }))}
                  className={`w-8 h-8 rounded text-xs text-white flex items-center justify-center transition-all ${
                    userPromptActive 
                      ? 'bg-green-600 hover:bg-green-700 animate-pulse border-2 border-green-400' 
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                  title={userPromptActive ? "Yes and don't ask again" : "Option 2"}
                >
                  2
                </button>
                <button
                  onClick={() => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'terminal', data: '3' }))}
                  className={`w-8 h-8 rounded text-xs text-white flex items-center justify-center transition-all ${
                    userPromptActive 
                      ? 'bg-red-600 hover:bg-red-700 animate-pulse border-2 border-red-400' 
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                  title={userPromptActive ? "No - Reject edit" : "Option 3"}
                >
                  3
                </button>
              </div>

              {/* Separator */}
              <div className="w-px h-6 bg-gray-600 mx-2"></div>

              {/* Yes/No Actions */}
              <div className="flex space-x-1">
                <button
                  onClick={() => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'terminal', data: '\r' }))}
                  className="px-3 h-8 bg-green-600 hover:bg-green-700 rounded text-xs text-white flex items-center justify-center"
                  title="Enter/Confirm"
                >
                  Enter
                </button>
                <button
                  onClick={() => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'terminal', data: '\u001b' }))}
                  className="px-3 h-8 bg-red-600 hover:bg-red-700 rounded text-xs text-white flex items-center justify-center"
                  title="Escape"
                >
                  Esc
                </button>
              </div>

              {/* Separator */}
              <div className="w-px h-6 bg-gray-600 mx-2"></div>

              {/* Arrow Keys and Vibe Control */}
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'terminal', data: '\u001b[A' }))}
                  className="w-8 h-8 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white flex items-center justify-center"
                  title="Up Arrow"
                >
                  ↑
                </button>
                <button
                  onClick={() => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'terminal', data: '\u001b[B' }))}
                  className="w-8 h-8 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white flex items-center justify-center"
                  title="Down Arrow"
                >
                  ↓
                </button>
                
                {/* Vibe Slider Control */}
                <div className="relative" ref={vibeSliderRef}>
                  <button
                    ref={vibeButtonRef}
                    onClick={() => {
                      console.log('Vibe button clicked, current state:', vibeSliderOpen);
                      
                      if (vibeButtonRef.current) {
                        const rect = vibeButtonRef.current.getBoundingClientRect();
                        setPopupPosition({
                          top: rect.top - 200, // Position above button with adjusted spacing
                          left: rect.left, // Align left edge with button
                          width: rect.width // Match button width
                        });
                      }
                      
                      setVibeSliderOpen(!vibeSliderOpen);
                    }}
                    className="px-3 h-8 border border-gray-600 rounded text-xs font-bold text-white hover:opacity-80 transition-opacity flex items-center justify-center"
                    style={{ 
                      background: 'linear-gradient(45deg, #581c87, #ff4500)'
                    }}
                    title="Set creativity vibe level"
                  >
                    vibe:{vibeValue}
                  </button>
                  
                  {vibeSliderOpen && (
                    <div 
                      className="bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-lg"
                      style={{ 
                        position: 'fixed',
                        zIndex: 9999,
                        width: `${popupPosition.width}px`,
                        top: `${popupPosition.top}px`,
                        left: `${popupPosition.left}px`,
                        borderWidth: '0.5px'
                      }}
                    >
                      <div className="flex flex-col items-center space-y-2">
                        <div 
                          className="relative h-32 w-6 rounded-full cursor-pointer"
                          style={{ background: 'linear-gradient(180deg, #ff4500, #581c87)' }}
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const clickY = e.clientY - rect.top;
                            const percentage = 1 - (clickY / rect.height); // Invert because top = high value
                            const newValue = Math.round(percentage * 9) + 1; // Scale to 1-10
                            setVibeValue(Math.max(1, Math.min(10, newValue)));
                          }}
                        >
                          <div 
                            className="absolute w-6 h-2 rounded-full pointer-events-none bg-white"
                            style={{
                              bottom: `${((vibeValue - 1) / 9) * 100}%`,
                              transform: 'translateY(50%)'
                            }}
                          />
                        </div>
                        <div className="text-xs text-gray-400">{vibeValue}/10</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* User prompt action buttons for non-terminal tabs */}
        {activeTab !== 'terminal' && userPromptActive && (
          <PromptActionButtons 
            ws={ws} 
            onHide={() => {
              console.log('App: onHide called, setting userPromptActive to false');
              setUserPromptActive(false);
              lastPromptHideTime.current = Date.now();
              // Keep the last prompt content for duplicate detection
            }} 
          />
        )}

        {/* Floating terminal output for non-terminal tabs */}
        {activeTab !== 'terminal' && recentTerminalOutput.length > 0 && (
          <div className="border-t border-gray-700 bg-gray-800 p-2">
            <div className="text-xs text-gray-400 mb-1 flex items-center">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse mr-2"></span>
              Recent Terminal Output
            </div>
            <div className="bg-gray-900 rounded p-2 max-h-24 overflow-y-auto">
              {recentTerminalOutput.map((item, index) => {
                // Handle both old string format and new object format for compatibility
                const text = typeof item === 'string' ? item : item.text;
                const isPrompt = typeof item === 'object' ? item.isPrompt : false;
                
                return (
                  <div 
                    key={index} 
                    className={`text-xs font-mono break-all ${
                      isPrompt 
                        ? 'text-yellow-300 bg-yellow-900/20 px-1 rounded border-l-2 border-yellow-400' 
                        : 'text-gray-300'
                    }`}
                  >
                    {isPrompt && <span className="text-yellow-400 mr-1">⚠️</span>}
                    {text}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        <TerminalInput 
          onSubmit={handleAddTask}
          placeholder={activeTab === 'terminal' ? "Enter terminal command..." : "Enter Claude Code command..."}
        />
      </div>
    </div>
  );
}

export default App;