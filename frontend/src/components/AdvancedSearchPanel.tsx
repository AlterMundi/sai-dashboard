import { useState, useCallback } from 'react';
import { cn } from '@/utils';
import {
  Search,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import toast from 'react-hot-toast';

// Types matching backend DetectionFilterCriteria
export interface SearchCondition {
  id: string;
  field: 'class' | 'confidence' | 'detectionCount' | 'boundingBoxSize' | 'position' | 'alertLevel' | 'hasFire' | 'hasSmoke';
  operator: 'equals' | 'contains' | 'greaterThan' | 'lessThan' | 'between' | 'in';
  value: string | number | boolean | string[];
  secondValue?: number; // For 'between' operator
}

export interface CompoundSearchCriteria {
  conditions: SearchCondition[];
  logic: 'AND' | 'OR';
}

interface AdvancedSearchPanelProps {
  onSearch: (criteria: CompoundSearchCriteria) => void;
  onClear: () => void;
  isLoading?: boolean;
  className?: string;
}

const FIELD_OPTIONS = [
  { value: 'class', label: 'Detection Class', type: 'select' },
  { value: 'confidence', label: 'Confidence', type: 'number' },
  { value: 'detectionCount', label: 'Detection Count', type: 'number' },
  { value: 'alertLevel', label: 'Alert Level', type: 'select' },
  { value: 'hasFire', label: 'Has Fire', type: 'boolean' },
  { value: 'hasSmoke', label: 'Has Smoke', type: 'boolean' },
  { value: 'position', label: 'Position', type: 'select' },
  { value: 'boundingBoxSize', label: 'Bounding Box Size', type: 'number' },
] as const;

const OPERATOR_OPTIONS: Record<string, { value: string; label: string }[]> = {
  select: [
    { value: 'equals', label: 'equals' },
    { value: 'in', label: 'is one of' },
  ],
  number: [
    { value: 'equals', label: 'equals' },
    { value: 'greaterThan', label: 'greater than' },
    { value: 'lessThan', label: 'less than' },
    { value: 'between', label: 'between' },
  ],
  boolean: [
    { value: 'equals', label: 'is' },
  ],
};

const VALUE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  class: [
    { value: 'fire', label: 'Fire' },
    { value: 'smoke', label: 'Smoke' },
  ],
  alertLevel: [
    { value: 'none', label: 'None' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'critical', label: 'Critical' },
  ],
  position: [
    { value: 'top', label: 'Top' },
    { value: 'bottom', label: 'Bottom' },
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' },
    { value: 'center', label: 'Center' },
  ],
};

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function AdvancedSearchPanel({
  onSearch,
  onClear,
  isLoading,
  className,
}: AdvancedSearchPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [conditions, setConditions] = useState<SearchCondition[]>([
    {
      id: generateId(),
      field: 'class',
      operator: 'equals',
      value: 'fire',
    },
  ]);

  const addCondition = useCallback(() => {
    setConditions((prev) => [
      ...prev,
      {
        id: generateId(),
        field: 'class',
        operator: 'equals',
        value: 'fire',
      },
    ]);
  }, []);

  const removeCondition = useCallback((id: string) => {
    setConditions((prev) => {
      if (prev.length === 1) {
        toast.error('At least one condition is required');
        return prev;
      }
      return prev.filter((c) => c.id !== id);
    });
  }, []);

  const updateCondition = useCallback(
    (id: string, updates: Partial<SearchCondition>) => {
      setConditions((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          const updated = { ...c, ...updates };

          // Reset value when field changes
          if (updates.field && updates.field !== c.field) {
            const fieldConfig = FIELD_OPTIONS.find((f) => f.value === updates.field);
            if (fieldConfig?.type === 'boolean') {
              updated.value = true;
              updated.operator = 'equals';
            } else if (fieldConfig?.type === 'number') {
              updated.value = 0;
              updated.operator = 'greaterThan';
            } else {
              updated.value = VALUE_OPTIONS[updates.field]?.[0]?.value || '';
              updated.operator = 'equals';
            }
          }

          return updated;
        })
      );
    },
    []
  );

  const handleSearch = useCallback(() => {
    // Validate conditions
    const invalidConditions = conditions.filter((c) => {
      if (c.operator === 'between' && c.secondValue === undefined) return true;
      if (c.value === undefined || c.value === '') return true;
      return false;
    });

    if (invalidConditions.length > 0) {
      toast.error('Please fill in all condition values');
      return;
    }

    onSearch({ conditions, logic });
  }, [conditions, logic, onSearch]);

  const handleClear = useCallback(() => {
    setConditions([
      {
        id: generateId(),
        field: 'class',
        operator: 'equals',
        value: 'fire',
      },
    ]);
    setLogic('AND');
    onClear();
  }, [onClear]);

  const getFieldType = (field: string): 'select' | 'number' | 'boolean' => {
    return FIELD_OPTIONS.find((f) => f.value === field)?.type || 'select';
  };

  return (
    <div className={cn('bg-white rounded-lg shadow border border-gray-200', className)}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-gray-600" />
          <span className="font-medium text-gray-900">Advanced Search</span>
          {conditions.length > 1 && (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
              {conditions.length} conditions
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        )}
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-4 pt-0 space-y-4">
          {/* Logic Selector */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">Match:</span>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              <button
                onClick={() => setLogic('AND')}
                className={cn(
                  'px-4 py-1.5 text-sm font-medium transition-colors',
                  logic === 'AND'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                )}
              >
                All conditions (AND)
              </button>
              <button
                onClick={() => setLogic('OR')}
                className={cn(
                  'px-4 py-1.5 text-sm font-medium transition-colors border-l border-gray-200',
                  logic === 'OR'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                )}
              >
                Any condition (OR)
              </button>
            </div>
          </div>

          {/* Conditions */}
          <div className="space-y-3">
            {conditions.map((condition, index) => {
              const fieldType = getFieldType(condition.field);
              const operators = OPERATOR_OPTIONS[fieldType] || OPERATOR_OPTIONS.select;

              return (
                <div
                  key={condition.id}
                  className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg"
                >
                  {/* Condition number */}
                  <span className="w-6 h-6 flex items-center justify-center bg-gray-200 text-gray-600 text-xs font-medium rounded-full">
                    {index + 1}
                  </span>

                  {/* Field selector */}
                  <select
                    value={condition.field}
                    onChange={(e) =>
                      updateCondition(condition.id, { field: e.target.value as SearchCondition['field'] })
                    }
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {FIELD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {/* Operator selector */}
                  <select
                    value={condition.operator}
                    onChange={(e) =>
                      updateCondition(condition.id, { operator: e.target.value as SearchCondition['operator'] })
                    }
                    className="w-32 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {operators.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {/* Value input */}
                  {fieldType === 'boolean' ? (
                    <select
                      value={String(condition.value)}
                      onChange={(e) =>
                        updateCondition(condition.id, { value: e.target.value === 'true' })
                      }
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : fieldType === 'number' ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="number"
                        value={condition.value as number}
                        onChange={(e) =>
                          updateCondition(condition.id, { value: parseFloat(e.target.value) || 0 })
                        }
                        step={condition.field === 'confidence' ? 0.1 : 1}
                        min={0}
                        max={condition.field === 'confidence' ? 1 : undefined}
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder={condition.field === 'confidence' ? '0.0 - 1.0' : 'Value'}
                      />
                      {condition.operator === 'between' && (
                        <>
                          <span className="text-gray-500">and</span>
                          <input
                            type="number"
                            value={condition.secondValue ?? ''}
                            onChange={(e) =>
                              updateCondition(condition.id, {
                                secondValue: parseFloat(e.target.value) || undefined,
                              })
                            }
                            step={condition.field === 'confidence' ? 0.1 : 1}
                            min={0}
                            max={condition.field === 'confidence' ? 1 : undefined}
                            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder={condition.field === 'confidence' ? '0.0 - 1.0' : 'Value'}
                          />
                        </>
                      )}
                    </div>
                  ) : VALUE_OPTIONS[condition.field] ? (
                    <select
                      value={String(condition.value)}
                      onChange={(e) => updateCondition(condition.id, { value: e.target.value })}
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {VALUE_OPTIONS[condition.field].map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={String(condition.value)}
                      onChange={(e) => updateCondition(condition.id, { value: e.target.value })}
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Value"
                    />
                  )}

                  {/* Remove button */}
                  <button
                    onClick={() => removeCondition(condition.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove condition"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add Condition Button */}
          <button
            onClick={addCondition}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add condition
          </button>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <button
              onClick={handleClear}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="h-4 w-4" />
              Clear
            </button>

            <button
              onClick={handleSearch}
              disabled={isLoading}
              className={cn(
                'flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg transition-colors',
                isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-700'
              )}
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Search
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
