# SAI Dashboard Data Architecture Analysis
**Date**: October 7, 2025
**Status**: Production system experiencing log flooding and data flow confusion

---

## 🎯 Executive Summary

The SAI Dashboard is suffering from **architectural debt** that prevents proper frontend development:

1. **Log flooding**: 636 log lines/hour from duplicate PostgreSQL notifications
2. **Duplicate processing**: Every execution processed 2x due to trigger configuration
3. **Race conditions**: INSERT conflicts creating noise but appearing to succeed
4. **Confused data flows**: 3 different ETL services with unclear ownership
5. **Missing domain logic**: No camera assignment, node correlation, or incident detection
6. **Fragile extraction**: Heuristic-based JSON parsing instead of structured schema

**Impact**:
- dmesg flooded with service logs
- Frontend blocked by unreliable data
- Developers confused about system behavior
- Production appears "working" but is fundamentally broken

---

## 📊 Current Architecture (As-Built)

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ N8N Workflow (execution_entity + execution_data)            │
│  Step 1: Webhook receives image from camera                 │
│  Step 2: Ollama LLM analyzes image for fire/smoke          │
│  Step 3: Telegram sends notification if risk detected       │
│  Step 4: Stores entire workflow state as JSON blob          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ PostgreSQL Trigger Fires 2x:
                   ├─ Event #1: INSERT execution_entity
                   ├─ Event #2: UPDATE status = 'success'
                   │
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ PostgreSQL NOTIFY Channel: "sai_execution_ready"            │
│  Payload: {execution_id, workflow_id, status, timestamps}   │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ DUPLICATE NOTIFICATIONS (2x per execution)
                   │
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ Simple ETL Service (Node.js + pg.Client LISTEN)             │
│  Line 151: notification handler receives 2x duplicates      │
│  Line 180: Check if execution exists (race condition)       │
│  Line 198: INSERT INTO executions (one succeeds, one fails) │
│  Line 258: Extract data with heuristic search (fragile!)    │
│  Line 350: Process images to filesystem                     │
│  Line 400: Insert analysis (simple regex parsing)           │
│  Line 444: Insert notification status                       │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ SAI Dashboard Database (sai_dashboard)                      │
│  ├── executions (main records)                              │
│  ├── execution_analysis (AI risk assessment)                │
│  ├── execution_images (filesystem paths only)               │
│  ├── execution_notifications (telegram delivery)            │
│  ├── expert_reviews (human review - UNUSED)                 │
│  ├── monitoring_nodes (regional nodes - NO DATA)            │
│  └── node_cameras (camera metadata - NO DATA)               │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ Dashboard API Services (Express + pg.Pool)                  │
│  ├── new-execution-service.ts (queries executions)          │
│  ├── enhanced-analysis.ts (enriched analytics)              │
│  ├── expert-review.ts (review workflows - UNUSED)           │
│  ├── image.ts (serves cached images)                        │
│  └── tiered-sse.ts (real-time SSE updates)                  │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────────┐
│ Frontend (React + SSEContext)                               │
│  └── Real-time dashboard with execution stream              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔴 Critical Problems

### Problem 1: Duplicate Trigger Firing

**File**: `database/n8n_simple_triggers.sql:42-46`

```sql
CREATE TRIGGER sai_execution_notify_trigger
    AFTER INSERT OR UPDATE OF status ON execution_entity  ← BOTH!
    FOR EACH ROW
    WHEN (NEW."workflowId"::text = 'yDbfhooKemfhMIkC' AND NEW.status IN ('success', 'error'))
    EXECUTE FUNCTION notify_sai_execution();
```

**What happens**:
1. n8n workflow starts → INSERTs row with status = 'running'
2. Trigger does NOT fire (status != 'success')
3. Workflow completes → UPDATEs status = 'success'
4. Trigger fires (UPDATE detected) → Notification #1
5. **BUG**: n8n also does something that triggers INSERT detection → Notification #2

**Evidence from logs**:
```
Oct 07 17:05:59 📬 Received notification for execution 185568
Oct 07 17:05:59 📬 Received notification for execution 185568  ← DUPLICATE!
Oct 07 17:05:59 🔄 Processing execution 185568...
Oct 07 17:05:59 🔄 Processing execution 185568...  ← DUPLICATE!
Oct 07 17:05:59 ❌ Error: duplicate key violates unique constraint "executions_pkey"
Oct 07 17:05:59 ✅ Successfully processed execution 185568  ← One succeeds!
```

**Impact**:
- 2x processing load
- Race condition on INSERT
- 636 log lines per hour (should be ~300)
- Confusing error messages that "appear" to work

### Problem 2: Race Condition in ETL

**File**: `backend/src/services/simple-etl-service.ts:179-185`

```typescript
// Check if already processed
const existing = await this.dashboardPool.query('SELECT id FROM executions WHERE id = $1', [execution_id]);
if (existing.rows.length > 0) {
  console.log(`⏭️ Execution ${execution_id} already processed, skipping`);
  this.metrics.skipped++;
  return;
}
```

**What happens**:
1. Notification #1 arrives → checks database → "not exists" → proceeds
2. Notification #2 arrives **simultaneously** → checks database → "not exists" → proceeds
3. Both try to INSERT → one succeeds, one fails with duplicate key error
4. The failure is caught on line 240-252 and "handled" but logs noise

**Why this happens**:
- No transaction isolation between check and insert
- PostgreSQL's default READ COMMITTED allows this race
- Solution: Use `INSERT ... ON CONFLICT` (idempotent)

### Problem 3: Fragile Data Extraction

**File**: `backend/src/services/simple-etl-service.ts:289-344`

```typescript
/**
 * UNIFIED extraction logic that works with actual n8n data structure
 */
private extractExecutionDataUnified(data: any): any {
  // N8N stores data as a flat array/object with numeric keys
  // Search through all entries to find the data we need

  for (const entry of entries) {
    if (typeof entry === 'string' && entry.length > 100000) {
      // This looks like a base64 image  ← HEURISTIC!
      if (entry.startsWith('/9j/') || entry.startsWith('iVBORw0K')) {
        imageBase64 = entry;
      }
    } else if (typeof entry === 'string' && entry.length > 50 && entry.length < 10000) {
      // This might be analysis text  ← GUESSING!
      if (entry.includes('risk') || entry.includes('fire') || entry.includes('smoke')) {
        analysis = entry;
      }
    }
    // ... recursive search through random JSON structure
  }
}
```

**Problems**:
- ❌ No schema validation
- ❌ Guesses based on string length
- ❌ Searches for keywords like 'fire' (what if analysis says "no fire"?)
- ❌ Will break if n8n changes workflow structure
- ❌ Can't extract camera_id, location, or other metadata

**Impact**:
- Missing critical data (camera_id, node_id always NULL)
- Unable to implement geographic features
- Unable to correlate multi-camera incidents
- Fragile to workflow changes

### Problem 4: Missing Domain Logic

**Current state**: ETL just copies data, no enrichment

**What's missing**:
1. **Camera Assignment**: executions.camera_id always NULL
2. **Node Assignment**: executions.node_id always NULL
3. **Incident Correlation**: incident_id always NULL
4. **Expert Assignment**: expert_reviews table empty
5. **Geographic Search**: Can't filter by location (no lat/lng)
6. **Multi-camera Detection**: Can't detect same fire from multiple angles

**Why this blocks frontend**:
- Can't show "fires by region"
- Can't show "camera coverage map"
- Can't implement "expert review queue"
- Can't implement "incident timeline"
- Can't implement "alert escalation"

### Problem 5: Service Confusion

**Three ETL services exist**:

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `simple-etl-service.ts` | 512 | PostgreSQL NOTIFY listener | **ACTIVE** |
| `live-etl-service.ts` | ? | Unknown | Abandoned? |
| `etl-service.ts` | ? | Unknown | Abandoned? |

**Questions**:
- Why do three exist?
- Which one is "correct"?
- Are they doing different things?
- Dead code removal needed?

---

## ✅ Proposed Architecture

### Design Principles

1. **Explicit Schema**: n8n outputs structured JSON, not random blobs
2. **Idempotent Processing**: Same execution processed N times = same result
3. **Fail-Safe**: Errors logged but don't crash pipeline
4. **Separation of Concerns**: Extract → Transform → Load → Enrich
5. **Domain-Driven**: Business logic separated from ETL plumbing

### Phase 1: Stop the Bleeding (Immediate)

#### Fix 1.1: Trigger Fires Only Once

```sql
-- File: database/n8n_simple_triggers_v2.sql
DROP TRIGGER IF EXISTS sai_execution_notify_trigger ON execution_entity;

CREATE TRIGGER sai_execution_notify_trigger
    AFTER UPDATE OF status ON execution_entity  -- ONLY UPDATE, not INSERT
    FOR EACH ROW
    WHEN (
        NEW."workflowId"::text = 'yDbfhooKemfhMIkC'
        AND NEW.status = 'success'  -- Only success (errors handled separately)
        AND OLD.status != NEW.status  -- Only when status CHANGES
    )
    EXECUTE FUNCTION notify_sai_execution();

-- Add comment for future developers
COMMENT ON TRIGGER sai_execution_notify_trigger ON execution_entity IS
'Fires ONCE when SAI workflow completes successfully. Only on status change to prevent duplicates.';
```

**Expected Result**:
- Log volume drops 50% (636 → ~318 lines/hour)
- No more duplicate processing
- No more race condition errors

#### Fix 1.2: Make ETL Idempotent

```typescript
// File: backend/src/services/simple-etl-service.ts:198-213
// Replace INSERT with INSERT ... ON CONFLICT

await this.dashboardPool.query(`
  INSERT INTO executions (
    id, workflow_id, execution_timestamp, completion_timestamp,
    duration_ms, status, mode, node_id, camera_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (id) DO UPDATE SET
    completion_timestamp = EXCLUDED.completion_timestamp,
    duration_ms = EXCLUDED.duration_ms,
    status = EXCLUDED.status,
    updated_at = NOW()
`, [...]);

// Similar for execution_analysis, execution_images, execution_notifications
// All use ON CONFLICT DO NOTHING or DO UPDATE
```

**Expected Result**:
- No more duplicate key errors
- Processing same execution twice is safe
- Clean logs

#### Fix 1.3: Add Observability

```typescript
// File: backend/src/services/simple-etl-service.ts (add metrics)

interface ETLMetrics {
  // Current
  processed: number;
  failed: number;
  skipped: number;

  // NEW
  duplicates_handled: number;  // ON CONFLICT triggered
  extraction_failures: number;  // Data not in expected format
  image_processing_time_ms: number[];  // Performance tracking
  analysis_parsing_failures: number;  // Regex extraction failed
  last_100_executions: ExecutionSummary[];  // Debugging
}

// Log summary every 10 executions
if (this.metrics.processed % 10 === 0) {
  logger.info('ETL Metrics Summary', {
    processed: this.metrics.processed,
    failed: this.metrics.failed,
    duplicates: this.metrics.duplicates_handled,
    avg_processing_time: this.getAverageProcessingTime(),
    success_rate: this.getSuccessRate()
  });
}
```

### Phase 2: Structured Data (Medium Priority)

#### Fix 2.1: Define n8n Output Schema

**File**: `docs/n8n-output-schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SAI Execution Output",
  "type": "object",
  "required": ["execution_id", "timestamp", "camera", "image", "analysis"],
  "properties": {
    "execution_id": {
      "type": "integer",
      "description": "n8n execution_entity.id"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time"
    },
    "camera": {
      "type": "object",
      "required": ["id", "node_id"],
      "properties": {
        "id": {"type": "string", "pattern": "^CAM_NODE\\d{3}_\\d{2}$"},
        "node_id": {"type": "string", "pattern": "^NODE_\\d{3}$"},
        "location": {
          "type": "object",
          "properties": {
            "lat": {"type": "number", "minimum": -90, "maximum": 90},
            "lng": {"type": "number", "minimum": -180, "maximum": 180}
          }
        }
      }
    },
    "image": {
      "type": "object",
      "required": ["base64", "format"],
      "properties": {
        "base64": {"type": "string"},
        "format": {"type": "string", "enum": ["jpeg", "png"]},
        "size_bytes": {"type": "integer", "minimum": 0},
        "width": {"type": "integer", "minimum": 0},
        "height": {"type": "integer", "minimum": 0}
      }
    },
    "analysis": {
      "type": "object",
      "required": ["model", "risk_level", "confidence"],
      "properties": {
        "model": {"type": "string"},
        "risk_level": {"type": "string", "enum": ["critical", "high", "medium", "low", "none"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "detections": {
          "type": "object",
          "properties": {
            "smoke": {"type": "boolean"},
            "flame": {"type": "boolean"},
            "heat_signature": {"type": "boolean"},
            "motion": {"type": "boolean"},
            "vehicle": {"type": "boolean"},
            "people": {"type": "boolean"}
          }
        },
        "raw_response": {"type": "string"}
      }
    },
    "notifications": {
      "type": "object",
      "properties": {
        "telegram": {
          "type": "object",
          "properties": {
            "sent": {"type": "boolean"},
            "message_id": {"type": "integer"},
            "chat_id": {"type": "string"},
            "error": {"type": "string"}
          }
        }
      }
    }
  }
}
```

#### Fix 2.2: Implement Schema Validator

```typescript
// File: backend/src/services/schema-validator.ts

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../../docs/n8n-output-schema.json';

export class ExecutionSchemaValidator {
  private ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({ allErrors: true });
    addFormats(this.ajv);
    this.ajv.addSchema(schema, 'execution');
  }

  validate(data: any): { valid: boolean; errors?: string[] } {
    const valid = this.ajv.validate('execution', data);

    if (!valid) {
      return {
        valid: false,
        errors: this.ajv.errors?.map(e => `${e.instancePath} ${e.message}`) || []
      };
    }

    return { valid: true };
  }
}
```

#### Fix 2.3: Update n8n Workflow

**Action Required**: Modify n8n workflow to output structured JSON

**Current n8n workflow** (guessed structure):
```
Webhook → Ollama Analysis → Telegram → Store Random JSON
```

**Proposed n8n workflow**:
```
Webhook
  ↓
Extract Camera Metadata (from webhook headers/body)
  ↓
Ollama Analysis
  ↓
Format Structured Output (Function node)
  ↓
Telegram Notification
  ↓
Store Structured JSON
  ↓
PostgreSQL (execution_data updated)
```

**New Function Node** (add to n8n workflow):
```javascript
// n8n Function Node: "Format SAI Output"
const executionId = $node["Webhook"].json["execution_id"];
const imageBase64 = $node["Webhook"].json["image"];
const analysisResponse = $node["Ollama"].json["response"];
const telegramResult = $node["Telegram"].json;

return {
  json: {
    execution_id: executionId,
    timestamp: new Date().toISOString(),
    camera: {
      id: "CAM_NODE001_01",  // TODO: Extract from webhook
      node_id: "NODE_001",   // TODO: Extract from webhook
      location: {
        lat: -31.4135,
        lng: -64.1811
      }
    },
    image: {
      base64: imageBase64,
      format: "jpeg",
      size_bytes: imageBase64.length
    },
    analysis: {
      model: "qwen2.5vl:7b",
      risk_level: extractRiskLevel(analysisResponse),  // Helper function
      confidence: extractConfidence(analysisResponse),
      detections: {
        smoke: analysisResponse.includes("smoke"),
        flame: analysisResponse.includes("flame") || analysisResponse.includes("fire"),
        heat_signature: analysisResponse.includes("heat")
      },
      raw_response: analysisResponse
    },
    notifications: {
      telegram: {
        sent: telegramResult.success,
        message_id: telegramResult.message_id,
        chat_id: telegramResult.chat.id
      }
    }
  }
};
```

### Phase 3: Domain Logic (High Value)

#### Fix 3.1: ETL Pipeline Pattern

```typescript
// File: backend/src/services/etl-pipeline/index.ts

export class ETLPipeline {
  constructor(
    private extractor: DataExtractor,
    private transformer: DataTransformer,
    private loader: DataLoader,
    private enricher: DomainEnricher
  ) {}

  async process(executionId: number): Promise<void> {
    try {
      // Stage 1: Extract raw data (with schema validation)
      const rawData = await this.extractor.extract(executionId);

      // Stage 2: Transform to domain models
      const models = await this.transformer.transform(rawData);

      // Stage 3: Load into database (idempotent)
      await this.loader.load(models);

      // Stage 4: Enrich with domain logic (async, can fail)
      await this.enricher.enrich(executionId);

    } catch (error) {
      logger.error('ETL pipeline failed', { executionId, error });
      throw error;
    }
  }
}
```

#### Fix 3.2: Data Extractor (with validation)

```typescript
// File: backend/src/services/etl-pipeline/extractor.ts

export class DataExtractor {
  constructor(
    private n8nPool: Pool,
    private validator: ExecutionSchemaValidator
  ) {}

  async extract(executionId: number): Promise<ExecutionData> {
    // Get execution_data from n8n database
    const result = await this.n8nPool.query(`
      SELECT ed.data
      FROM execution_data ed
      WHERE ed."executionId" = $1
    `, [executionId]);

    if (result.rows.length === 0) {
      throw new Error(`No data found for execution ${executionId}`);
    }

    const rawData = JSON.parse(result.rows[0].data);

    // Validate against schema
    const validation = this.validator.validate(rawData);
    if (!validation.valid) {
      logger.error('Schema validation failed', {
        executionId,
        errors: validation.errors
      });

      // Fallback to heuristic extraction for backwards compatibility
      return this.fallbackExtraction(rawData);
    }

    return rawData as ExecutionData;
  }

  private fallbackExtraction(rawData: any): ExecutionData {
    // Keep the old extractExecutionDataUnified logic as fallback
    // for executions created before schema was implemented
    logger.warn('Using fallback extraction (pre-schema data)');
    // ... existing heuristic code ...
  }
}
```

#### Fix 3.3: Domain Enricher

```typescript
// File: backend/src/services/etl-pipeline/enricher.ts

export class DomainEnricher {
  constructor(private dashboardPool: Pool) {}

  async enrich(executionId: number): Promise<void> {
    // Run enrichments in parallel (they're independent)
    await Promise.allSettled([
      this.calculateAlertPriority(executionId),
      this.correlateIncidents(executionId),
      this.assignExpertReview(executionId),
      this.updateNodeStatistics(executionId)
    ]);
  }

  private async calculateAlertPriority(executionId: number): Promise<void> {
    // Business logic: Alert priority based on:
    // - Risk level
    // - Confidence score
    // - Time of day
    // - Recent detections from same camera
    // - Expert review history

    const result = await this.dashboardPool.query(`
      UPDATE execution_analysis
      SET alert_priority = CASE
        WHEN risk_level = 'critical' AND confidence_score > 0.9 THEN 'critical'
        WHEN risk_level = 'high' AND confidence_score > 0.7 THEN 'high'
        WHEN risk_level IN ('medium', 'low') THEN 'normal'
        ELSE 'low'
      END,
      response_required = (risk_level IN ('critical', 'high') AND confidence_score > 0.8)
      WHERE execution_id = $1
    `, [executionId]);
  }

  private async correlateIncidents(executionId: number): Promise<void> {
    // Business logic: Group related detections into incidents
    // - Same camera within 1 hour
    // - Multiple cameras within 5km and 30 minutes
    // - Escalating risk levels

    const detection = await this.dashboardPool.query(`
      SELECT ea.*, e.camera_id, e.execution_timestamp
      FROM execution_analysis ea
      JOIN executions e ON ea.execution_id = e.id
      WHERE ea.execution_id = $1 AND ea.risk_level IN ('high', 'critical')
    `, [executionId]);

    if (detection.rows.length === 0) return;

    // Find nearby recent detections
    const nearbyDetections = await this.dashboardPool.query(`
      SELECT DISTINCT ea.incident_id
      FROM execution_analysis ea
      JOIN executions e ON ea.execution_id = e.id
      WHERE e.camera_id = $1
      AND e.execution_timestamp BETWEEN $2 - INTERVAL '1 hour' AND $2
      AND ea.incident_id IS NOT NULL
      LIMIT 1
    `, [detection.rows[0].camera_id, detection.rows[0].execution_timestamp]);

    if (nearbyDetections.rows.length > 0) {
      // Add to existing incident
      await this.dashboardPool.query(`
        UPDATE execution_analysis
        SET incident_id = $1
        WHERE execution_id = $2
      `, [nearbyDetections.rows[0].incident_id, executionId]);
    } else {
      // Create new incident
      const newIncident = await this.dashboardPool.query(`
        INSERT INTO incidents (incident_type, severity, first_detection, status)
        VALUES ('single_detection', $1, $2, 'active')
        RETURNING id
      `, [detection.rows[0].risk_level, detection.rows[0].execution_timestamp]);

      await this.dashboardPool.query(`
        UPDATE execution_analysis
        SET incident_id = $1
        WHERE execution_id = $2
      `, [newIncident.rows[0].id, executionId]);
    }
  }

  private async assignExpertReview(executionId: number): Promise<void> {
    // Business logic: Assign high-risk detections to experts
    // - Only for risk_level = 'high' or 'critical'
    // - Only if confidence < 0.95 (uncertain detections)
    // - Round-robin assignment to available experts

    const needsReview = await this.dashboardPool.query(`
      SELECT ea.*
      FROM execution_analysis ea
      WHERE ea.execution_id = $1
      AND ea.risk_level IN ('high', 'critical')
      AND ea.confidence_score < 0.95
    `, [executionId]);

    if (needsReview.rows.length === 0) return;

    // Find available expert (round-robin)
    const expert = await this.dashboardPool.query(`
      SELECT u.id
      FROM users u
      LEFT JOIN expert_reviews er ON er.expert_id = u.id AND er.status IN ('pending', 'in_progress')
      WHERE u.role = 'expert' AND u.is_active = true
      GROUP BY u.id
      ORDER BY COUNT(er.id) ASC
      LIMIT 1
    `);

    if (expert.rows.length === 0) {
      logger.warn('No available experts for review assignment');
      return;
    }

    // Create expert review assignment
    await this.dashboardPool.query(`
      INSERT INTO expert_reviews (
        execution_id, expert_id, priority, assigned_at, status
      ) VALUES ($1, $2, $3, NOW(), 'pending')
    `, [
      executionId,
      expert.rows[0].id,
      needsReview.rows[0].risk_level === 'critical' ? 1 : 3
    ]);
  }

  private async updateNodeStatistics(executionId: number): Promise<void> {
    // Update real-time statistics for dashboard
    // - Total executions per node
    // - High-risk detections per node
    // - Last detection timestamp
    // - Camera uptime status

    await this.dashboardPool.query(`
      UPDATE monitoring_nodes mn
      SET updated_at = NOW()
      FROM executions e
      WHERE e.id = $1 AND e.node_id = mn.node_id
    `, [executionId]);

    await this.dashboardPool.query(`
      UPDATE node_cameras nc
      SET
        last_image_timestamp = NOW(),
        updated_at = NOW()
      FROM executions e
      WHERE e.id = $1 AND e.camera_id = nc.camera_id
    `, [executionId]);
  }
}
```

---

## 📋 Implementation Roadmap

### Sprint 1: Stop the Bleeding (1-2 days)
**Goal**: Fix immediate production issues

- [ ] **Deploy trigger fix** (1 hour)
  - Update `n8n_simple_triggers.sql` to fire only on UPDATE
  - Test with manual NOTIFY
  - Deploy to production
  - Monitor logs for 1 hour

- [ ] **Make ETL idempotent** (4 hours)
  - Replace INSERT with INSERT ... ON CONFLICT in `simple-etl-service.ts`
  - Add duplicate_handled metric
  - Test with duplicate processing
  - Deploy to production

- [ ] **Add observability** (2 hours)
  - Enhanced metrics logging
  - ETL performance dashboard endpoint
  - Error categorization

- [ ] **Verify fix** (1 hour)
  - Monitor logs for 1 hour
  - Confirm no duplicate errors
  - Confirm log volume reduced 50%

**Success Criteria**:
- ✅ Log volume drops from 636 → ~300 lines/hour
- ✅ No more "duplicate key" errors
- ✅ Each execution processed exactly once
- ✅ Clean logs

### Sprint 2: Structured Data (3-5 days)
**Goal**: Implement schema validation and structured extraction

- [ ] **Define JSON schema** (2 hours)
  - Create `n8n-output-schema.json`
  - Document camera/node ID format
  - Add examples

- [ ] **Implement validator** (4 hours)
  - Add `ajv` dependency
  - Create `ExecutionSchemaValidator` class
  - Add unit tests

- [ ] **Update ETL with validation** (6 hours)
  - Integrate validator into extractor
  - Keep fallback extraction for old data
  - Add schema compliance metrics

- [ ] **Coordinate with n8n workflow owner** (8 hours)
  - Explain schema requirements
  - Add "Format SAI Output" function node
  - Extract camera metadata from webhook
  - Test end-to-end

- [ ] **Backfill camera/node data** (4 hours)
  - Analyze existing executions for patterns
  - Infer camera_id from image metadata or timestamps
  - Update historical records

**Success Criteria**:
- ✅ New executions include camera_id and node_id
- ✅ Schema validation passes >95% of executions
- ✅ Fallback extraction handles old data gracefully

### Sprint 3: Domain Logic (1 week)
**Goal**: Add business value through enrichment

- [ ] **Implement pipeline pattern** (8 hours)
  - Create ETLPipeline orchestrator
  - Split into Extractor/Transformer/Loader/Enricher
  - Add error handling and retries

- [ ] **Build DomainEnricher** (16 hours)
  - Alert priority calculation
  - Incident correlation logic
  - Expert review assignment
  - Node statistics updates

- [ ] **Test enrichment logic** (8 hours)
  - Unit tests for each enricher method
  - Integration tests with real data
  - Performance testing

- [ ] **Deploy incrementally** (4 hours)
  - Feature flag for enrichment
  - Monitor performance impact
  - Gradual rollout

**Success Criteria**:
- ✅ Incidents automatically correlated
- ✅ High-risk detections assigned to experts
- ✅ Node statistics updated in real-time
- ✅ Frontend can show "fires by region"

### Sprint 4: Frontend Enablement (1 week)
**Goal**: Unblock frontend development with clean data

- [ ] **Geographic features** (8 hours)
  - "Fires by region" view
  - Coverage map with node locations
  - Multi-camera incident timeline

- [ ] **Expert review queue** (12 hours)
  - Assignment dashboard
  - Review workflow UI
  - Second opinion requests

- [ ] **Real-time incident tracking** (8 hours)
  - Live incident map
  - Alert escalation UI
  - Response coordination

- [ ] **Analytics dashboard** (8 hours)
  - Node performance metrics
  - Detection accuracy by camera
  - Expert review statistics

**Success Criteria**:
- ✅ All planned frontend features working
- ✅ Real-time updates reliable
- ✅ Data quality high enough for production use

---

## 🎯 Success Metrics

### Before (Current Production)
- ❌ Log volume: 636 lines/hour
- ❌ Duplicate processing: 100% (2x per execution)
- ❌ Database INSERT errors: ~50/hour
- ❌ Camera assignment: 0% (always NULL)
- ❌ Node assignment: 0% (always NULL)
- ❌ Incident correlation: 0% (always NULL)
- ❌ Expert reviews: 0 (table empty)
- ❌ Schema compliance: 0% (no schema)

### After (Target State)
- ✅ Log volume: ~300 lines/hour (50% reduction)
- ✅ Duplicate processing: 0% (idempotent)
- ✅ Database errors: 0/hour
- ✅ Camera assignment: 100%
- ✅ Node assignment: 100%
- ✅ Incident correlation: >80% of high-risk detections
- ✅ Expert reviews: Active queue management
- ✅ Schema compliance: >95%

---

## 🔧 Maintenance Plan

### Daily Monitoring
- ETL processing metrics (success rate, processing time)
- Schema validation failures
- Enrichment errors
- Expert review queue depth

### Weekly Review
- Log volume trends
- Data quality metrics
- Camera/node coverage gaps
- Expert review accuracy

### Monthly Audit
- Schema evolution needs
- Performance optimization opportunities
- Dead code removal
- Database index optimization

---

## 📚 References

### Critical Files
- `backend/src/services/simple-etl-service.ts` - Active ETL service
- `database/n8n_simple_triggers.sql` - Trigger causing duplicates
- `database/sai_dashboard_schema.sql` - Database schema (590 lines)
- `frontend/src/contexts/SSEContext.tsx` - Real-time updates

### Documentation Needed
- [ ] n8n workflow documentation (currently unknown)
- [ ] Camera ID assignment strategy
- [ ] Node deployment map (which cameras belong to which nodes)
- [ ] Expert review workflows and SLAs
- [ ] Incident escalation procedures

### External Dependencies
- n8n workflow owner (need to modify workflow output)
- Camera deployment team (need camera → node mapping)
- Expert review team (define review criteria)

---

## ✅ Conclusion

The SAI Dashboard has a **solid foundation** but suffers from **implementation debt**:

1. **Quick wins available**: Trigger fix can be deployed in 1 hour
2. **Clear path forward**: Phased approach minimizes risk
3. **High ROI**: Each sprint unlocks new frontend capabilities
4. **Sustainable**: Pipeline pattern enables future enhancements

**Recommended action**: Start with Sprint 1 (Stop the Bleeding) immediately, then proceed to Sprint 2 once logs are clean.

---

**Document Status**: Draft for review
**Next Steps**: Review with team, prioritize sprints, assign owners
**Questions**: DM for clarification or architecture discussion
