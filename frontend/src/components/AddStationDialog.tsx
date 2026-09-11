import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ImagePlus, Link2, Loader2, Plus, Radio, Search, X } from 'lucide-react';

import { radio } from '../lib/api';
import type { DirectoryStation, Station } from '../lib/types';

/**
 * What the station's tile will look like.
 *
 * A file chosen but not yet uploaded is previewed from an object URL, so the
 * Add path shows the choice rather than asking you to trust it.
 */
function StationPreview({ station, pending }: { station?: Station; pending: File | null }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(pending);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  const src = objectUrl ?? station?.coverUrl ?? station?.faviconUrl ?? null;

  return src ? (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      className="h-20 w-20 rounded-xl bg-white/5 object-cover"
    />
  ) : (
    <span className="flex h-20 w-20 items-center justify-center rounded-xl bg-white/5">
      <Radio size={20} className="text-zinc-600" />
    </span>
  );
}

/**
 * Adding a station, two ways.
 *
 * **Search** queries the Radio Browser directory and fills everything in from
 * one click. **Paste a URL** is the fallback for a station no directory knows
 * about — the server opens it, follows the redirects (the address a station
 * publishes is rarely the one serving the audio), and reports what it found.
 *
 * Either way the server has the last word on what gets stored: it refuses
 * anything that is not playable audio, and it stores the URL it actually
 * reached rather than the one that was typed.
 */
export function AddStationDialog({
  station: opened,
  onClose,
}: {
  /** Passing one switches the dialog to editing it. */
  station?: Station;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const editing = Boolean(opened);

  /**
   * The station as it is now, not as it was when the dialog opened.
   *
   * Artwork uploads land immediately rather than on save, so the copy handed
   * in goes stale the moment one does — leaving the preview showing the old
   * image and hiding the "remove" link. The list is already in the cache, so
   * re-reading it costs nothing.
   */
  const list = useQuery({ queryKey: ['radio'], queryFn: radio.list, enabled: editing });
  const station =
    (opened && list.data?.stations.find((entry) => entry.id === opened.id)) || opened;
  const [tab, setTab] = useState<'search' | 'url'>(editing ? 'url' : 'search');

  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [url, setUrl] = useState(station?.streamUrl ?? '');
  const [name, setName] = useState(station?.name ?? '');
  const [country, setCountry] = useState(station?.country ?? '');
  const [tags, setTags] = useState((station?.tags ?? []).join(', '));
  const [added, setAdded] = useState<string[]>([]);
  const coverInput = useRef<HTMLInputElement>(null);
  /**
   * A cover chosen before the station exists.
   *
   * There is nothing to attach it to until the station has been created, so on
   * the Add path it is held here and uploaded straight afterwards.
   */
  const [pendingCover, setPendingCover] = useState<File | null>(null);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['radio'] });
  };

  const uploadCover = useMutation({
    mutationFn: (file: File) => radio.uploadCover(station!.id, file),
    onSuccess: done,
  });

  const clearCover = useMutation({
    mutationFn: () => radio.clearCover(station!.id),
    onSuccess: done,
  });

  const results = useQuery({
    queryKey: ['radio', 'search', submitted],
    queryFn: () => radio.search(submitted),
    enabled: submitted.length >= 2,
    retry: false,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        return radio.update(station!.id, {
          name: name.trim(),
          streamUrl: url.trim(),
          country: country.trim() || null,
          tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        });
      }

      const created = await radio.create({
        streamUrl: url.trim(),
        name: name.trim() || undefined,
        country: country.trim() || null,
        tags,
      });
      // The station had to exist before its artwork had anywhere to go.
      if (pendingCover) await radio.uploadCover(created.station.id, pendingCover);
      return created;
    },
    onSuccess: () => {
      done();
      onClose();
    },
  });

  const addFromDirectory = useMutation({
    mutationFn: (entry: DirectoryStation) =>
      radio.create({
        streamUrl: entry.streamUrl,
        name: entry.name,
        homepageUrl: entry.homepageUrl,
        faviconUrl: entry.faviconUrl,
        country: entry.country,
        tags: entry.tags,
      }),
    onSuccess: (_result, entry) => {
      setAdded((current) => [...current, entry.streamUrl]);
      done();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        role="presentation"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
      />

      <div className="surface relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-b-none sm:rounded-2xl animate-scale-in">
        <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Radio size={16} className="text-accent-400" />
            {editing ? `Edit ${station!.name}` : 'Add a station'}
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="icon-btn h-8 w-8">
            <X size={16} />
          </button>
        </header>

        {!editing && (
          <div className="flex gap-1.5 border-b border-white/5 p-2">
            {([
              { key: 'search' as const, label: 'Search', icon: Search },
              { key: 'url' as const, label: 'Paste a URL', icon: Link2 },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  tab === key ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === 'search' && !editing ? (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitted(term.trim());
              }}
              className="flex gap-2 border-b border-white/5 px-4 py-3"
            >
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Station name — try “Willy”"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
              />
              <button type="submit" disabled={term.trim().length < 2} className="btn-primary">
                {results.isFetching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              </button>
            </form>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
              {results.isError ? (
                <p className="px-3 py-8 text-center text-sm leading-relaxed text-zinc-500">
                  {results.error instanceof Error ? results.error.message : 'The directory is not answering.'}
                  <br />
                  Try the Paste a URL tab instead.
                </p>
              ) : !submitted ? (
                <p className="px-3 py-8 text-center text-sm leading-relaxed text-zinc-500">
                  Search the Radio Browser directory. Only stations that passed their last
                  check and play in a browser are listed.
                </p>
              ) : results.isLoading ? (
                <p className="px-3 py-8 text-center text-sm text-zinc-500">Searching…</p>
              ) : (results.data?.results ?? []).length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-zinc-500">Nothing found.</p>
              ) : (
                results.data!.results.map((entry) => {
                  const alreadyAdded = added.includes(entry.streamUrl);
                  return (
                    <div
                      key={entry.streamUrl}
                      className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/5"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5">
                        {entry.faviconUrl ? (
                          <img
                            src={entry.faviconUrl}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-contain"
                            onError={(event) => {
                              event.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <Radio size={16} className="text-zinc-600" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-100">{entry.name}</span>
                        <span className="block truncate text-xs text-zinc-600">
                          {[entry.country, entry.codec, entry.bitrate ? `${entry.bitrate}k` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={alreadyAdded || addFromDirectory.isPending}
                        onClick={() => addFromDirectory.mutate(entry)}
                        className="icon-btn h-8 w-8 disabled:opacity-50"
                        aria-label={`Add ${entry.name}`}
                      >
                        {alreadyAdded ? (
                          <Check size={15} className="text-emerald-400" />
                        ) : addFromDirectory.isPending && addFromDirectory.variables?.streamUrl === entry.streamUrl ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Plus size={15} />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {addFromDirectory.isError && (
              <p className="border-t border-white/5 px-4 py-2 text-xs text-red-400">
                {addFromDirectory.error instanceof Error ? addFromDirectory.error.message : 'Could not add that.'}
              </p>
            )}
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
          >
            {/* Artwork. On the Add path the station does not exist yet, so the
                file waits here and is uploaded the moment it does. */}
            <div className="flex items-center gap-3">
              <div className="group relative h-20 w-20 shrink-0">
                <StationPreview station={station} pending={pendingCover} />

                <input
                  ref={coverInput}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      if (editing) uploadCover.mutate(file);
                      else setPendingCover(file);
                    }
                    event.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => coverInput.current?.click()}
                  disabled={uploadCover.isPending}
                  aria-label="Choose station artwork"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-black/60 text-[10px] font-semibold text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                >
                  {uploadCover.isPending ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <ImagePlus size={15} />
                  )}
                  Artwork
                </button>
              </div>

              <div className="min-w-0 flex-1 text-xs leading-relaxed text-zinc-600">
                Optional. Without one the station shows whatever logo the directory supplied,
                and failing that a tile made from its name.
                {editing && station?.coverUrl && (
                  <button
                    type="button"
                    onClick={() => clearCover.mutate()}
                    disabled={clearCover.isPending}
                    className="mt-1 block text-zinc-500 transition-colors hover:text-zinc-300"
                  >
                    Remove the artwork
                  </button>
                )}
                {pendingCover && (
                  <button
                    type="button"
                    onClick={() => setPendingCover(null)}
                    className="mt-1 block text-zinc-500 transition-colors hover:text-zinc-300"
                  >
                    Clear the chosen image
                  </button>
                )}
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Stream URL
              </span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://…/stream.mp3"
                required
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
              />
              <span className="mt-1 block text-xs leading-relaxed text-zinc-600">
                An MP3 or AAC stream. Redirects are followed, and a .pls or .m3u link is
                resolved to the stream behind it. HLS (.m3u8) will not play in most browsers.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Name {!editing && <span className="text-zinc-600">— optional, taken from the stream</span>}
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 focus:border-accent-500/50 focus:outline-none"
              />
            </label>

            <div className="flex gap-3">
              <label className="block flex-1">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Country
                </span>
                <input
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  maxLength={60}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 focus:border-accent-500/50 focus:outline-none"
                />
              </label>
              <label className="block flex-1">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Tags
                </span>
                <input
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="rock, belgian"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
                />
              </label>
            </div>

            {save.isError && (
              <p className="text-xs leading-relaxed text-red-400">
                {save.error instanceof Error ? save.error.message : 'Could not save that station.'}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={!url.trim() || save.isPending} className="btn-primary">
                {save.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
                {save.isPending ? 'Checking the stream…' : editing ? 'Save' : 'Add station'}
              </button>
              <button type="button" onClick={onClose} className="btn-ghost">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
