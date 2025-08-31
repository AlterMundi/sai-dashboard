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
      hasImage,
      riskLevel,
      telegramDelivered,
      datePreset,
      sortBy,
      sortOrder
    } = filters;

    // Determine if we need enriched data (advanced filters)
    const needsEnrichment = !!(
      search || 
      hasImage !== undefined || 
      riskLevel || 
      telegramDelivered !== undefined ||
      sortBy === 'risk'
    );

    const actualLimit = Math.min(limit, appConfig.sai.maxPageSize);
    const actualOffset = offset ?? (page * actualLimit);

    // Handle date presets
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;
    
    if (datePreset) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      switch (datePreset) {
        case 'today':
          effectiveStartDate = today.toISOString();
          break;
        case 'yesterday':
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          effectiveStartDate = yesterday.toISOString();
          effectiveEndDate = today.toISOString();
          break;
        case 'last7days':
          const last7days = new Date(today);
          last7days.setDate(last7days.getDate() - 7);
          effectiveStartDate = last7days.toISOString();
          break;
        case 'last30days':
          const last30days = new Date(today);
          last30days.setDate(last30days.getDate() - 30);
          effectiveStartDate = last30days.toISOString();
          break;
        case 'thisMonth':
          const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          effectiveStartDate = thisMonth.toISOString();
          break;
        case 'lastMonth':
          const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
          effectiveStartDate = lastMonth.toISOString();
          effectiveEndDate = lastMonthEnd.toISOString();
          break;
      }
    }

    let whereConditions = ['1=1'];
    const queryParams: any[] = [];
    let paramCount = 0;

    // Status filter
    if (status) {
      paramCount++;
      whereConditions.push(`status = $${paramCount}`);
      queryParams.push(status);
    }

    // Date range filters (using effective dates from presets)
    if (effectiveStartDate) {
      paramCount++;
      whereConditions.push(`e.\"startedAt\" >= $${paramCount}`);
      queryParams.push(new Date(effectiveStartDate));
    }

    if (effectiveEndDate) {
      paramCount++;
      whereConditions.push(`e.\"startedAt\" <= $${paramCount}`);
      queryParams.push(new Date(effectiveEndDate));
    }


    // Risk level filter (only applies to enriched queries)
    if (riskLevel && needsEnrichment) {
      if (riskLevel === 'none') {
        whereConditions.push(`(ea.risk_level = 'none' OR ea.risk_level IS NULL)`);
      } else {
        paramCount++;
        whereConditions.push(`ea.risk_level = $${paramCount}`);
        queryParams.push(riskLevel);
      }
    }

    // Telegram delivery filter (only applies to enriched queries)
    if (telegramDelivered !== undefined && needsEnrichment) {
      paramCount++;
      whereConditions.push(`COALESCE(ea.telegram_delivered, false) = $${paramCount}`);
      queryParams.push(telegramDelivered);
      console.log('TELEGRAM FILTER DEBUG:', { telegramDelivered, paramCount, needsEnrichment });
    }

    // Has image filter (only applies to enriched queries)
    if (hasImage !== undefined && needsEnrichment) {
      paramCount++;
      whereConditions.push(`COALESCE(ea.has_image, false) = $${paramCount}`);
      queryParams.push(hasImage);
    }

    // Search filter (only applies to enriched queries)
    if (search && search.trim() && needsEnrichment) {
      paramCount++;
      whereConditions.push(`ea.ollama_analysis ILIKE $${paramCount}`);
      queryParams.push(`%${search.trim()}%`);
    }

    // Limit lookback to prevent excessive queries
    const maxLookbackDate = new Date();
    maxLookbackDate.setDate(maxLookbackDate.getDate() - appConfig.sai.maxDaysLookback);
    paramCount++;
    whereConditions.push(`e.\"startedAt\" >= $${paramCount}`);
    queryParams.push(maxLookbackDate);

    const whereClause = whereConditions.join(' AND ');

    // Build ORDER BY clause
    let orderByClause = 'e."startedAt" DESC'; // default
    if (sortBy) {
      const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
      switch (sortBy) {
        case 'date':
          orderByClause = `e."startedAt" ${direction}`;
          break;
        case 'status':
          orderByClause = `e.status ${direction}, e."startedAt" DESC`;
          break;
        case 'risk':
          if (needsEnrichment) {
            // Use the extracted risk_level from CTE
            orderByClause = `
              CASE 
                WHEN ea.risk_level = 'high' THEN 1
                WHEN ea.risk_level = 'medium' THEN 2  
                WHEN ea.risk_level = 'low' THEN 3
                ELSE 4
              END ${direction}, e."startedAt" DESC
            `;
          } else {
            // Fallback to date sorting if not enriched
            orderByClause = `e."startedAt" ${direction}`;
          }
          break;
        default:
          orderByClause = `e."startedAt" ${direction}`;
      }
    }

    // Skip expensive COUNT(*) for performance - use estimate instead
    // For initial loads, we'll determine hasNext by fetching limit+1 records
    let total = 0;

    // Get executions
    paramCount++;
    const limitParam = paramCount;
    paramCount++;
    const offsetParam = paramCount;

    let executionsQuery: string;
    
    if (needsEnrichment) {
      // Enriched query with selective execution_data access
      executionsQuery = `
        WITH execution_analysis AS (
          SELECT 
            ed."executionId"::integer as execution_id,
            -- Fast analysis extraction using CASE when for minimal processing
            CASE 
              WHEN ed.data ILIKE '%data:image%' THEN true
              ELSE false
            END as has_image,
            -- Extract risk level from ollama analysis with more precise patterns
            CASE 
              WHEN ed.data ~ '(fire|risk|danger).*(high|severe|critical|extreme)' OR 
                   ed.data ~ '(high).*(risk|fire|danger)' THEN 'high'
              WHEN ed.data ~ '(fire|risk|danger).*(medium|moderate|elevated)' OR
                   ed.data ~ '(medium|moderate).*(risk|fire|danger)' THEN 'medium'  
              WHEN ed.data ~ '(fire|risk|danger).*(low|minimal|slight)' OR
                   ed.data ~ '(low|minimal).*(risk|fire|danger)' THEN 'low'
              WHEN ed.data ~ '(no|zero|none).*(fire|risk|danger)' OR
                   ed.data ILIKE '%no fire%' OR ed.data ILIKE '%no risk%' THEN 'none'
              ELSE 'none'
            END as risk_level,
            -- Extract ollama analysis text with improved patterns
            CASE 
              WHEN ed.data ~ '"(content|message|text|response)":\s*"[^"]*[Ff]ire[^"]*"' THEN 
                LEFT(REGEXP_REPLACE(ed.data, '.*"(?:content|message|text|response)":\s*"([^"]*[Ff]ire[^"]*)".*', '\\1'), 500)
              WHEN ed.data ~ '"(content|message|text|response)":\s*"[^"]*[Rr]isk[^"]*"' THEN
                LEFT(REGEXP_REPLACE(ed.data, '.*"(?:content|message|text|response)":\s*"([^"]*[Rr]isk[^"]*)".*', '\\1'), 500)
              WHEN ed.data ~ 'ollama.*"(?:content|message|text)":\s*"[^"]*"' THEN
                LEFT(REGEXP_REPLACE(ed.data, '.*ollama.*"(?:content|message|text)":\s*"([^"]*)".*', '\\1'), 500)
              ELSE NULL
            END as ollama_analysis,
            -- Check for specific telegram delivery success indicators
            CASE 
              WHEN ed.data ~ '"ok":\s*true' AND ed.data ILIKE '%sendphoto%' THEN true
              WHEN ed.data ~ 'message_id.*[0-9]+' AND ed.data ILIKE '%telegram%' THEN true
              WHEN ed.data ILIKE '%telegram%' AND ed.data ~ '"status":\s*"success"' THEN true
              ELSE false  
            END as telegram_delivered
          FROM execution_data ed
          WHERE ed.data IS NOT NULL
            AND LENGTH(ed.data) < 5242880  -- 5MB limit for safety
        )
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
          'image/jpeg' as image_mime_type,
          COALESCE(ea.has_image, false) as has_image,
          ea.ollama_analysis,
          0 as total_payload_size,
          COALESCE(ea.telegram_delivered, false) as telegram_delivered,
          NULL as telegram_message_id,
          NULL as image_url,
          NULL as thumbnail_url,
          CASE 
            WHEN e."stoppedAt" IS NOT NULL THEN 
              EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))
            ELSE NULL
          END as duration_seconds
        FROM execution_entity e
        JOIN workflow_entity w ON e."workflowId"::text = w.id::text
        LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
        WHERE w.id = 'yDbfhooKemfhMIkC'
          AND e.status IS NOT NULL
          AND e."deletedAt" IS NULL
          AND ${whereClause}
        ORDER BY ${orderByClause}
        LIMIT $${limitParam} OFFSET $${offsetParam}
      `;
    } else {
      // Fast path for basic queries - no execution_data access
      executionsQuery = `
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
          'image/jpeg' as image_mime_type,
          true as has_image,  -- Assume true for SAI workflow
          NULL as ollama_analysis,
          0 as total_payload_size,
          false as telegram_delivered,
          NULL as telegram_message_id,
          NULL as image_url,
          NULL as thumbnail_url,
          CASE 
            WHEN e."stoppedAt" IS NOT NULL THEN 
              EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))
            ELSE NULL
          END as duration_seconds
        FROM execution_entity e
        JOIN workflow_entity w ON e."workflowId"::text = w.id::text
        WHERE w.id = 'yDbfhooKemfhMIkC'
          AND e.status IS NOT NULL
          AND e."deletedAt" IS NULL
          AND ${whereClause}
        ORDER BY ${orderByClause}
        LIMIT $${limitParam} OFFSET $${offsetParam}
      `;
    }

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
    // Fixed query based on actual n8n database structure
    let query = `
      SELECT 
        "executionId"::text as execution_id, 
        data, 
        "workflowData",
        LENGTH(data::text) as data_size_bytes
      FROM execution_data
      WHERE "executionId" = $1::integer
    `;
    
    const queryParams = [parseInt(executionId)];
    
    // Note: nodeId parameter is ignored since execution_data doesn't have nodeId column
    // The nodeId was likely from a different version or different table structure
    
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

  async getEnhancedStatistics(): Promise<any> {
    try {
      // Get comprehensive overview statistics
      const overviewQuery = `
        SELECT 
          COUNT(*) as total_executions,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as successful,
          COUNT(CASE WHEN status = 'error' THEN 1 END) as errors,
          COUNT(CASE WHEN DATE(e."startedAt") = CURRENT_DATE THEN 1 END) as active_today,
          AVG(CASE WHEN e."stoppedAt" IS NOT NULL 
            THEN EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt")) 
            ELSE NULL END) as avg_execution_time
        FROM execution_entity e
        JOIN workflow_entity w ON e."workflowId"::text = w.id::text
        WHERE w.id = 'yDbfhooKemfhMIkC'
          AND e.status IS NOT NULL
          AND e."deletedAt" IS NULL
      `;

      const overviewResult = await db.query(overviewQuery);
      const overview = overviewResult[0];

      // Get hourly distribution for the last 24 hours
      const hourlyQuery = `
        SELECT 
          EXTRACT(HOUR FROM e."startedAt") as hour,
          COUNT(*) as count
        FROM execution_entity e
        JOIN workflow_entity w ON e."workflowId"::text = w.id::text
        WHERE w.id = 'yDbfhooKemfhMIkC'
          AND e.status IS NOT NULL
          AND e."deletedAt" IS NULL
          AND e."startedAt" > NOW() - INTERVAL '24 hours'
        GROUP BY EXTRACT(HOUR FROM e."startedAt")
        ORDER BY hour
      `;

      const hourlyResult = await db.query(hourlyQuery);
      
      // Get status breakdown
      const statusQuery = `
        SELECT 
          status,
          COUNT(*) as count
        FROM execution_entity e
        JOIN workflow_entity w ON e."workflowId"::text = w.id::text
        WHERE w.id = 'yDbfhooKemfhMIkC'
          AND e.status IS NOT NULL
          AND e."deletedAt" IS NULL
        GROUP BY status
      `;

      const statusResult = await db.query(statusQuery);
      const statusBreakdown: Record<string, number> = {
        success: 0,
        error: 0,
        running: 0,
        waiting: 0,
        canceled: 0
      };
      
      statusResult.forEach((row: any) => {
        if (row.status in statusBreakdown) {
          statusBreakdown[row.status] = parseInt(row.count);
        }
      });

      // Get recent activity
      const activityQuery = `
        SELECT 
          COUNT(CASE WHEN e."startedAt" > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour,
          COUNT(CASE WHEN e."startedAt" > NOW() - INTERVAL '24 hours' THEN 1 END) as last_24_hours,
          COUNT(CASE WHEN e."startedAt" > NOW() - INTERVAL '7 days' THEN 1 END) as last_7_days,
          COUNT(CASE WHEN e."startedAt" > NOW() - INTERVAL '30 days' THEN 1 END) as last_30_days
        FROM execution_entity e
        JOIN workflow_entity w ON e."workflowId"::text = w.id::text
        WHERE w.id = 'yDbfhooKemfhMIkC'
          AND e.status IS NOT NULL
          AND e."deletedAt" IS NULL
      `;

      const activityResult = await db.query(activityQuery);
      const recentActivity = activityResult[0];

      // Get performance metrics for successful executions
      const performanceQuery = `
        SELECT 
          AVG(EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))) as avg_response_time,
          MIN(EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))) as min_response_time,
          MAX(EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))) as max_response_time,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))) as median_response_time,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))) as p95_response_time,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (e."stoppedAt" - e."startedAt"))) as p99_response_time
        FROM execution_entity e
        JOIN workflow_entity w ON e."workflowId"::text = w.id::text
        WHERE w.id = 'yDbfhooKemfhMIkC'
          AND e.status = 'success'
          AND e."stoppedAt" IS NOT NULL
          AND e."deletedAt" IS NULL
          AND e."startedAt" > NOW() - INTERVAL '7 days'
      `;

      const performanceResult = await db.query(performanceQuery);
      const performance = performanceResult[0];

      // Get error trends for the last 7 days
      const errorTrendQuery = `
        SELECT 
          DATE(e."startedAt") as date,
          COUNT(CASE WHEN status = 'error' THEN 1 END) as errors,
          COUNT(*) as total
        FROM execution_entity e
        JOIN workflow_entity w ON e."workflowId"::text = w.id::text
        WHERE w.id = 'yDbfhooKemfhMIkC'
          AND e.status IS NOT NULL
          AND e."deletedAt" IS NULL
          AND e."startedAt" > NOW() - INTERVAL '7 days'
        GROUP BY DATE(e."startedAt")
        ORDER BY date DESC
      `;

      const errorTrendResult = await db.query(errorTrendQuery);

      return {
        overview: {
          totalExecutions: parseInt(overview.total_executions),
          successRate: overview.total_executions > 0 
            ? (parseInt(overview.successful) / parseInt(overview.total_executions)) * 100 
            : 0,
          errorRate: overview.total_executions > 0 
            ? (parseInt(overview.errors) / parseInt(overview.total_executions)) * 100 
            : 0,
          averageExecutionTime: parseFloat(overview.avg_execution_time) || 0,
          activeToday: parseInt(overview.active_today)
        },
        statusBreakdown,
        recentActivity: {
          lastHour: parseInt(recentActivity.last_hour),
          last24Hours: parseInt(recentActivity.last_24_hours),
          last7Days: parseInt(recentActivity.last_7_days),
          last30Days: parseInt(recentActivity.last_30_days)
        },
        performanceMetrics: {
          avgResponseTime: parseFloat(performance.avg_response_time) || 0,
          minResponseTime: parseFloat(performance.min_response_time) || 0,
          maxResponseTime: parseFloat(performance.max_response_time) || 0,
          medianResponseTime: parseFloat(performance.median_response_time) || 0,
          p95ResponseTime: parseFloat(performance.p95_response_time) || 0,
          p99ResponseTime: parseFloat(performance.p99_response_time) || 0
        },
        hourlyDistribution: hourlyResult.map((row: any) => ({
          hour: parseInt(row.hour),
          count: parseInt(row.count)
        })),
        errorTrend: errorTrendResult.map((row: any) => ({
          date: row.date,
          errors: parseInt(row.errors),
          total: parseInt(row.total),
          errorRate: row.total > 0 ? (row.errors / row.total) * 100 : 0
        }))
      };
    } catch (error) {
      logger.error('Failed to get enhanced statistics:', error);
      throw error;
    }
  }
}

export const executionService = new ExecutionService();