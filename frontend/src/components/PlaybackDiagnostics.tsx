import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { mediaUrl } from '../lib/api';
import { usePlayer } from '../context/PlayerContext';
import type { PlaybackDiagnostics as Snapshot } from '../context/PlayerContext';

/**
 * What the player is actually doing, in plain numbers.
 *
 * "It plays silently while the progress bar moves" is a real report and an
 * undebuggable one: it happens on a phone, there is no console to open, and
 * the two things that would explain it — a suspended audio context, or a deck
 * whose fade gain is stuck at zero while that same deck is the one playing —
 * look identical from the outside. Both are one number each, so this shows
 * them, and everything else that has to be true for sound to come out.
 *
 * Collapsed by default. It is a bug report you can screenshot, not a feature.
 */

/** `readyState` and `networkState` are integers nobody remembers. */
const READY_STATE = ['nothing', 'metadata', 'current data', 'future data', 'enough data'];
const NETWORK_STATE = ['empty', 'idle', 'loading', 'no source'];
const MEDIA_ERROR = ['', 'aborted', 'network', 'decode', 'source not supported'];

function Line({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-zinc-600">{label}</span>
      <span
        className={`min-w-0 break-all text-right font-mono ${warn ? 'text-amber-300' : 'text-zinc-300'}`}
      >
        {value}
      </span>
    </div>
  );
}

/** What a `Range: bytes=0-1` probe of the playing track came back with. */
interface Probe {
  status: number;
  contentType: string | null;
  contentRange: string | null;
  acceptRanges: string | null;
}

export function PlaybackDiagnostics() {
  const { getDiagnostics, current } = usePlayer();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [probe, setProbe] = useState<Probe | string | null>(null);
  const [probing, setProbing] = useState(false);

  // Polled rather than pushed: these are live properties of the audio
  // elements, which do not tell React when they change.
  useEffect(() => {
    if (!open) return;
    const read = () => setSnapshot(getDiagnostics());
    read();
    const timer = window.setInterval(read, 500);
    return () => window.clearInterval(timer);
  }, [open, getDiagnostics]);

  /**
   * Asks for the first two bytes of the playing track.
   *
   * Seeking, and on iOS playback at all, depends on the server answering a
   * range request with 206 and a Content-Range. That is verifiable here but
   * not from the machine running the server: what matters is what survives
   * whatever proxy or tunnel the phone is reaching it through.
   */
  const runProbe = async () => {
    if (!current) return;
    setProbing(true);
    setProbe(null);
    try {
      const response = await fetch(mediaUrl.stream(current.id), {
        headers: { Range: 'bytes=0-1' },
        credentials: 'include',
      });
      setProbe({
        status: response.status,
        contentType: response.headers.get('content-type'),
        contentRange: response.headers.get('content-range'),
        acceptRanges: response.headers.get('accept-ranges'),
      });
    } catch (error) {
      setProbe(error instanceof Error ? error.message : 'the request failed');
    } finally {
      setProbing(false);
    }
  };

  const standalone =
    typeof navigator !== 'undefined' &&
    ((navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches);

  return (
    <details
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="border-t border-white/5 pt-5"
    >
      <summary className="cursor-pointer text-sm text-zinc-200">
        Playback diagnostics
        <span className="block text-xs leading-relaxed text-zinc-500">
          What the player is doing right now. Worth a screenshot if something sounds wrong.
        </span>
      </summary>

      <div className="mt-3 space-y-4 text-xs">
        <section>
          <h4 className="pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-accent-300">
            This device
          </h4>
          <Line label="Installed app" value={standalone ? 'yes' : 'no (browser tab)'} />
          <Line label="Origin" value={window.location.origin} />
          <Line label="Browser" value={navigator.userAgent} />
        </section>

        <section>
          <h4 className="pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-accent-300">
            Processing
          </h4>
          {!snapshot ? (
            <p className="py-1 text-zinc-600">Reading…</p>
          ) : !snapshot.graphReady ? (
            <Line label="Audio graph" value="off — playing straight from the file" />
          ) : (
            <>
              {/* A suspended context is the whole answer when there is no
                  sound: every deck feeds it, and nothing downstream runs. */}
              <Line
                label="Context"
                value={snapshot.contextState ?? 'none'}
                warn={snapshot.contextState !== 'running'}
              />
              <Line label="Sample rate" value={`${snapshot.sampleRate ?? '?'} Hz`} />
              <Line label="Active deck" value={String(snapshot.activeDeck)} />
            </>
          )}
        </section>

        {snapshot?.decks.map((deck) => (
          <section key={deck.index}>
            <h4 className="pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-accent-300">
              Deck {deck.index}
              {deck.isActive && <span className="ml-2 tracking-normal text-zinc-500">playing</span>}
            </h4>
            {/* The pair that matters: the deck the transport points at must
                also be the one whose gain is up. */}
            {deck.fadeGain !== null && (
              <Line
                label="Output gain"
                value={deck.fadeGain.toFixed(3)}
                warn={deck.isActive && deck.fadeGain < 0.5}
              />
            )}
            <Line label="Paused" value={deck.paused ? 'yes' : 'no'} />
            <Line label="Position" value={`${deck.currentTime.toFixed(1)}s of ${deck.duration?.toFixed(1) ?? '?'}s`} />
            <Line label="Buffered" value={READY_STATE[deck.readyState] ?? String(deck.readyState)} />
            <Line label="Network" value={NETWORK_STATE[deck.networkState] ?? String(deck.networkState)} />
            <Line label="Element volume" value={`${deck.volume.toFixed(2)}${deck.muted ? ' (muted)' : ''}`} />
            {deck.errorCode !== null && (
              <Line label="Error" value={MEDIA_ERROR[deck.errorCode] ?? String(deck.errorCode)} warn />
            )}
            {deck.src && <Line label="Source" value={deck.src} />}
          </section>
        ))}

        <section>
          <h4 className="pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-accent-300">
            The connection
          </h4>
          <button
            type="button"
            onClick={() => void runProbe()}
            disabled={!current || probing}
            className="btn-ghost !px-3 !py-1.5 !text-xs"
          >
            {probing ? <Loader2 size={13} className="animate-spin" /> : 'Test the stream'}
          </button>
          {!current && <p className="pt-1.5 text-zinc-600">Play something first.</p>}
          {typeof probe === 'string' ? (
            <p className="pt-1.5 text-amber-300">{probe}</p>
          ) : (
            probe && (
              <div className="pt-1.5">
                {/* 206 with a Content-Range is what seeking needs, and what a
                    proxy in the way is most likely to have flattened. */}
                <Line label="Status" value={String(probe.status)} warn={probe.status !== 206} />
                <Line label="Type" value={probe.contentType ?? 'none'} />
                <Line
                  label="Range"
                  value={probe.contentRange ?? 'none'}
                  warn={!probe.contentRange}
                />
                <Line label="Accepts ranges" value={probe.acceptRanges ?? 'none'} />
              </div>
            )
          )}
        </section>
      </div>
    </details>
  );
}
