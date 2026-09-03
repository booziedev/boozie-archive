import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Disc3, Loader2, Music2, Search, User, X } from 'lucide-react';

import { CoverImage } from './CoverImage';
import { useDebounced } from '../hooks/useDebounced';
import { useSearch } from '../hooks/useLibrary';
import { usePlayer } from '../context/PlayerContext';
import { formatDuration } from '../lib/format';

/**
 * Search-first header control with an inline results dropdown.
 *
 * Typing queries the combined /api/search endpoint (artists + albums + tracks
 * in one round trip); Enter opens the full results page.
 */
export function SearchBar({ className = '' }: { className?: string }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(value, 220);
  const { data, isFetching } = useSearch(debounced, 5);
  const navigate = useNavigate();
  const { playNow } = usePlayer();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  // "/" or ⌘K focuses the field from anywhere.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if ((event.key === '/' && !typing) || (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function go(path: string) {
    setOpen(false);
    inputRef.current?.blur();
    navigate(path);
  }

  const hasResults =
    (data?.artists.length ?? 0) + (data?.albums.length ?? 0) + (data?.tracks.length ?? 0) > 0;
  const showDropdown = open && debounced.trim().length >= 2;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) go(`/search?q=${encodeURIComponent(value.trim())}`);
        }}
      >
        <div className="group relative flex items-center">
          <Search
            size={17}
            className="pointer-events-none absolute left-3.5 text-zinc-500 transition-colors group-focus-within:text-accent-400"
          />
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search artists, albums, tracks…"
            aria-label="Search the archive"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2.5 pl-10 pr-10 text-sm text-zinc-100 placeholder:text-zinc-600 transition-all duration-300 ease-vault focus:border-accent-500/50 focus:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-accent-500/20 [&::-webkit-search-cancel-button]:hidden"
          />
          {isFetching && value ? (
            <Loader2 size={16} className="absolute right-3.5 animate-spin text-zinc-500" />
          ) : value ? (
            <button
              type="button"
              onClick={() => {
                setValue('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2.5 rounded-full p-1 text-zinc-500 hover:text-zinc-200"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>
      </form>

      {showDropdown && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-ink-900/[0.98] p-2 shadow-2xl backdrop-blur-2xl animate-scale-in">
          {!hasResults ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-500">
              {isFetching ? 'Searching…' : `Nothing found for “${debounced}”.`}
            </p>
          ) : (
            <>
              {data!.artists.length > 0 && (
                <Section title="Artists" icon={<User size={12} />}>
                  {data!.artists.map((artist) => (
                    <button
                      key={artist.id}
                      type="button"
                      onClick={() => go(`/artists/${artist.id}`)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5"
                    >
                      <CoverImage
                        id={artist.id}
                        name={artist.name}
                        hasCover={artist.hasCover}
                        size={128}
                        rounded="rounded-full"
                        className="h-9 w-9 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-100">{artist.name}</span>
                        <span className="block truncate text-xs text-zinc-500">
                          {artist.albumCount} albums · {artist.trackCount} tracks
                        </span>
                      </span>
                    </button>
                  ))}
                </Section>
              )}

              {data!.albums.length > 0 && (
                <Section title="Albums" icon={<Disc3 size={12} />}>
                  {data!.albums.map((album) => (
                    <button
                      key={album.id}
                      type="button"
                      onClick={() => go(`/albums/${album.id}`)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5"
                    >
                      <CoverImage
                        id={album.id}
                        name={album.name}
                        hasCover={album.hasCover}
                        size={128}
                        rounded="rounded-lg"
                        className="h-9 w-9 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-100">{album.name}</span>
                        <span className="block truncate text-xs text-zinc-500">
                          {album.artistName}
                          {album.year ? ` · ${album.year}` : ''}
                        </span>
                      </span>
                    </button>
                  ))}
                </Section>
              )}

              {data!.tracks.length > 0 && (
                <Section title="Tracks" icon={<Music2 size={12} />}>
                  {data!.tracks.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => {
                        playNow(track);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5"
                    >
                      <CoverImage
                        id={track.coverId ?? track.albumId}
                        name={track.album}
                        size={128}
                        rounded="rounded-lg"
                        className="h-9 w-9 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-100">{track.title}</span>
                        <span className="block truncate text-xs text-zinc-500">{track.artist}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-zinc-600">
                        {formatDuration(track.duration)}
                      </span>
                    </button>
                  ))}
                </Section>
              )}

              <button
                type="button"
                onClick={() => go(`/search?q=${encodeURIComponent(debounced.trim())}`)}
                className="mt-1 w-full rounded-xl px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-widest text-accent-300 transition-colors hover:bg-accent-500/10"
              >
                See all results
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1 last:mb-0">
      <p className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}
