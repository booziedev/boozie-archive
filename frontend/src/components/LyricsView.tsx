import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MicVocal } from 'lucide-react';

import { ApiError, api } from '../lib/api';
import { usePlayer } from '../context/PlayerContext';
import type { LyricLine, Track } from '../lib/types';

/**
 * Lyrics for the playing track, scrolling along with it when they are timed.
 *
 * Shares the `['lyrics', id]` query with the track-details dialog, so opening
 * one after the other is a single request. A 404 is the server saying this
 * track has no words anywhere, which is an answer rather than an error — hence
 * `retry: false` and a plain message instead of a failure state.
 */

/** Where the playhead is, polled off the audio element rather than React. */
function usePosition(active: boolean): number {
  const { getPosition } = usePlayer();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;

    let frame = 0;
    let last = -1;
    const tick = () => {
      const now = getPosition();
      // Only re-render when the answer changed by enough to move a line. The
      // element's position updates continuously; the lyrics do not.
      if (Math.abs(now - last) > 0.08) {
        last = now;
        setSeconds(now);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, getPosition]);

  return seconds;
}

/** Index of the last line whose timestamp has passed, or -1 before the first. */
function activeIndex(lines: { at: number }[], seconds: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((lines[mid]?.at ?? 0) <= seconds) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

export function LyricsView({ track, active }: { track: Track; active: boolean }) {
  const query = useQuery({
    queryKey: ['lyrics', track.id],
    queryFn: () => api.lyrics(track.id),
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled: active,
  });

  const seconds = usePosition(active && (query.data?.synced.length ?? 0) > 0);
  const lyrics = query.data;
  const synced = lyrics?.synced ?? [];
  const index = synced.length > 0 ? activeIndex(synced, seconds) : -1;

  const scroller = useRef<HTMLDivElement>(null);
  const activeLine = useRef<HTMLParagraphElement>(null);

  /**
   * Keeps the current line in the middle of the panel.
   *
   * Layout effect rather than effect: the line is measured and scrolled in the
   * same frame it lights up, so seeking lands on the right line instead of
   * visibly crawling towards it. `scrollTop` is set directly rather than with
   * scrollIntoView, which would also scroll the page behind the overlay.
   */
  useLayoutEffect(() => {
    const box = scroller.current;
    const line = activeLine.current;
    if (!box || !line) return;
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: 'smooth',
    });
  }, [index]);

  if (query.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-500">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  const missing =
    query.isError && query.error instanceof ApiError && query.error.status === 404;

  if (missing || (!lyrics && query.isError)) {
    return (
      <Message
        title="No lyrics for this one"
        body="Nothing beside the file, nothing in its tags, and the online database has not got it either."
      />
    );
  }

  if (lyrics?.instrumental) {
    return <Message title="Instrumental" body="This recording has no words." />;
  }

  if (!lyrics) return null;

  if (synced.length === 0) {
    return (
      <div className="scroll-touch min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <p className="mx-auto max-w-xl whitespace-pre-wrap text-center text-base leading-relaxed text-zinc-300">
          {lyrics.text}
        </p>
        <Attribution source={lyrics.source} />
      </div>
    );
  }

  return (
    <div
      ref={scroller}
      className="scroll-touch no-scrollbar min-h-0 flex-1 overflow-y-auto px-6"
      // Lines fade out at the top and bottom rather than being sliced off by
      // the header and the transport.
      style={{
        maskImage: 'linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)',
      }}
    >
      {/* Half a panel of padding top and bottom, so the first and last lines
          can still sit in the middle rather than pinned to an edge. */}
      <div className="mx-auto max-w-xl space-y-4 py-[40vh] text-center">
        {synced.map((line: LyricLine, i: number) => (
          <p
            key={`${line.at}-${i}`}
            ref={i === index ? activeLine : undefined}
            aria-current={i === index ? 'true' : undefined}
            className={`text-balance text-xl font-semibold leading-snug transition-all duration-500 ease-vault sm:text-2xl ${
              i === index
                ? 'scale-[1.02] text-white'
                : i < index
                  ? 'text-zinc-600'
                  : 'text-zinc-500'
            }`}
          >
            {line.text}
          </p>
        ))}
        <Attribution source={lyrics.source} />
      </div>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <MicVocal size={26} className="text-zinc-700" />
      <p className="text-base font-semibold text-zinc-300">{title}</p>
      <p className="max-w-sm text-sm text-zinc-500">{body}</p>
    </div>
  );
}

/** Credit where the words came from — LRCLIB asks for it, and it is fair. */
function Attribution({ source }: { source: 'lrc' | 'tags' | 'lrclib' }) {
  if (source !== 'lrclib') return null;
  return (
    <p className="pt-8 text-[11px] uppercase tracking-[0.2em] text-zinc-700">Lyrics via LRCLIB</p>
  );
}
