import { useState, useCallback, useEffect } from 'react';
import { LiveExecutionCard } from './LiveExecutionCard';
import { ExecutionWithImage } from '@/types';
import { useSSE } from '@/contexts/SSEContext';
import { Activity, X } from 'lucide-react';
import { cn } from '@/utils';

export function LiveExecutionStrip() {
  const [liveExecutions, setLiveExecutions] = useState<ExecutionWithImage[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Add new execution to live strip
  const addLiveExecution = useCallback((execution: ExecutionWithImage) => {
    setLiveExecutions(prev => {
      // Prevent duplicates and limit to 6 items
      const filtered = prev.filter(e => e.id !== execution.id);
      return [execution, ...filtered].slice(0, 6);
    });
  }, []);

  // Handle SSE events for live execution updates using direct event listeners
  const { isConnected } = useSSE();

  useEffect(() => {
    const handleBatch = (event: CustomEvent) => {
      const data = event.detail;
      console.log('🎯 LiveExecutionStrip: Batch received with', data.count, 'executions');
      
      // Add all new executions from the batch to the live strip
      if (data.executions && Array.isArray(data.executions)) {
        data.executions.forEach((execution: ExecutionWithImage) => {
          addLiveExecution(execution);
        });
      }
    };

    const handleNewExecution = (event: CustomEvent) => {
      const data = event.detail;
      console.log('🎯 LiveExecutionStrip: New execution received:', data.execution.id);
      
      // Add individual execution to live strip
      if (data.execution) {
        addLiveExecution(data.execution);
      }
    };

    // Add event listeners
    window.addEventListener('sai:execution:batch', handleBatch as EventListener);
    window.addEventListener('sai:execution:new', handleNewExecution as EventListener);

    return () => {
      // Cleanup event listeners
      window.removeEventListener('sai:execution:batch', handleBatch as EventListener);
      window.removeEventListener('sai:execution:new', handleNewExecution as EventListener);
    };
  }, [addLiveExecution]);

  // Remove execution from live strip
  const removeLiveExecution = useCallback((executionId: string) => {
    setLiveExecutions(prev => prev.filter(e => e.id !== executionId));
  }, []);

  // Clear all live executions
  const clearAll = useCallback(() => {
    setLiveExecutions([]);
  }, []);

  if (!isConnected || liveExecutions.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-2">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-blue-600" />
            <h3 className="font-medium text-gray-900">
              Live Updates
            </h3>
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
              {liveExecutions.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={clearAll}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Clear All
            </button>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {isCollapsed ? (
                <Activity className="w-4 h-4" />
              ) : (
                <X className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Live execution grid */}
        {!isCollapsed && (
          <div className="px-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              {liveExecutions.map((execution, index) => (
                <LiveExecutionCard
                  key={execution.id}
                  execution={execution}
                  onRemove={removeLiveExecution}
                  className={cn(
                    'transform transition-all duration-300',
                    `delay-${index * 100}`
                  )}
                />
              ))}
            </div>

            {/* Auto-clear notice */}
            <div className="mt-3 text-center">
              <p className="text-xs text-gray-500">
                Live updates automatically move to main gallery after 30 seconds
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Hook to connect SSE events to live execution strip
export function useLiveExecutionStrip() {
  const registerHandler = useCallback((handler: (execution: ExecutionWithImage) => void) => {
    console.log('Registered live execution handler:', handler);
  }, []);

  return { registerHandler };
}