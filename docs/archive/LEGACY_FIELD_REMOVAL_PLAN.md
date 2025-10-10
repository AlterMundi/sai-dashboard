# Legacy Field Removal Plan

**Status:** Ready to execute
**Created:** 2025-10-10
**Impact:** Breaking changes - removes all Ollama/legacy backward compatibility

---

## Overview

This plan removes all legacy fields from the SAI Dashboard codebase, completing the transition to pure YOLO-based fire detection. After this migration, the system will only support YOLO inference results.

---

## Phase 1: Database Schema Changes

### Migration 004: Remove Legacy Columns

**File:** `backend/migrations/004_remove_legacy_fields.sql`

**Columns to DROP from `execution_analysis`:**

| Column Name | Purpose (Legacy) | Replacement |
|-------------|------------------|-------------|
| `risk_level` | Ollama risk assessment | `alert_level` (YOLO) |
| `smoke_detected` | Boolean smoke flag | `has_smoke` (YOLO) |
| `flame_detected` | Boolean flame flag | `has_fire` (YOLO) |
| `alert_priority` | Legacy alert priority | Use `alert_level` directly |
| `response_required` | Manual response flag | Derive from `alert_level` |
| `node_id` | Duplicate field | Use `executions.node_id` |
| `camera_id` | Duplicate field | Use `executions.camera_id` |
| `camera_location` | Duplicate field | Use `executions.location` |
| `location_lat` | GPS latitude | Not currently used |
| `location_lng` | GPS longitude | Not currently used |
| `processing_time_ms` | Legacy processing time | Use `yolo_processing_time_ms` |
| `raw_response` | Ollama raw text | Not needed for YOLO |
| `has_telegram_confirmation` | Unused flag | Remove |

**Total columns removed:** 13

---

## Phase 2: Backend Code Changes

### Files Requiring Updates

1. **`src/types/index.ts`** - Remove legacy type definitions
2. **`src/services/stage2-etl-service.ts`** - Remove legacy field generation
3. **`src/services/new-execution-service.ts`** - Remove legacy SQL selects
4. **`src/services/expert-review.ts`** - Remove legacy field mappings
5. **`src/routes/index.ts`** - Remove legacy API filters
6. **`src/controllers/executions.ts`** - Remove legacy response fields
7. **`src/controllers/sse.ts`** - Remove legacy SSE broadcasts
8. **`src/services/etl-service.ts`** - Remove legacy ETL (if still present)
9. **`src/services/simple-etl-service.ts`** - Remove or delete entirely
10. **`src/services/live-etl-service.ts`** - Remove or update
11. **`src/controllers/node.ts`** - Update to use YOLO fields only
12. **`src/controllers/expert-review.ts`** - Remove legacy review fields
13. **`src/services/enhanced-analysis.ts`** - Simplify to YOLO only

### Deprecated Services to Consider Removing Entirely

These services appear to be from the Ollama era:
- `simple-etl-service.ts` - Pre-two-stage ETL
- `live-etl-service.ts` - Pre-two-stage ETL
- `etl-service.ts` - Original ETL (replaced by two-stage)
- `enhanced-analysis.ts` - Ollama-specific

**Recommendation:** Delete these files after confirming they're not imported anywhere.

---

## Phase 3: Type Definition Changes

### `ExecutionWithImage` Interface

**Remove these fields:**
```typescript
riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none' | null;
smokeDetected: boolean;
flameDetected: boolean;
overallAssessment: string | null;
alertPriority: 'critical' | 'high' | 'normal' | 'low';
responseRequired: boolean;
```

### `SaiEnhancedAnalysis` Interface

**Remove these fields:**
```typescript
riskLevel?: 'high' | 'medium' | 'low' | 'none' | 'critical';
smokeDetected?: boolean;
flameDetected?: boolean;
heatSignatureDetected?: boolean;
motionDetected?: boolean;
alertPriority: 'critical' | 'high' | 'normal' | 'low';
responseRequired?: boolean;
ollamaAnalysisText?: string;
rawAnalysisJson?: Record<string, unknown>;
colorAnalysis?: Record<string, unknown>;
confidenceBreakdown?: Record<string, number>;
imageQualityScore?: number;
featuresDetected?: string[];
nodeName?: string;
nodeType?: string;
```

### `ExecutionFilters` Interface

**Remove these filters:**
```typescript
riskLevel?: 'high' | 'medium' | 'low' | 'none';
alertPriority?: 'critical' | 'high' | 'normal' | 'low';
responseRequired?: boolean;
smokeDetected?: boolean;
flameDetected?: boolean;
```

**Replace with YOLO filters:**
```typescript
alertLevel?: 'none' | 'low' | 'medium' | 'high' | 'critical';
hasFire?: boolean;
hasSmoke?: boolean;
minDetectionCount?: number;
```

---

## Phase 4: Frontend Impact Analysis

### Components to Update

The frontend will need updates to:
- Replace `riskLevel` with `alertLevel`
- Replace `smokeDetected`/`flameDetected` with `hasSmoke`/`hasFire`
- Remove `alertPriority` and `responseRequired` filters
- Update color coding (if based on `riskLevel`)

### API Response Changes

**Before:**
```json
{
  "riskLevel": "high",
  "smokeDetected": true,
  "flameDetected": false,
  "alertPriority": "high",
  "responseRequired": true
}
```

**After:**
```json
{
  "alertLevel": "high",
  "hasSmoke": true,
  "hasFire": false,
  "detectionCount": 3,
  "confidenceSmoke": 0.87
}
```

---

## Phase 5: Documentation Updates

Files to update:
- `docs/DATABASE_SCHEMA.md` - Remove legacy field documentation
- `docs/TWO_STAGE_ETL_ARCHITECTURE.md` - Update if references legacy fields
- `docs/DATA_INTEGRITY_PRINCIPLES.md` - Update examples
- `backend/README.md` - Update API documentation

---

## Rollback Strategy

### If Issues Arise

1. **Rollback Migration:**
   ```sql
   -- See rollback instructions in migration 004 file
   ALTER TABLE execution_analysis
     ADD COLUMN risk_level VARCHAR(20),
     ADD COLUMN smoke_detected BOOLEAN DEFAULT false,
     -- ... (restore other columns)
   ```

2. **Revert Code:** Git revert the legacy removal commit

3. **Frontend Compatibility:** Keep frontend reading both old and new fields temporarily:
   ```typescript
   const alertLevel = execution.alertLevel || deriveFromRiskLevel(execution.riskLevel);
   ```

---

## Testing Plan

### Unit Tests
- [ ] Stage 2 ETL without legacy field generation
- [ ] API responses without legacy fields
- [ ] Type checking passes

### Integration Tests
- [ ] Full ETL pipeline (Stage 1 → Stage 2 → Database)
- [ ] API endpoints return correct YOLO fields
- [ ] SSE broadcasts include YOLO data

### Manual Verification
- [ ] Dashboard loads execution list
- [ ] Filters work with YOLO fields
- [ ] Execution detail page shows YOLO data
- [ ] No console errors related to missing fields

---

## Execution Timeline

1. **Step 1:** Deploy migration 004 to database (2 minutes)
2. **Step 2:** Update backend code and rebuild (15 minutes)
3. **Step 3:** Deploy backend to production (5 minutes)
4. **Step 4:** Verify API responses (5 minutes)
5. **Step 5:** Update frontend (if needed) (30 minutes)
6. **Step 6:** Monitor logs for errors (24 hours)

**Total estimated time:** 1 hour active work + monitoring

---

## Breaking Changes Summary

### API Changes (BREAKING)

| Endpoint | Change | Impact |
|----------|--------|--------|
| `GET /api/executions` | Removed `riskLevel`, `smokeDetected`, `flameDetected` | Frontend must use `alertLevel`, `hasFire`, `hasSmoke` |
| `GET /api/executions?riskLevel=high` | Filter removed | Use `?alertLevel=high` instead |
| `GET /api/stats` | Risk distribution changed | Use alert level distribution |

### Database Changes (BREAKING)

- 13 columns dropped from `execution_analysis`
- No data migration possible (columns permanently deleted)
- Queries referencing old columns will fail

### Type Changes (BREAKING)

- TypeScript interfaces updated
- Code using old field names won't compile
- Frontend type definitions must be updated

---

## Benefits of Removal

1. **Simpler Schema:** 13 fewer columns to maintain
2. **Clearer Intent:** Pure YOLO system, no confusion
3. **Better Performance:** Fewer columns to query/index
4. **Easier Maintenance:** One source of truth for detections
5. **Type Safety:** No mixing of legacy and new fields

---

## Post-Removal Verification

```sql
-- Verify legacy columns are gone
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'execution_analysis'
  AND column_name IN ('risk_level', 'smoke_detected', 'flame_detected');
-- Should return 0 rows

-- Verify YOLO columns exist
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'execution_analysis'
  AND column_name IN ('alert_level', 'has_fire', 'has_smoke', 'detection_count');
-- Should return 4 rows

-- Check recent extractions have YOLO data
SELECT
  execution_id,
  alert_level,
  has_fire,
  has_smoke,
  detection_count,
  yolo_model_version
FROM execution_analysis
ORDER BY analysis_timestamp DESC
LIMIT 5;
```

---

**Ready to execute?** This is a one-way migration. Legacy field data will be permanently lost.

**Recommendation:** Proceed with migration 004, then systematically update code files listed above.
