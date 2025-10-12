import { useState } from 'react';
import { StatusBadge } from './ui/StatusBadge';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { DynamicTimeAgo } from './ui/DynamicTimeAgo';
import { executionsApi } from '@/services/api';
import { formatDuration, cn } from '@/utils';
import { ImageCardProps } from '@/types';
import { Calendar, Clock, AlertTriangle, CheckCircle, MessageCircle, Flame, Wind, Camera, MapPin } from 'lucide-react';

export function ImageCard({ execution, onClick, loading = false }: ImageCardProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  // Use hasImage from the execution data directly
  const thumbnailUrl = execution.hasImage
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

  // Calculate execution duration
  const duration = execution.durationMs
    ? Math.round(execution.durationMs / 1000)
    : null;

  // Determine if there are any detections
  const hasDetections = execution.detectionCount > 0;

  return (
    <div
      className={cn(
        'group relative bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer overflow-hidden',
        loading && 'opacity-50 cursor-not-allowed',
        execution.status === 'error' && 'border-danger-200 bg-danger-50',
        execution.status === 'success' && 'hover:border-primary-300',
        execution.alertLevel === 'critical' && 'ring-2 ring-red-500',
        execution.alertLevel === 'high' && 'ring-2 ring-orange-500'
      )}
      onClick={handleCardClick}
    >
      {/* Image Section */}
      <div className="aspect-square relative bg-gray-100">
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
                <span className="text-sm">Image failed to load</span>
              </div>
            ) : (
              <img
                src={thumbnailUrl}
                alt={`Execution ${execution.id}`}
                className={cn(
                  'absolute inset-0 w-full h-full object-cover transition-opacity duration-200',
                  imageLoading ? 'opacity-0' : 'opacity-100',
                  'group-hover:scale-105 transition-transform duration-200'
                )}
                onLoad={handleImageLoad}
                onError={handleImageError}
                loading="lazy"
              />
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
            <AlertTriangle className="h-8 w-8 mb-2" />
            <span className="text-sm">No image</span>
          </div>
        )}

        {/* Status Badge Overlay */}
        <div className="absolute top-2 right-2">
          <StatusBadge status={execution.status} size="sm" />
        </div>

        {/* Alert Level Badge */}
        {execution.alertLevel && execution.alertLevel !== 'none' && (
          <div
            className={cn(
              "absolute top-2 left-2 px-2 py-1 rounded text-xs font-bold text-white uppercase",
              execution.alertLevel === 'critical' && 'bg-red-600 animate-pulse',
              execution.alertLevel === 'high' && 'bg-orange-600',
              execution.alertLevel === 'medium' && 'bg-yellow-500',
              execution.alertLevel === 'low' && 'bg-blue-500'
            )}
          >
            {execution.alertLevel}
          </div>
        )}

        {/* Detection Indicators */}
        <div className="absolute bottom-2 left-2 flex space-x-1">
          {execution.hasFire && (
            <div
              className="bg-red-600 bg-opacity-90 text-white rounded-full p-1.5"
              title="Fire detected"
            >
              <Flame className="h-3.5 w-3.5" />
            </div>
          )}
          {execution.hasSmoke && (
            <div
              className="bg-gray-700 bg-opacity-90 text-white rounded-full p-1.5"
              title="Smoke detected"
            >
              <Wind className="h-3.5 w-3.5" />
            </div>
          )}
        </div>

        {/* Telegram Sent Indicator */}
        {execution.telegramSent && (
          <div className="absolute bottom-2 right-2">
            <div
              className="bg-success-600 text-white rounded-full p-1"
              title="Telegram notification sent"
            >
              <MessageCircle className="h-3 w-3" />
            </div>
          </div>
        )}
      </div>

      {/* Content Section */}
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center text-xs text-gray-500">
            <Calendar className="h-3 w-3 mr-1" />
            <DynamicTimeAgo date={execution.executionTimestamp} />
          </div>
          <div className="flex items-center space-x-2">
            {execution.cameraId && (
              <div
                className="flex items-center text-xs text-gray-500"
                title={`Camera: ${execution.cameraId}`}
              >
                <Camera className="h-3 w-3 mr-1" />
                <span className="truncate max-w-[60px]">{execution.cameraId}</span>
              </div>
            )}
            {duration && (
              <div className="flex items-center text-xs text-gray-500">
                <Clock className="h-3 w-3 mr-1" />
                {formatDuration(duration)}
              </div>
            )}
          </div>
        </div>

        {/* Detection Summary */}
        {hasDetections && (
          <div className="mb-3">
            <p className="text-sm text-gray-700 font-medium">
              {execution.hasFire && execution.hasSmoke && 'Fire & Smoke detected'}
              {execution.hasFire && !execution.hasSmoke && 'Fire detected'}
              {!execution.hasFire && execution.hasSmoke && 'Smoke detected'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {execution.detectionCount} detection{execution.detectionCount > 1 ? 's' : ''}
              {execution.yoloModelVersion && ` • ${execution.yoloModelVersion}`}
            </p>
          </div>
        )}

        {/* Confidence Bars */}
        {(execution.confidenceFire !== null || execution.confidenceSmoke !== null) && (
          <div className="mb-3 space-y-1.5">
            {execution.confidenceFire !== null && execution.confidenceFire > 0 && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-600 flex items-center">
                    <Flame className="h-3 w-3 mr-1 text-red-500" />
                    Fire
                  </span>
                  <span className="font-medium text-gray-700">
                    {Math.round(execution.confidenceFire * 100)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-300',
                      execution.confidenceFire > 0.7 ? 'bg-red-600' :
                      execution.confidenceFire > 0.5 ? 'bg-orange-500' : 'bg-yellow-500'
                    )}
                    style={{ width: `${execution.confidenceFire * 100}%` }}
                  />
                </div>
              </div>
            )}
            {execution.confidenceSmoke !== null && execution.confidenceSmoke > 0 && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-600 flex items-center">
                    <Wind className="h-3 w-3 mr-1 text-gray-600" />
                    Smoke
                  </span>
                  <span className="font-medium text-gray-700">
                    {Math.round(execution.confidenceSmoke * 100)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-300',
                      execution.confidenceSmoke > 0.7 ? 'bg-gray-700' :
                      execution.confidenceSmoke > 0.5 ? 'bg-gray-600' : 'bg-gray-500'
                    )}
                    style={{ width: `${execution.confidenceSmoke * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center space-x-2">
            <span className="font-mono">
              #{String(execution.id).padStart(6, '0')}
            </span>
            {execution.location && (
              <div className="flex items-center" title={`Location: ${execution.location}`}>
                <MapPin className="h-3 w-3 mr-1" />
                <span className="truncate max-w-[80px]">{execution.location}</span>
              </div>
            )}
          </div>
          <div className="flex items-center space-x-1">
            {execution.status === 'success' && <CheckCircle className="h-3 w-3 text-success-600" />}
            {execution.status === 'error' && <AlertTriangle className="h-3 w-3 text-danger-600" />}
            <span className="capitalize">{execution.mode}</span>
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center">
          <LoadingSpinner size="md" />
        </div>
      )}

      {/* Hover effect overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/0 via-transparent to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
    </div>
  );
}
