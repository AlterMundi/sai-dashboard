import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { BoundingBoxOverlay, BoundingBoxToggle } from './BoundingBoxOverlay';
import { usePrefetchBuffer } from '@/hooks/usePrefetchBuffer';
import { executionsApi, tokenManager } from '@/services/api';
import {
  formatDate,
  formatDuration,
  copyToClipboard,
  cn
} from '@/utils';
import { useTranslation } from '@/contexts/LanguageContext';
import { DynamicTimeAgo } from './ui/DynamicTimeAgo';
import { ImageModalProps } from '@/types';
import {
  X,
  Download,
  Copy,
  Clock,
  MessageCircle,
  AlertTriangle,
  CheckCircle,
  Wind,
  MapPin,
  Camera,
  Zap,
  Box,
  Flag,
  FlagOff,
  ZoomIn,
  ZoomOut,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';

// Alert level colors for the peek strip
const alertColors: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-white',
  low: 'bg-blue-500 text-white',
  none: 'bg-gray-200 text-gray-600',
};

export function ImageModal({ execution, isOpen, onClose, onUpdate, cameraNav, galleryNav }: ImageModalProps) {
  const { t } = useTranslation();
  const [zoomLevel, setZoomLevel] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
  const [updatingFalsePositive, setUpdatingFalsePositive] = useState(false);
  const [localIsFalsePositive, setLocalIsFalsePositive] = useState(execution?.isFalsePositive ?? false);
  // Bottom sheet state (mobile only)
  const [sheetExpanded, setSheetExpanded] = useState(false);

  // Navigation mode state
  const [navMode, setNavMode] = useState<'camera' | 'gallery'>(cameraNav ? 'camera' : 'gallery');

  // Auto-switch if active mode becomes unavailable
  useEffect(() => {
    if (navMode === 'camera' && !cameraNav) setNavMode('gallery');
  }, [cameraNav, navMode]);

  // Held-arrow FPS (images/second while arrow key is held)
  const [navFps, setNavFps] = useState<3 | 10 | 30>(10);
  const navIntervalRef = useRef<number>(100); // ms between nav steps
  useEffect(() => { navIntervalRef.current = Math.round(1000 / navFps); }, [navFps]);

  const activeNav = navMode === 'camera' ? cameraNav : galleryNav;

  const [pressedBtn, setPressedBtn] = useState<'prev' | 'next' | null>(null);
  useEffect(() => {
    if (!pressedBtn) return;
    const t = setTimeout(() => setPressedBtn(null), 150);
    return () => clearTimeout(t);
  }, [pressedBtn]);

  // Sync local state when execution changes
  useEffect(() => {
    if (execution) {
      setLocalIsFalsePositive(execution.isFalsePositive ?? false);
    }
    setSheetExpanded(false); // collapse sheet on new execution
  }, [execution?.id, execution?.isFalsePositive]);

  // Keep secureImageUrl for the download button handler
  const secureImageUrl = execution?.hasImage
    ? executionsApi.getImageUrl(execution.id, false)
    : undefined;

  const prefetchBuffer = usePrefetchBuffer(
    useCallback((id: number) => executionsApi.getImageUrl(id, false), [])
  );

  useEffect(() => {
    if (!isOpen || !execution) {
      prefetchBuffer.prefetch([]); // clear buffer on close
      return;
    }
    prefetchBuffer.setCurrent(execution.id);
    const nav = (navMode === 'camera' ? cameraNav : galleryNav) ?? galleryNav ?? cameraNav;
    const neighbors = nav?.getNeighbors(5, 5) ?? [execution];
    prefetchBuffer.prefetch(
      neighbors.filter(e => e.hasImage).map(e => e.id)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execution?.id, isOpen, navMode, cameraNav, galleryNav]);

  const { blobUrl: imageUrl, loading: imageLoading, error: imageError } =
    execution?.hasImage
      ? prefetchBuffer.getEntry(execution.id)
      : { blobUrl: null, loading: false, error: false };

  // Reset zoom/pan when execution changes
  useEffect(() => {
    setZoomLevel(1);
    setTranslate({ x: 0, y: 0 });
    setDragging(false);
    dragStart.current = null;
  }, [execution?.id]);

  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const up   = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ cx: number; cy: number; tx: number; ty: number } | null>(null);
  const resetZoomToFit = useCallback(() => {
    setZoomLevel(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  // Throttle for held-arrow navigation in Fit mode (1 image per 300ms)
  const lastNavTimeRef = useRef<number>(0);

  const containerRef   = useRef<HTMLDivElement>(null);
  const dialogRef      = useRef<HTMLDivElement>(null);
  const sheetRef       = useRef<HTMLDivElement>(null);
  const sheetHandleRef = useRef<HTMLDivElement>(null);

  // Stable refs for use inside imperative event handlers
  const zoomRef          = useRef(zoomLevel);
  const translateRef     = useRef(translate);
  const sheetExpandedRef = useRef(sheetExpanded);
  useEffect(() => { zoomRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => { translateRef.current = translate; }, [translate]);
  useEffect(() => { sheetExpandedRef.current = sheetExpanded; }, [sheetExpanded]);

  // Prevent mouse-emulation events from double-firing on touch devices
  const isTouching = useRef(false);

  // ── Mouse pan / click-to-zoom (desktop) ──────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isTouching.current) return;
    if (zoomLevel > 1) e.preventDefault();
    dragStart.current = { cx: e.clientX, cy: e.clientY, tx: translate.x, ty: translate.y };
    if (zoomLevel > 1) setDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isTouching.current || !dragStart.current || zoomLevel <= 1) return;
    const dx = e.clientX - dragStart.current.cx;
    const dy = e.clientY - dragStart.current.cy;
    if (!dragging && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) setDragging(true);
    setTranslate({ x: dragStart.current.tx + dx, y: dragStart.current.ty + dy });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isTouching.current || !dragStart.current) return;
    const dx = Math.abs(e.clientX - dragStart.current.cx);
    const dy = Math.abs(e.clientY - dragStart.current.cy);
    const savedStart = dragStart.current;
    dragStart.current = null;
    setDragging(false);

    if (dx < 5 && dy < 5) {
      const newZoom = e.shiftKey
        ? Math.max(zoomLevel - 2, 1)
        : zoomLevel === 1 ? 2 : Math.min(zoomLevel + 2, 10);

      if (newZoom <= 1) { resetZoomToFit(); return; }

      if (containerRef.current) {
        const r = containerRef.current.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const origOx = (e.clientX - cx - savedStart.tx) / zoomLevel;
        const origOy = (e.clientY - cy - savedStart.ty) / zoomLevel;
        setTranslate({ x: -origOx * newZoom, y: -origOy * newZoom });
      }
      setZoomLevel(newZoom);
    }
  };

  // ── Image touch gestures: pan, pinch, swipe-down-to-close ────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isOpen) return;

    type Gesture = {
      type: 'pan' | 'pinch' | 'swipe';
      startX: number; startY: number;
      initTx: number; initTy: number;
      initZoom: number;
      initDist?: number;
      pinchMidX?: number; pinchMidY?: number;
      swipeY: number;
    };
    let gesture: Gesture | null = null;

    const onStart = (e: TouchEvent) => {
      isTouching.current = true;
      const t = e.touches;
      const z = zoomRef.current;
      const tr = translateRef.current;

      if (t.length === 2) {
        const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        const midX = (t[0].clientX + t[1].clientX) / 2;
        const midY = (t[0].clientY + t[1].clientY) / 2;
        gesture = { type: 'pinch', startX: midX, startY: midY,
          initTx: tr.x, initTy: tr.y, initZoom: z,
          initDist: dist, pinchMidX: midX, pinchMidY: midY, swipeY: 0 };
      } else if (t.length === 1) {
        gesture = { type: z > 1 ? 'pan' : 'swipe',
          startX: t[0].clientX, startY: t[0].clientY,
          initTx: tr.x, initTy: tr.y, initZoom: z, swipeY: 0 };
      }
    };

    const onMove = (e: TouchEvent) => {
      if (!gesture) return;
      const t = e.touches;

      if (gesture.type === 'pan' && t.length === 1) {
        e.preventDefault();
        setTranslate({
          x: gesture.initTx + (t[0].clientX - gesture.startX),
          y: gesture.initTy + (t[0].clientY - gesture.startY),
        });
      } else if (gesture.type === 'pinch' && t.length === 2) {
        e.preventDefault();
        const newDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        const newZoom = Math.min(Math.max(gesture.initZoom * (newDist / gesture.initDist!), 1), 10);
        if (newZoom <= 1) {
          resetZoomToFit();
        } else {
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const imgX = (gesture.pinchMidX! - cx - gesture.initTx) / gesture.initZoom;
          const imgY = (gesture.pinchMidY! - cy - gesture.initTy) / gesture.initZoom;
          setZoomLevel(newZoom);
          setTranslate({ x: gesture.pinchMidX! - cx - imgX * newZoom,
                         y: gesture.pinchMidY! - cy - imgY * newZoom });
        }
      } else if (gesture.type === 'swipe' && t.length === 1) {
        const dy = t[0].clientY - gesture.startY;
        if (dy > 0 && dialogRef.current) {
          e.preventDefault();
          gesture.swipeY = dy;
          dialogRef.current.style.transform = `translateY(${dy}px)`;
          dialogRef.current.style.transition = 'none';
        }
      }
    };

    const onEnd = () => {
      isTouching.current = false;
      if (!gesture) return;
      if (gesture.type === 'swipe' && dialogRef.current) {
        dialogRef.current.style.transform = '';
        dialogRef.current.style.transition = '';
        if (gesture.swipeY > window.innerHeight * 0.15) onClose();
      }
      gesture = null;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove',  onMove,  { passive: false });
    el.addEventListener('touchend',   onEnd,   { passive: true });
    el.addEventListener('touchcancel',onEnd,   { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove',  onMove);
      el.removeEventListener('touchend',   onEnd);
      el.removeEventListener('touchcancel',onEnd);
    };
  }, [isOpen, onClose, resetZoomToFit]);

  // ── Bottom sheet drag (handle area) ──────────────────────────────────────
  useEffect(() => {
    const handle = sheetHandleRef.current;
    const sheet  = sheetRef.current;
    if (!handle || !sheet || !isOpen) return;

    let startY = 0;
    let dragging = false;

    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      dragging = true;
      sheet.style.transition = 'none';
    };

    const onMove = (e: TouchEvent) => {
      if (!dragging) return;
      e.preventDefault();
      const dy = e.touches[0].clientY - startY;
      if (sheetExpandedRef.current && dy > 0) {
        // dragging down while expanded → lower the sheet
        sheet.style.transform = `translateY(${dy}px)`;
      } else if (!sheetExpandedRef.current && dy < 0) {
        // dragging up while collapsed → pull sheet up from its CSS position
        const collapsedY = sheet.clientHeight - 48;
        sheet.style.transform = `translateY(${Math.max(0, collapsedY + dy)}px)`;
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transform = '';
      sheet.style.transition = '';
      const dy = e.changedTouches[0].clientY - startY;
      if (!sheetExpandedRef.current && dy < -60) setSheetExpanded(true);
      if (sheetExpandedRef.current  && dy >  60) setSheetExpanded(false);
    };

    handle.addEventListener('touchstart', onStart, { passive: true });
    handle.addEventListener('touchmove',  onMove,  { passive: false });
    handle.addEventListener('touchend',   onEnd,   { passive: true });
    return () => {
      handle.removeEventListener('touchstart', onStart);
      handle.removeEventListener('touchmove',  onMove);
      handle.removeEventListener('touchend',   onEnd);
    };
  }, [isOpen]);

  // ── Escape / Arrow keys + body scroll lock ───────────────────────────────
  useEffect(() => {
    const PAN_STEP = 80; // px per keydown event when zoomed (repeat allowed)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }

      const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
                   || e.key === 'ArrowUp'   || e.key === 'ArrowDown';
      if (!isArrow) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (zoomRef.current > 1) {
        // ── ZOOM MODE: all 4 arrows pan the image ──────────────────────────
        // e.repeat allowed → smooth continuous pan while key held
        e.preventDefault();
        setTranslate(prev => {
          switch (e.key) {
            case 'ArrowLeft':  return { x: prev.x + PAN_STEP, y: prev.y };
            case 'ArrowRight': return { x: prev.x - PAN_STEP, y: prev.y };
            case 'ArrowUp':    return { x: prev.x, y: prev.y + PAN_STEP };
            case 'ArrowDown':  return { x: prev.x, y: prev.y - PAN_STEP };
            default:           return prev;
          }
        });
      } else {
        // ── FIT MODE ────────────────────────────────────────────────────────
        e.preventDefault();

        if (e.key === 'ArrowUp') {
          if (e.repeat) return;
          // Zoom to 2x centered
          setZoomLevel(2);
          setTranslate({ x: 0, y: 0 });
          return;
        }
        if (e.key === 'ArrowDown') return; // no-op in fit mode

        // Left/Right: navigate on hold at navFps rate
        const now = Date.now();
        if (e.repeat && now - lastNavTimeRef.current < navIntervalRef.current) return;
        lastNavTimeRef.current = now;

        const nav = navMode === 'camera' ? cameraNav : galleryNav;
        if (!nav) return;
        if (e.key === 'ArrowLeft'  && nav.hasPrev) { setPressedBtn('prev'); nav.onPrev(); }
        if (e.key === 'ArrowRight' && nav.hasNext) { setPressedBtn('next'); nav.onNext(); }
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', onKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose, navMode, cameraNav, galleryNav]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleToggleFalsePositive = useCallback(async () => {
    if (!execution) return;
    setUpdatingFalsePositive(true);
    try {
      const newValue = !localIsFalsePositive;
      const updated = await executionsApi.markFalsePositive(
        execution.id, newValue,
        newValue ? 'Manually marked by operator' : undefined
      );
      setLocalIsFalsePositive(newValue);
      toast.success(newValue ? t('modal.markedFalsePositive') : t('modal.markedValidDetection'));
      if (onUpdate) onUpdate(updated);
    } catch {
      toast.error(t('modal.updateFailed'));
    } finally {
      setUpdatingFalsePositive(false);
    }
  }, [execution, localIsFalsePositive, onUpdate]);

  const handleDownload = useCallback(async () => {
    if (!secureImageUrl || !execution) return;
    setDownloading(true);
    try {
      const token = tokenManager.get();
      const res = await fetch(secureImageUrl, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `sai-execution-${execution.id}.webp`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      toast.success(t('modal.imageDownloaded'));
    } catch {
      toast.error(t('modal.imageDownloadFailed'));
    } finally {
      setDownloading(false);
    }
  }, [secureImageUrl, execution]);

  if (!isOpen || !execution) return null;

  const duration = execution.durationMs ? Math.round(execution.durationMs / 1000) : null;

  const handleCopyId = async () => {
    const ok = await copyToClipboard(String(execution.id));
    toast[ok ? 'success' : 'error'](ok ? t('modal.idCopied') : t('modal.copyFailed'));
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `SAI Execution ${execution.id}`,
          text: `YOLO Detection - Alert Level: ${execution.alertLevel || 'none'}`,
          url: window.location.href,
        });
      } catch { /* cancelled */ }
    } else {
      const ok = await copyToClipboard(window.location.href);
      toast[ok ? 'success' : 'error'](ok ? t('modal.urlCopied') : t('modal.copyFailed'));
    }
  };

  // ── Sidebar content (shared between desktop sidebar and mobile sheet) ─────
  const SidebarContent = () => (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Execution Metadata */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
          {t('modal.executionInfo')}
        </h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-gray-500">{t('modal.started')}</p>
            <p className="font-medium mt-1"><DynamicTimeAgo date={execution.executionTimestamp} /></p>
            <p className="text-xs text-gray-400 mt-0.5">{formatDate(execution.executionTimestamp)}</p>
          </div>
          {duration && (
            <div>
              <p className="text-gray-500">{t('modal.duration')}</p>
              <div className="flex items-center mt-1">
                <Clock className="h-4 w-4 text-gray-400 mr-1" />
                <span className="font-medium">{formatDuration(duration)}</span>
              </div>
            </div>
          )}
          <div>
            <p className="text-gray-500">{t('modal.statusLabel')}</p>
            <div className="flex items-center mt-1">
              {execution.status === 'success' && <CheckCircle className="h-4 w-4 text-success-600 mr-1" />}
              {execution.status === 'error'   && <AlertTriangle className="h-4 w-4 text-danger-600 mr-1" />}
              <span className="font-medium capitalize">{execution.status}</span>
            </div>
          </div>
          <div>
            <p className="text-gray-500">{t('modal.mode')}</p>
            <p className="font-medium mt-1 capitalize">{execution.mode}</p>
          </div>
        </div>
      </div>

      {/* YOLO Analysis */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
          {t('modal.yoloAnalysis')}
        </h3>

        {execution.alertLevel && (
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500 mb-2">{t('modal.alertLevelLabel')}</p>
            <div className={cn('px-3 py-2 rounded text-sm font-bold text-center uppercase',
              execution.alertLevel === 'critical' && 'bg-red-600 text-white animate-pulse',
              execution.alertLevel === 'high'     && 'bg-orange-600 text-white',
              execution.alertLevel === 'medium'   && 'bg-yellow-500 text-white',
              execution.alertLevel === 'low'      && 'bg-blue-500 text-white',
              execution.alertLevel === 'none'     && 'bg-gray-200 text-gray-700',
            )}>
              {execution.alertLevel}
            </div>
          </div>
        )}

        <div className={cn('p-3 rounded-lg border',
          execution.hasSmoke ? 'bg-gray-100 border-gray-400' : 'bg-gray-50 border-gray-200'
        )}>
          <div className="flex items-center justify-between mb-2">
            <Wind className={cn('h-4 w-4', execution.hasSmoke ? 'text-gray-700' : 'text-gray-400')} />
            <span className={cn('text-xs font-bold uppercase',
              execution.hasSmoke ? 'text-gray-800' : 'text-gray-500'
            )}>
              {execution.hasSmoke ? t('modal.detected') : t('modal.clear')}
            </span>
          </div>
          <p className="text-sm font-medium text-gray-700">{t('modal.smokeLabel')}</p>
          {execution.confidenceSmoke !== null && execution.confidenceSmoke > 0 && (
            <p className="text-xs text-gray-600 mt-1">
              {t('modal.confidence', { value: String(Math.round(execution.confidenceSmoke * 100)) })}
            </p>
          )}
        </div>

        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Box className="h-4 w-4 text-blue-600 mr-2" />
              <span className="text-sm font-medium text-blue-900">{t('modal.totalDetections')}</span>
            </div>
            <span className="text-lg font-bold text-blue-700">{execution.detectionCount}</span>
          </div>
        </div>

        <div className={cn('p-3 rounded-lg border transition-colors',
          localIsFalsePositive ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-200'
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              {localIsFalsePositive
                ? <Flag    className="h-4 w-4 text-yellow-600 mr-2" />
                : <FlagOff className="h-4 w-4 text-gray-400 mr-2" />}
              <div>
                <span className={cn('text-sm font-medium',
                  localIsFalsePositive ? 'text-yellow-800' : 'text-gray-700'
                )}>
                  {localIsFalsePositive ? t('modal.falsePositive') : t('modal.validDetection')}
                </span>
                {localIsFalsePositive && execution.falsePositiveReason && (
                  <p className="text-xs text-yellow-700 mt-0.5">{execution.falsePositiveReason}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleToggleFalsePositive}
              disabled={updatingFalsePositive}
              className={cn('px-3 py-2 text-xs font-medium rounded transition-colors min-h-[44px]',
                localIsFalsePositive
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200',
                updatingFalsePositive && 'opacity-50 cursor-not-allowed'
              )}
            >
              {updatingFalsePositive ? <span className="animate-pulse">...</span>
                : localIsFalsePositive ? t('modal.markValid') : t('modal.markFalse')}
            </button>
          </div>
        </div>

        {(execution.yoloModelVersion || execution.yoloProcessingTimeMs) && (
          <div className="space-y-1.5 text-xs text-gray-600">
            {execution.yoloModelVersion && (
              <div className="flex items-center justify-between">
                <span>{t('modal.model')}</span>
                <span className="font-mono">{execution.yoloModelVersion}</span>
              </div>
            )}
            {execution.yoloProcessingTimeMs && (
              <div className="flex items-center justify-between">
                <span>{t('modal.processing')}</span>
                <span className="font-mono">{execution.yoloProcessingTimeMs}ms</span>
              </div>
            )}
            {execution.requestId && (
              <div className="flex items-center justify-between">
                <span>{t('modal.requestId')}</span>
                <span className="font-mono">{execution.requestId.slice(0, 8)}…</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Device & Camera */}
      {(execution.cameraId || execution.deviceId || execution.location) && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
            {t('modal.deviceInfo')}
          </h3>
          <div className="space-y-2 text-sm">
            {execution.cameraId && (
              <div className="flex items-center">
                <Camera className="h-4 w-4 text-gray-400 mr-2" />
                <span className="text-gray-500 mr-2">{t('modal.cameraLabel')}</span>
                <span className="font-mono font-medium">{execution.cameraId}</span>
              </div>
            )}
            {execution.location && (
              <div className="flex items-center">
                <MapPin className="h-4 w-4 text-gray-400 mr-2" />
                <span className="text-gray-500 mr-2">{t('modal.locationLabel')}</span>
                <span className="font-medium">{execution.location}</span>
              </div>
            )}
            {execution.deviceId && (
              <div className="flex items-center">
                <Zap className="h-4 w-4 text-gray-400 mr-2" />
                <span className="text-gray-500 mr-2">{t('modal.deviceLabel')}</span>
                <span className="font-mono font-medium text-xs">{execution.deviceId}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image Metadata */}
      {execution.hasImage && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
            {t('modal.imageInfo')}
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
            {execution.imageWidth && execution.imageHeight && (
              <div>
                <span className="text-gray-500">{t('modal.dimensions')}</span>
                <p className="font-medium mt-0.5">{execution.imageWidth} × {execution.imageHeight}</p>
              </div>
            )}
            {execution.imageSizeBytes && (
              <div>
                <span className="text-gray-500">{t('modal.size')}</span>
                <p className="font-medium mt-0.5">{(execution.imageSizeBytes / 1024).toFixed(1)} KB</p>
              </div>
            )}
            {execution.imageFormat && (
              <div>
                <span className="text-gray-500">{t('modal.format')}</span>
                <p className="font-medium mt-0.5 uppercase">{execution.imageFormat}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Telegram */}
      {execution.telegramSent && (
        <div className="p-3 bg-success-50 border border-success-200 rounded-lg">
          <div className="flex items-center">
            <MessageCircle className="h-5 w-5 text-success-600 mr-2" />
            <div className="flex-1">
              <p className="text-sm font-medium text-success-900">{t('modal.telegramNotifSent')}</p>
              {execution.telegramSentAt && (
                <p className="text-xs text-success-700 mt-0.5">{formatDate(execution.telegramSentAt)}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex sm:items-center sm:justify-center sm:p-4 bg-black/75"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Dialog — full-screen on mobile, card on desktop */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${t('modal.executionDetails')} #${execution.id}`}
        className="relative w-full sm:max-w-6xl bg-white sm:rounded-lg shadow-2xl overflow-hidden flex flex-col h-[100dvh] sm:h-auto sm:max-h-[calc(100dvh-2rem)]"
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-3 sm:px-4 pb-3 border-b border-gray-200 bg-gray-50"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 truncate min-w-0">
            {t('modal.execution')} <span className="font-mono">#{execution.id}</span>
          </h2>
          <div className="flex items-center shrink-0">
            <button onClick={handleCopyId}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('modal.copyId')}>
              <Copy className="h-5 w-5" />
            </button>
            {secureImageUrl && (
              <button onClick={handleDownload} disabled={downloading}
                className={cn('flex items-center justify-center min-w-[44px] min-h-[44px] text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors',
                  downloading && 'opacity-50 cursor-not-allowed')}
                title={t('modal.downloadImage')}>
                <Download className={cn('h-5 w-5', downloading && 'animate-pulse')} />
              </button>
            )}
            <button onClick={handleShare}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('modal.share')}>
              <MessageCircle className="h-5 w-5" />
            </button>
            <button onClick={onClose}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('modal.closeEsc')}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">

          {/* Image section — fills ALL remaining height on mobile (sheet overlays it) */}
          <div className="flex-1 bg-gray-900 flex flex-col min-h-0 min-w-0 relative overflow-hidden">
            {/* Bounding Box Toggle */}
            {execution.detections && execution.detections.length > 0 && !imageError && !!imageUrl && (
              <div className="flex justify-center p-2 bg-gray-800 shrink-0">
                <BoundingBoxToggle
                  visible={showBoundingBoxes}
                  onToggle={setShowBoundingBoxes}
                  detectionCount={execution.detections.length}
                />
              </div>
            )}

            {/* Image container */}
            <div
              ref={containerRef}
              className="relative flex-1 min-h-0 p-2 sm:p-4 overflow-hidden flex items-center justify-center touch-none"
            >
              {secureImageUrl ? (
                <>
                  {imageLoading && !imageUrl && (
                    <div className="flex items-center justify-center h-full">
                      <LoadingSpinner size="lg" color="white" />
                    </div>
                  )}
                  {imageError ? (
                    <div className="flex flex-col items-center text-gray-400">
                      <AlertTriangle className="h-16 w-16 mb-4" />
                      <p className="text-lg">{t('modal.failedToLoadImage')}</p>
                    </div>
                  ) : imageUrl ? (
                    <div
                      className="relative w-full h-full bg-gray-900"
                      style={{
                        transform: zoomLevel > 1
                          ? `translate(${translate.x}px, ${translate.y}px) scale(${zoomLevel})`
                          : undefined,
                        transformOrigin: '50% 50%',
                        transition: dragging ? 'none' : 'transform 0.2s ease-out',
                        cursor: dragging ? 'grabbing' : shiftHeld ? 'zoom-out' : 'zoom-in',
                        userSelect: 'none',
                      }}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={() => { dragStart.current = null; setDragging(false); }}
                    >
                      <img
                        src={imageUrl}
                        alt={`Execution ${execution.id}`}
                        className="w-full h-full object-contain"
                      />
                      <BoundingBoxOverlay
                        detections={execution.detections}
                        imageWidth={execution.imageWidth}
                        imageHeight={execution.imageHeight}
                        visible={showBoundingBoxes}
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="flex flex-col items-center text-gray-400">
                  <AlertTriangle className="h-16 w-16 mb-4" />
                  <p className="text-lg">{t('modal.noImageAvailable')}</p>
                </div>
              )}

              {/* Zoom controls — top-right inside image container, clear of bottom sheet */}
              {imageUrl && !imageError && (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 rounded-lg p-1 z-10">
                  <button
                    onClick={() => {
                      const nz = Math.max(zoomLevel - 2, 1);
                      if (nz <= 1) { resetZoomToFit(); return; }
                      const f = nz / zoomLevel;
                      setTranslate(p => ({ x: p.x * f, y: p.y * f }));
                      setZoomLevel(nz);
                    }}
                    disabled={zoomLevel <= 1}
                    className="flex items-center justify-center min-w-[44px] min-h-[44px] text-white hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ZoomOut className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    onClick={resetZoomToFit}
                    className="text-white text-sm font-mono px-2 min-w-[4ch] text-center hover:bg-white/20 rounded min-h-[44px]"
                    title="Reset zoom to fit"
                  >
                    {zoomLevel === 1 ? 'Fit' : `${Math.round(zoomLevel * 10) / 10}x`}
                  </button>
                  <button
                    onClick={() => {
                      const nz = zoomLevel === 1 ? 2 : Math.min(zoomLevel + 2, 10);
                      const f = nz / zoomLevel;
                      setTranslate(p => ({ x: p.x * f, y: p.y * f }));
                      setZoomLevel(nz);
                    }}
                    disabled={zoomLevel >= 10}
                    className="flex items-center justify-center min-w-[44px] min-h-[44px] text-white hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ZoomIn className="h-6 w-6" />
                  </button>
                </div>
              )}

              {/* ← Prev navigation button */}
              {activeNav && activeNav.total > 1 && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { if (activeNav.hasPrev) { setPressedBtn('prev'); activeNav.onPrev(); } }}
                  disabled={!activeNav.hasPrev}
                  className={cn(
                    'absolute left-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 bg-black/50 hover:bg-black/70 active:bg-white/20 text-white rounded-full transition-all duration-150 disabled:opacity-20 disabled:cursor-not-allowed z-10 focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none',
                    pressedBtn === 'prev' && 'bg-white/20',
                  )}
                  aria-label={t('modal.navPrev')}
                  title={t('modal.navPrev')}
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
              )}

              {/* → Next navigation button */}
              {activeNav && activeNav.total > 1 && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { if (activeNav.hasNext) { setPressedBtn('next'); activeNav.onNext(); } }}
                  disabled={!activeNav.hasNext}
                  className={cn(
                    'absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 bg-black/50 hover:bg-black/70 active:bg-white/20 text-white rounded-full transition-all duration-150 disabled:opacity-20 disabled:cursor-not-allowed z-10 focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none',
                    pressedBtn === 'next' && 'bg-white/20',
                  )}
                  aria-label={t('modal.navNext')}
                  title={t('modal.navNext')}
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              )}

              {/* Counter + mode selector + FPS selector */}
              {activeNav && activeNav.total > 1 && (
                <div className="absolute bottom-14 sm:bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/60 rounded-lg px-2.5 py-1.5 z-10 select-none">
                  {/* Position counter */}
                  <span className="text-white text-xs font-mono tabular-nums pr-1">
                    {activeNav.index + 1} / {activeNav.total}
                  </span>

                  {/* Gallery / Camera mode selector */}
                  {cameraNav && galleryNav && (
                    <>
                      <div className="w-px h-3 bg-white/30 mx-0.5" />
                      <div className="flex rounded overflow-hidden border border-white/20">
                        {(['gallery', 'camera'] as const).map(mode => (
                          <button
                            key={mode}
                            onClick={() => setNavMode(mode)}
                            className={cn(
                              'text-xs px-2 py-0.5 transition-colors',
                              navMode === mode
                                ? 'bg-white/25 text-white'
                                : 'text-white/50 hover:text-white/80'
                            )}
                          >
                            {mode === 'gallery'
                              ? t('modal.navModeGalleryLabel')
                              : t('modal.navModeCameraLabel')}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {/* FPS selector for held-arrow navigation */}
                  <div className="w-px h-3 bg-white/30 mx-0.5" />
                  <div className="flex rounded overflow-hidden border border-white/20">
                    {([3, 10, 30] as const).map(fps => (
                      <button
                        key={fps}
                        onClick={() => setNavFps(fps)}
                        className={cn(
                          'text-xs px-1.5 py-0.5 transition-colors',
                          navFps === fps
                            ? 'bg-white/25 text-white'
                            : 'text-white/50 hover:text-white/80'
                        )}
                      >
                        {fps}fps
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Desktop sidebar — hidden on mobile */}
          <div className="hidden lg:block lg:flex-none lg:w-96 bg-white overflow-y-auto"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <SidebarContent />
          </div>
        </div>

        {/* ── Mobile bottom sheet ── (hidden on lg+) */}
        <div
          ref={sheetRef}
          className={cn(
            'lg:hidden absolute inset-x-0 bottom-0 bg-white rounded-t-2xl z-20',
            'shadow-[0_-4px_24px_rgba(0,0,0,0.18)] flex flex-col',
            'transition-transform duration-300 ease-out',
            sheetExpanded ? 'translate-y-0' : 'translate-y-[calc(100%-3rem)]',
          )}
          style={{
            maxHeight: 'calc(100% - 3.5rem)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Handle + collapsed peek */}
          <div
            ref={sheetHandleRef}
            className="shrink-0 flex flex-col items-center pt-2 pb-1 cursor-grab active:cursor-grabbing select-none"
            onClick={() => setSheetExpanded(v => !v)}
          >
            {/* Drag bar */}
            <div className="w-10 h-1 rounded-full bg-gray-300 mb-2" />

            {/* Collapsed info strip — hidden when expanded */}
            <div className={cn(
              'flex items-center gap-2 px-4 pb-1 text-xs transition-opacity',
              sheetExpanded ? 'opacity-0 pointer-events-none' : 'opacity-100'
            )}>
              {execution.alertLevel && execution.alertLevel !== 'none' && (
                <span className={cn('px-2 py-0.5 rounded font-bold uppercase text-xs',
                  alertColors[execution.alertLevel] ?? alertColors.none)}>
                  {execution.alertLevel}
                </span>
              )}
              {execution.cameraId && (
                <span className="flex items-center gap-1 text-gray-600">
                  <Camera className="h-3 w-3" />{execution.cameraId}
                </span>
              )}
              {execution.hasSmoke && (
                <span className="flex items-center gap-1 text-gray-600">
                  <Wind className="h-3 w-3" />
                  {execution.confidenceSmoke
                    ? `${Math.round(execution.confidenceSmoke * 100)}%`
                    : 'smoke'}
                </span>
              )}
              {/* Chevron hint */}
              <ChevronUp className="h-4 w-4 text-gray-400 ml-auto" />
            </div>
          </div>

          {/* Scrollable sheet content */}
          <div className="overflow-y-auto flex-1 overscroll-contain">
            <SidebarContent />
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
