import { useState } from 'react';
import { StatusBadge } from './ui/StatusBadge';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { executionsApi } from '@/services/api';
import { formatRelativeTime, formatDuration, truncateText, cn } from '@/utils';
import { ImageCardProps } from '@/types';
import { Calendar, Clock, AlertTriangle, CheckCircle, MessageCircle } from 'lucide-react';

export function ImageCard({ execution, onClick, loading = false }: ImageCardProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  const thumbnailUrl = execution.thumbnailUrl 
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
  const duration = execution.stoppedAt 
    ? Math.round((new Date(execution.stoppedAt).getTime() - new Date(execution.startedAt).getTime()) / 1000)
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

        {/* Telegram Delivered Indicator */}
        {execution.telegramDelivered && (
          <div className="absolute top-2 left-2">
            <div className="bg-success-600 text-white rounded-full p-1">
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
            {formatRelativeTime(execution.startedAt)}
          </div>
          {duration && (
            <div className="flex items-center text-xs text-gray-500">
              <Clock className="h-3 w-3 mr-1" />
              {formatDuration(duration)}
            </div>
          )}
        </div>

        {/* Analysis Summary */}
        {execution.analysis && (
          <div className="mb-3">
            <p className="text-sm text-gray-700 leading-relaxed">
              {truncateText(execution.analysis.riskAssessment || execution.analysis.description, 120)}
            </p>
            
            {execution.analysis.confidence && (
              <div className="flex items-center mt-2">
                <span className="text-xs text-gray-500 mr-2">Confidence:</span>
                <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                  <div
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-300',
                      execution.analysis.confidence > 0.8 ? 'bg-success-500' :
                      execution.analysis.confidence > 0.6 ? 'bg-warning-500' : 'bg-danger-500'
                    )}
                    style={{ width: `${execution.analysis.confidence * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-600 ml-2">
                  {Math.round(execution.analysis.confidence * 100)}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="font-mono">
            #{execution.id.slice(-8)}
          </span>
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