import { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { useSSE } from '@/contexts/SSEContext';
import { api } from '@/services/api';
import toast from 'react-hot-toast';
import { 
  Activity, 
  Send, 
  Database,
  Zap,
  AlertCircle,
  CheckCircle,
  Server,
  Monitor,
  X,
  Play,
  Pause,
  Trash2
} from 'lucide-react';
import { cn } from '@/utils';

interface EventLog {
  id: string;
  timestamp: Date;
  type: string;
  data: any;
  source: 'sse' | 'manual' | 'system';
  status: 'received' | 'sent' | 'error';
}

interface ConnectionMetrics {
  connectionAttempts: number;
  successfulConnections: number;
  reconnections: number;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  totalEventsReceived: number;
  eventsPerMinute: number;
  connectionUptime: number;
  currentLatency: number;
}

export function SSEDebugPage() {
  const { isConnected, connectionStatus, lastEvent, clientCount } = useSSE();
  const [events, setEvents] = useState<EventLog[]>([]);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [isMonitoring, setIsMonitoring] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<EventLog | null>(null);
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [connectionMetrics, setConnectionMetrics] = useState<ConnectionMetrics>({
    connectionAttempts: 0,
    successfulConnections: 0,
    reconnections: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    totalEventsReceived: 0,
    eventsPerMinute: 0,
    connectionUptime: 0,
    currentLatency: 0
  });
  const [isLoading, setIsLoading] = useState(false);

  // Track connection changes
  useEffect(() => {
    if (isConnected) {
      setConnectionMetrics(prev => ({
        ...prev,
        successfulConnections: prev.successfulConnections + 1,
        lastConnectedAt: new Date()
      }));
    } else if (connectionMetrics.lastConnectedAt) {
      setConnectionMetrics(prev => ({
        ...prev,
        lastDisconnectedAt: new Date(),
        reconnections: prev.reconnections + 1
      }));
    }
  }, [isConnected]);

  // Track events
  useEffect(() => {
    if (lastEvent && isMonitoring) {
      const newEvent: EventLog = {
        id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type: lastEvent.type,
        data: lastEvent.data,
        source: 'sse',
        status: 'received'
      };

      setEvents(prev => [newEvent, ...prev].slice(0, 100)); // Keep last 100 events
      setConnectionMetrics(prev => ({
        ...prev,
        totalEventsReceived: prev.totalEventsReceived + 1
      }));
    }
  }, [lastEvent, isMonitoring]);

  // Calculate events per minute
  useEffect(() => {
    const interval = setInterval(() => {
      const oneMinuteAgo = new Date(Date.now() - 60000);
      const recentEvents = events.filter(e => e.timestamp > oneMinuteAgo && e.source === 'sse').length;
      
      setConnectionMetrics(prev => ({
        ...prev,
        eventsPerMinute: recentEvents,
        connectionUptime: prev.lastConnectedAt 
          ? Math.floor((Date.now() - prev.lastConnectedAt.getTime()) / 1000)
          : 0
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, [events]);

  // Fetch debug info
  const fetchDebugInfo = async () => {
    try {
      const response = await api.get('/debug/sse/debug-info');
      setDebugInfo(response.data.data);
    } catch (error) {
      console.error('Failed to fetch debug info:', error);
      toast.error('Failed to fetch SSE debug info');
    }
  };

  // Initial fetch and periodic updates (fast for testing)
  useEffect(() => {
    fetchDebugInfo();
    const interval = setInterval(fetchDebugInfo, 3000); // 3 seconds for fast testing
    return () => clearInterval(interval);
  }, []);

  // Manual test triggers
  const triggerTestEvent = async (type: string) => {
    setIsLoading(true);
    try {
      const response = await api.post('/debug/sse/trigger-event', { 
        type,
        data: {
          test: true,
          triggeredAt: new Date().toISOString(),
          message: `Manual test event: ${type}`
        }
      });

      const logEvent: EventLog = {
        id: `manual-${Date.now()}`,
        timestamp: new Date(),
        type: `trigger:${type}`,
        data: response.data.data,
        source: 'manual',
        status: 'sent'
      };

      setEvents(prev => [logEvent, ...prev].slice(0, 100));
      toast.success(`Test event triggered: ${response.data.data.clientsNotified} clients notified`);
    } catch (error) {
      console.error('Failed to trigger test event:', error);
      toast.error('Failed to trigger test event');
    } finally {
      setIsLoading(false);
    }
  };

  const triggerFakeExecution = async () => {
    setIsLoading(true);
    try {
      const response = await api.post('/debug/sse/trigger-execution');
      
      const logEvent: EventLog = {
        id: `fake-exec-${Date.now()}`,
        timestamp: new Date(),
        type: 'trigger:fake-execution',
        data: response.data.data,
        source: 'manual',
        status: 'sent'
      };

      setEvents(prev => [logEvent, ...prev].slice(0, 100));
      toast.success(`Fake execution created: ${response.data.data.execution.id}`);
    } catch (error) {
      console.error('Failed to trigger fake execution:', error);
      toast.error('Failed to trigger fake execution');
    } finally {
      setIsLoading(false);
    }
  };

  const triggerBatch = async (count: number) => {
    setIsLoading(true);
    try {
      const response = await api.post('/debug/sse/trigger-batch', { count });
      
      const logEvent: EventLog = {
        id: `batch-${Date.now()}`,
        timestamp: new Date(),
        type: 'trigger:batch',
        data: response.data.data,
        source: 'manual',
        status: 'sent'
      };

      setEvents(prev => [logEvent, ...prev].slice(0, 100));
      toast.success(`Batch triggered: ${count} executions to ${response.data.data.clientsNotified} clients`);
    } catch (error) {
      console.error('Failed to trigger batch:', error);
      toast.error('Failed to trigger batch');
    } finally {
      setIsLoading(false);
    }
  };

  const testHealth = async () => {
    setIsLoading(true);
    try {
      const response = await api.post('/debug/sse/health-test');
      
      const logEvent: EventLog = {
        id: `health-${Date.now()}`,
        timestamp: new Date(),
        type: 'health:test',
        data: response.data.data,
        source: 'manual',
        status: response.data.data.success ? 'received' : 'error'
      };

      setEvents(prev => [logEvent, ...prev].slice(0, 100));
      
      if (response.data.data.success) {
        toast.success(response.data.data.message);
      } else {
        toast.error(response.data.data.message);
      }
    } catch (error) {
      console.error('Failed to test SSE health:', error);
      toast.error('Failed to test SSE health');
    } finally {
      setIsLoading(false);
    }
  };

  const clearEvents = () => {
    setEvents([]);
    setConnectionMetrics(prev => ({
      ...prev,
      totalEventsReceived: 0,
      eventsPerMinute: 0
    }));
  };

  // Filter events
  const filteredEvents = eventFilter === 'all' 
    ? events 
    : events.filter(e => e.type.includes(eventFilter));

  // Get connection status color
  const getConnectionColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-600 bg-green-100';
      case 'connecting': return 'text-yellow-600 bg-yellow-100';
      case 'disconnected': return 'text-gray-600 bg-gray-100';
      case 'error': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">SSE Debug Console</h1>
            <p className="mt-2 text-gray-600">
              Real-time Server-Sent Events monitoring and testing
            </p>
          </div>
          
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setIsMonitoring(!isMonitoring)}
              className={cn(
                'flex items-center px-4 py-2 rounded-lg transition-colors',
                isMonitoring 
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              )}
            >
              {isMonitoring ? <Play className="w-4 h-4 mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
              {isMonitoring ? 'Monitoring' : 'Paused'}
            </button>
            
            <button
              onClick={clearEvents}
              className="flex items-center px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear Events
            </button>
          </div>
        </div>

        {/* Connection Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Connection Status */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Connection Status</h3>
              <div className={cn('w-3 h-3 rounded-full animate-pulse', {
                'bg-green-500': isConnected,
                'bg-yellow-500': connectionStatus === 'connecting',
                'bg-red-500': connectionStatus === 'error',
                'bg-gray-400': !isConnected && connectionStatus === 'disconnected'
              })} />
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Status</span>
                <span className={cn('text-sm font-medium px-2 py-1 rounded', getConnectionColor())}>
                  {connectionStatus}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Connected Clients</span>
                <span className="text-sm font-medium">{clientCount || 0}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Uptime</span>
                <span className="text-sm font-medium">
                  {connectionMetrics.connectionUptime > 0 
                    ? `${Math.floor(connectionMetrics.connectionUptime / 60)}m ${connectionMetrics.connectionUptime % 60}s`
                    : 'Not connected'}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Reconnections</span>
                <span className="text-sm font-medium">{connectionMetrics.reconnections}</span>
              </div>
            </div>
          </div>

          {/* Event Metrics */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Event Metrics</h3>
              <Activity className="w-5 h-5 text-blue-600" />
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Total Events</span>
                <span className="text-sm font-medium">{connectionMetrics.totalEventsReceived}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Events/Minute</span>
                <span className="text-sm font-medium">{connectionMetrics.eventsPerMinute}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">In Buffer</span>
                <span className="text-sm font-medium">{events.length}</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Last Event</span>
                <span className="text-sm font-medium">
                  {events.length > 0 
                    ? new Date(events[0].timestamp).toLocaleTimeString()
                    : 'None'}
                </span>
              </div>
            </div>
          </div>

          {/* Debug Info */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Server Info</h3>
              <Server className="w-5 h-5 text-purple-600" />
            </div>
            
            {debugInfo && (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Debug Mode</span>
                  <span className="text-sm font-medium">
                    {debugInfo.debugMode ? 
                      <span className="text-green-600">Enabled</span> : 
                      <span className="text-gray-600">Disabled</span>
                    }
                  </span>
                </div>
                
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Monitoring</span>
                  <span className="text-sm font-medium">
                    {debugInfo.monitoring?.systemMonitoring ? 'Active' : 'Inactive'}
                  </span>
                </div>
                
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Polling</span>
                  <span className="text-sm font-medium">
                    {debugInfo.monitoring?.executionPolling ? 'Active' : 'Inactive'}
                  </span>
                </div>
                
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Environment</span>
                  <span className="text-sm font-medium">
                    {debugInfo.environment?.NODE_ENV || 'Unknown'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Manual Test Triggers */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Manual Test Triggers</h3>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button
              onClick={() => triggerTestEvent('test')}
              disabled={isLoading}
              className="flex items-center justify-center px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4 mr-2" />
              Test Event
            </button>
            
            <button
              onClick={() => triggerTestEvent('heartbeat')}
              disabled={isLoading}
              className="flex items-center justify-center px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
            >
              <Activity className="w-4 h-4 mr-2" />
              Heartbeat
            </button>
            
            <button
              onClick={triggerFakeExecution}
              disabled={isLoading}
              className="flex items-center justify-center px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors disabled:opacity-50"
            >
              <Zap className="w-4 h-4 mr-2" />
              Fake Execution
            </button>
            
            <button
              onClick={() => triggerBatch(5)}
              disabled={isLoading}
              className="flex items-center justify-center px-4 py-2 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors disabled:opacity-50"
            >
              <Database className="w-4 h-4 mr-2" />
              Batch (5)
            </button>
            
            <button
              onClick={() => triggerBatch(10)}
              disabled={isLoading}
              className="flex items-center justify-center px-4 py-2 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors disabled:opacity-50"
            >
              <Database className="w-4 h-4 mr-2" />
              Batch (10)
            </button>
            
            <button
              onClick={() => triggerTestEvent('system:stats')}
              disabled={isLoading}
              className="flex items-center justify-center px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors disabled:opacity-50"
            >
              <Monitor className="w-4 h-4 mr-2" />
              System Stats
            </button>
            
            <button
              onClick={() => triggerTestEvent('execution:error')}
              disabled={isLoading}
              className="flex items-center justify-center px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50"
            >
              <AlertCircle className="w-4 h-4 mr-2" />
              Error Event
            </button>
            
            <button
              onClick={testHealth}
              disabled={isLoading}
              className="flex items-center justify-center px-4 py-2 bg-teal-100 text-teal-700 rounded-lg hover:bg-teal-200 transition-colors disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Health Check
            </button>
          </div>
        </div>

        {/* Event Log */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Event Log</h3>
              
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-600">Filter:</label>
                <select
                  value={eventFilter}
                  onChange={(e) => setEventFilter(e.target.value)}
                  className="text-sm border border-gray-300 rounded px-2 py-1"
                >
                  <option value="all">All Events</option>
                  <option value="execution">Executions</option>
                  <option value="heartbeat">Heartbeats</option>
                  <option value="system">System</option>
                  <option value="test">Tests</option>
                  <option value="error">Errors</option>
                </select>
              </div>
            </div>
          </div>
          
          <div className="overflow-y-auto max-h-96">
            {filteredEvents.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Activity className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>No events received yet</p>
                <p className="text-sm mt-2">Trigger a test event or wait for real-time updates</p>
              </div>
            ) : (
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Time</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Source</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredEvents.map((event) => (
                    <tr
                      key={event.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedEvent(event)}
                    >
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {event.timestamp.toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2">
                        <span className={cn('text-xs font-medium px-2 py-1 rounded', {
                          'bg-blue-100 text-blue-700': event.type.includes('execution'),
                          'bg-green-100 text-green-700': event.type.includes('heartbeat'),
                          'bg-purple-100 text-purple-700': event.type.includes('system'),
                          'bg-red-100 text-red-700': event.type.includes('error'),
                          'bg-gray-100 text-gray-700': !event.type.match(/execution|heartbeat|system|error/)
                        })}>
                          {event.type}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={cn('text-xs px-2 py-1 rounded', {
                          'bg-blue-50 text-blue-600': event.source === 'sse',
                          'bg-orange-50 text-orange-600': event.source === 'manual',
                          'bg-gray-50 text-gray-600': event.source === 'system'
                        })}>
                          {event.source}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={cn('text-xs', {
                          'text-green-600': event.status === 'received',
                          'text-blue-600': event.status === 'sent',
                          'text-red-600': event.status === 'error'
                        })}>
                          {event.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500 truncate max-w-xs">
                        {JSON.stringify(event.data).substring(0, 50)}...
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Event Details Modal */}
        {selectedEvent && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-96 overflow-y-auto m-4">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Event Details</h3>
                  <button
                    onClick={() => setSelectedEvent(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Event ID</label>
                    <p className="text-sm text-gray-900 font-mono">{selectedEvent.id}</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Timestamp</label>
                    <p className="text-sm text-gray-900">
                      {selectedEvent.timestamp.toLocaleString()}
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <p className="text-sm text-gray-900">{selectedEvent.type}</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
                    <p className="text-sm text-gray-900">{selectedEvent.source}</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data</label>
                    <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">
                      {JSON.stringify(selectedEvent.data, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}