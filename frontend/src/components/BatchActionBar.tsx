import { useState } from 'react';
import { Flag, Image, FileSpreadsheet, X, Loader2 } from 'lucide-react';

interface BatchActionBarProps {
  selectedCount: number;
  onMarkFalsePositive: () => Promise<void>;
  onExportCsv: () => void;
  onDownloadImages: () => Promise<void>;
  onClearSelection: () => void;
}

export function BatchActionBar({
  selectedCount,
  onMarkFalsePositive,
  onExportCsv,
  onDownloadImages,
  onClearSelection,
}: BatchActionBarProps) {
  const [isFpLoading, setIsFpLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleMarkFalsePositive = async () => {
    setIsFpLoading(true);
    try {
      await onMarkFalsePositive();
    } finally {
      setIsFpLoading(false);
    }
  };

  const handleDownloadImages = async () => {
    setIsDownloading(true);
    try {
      await onDownloadImages();
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 bg-gray-900 text-white rounded-xl shadow-2xl transition-transform duration-200">
      <span className="text-sm font-medium whitespace-nowrap">
        {selectedCount} selected
      </span>

      <div className="w-px h-6 bg-gray-600" />

      <button
        onClick={handleMarkFalsePositive}
        disabled={isFpLoading}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
      >
        {isFpLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Flag className="h-4 w-4" />
        )}
        False Positive
      </button>

      <button
        onClick={handleDownloadImages}
        disabled={isDownloading}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
      >
        {isDownloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Image className="h-4 w-4" />
        )}
        Download Images
      </button>

      <button
        onClick={onExportCsv}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
      >
        <FileSpreadsheet className="h-4 w-4" />
        Export CSV
      </button>

      <div className="w-px h-6 bg-gray-600" />

      <button
        onClick={onClearSelection}
        className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
        title="Clear selection"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
