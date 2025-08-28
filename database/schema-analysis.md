# SAI Dashboard - n8n Database Schema Analysis

**Database context and structure analysis for the SAI Image Analysis Dashboard**

---

## Database Overview

### Connection Details
- **Database**: PostgreSQL 17.5  
- **Size**: 23GB production database
- **Host**: localhost:5432
- **Database Name**: n8n
- **User**: n8n_user (read-only access recommended)
- **Optimization**: 8GB shared_buffers, SSD-optimized settings

### Key Statistics (Current)
- **Total Workflows**: 37 (4 active)
- **Total Executions**: 4,895 (99.96% success rate)
- **Target Workflow Executions**: 4,893 (99.9% of all activity)
- **Database Tables**: 33 tables with comprehensive indexing

---

## Core Tables for SAI Dashboard

### 1. `workflow_entity` - Workflow Definitions

**Purpose**: Source of truth for workflow structure and metadata

```sql
Table Structure:
- id (varchar 36) - Primary Key, stable identifier
- name (varchar 128) - Human-readable name (our filter key)
- active (boolean) - Current activation status
- nodes (json) - Complete workflow node definitions
- connections (json) - Node interconnection mapping
- createdAt (timestamp) - Creation date
- updatedAt (timestamp) - Last modification  
- triggerCount (integer) - Number of trigger nodes
- settings (json) - Workflow-level configuration
- staticData (json) - Persistent workflow data
- pinData (json) - Test/debug data
```

**Key Record for SAI**:
```
name: "Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto"
id: yDbfhooKemfhMIkC (stable workflow identifier)
active: true
nodes: 10 nodes (webhook → processing → telegram)
triggerCount: 1 (webhook trigger)
```

**Indexes Available**:
- `workflow_entity_pkey` (PRIMARY KEY on id)
- `IDX_workflow_entity_name` (INDEX on name)
- `pk_workflow_entity_id` (UNIQUE on id)

### 2. `execution_entity` - Execution Lifecycle

**Purpose**: Tracks every workflow execution from start to finish

```sql
Table Structure:
- id (integer) - Primary Key, auto-increment
- workflowId (varchar 36) - References workflow_entity.id  
- status (varchar) - 'success', 'error', 'canceled', 'running'
- mode (varchar) - 'webhook', 'manual', 'trigger', 'retry'
- startedAt (timestamp) - Execution start time
- stoppedAt (timestamp) - Execution end time  
- finished (boolean) - Completion flag
- retryOf (varchar) - Reference to original execution if retry
- deletedAt (timestamp) - Soft delete timestamp
- createdAt (timestamp) - Record creation time
```

**SAI Workflow Pattern**:
```
workflowId: yDbfhooKemfhMIkC
mode: 'webhook' (99.9% of executions)
status: 'success' (4,892 of 4,893 executions)  
Typical duration: 1-3 seconds
```

**Critical Indexes**:
- `pk_e3e63bbf986767844bbe1166d4e` (PRIMARY KEY on id)
- `idx_execution_entity_workflow_id_started_at` (workflow_id, startedAt)
- `idx_execution_entity_stopped_at_status_deleted_at` (performance queries)

### 3. `execution_data` - Runtime Payload Storage

**Purpose**: Stores complete execution data including inputs, outputs, and intermediate results

```sql
Table Structure:
- executionId (integer) - Primary Key, references execution_entity.id
- workflowData (json) - Workflow definition at execution time
- data (text) - Compressed execution results and node data
```

**Content Structure** (JSON in `data` field):
```json
{
  "nodeInputData": {
    "Webhook": [{"json": {"image_data": "base64..."}}],
    "Ollama": [{"json": {"image": "...", "prompt": "..."}}]
  },
  "nodeOutputData": {
    "Webhook": [{"json": {"body": {...}, "headers": {...}}}],
    "Ollama": [{"json": {"response": "RISK_LEVEL: LOW", "confidence": 0.89}}],
    "Telegram": [{"json": {"message_id": 12345, "success": true}}]
  }
}
```

**Image Data Location**: Base64 image data typically found in:
- `nodeInputData.Webhook[0].json.body` (original upload)
- `nodeInputData.Ollama[0].json.image` (processed for analysis)

### 4. `webhook_entity` - HTTP Trigger Configuration  

**Purpose**: Maps webhook URLs to workflows for external access

```sql
Table Structure:
- webhookPath (varchar) - URL path component
- method (varchar) - HTTP method (GET, POST, etc.)
- workflowId (varchar 36) - References workflow_entity.id
- node (varchar) - Trigger node name
- webhookId (varchar) - Internal webhook identifier
```

**SAI Webhook**:
```
webhookPath: "e861ad7c-8160-4964-8953-5e3a02657293"
method: "POST"
workflowId: yDbfhooKemfhMIkC  
Full URL: https://ai.altermundi.net/pipelines/e861ad7c-8160-4964-8953-5e3a02657293
```

### 5. `credentials_entity` - Integration Credentials

**Purpose**: Encrypted storage for API keys and authentication data

```sql
Table Structure:
- id (varchar 36) - Primary Key
- name (varchar 128) - User-friendly credential name
- type (varchar 128) - Credential type (telegramApi, ollamaApi, etc.)
- data (text) - Encrypted credential data  
- createdAt (timestamp) - Creation date
- updatedAt (timestamp) - Last modification
- isManaged (boolean) - System vs user-created flag
```

**Relevant Types for SAI**:
- `telegramApi` (5 credentials) - Bot configurations
- `ollamaApi` (2 credentials) - AI model access
- `googleSheetsOAuth2Api` (2 credentials) - Sheets integration
- `httpBasicAuth`, `httpBearerAuth` - API authentication

---

## Data Extraction Patterns

### Image Data Extraction Strategy

**Step 1: Get Execution Record**
```sql
SELECT e.id, e.status, e.startedAt, ed.data
FROM execution_entity e
JOIN execution_data ed ON e.id = ed.executionId
WHERE e.workflowId = 'yDbfhooKemfhMIkC'
  AND e.status = 'success'
ORDER BY e.startedAt DESC;
```

**Step 2: Parse JSON Payload**
```javascript
// Extract image from execution data
const executionData = JSON.parse(row.data);
const imageData = executionData.nodeInputData?.Webhook?.[0]?.json?.body?.image;
const ollamaResult = executionData.nodeOutputData?.Ollama?.[0]?.json?.response;
const telegramStatus = executionData.nodeOutputData?.Telegram?.[0]?.json?.success;
```

**Step 3: Process Base64 Images**
```javascript
// Convert base64 to displayable image
const imageBuffer = Buffer.from(imageData, 'base64');
const imageUrl = `data:image/jpeg;base64,${imageData}`;
```

### Analysis Result Extraction

**Ollama Response Structure**:
```json
{
  "response": "RISK_LEVEL: LOW\nConfidence: 0.89\nDescription: Normal scene with no apparent risks",
  "context": [...],
  "created_at": "2025-08-28T...",
  "model": "qwen2.5vl:7b"
}
```

**Telegram Delivery Status**:
```json
{
  "message_id": 12345,
  "success": true,
  "chat": {"id": -4768100208, "type": "supergroup"},
  "date": 1724857234
}
```

---

## Performance Considerations

### Query Optimization

**Efficient Filtering**:
```sql
-- Good: Uses indexes effectively
WHERE w.name = 'Sai-webhook-upload-image+Ollama-analisys+telegram-sendphoto'
  AND e.startedAt > CURRENT_DATE - INTERVAL '7 days'
  AND e.deletedAt IS NULL

-- Avoid: Functions on indexed columns
WHERE DATE(e.startedAt) = CURRENT_DATE  -- Prevents index usage
```

**Pagination Strategy**:
```sql
-- Use OFFSET/LIMIT with consistent ORDER BY
SELECT ... 
ORDER BY e.startedAt DESC, e.id DESC  -- Secondary sort for consistency
LIMIT 50 OFFSET 0;
```

**JOIN Optimization**:
```sql
-- Only JOIN execution_data when payload content is needed
-- execution_data is large (contains compressed workflow execution data)
SELECT e.id, e.status, e.startedAt  -- Fast query without payload
FROM execution_entity e
JOIN workflow_entity w ON e.workflowId = w.id
WHERE w.name = '...' AND e.startedAt > ...;

-- Then fetch payload separately for specific executions
SELECT ed.data FROM execution_data ed WHERE ed.executionId IN (...);
```

### Memory Management

**Large Payload Handling**:
- Average payload size: ~50-200KB per execution
- Image data (base64): ~100-500KB per execution
- Use streaming for large result sets
- Implement client-side pagination
- Consider payload size limits in API responses

**Connection Pool Settings**:
```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,                    // Maximum connections
  idleTimeoutMillis: 30000,  // Close idle connections
  connectionTimeoutMillis: 2000,
  statement_timeout: 10000,  // Query timeout
  query_timeout: 10000
});
```

---

## Security and Safety

### Read-Only Access Pattern

**Database User Configuration**:
```sql
-- Create read-only user for dashboard
CREATE USER sai_dashboard_readonly;
GRANT CONNECT ON DATABASE n8n TO sai_dashboard_readonly;
GRANT USAGE ON SCHEMA public TO sai_dashboard_readonly;
GRANT SELECT ON execution_entity TO sai_dashboard_readonly;
GRANT SELECT ON execution_data TO sai_dashboard_readonly;
GRANT SELECT ON workflow_entity TO sai_dashboard_readonly;
GRANT SELECT ON webhook_entity TO sai_dashboard_readonly;
-- No INSERT, UPDATE, DELETE permissions
```

**Query Safety Checks**:
```javascript
// Prevent SQL injection with parameterized queries
const query = `
  SELECT e.id, e.status, e.startedAt 
  FROM execution_entity e
  JOIN workflow_entity w ON e.workflowId = w.id  
  WHERE w.name = $1 AND e.startedAt > $2
  ORDER BY e.startedAt DESC LIMIT $3
`;
const params = [workflowName, startDate, limit];
```

**Data Sanitization**:
```javascript
// Sanitize extracted data before display
const sanitizeExecutionData = (data) => ({
  id: data.id,
  status: data.status,
  timestamp: data.startedAt,
  image: data.image ? 'data:image/jpeg;base64,' + data.image : null,
  // Remove sensitive information
  credentials: undefined,
  internalIds: undefined
});
```

### Error Handling

**Database Connection Resilience**:
```javascript
const executeQuery = async (query, params = []) => {
  const client = await pool.connect();
  try {
    const result = await client.query(query, params);
    return result.rows;
  } catch (error) {
    logger.error('Database query failed:', error);
    throw new Error('Database operation failed');
  } finally {
    client.release();
  }
};
```

**Payload Parsing Safety**:
```javascript
const safeJsonParse = (jsonString) => {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    logger.warn('Invalid JSON payload:', error);
    return null;
  }
};
```

---

## Dashboard-Specific Schema Insights

### Workflow Node Structure

The SAI workflow contains **10 nodes** with this typical structure:
1. **Webhook Trigger** - Receives image upload
2. **Data Transformation** - Prepares image for analysis  
3. **Ollama AI Node** - Performs image analysis
4. **Conditional Logic** - Routes based on analysis results
5. **Telegram Bot** - Sends notification with results
6. **Error Handling** - Manages failures and retries

**Node Connections Flow**:
```
Webhook → Transform → Ollama → Condition → Telegram
    ↓         ↓         ↓         ↓         ↓
  Input    Process   Analyze   Decide    Notify
```

### Execution Data Patterns

**Successful Execution Timeline**:
1. `startedAt`: Webhook receives image
2. Node processing: 1-3 seconds typical duration
3. `stoppedAt`: Telegram notification sent
4. `status`: 'success' with complete payload

**Failure Patterns** (2 of 4,893 executions):
- Timeout errors in Ollama processing
- Network failures in Telegram delivery
- Invalid image format handling

### Integration Points

**External Service Dependencies**:
- **Ollama API**: Local instance on port 11434
- **Telegram Bot API**: Multiple bot configurations
- **Google Services**: Sheets, Drive for data storage
- **Webhook Endpoint**: HTTPS proxy through ai.altermundi.net

This schema analysis provides the foundation for efficient, safe, and performant data extraction for the SAI Image Analysis Dashboard.

---

*Schema Analysis Version: 1.0*  
*Database: n8n PostgreSQL 17.5*  
*Target: SAI Image Workflow Dashboard*