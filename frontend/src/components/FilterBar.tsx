import { useState, useCallback } from 'react';
import { ExecutionFilters } from '@/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { 
  Filter, 
  X, 
  Search, 
  MapPin, 
  Flame,
  AlertTriangle,
  Users,
  ChevronDown,
  RotateCcw
} from 'lucide-react';
import { cn } from '@/utils';

interface FilterBarProps {
  filters: ExecutionFilters;
  onFiltersChange: (filters: ExecutionFilters) => void;
  onReset: () => void;
  isLoading?: boolean;
  className?: string;
}

interface FilterSection {
  id: string;
  label: string;
  icon: React.ReactNode;
  expanded: boolean;
}

export function FilterBar({ 
  filters, 
  onFiltersChange, 
  onReset, 
  isLoading = false,
  className 
}: FilterBarProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['basic']));
  const [searchTerm, setSearchTerm] = useState(filters.search || '');

  const handleFilterChange = useCallback((key: keyof ExecutionFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value, page: 0 });
  }, [filters, onFiltersChange]);

  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    handleFilterChange('search', searchTerm);
  }, [searchTerm, handleFilterChange]);

  const clearFilter = useCallback((key: keyof ExecutionFilters) => {
    const newFilters = { ...filters };
    delete newFilters[key];
    onFiltersChange({ ...newFilters, page: 0 });
  }, [filters, onFiltersChange]);

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  }, []);

  const getActiveFilterCount = useCallback(() => {
    const excludeKeys = ['page', 'limit', 'sortBy', 'sortOrder'];
    return Object.entries(filters).filter(([key, value]) => 
      !excludeKeys.includes(key) && 
      value !== undefined && 
      value !== '' &&
      value !== null
    ).length;
  }, [filters]);

  const renderFilterSection = (section: FilterSection, content: React.ReactNode) => (
    <div key={section.id} className="border border-gray-200 rounded-lg">
      <button
        onClick={() => toggleSection(section.id)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {section.icon}
          <span className="font-medium">{section.label}</span>
        </div>
        <ChevronDown 
          className={cn(
            "h-4 w-4 transition-transform",
            expandedSections.has(section.id) ? "rotate-180" : ""
          )} 
        />
      </button>
      {expandedSections.has(section.id) && (
        <div className="p-3 border-t border-gray-200 bg-gray-50">
          {content}
        </div>
      )}
    </div>
  );

  const activeFilterCount = getActiveFilterCount();

  return (
    <div className={cn("bg-white border border-gray-200 rounded-lg shadow-sm", className)}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-gray-500" />
            <h3 className="font-semibold text-gray-900">Filters</h3>
            {activeFilterCount > 0 && (
              <Badge variant="secondary">{activeFilterCount}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onReset}
              className="text-gray-600"
              disabled={activeFilterCount === 0}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="p-4 border-b border-gray-200">
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search executions, analysis text, or expert notes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              disabled={isLoading}
            />
          </div>
          <Button type="submit" size="sm" disabled={isLoading}>
            Search
          </Button>
        </form>
        {filters.search && (
          <div className="mt-2">
            <Badge variant="outline" className="gap-1">
              Search: "{filters.search}"
              <button onClick={() => clearFilter('search')}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </div>
        )}
      </div>

      {/* Filter Sections */}
      <div className="p-4 space-y-4">
        {/* Basic Filters */}
        {renderFilterSection(
          { 
            id: 'basic', 
            label: 'Basic Filters', 
            icon: <Filter className="h-4 w-4" />,
            expanded: expandedSections.has('basic')
          },
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <Select value={filters.status || ''} onValueChange={(value) => handleFilterChange('status', value || undefined)}>
                <SelectTrigger>
                  <SelectValue placeholder="Any status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All statuses</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="waiting">Waiting</SelectItem>
                  <SelectItem value="canceled">Canceled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Has Image</label>
              <Select 
                value={filters.hasImage !== undefined ? filters.hasImage.toString() : ''} 
                onValueChange={(value) => handleFilterChange('hasImage', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All executions</SelectItem>
                  <SelectItem value="true">With images</SelectItem>
                  <SelectItem value="false">Without images</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telegram Delivered</label>
              <Select 
                value={filters.telegramSent !== undefined ? filters.telegramSent.toString() : ''} 
                onValueChange={(value) => handleFilterChange('telegramSent', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All executions</SelectItem>
                  <SelectItem value="true">Delivered</SelectItem>
                  <SelectItem value="false">Not delivered</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Risk Assessment Filters */}
        {renderFilterSection(
          { 
            id: 'risk', 
            label: 'Risk Assessment', 
            icon: <AlertTriangle className="h-4 w-4" />,
            expanded: expandedSections.has('risk')
          },
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">AI Risk Level</label>
              <Select value={filters.riskLevel || ''} onValueChange={(value) => handleFilterChange('riskLevel', value || undefined)}>
                <SelectTrigger>
                  <SelectValue placeholder="Any risk level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All levels</SelectItem>
                  <SelectItem value="high">High Risk</SelectItem>
                  <SelectItem value="medium">Medium Risk</SelectItem>
                  <SelectItem value="low">Low Risk</SelectItem>
                  <SelectItem value="none">No Risk</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Alert Priority</label>
              <Select value={filters.alertPriority || ''} onValueChange={(value) => handleFilterChange('alertPriority', value || undefined)}>
                <SelectTrigger>
                  <SelectValue placeholder="Any priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All priorities</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Response Required</label>
              <Select 
                value={filters.responseRequired !== undefined ? filters.responseRequired.toString() : ''} 
                onValueChange={(value) => handleFilterChange('responseRequired', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All executions</SelectItem>
                  <SelectItem value="true">Response required</SelectItem>
                  <SelectItem value="false">No response needed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Detection Filters */}
        {renderFilterSection(
          { 
            id: 'detection', 
            label: 'Fire Detection', 
            icon: <Flame className="h-4 w-4" />,
            expanded: expandedSections.has('detection')
          },
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Smoke Detected</label>
              <Select 
                value={filters.smokeDetected !== undefined ? filters.smokeDetected.toString() : ''} 
                onValueChange={(value) => handleFilterChange('smokeDetected', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="true">Detected</SelectItem>
                  <SelectItem value="false">Not detected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Flame Detected</label>
              <Select 
                value={filters.flameDetected !== undefined ? filters.flameDetected.toString() : ''} 
                onValueChange={(value) => handleFilterChange('flameDetected', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="true">Detected</SelectItem>
                  <SelectItem value="false">Not detected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Heat Signature</label>
              <Select 
                value={filters.heatSignatureDetected !== undefined ? filters.heatSignatureDetected.toString() : ''} 
                onValueChange={(value) => handleFilterChange('heatSignatureDetected', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="true">Detected</SelectItem>
                  <SelectItem value="false">Not detected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Motion Detected</label>
              <Select 
                value={filters.motionDetected !== undefined ? filters.motionDetected.toString() : ''} 
                onValueChange={(value) => handleFilterChange('motionDetected', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="true">Detected</SelectItem>
                  <SelectItem value="false">Not detected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Device & Location Filters */}
        {renderFilterSection(
          { 
            id: 'location', 
            label: 'Device & Location', 
            icon: <MapPin className="h-4 w-4" />,
            expanded: expandedSections.has('location')
          },
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Camera ID</label>
              <Input
                type="text"
                placeholder="Enter camera ID"
                value={filters.cameraId || ''}
                onChange={(e) => handleFilterChange('cameraId', e.target.value || undefined)}
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Camera Location</label>
              <Input
                type="text"
                placeholder="Enter location"
                value={filters.cameraLocation || ''}
                onChange={(e) => handleFilterChange('cameraLocation', e.target.value || undefined)}
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fire Zone Risk</label>
              <Input
                type="text"
                placeholder="Enter fire zone"
                value={filters.fireZoneRisk || ''}
                onChange={(e) => handleFilterChange('fireZoneRisk', e.target.value || undefined)}
                disabled={isLoading}
              />
            </div>
          </div>
        )}

        {/* Expert Review Filters */}
        {renderFilterSection(
          { 
            id: 'expert', 
            label: 'Expert Review', 
            icon: <Users className="h-4 w-4" />,
            expanded: expandedSections.has('expert')
          },
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Review Status</label>
              <Select value={filters.expertReviewStatus || ''} onValueChange={(value) => handleFilterChange('expertReviewStatus', value || undefined)}>
                <SelectTrigger>
                  <SelectValue placeholder="Any status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in_review">In Review</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="disputed">Disputed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expert Risk Assessment</label>
              <Select value={filters.expertRiskAssessment || ''} onValueChange={(value) => handleFilterChange('expertRiskAssessment', value || undefined)}>
                <SelectTrigger>
                  <SelectValue placeholder="Any assessment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All assessments</SelectItem>
                  <SelectItem value="high">Expert: High Risk</SelectItem>
                  <SelectItem value="medium">Expert: Medium Risk</SelectItem>
                  <SelectItem value="low">Expert: Low Risk</SelectItem>
                  <SelectItem value="none">Expert: No Risk</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Training Data</label>
              <Select 
                value={filters.useForTraining !== undefined ? filters.useForTraining.toString() : ''} 
                onValueChange={(value) => handleFilterChange('useForTraining', value === '' ? undefined : value === 'true')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All executions</SelectItem>
                  <SelectItem value="true">Used for training</SelectItem>
                  <SelectItem value="false">Not for training</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {/* Active Filters Summary */}
      {activeFilterCount > 0 && (
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex flex-wrap gap-2">
            {Object.entries(filters).map(([key, value]) => {
              if (key === 'page' || key === 'limit' || value === undefined || value === '' || value === null) {
                return null;
              }
              
              const filterKey = key as keyof ExecutionFilters;
              return (
                <Badge key={key} variant="outline" className="gap-1">
                  {key}: {String(value)}
                  <button onClick={() => clearFilter(filterKey)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}