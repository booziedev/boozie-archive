import { useEffect, useState } from 'react';
import { PauseCircle } from 'lucide-react';

import { Logo } from '../components/Logo';
import { useAuth } from '../context/AuthContext';
import { siteName } from '../lib/config';

/** "4 minutes", "1 hour 12 minutes" — precise enough to plan around. */
function remaining(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} minute${rest === 1 ? '' : 's'}` : ''}`;
}

/**
 * Shown while an admin has this account paused.
 *
 * The session is deliberately left signed in: being silently logged out would
 * look like a bug and invite a dozen sign-in attempts. Saying how long is left,
 * and letting themselves back in the moment it lapses, is the honest version.
 */
export function TimedOutPage() {
  const { user, refresh, signOut } = useAuth();
  const [now, setNow] = useState(() => Date.now());

  const until = user?.timeoutUntil ? new Date(user.timeoutUntil).getTime() : 0;
  const left = until - now;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Re-check as it lapses, so they are let back in without having to reload.
  useEffect(() => {
    if (left > 0) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [left, refresh]);

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[min(32rem,100vw)] -translate-x-1/2 rounded-full bg-amber-500/10 blur-3xl"
      />

      <div className="relative w-full max-w-md text-center animate-fade-up">
        <Logo size={68} className="mx-auto mb-5" />
        <h1 className="text-lg font-extrabold tracking-[0.16em] text-white">{siteName}</h1>

        <div className="surface mt-6 space-y-4 p-6">
          <PauseCircle size={28} className="mx-auto text-amber-400" />

          <p className="text-sm leading-relaxed text-zinc-300">
            An admin has paused your access for now.
          </p>

          <p className="text-sm leading-relaxed text-zinc-500">
            {left > 0 ? (
              <>
                It lifts on its own in{' '}
                <span className="font-semibold text-zinc-300">{remaining(left)}</span>.
              </>
            ) : (
              'Checking whether it has lifted…'
            )}
          </p>

          <button type="button" onClick={() => void signOut()} className="btn-ghost mx-auto">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
