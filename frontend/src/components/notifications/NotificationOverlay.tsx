import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils';
import { X, ExternalLink, Flag, Eye, FileText, Activity } from 'lucide-react';

export interface NotificationAction {
  label: string;
  action: string;
  priority?: 'low' | 'medium' | 'high';
  icon?: React.ReactNode;
}

export interface NotificationData {
  id: string;
  type: 'execution:new' | 'execution:error' | 'execution:batch' | 'system:health' | 'system:stats';
  title: string;
  body: string;
  icon: string;
  actions?: NotificationAction[];
  duration?: number;
  persistent?: boolean;
  severity?: 'none' | 'low' | 'medium' | 'high' | 'critical';
  data?: any;
  timestamp: Date;
}

interface NotificationOverlayProps {
  notifications: NotificationData[];
  onDismiss: (id: string) => void;
  onAction: (notificationId: string, action: string, data?: any) => void;
}

function NotificationCard({ 
  notification, 
  onDismiss, 
  onAction 
}: { 
  notification: NotificationData;
  onDismiss: (id: string) => void;
  onAction: (notificationId: string, action: string, data?: any) => void;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Entrance animation
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!notification.persistent && notification.duration) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, notification.duration);
      return () => clearTimeout(timer);
    }
  }, [notification.duration, notification.persistent]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(notification.id), 300);
  };

  const handleAction = (action: string) => {
    onAction(notification.id, action, notification.data);
    if (action !== 'dismiss') {
      handleDismiss();
    }
  };

  const getTypeStyles = () => {
    if (notification.type === 'execution:new') {
      switch (notification.severity) {
        case 'critical': return 'border-l-4 border-l-red-600 bg-red-50';
        case 'high':     return 'border-l-4 border-l-red-500 bg-red-50';
        case 'medium':   return 'border-l-4 border-l-orange-500 bg-orange-50';
        case 'low':      return 'border-l-4 border-l-amber-400 bg-amber-50';
        default:         return 'border-l-4 border-l-emerald-500 bg-emerald-50';
      }
    }
    switch (notification.type) {
      case 'execution:error':  return 'border-l-4 border-l-red-500 bg-red-50';
      case 'execution:batch':  return 'border-l-4 border-l-green-500 bg-green-50';
      case 'system:health':    return 'border-l-4 border-l-yellow-500 bg-yellow-50';
      case 'system:stats':     return 'border-l-4 border-l-purple-500 bg-purple-50';
      default:                 return 'border-l-4 border-l-gray-500 bg-gray-50';
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'view': return <Eye className="w-4 h-4" aria-hidden="true" />;
      case 'flag': return <Flag className="w-4 h-4" aria-hidden="true" />;
      case 'report': return <FileText className="w-4 h-4" aria-hidden="true" />;
      case 'health': return <Activity className="w-4 h-4" aria-hidden="true" />;
      default: return <ExternalLink className="w-4 h-4" aria-hidden="true" />;
    }
  };

  return (
    <div
      className={cn(
        'transform transition-[transform,opacity] duration-300 ease-in-out',
        isVisible && !isExiting ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      )}
    >
      <div className={cn(
        'max-w-sm w-full bg-white rounded-lg shadow-lg border',
        getTypeStyles()
      )}>
        <div className="p-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <span className="text-2xl">{notification.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {notification.title}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  {notification.body}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {notification.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
            
            {/* Dismiss button */}
            <button
              onClick={handleDismiss}
              className="ml-4 inline-flex text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Actions */}
          {notification.actions && notification.actions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {notification.actions.map((action) => (
                <button
                  key={action.action}
                  onClick={() => handleAction(action.action)}
                  className={cn(
                    'inline-flex items-center px-2 py-1 rounded text-xs font-medium transition-colors',
                    action.priority === 'high'
                      ? 'bg-red-100 text-red-800 hover:bg-red-200'
                      : action.priority === 'medium'
                      ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  )}
                >
                  {getActionIcon(action.action)}
                  <span className="ml-1">{action.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function NotificationOverlay({ notifications, onDismiss, onAction }: NotificationOverlayProps) {
  if (notifications.length === 0) return null;

  const notificationContainer = (
    <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none" role="status" aria-live="polite" aria-atomic="false">
      <div className="pointer-events-auto">
        {notifications.slice(0, 5).map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            onDismiss={onDismiss}
            onAction={onAction}
          />
        ))}
        
        {notifications.length > 5 && (
          <div className="bg-gray-100 rounded-lg p-3 text-center text-sm text-gray-600">
            + {notifications.length - 5} more notifications
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(notificationContainer, document.body);
}