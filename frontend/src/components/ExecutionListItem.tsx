import { useState } from 'react';
import { StatusBadge } from './ui/StatusBadge';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { DynamicTimeAgo } from './ui/DynamicTimeAgo';
import { executionsApi } from '@/services/api';
import { cn } from '@/utils';
import { ExecutionWithImageUrls, ProcessingStage } from '@/types';
import {
  AlertTriangle,
  Flame,
  Wind,
  Camera,
  MapPin,
  MessageCircle,
  RefreshCw,
  X,
  Eye
} from 'lucide-react';

interface ExecutionListItemProps {
  execution: ExecutionWithImageUrls;
  onClick: (execution: ExecutionWithImageUrls) => void;
  loading?: boolean;
}

export function ExecutionListItem({ execution, onClick, loading = false }: ExecutionListItemProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  const processingStage = (execution as any).processingStage as ProcessingStage | undefined;
  const isStage1Only = processingStage === 'stage1';
  const hasStage2Error = processingStage === 'failed';

  const thumbnailUrl = execution.hasImage && !isStage1Only
    ? executionsApi.getImageUrl(execution.id, true)
    : undefined;

  const handleImageLoad = () => {
    setImageLoading(false);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageLoading(false);
    setImageError(true);
  };

  const handleClick = () => {
    if (!loading) {
      onClick(execution);
    }
  };

  const alertLevelColors: Record<string, string> = {
    critical: 'bg-red-600 text-white',
    high: 'bg-orange-500 text-white',
    medium: 'bg-yellow-500 text-gray-900',
    low: 'bg-blue-500 text-white',
    none: 'bg-gray-200 text-gray-600',
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-4 p-3 bg-white rounded-lg border border-gray-200 hover:border-primary-300 hover:shadow-md transition-all cursor-pointer',
        loading && 'opacity-50 cursor-not-allowed',
        execution.alertLevel === 'critical' && 'border-l-4 border-l-red-500',
        execution.alertLevel === 'high' && 'border-l-4 border-l-orange-500'
      )}
      onClick={handleClick}
    >
      {/* Thumbnail */}
      <div className="flex-shrink-0 w-16 h-16 rounded-md overflow-hidden bg-gray-100 relative">
        {thumbnailUrl ? (
          <>
            {imageLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <LoadingSpinner size="sm" color="gray" />
              </div>
            )}
            {imageError ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
            ) : (
              <img
                src={thumbnailUrl}
                alt={`Execution ${execution.id}`}
                className={cn(
                  'w-full h-full object-cover',
                  imageLoading ? 'opacity-0' : 'opacity-100'
                )}
                onLoad={handleImageLoad}
                onError={handleImageError}
                loading="lazy"
              />
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            {isStage1Only ? (
              <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />
            ) : hasStage2Error ? (
              <X className="h-5 w-5 text-red-500" />
            ) : (
              <Camera className="h-5 w-5" />
            )}
          </div>
        )}
      </div>

      {/* ID & Time */}
      <div className="flex-shrink-0 w-32">
        <div className="font-mono text-sm font-medium text-gray-900">
          #{String(execution.id).padStart(6, '0')}
        </div>
        <div className="text-xs text-gray-500">
          <DynamicTimeAgo date={execution.executionTimestamp} />
        </div>
      </div>

      {/* Camera & Location */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 text-sm">
          {execution.cameraId && (
            <div className="flex items-center text-gray-700" title={`Camera: ${execution.cameraId}`}>
              <Camera className="h-4 w-4 mr-1 text-gray-400" />
              <span className="truncate max-w-[120px]">{execution.cameraId}</span>
            </div>
          )}
          {execution.location && (
            <div className="flex items-center text-gray-600" title={`Location: ${execution.location}`}>
              <MapPin className="h-4 w-4 mr-1 text-gray-400" />
              <span className="truncate max-w-[120px]">{execution.location}</span>
            </div>
          )}
        </div>
        {isStage1Only && (
          <div className="text-xs text-blue-600 flex items-center mt-1">
            <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
            Processing...
          </div>
        )}
        {hasStage2Error && (
          <div className="text-xs text-red-600 flex items-center mt-1">
            <X className="h-3 w-3 mr-1" />
            Analysis failed
          </div>
        )}
      </div>

      {/* Alert Level */}
      <div className="flex-shrink-0 w-20">
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

      {/* Detection Indicators */}
      <div className="flex-shrink-0 w-24 flex items-center gap-2">
        {execution.hasFire && (
          <div
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
              isStage1Only ? 'bg-gray-100 text-gray-500' : 'bg-red-100 text-red-700'
            )}
            title={isStage1Only ? "Fire detection pending" : "Fire detected"}
          >
            <Flame className="h-3 w-3" />
            {!isStage1Only && execution.confidenceFire !== null && (
              <span>{Math.round(execution.confidenceFire * 100)}%</span>
            )}
          </div>
        )}
        {execution.hasSmoke && (
          <div
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
              isStage1Only ? 'bg-gray-100 text-gray-500' : 'bg-gray-200 text-gray-700'
            )}
            title={isStage1Only ? "Smoke detection pending" : "Smoke detected"}
          >
            <Wind className="h-3 w-3" />
            {!isStage1Only && execution.confidenceSmoke !== null && (
              <span>{Math.round(execution.confidenceSmoke * 100)}%</span>
            )}
          </div>
        )}
        {!execution.hasFire && !execution.hasSmoke && (
          <span className="text-xs text-gray-400">No detections</span>
        )}
      </div>

      {/* Detection Count */}
      <div className="flex-shrink-0 w-16 text-center">
        {execution.detectionCount > 0 && !isStage1Only ? (
          <span className="inline-block bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs font-medium">
            {execution.detectionCount} det.
          </span>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        )}
      </div>

      {/* Status & Indicators */}
      <div className="flex-shrink-0 w-24 flex items-center justify-end gap-2">
        {execution.telegramSent && (
          <div
            className="text-success-600"
            title="Telegram notification sent"
          >
            <MessageCircle className="h-4 w-4" />
          </div>
        )}
        <StatusBadge status={execution.status} size="sm" />
      </div>

      {/* View Button */}
      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
          title="View details"
        >
          <Eye className="h-4 w-4" />
        </button>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center rounded-lg">
          <LoadingSpinner size="sm" />
        </div>
      )}
    </div>
  );
}
