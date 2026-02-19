import { LoadingSpinner } from './ui/LoadingSpinner';
import { cn } from '@/utils';
import { ImageCardProps } from '@/types';
import { useImageCard } from '@/hooks/useImageCard';
import { useTranslation } from '@/contexts/LanguageContext';
import { AlertTriangle, MessageCircle, Flame, Wind, Camera, MapPin, RefreshCw, X } from 'lucide-react';

export function ImageCard({ execution, onClick, loading = false }: ImageCardProps) {
  const { t } = useTranslation();
  const {
    imageLoading,
    imageError,
    isStage1Only,
    hasStage2Error,
    thumbnailUrl,
    handleImageLoad,
    handleImageError,
  } = useImageCard(execution);

  const handleCardClick = () => {
    if (!loading) {
      onClick(execution);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };

  return (
    <div
      className={cn(
        'group relative bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-xl transition-[box-shadow,border-color] duration-300 cursor-pointer overflow-hidden focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 outline-none',
        loading && 'opacity-50 cursor-not-allowed',
        execution.alertLevel === 'critical' && 'ring-2 ring-red-500 ring-offset-2',
        execution.alertLevel === 'high' && 'ring-2 ring-orange-400 ring-offset-1'
      )}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Execution ${execution.id}, status ${execution.status}${execution.alertLevel && execution.alertLevel !== 'none' ? `, alert level ${execution.alertLevel}` : ''}`}
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
                <AlertTriangle className="h-8 w-8 mb-2" aria-hidden="true" />
                <span className="text-xs">{t('imageCard.failedToLoad')}</span>
              </div>
            ) : (
              <img
                src={thumbnailUrl}
                alt={`Execution ${execution.id}`}
                className={cn(
                  'absolute inset-0 w-full h-full object-cover transition-[opacity,transform] duration-300',
                  imageLoading ? 'opacity-0' : 'opacity-100',
                  'group-hover:scale-105'
                )}
                width={400}
                height={300}
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
                <RefreshCw className="h-8 w-8 mb-2 animate-spin text-blue-500" aria-hidden="true" />
                <span className="text-xs text-blue-600">{t('imageCard.processing')}</span>
              </>
            ) : hasStage2Error ? (
              <>
                <X className="h-8 w-8 mb-2 text-red-400" />
                <span className="text-xs text-red-500">{t('imageCard.failed')}</span>
              </>
            ) : (
              <>
                <Camera className="h-8 w-8 mb-2 opacity-50" aria-hidden="true" />
                <span className="text-xs">{t('imageCard.noImage')}</span>
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


        {/* Bottom Left - Detection Icons */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
          {execution.hasFire && (
            <div
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-full text-white text-xs font-medium shadow-lg backdrop-blur-sm",
                isStage1Only ? "bg-gray-500/80" : "bg-red-600/90"
              )}
              title={isStage1Only ? t('imageCard.fireDetectionPending') : t('imageCard.fireConfidence', { value: execution.confidenceFire ? Math.round(execution.confidenceFire * 100) + '%' : t('modal.detected') })}
            >
              <Flame className="h-3 w-3" aria-hidden="true" />
              {!isStage1Only && execution.confidenceFire !== null && (
                <span className="tabular-nums">{Math.round(execution.confidenceFire * 100)}%</span>
              )}
            </div>
          )}
          {execution.hasSmoke && (
            <div
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-full text-white text-xs font-medium shadow-lg backdrop-blur-sm",
                isStage1Only ? "bg-gray-500/80" : "bg-slate-600/90"
              )}
              title={isStage1Only ? t('imageCard.smokeDetectionPending') : t('imageCard.smokeConfidence', { value: execution.confidenceSmoke ? Math.round(execution.confidenceSmoke * 100) + '%' : t('modal.detected') })}
            >
              <Wind className="h-3 w-3" aria-hidden="true" />
              {!isStage1Only && execution.confidenceSmoke !== null && (
                <span className="tabular-nums">{Math.round(execution.confidenceSmoke * 100)}%</span>
              )}
            </div>
          )}
        </div>

        {/* Bottom Right - Indicators */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
          {execution.telegramSent && (
            <div
              className="bg-emerald-500/90 text-white rounded-full p-1.5 shadow-lg backdrop-blur-sm"
              title={t('imageCard.telegramSent')}
              aria-label={t('imageCard.telegramSent')}
            >
              <MessageCircle className="h-3 w-3" aria-hidden="true" />
            </div>
          )}
          {isStage1Only && (
            <div
              className="bg-blue-500/90 text-white rounded-full p-1.5 shadow-lg backdrop-blur-sm animate-pulse"
              aria-label="Processing in progress"
            >
              <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
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
          <span className="text-xs text-gray-500 tabular-nums">
            {new Date(execution.executionTimestamp).toLocaleString('en-GB', {
              day: '2-digit', month: '2-digit',
              hour: '2-digit', minute: '2-digit',
              hour12: false
            })}
          </span>
        </div>

        {/* Bottom row: Camera and Location */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          {execution.cameraId ? (
            <div className="flex items-center min-w-0" title={`Camera: ${execution.cameraId}`}>
              <Camera className="h-3 w-3 mr-1 flex-shrink-0 text-gray-400" aria-hidden="true" />
              <span className="truncate">{execution.cameraId}</span>
            </div>
          ) : (
            <span />
          )}
          {execution.location ? (
            <div className="flex items-center min-w-0 ml-2" title={`Location: ${execution.location}`}>
              <MapPin className="h-3 w-3 mr-1 flex-shrink-0 text-gray-400" aria-hidden="true" />
              <span className="truncate">{execution.location}</span>
            </div>
          ) : !execution.cameraId ? (
            <span className="text-gray-400 italic">{t('imageCard.noLocationData')}</span>
          ) : null}
        </div>

        {/* Detection count badge - only if detections exist */}
        {execution.detectionCount > 0 && !isStage1Only && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <span className="text-xs text-gray-600">
              {t('imageCard.detections', { count: String(execution.detectionCount), s: execution.detectionCount > 1 ? 's' : '' })}
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
