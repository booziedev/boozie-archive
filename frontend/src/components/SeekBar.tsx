import { useEffect, useRef, useState } from 'react';

interface SeekBarProps {
  value: number;
  max: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  /** Live updates while dragging (used for the volume slider). */
  onInput?: (value: number) => void;
  step?: number;
}

/**
 * Styled range input.
 *
 * While the user drags, the thumb follows the pointer locally and the change is
 * only committed on release — seeking on every intermediate value would fire a
 * new HTTP range request per pixel.
 */
export function SeekBar({
  value,
  max,
  onCommit,
  onInput,
  disabled = false,
  ariaLabel,
  className = '',
  step = 0.1,
}: SeekBarProps) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const dragging = useRef(false);

  // Track external progress unless the user is currently scrubbing.
  useEffect(() => {
    if (!dragging.current) setDragValue(null);
  }, [value]);

  const displayed = dragValue ?? value;
  const safeMax = max > 0 ? max : 1;
  const percent = Math.min(100, Math.max(0, (displayed / safeMax) * 100));

  function commit(next: number) {
    dragging.current = false;
    setDragValue(null);
    onCommit(next);
  }

  return (
    <input
      type="range"
      className={`vault-range ${className}`}
      style={{ ['--range-progress' as string]: `${percent}%` }}
      min={0}
      max={safeMax}
      step={step}
      value={displayed}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => {
        const next = Number(event.target.value);
        dragging.current = true;
        setDragValue(next);
        onInput?.(next);
      }}
      onPointerUp={(event) => commit(Number((event.target as HTMLInputElement).value))}
      onPointerCancel={() => {
        dragging.current = false;
        setDragValue(null);
      }}
      onKeyUp={(event) => commit(Number((event.target as HTMLInputElement).value))}
      onBlur={() => {
        if (dragging.current && dragValue !== null) commit(dragValue);
      }}
    />
  );
}
