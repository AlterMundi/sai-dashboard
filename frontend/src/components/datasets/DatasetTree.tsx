// frontend/src/components/datasets/DatasetTree.tsx
import { useState } from 'react';
import { ChevronRight, ChevronDown, Database, FolderOpen, Folder, Plus } from 'lucide-react';
import { cn } from '@/utils';
import { Dataset, DatasetSplitName } from '@/types/dataset';

interface DatasetTreeProps {
  datasets: Dataset[];
  selectedDataset: string | null;
  selectedSplit: DatasetSplitName | null;
  onSelect: (dataset: string, split: DatasetSplitName) => void;
  onCreateClick: () => void;
  loading: boolean;
}

export function DatasetTree({
  datasets,
  selectedDataset,
  selectedSplit,
  onSelect,
  onCreateClick,
  loading,
}: DatasetTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <div className="w-56 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Datasets</span>
        <button
          onClick={onCreateClick}
          className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
          title="Nuevo dataset"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading && (
          <div className="px-3 py-2 text-xs text-gray-400">Cargando...</div>
        )}
        {!loading && datasets.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-400 text-center">
            Sin datasets.<br />
            <button onClick={onCreateClick} className="text-primary-600 hover:underline mt-1">
              Crear el primero
            </button>
          </div>
        )}
        {datasets.map(ds => {
          const isOpen = expanded.has(ds.name);
          return (
            <div key={ds.name}>
              {/* Dataset root */}
              <button
                onClick={() => toggle(ds.name)}
                className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {isOpen
                  ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                }
                <Database className="h-3.5 w-3.5 text-primary-500 flex-shrink-0" />
                <span className="truncate font-medium">{ds.name}</span>
              </button>

              {/* Splits */}
              {isOpen && (
                <div className="pl-6">
                  {(['train', 'val'] as DatasetSplitName[]).map(split => {
                    const count = ds.splits[split].count;
                    const isActive = selectedDataset === ds.name && selectedSplit === split;
                    return (
                      <button
                        key={split}
                        onClick={() => onSelect(ds.name, split)}
                        className={cn(
                          'w-full flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors rounded-md mx-1',
                          isActive
                            ? 'bg-primary-50 text-primary-700 font-medium'
                            : 'text-gray-600 hover:bg-gray-50'
                        )}
                      >
                        {isActive
                          ? <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
                          : <Folder className="h-3.5 w-3.5 flex-shrink-0" />
                        }
                        <span className="truncate">{split}</span>
                        <span className="ml-auto text-xs text-gray-400">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
