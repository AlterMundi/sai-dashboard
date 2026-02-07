import { executionsApi } from '@/services/api';
import { useSecureImage } from '@/components/ui/SecureImage';
import { ExecutionWithImageUrls, ExecutionWithProcessingStage, ProcessingStage } from '@/types';

/**
 * Shared image loading state and URL construction for ImageCard and ExecutionListItem.
 * Uses secure image loading (Authorization header) to prevent token leakage in URLs.
 */
export function useImageCard(execution: ExecutionWithImageUrls) {
  const processingStage = 'processingStage' in execution
    ? (execution as ExecutionWithProcessingStage).processingStage
    : undefined;
  const isStage1Only = processingStage === 'stage1';
  const hasStage2Error = processingStage === 'failed';

  // Get the secure URL (without token in query params)
  const secureUrl = execution.hasImage && !isStage1Only
    ? executionsApi.getImageUrl(execution.id, true)
    : undefined;

  // Use secure image loading - fetches with Authorization header, returns blob URL
  const { blobUrl, loading: imageLoading, error: imageError } = useSecureImage(secureUrl);

  // For compatibility with existing component interface
  const handleImageLoad = () => {
    // No-op: loading state managed by useSecureImage
  };

  const handleImageError = () => {
    // No-op: error state managed by useSecureImage
  };

  return {
    imageLoading,
    imageError,
    processingStage,
    isStage1Only,
    hasStage2Error,
    thumbnailUrl: blobUrl, // Return blob URL instead of token-in-URL
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
    case 'stage1': return 'Processing\u2026';
    case 'stage2': return 'Complete';
    case 'failed': return 'Failed';
    default: return 'Unknown';
  }
}
