import { useState, useRef, useEffect } from 'react';
import { Download, FileJson, FileSpreadsheet, ChevronDown, BarChart3, Loader2 } from 'lucide-react';
import { ExecutionFilters } from '@/types';
import { executionsApi } from '@/services/api';
import { exportToCSV, exportToJSON, exportSummary } from '@/utils';
import { cn } from '@/utils';
import toast from 'react-hot-toast';

interface ExportDropdownProps {
  filters: ExecutionFilters;
  totalResults: number;
  disabled?: boolean;
  className?: string;
}

export function ExportDropdown({ filters, totalResults, disabled, className }: ExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = async (type: 'csv' | 'json' | 'summary') => {
    if (totalResults === 0) {
      toast.error('No data to export');
      return;
    }

    setIsExporting(true);
    const toastId = toast.loading(`Fetching ${totalResults.toLocaleString()} executions…`);

    try {
      const response = await executionsApi.getExecutions({
        ...filters,
        page: 1,
        limit: totalResults,
      });

      const executions = response.executions;
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `sai-executions-${timestamp}`;

      switch (type) {
        case 'csv':
          exportToCSV(executions, filename);
          toast.success(`Exported ${executions.length} executions to CSV`, { id: toastId });
          break;
        case 'json':
          exportToJSON(executions, filename);
          toast.success(`Exported ${executions.length} executions to JSON`, { id: toastId });
          break;
        case 'summary':
          exportSummary(executions, `${filename}-summary`);
          toast.success('Exported summary report', { id: toastId });
          break;
      }
    } catch (error) {
      toast.error('Export failed', { id: toastId });
      console.error('Export error:', error);
    } finally {
      setIsExporting(false);
      setIsOpen(false);
    }
  };

  const exportOptions = [
    {
      id: 'csv',
      label: 'Export as CSV',
      description: 'Spreadsheet-compatible format',
      icon: FileSpreadsheet,
      action: () => handleExport('csv'),
    },
    {
      id: 'json',
      label: 'Export as JSON',
      description: 'Full data with detections',
      icon: FileJson,
      action: () => handleExport('json'),
    },
    {
      id: 'summary',
      label: 'Export Summary',
      description: 'Statistics and breakdown',
      icon: BarChart3,
      action: () => handleExport('summary'),
    },
  ];

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || totalResults === 0 || isExporting}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
          'border border-gray-300 bg-white hover:bg-gray-50',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
        title={totalResults === 0 ? 'No data to export' : `Export ${totalResults.toLocaleString()} executions`}
      >
        {isExporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">Export</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-500 uppercase">
              {totalResults.toLocaleString()} execution{totalResults !== 1 ? 's' : ''} total
            </p>
          </div>

          {exportOptions.map((option) => (
            <button
              key={option.id}
              onClick={option.action}
              disabled={isExporting}
              className="w-full flex items-start gap-3 px-3 py-2 hover:bg-gray-50 transition-colors text-left disabled:opacity-50"
            >
              <option.icon className="h-5 w-5 text-gray-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-900">{option.label}</p>
                <p className="text-xs text-gray-500">{option.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
