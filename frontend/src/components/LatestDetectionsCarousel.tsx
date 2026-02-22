import { useEffect, useState, useRef, useCallback } from 'react';
import { Wind, ChevronLeft, ChevronRight } from 'lucide-react';
import { executionsApi } from '@/services/api';
import { useSecureImage } from '@/components/ui/SecureImage';
import { Execution } from '@/types';
import { cn } from '@/utils';
import { useTranslation } from '@/contexts/LanguageContext';

interface CarouselThumbProps {
  execution: Execution;
  onClick: (execution: Execution) => void;
}

function CarouselThumb({ execution, onClick }: CarouselThumbProps) {
  const secureUrl = execution.hasImage
    ? executionsApi.getImageUrl(execution.id, true)
    : undefined;
  const { blobUrl, loading } = useSecureImage(secureUrl);

  const ts = new Date(execution.executionTimestamp);
  const timeStr = ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const dateStr = ts.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });

  return (
    <button
      className={cn(
        'relative flex-shrink-0 w-36 h-24 rounded-lg overflow-hidden border border-gray-200',
        'hover:border-gray-400 hover:shadow-md transition-all duration-200 group',
        execution.alertLevel === 'critical' && 'ring-1 ring-red-500',
        execution.alertLevel === 'high' && 'ring-1 ring-orange-400',
      )}
      onClick={() => onClick(execution)}
    >
      {/* Image */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200">
        {blobUrl && !loading && (
          <img
            src={blobUrl}
            alt={`#${execution.id}`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            loading="lazy"
            decoding="async"
          />
        )}
      </div>

      {/* Bottom gradient */}
      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/60 to-transparent" />

      {/* Alert badge */}
      {execution.alertLevel && execution.alertLevel !== 'none' && (
        <div
          className={cn(
            'absolute top-1 left-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white uppercase tracking-wide',
            execution.alertLevel === 'critical' && 'bg-red-600',
            execution.alertLevel === 'high' && 'bg-orange-500',
            execution.alertLevel === 'medium' && 'bg-amber-500',
            execution.alertLevel === 'low' && 'bg-blue-500',
          )}
        >
          {execution.alertLevel}
        </div>
      )}

      {/* Smoke confidence */}
      {execution.hasSmoke && (
        <div className="absolute bottom-1 left-1 flex items-center gap-0.5 text-white text-[10px] font-medium">
          <Wind className="h-2.5 w-2.5" />
          {execution.confidenceSmoke != null && (
            <span className="tabular-nums">{Math.round(execution.confidenceSmoke * 100)}%</span>
          )}
        </div>
      )}

      {/* Timestamp */}
      <div className="absolute bottom-1 right-1 text-white text-[9px] font-medium tabular-nums opacity-80">
        {dateStr} {timeStr}
      </div>
    </button>
  );
}

interface LatestDetectionsCarouselProps {
  onSelect: (execution: Execution) => void;
  className?: string;
}

export function LatestDetectionsCarousel({ onSelect, className }: LatestDetectionsCarouselProps) {
  const { t } = useTranslation();
  const [detections, setDetections] = useState<Execution[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    let cancelled = false;
    executionsApi.getExecutions({
      hasSmoke: true,
      sortBy: 'date',
      sortOrder: 'desc',
      limit: 20,
    }).then((res) => {
      if (!cancelled) setDetections(res.executions);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollButtons();
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    return () => el.removeEventListener('scroll', updateScrollButtons);
  }, [detections, updateScrollButtons]);

  const scroll = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -300 : 300, behavior: 'smooth' });
  }, []);

  if (detections.length === 0) return null;

  return (
    <div className={cn('relative', className)}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
        {t('gallery.latestDetections')}
      </h3>

      <div className="relative group/carousel">
        {/* Scroll buttons */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 hover:bg-white shadow-lg rounded-full p-1.5 border border-gray-200 opacity-0 group-hover/carousel:opacity-100 transition-opacity"
          >
            <ChevronLeft className="h-4 w-4 text-gray-600" />
          </button>
        )}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 hover:bg-white shadow-lg rounded-full p-1.5 border border-gray-200 opacity-0 group-hover/carousel:opacity-100 transition-opacity"
          >
            <ChevronRight className="h-4 w-4 text-gray-600" />
          </button>
        )}

        {/* Scrollable row */}
        <div
          ref={scrollRef}
          className="flex gap-2 overflow-x-auto scrollbar-none pb-1"
          style={{ scrollbarWidth: 'none' }}
        >
          {detections.map((exec) => (
            <CarouselThumb key={exec.id} execution={exec} onClick={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
}
