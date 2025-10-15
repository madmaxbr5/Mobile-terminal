import React, { useState, useEffect, useRef } from 'react';

function Preview({ ws, file, currentProject }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [htmlFiles, setHtmlFiles] = useState([]);
  const [selectedHtmlFile, setSelectedHtmlFile] = useState(null);
  const [lastModified, setLastModified] = useState(null);
  const refreshIntervalRef = useRef(null);
  const lastModifiedRef = useRef(null);

  useEffect(() => {
    if (ws && file && !file.isDirectory) {
      loadFile();
    }
  }, [ws, file]);

  // Load HTML files from current project
  useEffect(() => {
    if (currentProject && ws && ws.readyState === WebSocket.OPEN) {
      loadProjectHtmlFiles();
    }
  }, [currentProject, ws]);

  useEffect(() => {
    // Listen for custom events from App.js instead of direct WebSocket messages
    const handleCustomMessage = (event) => {
      handleMessage({ data: JSON.stringify(event.detail) });
    };
    
    window.addEventListener('websocket-message', handleCustomMessage);
    
    return () => {
      window.removeEventListener('websocket-message', handleCustomMessage);
    };
  }, []);

  // Auto-refresh functionality - poll for file changes every 2 seconds
  useEffect(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    const startAutoRefresh = () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      
      refreshIntervalRef.current = setInterval(() => {
        const activeFile = selectedHtmlFile || file;
        if (activeFile && activeFile.name.toLowerCase().endsWith('.html')) {
          // Check if file has been modified by requesting file stats
          // If lastModified is null/undefined, use 0 so the first check will always trigger a refresh
          const lastKnownModified = lastModifiedRef.current || 0;
          ws.send(JSON.stringify({
            type: 'checkFileModified',
            path: activeFile.path,
            lastKnownModified: lastKnownModified,
            lastKnownContent: content
          }));
        }
      }, 2000); // Check every 2 seconds
    };

    // Start auto-refresh when we have a file to watch
    if (selectedHtmlFile || (file && file.name.toLowerCase().endsWith('.html'))) {
      // Start auto-refresh polling
      startAutoRefresh();
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [selectedHtmlFile, file, ws]);

  const handleMessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'fileContent') {
      // Update content and track modification time
      setContent(message.content);
      setLastModified(message.lastModified);
      lastModifiedRef.current = message.lastModified;
      setLoading(false);
      setError(null);
    } else if (message.type === 'error') {
      setError(message.message);
      setLoading(false);
    } else if (message.type === 'fileStructure') {
      // Filter HTML files from the file structure
      const htmlFileList = message.data.filter(file => 
        !file.isDirectory && file.name.toLowerCase().endsWith('.html')
      );
      setHtmlFiles(htmlFileList);
      
      // Auto-select the first HTML file if none selected
      if (htmlFileList.length > 0 && !selectedHtmlFile) {
        setSelectedHtmlFile(htmlFileList[0]);
        loadHtmlFile(htmlFileList[0]);
      }
    } else if (message.type === 'fileModified') {
      // File was modified, reload it
      // File was modified, reload it
      if (message.path === selectedHtmlFile?.path || message.path === file?.path) {
        // File matches current preview, reload it
        if (selectedHtmlFile) {
          loadHtmlFile(selectedHtmlFile);
        } else if (file) {
          loadFile();
        }
      }
    }
  };

  const loadProjectHtmlFiles = () => {
    if (ws && ws.readyState === WebSocket.OPEN && currentProject) {
      ws.send(JSON.stringify({
        type: 'fileStructure',
        path: currentProject.path
      }));
    }
  };

  const loadHtmlFile = (htmlFile) => {
    if (ws && ws.readyState === WebSocket.OPEN && htmlFile) {
      setLoading(true);
      setError(null);
      setSelectedHtmlFile(htmlFile);
      ws.send(JSON.stringify({
        type: 'readFile',
        path: htmlFile.path
      }));
    }
  };

  const loadFile = () => {
    if (ws && ws.readyState === WebSocket.OPEN && file) {
      setLoading(true);
      setError(null);
      ws.send(JSON.stringify({
        type: 'readFile',
        path: file.path
      }));
    }
  };

  const getFileType = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'];
    const codeExts = ['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'py', 'java', 'cpp', 'c', 'h', 'hpp', 'rb', 'go', 'rs', 'php', 'swift', 'kt', 'scala', 'r', 'matlab', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'yaml', 'yml', 'xml', 'md', 'markdown', 'txt'];
    
    if (imageExts.includes(ext)) return 'image';
    if (codeExts.includes(ext)) return 'code';
    return 'text';
  };

  const renderContent = () => {
    // Show project HTML files if no specific file is selected
    if (!file && currentProject) {
      if (htmlFiles.length === 0) {
        return (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <div className="text-lg mb-2">📄</div>
              <div>No HTML files found in {currentProject.name}</div>
              <div className="text-sm text-gray-600 mt-2">Create an HTML file to see it previewed here</div>
            </div>
          </div>
        );
      }

      if (loading) {
        return (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading HTML preview...
          </div>
        );
      }

      if (error) {
        return (
          <div className="flex items-center justify-center h-full text-red-400">
            Error loading HTML: {error}
          </div>
        );
      }

      if (content && selectedHtmlFile) {
        return (
          <iframe
            srcDoc={content}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin"
            title={selectedHtmlFile.name}
          />
        );
      }

      return (
        <div className="flex items-center justify-center h-full text-gray-500">
          Select an HTML file to preview
        </div>
      );
    }

    // Original file preview logic for when a specific file is selected
    if (!file) {
      return (
        <div className="flex items-center justify-center h-full text-gray-500">
          Select a file to preview
        </div>
      );
    }

    if (file.isDirectory) {
      return (
        <div className="flex items-center justify-center h-full text-gray-500">
          Cannot preview directories
        </div>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center h-full text-gray-500">
          Loading...
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center justify-center h-full text-red-400">
          Error: {error}
        </div>
      );
    }

    const fileType = getFileType(file.name);

    // Render HTML files in iframe
    if (file.name.toLowerCase().endsWith('.html')) {
      return (
        <iframe
          srcDoc={content}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title={file.name}
        />
      );
    }

    if (fileType === 'image') {
      return (
        <div className="flex items-center justify-center h-full p-4">
          <img
            src={`data:image/${file.name.split('.').pop()};base64,${btoa(content)}`}
            alt={file.name}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      );
    }

    return (
      <pre className="p-4 text-sm overflow-auto h-full">
        <code className={fileType === 'code' ? 'language-' + file.name.split('.').pop() : ''}>
          {content}
        </code>
      </pre>
    );
  };

  return (
    <div className="h-full bg-gray-900">
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div className="flex-1 flex items-center space-x-3">
          {!file && currentProject && htmlFiles.length > 0 ? (
            <>
              <span className="text-sm text-gray-400">HTML Preview:</span>
              <select
                value={selectedHtmlFile?.path || ''}
                onChange={(e) => {
                  const selected = htmlFiles.find(f => f.path === e.target.value);
                  if (selected) loadHtmlFile(selected);
                }}
                className="text-sm bg-gray-800 border border-gray-600 rounded px-2 py-1 text-gray-100"
              >
                {htmlFiles.map(htmlFile => (
                  <option key={htmlFile.path} value={htmlFile.path}>
                    {htmlFile.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <div className="text-sm text-gray-400 truncate">
              {file ? file.path : currentProject ? `${currentProject.name} - HTML Preview` : 'No file selected'}
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Auto-refresh indicator for HTML files */}
          {(selectedHtmlFile || (file && file.name.toLowerCase().endsWith('.html'))) && (
            <div className="flex items-center space-x-1 text-xs text-green-400">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span>Auto-refresh</span>
            </div>
          )}
          
          {!file && selectedHtmlFile && (
            <button
              onClick={() => loadHtmlFile(selectedHtmlFile)}
              className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded"
            >
              Refresh
            </button>
          )}
          {file && !file.isDirectory && (
            <button
              onClick={loadFile}
              className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded"
            >
              Refresh
            </button>
          )}
        </div>
      </div>
      <div className="h-full overflow-auto bg-gray-950">
        {renderContent()}
      </div>
    </div>
  );
}

export default Preview;