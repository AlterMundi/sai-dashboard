// frontend/src/pages/Datasets.tsx
import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { DatasetTree } from '@/components/datasets/DatasetTree';
import { DatasetGallery } from '@/components/datasets/DatasetGallery';
import { CreateDatasetModal } from '@/components/datasets/CreateDatasetModal';
import { useDatasets, useDatasetImages } from '@/hooks/useDatasets';
import { DatasetSplitName } from '@/types/dataset';

export function Datasets() {
  const { datasets, loading, createDataset, reload } = useDatasets();
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [selectedSplit, setSelectedSplit] = useState<DatasetSplitName | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { items, total, page, setPage, loading: imagesLoading } = useDatasetImages(
    selectedDataset,
    selectedSplit,
  );

  const handleSelect = (dataset: string, split: DatasetSplitName) => {
    setSelectedDataset(dataset);
    setSelectedSplit(split);
    setPage(1);
  };

  const handleCreate = async (name: string, description?: string) => {
    await createDataset(name, description);
    setShowCreate(false);
    await reload();
  };

  return (
    <Layout className="!p-0 !max-w-none">
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        <DatasetTree
          datasets={datasets}
          selectedDataset={selectedDataset}
          selectedSplit={selectedSplit}
          onSelect={handleSelect}
          onCreateClick={() => setShowCreate(true)}
          loading={loading}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedDataset ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 flex-col gap-2">
              <span className="text-sm">Select a dataset from the tree to explore its images.</span>
            </div>
          ) : (
            <DatasetGallery
              datasetName={selectedDataset}
              split={selectedSplit!}
              items={items}
              total={total}
              page={page}
              onPageChange={setPage}
              loading={imagesLoading}
            />
          )}
        </div>
      </div>

      {showCreate && (
        <CreateDatasetModal
          onConfirm={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
    </Layout>
  );
}
