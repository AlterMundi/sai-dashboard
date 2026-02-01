import { useState } from 'react';
import { executionsApi } from '@/services/api';
import { ExecutionWithImageUrls, ProcessingStage } from '@/types';

/**
 * Shared image loading state and URL construction for ImageCard and ExecutionListItem.
 */
export function useImageCard(execution: ExecutionWithImageUrls) {
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

  return {
    imageLoading,
    imageError,
    processingStage,
    isStage1Only,
    hasStage2Error,
    thumbnailUrl,
    handleImageLoad,
    handleImageError,
  };
}

/** Alert level to CSS class mapping */
export const alertLevelColors: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-gray-900',
  low: 'bg-blue-500 text-white',
  none: 'bg-gray-200 text-gray-600',
};

/** Human-readable label for processing stages */
export function getProcessingStageLabel(stage: ProcessingStage | undefined): string {
  switch (stage) {
    case 'stage1': return 'Processing...';
    case 'stage2': return 'Complete';
    case 'failed': return 'Failed';
    default: return 'Unknown';
  }
}
