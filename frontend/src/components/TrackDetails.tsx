import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { api } from '../lib/api';
import { formatBytes, formatDuration, qualityLabel } from '../lib/format';
import type { Credits, Track } from '../lib/types';

/** Credit fields in the order a sleeve would print them. */
const CREDIT_ORDER: { key: keyof Credits; label: string }[] = [
  { key: 'composer', label: 'Composer' },
  { key: 'writer', label: 'Writer' },
  { key: 'lyricist', label: 'Lyricist' },
  { key: 'producer', label: 'Producer' },
  { key: 'engineer', label: 'Engineer' },
  { key: 'conductor', label: 'Conductor' },
  { key: 'remixer', label: 'Remixer' },
  { key: 'label', label: 'Label' },
  { key: 'catalogNumber', label: 'Catalogue' },
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 py-1.5">
      <dt className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">{label}</dt>
      <dd className="min-w-0 text-sm text-zinc-300">{value}</dd>
    </div>
  );
}

/**
 * Everything the file says about a track — *Tidal credits*, plus lyrics and
 * the technical detail that was previously buried in a tooltip.
 *
 * Only sections the file actually carries are drawn: a track with no credits
 * shows no empty "Credits" heading, because a blank field reads as missing
 * data rather than as an untagged file.
 */
export function TrackDetails({ track, onClose }: { track: Track; onClose: () => void }) {
  // Lyrics are a separate request: they can be long, and most tracks have none.
  const lyricsQuery = useQuery({
    queryKey: ['lyrics', track.id],
    queryFn: () => api.lyrics(track.id),
    // A 404 here means "this track has no lyrics", which is an answer, not a
    // failure — there is nothing to gain by asking again.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const credits = track.credits ?? {};
  const creditRows = CREDIT_ORDER.filter(({ key }) => (credits[key]?.length ?? 0) > 0);
  const lyrics = lyricsQuery.data;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        role="presentation"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
      />

      <div className="surface relative flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-b-none sm:rounded-2xl animate-scale-in">
        <header className="flex items-start justify-between gap-3 border-b border-white/5 px-4 py-3">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-100">{track.title}</span>
            <span className="block truncate text-xs text-zinc-500">{track.artist}</span>
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="icon-btn h-8 w-8 shrink-0">
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {creditRows.length > 0 && (
            <section className="pb-2">
              <h3 className="pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-accent-300">
                Credits
              </h3>
              <dl className="divide-y divide-white/[0.03]">
                {creditRows.map(({ key, label }) => (
                  <Row key={key} label={label} value={credits[key]!.join(', ')} />
                ))}
              </dl>
            </section>
          )}

          <section className="border-t border-white/5 pt-2">
            <h3 className="pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-accent-300">
              File
            </h3>
            <dl className="divide-y divide-white/[0.03]">
              <Row label="Quality" value={qualityLabel(track)} />
              {track.bpm !== undefined && <Row label="Tempo" value={`${track.bpm} BPM`} />}
              {track.key && <Row label="Key" value={track.key} />}
              {track.mood && <Row label="Mood" value={track.mood} />}
              {track.work && <Row label="Work" value={track.work} />}
              {track.movement && <Row label="Movement" value={track.movement} />}
              <Row label="Length" value={formatDuration(track.duration)} />
              <Row label="Size" value={formatBytes(track.size)} />
              {track.isrc && <Row label="ISRC" value={<span className="font-mono">{track.isrc}</span>} />}
              {track.replayGain?.trackGainDb !== undefined && (
                <Row
                  label="ReplayGain"
                  value={`${track.replayGain.trackGainDb > 0 ? '+' : ''}${track.replayGain.trackGainDb.toFixed(2)} dB`}
                />
              )}
              <Row
                label="Path"
                value={<span className="break-all font-mono text-xs text-zinc-500">{track.path}</span>}
              />
            </dl>
          </section>

          {lyrics && (
            <section className="mt-2 border-t border-white/5 pt-2">
              <h3 className="flex items-center gap-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-accent-300">
                Lyrics
                {lyrics.source === 'lrc' && lyrics.synced.length > 0 && (
                  <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] tracking-normal text-zinc-500">
                    timed
                  </span>
                )}
              </h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                {lyrics.text}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
