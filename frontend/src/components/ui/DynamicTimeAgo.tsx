import { useState, useEffect } from 'react';
import { formatRelativeTime } from '@/utils';

interface DynamicTimeAgoProps {
  date: string | Date;
  updateInterval?: number; // milliseconds
  className?: string;
}

export function DynamicTimeAgo({ 
  date, 
  updateInterval = 60000, // Update every minute by default
  className 
}: DynamicTimeAgoProps) {
  const [formattedTime, setFormattedTime] = useState(() => formatRelativeTime(date));

  useEffect(() => {
    // Update immediately
    setFormattedTime(formatRelativeTime(date));

    // Set up interval for periodic updates
    const interval = setInterval(() => {
      setFormattedTime(formatRelativeTime(date));
    }, updateInterval);

    return () => clearInterval(interval);
  }, [date, updateInterval]);

  return (
    <span className={className}>
      {formattedTime}
    </span>
  );
}