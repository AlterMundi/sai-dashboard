import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { StatusBadge } from './ui/StatusBadge';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { useSecureImage } from './ui/SecureImage';
import { BoundingBoxOverlay, BoundingBoxToggle } from './BoundingBoxOverlay';
import { executionsApi, tokenManager } from '@/services/api';
import {
  formatDate,
  formatDuration,
  copyToClipboard,
  cn
} from '@/utils';
import { useTranslation } from '@/contexts/LanguageContext';
import { DynamicTimeAgo } from './ui/DynamicTimeAgo';
import { ImageModalProps } from '@/types';
import {
  X,
  Download,
  Copy,
  Clock,
  MessageCircle,
  AlertTriangle,
  CheckCircle,
  Flame,
  Wind,
  MapPin,
  Camera,
  Zap,
  Box,
  Flag,
  FlagOff,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import toast from 'react-hot-toast';

export function ImageModal({ execution, isOpen, onClose, onUpdate }: ImageModalProps) {
  const { t } = useTranslation();
  const [zoomLevel, setZoomLevel] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [updatingFalsePositive, setUpdatingFalsePositive] = useState(false);
  const [localIsFalsePositive, setLocalIsFalsePositive] = useState(execution?.isFalsePositive ?? false);

  // Sync local state when execution changes
  useEffect(() => {
    if (execution) {
      setLocalIsFalsePositive(execution.isFalsePositive ?? false);
    }
  }, [execution?.id, execution?.isFalsePositive]);

  // Get secure image URL (without token in query params)
  const secureImageUrl = execution?.hasImage
    ? executionsApi.getImageUrl(execution.id, false)
    : undefined;

  // Use secure image loading - fetches with Authorization header
  const { blobUrl: imageUrl, loading: imageLoading, error: imageError } = useSecureImage(
    isOpen ? secureImageUrl : undefined // Only fetch when modal is open
  );

  // Reset zoom when execution changes
  useEffect(() => {
    if (execution) {
      setZoomLevel(1);
      setNaturalSize(null);
    }
  }, [execution?.id]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  // Handle false positive toggle
  const handleToggleFalsePositive = useCallback(async () => {
    if (!execution) return;

    setUpdatingFalsePositive(true);
    try {
      const newValue = !localIsFalsePositive;
      const updatedExecution = await executionsApi.markFalsePositive(
        execution.id,
        newValue,
        newValue ? 'Manually marked by operator' : undefined
      );

      setLocalIsFalsePositive(newValue);
      toast.success(newValue ? t('modal.markedFalsePositive') : t('modal.markedValidDetection'));

      // Notify parent component if callback provided
      if (onUpdate) {
        onUpdate(updatedExecution);
      }
    } catch (error) {
      toast.error(t('modal.updateFailed'));
      console.error('False positive toggle error:', error);
    } finally {
      setUpdatingFalsePositive(false);
    }
  }, [execution, localIsFalsePositive, onUpdate]);

  // Secure download - fetches with Authorization header
  // NOTE: Must be defined before early return to avoid hooks order issue
  const handleDownload = useCallback(async () => {
    if (!secureImageUrl || !execution) return;

    setDownloading(true);
    try {
      const token = tokenManager.get();
      const response = await fetch(secureImageUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sai-execution-${execution.id}.webp`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(t('modal.imageDownloaded'));
    } catch (error) {
      toast.error(t('modal.imageDownloadFailed'));
    } finally {
      setDownloading(false);
    }
  }, [secureImageUrl, execution]);

  if (!isOpen || !execution) return null;

  const duration = execution.durationMs
    ? Math.round(execution.durationMs / 1000)
    : null;

  const handleCopyId = async () => {
    const success = await copyToClipboard(String(execution.id));
    if (success) {
      toast.success(t('modal.idCopied'));
    } else {
      toast.error(t('modal.copyFailed'));
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `SAI Execution ${execution.id}`,
          text: `YOLO Detection - Alert Level: ${execution.alertLevel || 'none'}`,
          url: window.location.href,
        });
      } catch (error) {
        // User cancelled sharing
      }
    } else {
      // Fallback: copy URL to clipboard
      const success = await copyToClipboard(window.location.href);
      if (success) {
        toast.success(t('modal.urlCopied'));
      } else {
        toast.error(t('modal.copyFailed'));
      }
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-75"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-6xl max-h-full bg-white rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center space-x-3">
            <StatusBadge status={execution.status} />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {t('modal.executionDetails')}
              </h2>
              <p className="text-sm text-gray-500 font-mono">
                ID: {execution.id}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopyId}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('modal.copyId')}
            >
              <Copy className="h-5 w-5" />
            </button>
            {secureImageUrl && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className={cn(
                  "p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors",
                  downloading && "opacity-50 cursor-not-allowed"
                )}
                title={t('modal.downloadImage')}
              >
                <Download className={cn("h-5 w-5", downloading && "animate-pulse")} />
              </button>
            )}
            <button
              onClick={handleShare}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('modal.share')}
            >
              <MessageCircle className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('modal.closeEsc')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col lg:flex-row max-h-[calc(100vh-8rem)] overflow-hidden">
          {/* Image Section */}
          <div className="flex-1 bg-gray-900 flex flex-col min-h-0 min-w-0 relative overflow-hidden">
            {/* Bounding Box Toggle */}
            {execution.detections && execution.detections.length > 0 && !imageLoading && !imageError && imageUrl && (
              <div className="flex justify-center p-2 bg-gray-800 shrink-0">
                <BoundingBoxToggle
                  visible={showBoundingBoxes}
                  onToggle={setShowBoundingBoxes}
                  detectionCount={execution.detections.length}
                />
              </div>
            )}

            {/* Scrollable image container */}
            <div className={cn(
              "flex-1 min-h-0 p-4 overflow-auto",
              zoomLevel <= 1 && "flex items-center justify-center"
            )}>
              {secureImageUrl ? (
                <>
                  {imageLoading && (
                    <div className="flex items-center justify-center h-full">
                      <LoadingSpinner size="lg" color="white" />
                    </div>
                  )}
                  {imageError ? (
                    <div className="flex flex-col items-center text-gray-400">
                      <AlertTriangle className="h-16 w-16 mb-4" />
                      <p className="text-lg">{t('modal.failedToLoadImage')}</p>
                    </div>
                  ) : imageUrl ? (
                    <div className="relative inline-block">
                      <img
                        src={imageUrl}
                        alt={`Execution ${execution.id}`}
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                        }}
                        className={cn(
                          zoomLevel <= 1 && 'max-w-full max-h-[calc(100vh-14rem)] object-contain'
                        )}
                        style={zoomLevel > 1 && naturalSize ? {
                          width: naturalSize.w * zoomLevel,
                          maxWidth: 'none',
                          maxHeight: 'none',
                        } : undefined}
                      />
                      <BoundingBoxOverlay
                        detections={execution.detections}
                        imageWidth={execution.imageWidth}
                        imageHeight={execution.imageHeight}
                        visible={showBoundingBoxes}
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="flex flex-col items-center text-gray-400">
                  <AlertTriangle className="h-16 w-16 mb-4" />
                  <p className="text-lg">{t('modal.noImageAvailable')}</p>
                </div>
              )}
            </div>

            {/* Zoom controls - fixed over scrollable area */}
            {imageUrl && !imageError && (
              <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-black/70 rounded-lg p-1 z-10">
                <button
                  onClick={() => setZoomLevel(z => Math.max(z - 0.5, 1))}
                  disabled={zoomLevel <= 1}
                  className="p-1.5 text-white hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="text-white text-xs font-mono px-1.5 min-w-[3ch] text-center">
                  {zoomLevel === 1 ? 'Fit' : `${zoomLevel}x`}
                </span>
                <button
                  onClick={() => setZoomLevel(z => Math.min(z + 0.5, 4))}
                  disabled={zoomLevel >= 4}
                  className="p-1.5 text-white hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {/* Details Sidebar */}
          <div className="w-full lg:w-96 bg-white overflow-y-auto">
            <div className="p-6 space-y-6">
              {/* Execution Metadata */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                  {t('modal.executionInfo')}
                </h3>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500">{t('modal.started')}</p>
                    <p className="font-medium mt-1">
                      <DynamicTimeAgo date={execution.executionTimestamp} />
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatDate(execution.executionTimestamp)}
                    </p>
                  </div>

                  {duration && (
                    <div>
                      <p className="text-gray-500">{t('modal.duration')}</p>
                      <div className="flex items-center mt-1">
                        <Clock className="h-4 w-4 text-gray-400 mr-1" />
                        <span className="font-medium">{formatDuration(duration)}</span>
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-gray-500">{t('modal.statusLabel')}</p>
                    <div className="flex items-center mt-1">
                      {execution.status === 'success' && <CheckCircle className="h-4 w-4 text-success-600 mr-1" />}
                      {execution.status === 'error' && <AlertTriangle className="h-4 w-4 text-danger-600 mr-1" />}
                      <span className="font-medium capitalize">{execution.status}</span>
                    </div>
                  </div>

                  <div>
                    <p className="text-gray-500">{t('modal.mode')}</p>
                    <p className="font-medium mt-1 capitalize">{execution.mode}</p>
                  </div>
                </div>
              </div>

              {/* YOLO Analysis Results */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                  {t('modal.yoloAnalysis')}
                </h3>

                {/* Alert Level */}
                {execution.alertLevel && (
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-2">{t('modal.alertLevelLabel')}</p>
                    <div
                      className={cn(
                        "px-3 py-2 rounded text-sm font-bold text-center uppercase",
                        execution.alertLevel === 'critical' && 'bg-red-600 text-white animate-pulse',
                        execution.alertLevel === 'high' && 'bg-orange-600 text-white',
                        execution.alertLevel === 'medium' && 'bg-yellow-500 text-white',
                        execution.alertLevel === 'low' && 'bg-blue-500 text-white',
                        execution.alertLevel === 'none' && 'bg-gray-200 text-gray-700'
                      )}
                    >
                      {execution.alertLevel}
                    </div>
                  </div>
                )}

                {/* Detection Summary */}
                <div className="grid grid-cols-2 gap-3">
                  <div
                    className={cn(
                      "p-3 rounded-lg border",
                      execution.hasFire ? 'bg-red-50 border-red-300' : 'bg-gray-50 border-gray-200'
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Flame className={cn("h-4 w-4", execution.hasFire ? 'text-red-600' : 'text-gray-400')} />
                      <span className={cn(
                        "text-xs font-bold uppercase",
                        execution.hasFire ? 'text-red-700' : 'text-gray-500'
                      )}>
                        {execution.hasFire ? t('modal.detected') : t('modal.clear')}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-700">{t('modal.fireLabel')}</p>
                    {execution.confidenceFire !== null && execution.confidenceFire > 0 && (
                      <p className="text-xs text-gray-600 mt-1">
                        {t('modal.confidence', { value: String(Math.round(execution.confidenceFire * 100)) })}
                      </p>
                    )}
                  </div>

                  <div
                    className={cn(
                      "p-3 rounded-lg border",
                      execution.hasSmoke ? 'bg-gray-100 border-gray-400' : 'bg-gray-50 border-gray-200'
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <Wind className={cn("h-4 w-4", execution.hasSmoke ? 'text-gray-700' : 'text-gray-400')} />
                      <span className={cn(
                        "text-xs font-bold uppercase",
                        execution.hasSmoke ? 'text-gray-800' : 'text-gray-500'
                      )}>
                        {execution.hasSmoke ? t('modal.detected') : t('modal.clear')}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-700">{t('modal.smokeLabel')}</p>
                    {execution.confidenceSmoke !== null && execution.confidenceSmoke > 0 && (
                      <p className="text-xs text-gray-600 mt-1">
                        {t('modal.confidence', { value: String(Math.round(execution.confidenceSmoke * 100)) })}
                      </p>
                    )}
                  </div>
                </div>

                {/* Detection Count */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <Box className="h-4 w-4 text-blue-600 mr-2" />
                      <span className="text-sm font-medium text-blue-900">
                        {t('modal.totalDetections')}
                      </span>
                    </div>
                    <span className="text-lg font-bold text-blue-700">
                      {execution.detectionCount}
                    </span>
                  </div>
                </div>

                {/* False Positive Status & Toggle */}
                <div className={cn(
                  "p-3 rounded-lg border transition-colors",
                  localIsFalsePositive
                    ? "bg-yellow-50 border-yellow-300"
                    : "bg-gray-50 border-gray-200"
                )}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      {localIsFalsePositive ? (
                        <Flag className="h-4 w-4 text-yellow-600 mr-2" />
                      ) : (
                        <FlagOff className="h-4 w-4 text-gray-400 mr-2" />
                      )}
                      <div>
                        <span className={cn(
                          "text-sm font-medium",
                          localIsFalsePositive ? "text-yellow-800" : "text-gray-700"
                        )}>
                          {localIsFalsePositive ? t('modal.falsePositive') : t('modal.validDetection')}
                        </span>
                        {localIsFalsePositive && execution.falsePositiveReason && (
                          <p className="text-xs text-yellow-700 mt-0.5">
                            {execution.falsePositiveReason}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleToggleFalsePositive}
                      disabled={updatingFalsePositive}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded transition-colors",
                        localIsFalsePositive
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-yellow-100 text-yellow-700 hover:bg-yellow-200",
                        updatingFalsePositive && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {updatingFalsePositive ? (
                        <span className="animate-pulse">...</span>
                      ) : localIsFalsePositive ? (
                        t('modal.markValid')
                      ) : (
                        t('modal.markFalse')
                      )}
                    </button>
                  </div>
                </div>

                {/* YOLO Model Info */}
                {(execution.yoloModelVersion || execution.yoloProcessingTimeMs) && (
                  <div className="space-y-1.5 text-xs text-gray-600">
                    {execution.yoloModelVersion && (
                      <div className="flex items-center justify-between">
                        <span>{t('modal.model')}</span>
                        <span className="font-mono">{execution.yoloModelVersion}</span>
                      </div>
                    )}
                    {execution.yoloProcessingTimeMs && (
                      <div className="flex items-center justify-between">
                        <span>{t('modal.processing')}</span>
                        <span className="font-mono">{execution.yoloProcessingTimeMs}ms</span>
                      </div>
                    )}
                    {execution.requestId && (
                      <div className="flex items-center justify-between">
                        <span>{t('modal.requestId')}</span>
                        <span className="font-mono text-xs">{execution.requestId.slice(0, 8)}...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Device & Camera Info */}
              {(execution.cameraId || execution.deviceId || execution.location) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                    {t('modal.deviceInfo')}
                  </h3>

                  <div className="space-y-2 text-sm">
                    {execution.cameraId && (
                      <div className="flex items-center">
                        <Camera className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-gray-500 mr-2">{t('modal.cameraLabel')}</span>
                        <span className="font-mono font-medium">{execution.cameraId}</span>
                      </div>
                    )}
                    {execution.location && (
                      <div className="flex items-center">
                        <MapPin className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-gray-500 mr-2">{t('modal.locationLabel')}</span>
                        <span className="font-medium">{execution.location}</span>
                      </div>
                    )}
                    {execution.deviceId && (
                      <div className="flex items-center">
                        <Zap className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-gray-500 mr-2">{t('modal.deviceLabel')}</span>
                        <span className="font-mono font-medium text-xs">{execution.deviceId}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Image Metadata */}
              {execution.hasImage && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                    {t('modal.imageInfo')}
                  </h3>

                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                    {execution.imageWidth && execution.imageHeight && (
                      <div>
                        <span className="text-gray-500">{t('modal.dimensions')}</span>
                        <p className="font-medium mt-0.5">
                          {execution.imageWidth} × {execution.imageHeight}
                        </p>
                      </div>
                    )}
                    {execution.imageSizeBytes && (
                      <div>
                        <span className="text-gray-500">{t('modal.size')}</span>
                        <p className="font-medium mt-0.5">
                          {(execution.imageSizeBytes / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    )}
                    {execution.imageFormat && (
                      <div>
                        <span className="text-gray-500">{t('modal.format')}</span>
                        <p className="font-medium mt-0.5 uppercase">{execution.imageFormat}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Notifications */}
              {execution.telegramSent && (
                <div className="p-3 bg-success-50 border border-success-200 rounded-lg">
                  <div className="flex items-center">
                    <MessageCircle className="h-5 w-5 text-success-600 mr-2" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-success-900">{t('modal.telegramNotifSent')}</p>
                      {execution.telegramSentAt && (
                        <p className="text-xs text-success-700 mt-0.5">
                          {formatDate(execution.telegramSentAt)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
