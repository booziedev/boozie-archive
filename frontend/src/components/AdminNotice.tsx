import { Megaphone, X } from 'lucide-react';

import { usePresence } from '../context/PresenceContext';

/**
 * A note an admin pushed to this one person's screen.
 *
 * The site-wide announcement banner sits above this in the layout and says the
 * same sort of thing to everybody; this is the version addressed to you, so it
 * is coloured differently and cannot be confused with site news.
 *
 * It arrives on the presence poll that was happening anyway, and is shown once
 * per message rather than for as long as the column holds a value — the
 * dedupe-by-stamp lives in PresenceContext, so dismissing it here is final
 * until an admin sends another.
 */
export function AdminNotice() {
  const { notice, dismissNotice } = usePresence();
  if (!notice) return null;

  return (
    <div className="border-b border-accent-400/20 bg-accent-400/10">
      <div className="mx-auto flex max-w-[1800px] items-start gap-2 px-4 py-2 text-xs text-accent-100 sm:px-6">
        <Megaphone size={13} className="mt-0.5 shrink-0" />
        <p className="min-w-0 flex-1 leading-relaxed">{notice}</p>
        <button
          type="button"
          onClick={dismissNotice}
          aria-label="Dismiss"
          className="-m-1 shrink-0 rounded-lg p-1 text-accent-200/70 transition-colors hover:text-accent-100"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
