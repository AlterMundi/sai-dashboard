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
} from 'lucide-react';
import toast from 'react-hot-toast';

export function ImageModal({ execution, isOpen, onClose, onUpdate }: ImageModalProps) {
  const [fullSize, setFullSize] = useState(false);
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

  // Reset fullSize when execution changes
  useEffect(() => {
    if (execution) {
      setFullSize(false);
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
      toast.success(newValue ? 'Marked as false positive' : 'Marked as valid detection');

      // Notify parent component if callback provided
      if (onUpdate) {
        onUpdate(updatedExecution);
      }
    } catch (error) {
      toast.error('Failed to update false positive status');
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
      toast.success('Image downloaded');
    } catch (error) {
      toast.error('Failed to download image');
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
      toast.success('Execution ID copied to clipboard');
    } else {
      toast.error('Failed to copy to clipboard');
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
        toast.success('URL copied to clipboard');
      } else {
        toast.error('Failed to copy URL');
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
                Execution Details
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
              title="Copy ID"
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
                title="Download Image"
              >
                <Download className={cn("h-5 w-5", downloading && "animate-pulse")} />
              </button>
            )}
            <button
              onClick={handleShare}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title="Share"
            >
              <MessageCircle className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title="Close (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col lg:flex-row max-h-[calc(100vh-8rem)] overflow-hidden">
          {/* Image Section */}
          <div className="flex-1 bg-gray-900 flex flex-col">
            {/* Bounding Box Toggle */}
            {execution.detections && execution.detections.length > 0 && !imageLoading && !imageError && imageUrl && (
              <div className="flex justify-center p-2 bg-gray-800">
                <BoundingBoxToggle
                  visible={showBoundingBoxes}
                  onToggle={setShowBoundingBoxes}
                  detectionCount={execution.detections.length}
                />
              </div>
            )}

            {/* Image with Bounding Boxes */}
            <div className={cn(
              "flex-1 p-4 relative min-h-0",
              fullSize ? "overflow-auto" : "flex items-center justify-center"
            )}>
              {secureImageUrl ? (
                <>
                  {imageLoading && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <LoadingSpinner size="lg" color="white" />
                    </div>
                  )}
                  {imageError ? (
                    <div className="flex flex-col items-center text-gray-400">
                      <AlertTriangle className="h-16 w-16 mb-4" />
                      <p className="text-lg">Failed to load image</p>
                    </div>
                  ) : imageUrl ? (
                    <div className={cn(
                      "relative",
                      fullSize ? "w-fit" : "inline-block max-w-full max-h-full"
                    )}>
                      <img
                        src={imageUrl}
                        alt={`Execution ${execution.id}`}
                        className={cn(
                          'transition-opacity duration-200',
                          fullSize
                            ? 'max-w-none cursor-zoom-out'
                            : 'max-w-full max-h-full object-contain cursor-zoom-in'
                        )}
                        onClick={() => setFullSize(!fullSize)}
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
                  <p className="text-lg">No image available</p>
                </div>
              )}
            </div>
          </div>

          {/* Details Sidebar */}
          <div className="w-full lg:w-96 bg-white overflow-y-auto">
            <div className="p-6 space-y-6">
              {/* Execution Metadata */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                  Execution Info
                </h3>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500">Started</p>
                    <p className="font-medium mt-1">
                      <DynamicTimeAgo date={execution.executionTimestamp} />
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatDate(execution.executionTimestamp)}
                    </p>
                  </div>

                  {duration && (
                    <div>
                      <p className="text-gray-500">Duration</p>
                      <div className="flex items-center mt-1">
                        <Clock className="h-4 w-4 text-gray-400 mr-1" />
                        <span className="font-medium">{formatDuration(duration)}</span>
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-gray-500">Status</p>
                    <div className="flex items-center mt-1">
                      {execution.status === 'success' && <CheckCircle className="h-4 w-4 text-success-600 mr-1" />}
                      {execution.status === 'error' && <AlertTriangle className="h-4 w-4 text-danger-600 mr-1" />}
                      <span className="font-medium capitalize">{execution.status}</span>
                    </div>
                  </div>

                  <div>
                    <p className="text-gray-500">Mode</p>
                    <p className="font-medium mt-1 capitalize">{execution.mode}</p>
                  </div>
                </div>
              </div>

              {/* YOLO Analysis Results */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                  YOLO Analysis
                </h3>

                {/* Alert Level */}
                {execution.alertLevel && (
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-2">Alert Level</p>
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
                        {execution.hasFire ? 'Detected' : 'Clear'}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-700">Fire</p>
                    {execution.confidenceFire !== null && execution.confidenceFire > 0 && (
                      <p className="text-xs text-gray-600 mt-1">
                        {Math.round(execution.confidenceFire * 100)}% confidence
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
                        {execution.hasSmoke ? 'Detected' : 'Clear'}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-700">Smoke</p>
                    {execution.confidenceSmoke !== null && execution.confidenceSmoke > 0 && (
                      <p className="text-xs text-gray-600 mt-1">
                        {Math.round(execution.confidenceSmoke * 100)}% confidence
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
                        Total Detections
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
                          {localIsFalsePositive ? 'False Positive' : 'Valid Detection'}
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
                        'Mark Valid'
                      ) : (
                        'Mark False'
                      )}
                    </button>
                  </div>
                </div>

                {/* YOLO Model Info */}
                {(execution.yoloModelVersion || execution.yoloProcessingTimeMs) && (
                  <div className="space-y-1.5 text-xs text-gray-600">
                    {execution.yoloModelVersion && (
                      <div className="flex items-center justify-between">
                        <span>Model:</span>
                        <span className="font-mono">{execution.yoloModelVersion}</span>
                      </div>
                    )}
                    {execution.yoloProcessingTimeMs && (
                      <div className="flex items-center justify-between">
                        <span>Processing:</span>
                        <span className="font-mono">{execution.yoloProcessingTimeMs}ms</span>
                      </div>
                    )}
                    {execution.requestId && (
                      <div className="flex items-center justify-between">
                        <span>Request ID:</span>
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
                    Device Info
                  </h3>

                  <div className="space-y-2 text-sm">
                    {execution.cameraId && (
                      <div className="flex items-center">
                        <Camera className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-gray-500 mr-2">Camera:</span>
                        <span className="font-mono font-medium">{execution.cameraId}</span>
                      </div>
                    )}
                    {execution.location && (
                      <div className="flex items-center">
                        <MapPin className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-gray-500 mr-2">Location:</span>
                        <span className="font-medium">{execution.location}</span>
                      </div>
                    )}
                    {execution.deviceId && (
                      <div className="flex items-center">
                        <Zap className="h-4 w-4 text-gray-400 mr-2" />
                        <span className="text-gray-500 mr-2">Device:</span>
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
                    Image Info
                  </h3>

                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                    {execution.imageWidth && execution.imageHeight && (
                      <div>
                        <span className="text-gray-500">Dimensions:</span>
                        <p className="font-medium mt-0.5">
                          {execution.imageWidth} × {execution.imageHeight}
                        </p>
                      </div>
                    )}
                    {execution.imageSizeBytes && (
                      <div>
                        <span className="text-gray-500">Size:</span>
                        <p className="font-medium mt-0.5">
                          {(execution.imageSizeBytes / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    )}
                    {execution.imageFormat && (
                      <div>
                        <span className="text-gray-500">Format:</span>
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
                      <p className="text-sm font-medium text-success-900">Telegram Notification Sent</p>
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
