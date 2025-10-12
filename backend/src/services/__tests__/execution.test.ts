import { ExecutionService } from '../execution';
import { db } from '../../database/dual-pool';
import { mockExecutionData, mockDailySummary } from '../../__tests__/setup';

jest.mock('../../database/dual-pool');

describe('ExecutionService', () => {
  let service: ExecutionService;
  const mockDb = db as jest.Mocked<typeof db>;

  beforeEach(() => {
    service = new ExecutionService();
    jest.clearAllMocks();
  });

  describe('getExecutions', () => {
    it('should fetch executions with default filters', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '100' }]) // Count query
        .mockResolvedValueOnce([mockExecutionData]); // Data query

      const result = await service.getExecutions();

      expect(result).toHaveProperty('executions');
      expect(result).toHaveProperty('total', 100);
      expect(result).toHaveProperty('hasNext');
      expect(result.executions).toHaveLength(1);
      expect(result.executions[0].id).toBe(mockExecutionData.id);
      
      // Check that default limit is applied
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([50]) // Default limit
      );
    });

    it('should apply status filter correctly', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '10' }])
        .mockResolvedValueOnce([mockExecutionData]);

      await service.getExecutions({ status: 'success' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('status = $'),
        expect.arrayContaining(['success'])
      );
    });

    it('should apply date range filters', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '5' }])
        .mockResolvedValueOnce([]);

      const startDate = '2025-08-01';
      const endDate = '2025-08-31';

      await service.getExecutions({ startDate, endDate });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('started_at >= $'),
        expect.arrayContaining([new Date(startDate)])
      );
      
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('started_at <= $'),
        expect.arrayContaining([new Date(endDate)])
      );
    });

    it('should apply search filter in analysis text', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '3' }])
        .mockResolvedValueOnce([]);

      await service.getExecutions({ search: 'fire detected' });

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ollama_analysis ILIKE $'),
        expect.arrayContaining(['%fire detected%'])
      );
    });

    it('should handle pagination correctly', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '100' }])
        .mockResolvedValueOnce(Array(50).fill(mockExecutionData));

      const result = await service.getExecutions({ page: 1, limit: 50 });

      expect(result.hasNext).toBe(false); // 100 total, showing 50-99 (items 50-99), no more pages
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET'),
        expect.arrayContaining([50]) // Page 1 * limit 50
      );
    });

    it('should enforce max page size', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '500' }])
        .mockResolvedValueOnce([]);

      await service.getExecutions({ limit: 1000 }); // Requesting more than max

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        expect.arrayContaining([200]) // Max page size
      );
    });

    it('should handle empty results', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '0' }])
        .mockResolvedValueOnce([]);

      const result = await service.getExecutions();

      expect(result.executions).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasNext).toBe(false);
    });

    it('should transform database results to proper format', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '1' }])
        .mockResolvedValueOnce([mockExecutionData]);

      const result = await service.getExecutions();
      const execution = result.executions[0];

      expect(execution.id).toBe(mockExecutionData.id);
      expect(execution.startedAt).toBeInstanceOf(Date);
      expect(execution.analysis).toBeDefined();
      expect(execution.analysis?.riskAssessment).toBe(mockExecutionData.ollama_analysis);
      expect(execution.telegramDelivered).toBe(true);
    });
  });

  describe('getExecutionById', () => {
    it('should fetch execution by ID', async () => {
      mockDb.query.mockResolvedValueOnce([mockExecutionData]);

      const result = await service.getExecutionById('test-exec-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('test-exec-123');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['test-exec-123']
      );
    });

    it('should return null for non-existent execution', async () => {
      mockDb.query.mockResolvedValueOnce([]);

      const result = await service.getExecutionById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getExecutionData', () => {
    it('should fetch execution data without nodeId', async () => {
      const mockData = {
        execution_id: 'test-exec-123',
        node_id: 'Webhook',
        data: { test: 'data' },
        data_size_bytes: 1024,
        created_at: new Date(),
      };

      mockDb.query.mockResolvedValueOnce([mockData]);

      const result = await service.getExecutionData('test-exec-123');

      expect(result).toEqual([mockData]);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE execution_id = $1'),
        ['test-exec-123']
      );
    });

    it('should fetch execution data with specific nodeId', async () => {
      const mockData = {
        execution_id: 'test-exec-123',
        node_id: 'Webhook',
        data: { test: 'data' },
      };

      mockDb.query.mockResolvedValueOnce([mockData]);

      const result = await service.getExecutionData('test-exec-123', 'Webhook');

      expect(result).toEqual(mockData); // Single result when nodeId specified
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('AND node_id = $2'),
        ['test-exec-123', 'Webhook']
      );
    });

    it('should return null for non-existent execution data', async () => {
      mockDb.query.mockResolvedValueOnce([]);

      const result = await service.getExecutionData('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getDailySummary', () => {
    it('should fetch daily summary for default 30 days', async () => {
      mockDb.query.mockResolvedValueOnce([mockDailySummary]);

      const result = await service.getDailySummary();

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe(mockDailySummary.date);
      expect(result[0].successRate).toBe(95.0);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INTERVAL \'30 days\'')
      );
    });

    it('should limit days to maximum 90', async () => {
      mockDb.query.mockResolvedValueOnce([]);

      await service.getDailySummary(150); // Requesting more than max

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INTERVAL \'90 days\'')
      );
    });

    it('should transform summary data correctly', async () => {
      mockDb.query.mockResolvedValueOnce([mockDailySummary]);

      const result = await service.getDailySummary();
      const summary = result[0];

      expect(summary.totalExecutions).toBe(100);
      expect(summary.successfulExecutions).toBe(95);
      expect(summary.failedExecutions).toBe(5);
      expect(summary.successRate).toBe(95.0);
      expect(summary.avgExecutionTime).toBe(25.5);
    });
  });

  describe('getRecentExecutions', () => {
    it('should fetch recent successful executions', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '50' }])
        .mockResolvedValueOnce(Array(10).fill(mockExecutionData));

      const result = await service.getRecentExecutions(10);

      expect(result).toHaveLength(10);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['success', 10])
      );
    });

    it('should limit to maximum 50 executions', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '100' }])
        .mockResolvedValueOnce([]);

      await service.getRecentExecutions(100);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([50]) // Max limit
      );
    });
  });

  describe('getExecutionStats', () => {
    it('should calculate execution statistics', async () => {
      mockDb.query.mockResolvedValueOnce([{
        total_executions: '150',
        successful_executions: '145',
        last_execution: new Date('2025-08-29T10:00:00Z'),
      }]);

      const result = await service.getExecutionStats();

      expect(result.totalExecutions).toBe(150);
      expect(result.successRate).toBe(96.67); // (145/150)*100 rounded
      expect(result.avgDailyExecutions).toBe(5); // 150/30 days
      expect(result.lastExecution).toBeInstanceOf(Date);
    });

    it('should handle zero executions', async () => {
      mockDb.query.mockResolvedValueOnce([{
        total_executions: '0',
        successful_executions: '0',
        last_execution: null,
      }]);

      const result = await service.getExecutionStats();

      expect(result.totalExecutions).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.avgDailyExecutions).toBe(0);
      expect(result.lastExecution).toBeNull();
    });
  });

  describe('searchExecutions', () => {
    it('should search executions by query', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '5' }])
        .mockResolvedValueOnce([mockExecutionData]);

      const result = await service.searchExecutions('fire detected', 10);

      expect(result).toHaveLength(1);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('ollama_analysis ILIKE'),
        expect.arrayContaining(['%fire detected%'])
      );
    });

    it('should return empty array for empty query', async () => {
      const result = await service.searchExecutions('', 10);

      expect(result).toEqual([]);
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should return empty array for whitespace-only query', async () => {
      const result = await service.searchExecutions('   ', 10);

      expect(result).toEqual([]);
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('should limit search results', async () => {
      mockDb.query
        .mockResolvedValueOnce([{ total: '100' }])
        .mockResolvedValueOnce([]);

      await service.searchExecutions('test', 100);

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([50]) // Max limit enforced
      );
    });
  });
});