/**
 * Returns the best available timestamp for an execution, preferring captureTimestamp
 * (actual camera capture time) over executionTimestamp (n8n processing time).
 * isFallback=true means captureTimestamp was unavailable (pre-metadata or n8n-only execution).
 */
export function getDisplayTimestamp(execution: { captureTimestamp?: string | null; executionTimestamp: string }): {
  timestamp: string;
  isFallback: boolean;
} {
  if (execution.captureTimestamp) {
    return { timestamp: execution.captureTimestamp, isFallback: false };
  }
  return { timestamp: execution.executionTimestamp, isFallback: true };
}
