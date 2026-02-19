import { useState } from 'react';
import { YoloDetection } from '@/types';
import { cn } from '@/utils';

interface BoundingBoxOverlayProps {
  /** Array of YOLO detections with bounding boxes */
  detections: YoloDetection[] | null;
  /** Original image width in pixels */
  imageWidth: number | null;
  /** Original image height in pixels */
  imageHeight: number | null;
  /** Whether to show the overlay */
  visible?: boolean;
  /** Additional class name */
  className?: string;
}

const BB_COLOR = { bg: 'transparent', border: '#1d4ed8', text: '#eff6ff' };

/**
 * Renders bounding box overlays on top of an image.
 * Must be placed inside a container that wraps the image with position: relative.
 * Scales boxes proportionally based on original vs rendered image dimensions.
 */
export function BoundingBoxOverlay({
  detections,
  imageWidth,
  imageHeight,
  visible = true,
  className,
}: BoundingBoxOverlayProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!visible || !detections || detections.length === 0 || !imageWidth || !imageHeight) {
    return null;
  }

  return (
    <svg
      className={cn('absolute inset-0 w-full h-full pointer-events-none', className)}
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {detections.map((detection, index) => {
        const { bounding_box, class: detectionClass, confidence } = detection;
        const colors = BB_COLOR;

        const { x, y, width, height } = bounding_box;
        const isHovered = hoveredIndex === index;

        // Calculate label position (above box, or inside if near top)
        const labelY = y > 24 ? y - 6 : y + 16;
        const labelBgY = y > 24 ? y - 24 : y + 2;

        return (
          <g key={index}>
            {/* Bounding box rectangle */}
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill={colors.bg}
              stroke={colors.border}
              strokeWidth={isHovered ? 4 : 3}
              className="pointer-events-auto cursor-pointer"
              style={{ transition: 'stroke-width 0.15s' }}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            />

            {/* Label background */}
            <rect
              x={x}
              y={labelBgY}
              width={Math.max(width, 90)}
              height={22}
              fill={colors.border}
              rx={3}
            />

            {/* Label text */}
            <text
              x={x + 6}
              y={labelY}
              fill={colors.text}
              fontSize={14}
              fontWeight={600}
              fontFamily="system-ui, -apple-system, sans-serif"
            >
              {detectionClass.toUpperCase()} {(confidence * 100).toFixed(0)}%
            </text>

            {/* Corner markers for emphasis */}
            {isHovered && (
              <>
                {/* Top-left corner */}
                <path
                  d={`M${x},${y + 15} L${x},${y} L${x + 15},${y}`}
                  fill="none"
                  stroke="white"
                  strokeWidth={3}
                />
                {/* Top-right corner */}
                <path
                  d={`M${x + width - 15},${y} L${x + width},${y} L${x + width},${y + 15}`}
                  fill="none"
                  stroke="white"
                  strokeWidth={3}
                />
                {/* Bottom-left corner */}
                <path
                  d={`M${x},${y + height - 15} L${x},${y + height} L${x + 15},${y + height}`}
                  fill="none"
                  stroke="white"
                  strokeWidth={3}
                />
                {/* Bottom-right corner */}
                <path
                  d={`M${x + width - 15},${y + height} L${x + width},${y + height} L${x + width},${y + height - 15}`}
                  fill="none"
                  stroke="white"
                  strokeWidth={3}
                />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Toggle button for showing/hiding bounding boxes
 */
export function BoundingBoxToggle({
  visible,
  onToggle,
  detectionCount,
  disabled,
}: {
  visible: boolean;
  onToggle: (visible: boolean) => void;
  detectionCount: number;
  disabled?: boolean;
}) {
  if (detectionCount === 0) return null;

  return (
    <button
      onClick={() => onToggle(!visible)}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
        visible
          ? 'bg-primary-600 text-white hover:bg-primary-700'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      title={visible ? 'Hide detection boxes' : 'Show detection boxes'}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={2}
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        {visible ? (
          <rect x="7" y="7" width="10" height="10" />
        ) : (
          <path d="M7 7h10M7 12h10M7 17h10" strokeDasharray="2 2" />
        )}
      </svg>
      <span>
        {visible ? 'Hide' : 'Show'} {detectionCount} detection{detectionCount !== 1 ? 's' : ''}
      </span>
    </button>
  );
}
