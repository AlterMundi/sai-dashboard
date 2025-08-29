import { cn, getStatusColor, capitalizeFirst } from '@/utils';
import { StatusBadgeProps } from '@/types';

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const colors = getStatusColor(status);
  
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium border',
        colors.bg,
        colors.text,
        colors.border,
        sizeClasses[size]
      )}
    >
      <span
        className={cn(
          'mr-1.5 h-1.5 w-1.5 rounded-full',
          status === 'success' && 'bg-success-600',
          status === 'error' && 'bg-danger-600',
          (status === 'waiting' || status === 'running') && 'bg-warning-600 animate-pulse',
          status === 'canceled' && 'bg-gray-600'
        )}
      />
      {capitalizeFirst(status)}
    </span>
  );
}