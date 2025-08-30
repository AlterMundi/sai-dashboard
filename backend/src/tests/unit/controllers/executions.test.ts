import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { executionController } from '../../../controllers/executions';
import { executionService } from '../../../services/execution';
import { imageService } from '../../../services/image';

// Mock the services
jest.mock('../../../services/execution');
jest.mock('../../../services/image');

const mockExecutionService = executionService as jest.Mocked<typeof executionService>;
const mockImageService = imageService as jest.Mocked<typeof imageService>;

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  
  app.get('/executions', executionController.getExecutions);
  app.get('/executions/:executionId', executionController.getExecutionById);
  app.get('/executions/:executionId/image', executionController.getExecutionImage);
  app.get('/executions/summary/daily', executionController.getDailySummary);
  app.get('/executions/stats', executionController.getExecutionStats);
  app.get('/executions/search', executionController.searchExecutions);
  
  return app;
};

describe('ExecutionController', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /executions', () => {
    it('should return paginated executions with default parameters', async () => {
      const mockResult = {
        executions: [
          {
            id: '1',
            workflowId: 'test-workflow',
            status: 'success',
            startedAt: new Date('2025-08-29T10:00:00Z')
          }
        ],
        total: 1,
        hasNext: false
      };

      mockExecutionService.getExecutions.mockResolvedValueOnce(mockResult);

      const response = await request(app)
        .get('/executions')
        .expect(200);

      expect(response.body).toEqual({
        data: mockResult.executions,
        meta: {
          total: 1,
          page: 0,
          limit: 50,
          hasNext: false,
          filters: {
            status: undefined,
            startDate: undefined,
            endDate: undefined,
            search: undefined,
            hasImage: undefined
          }
        }
      });
    });

    it('should validate date formats in query parameters', async () => {
      const response = await request(app)
        .get('/executions?startDate=invalid-date')
        .expect(400);

      expect(response.body.error).toEqual({
        message: 'Invalid startDate format',
        code: 'INVALID_DATE_FORMAT'
      });
    });

    it('should handle service errors gracefully', async () => {
      mockExecutionService.getExecutions.mockRejectedValueOnce(new Error('Service error'));

      const response = await request(app)
        .get('/executions')
        .expect(500);

      expect(response.body.error).toEqual({
        message: 'Failed to fetch executions',
        code: 'FETCH_EXECUTIONS_ERROR'
      });
    });

    it('should parse query parameters correctly', async () => {
      const mockResult = {
        executions: [],
        total: 0,
        hasNext: false
      };

      mockExecutionService.getExecutions.mockResolvedValueOnce(mockResult);

      await request(app)
        .get('/executions?page=1&limit=25&status=success&hasImage=true')
        .expect(200);

      expect(mockExecutionService.getExecutions).toHaveBeenCalledWith({
        page: 1,
        limit: 25,
        offset: undefined,
        status: 'success',
        startDate: undefined,
        endDate: undefined,
        search: undefined,
        hasImage: true
      });
    });
  });

  describe('GET /executions/:executionId', () => {
    it('should return execution details when found', async () => {
      const mockExecution = {
        id: '123',
        workflowId: 'test-workflow',
        status: 'success'
      };

      mockExecutionService.getExecutionById.mockResolvedValueOnce(mockExecution);

      const response = await request(app)
        .get('/executions/123')
        .expect(200);

      expect(response.body).toEqual({
        data: mockExecution
      });
    });

    it('should return 404 when execution not found', async () => {
      mockExecutionService.getExecutionById.mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/executions/nonexistent')
        .expect(404);

      expect(response.body.error).toEqual({
        message: 'Execution not found',
        code: 'EXECUTION_NOT_FOUND'
      });
    });

    it('should validate execution ID parameter', async () => {
      const response = await request(app)
        .get('/executions/')
        .expect(404); // Express routing will handle this
    });
  });

  describe('GET /executions/:executionId/image', () => {
    it('should serve image with proper headers', async () => {
      const mockExecution = { id: '123', workflowId: 'test' };
      const mockImageData = {
        stream: {
          pipe: jest.fn()
        },
        contentType: 'image/jpeg',
        size: 1024
      };

      mockExecutionService.getExecutionById.mockResolvedValueOnce(mockExecution);
      mockImageService.getImage.mockResolvedValueOnce(mockImageData);

      const response = await request(app)
        .get('/executions/123/image')
        .expect(200);

      expect(response.headers['content-type']).toBe('image/jpeg');
      expect(response.headers['content-length']).toBe('1024');
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
      expect(response.headers['etag']).toBe('"123-original"');
    });

    it('should handle thumbnail requests', async () => {
      const mockExecution = { id: '123', workflowId: 'test' };
      const mockImageData = {
        stream: { pipe: jest.fn() },
        contentType: 'image/jpeg',
        size: 512
      };

      mockExecutionService.getExecutionById.mockResolvedValueOnce(mockExecution);
      mockImageService.getImage.mockResolvedValueOnce(mockImageData);

      await request(app)
        .get('/executions/123/image?thumbnail=true')
        .expect(200);

      expect(mockImageService.getImage).toHaveBeenCalledWith('123', true);
    });

    it('should return 404 for missing execution', async () => {
      mockExecutionService.getExecutionById.mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/executions/nonexistent/image')
        .expect(404);

      expect(response.body.error.code).toBe('EXECUTION_NOT_FOUND');
    });

    it('should return 404 for missing image data', async () => {
      const mockExecution = { id: '123', workflowId: 'test' };
      
      mockExecutionService.getExecutionById.mockResolvedValueOnce(mockExecution);
      mockImageService.getImage.mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/executions/123/image')
        .expect(404);

      expect(response.body.error.code).toBe('IMAGE_DATA_ERROR');
    });

    it('should handle ETag caching', async () => {
      const mockExecution = { id: '123', workflowId: 'test' };
      
      mockExecutionService.getExecutionById.mockResolvedValueOnce(mockExecution);

      const response = await request(app)
        .get('/executions/123/image')
        .set('If-None-Match', '"123-original"')
        .expect(304);
    });
  });

  describe('GET /executions/summary/daily', () => {
    it('should return daily summary with default days', async () => {
      const mockSummary = [
        { date: '2025-08-29', total: 25, success: 24, error: 1 }
      ];

      mockExecutionService.getDailySummary.mockResolvedValueOnce(mockSummary);

      const response = await request(app)
        .get('/executions/summary/daily')
        .expect(200);

      expect(response.body).toEqual({
        data: mockSummary,
        meta: {
          days: 30,
          totalDays: 1
        }
      });

      expect(mockExecutionService.getDailySummary).toHaveBeenCalledWith(30);
    });

    it('should validate days parameter limit', async () => {
      const response = await request(app)
        .get('/executions/summary/daily?days=100')
        .expect(400);

      expect(response.body.error).toEqual({
        message: 'Maximum 90 days allowed',
        code: 'INVALID_DAYS_RANGE'
      });
    });
  });

  describe('GET /executions/stats', () => {
    it('should return execution statistics', async () => {
      const mockStats = {
        total: 100,
        success: 95,
        error: 5
      };

      mockExecutionService.getExecutionStats.mockResolvedValueOnce(mockStats);

      const response = await request(app)
        .get('/executions/stats')
        .expect(200);

      expect(response.body).toEqual({
        data: mockStats
      });
    });
  });

  describe('GET /executions/search', () => {
    it('should search executions with query validation', async () => {
      const mockResults = [
        { id: '1', workflowId: 'test', status: 'success' }
      ];

      mockExecutionService.searchExecutions.mockResolvedValueOnce(mockResults);

      const response = await request(app)
        .get('/executions/search?q=test%20query&limit=10')
        .expect(200);

      expect(response.body).toEqual({
        data: mockResults,
        meta: {
          query: 'test query',
          limit: 10,
          resultsCount: 1
        }
      });

      expect(mockExecutionService.searchExecutions).toHaveBeenCalledWith('test query', 10);
    });

    it('should validate search query requirements', async () => {
      const response = await request(app)
        .get('/executions/search')
        .expect(400);

      expect(response.body.error).toEqual({
        message: 'Search query is required',
        code: 'MISSING_SEARCH_QUERY'
      });
    });

    it('should validate search query length', async () => {
      const longQuery = 'a'.repeat(101);
      
      const response = await request(app)
        .get(`/executions/search?q=${longQuery}`)
        .expect(400);

      expect(response.body.error).toEqual({
        message: 'Search query too long (max 100 characters)',
        code: 'SEARCH_QUERY_TOO_LONG'
      });
    });
  });
});