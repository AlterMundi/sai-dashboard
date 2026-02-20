import { useState, useCallback } from 'react';
import { NotificationData, NotificationAction } from '@/components/notifications/NotificationOverlay';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/contexts/LanguageContext';

interface CreateNotificationOptions {
  type: NotificationData['type'];
  title: string;
  body: string;
  icon: string;
  actions?: NotificationAction[];
  duration?: number;
  persistent?: boolean;
  data?: unknown;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const navigate = useNavigate();
  const { t } = useTranslation();

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
  const notifyNewExecution = useCallback((executionData: { execution: { id: number; analysis?: { alertLevel?: string; confidenceSmoke?: number } } }) => {
    const alertLevel = executionData.execution.analysis?.alertLevel;
    const isHighRisk = alertLevel === 'critical' || alertLevel === 'high';
    const confidence = executionData.execution.analysis?.confidenceSmoke ?? 0;
    const executionId = String(executionData.execution.id).slice(-6);

    return createNotification({
      type: 'execution:new',
      icon: isHighRisk ? '🚨' : '🔍',
      title: isHighRisk
        ? t('notifications.highRiskTitle')
        : t('notifications.analysisCompleteTitle', { id: executionId }),
      body: isHighRisk
        ? t('notifications.highRiskBody', { alertLevel: alertLevel!, confidence: (confidence * 100).toFixed(0) })
        : t('notifications.alertBody', { alertLevel: alertLevel || 'none' }),
      actions: [
        { label: t('notifications.viewDetails'), action: 'view', priority: isHighRisk ? 'high' : 'medium' },
      ],
      duration: isHighRisk ? 10000 : 6000,
      persistent: isHighRisk,
      data: executionData
    });
  }, [createNotification, t]);

  const notifyExecutionError = useCallback((errorData: { executionId: string; error?: string }) => {
    return createNotification({
      type: 'execution:error',
      icon: '⚠️',
      title: t('notifications.executionFailedTitle', { id: errorData.executionId.slice(-6) }),
      body: errorData.error || t('notifications.unknownError'),
      actions: [
        { label: t('notifications.viewDetails'), action: 'view', priority: 'medium' }
      ],
      duration: 8000,
      data: errorData
    });
  }, [createNotification, t]);

  const notifyBatchComplete = useCallback((batchData: { count: number; highRisk?: number; successful?: number }) => {
    const hasRisk = (batchData.highRisk ?? 0) > 0;
    return createNotification({
      type: 'execution:batch',
      icon: '',
      title: t('notifications.batchTitle', { count: batchData.count }),
      body: hasRisk
        ? t('notifications.batchBodyWithRisk', { highRisk: batchData.highRisk! })
        : '',
      actions: [],
      duration: 8000,
      data: batchData
    });
  }, [createNotification, t]);

  const notifySystemHealth = useCallback((healthData: { status: string; cpu?: number; memory?: number; queueSize?: number }) => {
    const isCritical = healthData.status === 'critical';

    if (healthData.status === 'healthy') return;

    return createNotification({
      type: 'system:health',
      icon: isCritical ? '🔥' : '⚠️',
      title: isCritical ? t('notifications.systemCriticalTitle') : t('notifications.systemWarningTitle'),
      body: t('notifications.systemHealthBody', { cpu: healthData.cpu ?? 0, memory: healthData.memory ?? 0, queueSize: healthData.queueSize ?? 0 }),
      actions: [
        { label: t('notifications.systemHealthAction'), action: 'health', priority: isCritical ? 'high' : 'medium' }
      ],
      duration: isCritical ? 20000 : 12000,
      persistent: isCritical,
      data: healthData
    });
  }, [createNotification, t]);

  const notifySystemStats = useCallback((statsData: { successRate: number; queueSize?: number; avgProcessingTime?: number }) => {
    const successRate = (statsData.successRate * 100).toFixed(1);

    if (parseFloat(successRate) < 90) {
      return createNotification({
        type: 'system:stats',
        icon: '📈',
        title: t('notifications.performanceUpdateTitle'),
        body: t('notifications.performanceBody', { successRate, queueSize: statsData.queueSize ?? 0, avgTime: statsData.avgProcessingTime?.toFixed(1) ?? '0' }),
        duration: 6000,
        data: statsData
      });
    }
  }, [createNotification, t]);

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