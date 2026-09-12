import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Globe, Library, Loader2, Plus, Search, X } from 'lucide-react';

import { CoverImage } from './CoverImage';
import { useDebounced } from '../hooks/useDebounced';
import { showcase as api } from '../lib/api';
import type { FeaturedCandidate, FeaturedKind, Showcase } from '../lib/types';

/**
 * Finding something to feature.
 *
 * Two sources in one list, and the order is the point: what this archive holds
 * comes first, because those picks play and link into the collection, and the
 * catalogue follows for everything else. Somebody's favourite album is often
 * not one this Pi has, and a showcase that could only name the collection
 * would say much less about them.
 *
 * Debounced as you type rather than waiting for a submit, which the radio
 * station picker does out of courtesy to a volunteer-run directory. Here the
 * server caches searches and collapses concurrent identical ones, so typing
 * costs at most one upstream call per distinct term.
 */

const NOUNS: Record<FeaturedKind, string> = {
  track: 'a track',
  artist: 'an artist',
  album: 'an album',
};

function Row({
  candidate,
  taken,
  pending,
  onAdd,
}: {
  candidate: FeaturedCandidate;
  taken: boolean;
  pending: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/5">
      <CoverImage
        id={candidate.source === 'archive' ? candidate.id : `dz_${candidate.id}`}
        name={candidate.title}
        src={candidate.artUrl}
        size={128}
        hasCover={Boolean(candidate.artUrl)}
        rounded={candidate.kind === 'artist' ? 'rounded-full' : 'rounded-lg'}
        className="h-10 w-10 shrink-0"
      />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-zinc-100">{candidate.title}</span>
        {candidate.subtitle && (
          <span className="block truncate text-xs text-zinc-600">{candidate.subtitle}</span>
        )}
      </span>

      <button
        type="button"
        onClick={onAdd}
        disabled={taken || pending}
        aria-label={taken ? `${candidate.title} is already featured` : `Feature ${candidate.title}`}
        title={taken ? 'Already in this list' : 'Add to this list'}
        className="icon-btn h-8 w-8 shrink-0 disabled:opacity-40"
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : taken ? (
          <Check size={14} className="text-emerald-400" />
        ) : (
          <Plus size={14} />
        )}
      </button>
    </div>
  );
}

function Group({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
        {icon}
        {title}
        {hint && <span className="font-medium normal-case tracking-normal text-zinc-700">{hint}</span>}
      </p>
      {children}
    </div>
  );
}

export function FeaturedPicker({
  kind,
  showcase,
  onClose,
}: {
  kind: FeaturedKind;
  showcase: Showcase;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 260);
  const [error, setError] = useState<string | null>(null);

  const list =
    kind === 'track' ? showcase.tracks : kind === 'artist' ? showcase.artists : showcase.albums;
  const existing = [...list.items, ...list.hidden];
  const full = existing.length >= list.slots;

  // What is already featured, so a repeat shows as done rather than failing.
  const takenArchive = new Set(existing.map((item) => item.libraryId).filter(Boolean));
  const takenTitles = new Set(existing.map((item) => `${item.title}|${item.subtitle ?? ''}`));

  const results = useQuery({
    queryKey: ['catalogue', kind, debounced],
    queryFn: () => api.search(kind, debounced),
    enabled: debounced.trim().length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const add = useMutation({
    mutationFn: (candidate: FeaturedCandidate) =>
      api.add(
        kind,
        candidate.source === 'archive'
          ? { libraryId: candidate.id }
          : { sourceId: candidate.id },
      ),
    onMutate: () => setError(null),
    onSuccess: (data) => {
      // Every write returns the whole showcase, so both profile reads and the
      // standalone one can be primed without a refetch.
      queryClient.setQueryData(['profile', 'me'], (old: unknown) =>
        old && typeof old === 'object'
          ? { ...(old as object), showcase: data.showcase }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (addError) =>
      setError(addError instanceof Error ? addError.message : 'Could not add that.'),
  });

  const isTaken = (candidate: FeaturedCandidate) =>
    candidate.source === 'archive'
      ? takenArchive.has(candidate.id)
      : takenTitles.has(`${candidate.title}|${candidate.subtitle ?? ''}`);

  const archive = results.data?.archive ?? [];
  const catalogue = results.data?.catalogue ?? [];
  const searching = debounced.trim().length >= 2;
  const nothing = searching && !results.isFetching && archive.length === 0 && catalogue.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        role="presentation"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
      />

      <div className="surface relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-b-none sm:rounded-2xl animate-scale-in">
        <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <span className="text-sm font-semibold text-zinc-200">Feature {NOUNS[kind]}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="icon-btn h-8 w-8">
            <X size={16} />
          </button>
        </header>

        <div className="border-b border-white/5 p-3">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
            />
            <input
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              autoFocus
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search anything — here or anywhere"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-9 pr-9 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {results.isFetching && (
              <Loader2
                size={15}
                className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-zinc-600"
              />
            )}
          </div>

          {full && (
            <p className="mt-2 text-xs text-amber-200/70">
              This list is full at {list.slots}. Remove something, or make the list longer.
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {!searching ? (
            <p className="px-3 py-8 text-center text-sm leading-relaxed text-zinc-500">
              Type at least two letters.
              <span className="mt-1 block text-xs text-zinc-600">
                Anything in this archive comes up first, then everything else.
              </span>
            </p>
          ) : nothing ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">
              Nothing found for “{debounced}”.
            </p>
          ) : (
            <>
              {archive.length > 0 && (
                <Group icon={<Library size={11} />} title="In your archive">
                  {archive.map((candidate) => (
                    <Row
                      key={`a-${candidate.id}`}
                      candidate={candidate}
                      taken={isTaken(candidate)}
                      pending={add.isPending && add.variables?.id === candidate.id}
                      onAdd={() => add.mutate(candidate)}
                    />
                  ))}
                </Group>
              )}

              {catalogue.length > 0 && (
                <Group
                  icon={<Globe size={11} />}
                  title="Everywhere else"
                  hint="· can't be played here"
                >
                  {catalogue.map((candidate) => (
                    <Row
                      key={`c-${candidate.id}`}
                      candidate={candidate}
                      taken={isTaken(candidate)}
                      pending={add.isPending && add.variables?.id === candidate.id}
                      onAdd={() => add.mutate(candidate)}
                    />
                  ))}
                </Group>
              )}

              {results.data?.catalogueError && (
                <p className="px-3 py-3 text-center text-xs leading-relaxed text-zinc-600">
                  {results.data.catalogueError}
                  <span className="mt-0.5 block">Searching this archive still works.</span>
                </p>
              )}
            </>
          )}
        </div>

        {error && (
          <p className="border-t border-white/5 px-4 py-2 text-xs text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}
