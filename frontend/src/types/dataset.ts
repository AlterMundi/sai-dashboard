// frontend/src/types/dataset.ts

export interface DatasetSplit {
  count: number;
}

export interface Dataset {
  name: string;
  description: string | null;
  created_at: string | null;
  created_by: string | null;
  splits: {
    train: DatasetSplit;
    val: DatasetSplit;
  };
}

export interface DatasetImage {
  executionId: number;
  imagePath: string;
  thumbnailPath: string;
  detections: Array<{
    class: string;
    confidence: number;
    bounding_box: { x: number; y: number; width: number; height: number };
  }> | null;
  alertLevel: string | null;
  hasSmoke: boolean;
  captureTimestamp: string | null;
  cameraId: string | null;
  location: string | null;
}

export interface DatasetJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  total: number;
  completed_at: string | null;
  error: string | null;
}

export type DatasetSplitName = 'train' | 'val';
