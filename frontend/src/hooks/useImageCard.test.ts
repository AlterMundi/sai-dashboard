import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImageCard, alertLevelColors, getProcessingStageLabel } from './useImageCard';
import { createMockYoloExecution, createMockProcessingExecution } from '@/test/mock-factories';

vi.mock('@/services/api', () => ({
  executionsApi: {
    getImageUrl: vi.fn(
      (id: number, thumbnail: boolean) =>
        `/api/executions/${id}/image${thumbnail ? '?thumbnail=true' : ''}`
    ),
  },
}));

// Mock useSecureImage so it doesn't try to fetch with tokenManager.
// Returns blobUrl = the URL passed in (or undefined), loading = false, error = false.
vi.mock('@/components/ui/SecureImage', () => ({
  useSecureImage: vi.fn((url: string | undefined) => ({
    blobUrl: url,
    loading: false,
    error: false,
  })),
}));

describe('useImageCard', () => {
  it('returns thumbnailUrl when execution hasImage and not stage1', () => {
    const execution = createMockYoloExecution();
    const { result } = renderHook(() => useImageCard(execution));

    expect(result.current.thumbnailUrl).toBe(
      '/api/executions/180001/image?thumbnail=true'
    );
  });

  it('returns undefined thumbnailUrl when execution has no image', () => {
    const execution = createMockYoloExecution({ hasImage: false });
    const { result } = renderHook(() => useImageCard(execution));

    expect(result.current.thumbnailUrl).toBeUndefined();
  });

  it('returns undefined thumbnailUrl for stage1-only execution', () => {
    const execution = createMockProcessingExecution('stage1');
    const { result } = renderHook(() => useImageCard(execution));

    expect(result.current.isStage1Only).toBe(true);
    expect(result.current.thumbnailUrl).toBeUndefined();
  });

  it('detects processingStage via type guard without unsafe cast', () => {
    const execution = createMockProcessingExecution('failed');
    const { result } = renderHook(() => useImageCard(execution));

    expect(result.current.hasStage2Error).toBe(true);
    expect(result.current.processingStage).toBe('failed');
  });

  it('handles execution without processingStage field', () => {
    const execution = createMockYoloExecution();
    const { result } = renderHook(() => useImageCard(execution));

    expect(result.current.processingStage).toBeUndefined();
    expect(result.current.isStage1Only).toBe(false);
    expect(result.current.hasStage2Error).toBe(false);
  });

  it('imageLoading and imageError reflect useSecureImage state', () => {
    const execution = createMockYoloExecution();
    const { result } = renderHook(() => useImageCard(execution));

    // loading/error come from useSecureImage (mocked to false/false)
    expect(result.current.imageLoading).toBe(false);
    expect(result.current.imageError).toBe(false);
  });

  it('handleImageLoad is callable (loading state managed by useSecureImage)', () => {
    const execution = createMockYoloExecution();
    const { result } = renderHook(() => useImageCard(execution));

    // No-op: does not throw and does not change state
    act(() => result.current.handleImageLoad());

    expect(result.current.imageLoading).toBe(false);
    expect(result.current.imageError).toBe(false);
  });

  it('handleImageError is callable (error state managed by useSecureImage)', () => {
    const execution = createMockYoloExecution();
    const { result } = renderHook(() => useImageCard(execution));

    // No-op: does not throw and does not change state
    act(() => result.current.handleImageError());

    expect(result.current.imageLoading).toBe(false);
  });

  it('returns thumbnailUrl for completed stage2 execution', () => {
    const execution = createMockProcessingExecution('stage2');
    const { result } = renderHook(() => useImageCard(execution));

    expect(result.current.isStage1Only).toBe(false);
    expect(result.current.thumbnailUrl).toBeDefined();
  });
});

describe('alertLevelColors', () => {
  it('maps all five alert levels to CSS classes', () => {
    expect(alertLevelColors).toHaveProperty('critical');
    expect(alertLevelColors).toHaveProperty('high');
    expect(alertLevelColors).toHaveProperty('medium');
    expect(alertLevelColors).toHaveProperty('low');
    expect(alertLevelColors).toHaveProperty('none');
  });

  it('uses distinct colors per level', () => {
    expect(alertLevelColors.critical).toContain('red');
    expect(alertLevelColors.high).toContain('orange');
    expect(alertLevelColors.medium).toContain('yellow');
    expect(alertLevelColors.low).toContain('blue');
    expect(alertLevelColors.none).toContain('gray');
  });
});

describe('getProcessingStageLabel', () => {
  it('returns unicode ellipsis for stage1 (not ASCII dots)', () => {
    const label = getProcessingStageLabel('stage1');
    expect(label).toBe('Processing\u2026');
    expect(label).not.toContain('...');
  });

  it('returns correct labels for all stages', () => {
    expect(getProcessingStageLabel('stage2')).toBe('Complete');
    expect(getProcessingStageLabel('failed')).toBe('Failed');
    expect(getProcessingStageLabel(undefined)).toBe('Unknown');
  });
});
