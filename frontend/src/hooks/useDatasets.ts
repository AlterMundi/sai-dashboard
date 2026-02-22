// frontend/src/hooks/useDatasets.ts
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Dataset, DatasetImage, DatasetJob, DatasetSplitName } from '@/types/dataset';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/dashboard/api';

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function useDatasets() {
  const { token } = useAuth();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ datasets: Dataset[] }>('/datasets', token);
      setDatasets(data.datasets);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const createDataset = useCallback(async (name: string, description?: string) => {
    if (!token) throw new Error('Not authenticated');
    await apiFetch('/datasets', token, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
    await load();
  }, [token, load]);

  return { datasets, loading, error, reload: load, createDataset };
}

export function useDatasetImages(
  datasetName: string | null,
  split: DatasetSplitName | null,
) {
  const { token } = useAuth();
  const [items, setItems] = useState<DatasetImage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!datasetName || !split || !token) { setItems([]); return; }

    let cancelled = false;
    setLoading(true);

    apiFetch<{ items: DatasetImage[]; total: number }>(`/datasets/${datasetName}/${split}?page=${page}&limit=50`, token)
      .then(data => {
        if (!cancelled) { setItems(data.items); setTotal(data.total); }
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [datasetName, split, page, token]);

  return { items, total, page, setPage, loading };
}

export function useJobPolling(jobId: string | null) {
  const { token } = useAuth();
  const [job, setJob] = useState<DatasetJob | null>(null);

  useEffect(() => {
    if (!jobId || !token) { setJob(null); return; }

    const poll = async () => {
      try {
        const data = await apiFetch<DatasetJob>(`/datasets/jobs/${jobId}`, token);
        setJob(data);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval);
        }
      } catch { /* ignore */ }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [jobId, token]);

  return job;
}

export async function createDatasetJob(
  token: string,
  datasetName: string,
  split: DatasetSplitName,
  executionIds: number[],
  createIfMissing = false,
): Promise<string> {
  const data = await apiFetch<{ job_id: string }>('/datasets/jobs', token, {
    method: 'POST',
    body: JSON.stringify({
      dataset_name: datasetName,
      split,
      execution_ids: executionIds,
      create_if_missing: createIfMissing,
    }),
  });
  return data.job_id;
}
