import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Loader2, Pencil, Trash2, X } from 'lucide-react';

import { CoverImage } from './CoverImage';
import { playlists } from '../lib/api';
import type { Playlist, PlaylistVisibility } from '../lib/types';

const VISIBILITIES: { value: PlaylistVisibility; label: string; hint: string }[] = [
  { value: 'everyone', label: 'Public', hint: 'Anyone with an account here can find it.' },
  { value: 'friends', label: 'Friends', hint: 'Only people you have added as friends.' },
  { value: 'private', label: 'Private', hint: 'Only you, and anyone you invite by name.' },
];

/**
 * Everything about a playlist that its owner can change, in one card.
 *
 * Name, description, cover, who can see it and deleting it all used to live in
 * different places on the page — an inline form, a row of buttons, a panel
 * below the header. Gathering them here means the page itself is just the
 * playlist.
 *
 * The cover uploads immediately rather than on save: it is a file, not a field,
 * and pretending it is part of the form would mean holding it in memory and
 * inventing a way to undo it.
 */
export function PlaylistEditor({
  playlist,
  onClose,
  onDeleted,
}: {
  playlist: Playlist;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const coverInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? '');
  const [visibility, setVisibility] = useState<PlaylistVisibility>(playlist.visibility);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['playlist', playlist.id] });
    queryClient.invalidateQueries({ queryKey: ['playlists'] });
  };

  const save = useMutation({
    mutationFn: () =>
      playlists.update(playlist.id, {
        name: name.trim(),
        description: description.trim() || null,
        visibility,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const uploadCover = useMutation({
    mutationFn: (file: File) => playlists.uploadCover(playlist.id, file),
    onSuccess: invalidate,
  });

  const clearCover = useMutation({
    mutationFn: () => playlists.clearCover(playlist.id),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => playlists.remove(playlist.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      onDeleted();
    },
  });

  const error = save.error ?? uploadCover.error ?? clearCover.error ?? remove.error;
  const busy = save.isPending || remove.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        role="presentation"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
      />

      <div className="surface relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-b-none sm:rounded-2xl animate-scale-in">
        <header className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Pencil size={15} className="text-accent-400" />
            Edit playlist
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="icon-btn h-8 w-8">
            <X size={16} />
          </button>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) save.mutate();
          }}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
        >
          <div className="flex gap-4">
            {/* Cover, with the picker over it. */}
            <div className="group relative h-24 w-24 shrink-0">
              {playlist.coverUrl ? (
                <img
                  src={playlist.coverUrl}
                  alt=""
                  className="h-24 w-24 rounded-xl bg-ink-800 object-cover"
                />
              ) : (
                <CoverImage
                  id={playlist.coverId ?? ''}
                  name={playlist.name}
                  size={320}
                  rounded="rounded-xl"
                  className="h-24 w-24"
                />
              )}

              <input
                ref={coverInput}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadCover.mutate(file);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => coverInput.current?.click()}
                disabled={uploadCover.isPending}
                aria-label={playlist.coverUrl ? 'Change the cover' : 'Add a cover'}
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-black/60 text-[10px] font-semibold text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
              >
                {uploadCover.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ImagePlus size={16} />
                )}
                Cover
              </button>
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Name
                </span>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the card just opened */}
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  required
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-zinc-100 focus:border-accent-500/50 focus:outline-none"
                />
              </label>

              {playlist.coverUrl && (
                <button
                  type="button"
                  onClick={() => clearCover.mutate()}
                  disabled={clearCover.isPending}
                  className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  Use the album art instead
                </button>
              )}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Description <span className="text-zinc-600">— optional</span>
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={300}
              rows={2}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
              placeholder="What is this one for?"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Privacy
            </span>
            <select
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as PlaylistVisibility)}
              className="w-full rounded-xl border border-white/10 bg-ink-850 px-3 py-2 text-sm text-zinc-100 focus:border-accent-500/50 focus:outline-none"
            >
              {VISIBILITIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs leading-relaxed text-zinc-600">
              {VISIBILITIES.find((option) => option.value === visibility)?.hint}
            </span>
          </label>

          {error && (
            <p className="text-xs leading-relaxed text-red-400">
              {error instanceof Error ? error.message : 'That did not work.'}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={!name.trim() || busy} className="btn-primary">
              {save.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
              Save
            </button>
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancel
            </button>

            {/* Deleting lives here too, at the far end and behind a confirm. */}
            <span className="ml-auto">
              {confirmingDelete ? (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                    className="btn-ghost px-2 py-1 text-xs text-red-400 hover:text-red-300"
                  >
                    {remove.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Really delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  aria-label="Delete this playlist"
                  title="Delete this playlist"
                  className="icon-btn h-8 w-8 hover:text-red-400"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
