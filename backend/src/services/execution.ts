import { db } from '@/database/pool';
import { 
  ExecutionWithImage, 
  ExecutionFilters, 
  DailySummary
} from '@/types';
import { logger } from '@/utils/logger';
import { appConfig } from '@/config';

export class ExecutionService {
  
  async getExecutions(filters: ExecutionFilters = {}): Promise<{
    executions: ExecutionWithImage[];
    total: number;
    hasNext: boolean;
  }> {
    const {
      page = 0,
      limit = appConfig.sai.defaultPageSize,
      offset,
      status,
      startDate,
      endDate,
      search,
      hasImage
    } = filters;

    const actualLimit = Math.min(limit, appConfig.sai.maxPageSize);
    const actualOffset = offset ?? (page * actualLimit);

    let whereConditions = ['1=1'];
    const queryParams: any[] = [];
    let paramCount = 0;

    // Status filter
    if (status) {
      paramCount++;
      whereConditions.push(`status = $${paramCount}`);
      queryParams.push(status);
    }

    // Date range filters
    if (startDate) {
      paramCount++;
      whereConditions.push(`e.\"startedAt\" >= $${paramCount}`);
      queryParams.push(new Date(startDate));
    }

    if (endDate) {
      paramCount++;
      whereConditions.push(`e.\"startedAt\" <= $${paramCount}`);
      queryParams.push(new Date(endDate));
    }

    // Image filter
    if (hasImage !== undefined) {
      paramCount++;
      whereConditions.push(`has_image = $${paramCount}`);
      queryParams.push(hasImage);
    }

    // Search filter (in Ollama analysis)
    if (search && search.trim()) {
      paramCount++;
      whereConditions.push(`ollama_analysis ILIKE $${paramCount}`);
      queryParams.push(`%${search.trim()}%`);
    }

    // Limit lookback to prevent excessive queries
    const maxLookbackDate = new Date();
    maxLookbackDate.setDate(maxLookbackDate.getDate() - appConfig.sai.maxDaysLookback);
    paramCount++;
    whereConditions.push(`e.\"startedAt\" >= $${paramCount}`);
    queryParams.push(maxLookbackDate);

    const whereClause = whereConditions.join(' AND ');

    // Skip expensive COUNT(*) for performance - use estimate instead
    // For initial loads, we'll determine hasNext by fetching limit+1 records
    let total = 0;

    // Get executions
    paramCount++;
    const limitParam = paramCount;
    paramCount++;
    const offsetParam = paramCount;

    const executionsQuery = `
      SELECT 
        e.id::text as id,
        e."workflowId"::text as workflow_id,
        e.status,
        e."startedAt" as started_at,
        e."stoppedAt" as stopped_at,
        e.mode,
        e.finished,
        e."retryOf"::text as retry_of,
        e."retrySuccessId"::text as retry_success_id,
        w.name as workflow_name,
        NULL as image_mime_type,
        false as has_image,
        NULL as ollama_analysis,
        0 as total_payload_size,
        false as telegram_delivered,
        NULL as telegram_message_id,
        NULL as image_url,
        NULL as thumbnail_url,
        NULL as duration_seconds
      FROM execution_entity e
      JOIN workflow_entity w ON e."workflowId"::text = w.id::text
      WHERE w.id = 'yDbfhooKemfhMIkC'
        AND e.status IS NOT NULL
        AND e."deletedAt" IS NULL
        AND ${whereClause}
      ORDER BY e."startedAt" DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    // Fetch one extra record to determine if there are more pages
    queryParams.push(actualLimit + 1, actualOffset);

    const executions = await db.query<ExecutionWithImage>(
      executionsQuery, 
      queryParams
    );

    // Process results
    const processedExecutions: ExecutionWithImage[] = executions.map((exec: any) => {
      const result: ExecutionWithImage = {
        id: exec.id,
        workflowId: exec.workflow_id,
        status: exec.status,
        startedAt: new Date(exec.started_at),
        stoppedAt: exec.stopped_at ? new Date(exec.stopped_at) : null,
        mode: exec.mode,
        finished: exec.finished,
        retryOf: exec.retry_of,
        retrySuccessId: exec.retry_success_id,
        telegramDelivered: exec.telegram_delivered || false
      };
      
      // Always set image URLs - they will be generated dynamically
      // The frontend will construct the actual URLs using the API service
      result.imageUrl = `/dashboard/api/executions/${exec.id}/image`;
      result.thumbnailUrl = `/dashboard/api/executions/${exec.id}/image?thumbnail=true`;
      if (exec.telegram_message_id) result.telegramMessageId = exec.telegram_message_id;
      if (exec.ollama_analysis) {
        result.analysis = {
          riskAssessment: exec.ollama_analysis,
          confidence: 0.85, // Default confidence - could be parsed from analysis
          description: exec.ollama_analysis
        };
      }
      
      return result;
    });

    // Determine if there are more pages by checking if we got more than requested
    const hasNext = executions.length > actualLimit;
    
    // Remove the extra record if present
    if (hasNext) {
      processedExecutions.pop();
    }
    
    // Estimate total based on current page and whether there are more pages
    // This is an approximation but avoids expensive COUNT queries
    total = hasNext ? (actualOffset + actualLimit + 1) : (actualOffset + processedExecutions.length);

    logger.debug('Executions query completed', {
      filters,
      total,
      returned: processedExecutions.length,
      hasNext
    });

    return {
      executions: processedExecutions,
      total,
      hasNext
    };
  }

  async getExecutionById(executionId: string): Promise<ExecutionWithImage | null> {
    const query = `
      SELECT 
        e.id::text as id,
        e."workflowId"::text as workflow_id,
        e.status,
        e."startedAt" as started_at,
        e."stoppedAt" as stopped_at,
        e.mode,
        e.finished,
        e."retryOf"::text as retry_of,
        e."retrySuccessId"::text as retry_success_id,
        w.name as workflow_name,
        NULL as image_mime_type,
        false as has_image,
        NULL as ollama_analysis,
        0 as total_payload_size,
        false as telegram_delivered,
        NULL as telegram_message_id,
        NULL as image_url,
        NULL as thumbnail_url,
        NULL as duration_seconds
      FROM execution_entity e
      JOIN workflow_entity w ON e."workflowId"::text = w.id::text
      WHERE e.id = $1
        AND w.id = 'yDbfhooKemfhMIkC'
        AND e.status IS NOT NULL
        AND e."deletedAt" IS NULL
    `;

    const results = await db.query<any>(query, [executionId]);
    
    if (results.length === 0) {
      return null;
    }

    const exec = results[0];
    
    const result: ExecutionWithImage = {
      id: exec.id,
      workflowId: exec.workflow_id,
      status: exec.status,
      startedAt: new Date(exec.started_at),
      stoppedAt: exec.stopped_at ? new Date(exec.stopped_at) : null,
      mode: exec.mode,
      finished: exec.finished,
      retryOf: exec.retry_of,
      retrySuccessId: exec.retry_success_id,
      telegramDelivered: exec.telegram_delivered || false
    };
    
    // Always set image URLs - they will be generated dynamically
    result.imageUrl = `/dashboard/api/executions/${exec.id}/image`;
    result.thumbnailUrl = `/dashboard/api/executions/${exec.id}/image?thumbnail=true`;
    if (exec.telegram_message_id) result.telegramMessageId = exec.telegram_message_id;
    if (exec.ollama_analysis) {
      result.analysis = {
        riskAssessment: exec.ollama_analysis,
        confidence: 0.85,
        description: exec.ollama_analysis
      };
    }
    
    return result;
  }

  async getExecutionData(executionId: string, nodeId?: string): Promise<any> {
    let query = `
      SELECT "executionId"::text as execution_id, "nodeId" as node_id, data, "dataSizeInBytes" as data_size_bytes, "createdAt" as created_at
      FROM execution_data
      WHERE "executionId" = $1
    `;
    
    const queryParams = [executionId];
    
    if (nodeId) {
      query += ` AND "nodeId" = $2`;
      queryParams.push(nodeId);
    }
    
    query += ` ORDER BY "createdAt" DESC`;

    const results = await db.query(query, queryParams);
    
    if (results.length === 0) {
      return null;
    }

    // Return single result if nodeId specified, array otherwise
    return nodeId ? results[0] : results;
  }

  async getDailySummary(days: number = 30): Promise<DailySummary[]> {
    const query = `
      SELECT 
        execution_date::text as date,
        total_executions,
        successful_executions,
        failed_executions,
        success_rate_percent as success_rate,
        avg_duration_seconds as avg_execution_time
      FROM sai_daily_summary 
      WHERE execution_date >= CURRENT_DATE - INTERVAL '${Math.min(days, 90)} days'
      ORDER BY execution_date DESC
    `;

    const results = await db.query<any>(query);
    
    return results.map((row: any) => ({
      date: row.date,
      totalExecutions: row.total_executions,
      successfulExecutions: row.successful_executions,
      failedExecutions: row.failed_executions,
      successRate: parseFloat(row.success_rate.toString()),
      avgExecutionTime: row.avg_execution_time ? parseFloat(row.avg_execution_time.toString()) : null
    })) as DailySummary[];
  }

  async getRecentExecutions(limit: number = 10): Promise<ExecutionWithImage[]> {
    const result = await this.getExecutions({ 
      limit: Math.min(limit, 50),
      status: 'success' 
    });
    
    return result.executions;
  }

  async getExecutionStats(): Promise<{
    totalExecutions: number;
    successRate: number;
    avgDailyExecutions: number;
    lastExecution: Date | null;
  }> {
    const statsQuery = `
      SELECT 
        COUNT(*) as total_executions,
        COUNT(CASE WHEN e.status = 'success' THEN 1 END) as successful_executions,
        MAX(e."startedAt") as last_execution
      FROM execution_entity e
      JOIN workflow_entity w ON e."workflowId"::text = w.id::text
      WHERE w.id = 'yDbfhooKemfhMIkC'
        AND e.status IS NOT NULL
        AND e."deletedAt" IS NULL
        AND e."startedAt" >= CURRENT_DATE - INTERVAL '30 days'
    `;

    const results = await db.query(statsQuery);
    const stats = results[0];

    const totalExecutions = parseInt(stats?.total_executions || '0', 10);
    const successfulExecutions = parseInt(stats?.successful_executions || '0', 10);
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0;

    return {
      totalExecutions,
      successRate: Math.round(successRate * 100) / 100,
      avgDailyExecutions: Math.round(totalExecutions / 30 * 100) / 100,
      lastExecution: stats?.last_execution ? new Date(stats.last_execution) : null
    };
  }

  async searchExecutions(query: string, limit: number = 20): Promise<ExecutionWithImage[]> {
    if (!query.trim()) {
      return [];
    }

    const result = await this.getExecutions({
      search: query,
      limit: Math.min(limit, 50),
      status: 'success'
    });

    return result.executions;
  }
}

export const executionService = new ExecutionService();