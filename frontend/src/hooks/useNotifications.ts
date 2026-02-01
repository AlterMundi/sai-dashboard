import { useState, useCallback } from 'react';
import { NotificationData, NotificationAction } from '@/components/notifications/NotificationOverlay';
import { useNavigate } from 'react-router-dom';

interface CreateNotificationOptions {
  type: NotificationData['type'];
  title: string;
  body: string;
  icon: string;
  actions?: NotificationAction[];
  duration?: number;
  persistent?: boolean;
  data?: any;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const navigate = useNavigate();

  const createNotification = useCallback((options: CreateNotificationOptions): string => {
    const id = `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const notification: NotificationData = {
      id,
      ...options,
      timestamp: new Date(),
      duration: options.duration ?? 5000,
    };

    setNotifications(prev => [notification, ...prev]);
    return id;
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const handleNotificationAction = useCallback((_notificationId: string, action: string, data?: any) => {
    switch (action) {
      case 'view':
        if (data?.execution?.id) {
          navigate(`/dashboard/executions/${data.execution.id}`);
        }
        break;

      default:
        console.log('Unknown notification action:', action, data);
    }
  }, [navigate]);

  // Smart notification creators for different event types
  const notifyNewExecution = useCallback((executionData: any) => {
    const alertLevel = executionData.execution.analysis?.alertLevel;
    const isHighRisk = alertLevel === 'critical' || alertLevel === 'high';
    const confidence = Math.max(
      executionData.execution.analysis?.confidenceFire ?? 0,
      executionData.execution.analysis?.confidenceSmoke ?? 0
    );
    const executionId = String(executionData.execution.id).slice(-6);

    return createNotification({
      type: 'execution:new',
      icon: isHighRisk ? '🚨' : '🔍',
      title: isHighRisk ? 'High Risk Detection' : `Analysis Complete #${executionId}`,
      body: isHighRisk
        ? `Alert: ${alertLevel} (${(confidence * 100).toFixed(0)}% confidence)`
        : `Alert: ${alertLevel || 'none'}`,
      actions: [
        { label: 'View Details', action: 'view', priority: isHighRisk ? 'high' : 'medium' },
      ],
      duration: isHighRisk ? 10000 : 6000,
      persistent: isHighRisk,
      data: executionData
    });
  }, [createNotification]);

  const notifyExecutionError = useCallback((errorData: any) => {
    return createNotification({
      type: 'execution:error',
      icon: '⚠️',
      title: `Execution Failed #${errorData.executionId.slice(-6)}`,
      body: errorData.error || 'Unknown error occurred',
      actions: [
        { label: 'View Details', action: 'view', priority: 'medium' }
      ],
      duration: 8000,
      data: errorData
    });
  }, [createNotification]);

  const notifyBatchComplete = useCallback((batchData: any) => {
    return createNotification({
      type: 'execution:batch',
      icon: '📊',
      title: `${batchData.count} New Executions`,
      body: `${batchData.highRisk > 0 ? `⚠️ ${batchData.highRisk} high risk, ` : ''}${batchData.successful} successful`,
      actions: [], // No buttons - strict notification only
      duration: 8000, // Show for 8 seconds
      data: batchData
    });
  }, [createNotification]);

  const notifySystemHealth = useCallback((healthData: any) => {
    const isCritical = healthData.status === 'critical';
    
    if (healthData.status === 'healthy') return; // Don't notify for healthy status
    
    return createNotification({
      type: 'system:health',
      icon: isCritical ? '🔥' : '⚠️',
      title: isCritical ? 'System Critical' : 'System Warning',
      body: `CPU: ${healthData.cpu}% | Memory: ${healthData.memory}% | Queue: ${healthData.queueSize}`,
      actions: [
        { label: 'System Health', action: 'health', priority: isCritical ? 'high' : 'medium' }
      ],
      duration: isCritical ? 20000 : 12000,
      persistent: isCritical,
      data: healthData
    });
  }, [createNotification]);

  const notifySystemStats = useCallback((statsData: any) => {
    // Only notify for significant changes in stats
    const successRate = (statsData.successRate * 100).toFixed(1);
    
    // Don't spam with stats notifications unless there's something notable
    if (parseFloat(successRate) < 90) {
      return createNotification({
        type: 'system:stats',
        icon: '📈',
        title: 'Performance Update',
        body: `Success Rate: ${successRate}% | Queue: ${statsData.queueSize} | Avg Time: ${statsData.avgProcessingTime?.toFixed(1)}s`,
        duration: 6000,
        data: statsData
      });
    }
  }, [createNotification]);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    notifications,
    createNotification,
    dismissNotification,
    handleNotificationAction,
    clearAllNotifications,
    // Smart notification helpers
    notifyNewExecution,
    notifyExecutionError,
    notifyBatchComplete,
    notifySystemHealth,
    notifySystemStats
  };
}