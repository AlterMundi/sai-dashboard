import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Pool } from 'pg';
import { executionService } from '../../../services/execution';
import type { ExecutionFilters } from '../../../types/execution';

// Mock the database pool
jest.mock('pg');
const mockPool = {
  query: jest.fn(),
  end: jest.fn(),
} as jest.Mocked<Pool>;

// Mock the pool constructor
(Pool as jest.MockedClass<typeof Pool>) = jest.fn(() => mockPool);

describe('ExecutionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getExecutions', () => {
    it('should return executions with proper pagination', async () => {
      const mockRows = [
        {
          id: '1',
          workflowId: 'test-workflow',
          mode: 'webhook',
          finished: true,
          startedAt: new Date('2025-08-29T10:00:00Z'),
          stoppedAt: new Date('2025-08-29T10:05:00Z'),
          status: 'success'
        }
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: mockRows, rowCount: 1 }) // executions query
        .mockResolvedValueOnce({ rows: [{ count: '10' }], rowCount: 1 }); // count query

      const filters: ExecutionFilters = {
        page: 0,
        limit: 50
      };

      const result = await executionService.getExecutions(filters);

      expect(result).toEqual({
        executions: mockRows,
        total: 10,
        hasNext: false
      });

      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should apply status filter correctly', async () => {
      const mockRows = [
        {
          id: '1',
          status: 'success'
        }
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: mockRows, rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1 });

      const filters: ExecutionFilters = {
        page: 0,
        limit: 50,
        status: 'success'
      };

      await executionService.getExecutions(filters);

      // Check that the query includes status filter
      const firstCallArgs = mockPool.query.mock.calls[0];
      expect(firstCallArgs[0]).toContain('AND e.finished = true');
    });

    it('should apply date range filters correctly', async () => {
      const mockRows = [];
      
      mockPool.query
        .mockResolvedValueOnce({ rows: mockRows, rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 });

      const filters: ExecutionFilters = {
        page: 0,
        limit: 50,
        startDate: '2025-08-29T00:00:00Z',
        endDate: '2025-08-29T23:59:59Z'
      };

      await executionService.getExecutions(filters);

      const firstCallArgs = mockPool.query.mock.calls[0];
      expect(firstCallArgs[0]).toContain('AND e.\"startedAt\" >= $');
      expect(firstCallArgs[0]).toContain('AND e.\"startedAt\" <= $');
    });

    it('should handle database errors gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database connection failed'));

      const filters: ExecutionFilters = {
        page: 0,
        limit: 50
      };

      await expect(executionService.getExecutions(filters)).rejects.toThrow('Database connection failed');
    });
  });

  describe('getExecutionById', () => {
    it('should return execution details when found', async () => {
      const mockExecution = {
        id: '123',
        workflowId: 'test-workflow',
        mode: 'webhook',
        finished: true,
        startedAt: new Date('2025-08-29T10:00:00Z'),
        stoppedAt: new Date('2025-08-29T10:05:00Z'),
        status: 'success'
      };

      mockPool.query.mockResolvedValueOnce({ rows: [mockExecution], rowCount: 1 });

      const result = await executionService.getExecutionById('123');

      expect(result).toEqual(mockExecution);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE e.id = $1'),
        ['123']
      );
    });

    it('should return null when execution not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await executionService.getExecutionById('nonexistent');

      expect(result).toBeNull();
    });

    it('should validate execution ID parameter', async () => {
      await expect(executionService.getExecutionById('')).rejects.toThrow();
      await expect(executionService.getExecutionById(null as any)).rejects.toThrow();
    });
  });

  describe('getExecutionStats', () => {
    it('should return execution statistics', async () => {
      const mockStats = [
        { status: 'success', count: '95' },
        { status: 'error', count: '5' }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockStats, rowCount: 2 });

      const result = await executionService.getExecutionStats();

      expect(result).toEqual({
        success: 95,
        error: 5,
        total: 100
      });
    });
  });

  describe('getDailySummary', () => {
    it('should return daily execution summary', async () => {
      const mockSummary = [
        {
          date: '2025-08-29',
          total: '25',
          success: '24',
          error: '1'
        }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockSummary, rowCount: 1 });

      const result = await executionService.getDailySummary(7);

      expect(result).toEqual([
        {
          date: '2025-08-29',
          total: 25,
          success: 24,
          error: 1
        }
      ]);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY date_part'),
        [7]
      );
    });
  });

  describe('searchExecutions', () => {
    it('should return search results with query validation', async () => {
      const mockResults = [
        {
          id: '1',
          workflowId: 'test-workflow',
          status: 'success',
          startedAt: new Date('2025-08-29T10:00:00Z')
        }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockResults, rowCount: 1 });

      const result = await executionService.searchExecutions('test query', 20);

      expect(result).toEqual(mockResults);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE'),
        expect.arrayContaining(['%test query%'])
      );
    });

    it('should validate search query parameters', async () => {
      await expect(executionService.searchExecutions('', 20)).rejects.toThrow();
      await expect(executionService.searchExecutions('a'.repeat(101), 20)).rejects.toThrow();
    });
  });
});