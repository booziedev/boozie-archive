import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Download,
  ImagePlus,
  ListMusic,
  Loader2,
  Play,
  RefreshCw,
  Shuffle,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import { CoverImage } from '../components/CoverImage';
import { PlaylistMembers } from '../components/PlaylistMembers';
import { ShareButton } from '../components/ShareDialog';
import { EmptyState } from '../components/states';
import { mediaUrl, playlists as api } from '../lib/api';
import { formatBytes, formatDuration, formatRuntime } from '../lib/format';
import { usePlayer } from '../context/PlayerContext';
import type { PlaylistEntry, PlaylistVisibility, Track } from '../lib/types';

const VISIBILITIES: { value: PlaylistVisibility; label: string; hint: string }[] = [
  { value: 'everyone', label: 'Public', hint: 'Anyone with an account here can open it.' },
  { value: 'friends', label: 'Friends only', hint: 'Only people you have added as friends.' },
  { value: 'private', label: 'Private', hint: 'Only you, and anyone you invite by name.' },
];

/** The tracks that still resolve, in order — the ones that can be played. */
function playable(entries: PlaylistEntry[]): Track[] {
  return entries.map((entry) => entry.track).filter((track): track is Track => Boolean(track));
}

export function PlaylistPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { current, isPlaying, playTracks, toggle } = usePlayer();
  const [editing, setEditing] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState({ name: '', description: '' });

  const query = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => api.get(id),
    retry: false,
  });

  const playlist = query.data?.playlist;
  const entries = query.data?.entries ?? [];
  // A blend has two members; the one who isn't you is the one to rebuild with.
  const otherMember =
    playlist && playlist.kind === 'blend'
      ? (playlist.isOwner ? playlist.blendWith : playlist.ownerId) ?? ''
      : '';

  // Keep the edit form in step with the server's copy, including after a save.
  useEffect(() => {
    if (playlist) setDraft({ name: playlist.name, description: playlist.description ?? '' });
  }, [playlist?.name, playlist?.description]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['playlist', id] });
    queryClient.invalidateQueries({ queryKey: ['playlists'] });
  };

  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.update>[1]) => api.update(id, input),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });

  const refresh = useMutation({
    mutationFn: () =>
      playlist?.kind === 'wrapped' && playlist.generator
        ? api.refreshWrapped(playlist.generator)
        : api.blend(otherMember, true),
    onSuccess: invalidate,
  });

  const uploadCover = useMutation({
    mutationFn: (file: File) => api.uploadCover(id, file),
    onSuccess: invalidate,
  });

  const clearCover = useMutation({
    mutationFn: () => api.clearCover(id),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => api.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      navigate('/playlists');
    },
  });

  const removeTrack = useMutation({
    mutationFn: (trackId: string) => api.removeTrack(id, trackId),
    onSuccess: invalidate,
  });

  const move = useMutation({
    mutationFn: ({ trackId, to }: { trackId: string; to: number }) => api.moveTrack(id, trackId, to),
    onSuccess: invalidate,
  });

  if (query.isLoading) {
    return <div className="h-40 animate-pulse rounded-2xl bg-white/[0.03]" />;
  }

  if (query.isError || !playlist) {
    return (
      <EmptyState
        icon={<ListMusic size={24} />}
        title="Playlist not found"
        description="It may have been deleted, or it isn't shared with you."
        action={
          <Link to="/playlists" className="btn-ghost">
            Back to playlists
          </Link>
        }
      />
    );
  }

  const tracks = playable(entries);
  const missing = entries.length - tracks.length;
  // What the archive will actually weigh — only the tracks that still resolve.
  const playlistBytes = tracks.reduce((sum, track) => sum + track.size, 0);

  return (
    <div>
      <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="group relative h-40 w-40 shrink-0">
          {playlist.coverUrl ? (
            <img
              src={playlist.coverUrl}
              alt=""
              className="h-40 w-40 rounded-2xl bg-ink-800 object-cover shadow-card"
            />
          ) : (
            <CoverImage
              id={playlist.coverId ?? ''}
              name={playlist.name}
              size={320}
              rounded="rounded-2xl"
              className="h-40 w-40 shadow-card"
            />
          )}

          {playlist.isOwner && playlist.kind === 'manual' && (
            <>
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
                className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-2xl bg-black/60 text-xs font-semibold text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
              >
                {uploadCover.isPending ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <ImagePlus size={18} />
                )}
                {playlist.coverUrl ? 'Change cover' : 'Add a cover'}
              </button>
              {playlist.coverUrl && (
                <button
                  type="button"
                  onClick={() => clearCover.mutate()}
                  aria-label="Remove the cover"
                  className="absolute -right-2 -top-2 rounded-full bg-ink-850 p-1.5 text-zinc-400 opacity-0 shadow-lift transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                >
                  <X size={13} />
                </button>
              )}
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent-400">
            {playlist.kind === 'blend'
              ? 'Blend'
              : playlist.kind === 'wrapped'
                ? 'Your listening'
                : 'Playlist'}
          </p>

          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                update.mutate({ name: draft.name, description: draft.description || null });
              }}
              className="mt-1 space-y-2"
            >
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                maxLength={80}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-lg font-bold text-zinc-100 focus:border-accent-500/50 focus:outline-none"
              />
              <input
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="Description (optional)"
                maxLength={300}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
              />
              <div className="flex gap-2">
                <button type="submit" disabled={update.isPending} className="btn-primary">
                  {update.isPending ? <Loader2 size={15} className="animate-spin" /> : 'Save'}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="btn-ghost">
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                {playlist.name}
              </h1>
              {playlist.description && (
                <p className="mt-1 text-sm text-zinc-400">{playlist.description}</p>
              )}
            </>
          )}

          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500">
            {/* A blend's title already names both people, so an owner byline
                would only suggest it belongs to one of them. */}
            {playlist.kind === 'manual' && (
              <>
                <Link
                  to={`/u/${playlist.ownerUsername}`}
                  className="font-medium text-zinc-300 transition-colors hover:text-white hover:underline"
                >
                  {playlist.ownerDisplayName || playlist.ownerUsername}
                </Link>
                <span aria-hidden>·</span>
              </>
            )}
            <span>
              {playlist.trackCount} {playlist.trackCount === 1 ? 'track' : 'tracks'}
            </span>
            {playlist.trackCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>{formatRuntime(playlist.duration)}</span>
              </>
            )}
            {playlist.kind === 'manual' && (playlist.isOwner || playlist.memberCount > 0) && (
              <button
                type="button"
                onClick={() => setMembersOpen(true)}
                title="Who this playlist is shared with"
                className="pill transition-colors hover:border-white/20 hover:text-zinc-200"
              >
                <Users size={11} />
                {playlist.memberCount === 0
                  ? 'Share with a friend'
                  : `${playlist.memberCount} invited`}
              </button>
            )}
            {playlist.role && (
              <span className="pill" title={
                playlist.role === 'collaborator'
                  ? 'You can add and remove tracks'
                  : 'You can listen and download'
              }>
                {playlist.role === 'collaborator' ? 'Collaborator' : 'Viewer'}
              </span>
            )}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => playTracks(tracks, 0)}
              className="btn-primary disabled:opacity-40"
            >
              <Play size={16} className="fill-current" />
              Play
            </button>
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => playTracks(tracks, Math.floor(Math.random() * tracks.length))}
              className="btn-ghost disabled:opacity-40"
            >
              <Shuffle size={15} />
              Shuffle
            </button>
            {tracks.length > 0 && (
              <a
                href={mediaUrl.downloadPlaylist(playlist.id)}
                download
                className="btn-ghost"
                title={`Download all ${tracks.length} tracks as one .zip`}
              >
                <Download size={15} />
                Download
                <span className="text-zinc-600">· {formatBytes(playlistBytes)}</span>
              </a>
            )}
            <ShareButton
              attachment={{
                kind: 'playlist',
                id: playlist.id,
                name: playlist.name,
                subtitle: `${playlist.trackCount} tracks · ${
                  playlist.ownerDisplayName || playlist.ownerUsername
                }`,
              }}
            />
            {playlist.kind !== 'manual' && (
              <button
                type="button"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                className="btn-ghost"
                title={
                  playlist.kind === 'blend'
                    ? 'Rebuild it from what you have both played since'
                    : 'Rebuild it from what you have played since'
                }
              >
                {refresh.isPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                Refresh
              </button>
            )}
            {playlist.isOwner && playlist.kind === 'manual' && !editing && (
              <button type="button" onClick={() => setEditing(true)} className="btn-ghost">
                Edit
              </button>
            )}
            {playlist.isOwner && playlist.kind === 'manual' && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete "${playlist.name}"? This cannot be undone.`)) {
                    remove.mutate();
                  }
                }}
                className="btn-ghost text-red-400 hover:text-red-300"
              >
                <Trash2 size={15} />
                Delete
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Sharing controls, owner only. A blend has none: it is private to the
          two people in it and generated rather than curated. */}
      {playlist.isOwner && playlist.kind === 'manual' && (
        <div className="surface mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Who can see it
            </p>
            <div className="flex flex-wrap gap-1.5">
              {VISIBILITIES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.hint}
                  onClick={() => update.mutate({ visibility: option.value })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    playlist.visibility === option.value
                      ? 'bg-white/10 text-white'
                      : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
            Visibility decides who can find it. To let one person in — or let them edit —
            invite them by name from <span className="text-zinc-400">Share with a friend</span>.
          </p>
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={<ListMusic size={24} />}
          title="Nothing in here yet"
          description={
            playlist.kind === 'blend'
              ? 'Neither of you has played enough yet. Listen to a few things and refresh.'
              : playlist.canEdit
                ? 'Use the playlist button on any track row to add music.'
                  : 'The owner has not added anything yet.'
          }
        />
      ) : (
        <div className="surface divide-y divide-white/[0.03] p-1.5">
          {entries.map((entry, index) => {
            const isCurrent = entry.track && current?.id === entry.track.id;
            return (
              <div
                key={entry.trackId}
                className={`group grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-xl px-2 py-2 transition-colors sm:gap-4 sm:px-3 ${
                  isCurrent ? 'bg-accent-500/10' : 'hover:bg-white/[0.04]'
                }`}
              >
                <button
                  type="button"
                  disabled={!entry.track}
                  onClick={() => {
                    if (!entry.track) return;
                    if (isCurrent) toggle();
                    // Playing row N means playing the list from N, so the rest
                    // of the playlist queues up behind it.
                    else playTracks(tracks, tracks.findIndex((track) => track.id === entry.trackId));
                  }}
                  aria-label={`Play ${entry.title}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-sm tabular-nums text-zinc-500 transition-colors hover:text-white disabled:opacity-30"
                >
                  <span className="group-hover:hidden">{index + 1}</span>
                  <Play
                    size={14}
                    className={`hidden fill-current group-hover:block ${
                      isCurrent && isPlaying ? 'text-accent-300' : 'text-white'
                    }`}
                  />
                </button>

                <div className="min-w-0">
                  <p
                    className={`truncate text-sm font-medium ${
                      entry.track ? 'text-zinc-100' : 'text-zinc-500 line-through'
                    }`}
                  >
                    {entry.title}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {entry.artist}
                    {entry.album && ` · ${entry.album}`}
                    {!entry.track && ' · missing from the library'}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  {playlist.canEdit && (
                    <div className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
                      <button
                        type="button"
                        disabled={index === 0 || move.isPending}
                        onClick={() => move.mutate({ trackId: entry.trackId, to: index - 1 })}
                        aria-label={`Move ${entry.title} up`}
                        className="icon-btn h-8 w-8 disabled:opacity-25"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={index === entries.length - 1 || move.isPending}
                        onClick={() => move.mutate({ trackId: entry.trackId, to: index + 1 })}
                        aria-label={`Move ${entry.title} down`}
                        className="icon-btn h-8 w-8 disabled:opacity-25"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={removeTrack.isPending}
                        onClick={() => removeTrack.mutate(entry.trackId)}
                        aria-label={`Remove ${entry.title}`}
                        className="icon-btn h-8 w-8 hover:text-red-400"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <span className="w-11 shrink-0 text-right text-xs tabular-nums text-zinc-500">
                    {formatDuration(entry.duration)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {membersOpen && <PlaylistMembers playlist={playlist} onClose={() => setMembersOpen(false)} />}

      {missing > 0 && (
        <p className="mt-3 text-xs text-zinc-600">
          {missing} {missing === 1 ? 'track is' : 'tracks are'} no longer in the library — they were
          renamed, re-tagged or removed since being added.
        </p>
      )}
    </div>
  );
}
