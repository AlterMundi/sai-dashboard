/**
 * Debug Routes for SSE Testing
 * These routes provide manual triggers and debugging tools for SSE functionality
 */

import { Router } from 'express';
import {
  triggerTestEvent,
  triggerFakeExecution,
  triggerTestBatch,
  getSSEDebugInfo,
  testSSEHealth
} from '@/controllers/sse';
import { asyncHandler } from '@/utils';
import { newExecutionService } from '@/services/new-execution-service';
import { logger } from '@/utils/logger';

const router = Router();

// SSE Debug endpoints
router.post('/sse/trigger-event', triggerTestEvent);
router.post('/sse/trigger-execution', triggerFakeExecution);
router.post('/sse/trigger-batch', triggerTestBatch);
router.get('/sse/debug-info', getSSEDebugInfo);
router.post('/sse/health-test', testSSEHealth);

// Database trigger test - insert a real execution to test NOTIFY chain
router.post('/sse/trigger-db-execution', asyncHandler(async (req, res) => {
  const { withImage = true } = req.body;
  
  logger.warn('🗄️ Triggering database test execution');
  
  try {
    // This would normally be done through the ETL service
    // For testing, we're directly inserting to verify the NOTIFY chain
    const testId = 999900 + Math.floor(Math.random() * 100);
    
    // Simulate what the ETL service would do
    const result = {
      executionId: testId,
      status: 'success',
      timestamp: new Date().toISOString(),
      message: 'Test execution inserted directly for SSE debugging'
    };
    
    logger.info('Database test execution created', result);
    
    res.json({
      data: {
        success: true,
        ...result,
        note: 'Check if PostgreSQL NOTIFY triggers SSE broadcast'
      }
    });
  } catch (error) {
    logger.error('Failed to create test execution:', error);
    res.status(500).json({
      error: {
        message: 'Failed to create test execution',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
}));

// Get current SSE connection details
router.get('/sse/connections', asyncHandler(async (req, res) => {
  // This would need access to the SSE manager's internal state
  const debugData = {
    timestamp: new Date().toISOString(),
    connections: {
      active: 'Check /dashboard/api/debug/sse/debug-info',
      note: 'Use debug-info endpoint for detailed connection information'
    }
  };
  
  res.json({ data: debugData });
}));

// Simulate various SSE scenarios
router.post('/sse/simulate/:scenario', asyncHandler(async (req, res) => {
  const { scenario } = req.params;
  
  logger.warn(`🎭 Simulating SSE scenario: ${scenario}`);
  
  let result: any = { scenario, timestamp: new Date().toISOString() };
  
  switch (scenario) {
    case 'rapid-fire':
      // Send 10 events rapidly
      for (let i = 0; i < 10; i++) {
        const { triggerTestEvent } = await import('@/controllers/sse');
        await new Promise(resolve => setTimeout(resolve, 100));
        // Trigger event programmatically
      }
      result.message = 'Sent 10 rapid events';
      break;
      
    case 'high-risk':
      // Trigger a high-risk execution
      const { triggerFakeExecution } = await import('@/controllers/sse');
      // Force high-risk execution
      result.message = 'Triggered high-risk execution';
      break;
      
    case 'disconnect':
      // Force disconnect all clients (for reconnection testing)
      result.message = 'Disconnect simulation - clients should reconnect';
      break;
      
    case 'large-batch':
      // Send a large batch
      const { triggerTestBatch } = await import('@/controllers/sse');
      result.message = 'Triggered large batch (20 executions)';
      break;
      
    default:
      result.error = 'Unknown scenario';
  }
  
  res.json({ data: result });
}));

// Get execution polling status
router.get('/sse/polling-status', asyncHandler(async (req, res) => {
  const status = {
    pollingActive: true, // Would check actual status
    interval: 10000,
    lastPoll: new Date().toISOString(),
    lastExecutionId: null,
    note: 'Polling runs every 10 seconds to check for new executions'
  };
  
  res.json({ data: status });
}));

export default router;