// frontend/src/components/datasets/AddToDatasetModal.tsx
import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { Dataset, DatasetSplitName } from '@/types/dataset';
import { useAuth } from '@/hooks/useAuth';
import { createDatasetJob } from '@/hooks/useDatasets';
import toast from 'react-hot-toast';

interface AddToDatasetModalProps {
  executionIds: number[];
  datasets: Dataset[];
  onClose: () => void;
  onJobStarted: (jobId: string) => void;
}

export function AddToDatasetModal({
  executionIds, datasets, onClose, onJobStarted,
}: AddToDatasetModalProps) {
  const { token } = useAuth();
  const [selectedDataset, setSelectedDataset] = useState<string>(datasets[0]?.name ?? '');
  const [split, setSplit] = useState<DatasetSplitName>('train');
  const [newName, setNewName] = useState('');
  const [mode, setMode] = useState<'existing' | 'new'>(datasets.length > 0 ? 'existing' : 'new');
  const [loading, setLoading] = useState(false);

  const slugify = (v: string) =>
    v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');

  const handleConfirm = async () => {
    if (!token) return;
    const datasetName = mode === 'new' ? newName : selectedDataset;
    if (!datasetName) { toast.error('Select or create a dataset'); return; }

    setLoading(true);
    try {
      const jobId = await createDatasetJob(
        token, datasetName, split, executionIds, mode === 'new'
      );
      onJobStarted(jobId);
      toast.success(`${executionIds.length} images added to ${datasetName}/${split}`);
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Add {executionIds.length} image{executionIds.length !== 1 ? 's' : ''} to dataset
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('existing')}
              disabled={datasets.length === 0}
              className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                mode === 'existing'
                  ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              } disabled:opacity-40`}
            >
              Existing dataset
            </button>
            <button
              onClick={() => setMode('new')}
              className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                mode === 'new'
                  ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Plus className="h-3.5 w-3.5 inline mr-1" />
              New
            </button>
          </div>

          {/* Dataset selector or name input */}
          {mode === 'existing' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dataset</label>
              <select
                value={selectedDataset}
                onChange={e => setSelectedDataset(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {datasets.map(ds => (
                  <option key={ds.name} value={ds.name}>{ds.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New dataset name</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(slugify(e.target.value))}
                placeholder="my-dataset-v1"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          )}

          {/* Split selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Split</label>
            <div className="flex gap-2">
              {(['train', 'val'] as DatasetSplitName[]).map(s => (
                <button
                  key={s}
                  onClick={() => setSplit(s)}
                  className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                    split === s
                      ? 'bg-primary-50 border-primary-300 text-primary-700 font-medium'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || (mode === 'new' && !newName)}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg transition-colors"
          >
            {loading ? 'Sending...' : 'Add to dataset'}
          </button>
        </div>
      </div>
    </div>
  );
}
