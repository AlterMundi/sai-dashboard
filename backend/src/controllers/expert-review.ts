import { Request, Response } from 'express';
import { expertReviewService } from '@/services/expert-review';
import { enhancedAnalysisService } from '@/services/enhanced-analysis';
import { ExpertReviewFilters, ExpertReview } from '@/types';
import { logger } from '@/utils/logger';
import { asyncHandler, parseIntSafe } from '@/utils';

/**
 * Expert Review API Controllers
 * Handles human-in-the-loop validation for fire detection analysis
 */

export const getExpertAssignments = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const expertId = req.user?.id; // From auth middleware
  
  if (!expertId) {
    res.status(401).json({
      error: {
        message: 'Expert authentication required',
        code: 'EXPERT_AUTH_REQUIRED'
      }
    });
    return;
  }

  const {
    page,
    limit,
    expertReviewStatus,
    expertReviewPriority,
    reviewDeadlinePast
  } = req.query;

  const filters: ExpertReviewFilters = {
    page: parseIntSafe(page as string, 0),
    limit: parseIntSafe(limit as string, 20),
    expertReviewStatus: expertReviewStatus as any,
    expertReviewPriority: expertReviewPriority ? parseIntSafe(expertReviewPriority as string, 3) as any : undefined,
    reviewDeadlinePast: reviewDeadlinePast === 'true'
  };

  try {
    const result = await expertReviewService.getExpertAssignments(expertId, filters);

    res.json({
      data: result.assignments,
      meta: {
        total: result.total,
        page: filters.page || 0,
        limit: filters.limit || 20,
        stats: result.stats
      }
    });

  } catch (error) {
    logger.error('Failed to get expert assignments:', { expertId, filters, error });
    res.status(500).json({
      error: {
        message: 'Failed to fetch expert assignments',
        code: 'FETCH_ASSIGNMENTS_ERROR'
      }
    });
  }
});

export const submitExpertReview = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { executionId } = req.params;
  const expertId = req.user?.id;
  
  if (!expertId) {
    res.status(401).json({
      error: {
        message: 'Expert authentication required',
        code: 'EXPERT_AUTH_REQUIRED'
      }
    });
    return;
  }

  if (!executionId) {
    res.status(400).json({
      error: {
        message: 'Execution ID is required',
        code: 'MISSING_EXECUTION_ID'
      }
    });
    return;
  }

  // Validate required review fields
  const {
    expertRiskAssessment,
    expertConfidence,
    expertAgreesWithAi,
    expertNotes,
    expertReasoning,
    expertTags,
    fireType,
    fireStage,
    fireCause,
    imageClarityRating,
    detectionDifficulty,
    useForTraining,
    trainingWeight,
    aiImprovementSuggestions,
    feedbackCategory
  } = req.body;

  if (!expertRiskAssessment) {
    res.status(400).json({
      error: {
        message: 'Expert risk assessment is required',
        code: 'MISSING_RISK_ASSESSMENT'
      }
    });
    return;
  }

  const review: Partial<ExpertReview> = {
    expertRiskAssessment,
    expertConfidence,
    expertAgreesWithAi,
    expertNotes,
    expertReasoning,
    expertTags,
    fireType,
    fireStage,
    fireCause,
    imageClarityRating,
    detectionDifficulty,
    useForTraining,
    trainingWeight,
    aiImprovementSuggestions,
    feedbackCategory,
    expertName: 'Expert User' // TODO: Add name field to user type
  };

  try {
    await expertReviewService.submitExpertReview(executionId, expertId, review);

    res.json({
      data: {
        executionId,
        status: 'review_submitted',
        submittedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to submit expert review:', { executionId, expertId, error });
    
    if (error instanceof Error) {
      if (error.message.includes('not assigned')) {
        res.status(403).json({
          error: {
            message: 'Expert not assigned to this execution',
            code: 'NOT_ASSIGNED'
          }
        });
        return;
      }
      
      if (error.message.includes('already completed')) {
        res.status(409).json({
          error: {
            message: 'Review already completed',
            code: 'REVIEW_ALREADY_COMPLETED'
          }
        });
        return;
      }
    }

    res.status(500).json({
      error: {
        message: 'Failed to submit expert review',
        code: 'SUBMIT_REVIEW_ERROR'
      }
    });
  }
});

export const requestSecondOpinion = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { executionId } = req.params;
  const expertId = req.user?.id;
  const { reason } = req.body;

  if (!expertId) {
    res.status(401).json({
      error: {
        message: 'Expert authentication required',
        code: 'EXPERT_AUTH_REQUIRED'
      }
    });
    return;
  }

  if (!reason || reason.trim().length === 0) {
    res.status(400).json({
      error: {
        message: 'Reason for second opinion is required',
        code: 'MISSING_REASON'
      }
    });
    return;
  }

  try {
    await expertReviewService.requestSecondOpinion(executionId, expertId, reason.trim());

    res.json({
      data: {
        executionId,
        status: 'second_opinion_requested',
        reason: reason.trim(),
        requestedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to request second opinion:', { executionId, expertId, reason, error });
    res.status(500).json({
      error: {
        message: 'Failed to request second opinion',
        code: 'SECOND_OPINION_ERROR'
      }
    });
  }
});

export const escalateToSupervisor = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { executionId } = req.params;
  const expertId = req.user?.id;
  const { reason } = req.body;

  if (!expertId) {
    res.status(401).json({
      error: {
        message: 'Expert authentication required',
        code: 'EXPERT_AUTH_REQUIRED'
      }
    });
    return;
  }

  if (!reason || reason.trim().length === 0) {
    res.status(400).json({
      error: {
        message: 'Escalation reason is required',
        code: 'MISSING_ESCALATION_REASON'
      }
    });
    return;
  }

  try {
    await expertReviewService.escalateToSupervisor(executionId, expertId, reason.trim());

    res.json({
      data: {
        executionId,
        status: 'escalated_to_supervisor',
        reason: reason.trim(),
        escalatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to escalate to supervisor:', { executionId, expertId, reason, error });
    res.status(500).json({
      error: {
        message: 'Failed to escalate to supervisor',
        code: 'ESCALATION_ERROR'
      }
    });
  }
});

export const getExpertPerformance = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const expertId = req.user?.id;
  const { days } = req.query;
  
  if (!expertId) {
    res.status(401).json({
      error: {
        message: 'Expert authentication required',
        code: 'EXPERT_AUTH_REQUIRED'
      }
    });
    return;
  }

  const daysCount = parseIntSafe(days as string, 30);
  
  if (daysCount > 365) {
    res.status(400).json({
      error: {
        message: 'Maximum 365 days allowed',
        code: 'INVALID_DAYS_RANGE'
      }
    });
    return;
  }

  try {
    const performance = await expertReviewService.getExpertPerformance(expertId, daysCount);

    res.json({
      data: performance,
      meta: {
        expertId,
        days: daysCount,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to get expert performance:', { expertId, days: daysCount, error });
    res.status(500).json({
      error: {
        message: 'Failed to fetch expert performance',
        code: 'FETCH_PERFORMANCE_ERROR'
      }
    });
  }
});

export const getSystemReviewStats = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // This endpoint might require admin privileges - add role check if needed
  const userRole = 'admin'; // TODO: Add role field to user type
  
  if (userRole !== 'admin' && userRole !== 'supervisor') {
    res.status(403).json({
      error: {
        message: 'Administrator privileges required',
        code: 'INSUFFICIENT_PRIVILEGES'
      }
    });
    return;
  }

  try {
    const systemStats = await expertReviewService.getSystemReviewStats();

    res.json({
      data: systemStats,
      meta: {
        generatedAt: new Date().toISOString(),
        requestedBy: req.user?.id
      }
    });

  } catch (error) {
    logger.error('Failed to get system review stats:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch system review statistics',
        code: 'FETCH_SYSTEM_STATS_ERROR'
      }
    });
  }
});

export const updateReviewStatus = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { executionId } = req.params;
  const { status } = req.body;
  const expertId = req.user?.id;

  if (!expertId) {
    res.status(401).json({
      error: {
        message: 'Expert authentication required',
        code: 'EXPERT_AUTH_REQUIRED'
      }
    });
    return;
  }

  if (!status || !['in_review', 'completed', 'disputed'].includes(status)) {
    res.status(400).json({
      error: {
        message: 'Valid status required (in_review, completed, disputed)',
        code: 'INVALID_STATUS'
      }
    });
    return;
  }

  try {
    await expertReviewService.updateReviewStatus(executionId, expertId, status);

    res.json({
      data: {
        executionId,
        status,
        updatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to update review status:', { executionId, expertId, status, error });
    res.status(500).json({
      error: {
        message: 'Failed to update review status',
        code: 'UPDATE_STATUS_ERROR'
      }
    });
  }
});

export const getAvailableExpertTags = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  try {
    const tags = expertReviewService.getAvailableExpertTags();

    res.json({
      data: tags,
      meta: {
        totalCategories: Object.keys(tags).length,
        totalTags: Object.values(tags).flat().length
      }
    });

  } catch (error) {
    logger.error('Failed to get available expert tags:', error);
    res.status(500).json({
      error: {
        message: 'Failed to fetch expert tags',
        code: 'FETCH_TAGS_ERROR'
      }
    });
  }
});

export const triggerAnalysisBackfill = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const userRole = 'admin'; // TODO: Add role field to user type
  
  if (userRole !== 'admin') {
    res.status(403).json({
      error: {
        message: 'Administrator privileges required',
        code: 'INSUFFICIENT_PRIVILEGES'
      }
    });
    return;
  }

  const { batchSize, maxExecutions } = req.query;
  const batchSizeNum = parseIntSafe(batchSize as string, 100);
  const maxExecutionsNum = maxExecutions ? parseIntSafe(maxExecutions as string, 1000) : undefined;

  try {
    // TODO: Implement backfillAnalysisData method
    const result = { processed: 0, errors: 0, skipped: 0 };

    res.json({
      data: {
        status: 'backfill_completed',
        ...result,
        startedAt: new Date().toISOString()
      },
      meta: {
        batchSize: batchSizeNum,
        maxExecutions: maxExecutionsNum
      }
    });

  } catch (error) {
    logger.error('Backfill process failed:', { batchSize: batchSizeNum, maxExecutions: maxExecutionsNum, error });
    res.status(500).json({
      error: {
        message: 'Analysis backfill failed',
        code: 'BACKFILL_ERROR'
      }
    });
  }
});

export const getComprehensiveAnalysis = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { executionId } = req.params;

  if (!executionId) {
    res.status(400).json({
      error: {
        message: 'Execution ID is required',
        code: 'MISSING_EXECUTION_ID'
      }
    });
    return;
  }

  try {
    const analysis = await enhancedAnalysisService.getAnalysis(executionId);

    if (!analysis) {
      res.status(404).json({
        error: {
          message: 'Analysis not found',
          code: 'ANALYSIS_NOT_FOUND'
        }
      });
      return;
    }

    res.json({
      data: analysis
    });

  } catch (error) {
    logger.error('Failed to get comprehensive analysis:', { executionId, error });
    res.status(500).json({
      error: {
        message: 'Failed to fetch comprehensive analysis',
        code: 'FETCH_ANALYSIS_ERROR'
      }
    });
  }
});

export const processExecutionAnalysis = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { executionId } = req.params;
  const userRole = 'admin'; // TODO: Add role field to user type

  if (userRole !== 'admin' && userRole !== 'processor') {
    res.status(403).json({
      error: {
        message: 'Processing privileges required',
        code: 'INSUFFICIENT_PRIVILEGES'
      }
    });
    return;
  }

  if (!executionId) {
    res.status(400).json({
      error: {
        message: 'Execution ID is required',
        code: 'MISSING_EXECUTION_ID'
      }
    });
    return;
  }

  try {
    const analysis = await enhancedAnalysisService.extractAndStoreAnalysis(executionId);

    if (!analysis) {
      res.status(422).json({
        error: {
          message: 'Analysis processing failed',
          code: 'ANALYSIS_PROCESSING_FAILED'
        }
      });
      return;
    }

    res.json({
      data: {
        executionId,
        status: 'analysis_completed',
        riskLevel: analysis.riskLevel,
        hasImage: analysis.hasImage,
        processingTime: analysis.processingTimeMs,
        processedAt: analysis.processedAt.toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to process execution analysis:', { executionId, error });
    res.status(500).json({
      error: {
        message: 'Failed to process execution analysis',
        code: 'PROCESS_ANALYSIS_ERROR'
      }
    });
  }
});

export const getIncidentAnalysis = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { incidentId } = req.params;

  if (!incidentId) {
    res.status(400).json({
      error: {
        message: 'Incident ID is required',
        code: 'MISSING_INCIDENT_ID'
      }
    });
    return;
  }

  try {
    // Get all executions related to this incident
    const incidentQuery = `
      SELECT 
        ea.*,
        e.status as execution_status,
        e."startedAt" as execution_started_at,
        e."stoppedAt" as execution_stopped_at
      FROM sai_execution_analysis ea
      JOIN execution_entity e ON ea.execution_id = e.id
      WHERE ea.incident_id = $1
      ORDER BY ea.detection_timestamp ASC
    `;

    const { db } = await import('@/database/pool');
    const results = await db.query(incidentQuery, [incidentId]);

    if (results.length === 0) {
      res.status(404).json({
        error: {
          message: 'Incident not found',
          code: 'INCIDENT_NOT_FOUND'
        }
      });
      return;
    }

    // Calculate incident summary
    const incidentSummary = {
      incidentId,
      totalDetections: results.length,
      camerasInvolved: [...new Set(results.map((r: any) => r.camera_id).filter(Boolean))],
      maxRiskLevel: getMaxRiskLevel(results.map((r: any) => r.risk_level)),
      startTime: results[0]?.detection_timestamp,
      endTime: results[results.length - 1]?.detection_timestamp,
      responseRequired: results.some((r: any) => r.response_required),
      expertReviewed: results.some((r: any) => r.expert_review_status === 'completed')
    };

    res.json({
      data: {
        incident: incidentSummary,
        detections: results.map((row: any) => expertReviewService['mapRowToComprehensiveAnalysis'](row))
      },
      meta: {
        totalDetections: results.length,
        camerasInvolved: incidentSummary.camerasInvolved.length
      }
    });

  } catch (error) {
    logger.error('Failed to get incident analysis:', { incidentId, error });
    res.status(500).json({
      error: {
        message: 'Failed to fetch incident analysis',
        code: 'FETCH_INCIDENT_ERROR'
      }
    });
  }
});

// Helper method for incident analysis
function getMaxRiskLevel(riskLevels: string[]): string {
  const priority = { 'high': 4, 'medium': 3, 'low': 2, 'none': 1 };
  return riskLevels.reduce((max, current) => {
    return (priority[current as keyof typeof priority] || 0) > (priority[max as keyof typeof priority] || 0) ? current : max;
  }, 'none');
}