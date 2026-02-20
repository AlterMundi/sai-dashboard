import { useEffect, useRef, useState } from 'react';
import { cn } from '@/utils';

interface TimePicker24hProps {
  value: string;          // "HH:MM" or ""
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

const ITEM_H     = 32;   // px — height of each option row
const DRAG_THRESHOLD = 4; // px — minimum movement to count as a drag

function useDragScroll(ref: React.RefObject<HTMLDivElement | null>) {
  const dragging  = useRef(false);
  const startY    = useRef(0);
  const startScroll = useRef(0);
  const totalMoved  = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragging.current    = true;
    startY.current      = e.clientY;
    startScroll.current = ref.current?.scrollTop ?? 0;
    totalMoved.current  = 0;
    e.preventDefault(); // block text-selection during drag

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !ref.current) return;
      const delta = startY.current - ev.clientY;
      totalMoved.current = Math.abs(delta);
      ref.current.scrollTop = startScroll.current + delta;
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  };

  const wasDrag = () => totalMoved.current > DRAG_THRESHOLD;

  return { onMouseDown, wasDrag };
}

export function TimePicker24h({
  value,
  onChange,
  disabled = false,
  placeholder = '--:--',
}: TimePicker24hProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hourListRef  = useRef<HTMLDivElement>(null);
  const minListRef   = useRef<HTMLDivElement>(null);

  const hourDrag = useDragScroll(hourListRef);
  const minDrag  = useDragScroll(minListRef);

  const [hh, mm] = value ? value.split(':') : ['', ''];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll selected item into center when opened
  useEffect(() => {
    if (!open) return;
    const scrollTo = (ref: React.RefObject<HTMLDivElement | null>, items: string[], selected: string) => {
      const idx = selected ? items.indexOf(selected) : 0;
      if (ref.current && idx >= 0) {
        ref.current.scrollTop = idx * ITEM_H - (ref.current.clientHeight / 2 - ITEM_H / 2);
      }
    };
    requestAnimationFrame(() => {
      scrollTo(hourListRef, HOURS, hh);
      scrollTo(minListRef, MINUTES, mm);
    });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (nextHh: string, nextMm: string) => {
    onChange(`${nextHh}:${nextMm}`);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'h-8 px-3 rounded-md border border-input bg-background text-sm font-mono flex items-center gap-1 focus:outline-none focus:ring-1 focus:ring-ring transition-colors',
          'hover:bg-gray-50',
          disabled && 'opacity-50 cursor-not-allowed',
          open && 'ring-1 ring-ring',
          value ? 'text-gray-900' : 'text-gray-400'
        )}
      >
        {value || placeholder}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 flex bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden select-none">
          {/* Hours */}
          <div
            ref={hourListRef}
            onMouseDown={hourDrag.onMouseDown}
            className="w-14 h-44 overflow-y-auto overscroll-contain cursor-grab active:cursor-grabbing"
            style={{ scrollbarWidth: 'none' }}
          >
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => { if (hourDrag.wasDrag()) return; select(h, mm || '00'); }}
                className={cn(
                  'w-full text-center text-sm py-1 transition-colors pointer-events-auto',
                  h === hh
                    ? 'bg-primary-50 text-primary-700 font-semibold'
                    : 'text-gray-700 hover:bg-gray-100'
                )}
                style={{ height: ITEM_H }}
              >
                {h}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="w-px bg-gray-100" />

          {/* Minutes */}
          <div
            ref={minListRef}
            onMouseDown={minDrag.onMouseDown}
            className="w-14 h-44 overflow-y-auto overscroll-contain cursor-grab active:cursor-grabbing"
            style={{ scrollbarWidth: 'none' }}
          >
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { if (minDrag.wasDrag()) return; select(hh || '00', m); }}
                className={cn(
                  'w-full text-center text-sm py-1 transition-colors pointer-events-auto',
                  m === mm
                    ? 'bg-primary-50 text-primary-700 font-semibold'
                    : 'text-gray-700 hover:bg-gray-100'
                )}
                style={{ height: ITEM_H }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
