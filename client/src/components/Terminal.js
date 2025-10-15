import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

function Terminal({ ws, connected, currentPath, currentProject }) {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);

  const formatPath = (path) => {
    if (!path) return 'claude_projects';
    
    // Extract path relative to claude_projects
    const claudeProjectsIndex = path.indexOf('claude_projects');
    if (claudeProjectsIndex !== -1) {
      return path.substring(claudeProjectsIndex);
    }
    
    // Fallback: show just the last directory name
    return path.split('/').pop() || 'claude_projects';
  };

  useEffect(() => {
    if (!xtermRef.current && terminalRef.current && connected) {
      setTimeout(() => {
        if (!terminalRef.current) return;
        
        const term = new XTerm({
          cursorBlink: true,
          fontSize: 14,
          convertEol: true,
          allowTransparency: true,
          theme: {
            background: '#111827',
            foreground: '#f3f4f6',
            cursor: '#f3f4f6',
            black: '#111827',
            red: '#ef4444',
            green: '#10b981',
            yellow: '#f59e0b',
            blue: '#3b82f6',
            magenta: '#8b5cf6',
            cyan: '#06b6d4',
            white: '#f3f4f6',
            brightBlack: '#6b7280',
            brightRed: '#f87171',
            brightGreen: '#34d399',
            brightYellow: '#fbbf24',
            brightBlue: '#60a5fa',
            brightMagenta: '#a78bfa',
            brightCyan: '#22d3ee',
            brightWhite: '#ffffff'
          }
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);

        term.open(terminalRef.current);
        
        setTimeout(() => {
          try {
            fitAddon.fit();
          } catch (err) {
            console.error('Error fitting terminal:', err);
          }
        }, 100);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        term.onData((data) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'terminal', data }));
          }
        });
        
        // Add a welcome message
        term.writeln('Terminal connected. Type commands below or use the input at the bottom.');
        term.writeln('');

        const handleResize = () => {
          setTimeout(() => {
            try {
              if (fitAddonRef.current && terminalRef.current) {
                fitAddonRef.current.fit();
                if (ws && ws.readyState === WebSocket.OPEN && xtermRef.current) {
                  ws.send(JSON.stringify({
                    type: 'resize',
                    cols: xtermRef.current.cols,
                    rows: xtermRef.current.rows
                  }));
                }
              }
            } catch (err) {
              console.error('Error resizing terminal:', err);
            }
          }, 100);
        };

        window.addEventListener('resize', handleResize);
        
        setTimeout(handleResize, 200);

        return () => {
          window.removeEventListener('resize', handleResize);
          if (xtermRef.current) {
            xtermRef.current.dispose();
            xtermRef.current = null;
          }
        };
      }, 100);
    }
  }, [connected, ws]);

  useEffect(() => {
    if (ws && xtermRef.current) {
      const handleMessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'terminal' && xtermRef.current) {
            console.log('Terminal received data:', message.data.slice(0, 50));
            xtermRef.current.write(message.data);
            // Scroll to bottom after writing
            xtermRef.current.scrollToBottom();
          }
        } catch (err) {
          console.error('Error handling terminal message:', err);
        }
      };

      ws.addEventListener('message', handleMessage);

      return () => {
        ws.removeEventListener('message', handleMessage);
      };
    }
  }, [ws]);

  // Re-fit terminal when tab becomes visible
  useEffect(() => {
    if (xtermRef.current && fitAddonRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current.fit();
        } catch (err) {
          console.error('Error fitting terminal on tab switch:', err);
        }
      }, 100);
    }
  }, []); // Only run once after mount


  return (
    <div className="h-full bg-gray-900 flex flex-col relative">
      {/* Path Display Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex-shrink-0">
        <div className="text-sm text-gray-300 font-medium text-center">
          {formatPath(currentPath)}
        </div>
      </div>

      {/* Terminal Content */}
      <div className="flex-1 p-4 relative">
        <div className="h-full bg-gray-900 rounded-lg overflow-hidden relative">
          {!connected && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75 z-10">
              <div className="text-gray-400">Connecting to terminal...</div>
            </div>
          )}
          <div ref={terminalRef} className="h-full w-full" />
        </div>
      </div>
    </div>
  );
}

export default Terminal;