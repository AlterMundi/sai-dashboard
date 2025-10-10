# SAI Dashboard: 2-Stage ETL Architecture

## Philosophy

**Extract only what is available at each stage. Never assume, never default data.**

Each stage processes data based on:
1. **What information is accessible** at that point in time
2. **What processing can be done** without blocking
3. **What fields are mandatory** vs optional in the schema

---

## Data Flow Overview

```
n8n Execution (COMPLETED)
         ↓
    PostgreSQL TRIGGER
         ↓
    PostgreSQL NOTIFY
         ↓
[STAGE 1: IMMEDIATE EXTRACTION]
    - Execution metadata (id, status, timestamps)
    - FAST: No JSON parsing
    - Insert minimal record
         ↓
    Dashboard DB: executions table (PARTIAL)
         ↓
[STAGE 2: DEEP EXTRACTION]
    - Parse execution_data JSON blob
    - Extract images, analysis, model info
    - Update related tables
         ↓
    Dashboard DB: COMPLETE RECORD
    - execution_analysis
    - execution_images
    - execution_notifications
```

---

## Stage 1: Immediate Extraction (Trigger-Based)

### Objective
Capture execution metadata **immediately** when n8n execution completes, without deep processing.

### Data Source
`execution_entity` table in n8n database (lightweight metadata)

### Available Information
```sql
SELECT
  id,                    -- ✅ Available
  "workflowId",          -- ✅ Available
  "startedAt",           -- ✅ Available
  "stoppedAt",           -- ✅ Available
  status,                -- ✅ Available
  mode                   -- ✅ Available
FROM execution_entity
WHERE id = NEW.id;
```

### What We CAN Extract
- ✅ execution_id
- ✅ workflow_id
- ✅ execution_timestamp
- ✅ completion_timestamp
- ✅ duration_ms (calculated: stoppedAt - startedAt)
- ✅ status
- ✅ mode

### What We CANNOT Extract (requires Stage 2)
- ❌ image_data (in execution_data JSON blob)
- ❌ analysis text (in execution_data JSON blob)
- ❌ model_version (in Ollama node output)
- ❌ risk_level (requires analysis parsing)
- ❌ confidence_score (requires analysis parsing)
- ❌ node_id (may be in webhook metadata)
- ❌ telegram status (in Telegram node output)

### Stage 1 Database Operations

**Insert into `executions` table:**
```sql
INSERT INTO executions (
  id,
  workflow_id,
  execution_timestamp,
  completion_timestamp,
  duration_ms,
  status,
  mode,
  -- NULL fields (to be filled by Stage 2)
  node_id,
  camera_id
) VALUES (
  ${execution_id},
  ${workflow_id},
  ${started_at},
  ${stopped_at},
  ${duration_ms},
  ${status},
  ${mode},
  NULL,  -- node_id: unknown until Stage 2
  NULL   -- camera_id: unknown until Stage 2
);
```

**Mark for Stage 2 processing:**
```sql
INSERT INTO etl_processing_queue (
  execution_id,
  stage,
  status,
  priority,
  queued_at
) VALUES (
  ${execution_id},
  'stage2',
  'pending',
  CASE
    WHEN ${status} = 'success' THEN 1
    ELSE 5
  END,
  NOW()
);
```

### Stage 1 Implementation

```typescript
interface Stage1Payload {
  execution_id: number;
  workflow_id: string;
  started_at: string;
  stopped_at: string;
  status: string;
  mode: string;
}

class Stage1ETLService {
  /**
   * FAST: Only touches execution_entity table
   * NO JSON parsing, NO deep queries
   */
  async processStage1(payload: Stage1Payload): Promise<void> {
    const duration_ms = new Date(payload.stopped_at).getTime() -
                        new Date(payload.started_at).getTime();

    // Insert minimal execution record
    await this.dashboardDB.query(`
      INSERT INTO executions (
        id, workflow_id, execution_timestamp, completion_timestamp,
        duration_ms, status, mode, node_id, camera_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)
      ON CONFLICT (id) DO NOTHING
    `, [
      payload.execution_id,
      payload.workflow_id,
      payload.started_at,
      payload.stopped_at,
      duration_ms,
      payload.status,
      payload.mode
    ]);

    // Queue for Stage 2
    await this.queueStage2(payload.execution_id, payload.status);
  }
}
```

---

## Stage 2: Deep Extraction (Async Processing)

### Objective
Extract all available data from `execution_data` JSON blob asynchronously.

### Data Source
`execution_data` table in n8n database (heavy JSON blob)

### Available Information
```sql
SELECT data
FROM execution_data
WHERE "executionId" = ${execution_id};
```

The `data` JSONB contains the complete n8n workflow execution state:
- Webhook input
- Ollama node output
- Telegram node output
- All intermediate data

### Extraction Strategy: Parse What Exists

```typescript
interface Stage2ExtractionResult {
  // Image data
  image_base64: string | null;

  // Analysis data
  analysis_text: string | null;
  model_name: string | null;      // From Ollama node metadata
  model_version: string | null;    // From Ollama node metadata
  risk_level: string | null;       // Parsed from analysis text
  confidence: number | null;       // Parsed from analysis text

  // Detection flags
  smoke_detected: boolean;
  flame_detected: boolean;
  heat_detected: boolean;

  // Node assignment
  node_id: string | null;
  camera_id: string | null;

  // Telegram notification
  telegram_sent: boolean;
  telegram_message_id: number | null;
}
```

### Extraction Logic: Try Multiple Paths

```typescript
class Stage2Extractor {
  extractFromExecutionData(data: any): Stage2ExtractionResult {
    return {
      // Image: Try multiple locations
      image_base64: this.extractImage(data),

      // Analysis: From Ollama node output
      analysis_text: this.extractAnalysis(data),
      model_name: this.extractModelName(data),
      model_version: this.extractModelVersion(data),
      risk_level: this.extractRiskLevel(data),
      confidence: this.extractConfidence(data),

      // Detections: Parse from analysis text
      smoke_detected: this.detectSmoke(data),
      flame_detected: this.detectFlame(data),
      heat_detected: this.detectHeat(data),

      // Node: From webhook headers or payload
      node_id: this.extractNodeId(data),
      camera_id: this.extractCameraId(data),

      // Telegram: From Telegram node output
      telegram_sent: this.extractTelegramStatus(data),
      telegram_message_id: this.extractTelegramMessageId(data)
    };
  }

  private extractModelName(data: any): string | null {
    // Strategy 1: Direct from Ollama node output
    const model = data?.nodeOutputData?.Ollama?.[0]?.json?.model;
    if (model) return model;

    // Strategy 2: From Ollama node metadata
    const metadata = data?.nodeMetadata?.Ollama;
    if (metadata?.model) return metadata.model;

    // Strategy 3: Parse from analysis text headers
    const analysis = this.extractAnalysis(data);
    if (analysis) {
      const modelMatch = analysis.match(/model[:\s]+([^\n\r,]+)/i);
      if (modelMatch) return modelMatch[1].trim();
    }

    return null; // Unknown - that's OK!
  }

  private extractModelVersion(data: any): string | null {
    // Only extract if explicitly present
    const version = data?.nodeOutputData?.Ollama?.[0]?.json?.version;
    return version || null; // NULL is acceptable
  }

  private extractImage(data: any): string | null {
    // Try all known locations in n8n structure
    const paths = [
      data?.nodeInputData?.Webhook?.[0]?.json?.body?.image,
      data?.nodeInputData?.Webhook?.[0]?.json?.image,
      data?.nodeOutputData?.Webhook?.[0]?.json?.image,
      data?.nodeInputData?.Ollama?.[0]?.json?.image
    ];

    for (const path of paths) {
      if (path && typeof path === 'string' && path.length > 1000) {
        return path.replace(/^data:image\/[a-z]+;base64,/, '');
      }
    }

    return null; // No image found - that's OK for some executions
  }

  private extractRiskLevel(data: any): string | null {
    const analysis = this.extractAnalysis(data);
    if (!analysis) return null;

    const lower = analysis.toLowerCase();

    if (lower.includes('critical')) return 'critical';
    if (lower.includes('high risk')) return 'high';
    if (lower.includes('medium risk')) return 'medium';
    if (lower.includes('low risk')) return 'low';
    if (lower.includes('no risk') || lower.includes('none')) return 'none';

    return null; // Unable to determine - that's OK
  }
}
```

### Stage 2 Database Operations

**Update `executions` table:**
```sql
UPDATE executions
SET
  node_id = $1,
  camera_id = $2,
  updated_at = NOW()
WHERE id = $3;
```

**Insert `execution_analysis` (all fields optional except execution_id):**
```sql
INSERT INTO execution_analysis (
  execution_id,
  risk_level,              -- nullable
  confidence_score,        -- nullable
  overall_assessment,      -- nullable
  model_version,           -- nullable (NO DEFAULT!)
  processing_time_ms,      -- nullable
  smoke_detected,
  flame_detected,
  heat_signature_detected,
  node_id,                 -- nullable
  camera_id                -- nullable
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
)
ON CONFLICT (execution_id) DO UPDATE SET
  risk_level = EXCLUDED.risk_level,
  confidence_score = EXCLUDED.confidence_score,
  overall_assessment = EXCLUDED.overall_assessment,
  model_version = EXCLUDED.model_version,
  -- ... etc
  updated_at = NOW();
```

**Insert `execution_images` (if image found):**
```sql
INSERT INTO execution_images (
  execution_id,
  original_path,
  size_bytes,
  format,
  extracted_at
) VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (execution_id) DO NOTHING;
```

**Insert `execution_notifications`:**
```sql
INSERT INTO execution_notifications (
  execution_id,
  telegram_sent,
  telegram_message_id,
  telegram_sent_at
) VALUES ($1, $2, $3, $4)
ON CONFLICT (execution_id) DO NOTHING;
```

---

## Database Schema: Supporting 2-Stage Processing

### New Table: `etl_processing_queue`

Tracks which executions need Stage 2 processing:

```sql
CREATE TABLE etl_processing_queue (
  id BIGSERIAL PRIMARY KEY,
  execution_id BIGINT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  stage VARCHAR(20) NOT NULL,  -- 'stage2'
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'
  priority INTEGER DEFAULT 5,  -- 1 = high, 5 = normal, 10 = low
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  queued_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  CONSTRAINT unique_execution_stage UNIQUE (execution_id, stage)
);

CREATE INDEX idx_etl_queue_pending ON etl_processing_queue(status, priority, queued_at)
  WHERE status = 'pending';
```

### Modified Tables: All Analysis Fields Nullable

**`executions` table:**
```sql
-- Minimal fields populated by Stage 1 (NOT NULL)
id BIGINT PRIMARY KEY NOT NULL
workflow_id VARCHAR(100) NOT NULL
execution_timestamp TIMESTAMPTZ NOT NULL
completion_timestamp TIMESTAMPTZ NOT NULL
duration_ms INTEGER NOT NULL
status VARCHAR(20) NOT NULL
mode VARCHAR(20) NOT NULL

-- Enhanced fields populated by Stage 2 (NULLABLE)
node_id VARCHAR(50) NULL
camera_id VARCHAR(50) NULL
```

**`execution_analysis` table:**
```sql
execution_id BIGINT PRIMARY KEY NOT NULL

-- ALL analysis fields are NULLABLE
risk_level VARCHAR(20) NULL
confidence_score NUMERIC(4,3) NULL
overall_assessment TEXT NULL
model_version VARCHAR(50) NULL  -- ⚠️ NO DEFAULT VALUE
processing_time_ms INTEGER NULL
smoke_detected BOOLEAN DEFAULT false
flame_detected BOOLEAN DEFAULT false
heat_signature_detected BOOLEAN DEFAULT false
node_id VARCHAR(50) NULL
camera_id VARCHAR(50) NULL
```

---

## Processing Guarantees

### Stage 1 Guarantees
- ✅ Execution record created within milliseconds of n8n completion
- ✅ Dashboard shows execution immediately (even without analysis)
- ✅ No blocking operations
- ✅ No JSON parsing overhead

### Stage 2 Guarantees
- ✅ Processes all queued executions asynchronously
- ✅ Retries on failure (max 3 attempts)
- ✅ Extracts ALL available data from n8n
- ✅ Gracefully handles missing data (NULL)
- ✅ Priority queue (high-risk executions first)

### Data Integrity
- ✅ NULL means "not available" or "not extracted yet"
- ✅ Never insert fake defaults
- ✅ UI handles NULL gracefully ("N/A", "Unknown", "Pending")
- ✅ Can re-run Stage 2 on any execution (idempotent)

---

## Stage 2 Processing Loop

```typescript
class Stage2ETLService {
  async start(): Promise<void> {
    // Process queue every 5 seconds
    setInterval(() => this.processBatch(), 5000);
  }

  private async processBatch(): Promise<void> {
    // Get next batch (priority order)
    const pending = await this.getNextBatch(10);

    for (const item of pending) {
      try {
        await this.markProcessing(item.execution_id);
        await this.processStage2(item.execution_id);
        await this.markCompleted(item.execution_id);
      } catch (error) {
        await this.markFailed(item.execution_id, error);
      }
    }
  }

  private async processStage2(executionId: number): Promise<void> {
    // 1. Fetch execution_data JSON from n8n
    const data = await this.fetchExecutionData(executionId);
    if (!data) {
      throw new Error('execution_data not found');
    }

    // 2. Extract all available information
    const extracted = this.extractor.extractFromExecutionData(data);

    // 3. Update executions table
    if (extracted.node_id || extracted.camera_id) {
      await this.updateExecution(executionId, extracted);
    }

    // 4. Insert/update analysis (ALL fields nullable)
    await this.upsertAnalysis(executionId, extracted);

    // 5. Process image (if present)
    if (extracted.image_base64) {
      await this.processImage(executionId, extracted.image_base64);
    }

    // 6. Insert notification status
    await this.insertNotification(executionId, extracted);
  }
}
```

---

## UI Handling of Partial Data

### Execution List
```typescript
// Show execution immediately after Stage 1
{
  id: 12345,
  timestamp: "2025-01-08T10:30:00Z",
  status: "success",
  // Stage 2 not yet processed
  riskLevel: null,          // Display: "Analyzing..."
  modelVersion: null,       // Display: "N/A"
  hasImage: false           // Display: placeholder icon
}
```

### Execution Detail View
```typescript
// Handle NULL gracefully
<div>
  <h3>Analysis</h3>
  <p>Risk Level: {riskLevel ?? "Not available"}</p>
  <p>Confidence: {confidence ? `${confidence}%` : "N/A"}</p>
  <p>Model: {modelVersion ?? "Unknown"}</p>
  <p>Analysis: {analysis ?? "Analysis pending or unavailable"}</p>
</div>
```

---

## Benefits of 2-Stage Architecture

1. **Speed**: Executions appear in dashboard instantly
2. **Reliability**: Heavy processing doesn't block triggers
3. **Data Quality**: Only real data, never fake defaults
4. **Scalability**: Stage 2 can process in parallel workers
5. **Debuggability**: Can inspect queue and retry failed extractions
6. **Flexibility**: Easy to add new extraction logic to Stage 2
7. **Transparency**: NULL clearly indicates "data not available"

---

## Migration from Current System

### Phase 1: Add Queue Table
```sql
-- Add processing queue
CREATE TABLE etl_processing_queue (...);

-- Backfill existing executions
INSERT INTO etl_processing_queue (execution_id, stage, status, priority)
SELECT id, 'stage2', 'pending', 5
FROM executions
WHERE id NOT IN (
  SELECT execution_id FROM execution_analysis
);
```

### Phase 2: Deploy Stage 1 Service
- Fast trigger-based insertion
- Queue Stage 2 processing

### Phase 3: Deploy Stage 2 Service
- Async processor with retry logic
- Extracts all available data

### Phase 4: Remove Old ETL
- Decommission simple-etl-service.ts
- Remove DEFAULT_MODEL_VERSION references

---

## Monitoring

### Metrics to Track
- Stage 1 processing time (should be < 100ms)
- Stage 2 queue depth
- Stage 2 processing time per execution
- Failed extractions (retry count)
- NULL rates per field (data quality indicator)

### Alerts
- Stage 2 queue depth > 1000 executions
- Stage 2 processing time > 10 seconds
- Failed extraction rate > 5%

---

## Conclusion

**The 2-stage ETL architecture respects data integrity:**

1. **Stage 1**: Fast, minimal, guaranteed data
2. **Stage 2**: Deep, best-effort, complete data
3. **NULL values**: Honest representation of missing data
4. **No defaults**: Never fake what we don't know

This design scales, maintains data quality, and provides a solid foundation for the SAI Dashboard.
