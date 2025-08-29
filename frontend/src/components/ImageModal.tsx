import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { StatusBadge } from './ui/StatusBadge';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { executionsApi } from '@/services/api';
import { 
  formatDate, 
  formatRelativeTime, 
  formatDuration, 
  copyToClipboard, 
  cn 
} from '@/utils';
import { ImageModalProps } from '@/types';
import {
  X,
  Download,
  ExternalLink,
  Copy,
  Calendar,
  Clock,
  MessageCircle,
  AlertTriangle,
  CheckCircle,
  Zap,
  Eye,
  Share2,
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

  const duration = execution.stoppedAt 
    ? Math.round((new Date(execution.stoppedAt).getTime() - new Date(execution.startedAt).getTime()) / 1000)
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
          text: execution.analysis?.description || 'SAI image analysis result',
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
                      <p className="font-medium">{formatDate(execution.startedAt, 'MMM d, HH:mm')}</p>
                      <p className="text-xs text-gray-400">{formatRelativeTime(execution.startedAt)}</p>
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

              {/* Analysis Results */}
              {execution.analysis && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                    AI Analysis
                  </h3>
                  
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">Risk Assessment</p>
                        <p className="text-gray-900 leading-relaxed">
                          {execution.analysis.riskAssessment || execution.analysis.description}
                        </p>
                      </div>
                      
                      {execution.analysis.confidence && (
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-600">Confidence</span>
                            <span className="font-medium">
                              {Math.round(execution.analysis.confidence * 100)}%
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className={cn(
                                'h-2 rounded-full transition-all duration-500',
                                execution.analysis.confidence > 0.8 ? 'bg-success-500' :
                                execution.analysis.confidence > 0.6 ? 'bg-warning-500' : 'bg-danger-500'
                              )}
                              style={{ width: `${execution.analysis.confidence * 100}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {execution.analysis.recommendations && execution.analysis.recommendations.length > 0 && (
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-2">Recommendations</p>
                          <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                            {execution.analysis.recommendations.map((rec, index) => (
                              <li key={index}>{rec}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Telegram Status */}
              {execution.telegramDelivered && (
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

                  {execution.retryOf && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Retry of</span>
                      <code className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                        {execution.retryOf}
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