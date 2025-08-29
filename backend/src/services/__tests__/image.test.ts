import { ImageService } from '../image';
import { db } from '../../database/pool';
import { promises as fs } from 'fs';
import { createReadStream, existsSync } from 'fs';
import sharp from 'sharp';
import { mockExecutionDataPayload } from '../../__tests__/setup';

jest.mock('../../database/pool');
jest.mock('fs');
jest.mock('sharp');

describe('ImageService', () => {
  let service: ImageService;
  const mockDb = db as jest.Mocked<typeof db>;
  const mockFs = fs as jest.Mocked<typeof fs>;
  const mockFsSync = { existsSync } as { existsSync: jest.MockedFunction<typeof existsSync> };

  beforeEach(() => {
    service = new ImageService();
    jest.clearAllMocks();
  });

  describe('ensureCacheDirectory', () => {
    it('should create cache directory if it does not exist', async () => {
      mockFs.access.mockRejectedValueOnce(new Error('Directory not found'));
      mockFs.mkdir.mockResolvedValueOnce(undefined);

      await service.ensureCacheDirectory();

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('/test-cache'),
        { recursive: true }
      );
    });

    it('should not create directory if it already exists', async () => {
      mockFs.access.mockResolvedValueOnce(undefined);

      await service.ensureCacheDirectory();

      expect(mockFs.mkdir).not.toHaveBeenCalled();
    });
  });

  describe('extractImageFromDatabase', () => {
    it('should extract image from database payload', async () => {
      mockDb.query.mockResolvedValueOnce([mockExecutionDataPayload]);

      const result = await service.extractImageFromDatabase('test-exec-123');

      expect(result).not.toBeNull();
      expect(result?.buffer).toBeInstanceOf(Buffer);
      expect(result?.metadata).toHaveProperty('width', 1920);
      expect(result?.metadata).toHaveProperty('height', 1080);
      expect(result?.mimeType).toBe('image/jpeg');
    });

    it('should return null when no image data found', async () => {
      mockDb.query.mockResolvedValueOnce([]);

      const result = await service.extractImageFromDatabase('non-existent');

      expect(result).toBeNull();
    });

    it('should handle invalid JSON data', async () => {
      mockDb.query.mockResolvedValueOnce([{
        ...mockExecutionDataPayload,
        data: 'invalid-json',
      }]);

      const result = await service.extractImageFromDatabase('test-exec-123');

      expect(result).toBeNull();
    });

    it('should handle missing binary data in payload', async () => {
      mockDb.query.mockResolvedValueOnce([{
        ...mockExecutionDataPayload,
        data: JSON.stringify({ main: [{ json: {} }] }), // No binary field
      }]);

      const result = await service.extractImageFromDatabase('test-exec-123');

      expect(result).toBeNull();
    });

    it('should remove data URL prefix from base64', async () => {
      const dataUrlPayload = {
        ...mockExecutionDataPayload,
        data: JSON.stringify({
          main: [{
            binary: {
              data: 'data:image/jpeg;base64,' + Buffer.from('test-image').toString('base64'),
              mimeType: 'image/jpeg',
            },
          }],
        }),
      };

      mockDb.query.mockResolvedValueOnce([dataUrlPayload]);

      const result = await service.extractImageFromDatabase('test-exec-123');

      expect(result).not.toBeNull();
      expect(result?.buffer.toString()).toBe('test-image');
    });
  });

  describe('generateThumbnail', () => {
    it('should generate thumbnail from buffer', async () => {
      const originalBuffer = Buffer.from('original-image');
      const thumbnailBuffer = Buffer.from('thumbnail-image');

      (sharp as unknown as jest.Mock).mockReturnValue({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(thumbnailBuffer),
      });

      const result = await service.generateThumbnail(originalBuffer);

      expect(result).toEqual(thumbnailBuffer);
      expect(sharp).toHaveBeenCalledWith(originalBuffer);
    });

    it('should handle thumbnail generation errors', async () => {
      (sharp as unknown as jest.Mock).mockReturnValue({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockRejectedValue(new Error('Sharp error')),
      });

      await expect(service.generateThumbnail(Buffer.from('test')))
        .rejects.toThrow('Thumbnail generation failed');
    });
  });

  describe('cacheImage', () => {
    it('should cache image to filesystem', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.symlink.mockResolvedValue(undefined);

      const buffer = Buffer.from('test-image');
      const date = new Date('2025-08-29');

      const result = await service.cacheImage('test-exec-123', buffer, date);

      expect(result.originalPath).toContain('test-exec-123');
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('test-exec-123'),
        buffer
      );
    });

    it('should generate thumbnail when enabled', async () => {
      process.env.ENABLE_THUMBNAIL_GENERATION = 'true';
      
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      (sharp as unknown as jest.Mock).mockReturnValue({
        resize: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('thumb')),
      });

      const buffer = Buffer.from('test-image');
      const result = await service.cacheImage('test-exec-123', buffer, new Date());

      expect(result.thumbnailPath).not.toBeNull();
      expect(mockFs.writeFile).toHaveBeenCalledTimes(2); // Original + thumbnail
    });

    it('should handle symlink creation errors gracefully', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.symlink.mockRejectedValue(new Error('Symlink error'));

      const buffer = Buffer.from('test-image');
      
      // Should not throw
      await expect(service.cacheImage('test-exec-123', buffer, new Date()))
        .resolves.toBeDefined();
    });
  });

  describe('getImage', () => {
    it('should serve image from cache when available', async () => {
      mockFsSync.existsSync.mockReturnValue(true);
      mockFs.stat.mockResolvedValue({ size: 1024 } as any);
      
      const mockStream = { pipe: jest.fn() };
      (createReadStream as jest.Mock).mockReturnValue(mockStream);

      const result = await service.getImage('test-exec-123', false);

      expect(result).not.toBeNull();
      expect(result?.stream).toBe(mockStream);
      expect(result?.contentType).toBe('image/jpeg');
      expect(result?.size).toBe(1024);
    });

    it('should extract from database when not in cache', async () => {
      mockFsSync.existsSync.mockReturnValue(false);
      mockDb.query
        .mockResolvedValueOnce([mockExecutionDataPayload]) // Image data
        .mockResolvedValueOnce([{ started_at: new Date() }]); // Execution date

      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const result = await service.getImage('test-exec-123', false);

      expect(result).not.toBeNull();
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('should return null when image not found', async () => {
      mockFsSync.existsSync.mockReturnValue(false);
      mockDb.query.mockResolvedValueOnce([]); // No image data

      const result = await service.getImage('non-existent', false);

      expect(result).toBeNull();
    });

    it('should serve thumbnail when requested', async () => {
      mockFsSync.existsSync.mockReturnValue(true);
      mockFs.stat.mockResolvedValue({ size: 512 } as any);
      
      const mockStream = { pipe: jest.fn() };
      (createReadStream as jest.Mock).mockReturnValue(mockStream);

      const result = await service.getImage('test-exec-123', true);

      expect(result?.size).toBe(512);
      expect(mockFsSync.existsSync).toHaveBeenCalledWith(
        expect.stringContaining('_thumb')
      );
    });
  });

  describe('getImageMetadata', () => {
    it('should get metadata from cached image', async () => {
      mockFsSync.existsSync.mockReturnValue(true);
      mockFs.stat.mockResolvedValue({ size: 2048 } as any);

      (sharp as unknown as jest.Mock).mockReturnValue({
        metadata: jest.fn().mockResolvedValue({
          width: 1920,
          height: 1080,
          format: 'jpeg',
        }),
      });

      const result = await service.getImageMetadata('test-exec-123');

      expect(result).toEqual({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        size: 2048,
      });
    });

    it('should extract metadata from database when not cached', async () => {
      mockFsSync.existsSync.mockReturnValue(false);
      mockDb.query.mockResolvedValueOnce([mockExecutionDataPayload]);

      const result = await service.getImageMetadata('test-exec-123');

      expect(result).toEqual({
        width: 1920,
        height: 1080,
        format: 'jpeg',
        size: expect.any(Number),
      });
    });

    it('should return null when image not found', async () => {
      mockFsSync.existsSync.mockReturnValue(false);
      mockDb.query.mockResolvedValueOnce([]);

      const result = await service.getImageMetadata('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('cleanupOldCache', () => {
    it('should delete old cached files', async () => {
      const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days old
      const recentDate = new Date();

      mockFs.readdir
        .mockResolvedValueOnce([{ name: 'exec-1', isDirectory: () => true }] as any)
        .mockResolvedValueOnce(['image1.jpg', 'image2.jpg'] as any);

      mockFs.stat
        .mockResolvedValueOnce({ mtime: oldDate, size: 1024 } as any)
        .mockResolvedValueOnce({ mtime: recentDate, size: 2048 } as any);

      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.rmdir.mockResolvedValue(undefined);

      const result = await service.cleanupOldCache(24 * 7); // 7 days

      expect(result.deletedFiles).toBe(1);
      expect(result.freedSpace).toBe(1024);
      expect(mockFs.unlink).toHaveBeenCalledTimes(1);
    });

    it('should remove empty directories after cleanup', async () => {
      mockFs.readdir
        .mockResolvedValueOnce([{ name: 'exec-1', isDirectory: () => true }] as any)
        .mockResolvedValueOnce([]) // Empty directory
        .mockResolvedValueOnce([]); // Still empty after cleanup

      mockFs.rmdir.mockResolvedValue(undefined);

      await service.cleanupOldCache();

      expect(mockFs.rmdir).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockFs.readdir.mockRejectedValue(new Error('Read error'));

      const result = await service.cleanupOldCache();

      expect(result.deletedFiles).toBe(0);
      expect(result.freedSpace).toBe(0);
    });
  });
});