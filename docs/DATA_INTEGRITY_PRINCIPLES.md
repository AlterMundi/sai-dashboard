# SAI Dashboard: Data Integrity Principles

## Core Philosophy

**Never fake data. Extract what exists, mark what's missing as NULL.**

---

## The Problem We Fixed

### Before (Wrong Approach ❌)

```typescript
// Hardcoded/defaulted values pretending to be data
const modelVersion = 'qwen2.5vl:7b';  // ⚠️ Assuming what we don't know
const imagePath = '/mnt/raid1/n8n-backup/images';  // ⚠️ Configuration as data

// Insert fake defaults
INSERT INTO execution_analysis (model_version) VALUES ('qwen2.5vl:7b');
```

**Issues:**
- Can't distinguish between "model was qwen2.5vl:7b" and "we don't know the model"
- If SAI switches models, historical data is corrupted
- Configuration values pollute data layer
- Analytics become unreliable

### After (Correct Approach ✅)

```typescript
// Extract actual data from source
const modelVersion = extractFromOllamaNode(data) || null;  // ✅ Honest

// Insert real data or NULL
INSERT INTO execution_analysis (model_version) VALUES ($1);  -- NULL is OK
```

**Benefits:**
- NULL means "information not available" (honest)
- Can audit data quality: "How many executions have model_version = NULL?"
- Future extraction improvements can backfill NULL values
- Analytics are accurate

---

## Principle 1: Data vs Configuration

### Data (Belongs in Database)
Information that varies per execution and must be **extracted** from source:

✅ **Examples:**
- `model_version` - Which model analyzed this specific execution
- `confidence_score` - Confidence for this specific prediction
- `image_size` - Size of this specific image
- `processing_time_ms` - How long this execution took
- `node_id` - Which camera node captured this image

### Configuration (Belongs in ENV/Config)
System-wide settings that control **behavior** and are **set by operators**:

✅ **Examples:**
- `SAI_WORKFLOW_ID` - Which n8n workflow to monitor
- `IMAGE_CACHE_PATH` - Where to store images on disk
- `N8N_DB_HOST` - Where to connect for data
- `API_PORT` - Which port to listen on

### The Test

Ask: **"Does this value change per execution or is it constant for the system?"**

- Changes per execution → **DATA** (extract, allow NULL)
- Constant for system → **CONFIG** (environment variable)

---

## Principle 2: Nullable by Design

### Database Schema Design

```sql
-- BAD: Forcing non-null with defaults
model_version VARCHAR(50) NOT NULL DEFAULT 'qwen2.5vl:7b'  -- ❌ Lie

-- GOOD: Nullable with no default
model_version VARCHAR(50) NULL  -- ✅ Honest
```

### Why Nullable is Good

1. **Honesty**: NULL = "we don't know" (not "we're guessing")
2. **Data Quality Metrics**: Can measure % of executions with missing data
3. **Progressive Enhancement**: Can improve extraction logic and backfill NULLs
4. **No Pollution**: Historical data stays clean if extraction improves

### When to Use NOT NULL

Only when the field is **guaranteed to be available** at that stage:

```sql
-- Stage 1: These are ALWAYS available from execution_entity
id BIGINT NOT NULL
workflow_id VARCHAR(100) NOT NULL
execution_timestamp TIMESTAMPTZ NOT NULL
status VARCHAR(20) NOT NULL

-- Stage 2: These MIGHT be available from execution_data
model_version VARCHAR(50) NULL  -- Depends on Ollama node metadata
risk_level VARCHAR(20) NULL      -- Depends on analysis text parsing
confidence_score NUMERIC NULL    -- Depends on analysis format
```

---

## Principle 3: Staged Extraction

### Extract What You Can, When You Can

```
┌─────────────────────────────────────────────────────┐
│ Stage 1: Immediate (< 100ms)                       │
│ ─────────────────────────────────────               │
│ Source: execution_entity table (lightweight)        │
│ Extract:                                            │
│   ✅ execution_id                                   │
│   ✅ workflow_id                                    │
│   ✅ timestamps                                     │
│   ✅ status                                         │
│   ✅ image_base64 (if present)                     │
│   ❌ model_version (not available yet)             │
└─────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────┐
│ Stage 2: Deep Async (1-5 seconds)                  │
│ ─────────────────────────────────────               │
│ Source: execution_data JSON blob (heavy)            │
│ Extract:                                            │
│   ✅ analysis_text (if present)                    │
│   ✅ model_version (if in Ollama node metadata)    │
│   ✅ node_id (if in webhook headers)               │
│   ❌ Some fields still NULL (that's OK!)           │
└─────────────────────────────────────────────────────┘
```

### No Blocking, No Assumptions

- Stage 1 never waits for Stage 2
- Stage 2 extracts best-effort, accepts NULLs
- UI handles partial data gracefully

---

## Principle 4: Extraction Strategies

### Multiple Path Attempts (Stage 2)

```typescript
function extractModelVersion(data: any): string | null {
  // Try path 1: Ollama node output
  const model = data?.nodeOutputData?.Ollama?.[0]?.json?.model;
  if (model) return model;

  // Try path 2: Ollama node metadata
  const metadata = data?.nodeMetadata?.Ollama?.model;
  if (metadata) return metadata;

  // Try path 3: Parse from analysis text
  const analysis = data?.nodeOutputData?.Ollama?.[0]?.json?.response;
  if (analysis) {
    const match = analysis.match(/model[:\s]+([^\n,]+)/i);
    if (match) return match[1].trim();
  }

  // Exhausted all strategies
  return null;  // ✅ Honest: we don't know
}
```

### When to Return NULL

- ✅ Field not present in source data
- ✅ All extraction strategies failed
- ✅ Data exists but is malformed/unparseable
- ✅ Source system didn't provide that information

### When to Return Default

- ❌ Never for data fields
- ✅ Only for configuration/system settings

---

## Principle 5: UI Handles Partial Data

### Display NULL Gracefully

```typescript
// ❌ BAD: Assume or hide
<div>Model: {modelVersion}</div>  // Blank if null, confusing

// ✅ GOOD: Explicit
<div>Model: {modelVersion ?? "Unknown"}</div>
<div>Model: {modelVersion || <em>Not available</em>}</div>
<div>Model: {modelVersion ? modelVersion : <Badge>Pending</Badge>}</div>
```

### Progressive Disclosure

```typescript
// Show what we know, indicate what's missing
<ExecutionCard>
  <Timestamp>{execution.timestamp}</Timestamp>  ✅ Always available
  <Status>{execution.status}</Status>            ✅ Always available

  {execution.riskLevel ? (
    <RiskBadge level={execution.riskLevel} />    ✅ If available
  ) : (
    <Badge variant="gray">Analyzing...</Badge>   ✅ Honest about missing
  )}

  {execution.modelVersion && (
    <ModelInfo>{execution.modelVersion}</ModelInfo>  ✅ Only show if known
  )}
</ExecutionCard>
```

---

## Principle 6: Data Quality Metrics

### Monitor NULL Rates

```sql
-- How complete is our data?
SELECT
  COUNT(*) as total_executions,
  COUNT(model_version) as with_model,
  COUNT(*) - COUNT(model_version) as missing_model,
  ROUND(100.0 * COUNT(model_version) / COUNT(*), 2) as model_completeness_pct
FROM execution_analysis;

-- Output:
-- total_executions | with_model | missing_model | model_completeness_pct
-- 9956             | 3450       | 6506          | 34.67
```

This tells us:
- 34.67% of executions have model version
- 65.33% don't (extraction needs improvement OR source data lacks it)
- We have real data quality metrics

### Track Extraction Success Over Time

```sql
-- Measure extraction improvements
SELECT
  DATE(execution_timestamp) as date,
  COUNT(*) as total,
  COUNT(model_version) as extracted,
  ROUND(100.0 * COUNT(model_version) / COUNT(*), 1) as success_rate
FROM executions e
LEFT JOIN execution_analysis ea ON ea.execution_id = e.id
WHERE execution_timestamp >= NOW() - INTERVAL '7 days'
GROUP BY DATE(execution_timestamp)
ORDER BY date;

-- See if extraction logic improvements increase success_rate
```

---

## Principle 7: Backfill Capability

### NULL Enables Reprocessing

Because we use NULL (not fake defaults), we can:

1. **Identify what needs reprocessing:**
```sql
SELECT execution_id
FROM execution_analysis
WHERE model_version IS NULL;
```

2. **Reprocess with improved extraction:**
```typescript
// New extraction logic
const improvedModelExtractor = (data) => {
  // Now we check 5 paths instead of 3!
  // ...
};

// Backfill previously-NULL records
for (const executionId of needsReprocessing) {
  const data = await fetchExecutionData(executionId);
  const modelVersion = improvedModelExtractor(data);

  if (modelVersion) {
    await db.query(
      'UPDATE execution_analysis SET model_version = $1 WHERE execution_id = $2',
      [modelVersion, executionId]
    );
  }
}
```

3. **Measure improvement:**
```sql
-- Before backfill: 34% completeness
-- After backfill: 78% completeness  ✅ Real improvement
```

### Can't Do This With Fake Defaults

If we had used `DEFAULT 'qwen2.5vl:7b'`, we'd have:
- ❌ No way to identify which records need reprocessing
- ❌ Fake data mixed with real data
- ❌ Can't measure extraction success
- ❌ Historical data corrupted

---

## Implementation Checklist

### When Adding a New Data Field

- [ ] Is this **data** (varies per execution) or **config** (system setting)?
- [ ] If data: Make field **nullable** in schema
- [ ] If data: Extract from source, return `null` if unavailable
- [ ] If config: Add to `.env.example` and `config/index.ts`
- [ ] Update UI to handle `null` gracefully
- [ ] Add data quality metric query
- [ ] Document extraction strategy

### Code Review Questions

When reviewing extraction code:
- [ ] Does it try multiple extraction paths?
- [ ] Does it return `null` when extraction fails?
- [ ] Does it avoid fake defaults?
- [ ] Does it log when extraction fails (for debugging)?
- [ ] Is the extraction logic idempotent (safe to re-run)?

### Testing

Test with real data scenarios:
- [ ] Complete execution (all fields present)
- [ ] Partial execution (some fields missing)
- [ ] Malformed execution (data present but unparseable)
- [ ] Empty execution (minimal data only)

Verify UI handles all cases gracefully.

---

## Anti-Patterns to Avoid

### ❌ Fake Defaults
```typescript
const modelVersion = data.model || 'qwen2.5vl:7b';  // ❌ Lying
```

### ❌ Empty Strings Instead of NULL
```typescript
const modelVersion = data.model || '';  // ❌ '' is not NULL
// In database: '' looks like data, NULL is clearly missing
```

### ❌ Magic Values
```typescript
const modelVersion = data.model || 'UNKNOWN';  // ❌ Pollutes data
// Later: SELECT DISTINCT model_version → includes 'UNKNOWN' in results
```

### ❌ Mixing Data and Config
```typescript
// ❌ Configuration pretending to be data
INSERT INTO execution_analysis (image_path)
VALUES ('/mnt/raid1/n8n-backup/images/123.jpg');
// Should be: configuration defines BASE path, data has relative path
```

---

## Examples in SAI Dashboard

### Fixed: Model Version
**Before:** `DEFAULT 'qwen2.5vl:7b'`
**After:** `NULL` with extraction from Ollama node metadata

### Fixed: Image Paths
**Before:** Hardcoded `/mnt/raid1/n8n-backup/images` in code
**After:** `IMAGE_BASE_PATH` env var (config) + relative path in DB (data)

### Fixed: Workflow ID
**Before:** Hardcoded `'yDbfhooKemfhMIkC'` everywhere
**After:** `SAI_WORKFLOW_ID` env var (config)

### Still Data (Correctly Nullable)
- `confidence_score` - NULL if analysis doesn't provide it
- `node_id` - NULL if webhook doesn't identify source
- `camera_id` - NULL if unable to determine
- `processing_time_ms` - NULL if not tracked

---

## Conclusion

**Data integrity = Honest representation of what we know and don't know**

- Use NULL for missing data
- Never fake defaults for data fields
- Extract what exists, admit what doesn't
- UI handles partial data gracefully
- Measure and improve data quality over time

This foundation enables:
- ✅ Reliable analytics
- ✅ Data quality metrics
- ✅ Backfill capability
- ✅ System evolution without data corruption
- ✅ User trust in the dashboard

---

## Further Reading

- [TWO_STAGE_ETL_ARCHITECTURE.md](./TWO_STAGE_ETL_ARCHITECTURE.md) - Staged extraction design
- [ENV_MIGRATION.md](../ENV_MIGRATION.md) - Configuration vs data separation
- Database migrations: `/database/migrations/`
