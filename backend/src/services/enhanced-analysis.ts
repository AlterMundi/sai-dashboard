import { db } from '@/database/pool';
import { SaiEnhancedAnalysis, ExpertReview, ComprehensiveAnalysis } from '@/types';
import { logger } from '@/utils/logger';
import { validateImageFormat, formatBytes } from '@/utils';
import sharp from 'sharp';
import { randomUUID } from 'crypto';

/**
 * Enhanced Analysis Extractor Service
 * Replaces expensive regex CTE queries with precomputed analysis
 * Extracts comprehensive fire detection data from n8n execution payloads
 */
export class EnhancedAnalysisService {
  
  /**
   * Extract comprehensive analysis from execution data
   * This is the main entry point replacing the old regex-heavy CTE approach
   */
  async extractAndStoreAnalysis(executionId: string): Promise<ComprehensiveAnalysis | null> {
    try {
      logger.debug('Starting enhanced analysis extraction', { executionId });
      
      // Get execution data from n8n tables
      const executionData = await this.getExecutionData(executionId);
      if (!executionData) {
        logger.warn('No execution data found', { executionId });
        return null;
      }

      // Extract comprehensive analysis
      const analysis = await this.performComprehensiveExtraction(executionId, executionData);
      if (!analysis) {
        logger.warn('Analysis extraction failed', { executionId });
        return null;
      }

      // Store in precomputed table
      await this.storeAnalysisData(analysis);
      
      // Auto-assign expert review if needed
      await this.autoAssignExpertReview(analysis);

      logger.info('Enhanced analysis extraction completed', {
        executionId,
        riskLevel: analysis.riskLevel,
        hasImage: analysis.hasImage,
        processingTime: analysis.processingTimeMs
      });

      return analysis;

    } catch (error) {
      logger.error('Enhanced analysis extraction failed', { executionId, error });
      
      // Store minimal fallback analysis to prevent query failures
      await this.storeFallbackAnalysis(executionId);
      return null;
    }
  }

  /**
   * Get existing analysis from precomputed table
   * Fast lookup replacing expensive regex queries
   */
  async getAnalysis(executionId: string): Promise<ComprehensiveAnalysis | null> {
    try {
      const query = `
        SELECT 
          execution_id,
          node_id,
          node_name, 
          node_type,
          camera_id,
          camera_location,
          risk_level,
          confidence_score,
          has_image,
          smoke_detected,
          flame_detected,
          heat_signature_detected,
          motion_detected,
          image_width,
          image_height,
          image_size_bytes,
          image_format,
          image_quality_score,
          model_version,
          processing_time_ms,
          features_detected,
          color_analysis,
          alert_priority,
          response_required,
          false_positive_flag,
          verified_by_human,
          human_verifier,
          telegram_delivered,
          telegram_message_id,
          telegram_chat_id,
          email_sent,
          sms_sent,
          latitude,
          longitude,
          elevation,
          fire_zone_risk,
          detection_timestamp,
          is_daylight,
          weather_conditions,
          temperature_celsius,
          humidity_percent,
          wind_speed_kmh,
          incident_id,
          related_execution_ids,
          duplicate_of,
          ollama_analysis_text,
          raw_analysis_json,
          confidence_breakdown,
          processed_at,
          processing_version,
          extraction_method,
          expert_review_status,
          expert_review_priority,
          assigned_expert_id,
          expert_review_deadline,
          expert_risk_assessment,
          expert_confidence,
          expert_agrees_with_ai,
          expert_notes,
          expert_reasoning,
          expert_tags,
          fire_type,
          fire_stage,
          fire_cause,
          reviewed_at,
          review_duration_minutes,
          expert_name,
          expert_certification,
          expert_experience_years,
          needs_second_opinion,
          second_reviewer_id,
          second_expert_agrees,
          consensus_reached,
          escalated_to_supervisor,
          use_for_training,
          training_weight,
          image_clarity_rating,
          detection_difficulty,
          ai_improvement_suggestions,
          feedback_category,
          recommended_camera_adjustment,
          legal_evidence_quality,
          chain_of_custody_maintained,
          expert_signature_hash,
          expert_accuracy_score,
          review_complexity_score,
          expert_specialization
        FROM sai_execution_analysis 
        WHERE execution_id = $1
      `;

      const results = await db.query(query, [executionId]);
      
      if (results.length === 0) {
        return null;
      }

      const row = results[0];
      
      // Map database row to comprehensive analysis interface
      const analysis: ComprehensiveAnalysis = {
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
        imageWidth: row.image_width,
        imageHeight: row.image_height,
        imageSizeBytes: row.image_size_bytes,
        imageFormat: row.image_format,
        imageQualityScore: row.image_quality_score ? parseFloat(row.image_quality_score) : undefined,
        modelVersion: row.model_version,
        processingTimeMs: row.processing_time_ms,
        featuresDetected: row.features_detected ? JSON.parse(row.features_detected) : undefined,
        colorAnalysis: row.color_analysis,
        alertPriority: row.alert_priority,
        responseRequired: row.response_required,
        falsePositiveFlag: row.false_positive_flag,
        verifiedByHuman: row.verified_by_human,
        humanVerifier: row.human_verifier,
        telegramDelivered: row.telegram_delivered,
        telegramMessageId: row.telegram_message_id?.toString(),
        telegramChatId: row.telegram_chat_id,
        emailSent: row.email_sent,
        smsSent: row.sms_sent,
        latitude: row.latitude ? parseFloat(row.latitude) : undefined,
        longitude: row.longitude ? parseFloat(row.longitude) : undefined,
        elevation: row.elevation,
        fireZoneRisk: row.fire_zone_risk,
        detectionTimestamp: row.detection_timestamp ? new Date(row.detection_timestamp) : undefined,
        isDaylight: row.is_daylight,
        weatherConditions: row.weather_conditions,
        temperatureCelsius: row.temperature_celsius,
        humidityPercent: row.humidity_percent,
        windSpeedKmh: row.wind_speed_kmh,
        incidentId: row.incident_id,
        relatedExecutionIds: row.related_execution_ids ? JSON.parse(row.related_execution_ids) : undefined,
        duplicateOf: row.duplicate_of?.toString(),
        ollamaAnalysisText: row.ollama_analysis_text,
        rawAnalysisJson: row.raw_analysis_json,
        confidenceBreakdown: row.confidence_breakdown,
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
        aiImprovementSuggestions: row.ai_improvement_suggestions,
        feedbackCategory: row.feedback_category,
        recommendedCameraAdjustment: row.recommended_camera_adjustment,
        legalEvidenceQuality: row.legal_evidence_quality,
        chainOfCustodyMaintained: row.chain_of_custody_maintained,
        expertSignatureHash: row.expert_signature_hash,
        expertAccuracyScore: row.expert_accuracy_score ? parseFloat(row.expert_accuracy_score) : undefined,
        reviewComplexityScore: row.review_complexity_score,
        expertSpecialization: row.expert_specialization
      };

      return analysis;

    } catch (error) {
      logger.error('Failed to get analysis from database', { executionId, error });
      return null;
    }
  }

  /**
   * Perform comprehensive extraction from raw execution data
   * Replaces the old regex-heavy CTE approach with structured parsing
   */
  private async performComprehensiveExtraction(
    executionId: string, 
    executionData: any
  ): Promise<ComprehensiveAnalysis | null> {
    const startTime = Date.now();
    
    try {
      // Parse JSON data
      const parsedData = typeof executionData.data === 'string' 
        ? JSON.parse(executionData.data) 
        : executionData.data;

      // Extract node context
      const nodeContext = await this.extractNodeContext(parsedData);
      
      // Extract core analysis
      const coreAnalysis = await this.extractCoreAnalysis(parsedData);
      
      // Extract image data and quality metrics
      const imageAnalysis = await this.extractImageAnalysis(executionId, parsedData);
      
      // Extract communication status
      const commAnalysis = this.extractCommunicationStatus(parsedData);
      
      // Extract temporal and geographic context
      const contextualData = await this.extractContextualData(parsedData);
      
      // Compute incident correlation
      const incidentData = await this.computeIncidentCorrelation(executionId, contextualData);
      
      const processingTime = Date.now() - startTime;
      
      // Combine all analysis components
      const comprehensiveAnalysis: ComprehensiveAnalysis = {
        executionId: executionId,
        riskLevel: coreAnalysis.riskLevel || 'none',
        hasImage: coreAnalysis.hasImage || false,
        telegramDelivered: commAnalysis.telegramDelivered || false,
        processedAt: new Date(),
        processingVersion: '2.0',
        extractionMethod: 'enhanced',
        alertPriority: coreAnalysis.alertPriority || 'low',
        ...nodeContext,
        ...coreAnalysis,
        ...imageAnalysis,
        ...commAnalysis,
        ...contextualData,
        ...incidentData,
        processingTimeMs: processingTime,
        
        // Initialize expert review fields
        expertReviewStatus: 'pending',
        expertReviewPriority: this.calculateReviewPriority(coreAnalysis),
        useForTraining: true,
        trainingWeight: 1.0,
        legalEvidenceQuality: 'standard',
        chainOfCustodyMaintained: true
      };

      return comprehensiveAnalysis;

    } catch (error) {
      logger.error('Comprehensive extraction failed', { executionId, error });
      return null;
    }
  }

  /**
   * Extract node and device context from execution data
   */
  private async extractNodeContext(parsedData: any): Promise<Partial<SaiEnhancedAnalysis>> {
    try {
      let nodeId = null;
      let nodeName = null;
      let nodeType = null;
      let cameraId = null;
      let cameraLocation = null;

      // Extract from nodeOutputData structure
      if (parsedData.nodeOutputData) {
        for (const [currentNodeId, nodeData] of Object.entries(parsedData.nodeOutputData)) {
          const nodeDataObj = nodeData as any;
          
          // Identify analysis nodes (Ollama, function, etc.)
          if (this.isAnalysisNode(currentNodeId, nodeDataObj)) {
            nodeId = currentNodeId;
            nodeType = this.determineNodeType(currentNodeId, nodeDataObj);
            nodeName = this.extractNodeName(currentNodeId);
            break;
          }
        }
      }

      // Extract camera ID from multiple possible locations
      cameraId = this.extractCameraId(parsedData);
      cameraLocation = this.extractCameraLocation(parsedData, cameraId);

      return {
        nodeId: nodeId || undefined,
        nodeName: nodeName || undefined,
        nodeType: nodeType || undefined,
        cameraId: cameraId || undefined,
        cameraLocation: cameraLocation || undefined
      };

    } catch (error) {
      logger.error('Node context extraction failed', error);
      return {};
    }
  }

  /**
   * Extract core risk analysis replacing old regex patterns
   */
  private async extractCoreAnalysis(parsedData: any): Promise<Partial<SaiEnhancedAnalysis>> {
    try {
      const dataStr = JSON.stringify(parsedData).toLowerCase();
      
      // Enhanced risk level detection
      const riskLevel = this.determineRiskLevel(dataStr);
      
      // Extract confidence score
      const confidenceScore = this.extractConfidenceScore(parsedData);
      
      // Detect specific fire indicators
      const smokeDetected = this.detectSmoke(dataStr);
      const flameDetected = this.detectFlames(dataStr);
      const heatSignatureDetected = this.detectHeat(dataStr);
      const motionDetected = this.detectMotion(dataStr);
      
      // Check for image presence
      const hasImage = dataStr.includes('data:image');
      
      // Extract analysis text
      const ollamaAnalysisText = this.extractAnalysisText(parsedData);
      
      // Determine alert priority
      const alertPriority = this.computeAlertPriority(riskLevel, confidenceScore);
      
      // Check if emergency response is required
      const responseRequired = this.shouldTriggerEmergencyResponse(riskLevel, confidenceScore);

      return {
        riskLevel,
        confidenceScore,
        hasImage,
        smokeDetected,
        flameDetected,
        heatSignatureDetected,
        motionDetected,
        ollamaAnalysisText: ollamaAnalysisText || undefined,
        alertPriority,
        responseRequired,
        rawAnalysisJson: parsedData
      };

    } catch (error) {
      logger.error('Core analysis extraction failed', error);
      return {
        riskLevel: 'none',
        hasImage: false,
        alertPriority: 'low',
        responseRequired: false
      };
    }
  }

  /**
   * Enhanced risk level determination using multiple indicators
   */
  private determineRiskLevel(dataStr: string): 'high' | 'medium' | 'low' | 'none' {
    // High risk indicators
    const highRiskPatterns = [
      /(fire|flame|burn).*(high|severe|critical|extreme|dangerous)/,
      /(high|severe|critical|extreme).*(fire|flame|burn|risk|danger)/,
      /visible.*(flame|fire)/,
      /active.*(fire|burn)/,
      /immediate.*(danger|threat|risk)/
    ];

    // Medium risk indicators  
    const mediumRiskPatterns = [
      /(fire|flame|burn|smoke).*(medium|moderate|elevated|concern)/,
      /(medium|moderate|elevated).*(fire|flame|burn|smoke|risk)/,
      /potential.*(fire|risk)/,
      /smoke.*(visible|detected|present)/,
      /heat.*(signature|detected)/
    ];

    // Low risk indicators
    const lowRiskPatterns = [
      /(fire|flame|burn|smoke|risk).*(low|minimal|slight|minor)/,
      /(low|minimal|slight|minor).*(fire|flame|burn|smoke|risk)/,
      /possible.*(fire|smoke)/,
      /faint.*(smoke|heat)/
    ];

    // None/No risk indicators
    const noRiskPatterns = [
      /(no|zero|none|clear).*(fire|flame|burn|smoke|risk|danger)/,
      /no.*visible.*(fire|flame|smoke)/,
      /clear.*of.*(fire|smoke|danger)/,
      /safe|normal|routine/
    ];

    // Check in order of severity
    for (const pattern of highRiskPatterns) {
      if (pattern.test(dataStr)) return 'high';
    }
    
    for (const pattern of mediumRiskPatterns) {
      if (pattern.test(dataStr)) return 'medium';
    }
    
    for (const pattern of lowRiskPatterns) {
      if (pattern.test(dataStr)) return 'low';
    }
    
    for (const pattern of noRiskPatterns) {
      if (pattern.test(dataStr)) return 'none';
    }

    return 'none';
  }

  /**
   * Extract confidence score from various possible locations
   */
  private extractConfidenceScore(parsedData: any): number | undefined {
    const dataStr = JSON.stringify(parsedData);
    
    // Pattern 1: "confidence": 0.85
    const confidenceMatch = dataStr.match(/"confidence":\s*(0?\.\d+|\d+\.?\d*)/);
    if (confidenceMatch) {
      return parseFloat(confidenceMatch[1]);
    }
    
    // Pattern 2: "certainty": 85 (percentage)
    const certaintyMatch = dataStr.match(/"certainty":\s*(\d+)/);
    if (certaintyMatch) {
      const certainty = parseInt(certaintyMatch[1]);
      return certainty <= 100 ? certainty / 100 : undefined;
    }
    
    // Pattern 3: Text-based confidence ("high confidence", "90% sure")
    const textConfidenceMatch = dataStr.match(/(\d{1,3})%\s*(confident|sure|certain)/i);
    if (textConfidenceMatch) {
      const percentage = parseInt(textConfidenceMatch[1]);
      return percentage <= 100 ? percentage / 100 : undefined;
    }

    return undefined;
  }

  /**
   * Enhanced detection methods for specific fire indicators
   */
  private detectSmoke(dataStr: string): boolean {
    return /smoke|haze|vapor|fume|smog|plume/i.test(dataStr);
  }

  private detectFlames(dataStr: string): boolean {
    return /flame|fire|burn|ignit|blaze|inferno/i.test(dataStr);
  }

  private detectHeat(dataStr: string): boolean {
    return /heat|thermal|temperature|hot|warm|glow/i.test(dataStr);
  }

  private detectMotion(dataStr: string): boolean {
    return /motion|movement|moving|active|dynamic/i.test(dataStr);
  }

  /**
   * Store analysis data in precomputed table
   */
  private async storeAnalysisData(analysis: ComprehensiveAnalysis): Promise<void> {
    const query = `
      INSERT INTO sai_execution_analysis (
        execution_id, node_id, node_name, node_type, camera_id, camera_location,
        risk_level, confidence_score, has_image, smoke_detected, flame_detected,
        heat_signature_detected, motion_detected, processing_time_ms, alert_priority,
        response_required, telegram_delivered, ollama_analysis_text, raw_analysis_json,
        processed_at, processing_version, extraction_method, expert_review_status,
        expert_review_priority, use_for_training, training_weight, legal_evidence_quality,
        chain_of_custody_maintained
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28
      )
      ON CONFLICT (execution_id) DO UPDATE SET
        risk_level = EXCLUDED.risk_level,
        confidence_score = EXCLUDED.confidence_score,
        has_image = EXCLUDED.has_image,
        smoke_detected = EXCLUDED.smoke_detected,
        flame_detected = EXCLUDED.flame_detected,
        heat_signature_detected = EXCLUDED.heat_signature_detected,
        motion_detected = EXCLUDED.motion_detected,
        processing_time_ms = EXCLUDED.processing_time_ms,
        alert_priority = EXCLUDED.alert_priority,
        response_required = EXCLUDED.response_required,
        telegram_delivered = EXCLUDED.telegram_delivered,
        ollama_analysis_text = EXCLUDED.ollama_analysis_text,
        raw_analysis_json = EXCLUDED.raw_analysis_json,
        processed_at = EXCLUDED.processed_at,
        processing_version = EXCLUDED.processing_version
    `;

    const params = [
      analysis.executionId,
      analysis.nodeId,
      analysis.nodeName,
      analysis.nodeType,
      analysis.cameraId,
      analysis.cameraLocation,
      analysis.riskLevel,
      analysis.confidenceScore,
      analysis.hasImage,
      analysis.smokeDetected,
      analysis.flameDetected,
      analysis.heatSignatureDetected,
      analysis.motionDetected,
      analysis.processingTimeMs,
      analysis.alertPriority,
      analysis.responseRequired,
      analysis.telegramDelivered,
      analysis.ollamaAnalysisText,
      JSON.stringify(analysis.rawAnalysisJson),
      analysis.processedAt,
      analysis.processingVersion,
      analysis.extractionMethod,
      analysis.expertReviewStatus,
      analysis.expertReviewPriority,
      analysis.useForTraining,
      analysis.trainingWeight,
      analysis.legalEvidenceQuality,
      analysis.chainOfCustodyMaintained
    ];

    await db.query(query, params);
  }

  // Helper methods (abbreviated for space)
  private async getExecutionData(executionId: string): Promise<any> {
    const query = `
      SELECT data FROM execution_data 
      WHERE "executionId" = $1::integer AND data IS NOT NULL
      LIMIT 1
    `;
    const results = await db.query(query, [parseInt(executionId)]);
    return results[0] || null;
  }

  private isAnalysisNode(nodeId: string, nodeData: any): boolean {
    return nodeId.toLowerCase().includes('ollama') || 
           nodeId.toLowerCase().includes('analysis') ||
           (nodeData && JSON.stringify(nodeData).includes('fire'));
  }

  private determineNodeType(nodeId: string, nodeData: any): string {
    if (nodeId.toLowerCase().includes('ollama')) return 'ollama';
    if (nodeId.toLowerCase().includes('webhook')) return 'webhook';
    if (nodeId.toLowerCase().includes('telegram')) return 'telegram';
    return 'function';
  }

  private extractNodeName(nodeId: string): string {
    return nodeId.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  private extractCameraId(parsedData: any): string | null {
    const dataStr = JSON.stringify(parsedData);
    
    // Multiple extraction patterns
    const patterns = [
      /camera_id[=:]["']?([^&"'\s,}]+)/i,
      /cameraId[=:]["']?([^&"'\s,}]+)/i,
      /device_id[=:]["']?([^&"'\s,}]+)/i,
      /sensor[_-]?id[=:]["']?([^&"'\s,}]+)/i,
      /IMG_CAMERA_?([A-Z0-9]+)_/i
    ];

    for (const pattern of patterns) {
      const match = dataStr.match(pattern);
      if (match) return match[1];
    }
    
    return null;
  }

  private extractCameraLocation(parsedData: any, cameraId: string | null): string | null {
    if (!cameraId) return null;
    
    // This could be enhanced with a camera registry lookup
    // For now, return a basic location if available in data
    const dataStr = JSON.stringify(parsedData);
    const locationMatch = dataStr.match(/location[=:]["']?([^&"'\s,}]+)/i);
    
    return locationMatch ? locationMatch[1] : null;
  }

  private computeAlertPriority(riskLevel: string, confidenceScore?: number): 'critical' | 'high' | 'normal' | 'low' {
    if (riskLevel === 'high' && (confidenceScore || 0) >= 0.9) return 'critical';
    if (riskLevel === 'high' && (confidenceScore || 0) >= 0.7) return 'high';
    if (riskLevel === 'medium' && (confidenceScore || 0) >= 0.8) return 'high';
    if (riskLevel === 'medium') return 'normal';
    return 'low';
  }

  private shouldTriggerEmergencyResponse(riskLevel: string, confidenceScore?: number): boolean {
    return riskLevel === 'high' && (confidenceScore || 0) >= 0.85;
  }

  private calculateReviewPriority(coreAnalysis: any): 1 | 2 | 3 | 4 | 5 {
    if (coreAnalysis.responseRequired) return 1;
    if (coreAnalysis.riskLevel === 'high') return 2;
    if (coreAnalysis.riskLevel === 'medium') return 3;
    if (coreAnalysis.riskLevel === 'low') return 4;
    return 5;
  }

  private extractAnalysisText(parsedData: any): string | null {
    const dataStr = JSON.stringify(parsedData);
    
    // Enhanced patterns for analysis text extraction
    const patterns = [
      /"(?:content|message|text|response|analysis)":\s*"([^"]*(?:fire|smoke|risk|danger)[^"]*)"]/i,
      /ollama[^"]*"(?:content|text)":\s*"([^"]*)"]/i,
      /"description":\s*"([^"]*(?:fire|smoke|risk)[^"]*)"]/i
    ];

    for (const pattern of patterns) {
      const match = dataStr.match(pattern);
      if (match) {
        return match[1].substring(0, 1000); // Limit to 1000 chars
      }
    }
    
    return null;
  }

  private async extractImageAnalysis(executionId: string, parsedData: any): Promise<Partial<SaiEnhancedAnalysis>> {
    // This would integrate with the existing imageService
    // For now, return basic image metrics if available
    return {
      imageWidth: undefined,
      imageHeight: undefined,
      imageSizeBytes: undefined,
      imageFormat: 'jpeg',
      imageQualityScore: undefined
    };
  }

  private extractCommunicationStatus(parsedData: any): Partial<SaiEnhancedAnalysis> {
    const dataStr = JSON.stringify(parsedData);
    
    const telegramDelivered = /telegram.*"ok":\s*true|message_id.*\d+.*telegram/i.test(dataStr);
    const emailSent = /"email".*"sent":\s*true|"mail".*"delivered"/i.test(dataStr);
    const smsSent = /"sms".*"sent":\s*true|"text".*"delivered"/i.test(dataStr);

    return {
      telegramDelivered,
      emailSent,
      smsSent
    };
  }

  private async extractContextualData(parsedData: any): Promise<Partial<SaiEnhancedAnalysis>> {
    // Extract temporal and environmental context
    return {
      detectionTimestamp: new Date(),
      isDaylight: this.isDaytime(new Date()),
      weatherConditions: undefined,
      temperatureCelsius: undefined,
      humidityPercent: undefined,
      windSpeedKmh: undefined
    };
  }

  private async computeIncidentCorrelation(executionId: string, contextualData: any): Promise<Partial<SaiEnhancedAnalysis>> {
    // This would implement spatial-temporal incident correlation
    // For now, generate a unique incident ID
    return {
      incidentId: randomUUID(),
      relatedExecutionIds: []
    };
  }

  private isDaytime(date: Date): boolean {
    const hour = date.getHours();
    return hour >= 6 && hour <= 18;
  }

  private async autoAssignExpertReview(analysis: ComprehensiveAnalysis): Promise<void> {
    // Auto-assign expert review based on priority and availability
    // This will be implemented in the expert assignment service
    logger.debug('Auto-assignment of expert review', {
      executionId: analysis.executionId,
      priority: analysis.expertReviewPriority,
      riskLevel: analysis.riskLevel
    });
  }

  private async storeFallbackAnalysis(executionId: string): Promise<void> {
    // Store minimal analysis to prevent query failures
    const fallbackQuery = `
      INSERT INTO sai_execution_analysis (
        execution_id, risk_level, has_image, alert_priority, processed_at, 
        processing_version, extraction_method, expert_review_status
      ) VALUES ($1, 'none', false, 'low', NOW(), '2.0', 'fallback', 'pending')
      ON CONFLICT (execution_id) DO NOTHING
    `;
    
    await db.query(fallbackQuery, [executionId]);
  }
}

export const enhancedAnalysisService = new EnhancedAnalysisService();