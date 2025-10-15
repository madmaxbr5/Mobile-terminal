import React from 'react';

function TaskQueue({ tasks, onExecute }) {
  if (!tasks || tasks.length === 0) {
    return null;
  }

  return (
    <div className="p-3 border-b border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-gray-300">
          Task Queue ({tasks.length})
        </div>
        <button
          onClick={onExecute}
          className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded"
        >
          Execute Next
        </button>
      </div>
      <div className="space-y-1 max-h-24 overflow-y-auto">
        {tasks.map((task, index) => (
          <div
            key={task.id}
            className="text-xs p-2 bg-gray-900 rounded flex items-center"
          >
            <span className="mr-2 text-gray-500">#{index + 1}</span>
            <code className="flex-1 truncate text-gray-300">{task.command}</code>
            <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
              task.status === 'pending' ? 'bg-yellow-900 text-yellow-300' :
              task.status === 'running' ? 'bg-blue-900 text-blue-300' :
              task.status === 'completed' ? 'bg-green-900 text-green-300' :
              'bg-red-900 text-red-300'
            }`}>
              {task.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TaskQueue;