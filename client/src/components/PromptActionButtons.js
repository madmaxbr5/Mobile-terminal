import React from 'react';

function PromptActionButtons({ ws, onHide }) {
  const handleAction = (action) => {
    console.log('PromptActionButtons: Action clicked:', action);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'terminal', data: action }));
      console.log('PromptActionButtons: Command sent to terminal');
    }
    console.log('PromptActionButtons: Calling onHide');
    onHide();
  };

  return (
    <div className="border-t border-yellow-500 bg-yellow-900/10 p-2">
      <div className="text-center text-yellow-300 text-xs mb-2 flex items-center justify-center">
        <span className="mr-1">⚠️</span>
        Claude is waiting for your response
      </div>
      <div className="flex items-center justify-center space-x-2">
        <button
          onClick={() => handleAction('1')}
          className="px-3 py-2 bg-green-600 hover:bg-green-700 animate-pulse border-2 border-green-400 rounded text-xs text-white flex items-center justify-center"
          title="Yes - Accept edit"
        >
          1. Yes
        </button>
        <button
          onClick={() => handleAction('2')}
          className="px-3 py-2 bg-green-600 hover:bg-green-700 animate-pulse border-2 border-green-400 rounded text-xs text-white flex items-center justify-center"
          title="Yes and don't ask again"
        >
          2. Yes & Don't Ask
        </button>
        <button
          onClick={() => handleAction('3')}
          className="px-3 py-2 bg-red-600 hover:bg-red-700 animate-pulse border-2 border-red-400 rounded text-xs text-white flex items-center justify-center"
          title="No - Reject edit"
        >
          3. No
        </button>
        <button
          onClick={onHide}
          className="px-2 py-2 bg-gray-600 hover:bg-gray-700 rounded text-xs text-white flex items-center justify-center ml-4"
          title="Hide these buttons"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default PromptActionButtons;