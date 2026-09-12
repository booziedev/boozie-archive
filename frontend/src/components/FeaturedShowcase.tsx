import { Link } from 'react-router-dom';
import { Globe, Play } from 'lucide-react';

import { CoverImage } from './CoverImage';
import { usePlayer } from '../context/PlayerContext';
import type { FeaturedItem, FeaturedKind, FeaturedList, Showcase } from '../lib/types';

/**
 * Somebody's featured tracks, artists and albums.
 *
 * The centrepiece of a profile: three ranked lists they chose by hand. Picks
 * from this archive play and link straight into the collection; picks from the
 * catalogue are there to be looked at, because a favourite record is very
 * often not one this archive holds and a showcase that could only describe the
 * collection would be a poor showcase.
 *
 * The ranks are what make this read as somebody's chart rather than a grid of
 * covers, so they lead every label.
 */

const SECTIONS: { kind: FeaturedKind; key: keyof Showcase; title: string }[] = [
  { kind: 'track', key: 'tracks', title: 'Top tracks' },
  { kind: 'artist', key: 'artists', title: 'Top artists' },
  { kind: 'album', key: 'albums', title: 'Top albums' },
];

/**
 * How wide a tile sits, by how many are shown.
 *
 * Three is a statement, so the tiles are large. Ten would be unreadable in one
 * row — at a normal width the art would be thumbnail-sized — so it becomes two
 * rows of five. Below `sm` every size turns into a horizontal rail instead,
 * which beats cramming five covers across a phone.
 */
function gridFor(slots: number): string {
  if (slots <= 3) return 'sm:grid-cols-3';
  return 'sm:grid-cols-5';
}

function Tile({
  item,
  rank,
  onPlay,
}: {
  item: FeaturedItem;
  rank: number;
  onPlay?: () => void;
}) {
  const round = item.kind === 'artist' ? 'rounded-full' : 'rounded-2xl';
  const playable = Boolean(item.track) && Boolean(onPlay);

  const art = (
    <span className="relative block">
      <CoverImage
        id={item.coverId ?? item.id}
        name={item.title}
        src={item.artUrl}
        size={320}
        // An archive pick with no artwork and no override has nothing to fetch;
        // letting CoverImage try would just be a wasted request per tile.
        hasCover={Boolean(item.artUrl || item.coverId)}
        rounded={round}
        className={`aspect-square w-full ${
          rank === 1 ? 'ring-2 ring-accent-500/60 shadow-glow' : ''
        }`}
      />

      {playable && (
        <span
          aria-hidden
          className={`absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-200 ease-vault group-hover:opacity-100 group-focus-visible:opacity-100 ${round}`}
        >
          <Play size={22} className="fill-current text-white" />
        </span>
      )}

      {item.external && (
        <span
          aria-hidden
          title="Not in this archive"
          className="absolute bottom-1 right-1 rounded-full bg-black/60 p-1 text-zinc-400 backdrop-blur-sm"
        >
          <Globe size={11} />
        </span>
      )}
    </span>
  );

  /*
   * The rank leads the label rather than being stamped over the artwork.
   *
   * A numeral laid across the tile is the obvious way to make this read as a
   * chart, and it was the first thing tried — but at any size big enough to
   * register it either sat on somebody's face or collided with the title
   * underneath. In the text row it still carries the ranking and the title
   * stays legible, which is the part that actually matters.
   */
  const label = (
    <span className="mt-2 flex min-w-0 items-baseline gap-1.5">
      <span
        aria-hidden
        className="shrink-0 text-lg font-black leading-none tabular-nums text-white/25"
      >
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-zinc-100">{item.title}</span>
        {item.subtitle && (
          <span className="block truncate text-xs text-zinc-500">{item.subtitle}</span>
        )}
      </span>
    </span>
  );

  const inner = (
    <>
      {art}
      {label}
    </>
  );

  /*
   * `w-full` is load-bearing, not decoration.
   *
   * A playable pick is a <button>, and a button sizes itself to its content
   * however it is displayed — so without this the archive tiles shrank to
   * their artwork while the catalogue ones, which are plain spans, filled
   * their grid cell. Same row, two different tile sizes.
   */
  const shell = 'group block w-full min-w-0 text-left';

  if (item.track && onPlay) {
    return (
      <button type="button" onClick={onPlay} className={shell} title={`Play ${item.title}`}>
        {inner}
      </button>
    );
  }
  if (item.libraryId) {
    return (
      <Link
        to={item.kind === 'artist' ? `/artists/${item.libraryId}` : `/albums/${item.libraryId}`}
        className={shell}
      >
        {inner}
      </Link>
    );
  }
  // Catalogue-only: nothing to open, so nothing that looks clickable.
  return (
    <span className={shell} title={`${item.title} — not in this archive`}>
      {inner}
    </span>
  );
}

function Section({
  title,
  list,
  onPlay,
}: {
  title: string;
  list: FeaturedList;
  onPlay: (item: FeaturedItem) => void;
}) {
  if (list.items.length === 0) return null;

  return (
    <section>
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
        {title}
      </p>

      {/*
        A rail on phones, a grid from `sm` up. The negative margin lets the rail
        run to the screen edge, so it reads as designed rather than clipped.
      */}
      <div
        className={`-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:gap-x-4 sm:gap-y-5 sm:overflow-visible sm:px-0 sm:pb-0 ${gridFor(
          list.slots,
        )}`}
      >
        {list.items.map((item, index) => (
          <div key={item.id} className="w-28 shrink-0 snap-start sm:w-auto">
            <Tile item={item} rank={index + 1} onPlay={() => onPlay(item)} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function FeaturedShowcase({ showcase }: { showcase: Showcase }) {
  const { playTracks } = usePlayer();

  const empty = SECTIONS.every(({ key }) => showcase[key].items.length === 0);
  // Three empty headings would say nothing; an absent panel says the same and
  // takes up no room.
  if (empty) return null;

  /**
   * Playing a featured track starts the whole featured run from there.
   *
   * These are somebody's favourite tracks in an order they chose — queuing
   * just the one would waste the only sequence on the page worth listening to.
   * Catalogue picks are skipped, since there is no file behind them.
   */
  const play = (item: FeaturedItem) => {
    const queue = showcase.tracks.items.flatMap((entry) => (entry.track ? [entry.track] : []));
    const from = queue.findIndex((track) => track.id === item.track?.id);
    if (queue.length > 0 && from !== -1) playTracks(queue, from);
  };

  return (
    <section className="surface space-y-7 p-5">
      {SECTIONS.map(({ key, title }) => (
        <Section key={key} title={title} list={showcase[key]} onPlay={play} />
      ))}
    </section>
  );
}
