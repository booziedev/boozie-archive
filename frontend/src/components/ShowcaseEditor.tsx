import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Globe, ImagePlus, Loader2, Plus, RotateCcw, X } from 'lucide-react';

import { CoverImage } from './CoverImage';
import { FeaturedPicker } from './FeaturedPicker';
import { showcase as api } from '../lib/api';
import { ACCEPTED_IMAGES, MAX_IMAGE_MB } from '../lib/images';
import { SLOT_CHOICES } from '../lib/showcase';
import type { FeaturedItem, FeaturedKind, FeaturedList, Showcase, SlotCount } from '../lib/types';

/**
 * Curating the showcase.
 *
 * Every change saves the moment it is made — there is no Save button. With a
 * picker, an art upload and a reorder all editing the same three lists, a
 * pending-changes model would mean half-saved states and a lot of ways to lose
 * work; landing each edit immediately means the tiles below always show exactly
 * what a visitor would see.
 */

const SECTIONS: { kind: FeaturedKind; key: keyof Showcase; title: string; slotKey: string }[] = [
  { kind: 'track', key: 'tracks', title: 'Top tracks', slotKey: 'trackSlots' },
  { kind: 'artist', key: 'artists', title: 'Top artists', slotKey: 'artistSlots' },
  { kind: 'album', key: 'albums', title: 'Top albums', slotKey: 'albumSlots' },
];

function Slot({
  item,
  rank,
  first,
  last,
  busy,
  onMove,
  onRemove,
  onArt,
  onClearArt,
}: {
  item: FeaturedItem;
  rank: number;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
  onArt: (file: File) => void;
  onClearArt: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const round = item.kind === 'artist' ? 'rounded-full' : 'rounded-xl';

  return (
    <div className="group relative">
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_IMAGES}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onArt(file);
        }}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />

      <div className="relative">
        <CoverImage
          id={item.coverId ?? item.id}
          name={item.title}
          src={item.artUrl}
          size={320}
          hasCover={Boolean(item.artUrl || item.coverId)}
          rounded={round}
          className="aspect-square w-full"
        />

        {busy && (
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/60 ${round}`}
          >
            <Loader2 size={18} className="animate-spin text-white" />
          </span>
        )}

        {item.external && (
          <span
            aria-hidden
            title="Not in this archive"
            className="absolute bottom-1 right-1 rounded-full bg-black/60 p-1 text-zinc-400 backdrop-blur-sm"
          >
            <Globe size={10} />
          </span>
        )}

        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove ${item.title}`}
          title="Remove"
          className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-ink-850 text-zinc-400 opacity-0 transition-opacity hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
        >
          <X size={12} />
        </button>
      </div>

      {/* Always visible on touch, where there is no hover to reveal them. */}
      <div className="mt-1.5 flex items-center justify-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
        <button
          type="button"
          disabled={first || busy}
          onClick={() => onMove(rank - 2)}
          aria-label={`Move ${item.title} up`}
          className="icon-btn h-7 w-7 disabled:opacity-25"
        >
          <ArrowLeft size={12} />
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          aria-label={`Change artwork for ${item.title}`}
          title={`Use your own artwork (up to ${MAX_IMAGE_MB} MB)`}
          className="icon-btn h-7 w-7"
        >
          <ImagePlus size={12} />
        </button>
        {item.artUrl?.startsWith('/api/featured-art/') && (
          <button
            type="button"
            onClick={onClearArt}
            disabled={busy}
            aria-label={`Use the original artwork for ${item.title}`}
            title="Back to the original artwork"
            className="icon-btn h-7 w-7"
          >
            <RotateCcw size={12} />
          </button>
        )}
        <button
          type="button"
          disabled={last || busy}
          onClick={() => onMove(rank)}
          aria-label={`Move ${item.title} down`}
          className="icon-btn h-7 w-7 disabled:opacity-25"
        >
          <ArrowRight size={12} />
        </button>
      </div>

      <p className="mt-0.5 truncate text-center text-xs text-zinc-400" title={item.title}>
        <span className="text-zinc-600">{rank}. </span>
        {item.title}
      </p>
    </div>
  );
}

function Section({
  title,
  slotKey,
  list,
  onPick,
  onError,
}: {
  title: string;
  slotKey: string;
  list: FeaturedList;
  onPick: () => void;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const applied = (data: { showcase: Showcase }) => {
    queryClient.setQueryData(['profile', 'me'], (old: unknown) =>
      old && typeof old === 'object' ? { ...(old as object), showcase: data.showcase } : old,
    );
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
  };
  const failed = (error: unknown, fallback: string) =>
    onError(error instanceof Error ? error.message : fallback);

  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: number }) => api.move(id, to),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: applied,
    onError: (error) => failed(error, 'Could not reorder that.'),
    onSettled: () => setBusyId(null),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: applied,
    onError: (error) => failed(error, 'Could not remove that.'),
    onSettled: () => setBusyId(null),
  });

  const art = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => api.uploadArt(id, file),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: applied,
    onError: (error) => failed(error, 'Could not upload that image.'),
    onSettled: () => setBusyId(null),
  });

  const clearArt = useMutation({
    mutationFn: (id: string) => api.clearArt(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: applied,
    onError: (error) => failed(error, 'Could not reset the artwork.'),
    onSettled: () => setBusyId(null),
  });

  const slots = useMutation({
    mutationFn: (count: SlotCount) => api.setSlots({ [slotKey]: count }),
    onSuccess: applied,
    onError: (error) => failed(error, 'Could not change the length.'),
  });

  /** Cheap client-side checks, so an obvious mistake costs no round trip. */
  const pickArt = (id: string, file: File) => {
    if (!ACCEPTED_IMAGES.split(',').includes(file.type)) {
      onError('Choose a PNG, JPEG, GIF or WebP image.');
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      onError(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_IMAGE_MB} MB.`,
      );
      return;
    }
    art.mutate({ id, file });
  };

  const shown = list.items;
  const empties = Math.max(0, list.slots - shown.length);
  const grid = list.slots <= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-5';

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">{title}</p>

        <div className="flex items-center gap-1" role="group" aria-label={`How many ${title}`}>
          <span className="mr-1 text-[10px] uppercase tracking-wider text-zinc-700">Show</span>
          {SLOT_CHOICES.map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => slots.mutate(count)}
              disabled={slots.isPending}
              aria-pressed={list.slots === count}
              className={`h-6 min-w-7 rounded-full px-1.5 text-xs font-semibold tabular-nums transition-colors ${
                list.slots === count
                  ? 'bg-accent-500 text-white'
                  : 'border border-white/10 text-zinc-500 hover:border-white/20 hover:text-zinc-200'
              }`}
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      <div className={`grid grid-cols-3 gap-x-3 gap-y-4 ${grid}`}>
        {shown.map((item, index) => (
          <Slot
            key={item.id}
            item={item}
            rank={index + 1}
            first={index === 0}
            last={index === shown.length - 1}
            busy={busyId === item.id}
            onMove={(to) => move.mutate({ id: item.id, to })}
            onRemove={() => remove.mutate(item.id)}
            onArt={(file) => pickArt(item.id, file)}
            onClearArt={() => clearArt.mutate(item.id)}
          />
        ))}

        {Array.from({ length: empties }).map((_, index) => (
          <button
            key={`empty-${index}`}
            type="button"
            onClick={onPick}
            aria-label={`Add to ${title}`}
            className="flex aspect-square w-full items-center justify-center rounded-xl border border-dashed border-white/10 text-zinc-700 transition-colors hover:border-accent-500/40 hover:text-accent-400"
          >
            <Plus size={20} />
          </button>
        ))}
      </div>

      {list.hidden.length > 0 && (
        <p className="mt-2.5 text-xs leading-relaxed text-zinc-600">
          {list.hidden.length} more {list.hidden.length === 1 ? 'pick is' : 'picks are'} kept but
          not shown at {list.slots}
          {' — '}
          <span className="text-zinc-500">
            {list.hidden.map((item) => item.title).join(', ')}
          </span>
          . Show more to bring {list.hidden.length === 1 ? 'it' : 'them'} back.
        </p>
      )}
    </section>
  );
}

export function ShowcaseEditor({ showcase }: { showcase: Showcase }) {
  const [picking, setPicking] = useState<FeaturedKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="surface space-y-7 p-5">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
          Your showcase
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          The tracks, artists and albums you want on your profile. Anything in this archive can be
          played from your profile by whoever is looking; anything else is there to be seen. Every
          change saves as you make it.
        </p>
      </div>

      {SECTIONS.map(({ kind, key, title, slotKey }) => (
        <Section
          key={key}
          slotKey={slotKey}
          title={title}
          list={showcase[key]}
          onPick={() => {
            setError(null);
            setPicking(kind);
          }}
          onError={setError}
        />
      ))}

      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {picking && (
        <FeaturedPicker
          kind={picking}
          showcase={showcase}
          onClose={() => setPicking(null)}
        />
      )}
    </section>
  );
}
