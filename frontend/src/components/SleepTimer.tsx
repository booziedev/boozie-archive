import { useEffect, useRef, useState } from 'react';
import { Moon } from 'lucide-react';

import { usePlayer } from '../context/PlayerContext';

const OPTIONS = [15, 30, 45, 60, 90];

/** "24:31" while it counts down. */
function remaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Stop playing after a while.
 *
 * It pauses rather than clearing the queue, so picking the music back up in the
 * morning is one tap — the point is to fall asleep to it, not to lose your
 * place.
 */
export function SleepTimer({ className = '' }: { className?: string }) {
  const { sleepRemainingMs, setSleepTimer } = usePlayer();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const running = sleepRemainingMs !== null;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={running ? `Sleep timer: ${remaining(sleepRemainingMs)} left` : 'Sleep timer'}
        title={running ? `Stopping in ${remaining(sleepRemainingMs)}` : 'Sleep timer'}
        className={`icon-btn ${running ? 'text-accent-400' : ''}`}
      >
        <Moon size={18} />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-44 rounded-xl border border-white/10 bg-ink-850 p-2 shadow-lift">
          <p className="px-1.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {running ? `Stopping in ${remaining(sleepRemainingMs)}` : 'Stop playing after'}
          </p>

          <div className="grid grid-cols-3 gap-1">
            {OPTIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => {
                  setSleepTimer(minutes);
                  setOpen(false);
                }}
                className="rounded-lg border border-white/10 px-1 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/5"
              >
                {minutes}m
              </button>
            ))}
          </div>

          {running && (
            <button
              type="button"
              onClick={() => {
                setSleepTimer(null);
                setOpen(false);
              }}
              className="btn-ghost mt-1.5 w-full justify-center px-2 py-1 text-xs"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
