import { useState, useEffect } from 'react';
import { ImageCard } from './ImageCard';
import { ExecutionWithImage } from '@/types';
import { cn } from '@/utils';

interface LiveExecutionCardProps {
  execution: ExecutionWithImage;
  onRemove?: (id: string) => void;
  className?: string;
}

export function LiveExecutionCard({ execution, onRemove, className }: LiveExecutionCardProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  // Entrance animation
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Auto-remove after 30 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsRemoving(true);
      setTimeout(() => {
        onRemove?.(execution.id);
      }, 500);
    }, 30000);

    return () => clearTimeout(timer);
  }, [execution.id, onRemove]);

  return (
    <div
      className={cn(
        'transform transition-all duration-500 ease-in-out',
        isVisible && !isRemoving 
          ? 'translate-y-0 opacity-100' 
          : 'translate-y-4 opacity-0',
        className
      )}
    >
      <div className="relative">
        {/* Live indicator */}
        <div className="absolute top-2 left-2 z-10">
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full animate-pulse">
            <div className="w-2 h-2 bg-red-400 rounded-full mr-1 animate-pulse"></div>
            LIVE
          </span>
        </div>

        {/* Glowing border for high-risk executions */}
        <div className={cn(
          execution.analysis?.riskAssessment === 'high' &&
          "ring-2 ring-red-400 ring-opacity-75 animate-pulse"
        )}>
          <ImageCard execution={execution} onClick={() => {}} />
        </div>

        {/* New execution badge */}
        <div className="absolute bottom-2 right-2">
          <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
            NEW
          </span>
        </div>
      </div>
    </div>
  );
}