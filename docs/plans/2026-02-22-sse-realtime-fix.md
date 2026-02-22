# SSE Real-Time Update Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two bugs that cause execution cards to appear incomplete/orphaned in the dashboard: a polling cursor race condition and missing Stage 2 ETL SSE notifications.

**Architecture:** Two independent fixes. (A) Replace the break-on-ID cursor in the SSE polling loop with a Set-based tracker that doesn't skip executions whose Stage 2 completes out of order. (B) Emit `etl:stage2:complete` and `etl:stage2:failed` SSE events directly from Stage 2 ETL after `markCompleted`/`markFailed`, and wire up the frontend to update existing cards in-place (or fetch+prepend if not yet in gallery).

**Tech Stack:** Node.js + TypeScript (backend), React + TypeScript (frontend), SSE (EventSource), PostgreSQL

---

## Bug Summary

### Bug 1 — Polling cursor race condition (`backend/src/controllers/sse.ts:544-562`)

The loop iterates executions newest-first and breaks when it hits `lastKnownExecutionId`. When execution #201 (Stage 2 fast) completes before #200 (Stage 2 slow), the cursor advances to #201. On the next poll cycle the loop breaks at #201, and #200 is permanently behind the break point — never broadcast even after its Stage 2 completes.

**Fix:** Replace the single-ID cursor with a `Set<number>` of already-broadcast IDs. The loop simply skips IDs already in the set and skips executions without `extractedAt`. No break; scans the full window every cycle.

### Bug 2 — Stage 2 never emits SSE events (`backend/src/services/stage2-etl-service.ts:422`)

`stage2-etl-service.ts` calls `this.emit('execution_processed', ...)` (an EventEmitter), not an SSE broadcast. The frontend listens for `etl:stage2:complete` and `etl:stage2:failed` (SSEContext lines 244, 253) but these events are never sent. The `updateExecutionStage` path in Dashboard.tsx (lines 87–113) is dead code.

**Fix:** After `markCompleted()`, dynamically import `sse.ts` and call `notifyStage2Complete(...)`. After `markFailed()`, call `notifyStage2Failed(...)`. Add these two functions to `sse.ts`.

### Bug 3 — `updateExecutionStage` can't signal "not found" (frontend)

If a completion event arrives for an execution not yet in the gallery, `updateExecutionStage` silently no-ops. The card never appears or gets updated.

**Fix:** Change `updateExecutionStage` to return `boolean` (was `void`). Dashboard's `onStage2Complete` checks the return value and, if `false`, fetches the execution by ID and prepends it to the gallery.

---

## Task 1: Fix the polling cursor in sse.ts

**Files:**
- Modify: `backend/src/controllers/sse.ts:517-591`

**Context:** `lastKnownExecutionId` is a module-level `number | null`. Replace it with a `Set<number>` called `broadcastedExecutionIds`. Keep a `MAX_TRACKED = 200` constant to bound memory.

**Step 1: Replace module-level cursor variable**

Find (around line 517–518):
```typescript
// Execution tracking - no more batching, immediate broadcast
let lastKnownExecutionId: number | null = null;
```

Replace with:
```typescript
// Execution tracking — Set-based to avoid cursor race conditions
const broadcastedExecutionIds = new Set<number>();
const MAX_BROADCAST_TRACKED = 200;
```

**Step 2: Rewrite the polling loop body**

Replace the loop + cursor update block (lines 540–562):

```typescript
// OLD (buggy):
const newExecutions = [];
for (const execution of latestExecutions.executions) {
  if (execution.id === lastKnownExecutionId) {
    break;
  }
  if (execution.extractedAt) {
    newExecutions.push(execution);
  } else {
    logger.debug(`Skipping execution ${execution.id} - Stage 2 ETL not yet complete ...`);
  }
}
if (newExecutions.length > 0) {
  lastKnownExecutionId = newExecutions[0].id;
  // ...broadcast
}
```

Replace with:

```typescript
const newExecutions = [];
for (const execution of latestExecutions.executions) {
  // Skip already-broadcast executions
  if (broadcastedExecutionIds.has(execution.id)) continue;

  // Skip executions where Stage 2 hasn't completed yet
  if (!execution.extractedAt) {
    logger.debug(`Skipping execution ${execution.id} - Stage 2 ETL not yet complete`);
    continue;
  }

  newExecutions.push(execution);
  broadcastedExecutionIds.add(execution.id);
}

// Trim the set to prevent unbounded memory growth
if (broadcastedExecutionIds.size > MAX_BROADCAST_TRACKED) {
  // Remove the smallest (oldest) IDs
  const sorted = [...broadcastedExecutionIds].sort((a, b) => a - b);
  sorted.slice(0, broadcastedExecutionIds.size - MAX_BROADCAST_TRACKED)
    .forEach(id => broadcastedExecutionIds.delete(id));
}
```

**Step 3: Remove the stale `lastKnownExecutionId = newExecutions[0].id` line**

It's now replaced by the `broadcastedExecutionIds.add(execution.id)` calls inside the loop.

**Step 4: Run type-check**
```bash
npm run type-check:backend
```
Expected: no errors.

**Step 5: Commit**
```bash
git add backend/src/controllers/sse.ts
git commit -m "fix(sse): replace cursor with Set to prevent execution broadcast gaps"
```

---

## Task 2: Add `notifyStage2Complete` and `notifyStage2Failed` to sse.ts

**Files:**
- Modify: `backend/src/controllers/sse.ts` (add two exported functions near the other `notifyXxx` functions, around line 375–428)

**Context:** These functions must match the `SSEStage2CompletionEvent` and `SSEStage2FailureEvent` interfaces in `frontend/src/types/api.ts` exactly:

```typescript
// SSEStage2CompletionEvent
{
  execution_id: number;
  stage: 'stage2';
  processing_time_ms: number;
  extracted_data: {
    has_smoke: boolean;
    alert_level: string | null;
    detection_count: number;
    has_image: boolean;
    telegram_sent: boolean;
  };
  timestamp: string;
}

// SSEStage2FailureEvent
{
  execution_id: number;
  stage: 'stage2';
  error: string;
  retry_count: number;
  timestamp: string;
}
```

**Step 1: Add `notifyStage2Complete` after `notifyExecutionError`** (around line 401)

```typescript
export const notifyStage2Complete = async (
  executionId: number,
  extracted: {
    has_smoke: boolean;
    alert_level: string | null;
    detection_count: number;
  },
  hasImage: boolean,
  processingTimeMs: number
): Promise<void> => {
  try {
    const message: SSEMessage = {
      type: 'etl:stage2:complete',
      data: {
        execution_id: executionId,
        stage: 'stage2',
        processing_time_ms: processingTimeMs,
        extracted_data: {
          has_smoke: extracted.has_smoke,
          alert_level: extracted.alert_level,
          detection_count: extracted.detection_count,
          has_image: hasImage,
          telegram_sent: false,
        },
        timestamp: new Date().toISOString(),
      },
    };

    const clientCount = sseManager.broadcast(message);
    logger.debug('Stage 2 completion notified', { executionId, clientCount });
  } catch (error) {
    logger.error('Failed to notify Stage 2 completion', { executionId, error });
  }
};

export const notifyStage2Failed = async (
  executionId: number,
  error: string,
  retryCount: number
): Promise<void> => {
  try {
    const message: SSEMessage = {
      type: 'etl:stage2:failed',
      data: {
        execution_id: executionId,
        stage: 'stage2',
        error,
        retry_count: retryCount,
        timestamp: new Date().toISOString(),
      },
    };

    const clientCount = sseManager.broadcast(message);
    logger.debug('Stage 2 failure notified', { executionId, clientCount });
  } catch (error) {
    logger.error('Failed to notify Stage 2 failure', { executionId, error });
  }
};
```

**Step 2: Run type-check**
```bash
npm run type-check:backend
```
Expected: no errors.

**Step 3: Commit**
```bash
git add backend/src/controllers/sse.ts
git commit -m "feat(sse): add notifyStage2Complete and notifyStage2Failed broadcast functions"
```

---

## Task 3: Call SSE notify functions from Stage 2 ETL

**Files:**
- Modify: `backend/src/services/stage2-etl-service.ts:420-455`

**Context:** The success path is around line 420–443; the error path is around line 445–455. We use dynamic import to avoid a potential circular dependency at module load time (sse.ts uses dynamic import for new-execution-service for the same reason).

**Step 1: Add SSE call in success path**

After `this.metrics.lastProcessedAt = new Date();` (around line 425), add:

```typescript
// Notify SSE clients that Stage 2 is complete for this execution
try {
  const { notifyStage2Complete } = await import('@/controllers/sse');
  await notifyStage2Complete(
    executionId,
    {
      has_smoke: extracted.has_smoke,
      alert_level: extracted.alert_level,
      detection_count: extracted.detection_count,
    },
    !!imageResult,
    processingTime
  );
} catch (sseError) {
  // SSE notify failure must never crash the ETL pipeline
  logger.warn('Failed to send Stage 2 SSE notification', { executionId, sseError });
}
```

**Step 2: Add SSE call in failure path**

After `this.metrics.failed++;` (around line 454), add:

```typescript
// Notify SSE clients of Stage 2 failure
try {
  const { notifyStage2Failed } = await import('@/controllers/sse');
  await notifyStage2Failed(
    executionId,
    error instanceof Error ? error.message : 'Unknown error',
    0  // retry_count: the queue handles retries; 0 = this attempt failed
  );
} catch (sseError) {
  logger.warn('Failed to send Stage 2 failure SSE notification', { executionId, sseError });
}
```

**Step 3: Run type-check**
```bash
npm run type-check:backend
```
Expected: no errors.

**Step 4: Commit**
```bash
git add backend/src/services/stage2-etl-service.ts
git commit -m "feat(etl): emit etl:stage2:complete and etl:stage2:failed SSE events"
```

---

## Task 4: Make `updateExecutionStage` return `boolean`

**Files:**
- Modify: `frontend/src/hooks/useExecutions.ts:106-129`
- Modify: `frontend/src/types/hooks.ts:37`

**Context:** `updateExecutionStage` currently returns `void`. We need it to return `boolean` so the caller knows whether the execution was found and updated in-place, or needs to be fetched.

**Step 1: Update the type in `hooks.ts`**

Find (line 37):
```typescript
updateExecutionStage: (executionId: number, stage: ProcessingStage, additionalData?: any) => void;
```

Replace with:
```typescript
updateExecutionStage: (executionId: number, stage: ProcessingStage, additionalData?: any) => boolean;
```

**Step 2: Update the implementation in `useExecutions.ts`**

The key insight: React's `setExecutions(prev => ...)` calls the updater function **synchronously** before batching the state update. This means a closure variable set inside the updater IS readable immediately after the `setExecutions` call returns.

Find the `updateExecutionStage` function (lines 106–129):
```typescript
const updateExecutionStage = useCallback((executionId: number, stage: ProcessingStage, additionalData?: any) => {
  setExecutions(prev => prev.map(exec => {
    if (exec.id === executionId) {
      const updatedExec = {
        ...exec,
        processingStage: stage,
        ...additionalData
      };
      if (stage === 'stage2' && additionalData) {
        updatedExec.hasSmoke = additionalData.has_smoke ?? exec.hasSmoke;
        updatedExec.alertLevel = additionalData.alert_level ?? exec.alertLevel;
        updatedExec.detectionCount = additionalData.detection_count ?? exec.detectionCount;
        updatedExec.hasImage = additionalData.has_image ?? exec.hasImage;
        updatedExec.telegramSent = additionalData.telegram_sent ?? exec.telegramSent;
      }
      console.log(`🔄 Updated execution ${executionId} to stage ${stage}`);
      return updatedExec;
    }
    return exec;
  }));
}, []);
```

Replace with:
```typescript
const updateExecutionStage = useCallback((executionId: number, stage: ProcessingStage, additionalData?: any): boolean => {
  let found = false;

  setExecutions(prev => prev.map(exec => {
    if (exec.id !== executionId) return exec;

    found = true;
    const updatedExec = {
      ...exec,
      processingStage: stage,
      ...additionalData
    };

    if (stage === 'stage2' && additionalData) {
      updatedExec.hasSmoke = additionalData.has_smoke ?? exec.hasSmoke;
      updatedExec.alertLevel = additionalData.alert_level ?? exec.alertLevel;
      updatedExec.detectionCount = additionalData.detection_count ?? exec.detectionCount;
      updatedExec.hasImage = additionalData.has_image ?? exec.hasImage;
      updatedExec.telegramSent = additionalData.telegram_sent ?? exec.telegramSent;
    }

    console.log(`🔄 Updated execution ${executionId} to stage ${stage}`);
    return updatedExec;
  }));

  return found;
}, []);
```

**Step 3: Run type-check frontend**
```bash
npm run type-check:frontend
```
Expected: no errors (or only errors in Dashboard.tsx which we fix next).

---

## Task 5: Wire up Stage 2 completion in Dashboard.tsx

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx:64-113`

**Context:** `onStage2Complete` needs to:
1. Try to update the execution in-place via `updateExecutionStage` (returns `boolean`)
2. If not found (`false`), fetch the execution by ID and prepend it to the gallery

The `executionsApi.getExecutionById(id)` call needs to exist. Check `frontend/src/api/executions.ts` — if it doesn't have this method, add it.

**Step 1: Check if `executionsApi.getExecutionById` exists**

```bash
grep -n "getExecutionById" frontend/src/api/executions.ts
```

If it doesn't exist, add it to `frontend/src/api/executions.ts` (inside the api object):
```typescript
getExecutionById: async (id: number): Promise<ExecutionWithImageUrls | null> => {
  const response = await apiClient.get<ExecutionWithImageUrls>(`/executions/${id}`);
  return response.data ?? null;
},
```

**Step 2: Update `onStage2Complete` in `Dashboard.tsx`**

Find (lines 86–100):
```typescript
const onStage2Complete = useCallback((data: SSEStage2CompletionEvent) => {
  console.log('🔄 Dashboard: Stage 2 completion received', data);
  if (updateExecutionStage && data.execution_id) {
    updateExecutionStage(data.execution_id, 'stage2', {
      has_smoke: data.extracted_data?.has_smoke,
      alert_level: data.extracted_data?.alert_level,
      detection_count: data.extracted_data?.detection_count,
      has_image: data.extracted_data?.has_image,
      telegram_sent: data.extracted_data?.telegram_sent,
    });
  }
}, [updateExecutionStage]);
```

Replace with:
```typescript
const onStage2Complete = useCallback(async (data: SSEStage2CompletionEvent) => {
  console.log('🔄 Dashboard: Stage 2 completion received', data);
  if (!data.execution_id) return;

  const wasUpdated = updateExecutionStage(data.execution_id, 'stage2', {
    has_smoke: data.extracted_data?.has_smoke,
    alert_level: data.extracted_data?.alert_level,
    detection_count: data.extracted_data?.detection_count,
    has_image: data.extracted_data?.has_image,
    telegram_sent: data.extracted_data?.telegram_sent,
  });

  if (!wasUpdated && galleryPrependRef.current) {
    console.log(`📥 Dashboard: Execution ${data.execution_id} not in gallery, fetching and prepending`);
    try {
      const execution = await executionsApi.getExecutionById(data.execution_id);
      if (execution) galleryPrependRef.current([execution]);
    } catch (fetchError) {
      console.warn(`Failed to fetch execution ${data.execution_id} after Stage 2 completion`, fetchError);
    }
  }
}, [updateExecutionStage, galleryPrependRef]);
```

**Note:** `galleryPrependRef` must be accessible in this callback. Check if it's already in scope — in the current Dashboard.tsx it's used in `onExecutionBatch`. If not already declared in the Dashboard component scope, it's the ref returned by the gallery component.

**Step 3: Run type-check frontend**
```bash
npm run type-check:frontend
```
Expected: no errors.

**Step 4: Commit**
```bash
git add frontend/src/hooks/useExecutions.ts frontend/src/types/hooks.ts frontend/src/pages/Dashboard.tsx frontend/src/api/executions.ts
git commit -m "feat(dashboard): wire Stage 2 SSE completion to in-place card update with fetch fallback"
```

---

## Task 6: Full type-check and smoke test

**Step 1: Full type-check**
```bash
npm run type-check
```
Expected: 0 errors across backend and frontend.

**Step 2: Start dev server and observe logs**
```bash
npm run dev
```
Watch for:
- Backend logs: `"Stage 2 completion notified"` after each Stage 2 processing
- Backend logs: `"New executions broadcasted immediately"` — should now broadcast all completed executions without gaps
- Browser console: `"🔄 Dashboard: Stage 2 completion received"` after each execution

**Step 3: Verify no orphaned cards**

In the browser, open the dashboard with a running system. When new executions arrive:
- If Stage 2 of an older execution completes after a newer one, the card should update (not remain blank)
- Opening a card that was previously incomplete should show analysis data

**Step 4: Final commit if needed**
```bash
git add -p  # review any remaining changes
git commit -m "chore: post-audit cleanup for SSE real-time fix"
```

---

## Acceptance Criteria

1. An execution whose Stage 2 completes out of order (after a higher-ID execution) is broadcast and appears fully rendered in the gallery.
2. Cards that entered the gallery as incomplete (from initial page load or API fetch) are updated in-place when their Stage 2 completion event arrives.
3. Cards that were NOT yet in the gallery when Stage 2 completes are fetched and prepended automatically.
4. No TypeScript errors on `npm run type-check`.
5. Backend logs show `"Stage 2 completion notified"` for each processed execution.
