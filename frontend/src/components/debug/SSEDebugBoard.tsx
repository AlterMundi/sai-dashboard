import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSSE } from '@/contexts/SSEContext';
import { tokenManager, sseApi } from '@/services/api';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, RefreshCw, Eye, EyeOff, Bug, Wifi, WifiOff, Copy, Check } from 'lucide-react';

interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  details?: any;
}

interface ConnectionTest {
  name: string;
  status: 'pending' | 'success' | 'error';
  result?: string;
  error?: string;
  duration?: number;
}

export function SSEDebugBoard() {
  const { isConnected, connectionStatus, lastEvent, clientCount, connect } = useSSE();
  const [isExpanded, setIsExpanded] = useState(true);
  const [showRawEventSource, setShowRawEventSource] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connectionTests, setConnectionTests] = useState<ConnectionTest[]>([]);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [copied, setCopied] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);

  const addLog = (level: LogEntry['level'], message: string, details?: any) => {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      details
    };
    setLogs(prev => [...prev.slice(-49), entry]); // Keep last 50 logs
  };

  const currentConfig = {
    baseUrl: import.meta.env.VITE_API_URL || '/api',
    basePath: import.meta.env.VITE_BASE_PATH || '/',
    hasToken: !!tokenManager.get(),
    windowOrigin: window.location.origin,
    fullSSEUrl: (() => {
      try {
        const baseUrl = import.meta.env.VITE_API_URL || '/api';
        return new URL(`${baseUrl}/events`, window.location.origin).toString();
      } catch {
        return 'Invalid URL';
      }
    })()
  };

  const copyDebugInfo = () => {
    const debugInfo = `
🐛 SAI Dashboard SSE Debug Report
Generated: ${new Date().toISOString()}

📊 Current Status:
• Connection: ${isConnected ? 'Connected' : 'Disconnected'}
• Status: ${connectionStatus}
• Clients: ${clientCount}
• Last Event: ${lastEvent ? `${lastEvent.type} at ${lastEvent.timestamp.toLocaleTimeString()}` : 'None'}

🔧 Configuration:
• VITE_API_URL: ${currentConfig.baseUrl}
• VITE_BASE_PATH: ${currentConfig.basePath}
• Window Origin: ${currentConfig.windowOrigin}
• Has Token: ${currentConfig.hasToken ? 'Yes' : 'No'}
• Full SSE URL: ${currentConfig.fullSSEUrl}

🧪 Connection Tests:
${connectionTests.map(test => 
  `• ${getTestStatusIcon(test.status)} ${test.name}: ${test.result || test.error || 'Pending'}`
).join('\n')}

📝 Recent Logs (last 10):
${logs.slice(-10).map(log => 
  `[${log.timestamp.toLocaleTimeString()}] ${log.level.toUpperCase()}: ${log.message}`
).join('\n')}

🌐 Browser Info:
• User Agent: ${navigator.userAgent}
• URL: ${window.location.href}
• Timestamp: ${new Date().toLocaleString()}
    `.trim();

    navigator.clipboard.writeText(debugInfo).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy debug info:', err);
    });
  };


  const runConnectionTests = async () => {
    setIsRunningTests(true);
    const tests: ConnectionTest[] = [
      { name: 'Token Validation', status: 'pending' },
      { name: 'Base URL Resolution', status: 'pending' },
      { name: 'EventSource Creation', status: 'pending' },
      { name: 'Direct cURL Test', status: 'pending' },
      { name: 'SSE Endpoint Reachability', status: 'pending' },
    ];
    setConnectionTests([...tests]);

    // Test 1: Token Validation
    try {
      const token = tokenManager.get();
      if (!token) {
        tests[0].status = 'error';
        tests[0].error = 'No token found in storage';
      } else {
        tests[0].status = 'success';
        tests[0].result = `Token present: ${token.substring(0, 20)}...`;
      }
    } catch (error) {
      tests[0].status = 'error';
      tests[0].error = error instanceof Error ? error.message : 'Unknown error';
    }
    setConnectionTests([...tests]);

    // Test 2: Base URL Resolution  
    try {
      const baseUrl = import.meta.env.VITE_API_URL || '/api';
      const fullUrl = new URL(`${baseUrl}/events`, window.location.origin);
      tests[1].status = 'success';
      tests[1].result = fullUrl.toString();
    } catch (error) {
      tests[1].status = 'error';
      tests[1].error = error instanceof Error ? error.message : 'URL construction failed';
    }
    setConnectionTests([...tests]);

    // Test 3: EventSource Creation
    try {
      const eventSource = sseApi.createEventSource();
      const readyState = eventSource.readyState;
      // Immediately close test connection to avoid interference
      eventSource.close();
      
      tests[2].status = 'success';
      tests[2].result = `ReadyState: ${readyState} (${
        readyState === 0 ? 'CONNECTING' :
        readyState === 1 ? 'OPEN' :
        readyState === 2 ? 'CLOSED' : 'UNKNOWN'
      })`;
    } catch (error) {
      tests[2].status = 'error';
      tests[2].error = error instanceof Error ? error.message : 'EventSource creation failed';
    }
    setConnectionTests([...tests]);

    // Test 4: Direct fetch test (simulating cURL)
    try {
      const startTime = performance.now();
      const token = tokenManager.get();
      const baseUrl = import.meta.env.VITE_API_URL || '/api';
      const response = await fetch(`${baseUrl}/events`, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache'
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      
      const duration = performance.now() - startTime;
      tests[3].duration = duration;
      
      if (response.ok) {
        tests[3].status = 'success';
        tests[3].result = `HTTP ${response.status} - ${response.statusText} (${duration.toFixed(0)}ms)`;
      } else {
        tests[3].status = 'error';
        tests[3].error = `HTTP ${response.status} - ${response.statusText}`;
      }
    } catch (error) {
      tests[3].status = 'error';
      tests[3].error = error instanceof Error ? error.message : 'Fetch failed';
    }
    setConnectionTests([...tests]);

    // Test 5: SSE Status Endpoint
    try {
      const status = await sseApi.getStatus();
      tests[4].status = 'success';
      tests[4].result = `Active connections: ${status.clients || 0} / ${status.maxClients || 100}`;
    } catch (error) {
      tests[4].status = 'error';
      tests[4].error = error instanceof Error ? error.message : 'SSE status unavailable';
    }
    setConnectionTests([...tests]);

    setIsRunningTests(false);
  };

  // Log SSE state changes
  useEffect(() => {
    addLog('info', `Connection status changed: ${connectionStatus}`, {
      isConnected,
      clientCount,
      timestamp: new Date().toISOString()
    });
  }, [connectionStatus, isConnected, clientCount]);

  // Log events
  useEffect(() => {
    if (lastEvent) {
      addLog('debug', `SSE event received: ${lastEvent.type}`, lastEvent);
    }
  }, [lastEvent]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500 animate-pulse';
      case 'disconnected': return 'bg-red-500';
      case 'error': return 'bg-red-600';
      default: return 'bg-gray-500';
    }
  };

  const getTestStatusIcon = (status: ConnectionTest['status']) => {
    switch (status) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'pending': return '⏳';
      default: return '❔';
    }
  };

  return (
    <Card className="w-full bg-slate-900 text-white border-slate-700">
      <CollapsibleTrigger asChild>
        <CardHeader 
          className="cursor-pointer hover:bg-slate-800 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Bug className="h-5 w-5" />
              <span>SSE Debug Board</span>
              {isConnected ? <Wifi className="h-4 w-4 text-green-500" /> : <WifiOff className="h-4 w-4 text-red-500" />}
            </div>
            <div className="flex items-center space-x-2">
              <Button
                onClick={copyDebugInfo}
                size="sm"
                variant="outline"
                className="border-slate-600 text-slate-300 hover:text-white"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 mr-1" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3 mr-1" />
                    Copy Info
                  </>
                )}
              </Button>
              <Badge 
                variant="outline" 
                className={`${getStatusColor(connectionStatus)} text-white border-0`}
              >
                {connectionStatus}
              </Badge>
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </div>
          </CardTitle>
        </CardHeader>
      </CollapsibleTrigger>

      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleContent>
          <CardContent className="space-y-6">
            {/* Current Status */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-800 p-3 rounded-lg">
                <div className="text-sm text-slate-400">Connection</div>
                <div className={`text-lg font-bold ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                  {isConnected ? 'Connected' : 'Disconnected'}
                </div>
              </div>
              <div className="bg-slate-800 p-3 rounded-lg">
                <div className="text-sm text-slate-400">Status</div>
                <div className="text-lg font-bold text-white">{connectionStatus}</div>
              </div>
              <div className="bg-slate-800 p-3 rounded-lg">
                <div className="text-sm text-slate-400">Clients</div>
                <div className="text-lg font-bold text-blue-400">{clientCount}</div>
              </div>
              <div className="bg-slate-800 p-3 rounded-lg">
                <div className="text-sm text-slate-400">Last Event</div>
                <div className="text-sm text-white truncate">
                  {lastEvent ? `${lastEvent.type} (${lastEvent.timestamp.toLocaleTimeString()})` : 'None'}
                </div>
              </div>
            </div>

            {/* Configuration Details */}
            <div className="bg-slate-800 p-4 rounded-lg">
              <h4 className="text-lg font-semibold mb-3">Configuration</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm font-mono">
                <div>
                  <span className="text-slate-400">VITE_API_URL:</span>
                  <span className="text-green-400 ml-2">{currentConfig.baseUrl}</span>
                </div>
                <div>
                  <span className="text-slate-400">VITE_BASE_PATH:</span>
                  <span className="text-green-400 ml-2">{currentConfig.basePath}</span>
                </div>
                <div>
                  <span className="text-slate-400">Window Origin:</span>
                  <span className="text-green-400 ml-2">{currentConfig.windowOrigin}</span>
                </div>
                <div>
                  <span className="text-slate-400">Has Token:</span>
                  <span className={`ml-2 ${currentConfig.hasToken ? 'text-green-400' : 'text-red-400'}`}>
                    {currentConfig.hasToken ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="md:col-span-2">
                  <span className="text-slate-400">Full SSE URL:</span>
                  <span className="text-blue-400 ml-2 break-all">{currentConfig.fullSSEUrl}</span>
                </div>
              </div>
            </div>

            {/* Connection Tests */}
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-lg font-semibold">Connection Tests</h4>
                <Button 
                  onClick={runConnectionTests} 
                  disabled={isRunningTests}
                  size="sm"
                  variant="outline"
                  className="border-slate-600"
                >
                  {isRunningTests ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Running...
                    </>
                  ) : (
                    'Run Tests'
                  )}
                </Button>
              </div>
              {connectionTests.length > 0 && (
                <div className="space-y-2">
                  {connectionTests.map((test, index) => (
                    <div key={index} className="flex items-center justify-between bg-slate-700 p-3 rounded">
                      <div className="flex items-center space-x-3">
                        <span className="text-lg">{getTestStatusIcon(test.status)}</span>
                        <span className="font-medium">{test.name}</span>
                      </div>
                      <div className="text-sm text-right">
                        {test.result && <div className="text-green-400">{test.result}</div>}
                        {test.error && <div className="text-red-400">{test.error}</div>}
                        {test.duration && <div className="text-slate-400">{test.duration.toFixed(0)}ms</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Raw EventSource Debug */}
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-lg font-semibold">Raw EventSource Debug</h4>
                <Button
                  onClick={() => setShowRawEventSource(!showRawEventSource)}
                  size="sm"
                  variant="outline"
                  className="border-slate-600"
                >
                  {showRawEventSource ? (
                    <>
                      <EyeOff className="h-4 w-4 mr-2" />
                      Hide
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-2" />
                      Show
                    </>
                  )}
                </Button>
              </div>
              {showRawEventSource && (
                <div className="bg-black p-3 rounded font-mono text-sm overflow-x-auto">
                  <pre className="whitespace-pre-wrap text-green-400">
{`// Current EventSource URL:
${currentConfig.fullSSEUrl}

// Test connection manually:
const es = new EventSource('${currentConfig.fullSSEUrl}');
es.onopen = () => console.log('✅ Connected');
es.onerror = (e) => console.error('❌ Error:', e);
es.onmessage = (e) => console.log('📨 Message:', e.data);

// Current readyState: Check browser console for live EventSource state`}
                  </pre>
                </div>
              )}
            </div>

            {/* Live Logs */}
            <div className="bg-slate-800 p-4 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-lg font-semibold">Live Debug Logs</h4>
                <div className="flex space-x-2">
                  <Button
                    onClick={() => setLogs([])}
                    size="sm"
                    variant="outline"
                    className="border-slate-600"
                  >
                    Clear
                  </Button>
                  <Button
                    onClick={connect}
                    size="sm"
                    variant="outline"
                    className="border-slate-600"
                  >
                    Reconnect
                  </Button>
                </div>
              </div>
              <div 
                ref={logsRef}
                className="bg-black p-3 rounded font-mono text-xs h-64 overflow-y-auto"
              >
                {logs.length === 0 ? (
                  <div className="text-slate-400">No logs yet...</div>
                ) : (
                  logs.map((log, index) => (
                    <div key={index} className={`mb-1 ${
                      log.level === 'error' ? 'text-red-400' :
                      log.level === 'warn' ? 'text-yellow-400' :
                      log.level === 'info' ? 'text-blue-400' :
                      'text-green-400'
                    }`}>
                      <span className="text-slate-500">
                        [{log.timestamp.toLocaleTimeString()}]
                      </span>
                      <span className="ml-2 text-white">
                        [{log.level.toUpperCase()}]
                      </span>
                      <span className="ml-2">{log.message}</span>
                      {log.details && (
                        <pre className="ml-8 text-slate-300 text-xs">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}