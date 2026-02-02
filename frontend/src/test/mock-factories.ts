/**
 * Mock data factories matching the current YOLO schema (ExecutionWithImageUrls).
 *
 * The legacy createMockExecution in test-utils.tsx uses old Ollama-era fields.
 * Use these factories for new tests written against the current schema.
 */
import { ExecutionWithImageUrls, ExecutionWithProcessingStage, ProcessingStage } from '@/types';

export function createMockYoloExecution(
  overrides?: Partial<ExecutionWithImageUrls>
): ExecutionWithImageUrls {
  return {
    id: 180001,
    workflowId: 'wf-sai-001',
    executionTimestamp: '2025-10-15T10:00:00Z',
    completionTimestamp: '2025-10-15T10:00:30Z',
    durationMs: 30000,
    status: 'success',
    mode: 'webhook',
    deviceId: null,
    nodeId: 'NODE_001',
    cameraId: 'CAM_001',
    location: 'Zone A',
    cameraType: null,
    captureTimestamp: null,
    requestId: 'req-001',
    yoloModelVersion: 'yolov8n',
    detectionCount: 2,
    hasFire: true,
    hasSmoke: false,
    alertLevel: 'high',
    detectionMode: null,
    activeClasses: ['fire'],
    detections: [
      {
        class: 'fire',
        confidence: 0.95,
        bounding_box: { x: 100, y: 100, width: 50, height: 50 },
      },
    ],
    confidenceFire: 0.95,
    confidenceSmoke: null,
    confidenceScore: 0.95,
    hasImage: true,
    imagePath: '/images/180001/original.jpg',
    thumbnailPath: '/images/180001/thumb.webp',
    cachedPath: '/images/180001/high.webp',
    imageSizeBytes: 512000,
    imageFormat: 'jpeg',
    imageWidth: 1920,
    imageHeight: 1080,
    telegramSent: true,
    telegramMessageId: 12345,
    telegramSentAt: '2025-10-15T10:00:35Z',
    yoloProcessingTimeMs: 150,
    processingTimeMs: 5000,
    extractedAt: '2025-10-15T10:00:15Z',
    imageUrl: '/api/executions/180001/image',
    thumbnailUrl: '/api/executions/180001/image?thumbnail=true',
    ...overrides,
  };
}

export function createMockProcessingExecution(
  stage: ProcessingStage,
  overrides?: Partial<ExecutionWithProcessingStage>
): ExecutionWithProcessingStage {
  return {
    ...createMockYoloExecution(),
    processingStage: stage,
    stage2CompletedAt: stage === 'stage2' ? '2025-10-15T10:00:20Z' : null,
    stage2Error: stage === 'failed' ? 'Processing timeout' : null,
    retryCount: stage === 'failed' ? 2 : 0,
    ...overrides,
  };
}
