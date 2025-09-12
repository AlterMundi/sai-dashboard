import { useState } from 'react';
import { StatusBadge } from './ui/StatusBadge';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { DynamicTimeAgo } from './ui/DynamicTimeAgo';
import { executionsApi } from '@/services/api';
import { formatDuration, truncateText, cn } from '@/utils';
import { ImageCardProps } from '@/types';
import { Calendar, Clock, AlertTriangle, CheckCircle, MessageCircle, Flame, Wind, Thermometer, MapPin, Camera } from 'lucide-react';

export function ImageCard({ execution, onClick, loading = false }: ImageCardProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  // Use hasImage from the execution data directly
  const thumbnailUrl = (execution as any).hasImage
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

  return (
    <div
      className={cn(
        'group relative bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer overflow-hidden',
        loading && 'opacity-50 cursor-not-allowed',
        execution.status === 'error' && 'border-danger-200 bg-danger-50',
        execution.status === 'success' && 'hover:border-primary-300'
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

        {/* Risk Level Badge */}
        {execution.riskLevel && execution.riskLevel !== 'none' && (
          <div className={cn(
            "absolute top-2 left-2 px-2 py-1 rounded text-xs font-medium text-white",
            execution.riskLevel === 'high' && 'bg-red-600',
            execution.riskLevel === 'medium' && 'bg-orange-500',
            execution.riskLevel === 'low' && 'bg-yellow-500'
          )}>
            {execution.riskLevel.toUpperCase()}
          </div>
        )}

        {/* Detection Indicators */}
        <div className="absolute bottom-2 left-2 flex space-x-1">
          {execution.smokeDetected && (
            <div className="bg-gray-800 bg-opacity-75 text-white rounded-full p-1" title="Smoke detected">
              <Wind className="h-3 w-3" />
            </div>
          )}
          {execution.flameDetected && (
            <div className="bg-red-600 bg-opacity-90 text-white rounded-full p-1" title="Flame detected">
              <Flame className="h-3 w-3" />
            </div>
          )}
          {execution.heatSignatureDetected && (
            <div className="bg-orange-600 bg-opacity-90 text-white rounded-full p-1" title="Heat signature detected">
              <Thermometer className="h-3 w-3" />
            </div>
          )}
        </div>

        {/* Telegram Delivered Indicator */}
        {execution.telegramSent && (
          <div className="absolute bottom-2 right-2">
            <div className="bg-success-600 text-white rounded-full p-1" title="Telegram notification sent">
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
              <div className="flex items-center text-xs text-gray-500" title={`Camera: ${execution.cameraId}`}>
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

        {/* Risk Assessment and Key Info */}
        <div className="mb-3 space-y-2">
          {/* Priority and Response */}
          <div className="flex items-center justify-between">
            {execution.alertPriority && (
              <div className={cn(
                "px-2 py-1 rounded-full text-xs font-medium",
                execution.alertPriority === 'critical' && 'bg-red-100 text-red-700',
                execution.alertPriority === 'high' && 'bg-orange-100 text-orange-700',
                execution.alertPriority === 'normal' && 'bg-blue-100 text-blue-700',
                execution.alertPriority === 'low' && 'bg-gray-100 text-gray-700'
              )}>
                {execution.alertPriority.toUpperCase()} PRIORITY
              </div>
            )}
            {execution.responseRequired && (
              <div className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium animate-pulse">
                RESPONSE REQ'D
              </div>
            )}
          </div>

          {/* Analysis Summary */}
          {execution.overallAssessment && (
            <div>
              <p className="text-sm text-gray-700 leading-relaxed">
                {truncateText(execution.overallAssessment, 100)}
              </p>
            </div>
          )}
          
          {/* Confidence Score */}
          {execution.confidenceScore && (
            <div className="flex items-center">
              <span className="text-xs text-gray-500 mr-2">Confidence:</span>
              <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                <div
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-300',
                    execution.confidenceScore > 0.8 ? 'bg-success-500' :
                    execution.confidenceScore > 0.6 ? 'bg-warning-500' : 'bg-danger-500'
                  )}
                  style={{ width: `${execution.confidenceScore * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-600 ml-2">
                {Math.round(execution.confidenceScore * 100)}%
              </span>
            </div>
          )}

          {/* Environmental Info - Only show if data is available */}
          {((execution as any).temperatureCelsius !== undefined || (execution as any).humidityPercent !== undefined || (execution as any).windSpeedKmh !== undefined || (execution as any).isDaylight !== undefined) && (
            <div className="flex items-center text-xs text-gray-500 space-x-3">
              {(execution as any).temperatureCelsius !== undefined && (
                <span>{(execution as any).temperatureCelsius}°C</span>
              )}
              {(execution as any).humidityPercent !== undefined && (
                <span>{(execution as any).humidityPercent}% humidity</span>
              )}
              {(execution as any).windSpeedKmh !== undefined && (
                <span>{(execution as any).windSpeedKmh} km/h wind</span>
              )}
              {(execution as any).isDaylight !== undefined && (
                <span>{(execution as any).isDaylight ? '☀️ Day' : '🌙 Night'}</span>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center space-x-2">
            <span className="font-mono">
              #{String(execution.id).slice(-8)}
            </span>
            {execution.nodeId && (
              <div className="flex items-center" title={`Node: ${execution.nodeId}`}>
                <MapPin className="h-3 w-3 mr-1" />
                <span className="truncate max-w-[60px]">{execution.nodeId}</span>
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