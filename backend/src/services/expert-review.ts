import { db } from '@/database/pool';
import { ExpertUser, ExpertReview, ComprehensiveAnalysis, ExpertReviewFilters } from '@/types';
import { logger } from '@/utils/logger';
import { enhancedAnalysisService } from './enhanced-analysis';

/**
 * Expert Review and Assignment Service
 * Manages human-in-the-loop validation for fire detection analysis
 */
export class ExpertReviewService {

  /**
   * Get expert's pending review assignments
   */
  async getExpertAssignments(expertId: string, filters: ExpertReviewFilters = {}): Promise<{
    assignments: ComprehensiveAnalysis[];
    total: number;
    stats: {
      pending: number;
      inReview: number;
      overdue: number;
      completed: number;
    };
  }> {
    try {
      const {
        page = 0,
        limit = 20,
        expertReviewStatus,
        expertReviewPriority,
        reviewDeadlinePast
      } = filters;

      let whereConditions = ['assigned_expert_id = $1'];
      const queryParams: any[] = [expertId];
      let paramCount = 1;

      // Apply filters
      if (expertReviewStatus) {
        paramCount++;
        whereConditions.push(`expert_review_status = $${paramCount}`);
        queryParams.push(expertReviewStatus);
      }

      if (expertReviewPriority) {
        paramCount++;
        whereConditions.push(`expert_review_priority = $${paramCount}`);
        queryParams.push(expertReviewPriority);
      }

      if (reviewDeadlinePast) {
        whereConditions.push(`expert_review_deadline < NOW()`);
      }

      const whereClause = whereConditions.join(' AND ');

      // Get assignments with execution context
      const assignmentsQuery = `
        SELECT 
          ea.*,
          e.status as execution_status,
          e."startedAt" as execution_started_at,
          e."stoppedAt" as execution_stopped_at,
          CASE 
            WHEN ea.expert_review_deadline < NOW() THEN 'OVERDUE'
            WHEN ea.expert_review_deadline < NOW() + INTERVAL '2 hours' THEN 'URGENT'
            ELSE 'ON_TIME'
          END as deadline_status
        FROM sai_execution_analysis ea
        JOIN execution_entity e ON ea.execution_id = e.id
        WHERE ${whereClause}
        ORDER BY ea.expert_review_priority ASC, ea.expert_review_deadline ASC
        LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
      `;

      queryParams.push(limit, page * limit);
      const assignments = await db.query(assignmentsQuery, queryParams);

      // Get stats for this expert
      const statsQuery = `
        SELECT 
          expert_review_status,
          COUNT(*) as count
        FROM sai_execution_analysis
        WHERE assigned_expert_id = $1
        GROUP BY expert_review_status
      `;

      const statsResults = await db.query(statsQuery, [expertId]);
      const stats = {
        pending: 0,
        inReview: 0,
        overdue: 0,
        completed: 0
      };

      statsResults.forEach((row: any) => {
        if (row.expert_review_status in stats) {
          stats[row.expert_review_status as keyof typeof stats] = parseInt(row.count);
        }
      });

      // Get overdue count
      const overdueQuery = `
        SELECT COUNT(*) as overdue_count
        FROM sai_execution_analysis
        WHERE assigned_expert_id = $1 
          AND expert_review_deadline < NOW()
          AND expert_review_status IN ('pending', 'in_review')
      `;
      const overdueResult = await db.query(overdueQuery, [expertId]);
      stats.overdue = parseInt(overdueResult[0]?.overdue_count || '0');

      // Convert assignments to comprehensive analysis objects
      const comprehensiveAssignments = assignments.map(this.mapRowToComprehensiveAnalysis);

      return {
        assignments: comprehensiveAssignments,
        total: assignments.length,
        stats
      };

    } catch (error) {
      logger.error('Failed to get expert assignments', { expertId, filters, error });
      throw error;
    }
  }

  /**
   * Submit expert review for an execution
   */
  async submitExpertReview(
    executionId: string, 
    expertId: string, 
    review: Partial<ExpertReview>
  ): Promise<void> {
    try {
      const startTime = Date.now();
      
      // Validate expert is assigned to this execution
      const assignmentCheck = await db.query(`
        SELECT assigned_expert_id, expert_review_status 
        FROM sai_execution_analysis 
        WHERE execution_id = $1
      `, [executionId]);

      if (assignmentCheck.length === 0) {
        throw new Error('Execution not found in analysis table');
      }

      const assignment = assignmentCheck[0];
      if (assignment.assigned_expert_id !== expertId) {
        throw new Error('Expert not assigned to this execution');
      }

      if (assignment.expert_review_status === 'completed') {
        throw new Error('Review already completed');
      }

      // Calculate review duration
      const reviewDuration = Math.round((Date.now() - startTime) / 60000); // minutes

      // Update analysis with expert review
      const updateQuery = `
        UPDATE sai_execution_analysis SET
          expert_review_status = 'completed',
          expert_risk_assessment = $2,
          expert_confidence = $3,
          expert_agrees_with_ai = $4,
          expert_notes = $5,
          expert_reasoning = $6,
          expert_tags = $7::jsonb,
          fire_type = $8,
          fire_stage = $9,
          fire_cause = $10,
          reviewed_at = NOW(),
          review_duration_minutes = $11,
          expert_name = $12,
          image_clarity_rating = $13,
          detection_difficulty = $14,
          use_for_training = $15,
          training_weight = $16,
          ai_improvement_suggestions = $17,
          feedback_category = $18,
          false_positive_flag = $19,
          verified_by_human = true,
          human_verifier = $12
        WHERE execution_id = $1
      `;

      const params = [
        executionId,
        review.expertRiskAssessment,
        review.expertConfidence,
        review.expertAgreesWithAi,
        review.expertNotes,
        review.expertReasoning,
        JSON.stringify(review.expertTags || []),
        review.fireType,
        review.fireStage,
        review.fireCause,
        reviewDuration,
        review.expertName,
        review.imageClarityRating,
        review.detectionDifficulty,
        review.useForTraining !== false,
        review.trainingWeight || 1.0,
        review.aiImprovementSuggestions,
        review.feedbackCategory,
        review.expertRiskAssessment === 'none' // Mark as false positive if expert says no risk
      ];

      await db.query(updateQuery, params);

      // Check if second opinion is needed
      await this.evaluateSecondOpinionNeed(executionId, review);

      logger.info('Expert review submitted successfully', {
        executionId,
        expertId,
        expertRiskAssessment: review.expertRiskAssessment,
        agreesWithAi: review.expertAgreesWithAi,
        reviewDuration
      });

    } catch (error) {
      logger.error('Failed to submit expert review', { executionId, expertId, error });
      throw error;
    }
  }

  /**
   * Auto-assign expert based on specialization, workload, and priority
   */
  async autoAssignExpert(executionId: string, analysis: ComprehensiveAnalysis): Promise<string | null> {
    try {
      // Determine required specialization
      const requiredSpecialization = this.determineRequiredSpecialization(analysis);
      
      // Calculate review deadline based on priority
      const deadline = this.calculateReviewDeadline(analysis.expertReviewPriority);

      // Find best available expert
      const expertQuery = `
        WITH expert_workload AS (
          SELECT 
            assigned_expert_id,
            COUNT(*) as current_caseload
          FROM sai_execution_analysis
          WHERE expert_review_status IN ('pending', 'in_review')
          GROUP BY assigned_expert_id
        )
        SELECT 
          eu.id,
          eu.name,
          eu.specialization,
          eu.experience_years,
          eu.accuracy_score,
          eu.max_caseload,
          COALESCE(ew.current_caseload, 0) as current_caseload
        FROM expert_users eu
        LEFT JOIN expert_workload ew ON eu.id = ew.assigned_expert_id
        WHERE eu.is_active = true
          AND (eu.specialization = $1 OR eu.specialization = 'general')
          AND COALESCE(ew.current_caseload, 0) < eu.max_caseload
          AND ($2 <= 2 OR eu.experience_years >= 3) -- High priority needs experienced experts
        ORDER BY 
          CASE WHEN eu.specialization = $1 THEN 0 ELSE 1 END, -- Prefer exact specialization
          (COALESCE(ew.current_caseload, 0)::float / eu.max_caseload), -- Prefer less loaded experts
          eu.accuracy_score DESC,
          eu.experience_years DESC
        LIMIT 1
      `;

      const expertResults = await db.query(expertQuery, [
        requiredSpecialization, 
        analysis.expertReviewPriority
      ]);

      if (expertResults.length === 0) {
        logger.warn('No available expert found for assignment', { 
          executionId, 
          requiredSpecialization, 
          priority: analysis.expertReviewPriority 
        });
        return null;
      }

      const assignedExpert = expertResults[0];

      // Update analysis with expert assignment
      await db.query(`
        UPDATE sai_execution_analysis SET
          assigned_expert_id = $1,
          expert_review_deadline = $2,
          expert_specialization = $3
        WHERE execution_id = $4
      `, [assignedExpert.id, deadline, requiredSpecialization, executionId]);

      logger.info('Expert auto-assigned successfully', {
        executionId,
        expertId: assignedExpert.id,
        expertName: assignedExpert.name,
        specialization: requiredSpecialization,
        deadline: deadline.toISOString()
      });

      return assignedExpert.id;

    } catch (error) {
      logger.error('Auto-assignment failed', { executionId, error });
      return null;
    }
  }

  /**
   * Request second opinion for complex cases
   */
  async requestSecondOpinion(executionId: string, requestingExpertId: string, reason: string): Promise<void> {
    try {
      // Mark as needing second opinion
      await db.query(`
        UPDATE sai_execution_analysis SET
          needs_second_opinion = true,
          expert_review_status = 'disputed',
          ai_improvement_suggestions = COALESCE(ai_improvement_suggestions, '') || $2
        WHERE execution_id = $1 AND assigned_expert_id = $3
      `, [executionId, `Second opinion requested: ${reason}`, requestingExpertId]);

      // Find second reviewer (different specialization or senior expert)
      const secondReviewer = await this.findSecondReviewer(requestingExpertId, executionId);
      
      if (secondReviewer) {
        await db.query(`
          UPDATE sai_execution_analysis SET
            second_reviewer_id = $1
          WHERE execution_id = $2
        `, [secondReviewer.id, executionId]);
      }

      logger.info('Second opinion requested', {
        executionId,
        requestingExpert: requestingExpertId,
        secondReviewer: secondReviewer?.id,
        reason
      });

    } catch (error) {
      logger.error('Failed to request second opinion', { executionId, requestingExpertId, error });
      throw error;
    }
  }

  /**
   * Escalate case to supervisor
   */
  async escalateToSupervisor(executionId: string, expertId: string, reason: string): Promise<void> {
    try {
      await db.query(`
        UPDATE sai_execution_analysis SET
          escalated_to_supervisor = true,
          expert_review_status = 'disputed',
          expert_review_priority = 1, -- Urgent priority
          ai_improvement_suggestions = COALESCE(ai_improvement_suggestions, '') || $2
        WHERE execution_id = $1 AND assigned_expert_id = $3
      `, [executionId, `Escalated to supervisor: ${reason}`, expertId]);

      logger.info('Case escalated to supervisor', {
        executionId,
        expertId,
        reason
      });

    } catch (error) {
      logger.error('Failed to escalate to supervisor', { executionId, expertId, error });
      throw error;
    }
  }

  /**
   * Get expert performance metrics
   */
  async getExpertPerformance(expertId: string, days: number = 30): Promise<{
    reviewsCompleted: number;
    averageReviewTime: number;
    accuracyScore: number;
    agreementWithAi: number;
    secondOpinionsRequested: number;
    escalations: number;
    specializations: string[];
  }> {
    try {
      const performanceQuery = `
        SELECT 
          COUNT(*) as reviews_completed,
          AVG(review_duration_minutes) as avg_review_time,
          AVG(expert_accuracy_score) as accuracy_score,
          COUNT(CASE WHEN expert_agrees_with_ai = true THEN 1 END)::float / COUNT(*) as agreement_rate,
          COUNT(CASE WHEN needs_second_opinion = true THEN 1 END) as second_opinions,
          COUNT(CASE WHEN escalated_to_supervisor = true THEN 1 END) as escalations,
          ARRAY_AGG(DISTINCT expert_specialization) as specializations
        FROM sai_execution_analysis
        WHERE assigned_expert_id = $1
          AND expert_review_status = 'completed'
          AND reviewed_at > NOW() - INTERVAL '${days} days'
      `;

      const results = await db.query(performanceQuery, [expertId]);
      const performance = results[0];

      return {
        reviewsCompleted: parseInt(performance?.reviews_completed || '0'),
        averageReviewTime: parseFloat(performance?.avg_review_time || '0'),
        accuracyScore: parseFloat(performance?.accuracy_score || '0'),
        agreementWithAi: parseFloat(performance?.agreement_rate || '0'),
        secondOpinionsRequested: parseInt(performance?.second_opinions || '0'),
        escalations: parseInt(performance?.escalations || '0'),
        specializations: performance?.specializations || []
      };

    } catch (error) {
      logger.error('Failed to get expert performance', { expertId, error });
      throw error;
    }
  }

  /**
   * Get system-wide expert review statistics
   */
  async getSystemReviewStats(): Promise<{
    totalPendingReviews: number;
    averageReviewTime: number;
    expertAgreementRate: number;
    qualityScores: {
      aiAccuracy: number;
      expertConsistency: number;
      trainingDataQuality: number;
    };
  }> {
    try {
      const statsQuery = `
        SELECT 
          COUNT(CASE WHEN expert_review_status = 'pending' THEN 1 END) as pending_reviews,
          AVG(review_duration_minutes) as avg_review_time,
          COUNT(CASE WHEN expert_agrees_with_ai = true THEN 1 END)::float / 
            NULLIF(COUNT(CASE WHEN expert_agrees_with_ai IS NOT NULL THEN 1 END), 0) as agreement_rate,
          AVG(expert_accuracy_score) as expert_consistency,
          AVG(training_weight) as training_quality
        FROM sai_execution_analysis
        WHERE expert_review_status IN ('completed', 'disputed')
          AND reviewed_at > NOW() - INTERVAL '30 days'
      `;

      const results = await db.query(statsQuery);
      const stats = results[0];

      return {
        totalPendingReviews: parseInt(stats?.pending_reviews || '0'),
        averageReviewTime: parseFloat(stats?.avg_review_time || '0'),
        expertAgreementRate: parseFloat(stats?.agreement_rate || '0'),
        qualityScores: {
          aiAccuracy: parseFloat(stats?.agreement_rate || '0'),
          expertConsistency: parseFloat(stats?.expert_consistency || '0'),
          trainingDataQuality: parseFloat(stats?.training_quality || '0')
        }
      };

    } catch (error) {
      logger.error('Failed to get system review stats', error);
      throw error;
    }
  }

  /**
   * Update expert review status (for workflow management)
   */
  async updateReviewStatus(
    executionId: string, 
    expertId: string, 
    status: 'in_review' | 'completed' | 'disputed'
  ): Promise<void> {
    try {
      await db.query(`
        UPDATE sai_execution_analysis SET
          expert_review_status = $1
        WHERE execution_id = $2 AND assigned_expert_id = $3
      `, [status, executionId, expertId]);

      logger.debug('Expert review status updated', { executionId, expertId, status });

    } catch (error) {
      logger.error('Failed to update review status', { executionId, expertId, status, error });
      throw error;
    }
  }

  // Private helper methods

  private determineRequiredSpecialization(analysis: ComprehensiveAnalysis): string {
    if (analysis.cameraLocation?.toLowerCase().includes('forest')) return 'wildfire';
    if (analysis.cameraLocation?.toLowerCase().includes('industrial')) return 'industrial';
    if (analysis.cameraLocation?.toLowerCase().includes('residential')) return 'residential';
    if (analysis.cameraLocation?.toLowerCase().includes('urban')) return 'urban';
    if (analysis.fireType) return analysis.fireType;
    return 'general';
  }

  private calculateReviewDeadline(priority: number): Date {
    const deadline = new Date();
    
    switch (priority) {
      case 1: // Urgent - 1 hour
        deadline.setHours(deadline.getHours() + 1);
        break;
      case 2: // High - 4 hours
        deadline.setHours(deadline.getHours() + 4);
        break;
      case 3: // Normal - 24 hours
        deadline.setDate(deadline.getDate() + 1);
        break;
      case 4: // Low - 72 hours
        deadline.setDate(deadline.getDate() + 3);
        break;
      case 5: // Training - 7 days
        deadline.setDate(deadline.getDate() + 7);
        break;
      default:
        deadline.setDate(deadline.getDate() + 1);
    }
    
    return deadline;
  }

  private async evaluateSecondOpinionNeed(executionId: string, review: Partial<ExpertReview>): Promise<void> {
    try {
      // Get original AI assessment for comparison
      const analysis = await enhancedAnalysisService.getAnalysis(executionId);
      if (!analysis) return;

      let needsSecondOpinion = false;

      // Criteria for second opinion
      if (review.expertRiskAssessment !== analysis.riskLevel) {
        needsSecondOpinion = true; // Disagreement with AI
      }
      
      if (review.expertConfidence && review.expertConfidence < 0.7) {
        needsSecondOpinion = true; // Low expert confidence
      }
      
      if (review.detectionDifficulty && review.detectionDifficulty >= 4) {
        needsSecondOpinion = true; // High difficulty case
      }

      if (analysis.riskLevel === 'high' && review.expertRiskAssessment !== 'high') {
        needsSecondOpinion = true; // Expert disagrees with high-risk AI assessment
      }

      if (needsSecondOpinion) {
        await db.query(`
          UPDATE sai_execution_analysis SET
            needs_second_opinion = true,
            expert_review_status = 'disputed'
          WHERE execution_id = $1
        `, [executionId]);

        logger.info('Second opinion flagged automatically', {
          executionId,
          reason: 'Automatic evaluation criteria met'
        });
      }

    } catch (error) {
      logger.error('Failed to evaluate second opinion need', { executionId, error });
    }
  }

  private async findSecondReviewer(originalExpertId: string, executionId: string): Promise<ExpertUser | null> {
    try {
      // Find available expert with different specialization or higher experience
      const secondReviewerQuery = `
        WITH expert_workload AS (
          SELECT 
            assigned_expert_id,
            COUNT(*) as current_caseload
          FROM sai_execution_analysis
          WHERE expert_review_status IN ('pending', 'in_review')
          GROUP BY assigned_expert_id
        )
        SELECT 
          eu.id,
          eu.name,
          eu.specialization,
          eu.experience_years,
          eu.max_caseload
        FROM expert_users eu
        LEFT JOIN expert_workload ew ON eu.id = ew.assigned_expert_id
        WHERE eu.is_active = true
          AND eu.id != $1  -- Different from original expert
          AND COALESCE(ew.current_caseload, 0) < eu.max_caseload
          AND eu.experience_years >= 5  -- Senior experts for second opinions
        ORDER BY eu.accuracy_score DESC, eu.experience_years DESC
        LIMIT 1
      `;

      const results = await db.query(secondReviewerQuery, [originalExpertId]);
      return results[0] || null;

    } catch (error) {
      logger.error('Failed to find second reviewer', { originalExpertId, executionId, error });
      return null;
    }
  }

  /**
   * Map database row to ComprehensiveAnalysis interface
   */
  private mapRowToComprehensiveAnalysis(row: any): ComprehensiveAnalysis {
    return {
      // Enhanced Analysis fields
      executionId: row.execution_id.toString(),
      nodeId: row.node_id,
      nodeName: row.node_name,
      nodeType: row.node_type,
      cameraId: row.camera_id,
      cameraLocation: row.camera_location,
      riskLevel: row.risk_level,
      confidenceScore: row.confidence_score ? parseFloat(row.confidence_score) : undefined,
      hasImage: row.has_image,
      smokeDetected: row.smoke_detected,
      flameDetected: row.flame_detected,
      heatSignatureDetected: row.heat_signature_detected,
      motionDetected: row.motion_detected,
      alertPriority: row.alert_priority,
      responseRequired: row.response_required,
      falsePositiveFlag: row.false_positive_flag,
      verifiedByHuman: row.verified_by_human,
      humanVerifier: row.human_verifier,
      telegramDelivered: row.telegram_delivered,
      telegramMessageId: row.telegram_message_id?.toString(),
      ollamaAnalysisText: row.ollama_analysis_text,
      rawAnalysisJson: row.raw_analysis_json,
      processedAt: new Date(row.processed_at),
      processingVersion: row.processing_version,
      extractionMethod: row.extraction_method,
      
      // Expert Review fields
      expertReviewStatus: row.expert_review_status,
      expertReviewPriority: row.expert_review_priority,
      assignedExpertId: row.assigned_expert_id,
      expertReviewDeadline: row.expert_review_deadline ? new Date(row.expert_review_deadline) : undefined,
      expertRiskAssessment: row.expert_risk_assessment,
      expertConfidence: row.expert_confidence ? parseFloat(row.expert_confidence) : undefined,
      expertAgreesWithAi: row.expert_agrees_with_ai,
      expertNotes: row.expert_notes,
      expertReasoning: row.expert_reasoning,
      expertTags: row.expert_tags ? JSON.parse(row.expert_tags) : undefined,
      fireType: row.fire_type,
      fireStage: row.fire_stage,
      fireCause: row.fire_cause,
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
      reviewDurationMinutes: row.review_duration_minutes,
      expertName: row.expert_name,
      expertCertification: row.expert_certification,
      expertExperienceYears: row.expert_experience_years,
      needsSecondOpinion: row.needs_second_opinion,
      secondReviewerId: row.second_reviewer_id,
      secondExpertAgrees: row.second_expert_agrees,
      consensusReached: row.consensus_reached,
      escalatedToSupervisor: row.escalated_to_supervisor,
      useForTraining: row.use_for_training,
      trainingWeight: row.training_weight ? parseFloat(row.training_weight) : undefined,
      imageClarityRating: row.image_clarity_rating,
      detectionDifficulty: row.detection_difficulty,
      expertAccuracyScore: row.expert_accuracy_score ? parseFloat(row.expert_accuracy_score) : undefined,
      expertSpecialization: row.expert_specialization
    };
  }

  /**
   * Get available expert tags for frontend UI
   */
  getAvailableExpertTags(): Record<string, string[]> {
    return {
      fire_indicators: ['visible_flames', 'smoke_plume', 'heat_signature', 'ember_glow', 'fire_reflection', 'char_marks'],
      environmental: ['clear_sky', 'overcast', 'fog', 'rain', 'windy', 'dawn', 'dusk', 'night', 'snow'],
      false_positives: ['vehicle_lights', 'reflective_surface', 'dust_cloud', 'steam', 'controlled_burn', 'flare', 'sunlight', 'artificial_light'],
      image_quality: ['sharp_focus', 'blurry', 'overexposed', 'underexposed', 'good_lighting', 'poor_contrast', 'motion_blur', 'lens_flare'],
      urgency: ['immediate_response', 'monitor_closely', 'routine_followup', 'no_action_needed', 'evacuation_recommended'],
      complexity: ['obvious_fire', 'subtle_indicators', 'ambiguous_scene', 'expert_level_detection', 'requires_specialist'],
      fire_behavior: ['spreading_rapidly', 'contained', 'smoldering', 'crown_fire', 'ground_fire', 'structure_fire'],
      weather_impact: ['wind_driven', 'humidity_suppressed', 'drought_conditions', 'seasonal_risk', 'weather_change']
    };
  }

  // TODO: Implement backfill functionality in enhancedAnalysisService
  // This method was moved to prevent circular dependency
}

export const expertReviewService = new ExpertReviewService();