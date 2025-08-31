import React, { useState, useEffect } from 'react';
import { useSSE } from '@/contexts/SSEContext';
import { cn } from '@/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface LiveStatsCardProps {
  title: string;
  icon: React.ReactNode;
  statKey: string;
  initialValue: number;
  format?: (value: number) => string;
  className?: string;
}

export function LiveStatsCard({
  title,
  icon,
  statKey,
  initialValue,
  format = (v) => v.toString(),
  className
}: LiveStatsCardProps) {
  const [currentValue, setCurrentValue] = useState(initialValue);
  const [previousValue, setPreviousValue] = useState(initialValue);
  const [isUpdated, setIsUpdated] = useState(false);
  const [trend, setTrend] = useState<'up' | 'down' | 'neutral'>('neutral');
  
  const { liveStats } = useSSE();

  // Update value when live stats change
  useEffect(() => {
    if (liveStats && liveStats[statKey] !== undefined) {
      const newValue = liveStats[statKey];
      
      if (newValue !== currentValue) {
        setPreviousValue(currentValue);
        setCurrentValue(newValue);
        setIsUpdated(true);
        
        // Determine trend
        if (newValue > currentValue) {
          setTrend('up');
        } else if (newValue < currentValue) {
          setTrend('down');
        } else {
          setTrend('neutral');
        }
        
        // Clear update indicator after animation
        setTimeout(() => setIsUpdated(false), 2000);
      }
    }
  }, [liveStats, statKey, currentValue]);

  const getTrendIcon = () => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="w-4 h-4 text-green-500" />;
      case 'down':
        return <TrendingDown className="w-4 h-4 text-red-500" />;
      default:
        return <Minus className="w-4 h-4 text-gray-400" />;
    }
  };

  const getTrendColor = () => {
    switch (trend) {
      case 'up':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'down':
        return 'text-red-600 bg-red-50 border-red-200';
      default:
        return 'text-gray-600 bg-white border-gray-200';
    }
  };

  return (
    <div className={cn(
      'bg-white rounded-lg shadow-sm border border-gray-200 p-6 transition-all duration-300',
      isUpdated && 'ring-2 ring-blue-400 bg-blue-50 border-blue-200',
      className
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={cn(
            'p-2 rounded-lg transition-colors',
            isUpdated ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
          )}>
            {icon}
          </div>
          
          <div>
            <p className="text-sm font-medium text-gray-600">
              {title}
            </p>
            <div className="flex items-center space-x-2">
              <p className={cn(
                'text-2xl font-bold transition-colors',
                isUpdated ? 'text-blue-900' : 'text-gray-900'
              )}>
                {format(currentValue)}
              </p>
              
              {isUpdated && (
                <div className={cn(
                  "flex items-center space-x-1 animate-pulse px-2 py-1 rounded border",
                  getTrendColor()
                )}>
                  {getTrendIcon()}
                  <span className="text-xs">
                    {previousValue !== currentValue && (
                      <span>
                        {format(previousValue)} → {format(currentValue)}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Live indicator */}
        <div className="flex items-center space-x-2">
          {isUpdated && (
            <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full animate-pulse">
              <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mr-1 animate-pulse"></div>
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* Progress bar for percentage values */}
      {statKey.includes('Rate') || statKey.includes('rate') && (
        <div className="mt-4">
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={cn(
                'h-2 rounded-full transition-all duration-700',
                isUpdated ? 'bg-blue-500' : 'bg-gray-400'
              )}
              style={{ 
                width: `${Math.min(100, Math.max(0, currentValue * 100))}%` 
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// System Health Indicator Component
export function SystemHealthIndicator() {
  const { systemHealth } = useSSE();
  
  if (!systemHealth) return null;

  const getStatusColor = () => {
    switch (systemHealth.status) {
      case 'healthy':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = () => {
    switch (systemHealth.status) {
      case 'healthy':
        return '✅';
      case 'warning':
        return '⚠️';
      case 'critical':
        return '🚨';
      default:
        return '❓';
    }
  };

  return (
    <div className={cn(
      'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border',
      getStatusColor()
    )}>
      <span className="mr-2">{getStatusIcon()}</span>
      <span className="capitalize">{systemHealth.status}</span>
      <span className="ml-2 text-xs opacity-75">
        CPU: {systemHealth.cpu}% | RAM: {systemHealth.memory}%
      </span>
    </div>
  );
}