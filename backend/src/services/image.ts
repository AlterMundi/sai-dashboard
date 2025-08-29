import { promises as fs } from 'fs';
import { createReadStream, existsSync } from 'fs';
import { join, dirname } from 'path';
import sharp from 'sharp';
import { db } from '@/database/pool';
import { cacheConfig } from '@/config';
import { logger } from '@/utils/logger';
import { validateImageFormat, sanitizeFilename, formatBytes } from '@/utils';

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
}

export class ImageService {
  private readonly cachePath: string;

  constructor() {
    this.cachePath = cacheConfig.path;
  }

  async ensureCacheDirectory(): Promise<void> {
    try {
      await fs.access(this.cachePath);
    } catch {
      await fs.mkdir(this.cachePath, { recursive: true });
      logger.info('Cache directory created:', this.cachePath);
    }
  }

  private getCacheFilePath(executionId: string, isThumbnail = false): string {
    const suffix = isThumbnail ? '_thumb' : '';
    const filename = sanitizeFilename(`${executionId}${suffix}.jpg`);
    return join(this.cachePath, 'by-execution', executionId, filename);
  }

  private getByDateCachePath(executionId: string, date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const filename = sanitizeFilename(`${executionId}.jpg`);
    return join(this.cachePath, 'by-date', year.toString(), month, day, filename);
  }

  async extractImageFromDatabase(executionId: string): Promise<{
    buffer: Buffer;
    metadata: ImageMetadata;
    mimeType: string;
  } | null> {
    try {
      // Query execution data for image payload
      const query = `
        SELECT ed.data, ed.node_id
        FROM sai_execution_data ed
        WHERE ed.execution_id = $1
          AND ed.data::jsonb ? 'main'
          AND ed.data::jsonb -> 'main' -> 0 -> 'binary' ? 'data'
        ORDER BY 
          CASE WHEN ed.node_id = 'Webhook' THEN 1 ELSE 2 END,
          ed.created_at DESC
        LIMIT 1
      `;

      const results = await db.query(query, [executionId]);

      if (results.length === 0) {
        logger.warn('No image data found for execution:', executionId);
        return null;
      }

      const executionData = results[0];
      const jsonData = executionData.data;

      // Extract base64 image data
      let base64Data: string;
      let mimeType = 'image/jpeg'; // default

      try {
        const parsed = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
        const binaryData = parsed?.main?.[0]?.binary;

        if (!binaryData || !binaryData.data) {
          logger.warn('Invalid image data structure for execution:', executionId);
          return null;
        }

        base64Data = binaryData.data;
        mimeType = binaryData.mimeType || mimeType;

        // Remove data URL prefix if present
        if (base64Data.startsWith('data:')) {
          const commaIndex = base64Data.indexOf(',');
          if (commaIndex !== -1) {
            base64Data = base64Data.substring(commaIndex + 1);
          }
        }

      } catch (parseError) {
        logger.error('Failed to parse execution data JSON:', parseError);
        return null;
      }

      // Convert base64 to buffer
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Validate image format
      const validation = validateImageFormat(imageBuffer);
      if (!validation.isValid) {
        logger.warn('Invalid image format for execution:', executionId);
        return null;
      }

      // Get image metadata using Sharp
      const metadata = await sharp(imageBuffer).metadata();

      const imageMetadata: ImageMetadata = {
        width: metadata.width || 0,
        height: metadata.height || 0,
        format: validation.format || 'unknown',
        size: imageBuffer.length
      };

      logger.debug('Image extracted from database:', {
        executionId,
        size: formatBytes(imageBuffer.length),
        dimensions: `${imageMetadata.width}x${imageMetadata.height}`,
        format: imageMetadata.format
      });

      return {
        buffer: imageBuffer,
        metadata: imageMetadata,
        mimeType
      };

    } catch (error) {
      logger.error('Failed to extract image from database:', { executionId, error });
      return null;
    }
  }

  async generateThumbnail(originalBuffer: Buffer): Promise<Buffer> {
    try {
      const thumbnailBuffer = await sharp(originalBuffer)
        .resize(cacheConfig.thumbnailSize, cacheConfig.thumbnailSize, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({
          quality: cacheConfig.thumbnailQuality,
          progressive: true,
          mozjpeg: true
        })
        .toBuffer();

      return thumbnailBuffer;

    } catch (error) {
      logger.error('Failed to generate thumbnail:', error);
      throw new Error('Thumbnail generation failed');
    }
  }

  async cacheImage(executionId: string, buffer: Buffer, date: Date): Promise<{
    originalPath: string;
    thumbnailPath: string | null;
  }> {
    await this.ensureCacheDirectory();

    const originalPath = this.getCacheFilePath(executionId, false);
    const thumbnailPath = cacheConfig.enableThumbnails ? 
      this.getCacheFilePath(executionId, true) : null;

    // Ensure directory structure exists
    await fs.mkdir(dirname(originalPath), { recursive: true });

    // Save original image
    await fs.writeFile(originalPath, buffer);

    // Generate and save thumbnail
    if (cacheConfig.enableThumbnails && thumbnailPath) {
      const thumbnailBuffer = await this.generateThumbnail(buffer);
      await fs.writeFile(thumbnailPath, thumbnailBuffer);
    }

    // Create by-date symlink for organization
    const byDatePath = this.getByDateCachePath(executionId, date);
    await fs.mkdir(dirname(byDatePath), { recursive: true });
    
    try {
      // Create relative symlink to avoid absolute path issues
      await fs.symlink(originalPath, byDatePath);
    } catch (symlinkError) {
      // Symlink creation is optional, don't fail if it doesn't work
      logger.debug('Failed to create symlink:', symlinkError);
    }

    logger.debug('Image cached successfully:', {
      executionId,
      originalPath,
      thumbnailPath,
      size: formatBytes(buffer.length)
    });

    return { originalPath, thumbnailPath };
  }

  async getImage(executionId: string, thumbnail = false): Promise<{
    stream: NodeJS.ReadableStream;
    contentType: string;
    size: number;
  } | null> {
    const cacheFilePath = this.getCacheFilePath(executionId, thumbnail);

    // Check cache first
    if (existsSync(cacheFilePath)) {
      const stats = await fs.stat(cacheFilePath);
      const stream = createReadStream(cacheFilePath);

      logger.debug('Serving image from cache:', {
        executionId,
        thumbnail,
        size: formatBytes(stats.size)
      });

      return {
        stream,
        contentType: 'image/jpeg',
        size: stats.size
      };
    }

    // Extract from database if not in cache
    const imageData = await this.extractImageFromDatabase(executionId);
    
    if (!imageData) {
      return null;
    }

    // Cache the extracted image
    const execution = await db.query(
      'SELECT started_at FROM sai_executions WHERE id = $1',
      [executionId]
    );

    const executionDate = execution[0]?.started_at ? 
      new Date(execution[0].started_at) : new Date();

    await this.cacheImage(executionId, imageData.buffer, executionDate);

    // Return appropriate version
    const buffer = thumbnail && cacheConfig.enableThumbnails ? 
      await this.generateThumbnail(imageData.buffer) : imageData.buffer;

    // Create readable stream from buffer
    const { Readable } = require('stream');
    const stream = Readable.from(buffer);

    logger.info('Image extracted and served from database:', {
      executionId,
      thumbnail,
      originalSize: formatBytes(imageData.buffer.length),
      servedSize: formatBytes(buffer.length)
    });

    return {
      stream,
      contentType: imageData.mimeType,
      size: buffer.length
    };
  }

  async getImageMetadata(executionId: string): Promise<ImageMetadata | null> {
    const cacheFilePath = this.getCacheFilePath(executionId, false);

    // Check cache first
    if (existsSync(cacheFilePath)) {
      try {
        const metadata = await sharp(cacheFilePath).metadata();
        const stats = await fs.stat(cacheFilePath);

        return {
          width: metadata.width || 0,
          height: metadata.height || 0,
          format: metadata.format || 'unknown',
          size: stats.size
        };
      } catch (error) {
        logger.warn('Failed to read metadata from cached image:', error);
      }
    }

    // Extract from database
    const imageData = await this.extractImageFromDatabase(executionId);
    return imageData?.metadata || null;
  }

  async cleanupOldCache(maxAgeHours: number = 24 * 7): Promise<{
    deletedFiles: number;
    freedSpace: number;
  }> {
    const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    let deletedFiles = 0;
    let freedSpace = 0;

    try {
      const byExecutionPath = join(this.cachePath, 'by-execution');
      const executionDirs = await fs.readdir(byExecutionPath, { withFileTypes: true });

      for (const dir of executionDirs) {
        if (!dir.isDirectory()) continue;

        const dirPath = join(byExecutionPath, dir.name);
        const files = await fs.readdir(dirPath);

        for (const file of files) {
          const filePath = join(dirPath, file);
          const stats = await fs.stat(filePath);

          if (stats.mtime < cutoffTime) {
            freedSpace += stats.size;
            await fs.unlink(filePath);
            deletedFiles++;
          }
        }

        // Remove empty directories
        const remainingFiles = await fs.readdir(dirPath);
        if (remainingFiles.length === 0) {
          await fs.rmdir(dirPath);
        }
      }

      logger.info('Cache cleanup completed:', {
        deletedFiles,
        freedSpace: formatBytes(freedSpace),
        maxAgeHours
      });

      return { deletedFiles, freedSpace };

    } catch (error) {
      logger.error('Cache cleanup failed:', error);
      return { deletedFiles: 0, freedSpace: 0 };
    }
  }
}

export const imageService = new ImageService();