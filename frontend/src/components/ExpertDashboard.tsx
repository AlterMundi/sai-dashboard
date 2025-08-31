import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { 
  ExpertAssignment, 
  ExpertSystemStats, 
  ExpertTags, 
  IncidentAnalysis,
  ApiResponse 
} from '@/types';
import { 
  Clock, 
  User, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Camera,
  MapPin,
  Calendar,
  TrendingUp,
  Users,
  Target,
  Activity,
  MapIcon
} from 'lucide-react';
import { cn } from '@/utils';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface ExpertDashboardProps {
  className?: string;
}

export function ExpertDashboard({ className }: ExpertDashboardProps) {
  const [selectedTab, setSelectedTab] = useState<'assignments' | 'stats' | 'incidents'>('assignments');

  // Fetch expert assignments
  const { 
    data: assignments, 
    isLoading: assignmentsLoading,
    error: assignmentsError,
    refetch: refetchAssignments
  } = useQuery({
    queryKey: ['expert-assignments'],
    queryFn: async (): Promise<ExpertAssignment[]> => {
      const token = localStorage.getItem('auth-token');
      const response = await axios.get<ApiResponse<ExpertAssignment[]>>(
        `${API_BASE}/expert/assignments`,
        { headers: { Authorization: `Bearer ${token}` }}
      );
      return response.data.data;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch system statistics
  const {
    data: systemStats,
    isLoading: statsLoading,
    error: statsError
  } = useQuery({
    queryKey: ['expert-system-stats'],
    queryFn: async (): Promise<ExpertSystemStats> => {
      const token = localStorage.getItem('auth-token');
      const response = await axios.get<ApiResponse<ExpertSystemStats>>(
        `${API_BASE}/expert/system/stats`,
        { headers: { Authorization: `Bearer ${token}` }}
      );
      return response.data.data;
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch expert tags
  const { data: _expertTags } = useQuery({
    queryKey: ['expert-tags'],
    queryFn: async (): Promise<ExpertTags> => {
      const token = localStorage.getItem('auth-token');
      const response = await axios.get<ApiResponse<ExpertTags>>(
        `${API_BASE}/expert/tags`,
        { headers: { Authorization: `Bearer ${token}` }}
      );
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch incident analysis
  const {
    data: incidents,
    isLoading: incidentsLoading
  } = useQuery({
    queryKey: ['incidents'],
    queryFn: async (): Promise<IncidentAnalysis[]> => {
      const token = localStorage.getItem('auth-token');
      const response = await axios.get<ApiResponse<IncidentAnalysis[]>>(
        `${API_BASE}/incidents`,
        { headers: { Authorization: `Bearer ${token}` }}
      );
      return response.data.data;
    },
    refetchInterval: 45000, // Refresh every 45 seconds
  });

  const getDeadlineStatusColor = (status: string) => {
    switch (status) {
      case 'OVERDUE': return 'destructive';
      case 'URGENT': return 'warning';
      case 'ON_TIME': return 'success';
      default: return 'secondary';
    }
  };

  const getRiskLevelColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'high': return 'destructive';
      case 'medium': return 'warning';
      case 'low': return 'secondary';
      case 'none': return 'outline';
      default: return 'secondary';
    }
  };

  const getPriorityIcon = (priority: number) => {
    if (priority === 1) return <AlertTriangle className="h-4 w-4 text-red-500" />;
    if (priority === 2) return <Clock className="h-4 w-4 text-orange-500" />;
    return <Activity className="h-4 w-4 text-blue-500" />;
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
  };

  const renderAssignments = () => {
    if (assignmentsLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
          <span className="ml-2 text-gray-600">Loading assignments...</span>
        </div>
      );
    }

    if (assignmentsError || !assignments) {
      return (
        <div className="text-center py-8">
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to Load Assignments</h3>
          <p className="text-gray-500 mb-4">Unable to fetch expert assignments</p>
          <Button onClick={() => refetchAssignments()}>Try Again</Button>
        </div>
      );
    }

    if (assignments.length === 0) {
      return (
        <div className="text-center py-8">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Pending Assignments</h3>
          <p className="text-gray-500">All expert reviews are up to date!</p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {assignments.map((assignment) => (
          <div key={assignment.executionId} className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                {getPriorityIcon(assignment.expertReviewPriority)}
                <Badge variant={getDeadlineStatusColor(assignment.deadlineStatus)}>
                  {assignment.deadlineStatus}
                </Badge>
                <Badge variant={getRiskLevelColor(assignment.aiAssessment)}>
                  AI: {assignment.aiAssessment}
                </Badge>
              </div>
              <span className="text-sm text-gray-500">#{assignment.executionId}</span>
            </div>

            <div className="space-y-3">
              {assignment.cameraId && (
                <div className="flex items-center gap-2 text-sm">
                  <Camera className="h-4 w-4 text-gray-400" />
                  <span className="font-medium">{assignment.cameraId}</span>
                  {assignment.cameraLocation && (
                    <>
                      <MapPin className="h-4 w-4 text-gray-400 ml-2" />
                      <span className="text-gray-600">{assignment.cameraLocation}</span>
                    </>
                  )}
                </div>
              )}

              {assignment.detectionTimestamp && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span>Detected {formatTimeAgo(assignment.detectionTimestamp)}</span>
                </div>
              )}

              {assignment.aiConfidence && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Target className="h-4 w-4 text-gray-400" />
                  <span>AI Confidence: {(assignment.aiConfidence * 100).toFixed(1)}%</span>
                </div>
              )}

              {assignment.ollamaAnalysisText && (
                <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded-md">
                  <p className="line-clamp-3">{assignment.ollamaAnalysisText}</p>
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs">
                  {assignment.expertReviewStatus}
                </Badge>
                {assignment.expertReviewDeadline && (
                  <span className="text-xs text-gray-500">
                    Due {formatTimeAgo(assignment.expertReviewDeadline)}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderStats = () => {
    if (statsLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
          <span className="ml-2 text-gray-600">Loading statistics...</span>
        </div>
      );
    }

    if (statsError || !systemStats) {
      return (
        <div className="text-center py-8">
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to Load Statistics</h3>
          <p className="text-gray-500">Unable to fetch system statistics</p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Pending Reviews</p>
              <p className="text-2xl font-semibold text-gray-900">{systemStats.totalPendingReviews}</p>
            </div>
            <Clock className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Review Time</p>
              <p className="text-2xl font-semibold text-gray-900">
                {systemStats.averageReviewTime > 0 
                  ? `${systemStats.averageReviewTime}m` 
                  : 'N/A'
                }
              </p>
            </div>
            <TrendingUp className="h-8 w-8 text-green-500" />
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Expert Agreement</p>
              <p className="text-2xl font-semibold text-gray-900">
                {systemStats.expertAgreementRate > 0 
                  ? `${(systemStats.expertAgreementRate * 100).toFixed(1)}%` 
                  : 'N/A'
                }
              </p>
            </div>
            <Users className="h-8 w-8 text-purple-500" />
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">AI Accuracy</p>
              <p className="text-2xl font-semibold text-gray-900">
                {systemStats.qualityScores.aiAccuracy > 0 
                  ? `${(systemStats.qualityScores.aiAccuracy * 100).toFixed(1)}%` 
                  : 'N/A'
                }
              </p>
            </div>
            <Target className="h-8 w-8 text-orange-500" />
          </div>
        </div>
      </div>
    );
  };

  const renderIncidents = () => {
    if (incidentsLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
          <span className="ml-2 text-gray-600">Loading incidents...</span>
        </div>
      );
    }

    if (!incidents || incidents.length === 0) {
      return (
        <div className="text-center py-8">
          <MapIcon className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Active Incidents</h3>
          <p className="text-gray-500">No multi-camera incidents detected in the last 24 hours</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {incidents.map((incident) => (
          <div key={incident.incidentId} className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <Badge variant={getRiskLevelColor(incident.maxRiskLevel)} className="text-sm">
                  {incident.maxRiskLevel.toUpperCase()} RISK
                </Badge>
                <span className="text-lg font-semibold text-gray-900">
                  Incident #{incident.incidentId.slice(-8)}
                </span>
              </div>
              {incident.responseRequired && (
                <Badge variant="destructive">Response Required</Badge>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center">
                <p className="text-2xl font-semibold text-gray-900">{incident.totalDetections}</p>
                <p className="text-sm text-gray-600">Total Detections</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-semibold text-gray-900">{incident.camerasInvolved}</p>
                <p className="text-sm text-gray-600">Cameras</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-semibold text-gray-900">{incident.expertReviewed}</p>
                <p className="text-sm text-gray-600">Expert Reviewed</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-semibold text-gray-900">
                  {formatTimeAgo(incident.incidentStart)}
                </p>
                <p className="text-sm text-gray-600">Started</p>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Involved Cameras:</p>
              <div className="flex flex-wrap gap-2">
                {incident.cameraList.map((cameraId) => (
                  <Badge key={cameraId} variant="outline" className="text-xs">
                    {cameraId}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={cn("bg-gray-50 min-h-screen", className)}>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Expert Review Dashboard</h1>
          <p className="text-gray-600">Monitor and manage fire detection expert reviews</p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-8">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {[
                { id: 'assignments', label: 'Assignments', icon: User },
                { id: 'stats', label: 'Statistics', icon: TrendingUp },
                { id: 'incidents', label: 'Incidents', icon: MapIcon }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedTab(tab.id as any)}
                  className={cn(
                    "flex items-center gap-2 py-2 px-1 border-b-2 font-medium text-sm transition-colors",
                    selectedTab === tab.id
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  )}
                >
                  <tab.icon className="h-5 w-5" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="space-y-8">
          {selectedTab === 'assignments' && renderAssignments()}
          {selectedTab === 'stats' && renderStats()}
          {selectedTab === 'incidents' && renderIncidents()}
        </div>
      </div>
    </div>
  );
}