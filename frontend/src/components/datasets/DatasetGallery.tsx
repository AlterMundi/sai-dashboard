// frontend/src/components/datasets/DatasetGallery.tsx
import { useState } from 'react';
import { DatasetImage, DatasetSplitName } from '@/types/dataset';
import { useAuth } from '@/hooks/useAuth';
import { ScanEye, ImageOff } from 'lucide-react';
import { cn } from '@/utils';

interface DatasetGalleryProps {
  datasetName: string;
  split: DatasetSplitName;
  items: DatasetImage[];
  total: number;
  page: number;
  onPageChange: (p: number) => void;
  loading: boolean;
}

const ALERT_COLORS: Record<string, string> = {
  critical: 'ring-2 ring-red-500',
  high:     'ring-2 ring-orange-400',
  medium:   'ring-2 ring-yellow-400',
  low:      'ring-1 ring-yellow-200',
};

export function DatasetGallery({
  datasetName, split, items, total, page, onPageChange, loading,
}: DatasetGalleryProps) {
  const [selected, setSelected] = useState<DatasetImage | null>(null);
  const { token } = useAuth();

  const totalPages = Math.ceil(total / 50);

  // Build authenticated image URL
  const imgSrc = (item: DatasetImage) => {
    const base = import.meta.env.VITE_API_BASE_URL || '/dashboard/api';
    return `${base}${item.imagePath}?token=${token}`;
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <span className="text-sm">Loading images...</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
        <ImageOff className="h-10 w-10" />
        <span className="text-sm">This split has no images yet.</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {items.map(item => (
          <button
            key={item.executionId}
            onClick={() => setSelected(selected?.executionId === item.executionId ? null : item)}
            className={cn(
              'relative aspect-video bg-gray-100 rounded-lg overflow-hidden group cursor-pointer transition-all',
              'hover:shadow-md hover:scale-[1.02]',
              item.alertLevel ? (ALERT_COLORS[item.alertLevel] ?? '') : '',
              selected?.executionId === item.executionId ? 'ring-2 ring-primary-500' : ''
            )}
          >
            <img
              src={imgSrc(item)}
              alt={`Execution ${item.executionId}`}
              className="w-full h-full object-cover"
              loading="lazy"
            />
            {item.hasSmoke && (
              <div className="absolute top-1 right-1 bg-orange-500/90 text-white rounded p-0.5">
                <ScanEye className="h-3 w-3" />
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-white text-xs truncate block">{item.executionId}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Footer: count + pagination */}
      <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
        <span>{total} images - {datasetName}/{split}</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              &lsaquo;
            </button>
            <span>{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              &rsaquo;
            </button>
          </div>
        )}
      </div>

      {/* Selected detail panel */}
      {selected && (
        <div className="mt-4 p-4 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-start gap-4">
            <img
              src={imgSrc(selected)}
              alt={`Execution ${selected.executionId}`}
              className="w-48 h-auto rounded"
            />
            <div className="text-sm space-y-1">
              <p><strong>Execution:</strong> {selected.executionId}</p>
              {selected.cameraId && <p><strong>Camera:</strong> {selected.cameraId}</p>}
              {selected.location && <p><strong>Location:</strong> {selected.location}</p>}
              {selected.alertLevel && <p><strong>Alert:</strong> {selected.alertLevel}</p>}
              {selected.detections && selected.detections.length > 0 && (
                <p><strong>Detections:</strong> {selected.detections.length} ({selected.detections.map(d => `${d.class} ${(d.confidence * 100).toFixed(0)}%`).join(', ')})</p>
              )}
              {selected.captureTimestamp && <p><strong>Captured:</strong> {new Date(selected.captureTimestamp).toLocaleString()}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
