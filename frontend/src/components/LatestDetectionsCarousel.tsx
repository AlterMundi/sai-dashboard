import { useEffect, useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { executionsApi } from '@/services/api';
import { useSecureImage } from '@/components/ui/SecureImage';
import { Execution } from '@/types';
import { cn, getDisplayTimestamp } from '@/utils';
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

  const _ts = getDisplayTimestamp(execution);
  const ts = new Date(_ts.timestamp);
  const timeStr = ts.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const dateStr = ts.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });

  /* Mirror gallery ImageCard DNA: rounded-xl, shadow-sm, hover:shadow-xl, duration-300 */
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'rounded-xl cursor-pointer group',
        'bg-white border border-gray-200 shadow-sm',
        'hover:shadow-xl transition-[box-shadow,border-color] duration-300',
        'focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 outline-none',
        execution.alertLevel === 'critical' && 'ring-2 ring-red-500 ring-offset-2',
        execution.alertLevel === 'high' && 'ring-2 ring-orange-400 ring-offset-1',
      )}
      style={{ position: 'relative', flexShrink: 0, width: 168, height: 110, overflow: 'hidden' }}
      onClick={(e) => { (e.currentTarget as HTMLElement).blur(); onClick(execution); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(execution); } }}
    >
      {/* Image — matches gallery card aspect-video fill pattern */}
      {loading && (
        <div style={{ position: 'absolute', inset: 0 }} className="bg-gradient-to-br from-gray-100 to-gray-200 animate-pulse" />
      )}
      {blobUrl && !loading && (
        <img
          src={blobUrl}
          alt={`Detection #${execution.id}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          className="group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
          decoding="async"
        />
      )}
      {!blobUrl && !loading && (
        <div style={{ position: 'absolute', inset: 0 }} className="bg-gradient-to-br from-gray-100 to-gray-200" />
      )}

      {/* Top gradient (matches gallery card) */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, background: 'linear-gradient(to bottom, rgba(0,0,0,0.08), transparent)', pointerEvents: 'none' }} />

      {/* Bottom gradient + info strip */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 40, background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent)', pointerEvents: 'none' }} />

      {/* Timestamp — bottom right, same tabular-nums pattern */}
      <div style={{ position: 'absolute', bottom: 6, right: 6, fontSize: 9, color: _ts.isFallback ? '#fbbf24' : 'white', fontWeight: 500, pointerEvents: 'none' }} className="tabular-nums" title={_ts.isFallback ? 'Server time (no capture metadata)' : 'Camera capture time'}>
        {_ts.isFallback && '~ '}{dateStr} · {timeStr}
      </div>

      {/* Hover reveal: execution ID — matches gallery card font-mono ID style */}
      <div
        style={{ position: 'absolute', top: 5, left: 5, fontSize: 9 }}
        className="font-mono font-semibold text-white/0 group-hover:text-white/90 transition-colors duration-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
      >
        #{String(execution.id).padStart(6, '0')}
      </div>
    </div>
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
    el.scrollBy({ left: dir === 'left' ? -340 : 340, behavior: 'smooth' });
  }, []);

  if (detections.length === 0) return null;

  return (
    <div className={className}>
      {/* Section label — matches gallery header style */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
          {t('gallery.latestDetections')}
        </h3>
      </div>

      {/* Carousel track */}
      <div className="relative group/carousel">
        {/* Scroll buttons */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scroll('left')}
            className="absolute -left-2 top-1/2 -translate-y-1/2 z-20 bg-white hover:bg-gray-50 shadow-lg rounded-full p-1.5 border border-gray-200 opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-200"
          >
            <ChevronLeft className="h-4 w-4 text-gray-600" />
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scroll('right')}
            className="absolute -right-2 top-1/2 -translate-y-1/2 z-20 bg-white hover:bg-gray-50 shadow-lg rounded-full p-1.5 border border-gray-200 opacity-0 group-hover/carousel:opacity-100 transition-opacity duration-200"
          >
            <ChevronRight className="h-4 w-4 text-gray-600" />
          </button>
        )}

        {/* Scrollable row */}
        <div
          ref={scrollRef}
          className="flex gap-3 scrollbar-none"
          style={{ overflowX: 'auto', overflowY: 'visible', scrollbarWidth: 'none', padding: '4px 4px' }}
        >
          {detections.map((exec) => (
            <CarouselThumb key={exec.id} execution={exec} onClick={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
}
