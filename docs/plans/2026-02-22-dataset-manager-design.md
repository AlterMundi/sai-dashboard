# Dataset Manager — Design Document

**Date:** 2026-02-22
**Status:** Approved
**Branch:** feat/dataset-manager

---

## Overview

A new "Datasets" section in the SAI Dashboard that allows researchers to build, explore, and manage YOLO-format image datasets from the execution gallery. Images collected from real fire detection events can be curated into labeled datasets for model training and validation.

---

## Goals

- Select execution images (via existing gallery filters + multi-select) and add them to a named dataset
- Organize datasets in YOLO standard format on the RAID filesystem
- Auto-discover external YOLO datasets copied to the RAID directory
- View dataset contents in a gallery-like interface with bounding box overlays
- Role-gated: only SAI_RESEARCHER and SAI_ADMIN can access
- Generate YOLO label TXT files from stored detections (no re-inference required for fast path)
- Optional re-inference with the YOLO Inference service (Phase 4)

---

## Non-Goals (explicit scope cuts)

- Training job management (out of scope for this epic)
- MinIO / object storage migration
- Annotation editing (labels are read-only, generated from DB detections)
- Multi-class support beyond smoke (system is smoke-only)

---

## Architecture Decision: Filesystem-first (Approach B)

The filesystem is the source of truth. The backend scans `/mnt/raid1/datasets/` at runtime (with a 30-second in-memory cache) to build the dataset tree. This means:

- External YOLO datasets copied to the RAID are auto-discovered — no import step required
- The DB holds only async job state, not dataset index
- No drift between DB and filesystem

---

## Filesystem Layout

```
/mnt/raid1/datasets/
└── {dataset-slug}/
    ├── dataset.json          ← metadata (name, description, created_at, created_by)
    ├── classes.txt           ← "smoke\n" (standard YOLO)
    ├── train/
    │   ├── images/
    │   │   └── {execution_id}.jpg    ← physical copy of original
    │   └── labels/
    │       └── {execution_id}.txt    ← YOLO normalized bounding boxes
    └── val/
        ├── images/
        └── labels/
```

### Label TXT Format (YOLO normalized)

```
{class_id} {cx_norm} {cy_norm} {w_norm} {h_norm}
```

- `class_id`: always `0` (smoke)
- `cx_norm`, `cy_norm`: bounding box center, normalized to [0,1] using `execution_images.width/height`
- `w_norm`, `h_norm`: box dimensions, normalized to [0,1]
- Source: `execution_analysis.detections` JSONB + `execution_images` dimensions
- If an execution has no detections: empty TXT file (negative sample)

### dataset.json Schema

```json
{
  "name": "incendio-norte-v1",
  "description": "True positives from camera nodes 1-5, Feb 2026",
  "created_at": "2026-02-22T14:00:00Z",
  "created_by": "user@example.com"
}
```

---

## Database Changes

### Migration 013: dataset_jobs

```sql
CREATE TABLE dataset_jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_name   VARCHAR NOT NULL,
  split          VARCHAR NOT NULL CHECK (split IN ('train', 'val')),
  execution_ids  BIGINT[] NOT NULL,
  status         VARCHAR NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress       INTEGER DEFAULT 0,
  total          INTEGER NOT NULL,
  created_by     VARCHAR,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  error          TEXT
);

CREATE INDEX idx_dataset_jobs_status ON dataset_jobs(status);
CREATE INDEX idx_dataset_jobs_dataset ON dataset_jobs(dataset_name);
```

No changes to existing tables.

---

## Backend API

**Router:** `/dashboard/api/datasets`
**Auth:** All routes require `roleGate(['SAI_RESEARCHER', 'SAI_ADMIN'])`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/datasets` | Scan filesystem, return dataset tree (cached 30s) |
| `POST` | `/datasets` | Create dataset dir + dataset.json + classes.txt |
| `DELETE` | `/datasets/:name` | Delete dataset directory (SAI_ADMIN only) |
| `GET` | `/datasets/:name/:split` | List images in split (paginated) |
| `GET` | `/datasets/:name/:split/image/:executionId` | Serve copied image |
| `GET` | `/datasets/:name/:split/label/:executionId` | Serve label TXT raw |
| `POST` | `/datasets/jobs` | Create add-to-dataset job |
| `GET` | `/datasets/jobs/:jobId` | Poll job status |

### POST /datasets/jobs — Request Body

```typescript
{
  dataset_name: string;
  split: 'train' | 'val';
  execution_ids: number[];
  create_if_missing?: boolean;  // create dataset dir if it doesn't exist
}
```

### GET /datasets Response

```typescript
[{
  name: string;
  description: string | null;
  created_at: string | null;
  created_by: string | null;
  splits: {
    train: { count: number };
    val: { count: number };
  };
}]
```

### New Service: `backend/src/services/dataset-service.ts`

Key functions:
- `scanDatasets(): Promise<Dataset[]>` — filesystem scan with 30s memory cache
- `createDataset(name, description, createdBy): Promise<void>` — mkdir + json + classes.txt
- `processJob(jobId): Promise<void>` — copy images + generate TXT from DB detections
- `listSplitImages(name, split, pagination): Promise<PaginatedResult>` — read dir + enrich from DB

---

## Auth / Roles

New role added to enum:

```typescript
// backend/src/auth/roles.ts
export enum UserRole {
  SAI_ADMIN      = 'SAI_ADMIN',
  SAI_OPERATOR   = 'SAI_OPERATOR',
  SAI_VIEWER     = 'SAI_VIEWER',
  SAI_RESEARCHER = 'SAI_RESEARCHER',  // new
}
```

- Must also be created in Zitadel as a project role and assigned to researcher users
- No changes to JWT middleware, PKCE flow, or claim parsing logic

---

## Frontend

### Navigation

```
[Galería]  [Estadísticas]  [Datasets]
```

Datasets tab is hidden for SAI_OPERATOR and SAI_VIEWER via `RoleGate`.

### Layout of `/datasets`

```
┌──────────────────────────────────────────────────────┐
│ [+ Nuevo Dataset]                         Datasets   │
├────────────────┬─────────────────────────────────────┤
│  TREE          │  CENTRAL GALLERY                    │
│                │                                     │
│ 📁 incendio-v1 │  [ImageCard] [ImageCard] [ImageCard]│
│  └ 📂 train ●  │  [ImageCard] [ImageCard] ...        │
│  └ 📂 val      │                                     │
│                │  (same as Gallery, no filters,      │
│ 📁 fp-cam3-v1  │   scroll + image modal only)        │
│  └ 📂 train    │                                     │
│  └ 📂 val      │  Footer: 247 images · train         │
│                │                                     │
└────────────────┴─────────────────────────────────────┘
```

### New Files

```
frontend/src/pages/Datasets.tsx
frontend/src/components/datasets/
  DatasetTree.tsx          ← left sidebar tree
  DatasetGallery.tsx       ← central gallery (reuses ImageCard)
  CreateDatasetModal.tsx   ← create new dataset
  AddToDatasetModal.tsx    ← modal from BatchActionBar
```

### Modified Files

| File | Change |
|------|--------|
| `frontend/src/App.tsx` | Add `/datasets` route with RoleGate |
| `frontend/src/components/Layout.tsx` | Add Datasets tab conditional on role |
| `frontend/src/components/BatchActionBar.tsx` | Add "Agregar a Dataset" button (SAI_RESEARCHER + SAI_ADMIN only) |
| `backend/src/auth/roles.ts` | Add SAI_RESEARCHER to enum |
| `backend/src/routes/index.ts` | Mount dataset router |

### "Add to Dataset" Flow

1. User filters executions in Gallery → selects with checkboxes
2. BatchActionBar shows `[Agregar a Dataset]` (role-gated)
3. `AddToDatasetModal` opens: dropdown of existing datasets + train/val selector + optional "create new" inline
4. Confirm → `POST /datasets/jobs` → returns `job_id`
5. Toast with progress bar (polls `GET /datasets/jobs/:jobId` every 2s until `completed` or `failed`)

---

## Deployment Strategy

### Branch: `feat/dataset-manager`

Phased delivery — each phase is independently deployable:

| Phase | Scope | Risk |
|-------|-------|------|
| 1 | DB migration 013 + backend API + dataset-service | Low — backend only, no UI |
| 2 | Frontend `/datasets` page + tree + gallery | Low — behind RoleGate, invisible to other roles |
| 3 | BatchActionBar integration + AddToDatasetModal | Medium — touches shared component |
| 4 | Re-inference job (optional, call YOLO Inference service) | Medium — separate, can skip |

- RoleGate ensures zero impact on SAI_OPERATOR and SAI_VIEWER at all phases
- Full rollback: revert branch, re-run migration down (drop dataset_jobs table)
- Production deploy via existing `release` branch CI/CD pipeline

---

## Open Questions / Future Work

- **Re-inference (Phase 4):** Requires knowing the YOLO Inference service URL — can be added as `YOLO_INFERENCE_URL` env var
- **Dataset deletion policy:** Currently SAI_ADMIN only; could allow SAI_RESEARCHER to delete their own
- **Large datasets:** For >10k images, the directory listing may need streaming pagination instead of `readdir`
- **External dataset import:** Auto-discovered external datasets lack `dataset.json` — show them with a "(external)" badge and allow metadata creation in-place
