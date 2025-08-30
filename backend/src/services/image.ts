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

  private getCacheFilePath(executionId: string, isThumbnail = false, date?: Date): string {
    // Scalable hierarchical structure: /YYYY/MM/DD/executionId/image.jpg
    // Full execution ID used as directory name for uniqueness
    const suffix = isThumbnail ? '_thumb' : 'image';
    const filename = `${suffix}.jpg`;
    
    // Use provided date or current date
    const cacheDate = date || new Date();
    const year = cacheDate.getFullYear();
    const month = String(cacheDate.getMonth() + 1).padStart(2, '0');
    const day = String(cacheDate.getDate()).padStart(2, '0');
    
    // Full execution ID as directory ensures uniqueness
    const sanitizedId = sanitizeFilename(executionId);
    
    return join(this.cachePath, year.toString(), month, day, sanitizedId, filename);
  }


  async extractImageFromDatabase(executionId: string): Promise<{
    buffer: Buffer;
    metadata: ImageMetadata;
    mimeType: string;
  } | null> {
    try {
      // Query execution data from n8n database - search for base64 image data
      const query = `
        SELECT ed.data
        FROM execution_data ed
        WHERE ed."executionId" = $1
          AND ed.data::text ~ 'data:image'
        LIMIT 1
      `;

      const results = await db.query(query, [executionId]);

      if (results.length === 0) {
        logger.warn('No webhook image data found for execution:', executionId);
        return null;
      }

      const executionData = results[0];
      const jsonData = executionData.data;

      // Extract base64 image data from n8n structure
      let base64Data: string;
      let mimeType = 'image/jpeg'; // default

      try {
        const parsed = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
        
        // Search through the n8n execution data array for image data
        let imageDataUrl: string | null = null;
        
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const dataStr = JSON.stringify(item);
            if (dataStr.includes('data:image')) {
              // Extract the data URL from the JSON string
              const match = dataStr.match(/"data:image\/[^"]*;base64,[^"]+"/);
              if (match) {
                imageDataUrl = match[0].slice(1, -1); // Remove quotes
                break;
              }
            }
          }
        }
        
        if (!imageDataUrl) {
          logger.warn('No image data URL found in execution data:', executionId);
          return null;
        }

        // Parse data URL to extract base64 and mime type
        const dataUrlMatch = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!dataUrlMatch) {
          logger.warn('Invalid data URL format for execution:', executionId);
          return null;
        }

        mimeType = dataUrlMatch[1];
        base64Data = dataUrlMatch[2];

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

  async cacheImage(executionId: string, buffer: Buffer, date?: Date): Promise<{
    originalPath: string;
    thumbnailPath: string | null;
  }> {
    await this.ensureCacheDirectory();

    const cacheDate = date || new Date();
    const originalPath = this.getCacheFilePath(executionId, false, cacheDate);
    const thumbnailPath = cacheConfig.enableThumbnails ? 
      this.getCacheFilePath(executionId, true, cacheDate) : null;

    // Create directory structure if it doesn't exist
    await fs.mkdir(dirname(originalPath), { recursive: true });

    // Save original webhook image
    await fs.writeFile(originalPath, buffer);

    // Generate and save thumbnail
    if (cacheConfig.enableThumbnails && thumbnailPath) {
      const thumbnailBuffer = await this.generateThumbnail(buffer);
      await fs.writeFile(thumbnailPath, thumbnailBuffer);
    }

    logger.debug('Webhook image cached successfully:', {
      executionId,
      originalPath,
      thumbnailPath,
      size: formatBytes(buffer.length),
      date: cacheDate.toISOString()
    });

    return { originalPath, thumbnailPath };
  }

  async getImage(executionId: string, thumbnail = false): Promise<{
    stream: NodeJS.ReadableStream;
    contentType: string;
    size: number;
  } | null> {
    // First, try to find the cached file by searching recent dates
    // We'll check the last 30 days of cache directories
    const searchDays = 30;
    const today = new Date();
    
    for (let daysAgo = 0; daysAgo < searchDays; daysAgo++) {
      const searchDate = new Date(today);
      searchDate.setDate(searchDate.getDate() - daysAgo);
      
      const cacheFilePath = this.getCacheFilePath(executionId, thumbnail, searchDate);
      
      if (existsSync(cacheFilePath)) {
        const stats = await fs.stat(cacheFilePath);
        const stream = createReadStream(cacheFilePath);

        logger.debug('Serving image from cache:', {
          executionId,
          thumbnail,
          size: formatBytes(stats.size),
          path: cacheFilePath
        });

        return {
          stream,
          contentType: 'image/jpeg',
          size: stats.size
        };
      }
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

  async cleanupOldCache(maxAgeDays: number = 30): Promise<{
    deletedDirectories: number;
    deletedFiles: number;
    freedSpace: number;
  }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    
    let deletedDirectories = 0;
    let deletedFiles = 0;
    let freedSpace = 0;

    try {
      // Scan year directories
      const years = await fs.readdir(this.cachePath, { withFileTypes: true });
      
      for (const year of years) {
        if (!year.isDirectory()) continue;
        
        const yearPath = join(this.cachePath, year.name);
        const months = await fs.readdir(yearPath, { withFileTypes: true });
        
        for (const month of months) {
          if (!month.isDirectory()) continue;
          
          const monthPath = join(yearPath, month.name);
          const days = await fs.readdir(monthPath, { withFileTypes: true });
          
          for (const day of days) {
            if (!day.isDirectory()) continue;
            
            // Check if this day directory is older than cutoff
            const dateStr = `${year.name}-${month.name}-${day.name}`;
            const dirDate = new Date(dateStr);
            
            if (dirDate < cutoffDate) {
              // Delete entire day directory and its contents
              const dayPath = join(monthPath, day.name);
              const { size, dirs, files } = await this.getDirectorySize(dayPath);
              
              await fs.rm(dayPath, { recursive: true, force: true });
              
              deletedDirectories += dirs;
              deletedFiles += files;
              freedSpace += size;
              
              logger.info('Cleaned up old cache directory:', {
                path: dayPath,
                date: dateStr,
                filesDeleted: files,
                spaceFreed: formatBytes(size)
              });
            }
          }
          
          // Remove empty month directories
          const remainingDays = await fs.readdir(monthPath);
          if (remainingDays.length === 0) {
            await fs.rmdir(monthPath);
          }
        }
        
        // Remove empty year directories
        const remainingMonths = await fs.readdir(yearPath);
        if (remainingMonths.length === 0) {
          await fs.rmdir(yearPath);
        }
      }

      logger.info('Cache cleanup completed:', {
        deletedDirectories,
        deletedFiles,
        freedSpace: formatBytes(freedSpace),
        maxAgeDays
      });

      return { deletedDirectories, deletedFiles, freedSpace };

    } catch (error) {
      logger.error('Cache cleanup failed:', error);
      return { deletedDirectories: 0, deletedFiles: 0, freedSpace: 0 };
    }
  }

  private async getDirectorySize(dirPath: string): Promise<{ size: number; dirs: number; files: number }> {
    let totalSize = 0;
    let dirCount = 0;
    let fileCount = 0;

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        dirCount++;
        const subDir = await this.getDirectorySize(fullPath);
        totalSize += subDir.size;
        dirCount += subDir.dirs;
        fileCount += subDir.files;
      } else {
        fileCount++;
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      }
    }
    
    return { size: totalSize, dirs: dirCount, files: fileCount };
  }
}

export const imageService = new ImageService();