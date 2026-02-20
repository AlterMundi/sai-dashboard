/**
 * Execution Types - YOLO Fire Detection System
 *
 * These interfaces match the backend ExecutionWithImage interface 1:1.
 * They represent the clean YOLO schema after Migration 005.
 *
 * DO NOT add legacy Ollama fields (riskLevel, smokeDetected, flameDetected, etc.)
 *
 * Last updated: October 12, 2025
 * Schema version: 2.1 (Optimized YOLO)
 */

/**
 * YOLO Detection object - individual fire/smoke detection with bounding box
 */
export interface YoloDetection {
  class: string;  // 'smoke' | 'unknown'
  confidence: number;  // 0.0 - 1.0
  bounding_box: {
    x: number;        // Pixels from left
    y: number;        // Pixels from top
    width: number;    // Box width in pixels
    height: number;   // Box height in pixels
  };
}

/**
 * Core Execution with YOLO Analysis
 * Matches backend ExecutionWithImage interface exactly
 */
export interface Execution {
  // ============================================================================
  // Core Execution Data
  // ============================================================================
  id: number;
  workflowId: string;
  executionTimestamp: string;  // ISO 8601 date string
  completionTimestamp: string | null;
  durationMs: number | null;
  status: 'success' | 'error' | 'canceled' | 'running';
  mode: string;

  // ============================================================================
  // Device and Camera Data
  // ============================================================================
  deviceId: string | null;
  nodeId: string | null;
  cameraId: string | null;
  location: string | null;
  cameraType: string | null;
  captureTimestamp: string | null;

  // ============================================================================
  // YOLO Analysis Data
  // ============================================================================
  requestId: string | null;
  yoloModelVersion: string | null;
  detectionCount: number;
  hasSmoke: boolean;
  alertLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' | null;
  detectionMode: string | null;
  activeClasses: string[] | null;
  detections: YoloDetection[] | null;

  // ============================================================================
  // Confidence Scores
  // ============================================================================
  confidenceSmoke: number | null;    // 0.0 - 1.0
  confidenceScore: number | null;    // Max confidence across all detections

  // ============================================================================
  // Image Data
  // ============================================================================
  hasImage: boolean;
  imagePath: string | null;
  thumbnailPath: string | null;
  cachedPath: string | null;
  imageSizeBytes: number | null;
  imageFormat: string | null;
  imageWidth: number | null;
  imageHeight: number | null;

  // ============================================================================
  // Notification Data
  // ============================================================================
  telegramSent: boolean;
  telegramMessageId: number | null;
  telegramSentAt: string | null;

  // ============================================================================
  // Processing Metadata
  // ============================================================================
  yoloProcessingTimeMs: number | null;
  processingTimeMs: number | null;
  extractedAt: string | null;

  // ============================================================================
  // False Positive Tracking
  // ============================================================================
  isFalsePositive: boolean;
  falsePositiveReason: string | null;
  markedFalsePositiveAt: string | null;
}

/**
 * Execution with computed image URLs
 * Used by frontend components that need to display images
 */
export interface ExecutionWithImageUrls extends Execution {
  imageUrl?: string;
  thumbnailUrl?: string;
}

/**
 * Processing stage status for two-stage ETL
 */
export type ProcessingStage = 'stage1' | 'stage2' | 'failed';

/**
 * Execution with processing stage information
 * Used to track data availability in two-stage ETL
 */
export interface ExecutionWithProcessingStage extends ExecutionWithImageUrls {
  processingStage: ProcessingStage;
  stage2CompletedAt?: string | null;
  stage2Error?: string | null;
  retryCount?: number;
}

/**
 * Execution status union type
 */
export type ExecutionStatus = Execution['status'];

/**
 * Alert level union type
 */
export type AlertLevel = NonNullable<Execution['alertLevel']>;

/**
 * Detection mode union type
 */
export type DetectionMode = 'smoke-only' | null;
