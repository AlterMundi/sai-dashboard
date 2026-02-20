import { ExecutionWithImageUrls } from '@/types';

/**
 * Export executions to CSV format
 */
export function exportToCSV(executions: ExecutionWithImageUrls[], filename = 'sai-executions'): void {
  if (executions.length === 0) {
    console.warn('No executions to export');
    return;
  }

  const headers = [
    'ID',
    'Timestamp',
    'Status',
    'Alert Level',
    'Has Smoke',
    'Detection Count',
    'Smoke Confidence',
    'Camera ID',
    'Location',
    'Device ID',
    'Node ID',
    'Duration (ms)',
    'Telegram Sent',
    'Has Image',
  ];

  const rows = executions.map(exec => [
    exec.id,
    exec.executionTimestamp,
    exec.status,
    exec.alertLevel || 'none',
    exec.hasSmoke ? 'Yes' : 'No',
    exec.detectionCount,
    exec.confidenceSmoke?.toFixed(3) || '',
    exec.cameraId || '',
    exec.location || '',
    exec.deviceId || '',
    exec.nodeId || '',
    exec.durationMs || '',
    exec.telegramSent ? 'Yes' : 'No',
    exec.hasImage ? 'Yes' : 'No',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  downloadFile(csvContent, `${filename}.csv`, 'text/csv;charset=utf-8;');
}

/**
 * Export executions to JSON format
 */
export function exportToJSON(executions: ExecutionWithImageUrls[], filename = 'sai-executions'): void {
  if (executions.length === 0) {
    console.warn('No executions to export');
    return;
  }

  // Clean up the data for export (remove internal fields, format dates)
  const cleanedData = executions.map(exec => ({
    id: exec.id,
    timestamp: exec.executionTimestamp,
    status: exec.status,
    duration_ms: exec.durationMs,

    // Detection data
    alert_level: exec.alertLevel,
    has_smoke: exec.hasSmoke,
    detection_count: exec.detectionCount,
    detections: exec.detections,
    confidence_smoke: exec.confidenceSmoke,

    // Device info
    camera_id: exec.cameraId,
    location: exec.location,
    device_id: exec.deviceId,
    node_id: exec.nodeId,
    camera_type: exec.cameraType,

    // Notification
    telegram_sent: exec.telegramSent,

    // Image
    has_image: exec.hasImage,
    image_dimensions: exec.imageWidth && exec.imageHeight
      ? { width: exec.imageWidth, height: exec.imageHeight }
      : null,
  }));

  const jsonContent = JSON.stringify({
    exported_at: new Date().toISOString(),
    total_count: cleanedData.length,
    executions: cleanedData,
  }, null, 2);

  downloadFile(jsonContent, `${filename}.json`, 'application/json');
}

/**
 * Export summary statistics
 */
export function exportSummary(executions: ExecutionWithImageUrls[], filename = 'sai-summary'): void {
  if (executions.length === 0) {
    console.warn('No executions to export');
    return;
  }

  const summary = {
    exported_at: new Date().toISOString(),
    total_executions: executions.length,

    status_breakdown: {
      success: executions.filter(e => e.status === 'success').length,
      error: executions.filter(e => e.status === 'error').length,
    },

    detection_summary: {
      with_smoke: executions.filter(e => e.hasSmoke).length,
      total_detections: executions.reduce((sum, e) => sum + e.detectionCount, 0),
    },

    alert_levels: {
      critical: executions.filter(e => e.alertLevel === 'critical').length,
      high: executions.filter(e => e.alertLevel === 'high').length,
      medium: executions.filter(e => e.alertLevel === 'medium').length,
      low: executions.filter(e => e.alertLevel === 'low').length,
      none: executions.filter(e => e.alertLevel === 'none' || !e.alertLevel).length,
    },

    notifications: {
      telegram_sent: executions.filter(e => e.telegramSent).length,
    },

    cameras: [...new Set(executions.map(e => e.cameraId).filter(Boolean))],
    locations: [...new Set(executions.map(e => e.location).filter(Boolean))],

    time_range: {
      earliest: executions.length > 0
        ? executions.reduce((min, e) => e.executionTimestamp < min ? e.executionTimestamp : min, executions[0].executionTimestamp)
        : null,
      latest: executions.length > 0
        ? executions.reduce((max, e) => e.executionTimestamp > max ? e.executionTimestamp : max, executions[0].executionTimestamp)
        : null,
    },
  };

  const jsonContent = JSON.stringify(summary, null, 2);
  downloadFile(jsonContent, `${filename}.json`, 'application/json');
}

/**
 * Helper to trigger file download
 */
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
