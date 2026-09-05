import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Disc3, RefreshCw, Wrench } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { siteName } from '../lib/config';

/**
 * Shown to everyone except admins while maintenance mode is on.
 *
 * It re-checks the site state on its own every 20 seconds, so people get back
 * in as soon as the switch is flipped rather than having to guess when to
 * reload.
 */
export function MaintenancePage() {
  const { info } = useAuth();
  const queryClient = useQueryClient();
  const message = info?.maintenance?.message ?? 'The archive is closed for maintenance.';

  useEffect(() => {
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['auth', 'context'] });
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [queryClient]);

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center px-4 py-10 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[min(32rem,100vw)] -translate-x-1/2 rounded-full bg-accent-500/15 blur-3xl"
      />

      <div className="relative w-full max-w-md text-center animate-fade-up">
        <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-glow shadow-glow">
          <Disc3 size={30} className="animate-spin text-white" style={{ animationDuration: '4s' }} />
        </span>

        <h1 className="text-lg font-extrabold tracking-[0.16em] text-white">{siteName}</h1>

        <div className="surface mt-6 space-y-4 p-6">
          <span className="pill pill-accent mx-auto">
            <Wrench size={12} />
            Maintenance
          </span>

          <p className="text-balance text-sm leading-relaxed text-zinc-300">{message}</p>

          <p className="text-xs text-zinc-600">
            This page checks back on its own — it will let you in as soon as the archive reopens.
          </p>

          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['auth', 'context'] })}
            className="btn-ghost mx-auto"
          >
            <RefreshCw size={15} />
            Check again
          </button>
        </div>
      </div>
    </div>
  );
}
