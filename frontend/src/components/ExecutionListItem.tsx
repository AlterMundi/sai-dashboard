import { memo } from 'react';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { cn } from '@/utils';
import { ExecutionWithImageUrls } from '@/types';
import { useImageCard, alertLevelColors } from '@/hooks/useImageCard';
import {
  AlertTriangle,
  Wind,
  Camera,
  MapPin,
  MessageCircle,
  RefreshCw,
  X,
} from 'lucide-react';

interface ExecutionListItemProps {
  execution: ExecutionWithImageUrls;
  onClick: (execution: ExecutionWithImageUrls) => void;
  loading?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
}

export const ExecutionListItem = memo(function ExecutionListItem({ execution, onClick, loading = false, isSelected, onToggleSelect }: ExecutionListItemProps) {
  const {
    imageLoading,
    imageError,
    isStage1Only,
    hasStage2Error,
    thumbnailUrl,
    handleImageLoad,
    handleImageError,
  } = useImageCard(execution);

  const handleClick = () => {
    if (!loading) {
      onClick(execution);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-4 p-3 bg-white rounded-lg border border-gray-200 hover:border-primary-300 hover:shadow-md transition-[box-shadow,border-color] cursor-pointer focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 outline-none',
        loading && 'opacity-50 cursor-not-allowed',
        isSelected && 'bg-primary-50 border-primary-200',
        execution.alertLevel === 'critical' && !isSelected && 'border-l-4 border-l-red-500',
        execution.alertLevel === 'high' && !isSelected && 'border-l-4 border-l-orange-500'
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Execution ${execution.id}, status ${execution.status}${execution.alertLevel && execution.alertLevel !== 'none' ? `, alert level ${execution.alertLevel}` : ''}`}
    >
      {/* Checkbox */}
      {onToggleSelect && (
        <div
          className="flex-shrink-0 w-8 flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={isSelected || false}
            onChange={() => onToggleSelect(execution.id)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 accent-primary-600 cursor-pointer"
            aria-label={`Select execution ${execution.id}`}
          />
        </div>
      )}

      {/* Thumbnail */}
      <div className="flex-shrink-0 w-20 sm:w-24 aspect-video rounded-md overflow-hidden bg-gray-100 relative">
        {thumbnailUrl ? (
          <>
            {imageLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <LoadingSpinner size="sm" color="gray" />
              </div>
            )}
            {imageError ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
            ) : (
              <img
                src={thumbnailUrl}
                alt={`Execution ${execution.id}`}
                className={cn(
                  'w-full h-full object-cover',
                  imageLoading ? 'opacity-0' : 'opacity-100'
                )}
                width={64}
                height={64}
                onLoad={handleImageLoad}
                onError={handleImageError}
                loading="lazy"
              />
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            {isStage1Only ? (
              <RefreshCw className="h-5 w-5 animate-spin text-blue-500" aria-hidden="true" />
            ) : hasStage2Error ? (
              <X className="h-5 w-5 text-red-500" aria-hidden="true" />
            ) : (
              <Camera className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
        )}
      </div>

      {/* Mobile info panel — hidden on sm+ */}
      <div className="flex-1 min-w-0 sm:hidden">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-medium text-gray-900 truncate">
            #{String(execution.id).padStart(6, '0')}
          </span>
          {execution.alertLevel && execution.alertLevel !== 'none' && (
            <span className={cn(
              'flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-bold uppercase',
              alertLevelColors[execution.alertLevel] || alertLevelColors.none
            )}>
              {execution.alertLevel}
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 tabular-nums mt-0.5">
          {new Date(execution.executionTimestamp).toLocaleString('en-GB', {
            day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit',
            hour12: false
          })}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {execution.cameraId && (
            <div className="flex items-center text-xs text-gray-600">
              <Camera className="h-3 w-3 mr-0.5 text-gray-400" aria-hidden="true" />
              <span className="truncate max-w-[80px]">{execution.cameraId}</span>
            </div>
          )}
          {execution.location && (
            <div className="flex items-center text-xs text-gray-500">
              <MapPin className="h-3 w-3 mr-0.5 text-gray-400" aria-hidden="true" />
              <span className="truncate max-w-[100px]">{execution.location}</span>
            </div>
          )}
          {execution.hasSmoke && !isStage1Only && (
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700">
              <Wind className="h-3 w-3" aria-hidden="true" />
              {execution.confidenceSmoke !== null && (
                <span className="tabular-nums">{Math.round(execution.confidenceSmoke * 100)}%</span>
              )}
            </div>
          )}
          {isStage1Only && (
            <div className="flex items-center text-xs text-blue-600">
              <RefreshCw className="h-3 w-3 mr-0.5 animate-spin" aria-hidden="true" />
              Processing…
            </div>
          )}
        </div>
      </div>

      {/* ID — desktop only */}
      <div className="hidden sm:flex flex-shrink-0 w-20 justify-center">
        <div className="font-mono text-sm font-medium text-gray-900">
          #{String(execution.id).padStart(6, '0')}
        </div>
      </div>

      {/* Time — desktop only */}
      <div className="hidden sm:flex flex-shrink-0 w-28 justify-center">
        <div className="text-xs text-gray-500 tabular-nums">
          {new Date(execution.executionTimestamp).toLocaleString('en-GB', {
            day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit',
            hour12: false
          })}
        </div>
      </div>

      {/* Camera & Location — desktop only */}
      <div className="hidden sm:flex flex-1 min-w-0">
        <div className="flex items-center gap-3 text-sm">
          {execution.cameraId && (
            <div className="flex items-center text-gray-700" title={`Camera: ${execution.cameraId}`}>
              <Camera className="h-4 w-4 mr-1 text-gray-400" aria-hidden="true" />
              <span className="truncate max-w-[120px]">{execution.cameraId}</span>
            </div>
          )}
          {execution.location && (
            <div className="flex items-center text-gray-600" title={`Location: ${execution.location}`}>
              <MapPin className="h-4 w-4 mr-1 text-gray-400" aria-hidden="true" />
              <span className="truncate max-w-[120px]">{execution.location}</span>
            </div>
          )}
        </div>
        {isStage1Only && (
          <div className="text-xs text-blue-600 flex items-center mt-1">
            <RefreshCw className="h-3 w-3 mr-1 animate-spin" aria-hidden="true" />
            Processing{'\u2026'}
          </div>
        )}
        {hasStage2Error && (
          <div className="text-xs text-red-600 flex items-center mt-1">
            <X className="h-3 w-3 mr-1" aria-hidden="true" />
            Analysis failed
          </div>
        )}
      </div>

      {/* Alert Level — desktop only */}
      <div className="hidden sm:flex flex-shrink-0 w-24 justify-center">
        {execution.alertLevel && execution.alertLevel !== 'none' ? (
          <span className={cn(
            'inline-block px-2 py-1 rounded text-xs font-bold uppercase',
            alertLevelColors[execution.alertLevel] || alertLevelColors.none
          )}>
            {execution.alertLevel}
          </span>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        )}
      </div>

      {/* Detection Indicators — desktop only */}
      <div className="hidden sm:flex flex-shrink-0 w-20 items-center justify-center gap-2">
        {execution.hasSmoke && (
          <div
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
              isStage1Only ? 'bg-gray-100 text-gray-500' : 'bg-gray-200 text-gray-700'
            )}
            title={isStage1Only ? "Smoke detection pending" : "Smoke detected"}
          >
            <Wind className="h-3 w-3" aria-hidden="true" />
            {!isStage1Only && execution.confidenceSmoke !== null && (
              <span className="tabular-nums">{Math.round(execution.confidenceSmoke * 100)}%</span>
            )}
          </div>
        )}
        {!execution.hasSmoke && (
          <span className="text-xs text-gray-400">No detections</span>
        )}
      </div>

      {/* Indicators — desktop only */}
      <div className="hidden sm:flex flex-shrink-0 w-8 items-center justify-end">
        {execution.telegramSent && (
          <div className="text-success-600" title="Telegram notification sent">
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
          </div>
        )}
      </div>


{/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center rounded-lg">
          <LoadingSpinner size="sm" />
        </div>
      )}
    </div>
  );
});
