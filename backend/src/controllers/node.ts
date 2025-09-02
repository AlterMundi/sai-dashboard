/**
 * Node Controller - Regional Coverage and Node Management API
 * Handles node-based monitoring, regional filtering, and coverage statistics
 * Implements the geographic aggregation requested for SAI Dashboard
 */

import { Request, Response } from 'express';
import { db as pool } from '@/database/pool';
import { logger } from '@/utils/logger';
import { DatabaseConfig } from '@/types';

export class NodeController {
  /**
   * Get all monitoring nodes with coverage information
   * GET /api/nodes
   */
  static async getAllNodes(req: Request, res: Response): Promise<void> {
    try {
      const { region, status, include_cameras = 'false' } = req.query;
      
      let query = `
        SELECT 
          mn.*,
          COUNT(nc.camera_id) as camera_count,
          COUNT(CASE WHEN nc.status = 'active' THEN 1 END) as active_cameras,
          AVG(nc.image_quality_score) as avg_image_quality,
          AVG(nc.uptime_percent) as avg_uptime
        FROM monitoring_nodes mn
        LEFT JOIN node_cameras nc ON mn.node_id = nc.node_id
      `;
      
      const conditions: string[] = [];
      const params: any[] = [];
      
      if (region) {
        conditions.push(`mn.region = $${params.length + 1}`);
        params.push(region);
      }
      
      if (status) {
        conditions.push(`mn.status = $${params.length + 1}`);
        params.push(status);
      }
      
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }
      
      query += ` 
        GROUP BY mn.node_id 
        ORDER BY mn.region, mn.node_name
      `;
      
      const result = await pool.query(query, params);
      const nodes = result.rows;
      
      // Include camera details if requested
      if (include_cameras === 'true' && nodes.length > 0) {
        const nodeIds = nodes.map(node => node.node_id);
        const camerasQuery = `
          SELECT * FROM node_cameras 
          WHERE node_id = ANY($1)
          ORDER BY node_id, camera_name
        `;
        const camerasResult = await pool.query(camerasQuery, [nodeIds]);
        
        // Group cameras by node_id
        const camerasByNode = camerasResult.rows.reduce((acc, camera) => {
          if (!acc[camera.node_id]) acc[camera.node_id] = [];
          acc[camera.node_id].push(camera);
          return acc;
        }, {} as Record<string, any[]>);
        
        // Attach cameras to nodes
        nodes.forEach(node => {
          node.cameras = camerasByNode[node.node_id] || [];
        });
      }
      
      res.json({
        data: nodes,
        meta: {
          total: nodes.length,
          regions: [...new Set(nodes.map(n => n.region))]
        }
      });
      
    } catch (error) {
      logger.error('Failed to get nodes:', error);
      res.status(500).json({
        error: {
          message: 'Internal server error',
          code: 'NODES_FETCH_ERROR'
        }
      });
    }
  }

  /**
   * Get specific node details with cameras and recent activity
   * GET /api/nodes/:nodeId
   */
  static async getNodeDetails(req: Request, res: Response): Promise<void> {
    try {
      const { nodeId } = req.params;
      const { include_recent_executions = 'false' } = req.query;
      
      // Get node details
      const nodeQuery = `
        SELECT mn.*, COUNT(nc.camera_id) as camera_count
        FROM monitoring_nodes mn
        LEFT JOIN node_cameras nc ON mn.node_id = nc.node_id
        WHERE mn.node_id = $1
        GROUP BY mn.node_id
      `;
      
      const nodeResult = await pool.query(nodeQuery, [nodeId]);
      
      if (nodeResult.rows.length === 0) {
        res.status(404).json({
          error: {
            message: 'Node not found',
            code: 'NODE_NOT_FOUND'
          }
        });
        return;
      }
      
      const node = nodeResult.rows[0];
      
      // Get cameras for this node
      const camerasQuery = `
        SELECT * FROM node_cameras 
        WHERE node_id = $1
        ORDER BY camera_name
      `;
      const camerasResult = await pool.query(camerasQuery, [nodeId]);
      node.cameras = camerasResult.rows;
      
      // Get recent executions if requested
      if (include_recent_executions === 'true') {
        const executionsQuery = `
          SELECT 
            e.id,
            e.execution_timestamp,
            e.status,
            e.camera_id,
            ea.risk_level,
            ea.confidence_score,
            ea.alert_priority
          FROM executions e
          LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
          WHERE e.node_id = $1
          ORDER BY e.execution_timestamp DESC
          LIMIT 20
        `;
        const executionsResult = await pool.query(executionsQuery, [nodeId]);
        node.recent_executions = executionsResult.rows;
      }
      
      res.json({
        data: node
      });
      
    } catch (error) {
      logger.error('Failed to get node details:', { nodeId: req.params.nodeId, error });
      res.status(500).json({
        error: {
          message: 'Internal server error',
          code: 'NODE_DETAILS_ERROR'
        }
      });
    }
  }

  /**
   * Get executions filtered by node
   * GET /api/nodes/:nodeId/executions
   */
  static async getNodeExecutions(req: Request, res: Response): Promise<void> {
    try {
      const { nodeId } = req.params;
      const {
        limit = '50',
        offset = '0',
        status,
        risk_level,
        start_date,
        end_date,
        camera_id
      } = req.query;
      
      let query = `
        SELECT 
          e.*,
          ea.risk_level,
          ea.confidence_score,
          ea.alert_priority,
          ea.smoke_detected,
          ea.flame_detected,
          nc.camera_name
        FROM executions e
        LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
        LEFT JOIN node_cameras nc ON e.camera_id = nc.camera_id
        WHERE e.node_id = $1
      `;
      
      const conditions: string[] = [];
      const params: any[] = [nodeId];
      
      if (status) {
        conditions.push(`e.status = $${params.length + 1}`);
        params.push(status);
      }
      
      if (risk_level) {
        conditions.push(`ea.risk_level = $${params.length + 1}`);
        params.push(risk_level);
      }
      
      if (camera_id) {
        conditions.push(`e.camera_id = $${params.length + 1}`);
        params.push(camera_id);
      }
      
      if (start_date) {
        conditions.push(`e.execution_timestamp >= $${params.length + 1}`);
        params.push(start_date);
      }
      
      if (end_date) {
        conditions.push(`e.execution_timestamp <= $${params.length + 1}`);
        params.push(end_date);
      }
      
      if (conditions.length > 0) {
        query += ` AND ${conditions.join(' AND ')}`;
      }
      
      query += `
        ORDER BY e.execution_timestamp DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
      
      params.push(parseInt(limit as string));
      params.push(parseInt(offset as string));
      
      const result = await pool.query(query, params);
      
      // Get total count for pagination
      let countQuery = `
        SELECT COUNT(*) as total
        FROM executions e
        LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
        WHERE e.node_id = $1
      `;
      
      if (conditions.length > 0) {
        countQuery += ` AND ${conditions.join(' AND ')}`;
      }
      
      const countResult = await pool.query(countQuery, params.slice(0, -2));
      const total = parseInt(countResult.rows[0].total);
      
      res.json({
        data: result.rows,
        meta: {
          total,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          has_next: parseInt(offset as string) + parseInt(limit as string) < total
        }
      });
      
    } catch (error) {
      logger.error('Failed to get node executions:', { nodeId: req.params.nodeId, error });
      res.status(500).json({
        error: {
          message: 'Internal server error',
          code: 'NODE_EXECUTIONS_ERROR'
        }
      });
    }
  }

  /**
   * Get regional coverage statistics
   * GET /api/coverage/regional
   */
  static async getRegionalCoverage(req: Request, res: Response): Promise<void> {
    try {
      const query = `
        SELECT * FROM regional_coverage_stats
        ORDER BY region
      `;
      
      const result = await pool.query(query);
      
      res.json({
        data: result.rows,
        meta: {
          total_regions: result.rows.length,
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (error) {
      logger.error('Failed to get regional coverage:', error);
      res.status(500).json({
        error: {
          message: 'Internal server error',
          code: 'COVERAGE_ERROR'
        }
      });
    }
  }

  /**
   * Get geographic coverage map data
   * GET /api/coverage/map
   */
  static async getCoverageMap(req: Request, res: Response): Promise<void> {
    try {
      const { region, include_executions = 'false' } = req.query;
      
      let query = `
        SELECT 
          mn.node_id,
          mn.node_name,
          mn.region,
          mn.latitude,
          mn.longitude,
          mn.coverage_radius_meters,
          mn.status as node_status,
          COUNT(nc.camera_id) as camera_count,
          COUNT(CASE WHEN nc.status = 'active' THEN 1 END) as active_cameras
        FROM monitoring_nodes mn
        LEFT JOIN node_cameras nc ON mn.node_id = nc.node_id
      `;
      
      const params: any[] = [];
      
      if (region) {
        query += ` WHERE mn.region = $${params.length + 1}`;
        params.push(region);
      }
      
      query += `
        GROUP BY mn.node_id, mn.node_name, mn.region, mn.latitude, mn.longitude, mn.coverage_radius_meters, mn.status
        ORDER BY mn.region, mn.node_name
      `;
      
      const result = await pool.query(query, params);
      const mapData = result.rows;
      
      // Include recent execution counts if requested
      if (include_executions === 'true' && mapData.length > 0) {
        const nodeIds = mapData.map(node => node.node_id);
        const executionsQuery = `
          SELECT 
            e.node_id,
            COUNT(*) as executions_24h,
            COUNT(CASE WHEN ea.risk_level IN ('high', 'critical') THEN 1 END) as high_risk_24h,
            MAX(e.execution_timestamp) as last_execution
          FROM executions e
          LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
          WHERE e.node_id = ANY($1) 
            AND e.execution_timestamp >= NOW() - INTERVAL '24 HOURS'
          GROUP BY e.node_id
        `;
        
        const executionsResult = await pool.query(executionsQuery, [nodeIds]);
        const executionsByNode = executionsResult.rows.reduce((acc, exec) => {
          acc[exec.node_id] = exec;
          return acc;
        }, {} as Record<string, any>);
        
        // Attach execution data to nodes
        mapData.forEach(node => {
          const execData = executionsByNode[node.node_id] || {
            executions_24h: 0,
            high_risk_24h: 0,
            last_execution: null
          };
          Object.assign(node, execData);
        });
      }
      
      res.json({
        data: mapData,
        meta: {
          total_nodes: mapData.length,
          regions: [...new Set(mapData.map(n => n.region))],
          bounds: {
            min_lat: Math.min(...mapData.map(n => parseFloat(n.latitude))),
            max_lat: Math.max(...mapData.map(n => parseFloat(n.latitude))),
            min_lng: Math.min(...mapData.map(n => parseFloat(n.longitude))),
            max_lng: Math.max(...mapData.map(n => parseFloat(n.longitude)))
          }
        }
      });
      
    } catch (error) {
      logger.error('Failed to get coverage map:', error);
      res.status(500).json({
        error: {
          message: 'Internal server error',
          code: 'COVERAGE_MAP_ERROR'
        }
      });
    }
  }

  /**
   * Get node performance statistics
   * GET /api/nodes/performance
   */
  static async getNodePerformance(req: Request, res: Response): Promise<void> {
    try {
      const { region, limit = '10' } = req.query;
      
      let query = `
        SELECT * FROM node_performance_stats
      `;
      
      const params: any[] = [];
      
      if (region) {
        query += ` WHERE region = $${params.length + 1}`;
        params.push(region);
      }
      
      query += ` LIMIT $${params.length + 1}`;
      params.push(parseInt(limit as string));
      
      const result = await pool.query(query, params);
      
      res.json({
        data: result.rows,
        meta: {
          total: result.rows.length,
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (error) {
      logger.error('Failed to get node performance:', error);
      res.status(500).json({
        error: {
          message: 'Internal server error',
          code: 'NODE_PERFORMANCE_ERROR'
        }
      });
    }
  }

  /**
   * Get cameras for a specific node
   * GET /api/nodes/:nodeId/cameras
   */
  static async getNodeCameras(req: Request, res: Response): Promise<void> {
    try {
      const { nodeId } = req.params;
      const { status, include_recent_images = 'false' } = req.query;
      
      let query = `
        SELECT * FROM node_cameras
        WHERE node_id = $1
      `;
      
      const params: any[] = [nodeId];
      
      if (status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(status);
      }
      
      query += ` ORDER BY camera_name`;
      
      const result = await pool.query(query, params);
      const cameras = result.rows;
      
      // Include recent image information if requested
      if (include_recent_images === 'true' && cameras.length > 0) {
        const cameraIds = cameras.map(camera => camera.camera_id);
        const imagesQuery = `
          SELECT 
            e.camera_id,
            COUNT(*) as images_24h,
            MAX(e.execution_timestamp) as last_image,
            AVG(CASE WHEN ei.size_bytes IS NOT NULL THEN ei.size_bytes END) as avg_image_size
          FROM executions e
          LEFT JOIN execution_images ei ON e.id = ei.execution_id
          WHERE e.camera_id = ANY($1)
            AND e.execution_timestamp >= NOW() - INTERVAL '24 HOURS'
          GROUP BY e.camera_id
        `;
        
        const imagesResult = await pool.query(imagesQuery, [cameraIds]);
        const imagesByCamera = imagesResult.rows.reduce((acc, img) => {
          acc[img.camera_id] = img;
          return acc;
        }, {} as Record<string, any>);
        
        // Attach image data to cameras
        cameras.forEach(camera => {
          const imgData = imagesByCamera[camera.camera_id] || {
            images_24h: 0,
            last_image: null,
            avg_image_size: null
          };
          Object.assign(camera, imgData);
        });
      }
      
      res.json({
        data: cameras,
        meta: {
          total: cameras.length,
          node_id: nodeId
        }
      });
      
    } catch (error) {
      logger.error('Failed to get node cameras:', { nodeId: req.params.nodeId, error });
      res.status(500).json({
        error: {
          message: 'Internal server error',
          code: 'NODE_CAMERAS_ERROR'
        }
      });
    }
  }
}