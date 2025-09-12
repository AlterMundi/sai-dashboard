import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { StatusBadge } from './ui/StatusBadge';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { executionsApi } from '@/services/api';
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
  Calendar,
  Clock,
  MessageCircle,
  AlertTriangle,
  CheckCircle,
  Zap,
  Eye,
  Share2,
  Flame,
  Wind,
  Thermometer,
  MapPin,
  Camera,
  Sun,
  Moon,
  Droplets,
} from 'lucide-react';
import toast from 'react-hot-toast';

export function ImageModal({ execution, isOpen, onClose }: ImageModalProps) {
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [fullSize, setFullSize] = useState(false);

  // Reset image state when execution changes
  useEffect(() => {
    if (execution) {
      setImageLoading(true);
      setImageError(false);
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

  if (!isOpen || !execution) return null;

  const imageUrl = execution.imageUrl 
    ? executionsApi.getImageUrl(execution.id, false)
    : undefined;

  const duration = execution.durationMs 
    ? Math.round(execution.durationMs / 1000)
    : null;

  const handleImageLoad = () => {
    setImageLoading(false);
    setImageError(false);
  };

  const handleImageError = () => {
    setImageLoading(false);
    setImageError(true);
  };

  const handleCopyId = async () => {
    const success = await copyToClipboard(execution.id);
    if (success) {
      toast.success('Execution ID copied to clipboard');
    } else {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `sai-execution-${execution.id}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `SAI Execution ${execution.id}`,
          text: execution.overallAssessment || 'SAI image analysis result',
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
            {/* Action buttons */}
            <button
              onClick={handleCopyId}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
              title="Copy execution ID"
            >
              <Copy className="h-4 w-4" />
            </button>
            
            <button
              onClick={handleShare}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
              title="Share"
            >
              <Share2 className="h-4 w-4" />
            </button>
            
            {imageUrl && (
              <button
                onClick={handleDownload}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
                title="Download image"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
            
            <button
              onClick={onClose}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col lg:flex-row max-h-[80vh]">
          {/* Image Section */}
          <div className="flex-1 relative bg-gray-100 min-h-[300px] lg:min-h-[500px]">
            {imageUrl ? (
              <>
                {imageLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <LoadingSpinner size="xl" color="gray" />
                  </div>
                )}
                {imageError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                    <AlertTriangle className="h-16 w-16 mb-4" />
                    <p className="text-lg">Failed to load image</p>
                    <p className="text-sm mt-2">The image may be corrupted or unavailable</p>
                  </div>
                ) : (
                  <img
                    src={imageUrl}
                    alt={`Execution ${execution.id}`}
                    className={cn(
                      'w-full h-full object-contain cursor-zoom-in transition-opacity duration-200',
                      imageLoading ? 'opacity-0' : 'opacity-100',
                      fullSize && 'cursor-zoom-out object-cover'
                    )}
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                    onClick={() => setFullSize(!fullSize)}
                  />
                )}
                
                {/* Full size toggle button */}
                {!imageLoading && !imageError && (
                  <button
                    onClick={() => setFullSize(!fullSize)}
                    className="absolute top-4 right-4 p-2 bg-black bg-opacity-50 text-white rounded-lg hover:bg-opacity-70 transition-all"
                    title={fullSize ? 'Fit to container' : 'View full size'}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                )}
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                <AlertTriangle className="h-16 w-16 mb-4" />
                <p className="text-lg">No image available</p>
                <p className="text-sm mt-2">This execution does not have an associated image</p>
              </div>
            )}
          </div>

          {/* Details Panel */}
          <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-gray-200 bg-white overflow-y-auto">
            <div className="p-6 space-y-6">
              {/* Basic Info */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                  Execution Info
                </h3>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center">
                    <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                    <div>
                      <p className="text-gray-500">Started</p>
                      <p className="font-medium">{formatDate(execution.executionTimestamp, 'MMM d, HH:mm')}</p>
                      <p className="text-xs text-gray-400"><DynamicTimeAgo date={execution.executionTimestamp} /></p>
                    </div>
                  </div>
                  
                  {duration && (
                    <div className="flex items-center">
                      <Clock className="h-4 w-4 text-gray-400 mr-2" />
                      <div>
                        <p className="text-gray-500">Duration</p>
                        <p className="font-medium">{formatDuration(duration)}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Mode</p>
                    <p className="font-medium capitalize flex items-center">
                      <Zap className="h-3 w-3 mr-1" />
                      {execution.mode}
                    </p>
                  </div>
                  
                  <div>
                    <p className="text-gray-500">Status</p>
                    <div className="flex items-center mt-1">
                      {execution.status === 'success' && <CheckCircle className="h-4 w-4 text-success-600 mr-1" />}
                      {execution.status === 'error' && <AlertTriangle className="h-4 w-4 text-danger-600 mr-1" />}
                      <span className="font-medium capitalize">{execution.status}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Risk Assessment */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                  Risk Assessment
                </h3>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Risk Level</p>
                    <div className={cn(
                      "px-2 py-1 rounded text-sm font-medium text-center",
                      execution.riskLevel === 'high' && 'bg-red-100 text-red-700',
                      execution.riskLevel === 'medium' && 'bg-orange-100 text-orange-700', 
                      execution.riskLevel === 'low' && 'bg-yellow-100 text-yellow-700',
                      execution.riskLevel === 'none' && 'bg-gray-100 text-gray-700'
                    )}>
                      {execution.riskLevel?.toUpperCase() || 'UNKNOWN'}
                    </div>
                  </div>
                  
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500 mb-1">Alert Priority</p>
                    <div className={cn(
                      "px-2 py-1 rounded text-sm font-medium text-center",
                      execution.alertPriority === 'critical' && 'bg-red-100 text-red-700',
                      execution.alertPriority === 'high' && 'bg-orange-100 text-orange-700',
                      execution.alertPriority === 'normal' && 'bg-blue-100 text-blue-700',
                      execution.alertPriority === 'low' && 'bg-gray-100 text-gray-700'
                    )}>
                      {execution.alertPriority?.toUpperCase() || 'NORMAL'}
                    </div>
                  </div>
                </div>

                {execution.responseRequired && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-center">
                      <AlertTriangle className="h-5 w-5 text-red-600 mr-2" />
                      <span className="text-sm font-medium text-red-800">Immediate Response Required</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Detection Results */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                  Detection Results
                </h3>
                
                <div className="space-y-2">
                  <div className={cn(
                    "flex items-center justify-between p-3 rounded-lg border",
                    execution.smokeDetected ? 'bg-gray-50 border-gray-300' : 'bg-gray-25 border-gray-200'
                  )}>
                    <div className="flex items-center">
                      <Wind className={cn("h-4 w-4 mr-2", execution.smokeDetected ? 'text-gray-600' : 'text-gray-400')} />
                      <span className="text-sm">Smoke Detection</span>
                    </div>
                    <span className={cn(
                      "text-sm font-medium",
                      execution.smokeDetected ? 'text-gray-700' : 'text-gray-500'
                    )}>
                      {execution.smokeDetected ? 'DETECTED' : 'Clear'}
                    </span>
                  </div>
                  
                  <div className={cn(
                    "flex items-center justify-between p-3 rounded-lg border",
                    execution.flameDetected ? 'bg-red-50 border-red-300' : 'bg-gray-25 border-gray-200'
                  )}>
                    <div className="flex items-center">
                      <Flame className={cn("h-4 w-4 mr-2", execution.flameDetected ? 'text-red-600' : 'text-gray-400')} />
                      <span className="text-sm">Flame Detection</span>
                    </div>
                    <span className={cn(
                      "text-sm font-medium",
                      execution.flameDetected ? 'text-red-700' : 'text-gray-500'
                    )}>
                      {execution.flameDetected ? 'DETECTED' : 'Clear'}
                    </span>
                  </div>
                  
                  <div className={cn(
                    "flex items-center justify-between p-3 rounded-lg border",
                    execution.heatSignatureDetected ? 'bg-orange-50 border-orange-300' : 'bg-gray-25 border-gray-200'
                  )}>
                    <div className="flex items-center">
                      <Thermometer className={cn("h-4 w-4 mr-2", execution.heatSignatureDetected ? 'text-orange-600' : 'text-gray-400')} />
                      <span className="text-sm">Heat Signature</span>
                    </div>
                    <span className={cn(
                      "text-sm font-medium",
                      execution.heatSignatureDetected ? 'text-orange-700' : 'text-gray-500'
                    )}>
                      {execution.heatSignatureDetected ? 'DETECTED' : 'Clear'}
                    </span>
                  </div>
                </div>
              </div>

              {/* AI Analysis Results */}
              {execution.overallAssessment && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                    AI Analysis
                  </h3>
                  
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">Assessment</p>
                        <p className="text-gray-900 leading-relaxed">
                          {execution.overallAssessment}
                        </p>
                      </div>
                      
                      {execution.confidenceScore && (
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-600">Confidence</span>
                            <span className="font-medium">
                              {Math.round(execution.confidenceScore * 100)}%
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className={cn(
                                'h-2 rounded-full transition-all duration-500',
                                execution.confidenceScore > 0.8 ? 'bg-success-500' :
                                execution.confidenceScore > 0.6 ? 'bg-warning-500' : 'bg-danger-500'
                              )}
                              style={{ width: `${execution.confidenceScore * 100}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {(execution as any).modelVersion && (
                        <div>
                          <p className="text-xs text-gray-500">Model Version: {(execution as any).modelVersion}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Telegram Status */}
              {execution.telegramSent && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                    Notifications
                  </h3>
                  
                  <div className="flex items-center p-3 bg-success-50 border border-success-200 rounded-lg">
                    <MessageCircle className="h-5 w-5 text-success-600 mr-3" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-success-800">
                        Telegram notification sent
                      </p>
                      {execution.telegramMessageId && (
                        <p className="text-xs text-success-600 font-mono mt-1">
                          Message ID: {execution.telegramMessageId}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Environmental Conditions */}
              {((execution as any).temperatureCelsius !== undefined || (execution as any).humidityPercent !== undefined || (execution as any).windSpeedKmh !== undefined || (execution as any).isDaylight !== undefined || (execution as any).weatherConditions) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                    Environmental Conditions
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-3">
                    {(execution as any).temperatureCelsius !== undefined && (
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <div className="flex items-center">
                          <Thermometer className="h-4 w-4 text-blue-600 mr-2" />
                          <div>
                            <p className="text-xs text-gray-500">Temperature</p>
                            <p className="text-sm font-medium text-gray-900">{(execution as any).temperatureCelsius}°C</p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {(execution as any).humidityPercent !== undefined && (
                      <div className="p-3 bg-teal-50 rounded-lg">
                        <div className="flex items-center">
                          <Droplets className="h-4 w-4 text-teal-600 mr-2" />
                          <div>
                            <p className="text-xs text-gray-500">Humidity</p>
                            <p className="text-sm font-medium text-gray-900">{(execution as any).humidityPercent}%</p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {(execution as any).windSpeedKmh !== undefined && (
                      <div className="p-3 bg-green-50 rounded-lg">
                        <div className="flex items-center">
                          <Wind className="h-4 w-4 text-green-600 mr-2" />
                          <div>
                            <p className="text-xs text-gray-500">Wind Speed</p>
                            <p className="text-sm font-medium text-gray-900">{(execution as any).windSpeedKmh} km/h</p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {(execution as any).isDaylight !== undefined && (
                      <div className="p-3 bg-yellow-50 rounded-lg">
                        <div className="flex items-center">
                          {(execution as any).isDaylight ? (
                            <Sun className="h-4 w-4 text-yellow-600 mr-2" />
                          ) : (
                            <Moon className="h-4 w-4 text-indigo-600 mr-2" />
                          )}
                          <div>
                            <p className="text-xs text-gray-500">Time of Day</p>
                            <p className="text-sm font-medium text-gray-900">
                              {(execution as any).isDaylight ? 'Daylight' : 'Nighttime'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {(execution as any).weatherConditions && (
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Weather Conditions</p>
                      <p className="text-sm text-gray-900">{(execution as any).weatherConditions}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Location Information */}
              {(execution.cameraId || execution.nodeId || (execution as any).latitude !== undefined || (execution as any).fireZoneRisk) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                    Location Information
                  </h3>
                  
                  <div className="space-y-2">
                    {execution.cameraId && (
                      <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                        <div className="flex items-center">
                          <Camera className="h-4 w-4 text-blue-600 mr-2" />
                          <span className="text-sm text-gray-700">Camera ID</span>
                        </div>
                        <code className="font-mono text-sm bg-white px-2 py-1 rounded border">
                          {execution.cameraId}
                        </code>
                      </div>
                    )}
                    
                    {execution.nodeId && (
                      <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                        <div className="flex items-center">
                          <MapPin className="h-4 w-4 text-green-600 mr-2" />
                          <span className="text-sm text-gray-700">Node ID</span>
                        </div>
                        <code className="font-mono text-sm bg-white px-2 py-1 rounded border">
                          {execution.nodeId}
                        </code>
                      </div>
                    )}
                    
                    {((execution as any).latitude !== undefined && (execution as any).longitude !== undefined) && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-500 mb-1">GPS Coordinates</p>
                        <p className="text-sm font-mono text-gray-900">
                          {(execution as any).latitude.toFixed(6)}, {(execution as any).longitude.toFixed(6)}
                        </p>
                      </div>
                    )}
                    
                    {(execution as any).fireZoneRisk && (
                      <div className="p-3 bg-orange-50 rounded-lg">
                        <p className="text-xs text-gray-500 mb-1">Fire Zone Risk</p>
                        <p className="text-sm text-gray-900">{(execution as any).fireZoneRisk}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Image Information */}
              {(execution.imageSizeBytes || execution.imageFormat || (execution as any).imageWidth) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                    Image Details
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {execution.imageFormat && (
                      <div>
                        <p className="text-gray-500">Format</p>
                        <p className="font-medium uppercase">{execution.imageFormat}</p>
                      </div>
                    )}
                    
                    {execution.imageSizeBytes && (
                      <div>
                        <p className="text-gray-500">File Size</p>
                        <p className="font-medium">{(execution.imageSizeBytes / 1024).toFixed(1)} KB</p>
                      </div>
                    )}
                    
                    {((execution as any).imageWidth && (execution as any).imageHeight) && (
                      <div>
                        <p className="text-gray-500">Dimensions</p>
                        <p className="font-medium">{(execution as any).imageWidth} × {(execution as any).imageHeight}</p>
                      </div>
                    )}
                    
                    {(execution as any).imageQualityScore && (
                      <div>
                        <p className="text-gray-500">Quality Score</p>
                        <p className="font-medium">{Math.round((execution as any).imageQualityScore * 100)}%</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Technical Details */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                  Technical Details
                </h3>
                
                <div className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Execution ID</span>
                    <code className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                      {execution.id}
                    </code>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-gray-500">Workflow ID</span>
                    <code className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                      {execution.workflowId}
                    </code>
                  </div>

                  {(execution as any).processingTimeMs && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Processing Time</span>
                      <span className="font-medium">{(execution as any).processingTimeMs}ms</span>
                    </div>
                  )}

                  {(execution as any).extractedAt && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Data Extracted</span>
                      <span className="font-medium">{formatDate((execution as any).extractedAt, 'MMM d, HH:mm')}</span>
                    </div>
                  )}

                  {(execution as any).incidentId && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Incident ID</span>
                      <code className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                        {(execution as any).incidentId}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}