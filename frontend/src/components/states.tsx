import { AlertTriangle, Disc3, RefreshCw, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';

/** Card grid placeholder shown while a page's first request is in flight. */
export function CardGridSkeleton({ count = 12, circle = false }: { count?: number; circle?: boolean }) {
  return (
    <div className="card-grid" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="space-y-3">
          <div className={`skeleton aspect-square w-full ${circle ? 'rounded-full' : 'rounded-xl'}`} />
          <div className="skeleton h-3.5 w-4/5 rounded" />
          <div className="skeleton h-3 w-2/5 rounded" />
        </div>
      ))}
    </div>
  );
}

export function TrackListSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="space-y-1.5" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 rounded-xl px-3 py-2.5">
          <div className="skeleton h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-1/3 rounded" />
            <div className="skeleton h-3 w-1/5 rounded" />
          </div>
          <div className="skeleton h-3 w-10 rounded" />
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="surface flex flex-col items-center gap-3 px-6 py-16 text-center animate-fade-in">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-500">
        {icon ?? <SearchX size={24} />}
      </div>
      <h3 className="text-base font-semibold text-zinc-200">{title}</h3>
      {description && <p className="max-w-md text-sm leading-relaxed text-zinc-500">{description}</p>}
      {action}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

/** Consistent failure card — every page routes its query error through this. */
export function ErrorState({ error, onRetry, title = 'Something went wrong' }: ErrorStateProps) {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred while loading data.';

  return (
    <div className="surface flex flex-col items-center gap-4 border-red-500/20 px-6 py-14 text-center animate-fade-in">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400">
        <AlertTriangle size={24} />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
        <p className="mx-auto max-w-lg text-sm leading-relaxed text-zinc-400">{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-ghost">
          <RefreshCw size={15} />
          Try again
        </button>
      )}
    </div>
  );
}

/** Shown when the backend is reachable but the library index is still empty. */
export function ScanningState() {
  return (
    <div className="surface flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Disc3 size={30} className="animate-spin text-accent-400" style={{ animationDuration: '3s' }} />
      <h3 className="text-base font-semibold text-zinc-200">Indexing the collection…</h3>
      <p className="max-w-md text-sm leading-relaxed text-zinc-500">
        The server is reading tags from your files. The first scan of a large library can take a
        while — this page will fill in as soon as it finishes.
      </p>
    </div>
  );
}
