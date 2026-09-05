import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Loader2,
  Megaphone,
  Music2,
  Play,
  Wrench,
  X,
} from 'lucide-react';

import { SectionHeader } from './PageHeader';
import { EmptyState } from './states';
import { admin } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';
import type { Suggestion, SuggestionStatus } from '../lib/types';

/**
 * Admin-only site controls: maintenance mode, the global announcement, and the
 * queue of member suggestions waiting on a decision.
 */
export function AdminSiteControls() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['admin', 'settings'], queryFn: admin.settings });
  const [error, setError] = useState<string | null>(null);

  const settings = settingsQuery.data?.settings;
  const [announcement, setAnnouncement] = useState('');
  const [maintenanceMessage, setMaintenanceMessage] = useState('');

  // Seed the fields once the current values arrive.
  useEffect(() => {
    if (!settings) return;
    setAnnouncement(settings.announcement.message);
    setMaintenanceMessage(settings.maintenance.message);
  }, [settings]);

  function refresh() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] }),
      // The banner and the maintenance gate both read the public context.
      queryClient.invalidateQueries({ queryKey: ['auth', 'context'] }),
    ]);
  }
  const onError = (actionError: unknown) =>
    setError(actionError instanceof Error ? actionError.message : 'That action failed.');

  const toggleMaintenance = useMutation({
    mutationFn: (enabled: boolean) => admin.setMaintenance(enabled, maintenanceMessage),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError,
  });

  const saveAnnouncement = useMutation({
    mutationFn: (enabled: boolean) => admin.setAnnouncement(enabled, announcement),
    onSuccess: async () => {
      setError(null);
      await refresh();
    },
    onError,
  });

  const maintenanceOn = settings?.maintenance.enabled ?? false;
  const announcementOn = settings?.announcement.enabled ?? false;

  return (
    <>
      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* --------------------------- maintenance ------------------------- */}
      <section
        className={`surface space-y-4 p-5 ${maintenanceOn ? 'border-amber-400/30 bg-amber-400/[0.04]' : ''}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wrench size={17} className={maintenanceOn ? 'text-amber-300' : 'text-accent-400'} />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
              Maintenance mode
            </h2>
            {maintenanceOn && (
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                On
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => toggleMaintenance.mutate(!maintenanceOn)}
            disabled={toggleMaintenance.isPending}
            className={maintenanceOn ? 'btn-ghost' : 'btn-primary'}
          >
            {toggleMaintenance.isPending && <Loader2 size={15} className="animate-spin" />}
            {maintenanceOn ? 'Reopen the archive' : 'Close for maintenance'}
          </button>
        </div>

        <p className="text-xs leading-relaxed text-zinc-500">
          While this is on, everyone except admins is sent to <code>/maintenance</code> and the API
          turns them away. You keep full access, and new sign-ups are paused.
        </p>

        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
            Message shown to members
          </span>
          <input
            type="text"
            value={maintenanceMessage}
            onChange={(event) => setMaintenanceMessage(event.target.value.slice(0, 500))}
            placeholder="Back in an hour — adding new albums."
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
          />
        </label>

        {maintenanceOn && (
          <button
            type="button"
            onClick={() => toggleMaintenance.mutate(true)}
            disabled={toggleMaintenance.isPending}
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            Update the message
          </button>
        )}
      </section>

      {/* -------------------------- announcement ------------------------- */}
      <section className="surface space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Megaphone size={17} className="text-accent-400" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
            Global announcement
          </h2>
          {announcementOn && (
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              Live
            </span>
          )}
        </div>

        <p className="text-xs leading-relaxed text-zinc-500">
          Shown as a banner at the top of the archive for everyone. Editing it makes it reappear for
          people who dismissed the previous one.
        </p>

        <input
          type="text"
          value={announcement}
          onChange={(event) => setAnnouncement(event.target.value.slice(0, 500))}
          placeholder="Something everyone should know…"
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => saveAnnouncement.mutate(true)}
            disabled={!announcement.trim() || saveAnnouncement.isPending}
            className="btn-primary"
          >
            {saveAnnouncement.isPending && <Loader2 size={15} className="animate-spin" />}
            Submit
          </button>
          {announcementOn && (
            <button
              type="button"
              onClick={() => saveAnnouncement.mutate(false)}
              disabled={saveAnnouncement.isPending}
              className="btn-ghost"
            >
              Clear
            </button>
          )}
          <span className="text-xs tabular-nums text-zinc-600">{announcement.length}/500</span>
        </div>
      </section>

      <SuggestionQueue onError={onError} />
    </>
  );
}

const STATUS_STYLES: Record<SuggestionStatus, string> = {
  pending: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  accepted: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  denied: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
};

/** The review queue: listen, then accept into the library or deny. */
function SuggestionQueue({ onError }: { onError: (error: unknown) => void }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<SuggestionStatus>('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ['admin', 'suggestions', filter],
    queryFn: () => admin.suggestions(filter),
  });

  function refresh() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'suggestions'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] }),
      // An accepted track lands in the library and triggers a rescan.
      queryClient.invalidateQueries({ queryKey: ['stats'] }),
    ]);
  }

  const accept = useMutation({
    mutationFn: (id: string) => admin.acceptSuggestion(id, notes[id]),
    onSuccess: refresh,
    onError,
  });
  const deny = useMutation({
    mutationFn: (id: string) => admin.denySuggestion(id, notes[id]),
    onSuccess: refresh,
    onError,
  });

  const items = query.data?.suggestions ?? [];
  const busy = accept.isPending || deny.isPending;

  return (
    <section>
      <SectionHeader
        title={`Suggestions${filter === 'pending' && items.length ? ` (${items.length} waiting)` : ''}`}
        action={
          <div className="flex gap-1">
            {(['pending', 'accepted', 'denied'] as SuggestionStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setFilter(status)}
                className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  filter === status ? 'bg-white/10 text-white' : 'text-zinc-600 hover:text-zinc-300'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        }
      />

      {query.isLoading ? (
        <div className="surface p-6 text-sm text-zinc-500">Loading…</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Music2 size={22} />}
          title={`Nothing ${filter}`}
          description={
            filter === 'pending'
              ? 'Member suggestions and uploads land here for review.'
              : undefined
          }
        />
      ) : (
        <div className="surface divide-y divide-white/[0.04]">
          {items.map((suggestion) => (
            <ReviewRow
              key={suggestion.id}
              suggestion={suggestion}
              note={notes[suggestion.id] ?? ''}
              onNote={(value) => setNotes((current) => ({ ...current, [suggestion.id]: value }))}
              onAccept={() => accept.mutate(suggestion.id)}
              onDeny={() => deny.mutate(suggestion.id)}
              busy={busy}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewRow({
  suggestion,
  note,
  onNote,
  onAccept,
  onDeny,
  busy,
}: {
  suggestion: Suggestion;
  note: string;
  onNote: (value: string) => void;
  onAccept: () => void;
  onDeny: () => void;
  busy: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const pending = suggestion.status === 'pending';

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill">{suggestion.kind}</span>
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[suggestion.status]}`}
            >
              {suggestion.status}
            </span>
            <span className="text-xs text-zinc-600">
              {suggestion.author ? `@${suggestion.author}` : 'deleted account'} ·{' '}
              {formatDate(suggestion.createdAt)}
            </span>
          </div>

          {suggestion.fileName && (
            <p className="mt-1.5 truncate text-sm font-medium text-zinc-100">
              {suggestion.fileName}
              {suggestion.bytes ? (
                <span className="ml-2 text-xs font-normal text-zinc-600">
                  {formatBytes(suggestion.bytes)}
                </span>
              ) : null}
            </p>
          )}
          {suggestion.body && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-300">
              {suggestion.body}
            </p>
          )}
          {suggestion.libraryPath && (
            <p className="mt-1 font-mono text-xs text-emerald-400/80">→ {suggestion.libraryPath}</p>
          )}
          {suggestion.reviewNote && (
            <p className="mt-1.5 text-xs text-zinc-500">Note: {suggestion.reviewNote}</p>
          )}
        </div>
      </div>

      {/* Listen before deciding — the file is still in quarantine. */}
      {suggestion.kind === 'track' && pending && (
        <div>
          {playing ? (
            <audio
              controls
              autoPlay
              preload="none"
              src={admin.suggestionFileUrl(suggestion.id)}
              className="h-9 w-full max-w-md"
            />
          ) : (
            <button type="button" onClick={() => setPlaying(true)} className="btn-ghost px-3 py-1.5 text-xs">
              <Play size={13} />
              Listen before deciding
            </button>
          )}
        </div>
      )}

      {pending && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={note}
            onChange={(event) => onNote(event.target.value.slice(0, 500))}
            placeholder="Reply to the member (optional)"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
          />
          <button type="button" onClick={onAccept} disabled={busy} className="btn-primary px-3 py-2 text-xs">
            <Check size={14} />
            Accept
          </button>
          <button type="button" onClick={onDeny} disabled={busy} className="btn-ghost px-3 py-2 text-xs">
            <X size={14} />
            Deny
          </button>
        </div>
      )}
    </div>
  );
}
