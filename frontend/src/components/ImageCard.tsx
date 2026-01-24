import { useState } from 'react';
import { StatusBadge } from './ui/StatusBadge';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { DynamicTimeAgo } from './ui/DynamicTimeAgo';
import { executionsApi } from '@/services/api';
import { cn } from '@/utils';
import { ImageCardProps, ProcessingStage } from '@/types';
import { AlertTriangle, MessageCircle, Flame, Wind, Camera, MapPin, RefreshCw, X } from 'lucide-react';

export function ImageCard({ execution, onClick, loading = false }: ImageCardProps) {
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

  const handleCardClick = () => {
    if (!loading) {
      onClick(execution);
    }
  };

  return (
    <div
      className={cn(
        'group relative bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer overflow-hidden',
        loading && 'opacity-50 cursor-not-allowed',
        execution.alertLevel === 'critical' && 'ring-2 ring-red-500 ring-offset-2',
        execution.alertLevel === 'high' && 'ring-2 ring-orange-400 ring-offset-1'
      )}
      onClick={handleCardClick}
    >
      {/* Image Section */}
      <div className="aspect-[4/3] relative bg-gradient-to-br from-gray-100 to-gray-200">
        {thumbnailUrl ? (
          <>
            {imageLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <LoadingSpinner size="md" color="gray" />
              </div>
            )}
            {imageError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                <AlertTriangle className="h-8 w-8 mb-2" />
                <span className="text-xs">Failed to load</span>
              </div>
            ) : (
              <img
                src={thumbnailUrl}
                alt={`Execution ${execution.id}`}
                className={cn(
                  'absolute inset-0 w-full h-full object-cover transition-all duration-300',
                  imageLoading ? 'opacity-0' : 'opacity-100',
                  'group-hover:scale-105'
                )}
                onLoad={handleImageLoad}
                onError={handleImageError}
                loading="lazy"
              />
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
            {isStage1Only ? (
              <>
                <RefreshCw className="h-8 w-8 mb-2 animate-spin text-blue-500" />
                <span className="text-xs text-blue-600">Processing...</span>
              </>
            ) : hasStage2Error ? (
              <>
                <X className="h-8 w-8 mb-2 text-red-400" />
                <span className="text-xs text-red-500">Failed</span>
              </>
            ) : (
              <>
                <Camera className="h-8 w-8 mb-2 opacity-50" />
                <span className="text-xs">No image</span>
              </>
            )}
          </div>
        )}

        {/* Top overlay gradient */}
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />

        {/* Bottom overlay gradient */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

        {/* Alert Level Badge - Top Left */}
        {execution.alertLevel && execution.alertLevel !== 'none' && (
          <div
            className={cn(
              "absolute top-2 left-2 px-2.5 py-1 rounded-full text-xs font-bold text-white uppercase tracking-wide shadow-lg",
              execution.alertLevel === 'critical' && 'bg-red-600 animate-pulse',
              execution.alertLevel === 'high' && 'bg-orange-500',
              execution.alertLevel === 'medium' && 'bg-amber-500',
              execution.alertLevel === 'low' && 'bg-blue-500'
            )}
          >
            {execution.alertLevel}
          </div>
        )}

        {/* Status Badge - Top Right */}
        <div className="absolute top-2 right-2">
          <StatusBadge status={execution.status} size="sm" />
        </div>

        {/* Bottom Left - Detection Icons */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
          {execution.hasFire && (
            <div
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-full text-white text-xs font-medium shadow-lg backdrop-blur-sm",
                isStage1Only ? "bg-gray-500/80" : "bg-red-600/90"
              )}
              title={isStage1Only ? "Fire detection pending" : `Fire: ${execution.confidenceFire ? Math.round(execution.confidenceFire * 100) + '%' : 'detected'}`}
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
                "flex items-center gap-1 px-2 py-1 rounded-full text-white text-xs font-medium shadow-lg backdrop-blur-sm",
                isStage1Only ? "bg-gray-500/80" : "bg-slate-600/90"
              )}
              title={isStage1Only ? "Smoke detection pending" : `Smoke: ${execution.confidenceSmoke ? Math.round(execution.confidenceSmoke * 100) + '%' : 'detected'}`}
            >
              <Wind className="h-3 w-3" />
              {!isStage1Only && execution.confidenceSmoke !== null && (
                <span>{Math.round(execution.confidenceSmoke * 100)}%</span>
              )}
            </div>
          )}
        </div>

        {/* Bottom Right - Indicators */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
          {execution.telegramSent && (
            <div
              className="bg-emerald-500/90 text-white rounded-full p-1.5 shadow-lg backdrop-blur-sm"
              title="Telegram sent"
            >
              <MessageCircle className="h-3 w-3" />
            </div>
          )}
          {isStage1Only && (
            <div className="bg-blue-500/90 text-white rounded-full p-1.5 shadow-lg backdrop-blur-sm animate-pulse">
              <RefreshCw className="h-3 w-3 animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* Content Section - Compact */}
      <div className="p-3">
        {/* Top row: ID and Time */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-mono text-sm font-semibold text-gray-800">
            #{String(execution.id).padStart(6, '0')}
          </span>
          <span className="text-xs text-gray-500">
            <DynamicTimeAgo date={execution.executionTimestamp} />
          </span>
        </div>

        {/* Bottom row: Camera and Location */}
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {execution.cameraId && (
            <div className="flex items-center truncate" title={`Camera: ${execution.cameraId}`}>
              <Camera className="h-3 w-3 mr-1 flex-shrink-0 text-gray-400" />
              <span className="truncate">{execution.cameraId}</span>
            </div>
          )}
          {execution.location && (
            <div className="flex items-center truncate" title={`Location: ${execution.location}`}>
              <MapPin className="h-3 w-3 mr-1 flex-shrink-0 text-gray-400" />
              <span className="truncate">{execution.location}</span>
            </div>
          )}
          {!execution.cameraId && !execution.location && (
            <span className="text-gray-400 italic">No location data</span>
          )}
        </div>

        {/* Detection count badge - only if detections exist */}
        {execution.detectionCount > 0 && !isStage1Only && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <span className="text-xs text-gray-600">
              {execution.detectionCount} detection{execution.detectionCount > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center">
          <LoadingSpinner size="md" />
        </div>
      )}
    </div>
  );
}
