import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';

import { useAuth } from '../context/AuthContext';

const DISMISSED_KEY = 'boozie.announcement.dismissed';

/**
 * The global announcement, set by an admin.
 *
 * Dismissal is remembered per announcement *version*, so hiding one message
 * doesn't silently hide the next one an admin posts.
 */
export function AnnouncementBanner() {
  const { info } = useAuth();
  const announcement = info?.announcement ?? null;
  const [dismissed, setDismissed] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      setDismissed(raw === null ? null : Number.parseInt(raw, 10));
    } catch {
      setDismissed(null);
    }
  }, []);

  if (!announcement || dismissed === announcement.version) return null;

  function dismiss() {
    if (!announcement) return;
    setDismissed(announcement.version);
    try {
      localStorage.setItem(DISMISSED_KEY, String(announcement.version));
    } catch {
      // Storage disabled: it will simply reappear next visit.
    }
  }

  return (
    <div className="border-b border-accent-500/20 bg-accent-500/10">
      <div className="mx-auto flex max-w-[1800px] items-start gap-3 px-4 py-2.5 sm:px-6">
        <Megaphone size={16} className="mt-0.5 shrink-0 text-accent-300" />
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-accent-100">
          {announcement.message}
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcement"
          className="icon-btn h-7 w-7 shrink-0 text-accent-200 hover:text-white"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
