# Filter Schema Mapping - SAI Dashboard

**Date:** October 14, 2025
**Purpose:** Document exact one-to-one and one-to-many relationships between database schema and filter system

---

## 🎯 Database Schema Overview

### Core Tables (1:1:1:1 Relationship)

```
executions (1)
  ├── execution_analysis (0..1)     -- YOLO detection results
  ├── execution_images (0..1)       -- Image file metadata
  └── execution_notifications (0..1) -- Telegram notification status
```

**Relationship Type:** Each execution has AT MOST one analysis, one image record, and one notification record.

---

## 📊 Complete Field Mapping

### Table: `executions`

| Column | Type | Values | Filterable | Filter Type | Frontend | Backend |
|--------|------|--------|------------|-------------|----------|---------|
| `id` | bigint | Primary key | ❌ No | - | - | - |
| `workflow_id` | varchar(36) | UUID | ❌ No | - | - | - |
| `execution_timestamp` | timestamp | ISO 8601 | ✅ **YES** | Date range | `startDate`, `endDate`, `datePreset` | ✅ Implemented |
| `completion_timestamp` | timestamp | ISO 8601 | ⚠️ **MISSING** | Date range | - | - |
| `duration_ms` | integer | Milliseconds | ⚠️ **MISSING** | Range | - | - |
| **`status`** | varchar(20) | `'success'`, `'error'` | ✅ **YES** | Enum select | ✅ `status` | ✅ Implemented |
| `mode` | varchar(20) | `'webhook'` (default) | ❌ No | - | - | - |
| `retry_of` | bigint | FK to executions.id | ❌ No | - | - | - |
| **`node_id`** | varchar(50) | Node identifier | ✅ **YES** | Text input | ✅ `nodeId` | ✅ Implemented |
| **`camera_id`** | varchar(50) | Camera identifier | ✅ **YES** | Text input | ✅ `cameraId` | ✅ Implemented |
| **`device_id`** | varchar(100) | Device identifier | ✅ **YES** | Text input | ✅ `deviceId` | ❌ **NOT IMPLEMENTED** |
| **`location`** | varchar(200) | Physical location | ✅ **YES** | Text input | ✅ `location` | ✅ Via search only |
| **`camera_type`** | varchar(50) | `'onvif'`, `'rtsp'` | ⚠️ **MISSING** | Enum select | - | - |
| `capture_timestamp` | timestamp | Device capture time | ⚠️ **MISSING** | Date range | - | - |

**Issues:**
- ❌ `status` enum in frontend has wrong values (`'running'`, `'canceled'`, `'waiting'` don't exist)
- ❌ `device_id` filter exists in frontend but NOT in backend query
- ❌ `camera_type` not filterable at all
- ❌ `completion_timestamp`, `duration_ms`, `capture_timestamp` not filterable

---

### Table: `execution_analysis`

| Column | Type | Values | Filterable | Filter Type | Frontend | Backend |
|--------|------|--------|------------|-------------|----------|---------|
| `execution_id` | bigint | FK to executions | ❌ No | - | - | - |
| `confidence_score` | numeric(4,3) | 0.000-1.000 | ⚠️ **PARTIAL** | Range | `minConfidence`, `maxConfidence` | ❌ Generic, not YOLO-specific |
| `yolo_model_version` | varchar(50) | e.g., 'yolov8n' | ⚠️ **MISSING** | Text input | - | - |
| `analysis_timestamp` | timestamp | ISO 8601 | ⚠️ **MISSING** | Date range | - | - |
| **`request_id`** | uuid | YOLO request UUID | ❌ No | - | - | - |
| **`detection_count`** | integer | 0-N detections | ⚠️ **MISSING** | Range (0-100) | - | - |
| **`has_fire`** | boolean | true/false | ✅ **YES** | Boolean select | ✅ `hasFire` | ❌ **NOT IMPLEMENTED** |
| **`has_smoke`** | boolean | true/false | ✅ **YES** | Boolean select | ✅ `hasSmoke` | ❌ **NOT IMPLEMENTED** |
| **`alert_level`** | varchar(20) | `'none'`, `'low'`, `'high'`, `'critical'` | ✅ **YES** | Enum select | ⚠️ Has `'medium'` (wrong!) | ✅ Implemented |
| **`detection_mode`** | varchar(50) | `'smoke-only'`, ... | ⚠️ **MISSING** | Enum select | - | - |
| **`active_classes`** | text[] | Array of classes | ⚠️ **MISSING** | Multi-select | - | - |
| `image_width` | integer | Pixels | ❌ No | - | - | - |
| `image_height` | integer | Pixels | ❌ No | - | - | - |
| `yolo_processing_time_ms` | numeric(10,2) | Milliseconds | ⚠️ **MISSING** | Range | - | - |
| **`detections`** | jsonb | YOLO bounding boxes | ⚠️ **MISSING** | JSONB query | - | - |
| **`confidence_fire`** | numeric(4,3) | 0.000-1.000 | ⚠️ **MISSING** | Range | - | - |
| **`confidence_smoke`** | numeric(4,3) | 0.000-1.000 | ⚠️ **MISSING** | Range | - | - |

**Issues:**
- ❌ `alert_level` frontend has `'medium'` which doesn't exist in DB (only `'none'`, `'low'`, `'high'`, `'critical'`)
- ❌ `has_fire` and `has_smoke` filters exist in frontend but NOT in backend
- ❌ `detection_count`, `confidence_fire`, `confidence_smoke` not filterable
- ❌ `detection_mode`, `active_classes`, `yolo_model_version` not filterable
- ❌ Generic `confidence_score` used instead of specific `confidence_fire`/`confidence_smoke`

---

### Table: `execution_images`

| Column | Type | Values | Filterable | Filter Type | Frontend | Backend |
|--------|------|--------|------------|-------------|----------|---------|
| `execution_id` | bigint | FK to executions | ❌ No | - | - | - |
| `original_path` | varchar(500) | Filesystem path | ✅ **YES** | Boolean (NULL check) | ✅ `hasImage` | ✅ Implemented |
| `thumbnail_path` | varchar(500) | Filesystem path | ❌ No | - | - | - |
| `size_bytes` | integer | File size | ⚠️ **MISSING** | Range | - | - |
| `width` | integer | Pixels | ⚠️ **MISSING** | Range | - | - |
| `height` | integer | Pixels | ⚠️ **MISSING** | Range | - | - |
| `format` | varchar(10) | `'jpeg'`, `'webp'` | ⚠️ **MISSING** | Enum select | - | - |
| `quality_score` | numeric(3,2) | 0.00-1.00 | ⚠️ **MISSING** | Range | - | - |
| **`extracted_at`** | timestamp | Stage 2 ETL completion | ⚠️ **MISSING** | Date range | - | - |
| `cached_path` | varchar(500) | Filesystem path | ❌ No | - | - | - |

**Issues:**
- ✅ `hasImage` correctly implemented as `original_path IS NOT NULL` check
- ❌ `extracted_at` timestamp not filterable (useful for Stage 2 ETL debugging)

---

### Table: `execution_notifications`

| Column | Type | Values | Filterable | Filter Type | Frontend | Backend |
|--------|------|--------|------------|-------------|----------|---------|
| `execution_id` | bigint | FK to executions | ❌ No | - | - | - |
| **`telegram_sent`** | boolean | true/false | ✅ **YES** | Boolean select | ✅ `telegramSent` | ✅ Implemented |
| `telegram_message_id` | bigint | Telegram API ID | ❌ No | - | - | - |
| `telegram_sent_at` | timestamp | ISO 8601 | ⚠️ **MISSING** | Date range | - | - |

**Issues:**
- ✅ `telegram_sent` correctly implemented

---

## 🔧 Required Fixes

### Priority 1: Critical Enum Mismatches

```typescript
// ❌ WRONG (current frontend)
status?: 'success' | 'error' | 'waiting' | 'running' | 'canceled';
alertLevel?: 'none' | 'low' | 'medium' | 'high' | 'critical';

// ✅ CORRECT (matches DB)
status?: 'success' | 'error';
alertLevel?: 'none' | 'low' | 'high' | 'critical';
```

### Priority 2: Missing Backend Filters

```typescript
// Frontend has these but backend DOESN'T:
deviceId?: string;          // ❌ Backend doesn't filter by device_id
hasFire?: boolean;          // ❌ Backend doesn't filter by has_fire
hasSmoke?: boolean;         // ❌ Backend doesn't filter by has_smoke
```

### Priority 3: Missing Frontend Filters

```typescript
// DB has these but frontend DOESN'T:
cameraType?: 'onvif' | 'rtsp';
detectionCount?: number;
confidenceFire?: number;      // More specific than generic confidence
confidenceSmoke?: number;
detectionMode?: string;
yoloModelVersion?: string;
```

---

## 📝 Recommended Filter Structure

### Basic Filters (Always Visible)
1. **Status** - `'success' | 'error'` (enum select)
2. **Alert Level** - `'none' | 'low' | 'high' | 'critical'` (enum select)
3. **Date Range** - Presets + custom (date picker)
4. **Has Image** - Boolean (yes/no/any)

### YOLO Detection Filters (Advanced)
5. **Fire Detection** - `has_fire` boolean
6. **Smoke Detection** - `has_smoke` boolean
7. **Detection Count** - Range (0-N)
8. **Fire Confidence** - Range (0.0-1.0)
9. **Smoke Confidence** - Range (0.0-1.0)
10. **Detection Mode** - Enum select

### Device/Location Filters (Advanced)
11. **Camera ID** - Text input (exact match)
12. **Camera Type** - `'onvif' | 'rtsp'` (enum select)
13. **Node ID** - Text input (exact match)
14. **Device ID** - Text input (exact match)
15. **Location** - Text input (ILIKE search)

### Notification Filters (Advanced)
16. **Telegram Sent** - Boolean (yes/no/any)

### Search
17. **Full-text Search** - ILIKE across location, device_id, camera_id

---

## 🗂️ Database Indexes for Filtering

Already present (optimized):
- ✅ `idx_executions_status_timestamp` - Status + date filtering
- ✅ `idx_executions_camera_type` - Camera type filtering
- ✅ `idx_executions_device_id` - Device filtering
- ✅ `idx_executions_location` - Location filtering
- ✅ `idx_execution_analysis_has_fire` - Fire detection filtering
- ✅ `idx_execution_analysis_has_smoke` - Smoke detection filtering
- ✅ `idx_execution_analysis_alert_level` - Alert level filtering
- ✅ `idx_execution_analysis_detection_count` - Detection count filtering
- ✅ `idx_execution_images_path` - Image existence filtering

**Performance:** All filterable fields are indexed! ✅

---

## 🔍 JSONB Detection Filtering (Advanced Use Case)

The `execution_analysis.detections` JSONB field allows complex queries:

```sql
-- Find executions with fire detections above 0.8 confidence
WHERE detections @> '[{"class": "fire"}]'::jsonb
  AND detections @@ '$[*] ? (@.class == "fire" && @.confidence > 0.8)'

-- Find executions with multiple smoke detections
WHERE jsonb_array_length(detections) > 2
  AND active_classes @> ARRAY['smoke']
```

**Frontend Implementation:** Could add "Advanced Detection Query" builder for power users.

---

## 📅 Date/Time Filtering Strategy

Multiple timestamp fields serve different purposes:

1. **`execution_timestamp`** (primary) - When n8n started workflow
2. **`capture_timestamp`** - When camera captured image (device time)
3. **`completion_timestamp`** - When execution finished
4. **`analysis_timestamp`** - When YOLO analysis completed
5. **`extracted_at`** - When Stage 2 ETL processed

**Recommendation:** Default filter by `execution_timestamp`, allow advanced users to filter by others.

---

## ✅ Implementation Checklist

### Backend (`backend/src/services/new-execution-service.ts`)
- [ ] Add `deviceId` filter implementation
- [ ] Add `hasFire` filter implementation
- [ ] Add `hasSmoke` filter implementation
- [ ] Add `cameraType` filter
- [ ] Add `detectionCount` range filter
- [ ] Add `confidenceFire` range filter
- [ ] Add `confidenceSmoke` range filter
- [ ] Add `detectionMode` filter
- [ ] Change location search from WHERE to ILIKE

### Frontend Types (`frontend/src/types/api.ts`)
- [ ] Fix `status` enum (remove `'waiting'`, `'running'`, `'canceled'`)
- [ ] Fix `alertLevel` enum (remove `'medium'`)
- [ ] Add `cameraType?: 'onvif' | 'rtsp'`
- [ ] Add `detectionCount?: number`
- [ ] Add `confidenceFire?: number`
- [ ] Add `confidenceSmoke?: number`
- [ ] Add `detectionMode?: string`
- [ ] Add `yoloModelVersion?: string`

### Frontend UI (`frontend/src/components/FilterBar.tsx`)
- [ ] Remove invalid status options
- [ ] Remove invalid alert level option ('medium')
- [ ] Add camera type filter
- [ ] Add detection count filter
- [ ] Add fire/smoke confidence filters
- [ ] Ensure device_id filter is connected
- [ ] Add detection mode filter (if data available)

---

## 🎯 Summary

**Total Filterable Fields:** 18 fields across 4 tables
**Currently Implemented:** 10 fields (55%)
**Missing/Broken:** 8 fields (45%)

**Critical Issues:**
1. ❌ 3 filters in frontend not implemented in backend (`deviceId`, `hasFire`, `hasSmoke`)
2. ❌ 2 enum types have wrong values (`status`, `alertLevel`)
3. ❌ 5 database fields not filterable at all (`camera_type`, `detection_count`, `confidence_fire`, `confidence_smoke`, `detection_mode`)
