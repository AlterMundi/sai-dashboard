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
      // Direct table access for maximum performance (4ms vs 21s with views)
      // See DATABASE_PERFORMANCE.md for detailed analysis
      const query = `
        SELECT data
        FROM execution_data
        WHERE "executionId" = $1
          AND data IS NOT NULL
          AND data::text ~ 'data:image'
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
    // Direct table access - views are too slow for single ID lookups
    // See DATABASE_PERFORMANCE.md for detailed analysis
    const execution = await db.query(
      'SELECT "startedAt" as started_at FROM execution_entity WHERE id = $1',
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

  /**
   * Get WebP variant of execution image
   * Used by hybrid JPEG+WebP serving approach
   */
  async getImageWebP(executionId: string): Promise<{stream: NodeJS.ReadableStream, size: number} | null> {
    try {
      // First check if WebP variant exists in new hybrid structure
      const date = new Date(); // In production, get from execution timestamp
      const webpPattern = this.getHybridImagePath(executionId, 'webp', date);
      const webpPath = await this.findHybridFile(webpPattern);
      
      if (webpPath && existsSync(webpPath)) {
        const stats = await fs.stat(webpPath);
        const stream = createReadStream(webpPath);
        
        logger.debug('Serving WebP variant:', { 
          executionId, 
          path: webpPath,
          size: stats.size 
        });
        
        return {
          stream,
          size: stats.size
        };
      }

      // WebP variant not found
      logger.debug('WebP variant not found:', { executionId, pattern: webpPattern });
      return null;

    } catch (error) {
      logger.error('Error getting WebP image:', { executionId, error });
      return null;
    }
  }

  /**
   * Get WebP thumbnail for execution image
   */
  async getThumbnail(executionId: string, size: '150px' | '300px'): Promise<{stream: NodeJS.ReadableStream, size: number} | null> {
    try {
      const thumbnailPattern = this.getHybridThumbnailPath(executionId, size);
      const thumbnailPath = await this.findHybridFile(thumbnailPattern);
      
      if (thumbnailPath && existsSync(thumbnailPath)) {
        const stats = await fs.stat(thumbnailPath);
        const stream = createReadStream(thumbnailPath);
        
        logger.debug('Serving WebP thumbnail:', { 
          executionId, 
          size,
          path: thumbnailPath,
          fileSize: stats.size 
        });
        
        return {
          stream,
          size: stats.size
        };
      }

      // Thumbnail not found
      logger.debug('WebP thumbnail not found:', { executionId, size, pattern: thumbnailPattern });
      return null;

    } catch (error) {
      logger.error('Error getting WebP thumbnail:', { executionId, size, error });
      return null;
    }
  }

  /**
   * Get hybrid image path based on new directory structure
   * /mnt/raid1/n8n/backup/images/originals/YYYY/MM/DD/executionId_timestamp.jpg
   * /mnt/raid1/n8n/backup/images/webp/YYYY/MM/DD/executionId_timestamp.webp
   */
  private getHybridImagePath(executionId: string, format: 'jpeg' | 'webp', date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    const baseDir = format === 'jpeg' ? 'originals' : 'webp';
    const extension = format === 'jpeg' ? 'jpg' : 'webp';
    
    // Pattern: executionId_timestamp.ext (timestamp will be generated during processing)
    // For now, we'll use a glob pattern to find the file
    return join(this.cachePath, baseDir, year.toString(), month, day, `${executionId}_*.${extension}`);
  }

  /**
   * Get hybrid thumbnail path
   * /mnt/raid1/n8n/backup/images/thumbnails/150px/executionId_timestamp.webp
   */
  private getHybridThumbnailPath(executionId: string, size: '150px' | '300px'): string {
    // Pattern: executionId_timestamp.webp (timestamp will be generated during processing)
    // For now, we'll use a glob pattern to find the file
    return join(this.cachePath, 'thumbnails', size, `${executionId}_*.webp`);
  }

  /**
   * Find actual file path from glob pattern (helper for hybrid structure)
   */
  private async findHybridFile(globPattern: string): Promise<string | null> {
    try {
      const glob = require('glob');
      const files = glob.sync(globPattern);
      
      if (files.length > 0) {
        // Return the most recent file if multiple matches
        const fileStats = await Promise.all(
          files.map(async (file: string) => ({
            path: file,
            mtime: (await fs.stat(file)).mtime
          }))
        );
        
        fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        return fileStats[0].path;
      }
      
      return null;
    } catch (error) {
      logger.error('Error finding hybrid file:', { globPattern, error });
      return null;
    }
  }
}

export const imageService = new ImageService();