import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Check,
  Loader2,
  MessageSquare,
  Palette,
  UserMinus,
  UserPlus,
} from 'lucide-react';

import { Avatar } from '../components/Avatar';
import { PageHeader } from '../components/PageHeader';
import { ErrorState } from '../components/states';
import { social } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../lib/format';
import type { PublicProfile } from '../lib/types';

const ACCENTS = ['#7c5cff', '#22d3ee', '#34d399', '#f59e0b', '#f43f5e', '#a855f7', '#38bdf8', '#e2e8f0'];

/**
 * Someone's profile. Viewing your own turns it into the editor: display name,
 * bio, accent colour, and a profile picture uploaded by clicking the avatar —
 * animated GIFs included. The server decides the format from the file's own
 * magic bytes, so a renamed script can't get in.
 */
export function ProfilePage() {
  const { username } = useParams<{ username?: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isSelf = !username || username.toLowerCase() === user?.username.toLowerCase();

  const profileQuery = useQuery({
    queryKey: isSelf ? ['profile', 'me'] : ['profile', username],
    queryFn: () => (isSelf ? social.myProfile() : social.profile(username!)),
  });

  const profile = profileQuery.data?.profile;

  if (profileQuery.isError) {
    return (
      <ErrorState
        error={profileQuery.error}
        onRetry={() => profileQuery.refetch()}
        title="Profile unavailable"
      />
    );
  }

  if (profileQuery.isLoading || !profile) {
    return <div className="surface p-8 text-sm text-zinc-500">Loading profile…</div>;
  }

  return isSelf ? (
    <ProfileEditor
      profile={profile}
      onSaved={() => {
        void queryClient.invalidateQueries({ queryKey: ['profile'] });
        void queryClient.invalidateQueries({ queryKey: ['friends'] });
      }}
    />
  ) : (
    <OtherProfile profile={profile} />
  );
}

/** Matches what the server accepts; anything else is rejected before upload. */
const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/gif,image/webp';
const MAX_AVATAR_MB = 5;

function ProfileEditor({ profile, onSaved }: { profile: PublicProfile; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [accentColor, setAccentColor] = useState(profile.accentColor ?? ACCENTS[0]!);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2200);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const upload = useMutation({
    mutationFn: (file: File) => social.uploadAvatar(file),
    onSuccess: (result) => {
      setError(null);
      setAvatarUrl(result.profile.avatarUrl);
      onSaved();
    },
    onError: (uploadError) =>
      setError(uploadError instanceof Error ? uploadError.message : 'Could not upload that image.'),
  });

  const removePicture = useMutation({
    mutationFn: () => social.removeAvatar(),
    onSuccess: () => {
      setError(null);
      setAvatarUrl(null);
      onSaved();
    },
    onError: (removeError) =>
      setError(removeError instanceof Error ? removeError.message : 'Could not remove the picture.'),
  });

  /** Cheap client-side checks so obvious mistakes don't cost a round trip. */
  function onFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be chosen again after a failure.
    event.target.value = '';
    if (!file) return;

    if (!ACCEPTED_IMAGES.split(',').includes(file.type)) {
      setError('Choose a PNG, JPEG, GIF or WebP image.');
      return;
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_AVATAR_MB} MB.`);
      return;
    }
    upload.mutate(file);
  }

  const save = useMutation({
    mutationFn: () =>
      social.updateProfile({
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
        avatarUrl,
        accentColor,
      }),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      onSaved();
    },
    onError: (saveError) =>
      setError(saveError instanceof Error ? saveError.message : 'Could not save your profile.'),
  });

  const preview: PublicProfile = { ...profile, displayName, avatarUrl, accentColor, bio };

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Your profile" subtitle="How you appear to other people in the archive." />

      {/*
        Live preview of the row everyone else sees — and the upload control:
        clicking the picture opens the file chooser.
      */}
      <section className="surface flex items-center gap-4 p-5">
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_IMAGES}
          onChange={onFilePicked}
          className="hidden"
          aria-hidden
          tabIndex={-1}
        />

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          aria-label="Change your profile picture"
          title="Click to upload a picture or GIF"
          className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          <Avatar profile={preview} size={72} ring />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
            {upload.isPending ? (
              <Loader2 size={20} className="animate-spin text-white" />
            ) : (
              <Camera size={20} className="text-white" />
            )}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-white">
            {displayName.trim() || profile.username}
          </p>
          <p className="truncate text-sm text-zinc-500">@{profile.username}</p>
          <p className="mt-1.5 text-xs text-zinc-600">
            {upload.isPending ? (
              'Uploading…'
            ) : (
              <>
                Click your picture to upload one — PNG, JPEG, WebP or an animated GIF, up to{' '}
                {MAX_AVATAR_MB} MB.
              </>
            )}
          </p>
          {avatarUrl && (
            <button
              type="button"
              onClick={() => removePicture.mutate()}
              disabled={removePicture.isPending}
              className="mt-1.5 text-xs text-zinc-500 transition-colors hover:text-red-400"
            >
              Remove picture
            </button>
          )}
        </div>
      </section>

      <section className="surface space-y-5 p-5">
        {/* --------------------------- display name ---------------------- */}
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
            Display name
          </span>
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={48}
            placeholder={profile.username}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
          />
        </label>

        {/* -------------------------------- bio -------------------------- */}
        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
            About you
            <span className="tabular-nums">{bio.length}/300</span>
          </span>
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value.slice(0, 300))}
            rows={3}
            placeholder="Favourite genres, what you're listening to…"
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent-500/50 focus:outline-none"
          />
        </label>

        {/* ------------------------------ accent ------------------------- */}
        <div>
          <span className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
            <Palette size={11} />
            Accent colour
          </span>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setAccentColor(color)}
                aria-label={`Accent ${color}`}
                className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${
                  accentColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-850' : ''
                }`}
                style={{ background: color }}
              />
            ))}
          </div>
        </div>

        {error && (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="btn-primary"
          >
            {save.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
            Save profile
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-400">
              <Check size={15} />
              Saved
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

function OtherProfile({ profile }: { profile: PublicProfile }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile'] }),
      queryClient.invalidateQueries({ queryKey: ['friends'] }),
    ]);
  const onError = (actionError: unknown) =>
    setError(actionError instanceof Error ? actionError.message : 'That action failed.');

  const add = useMutation({ mutationFn: () => social.addFriend(profile.id), onSuccess: refresh, onError });
  const remove = useMutation({
    mutationFn: () => social.removeFriend(profile.id),
    onSuccess: refresh,
    onError,
  });

  return (
    <div className="max-w-2xl space-y-6">
      <section
        className="surface relative overflow-hidden p-6"
        style={
          profile.accentColor
            ? { boxShadow: `inset 0 1px 0 0 ${profile.accentColor}33` }
            : undefined
        }
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl"
          style={{ background: `${profile.accentColor ?? '#7c5cff'}22` }}
        />
        <div className="relative flex flex-wrap items-center gap-5">
          <Avatar profile={profile} size={88} ring />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-extrabold text-white">
              {profile.displayName || profile.username}
            </h1>
            <p className="truncate text-sm text-zinc-500">@{profile.username}</p>
            <p className="mt-1 text-xs text-zinc-600">Joined {formatDate(profile.createdAt)}</p>
          </div>
        </div>

        {profile.bio && (
          <p className="relative mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
            {profile.bio}
          </p>
        )}

        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          {profile.friendStatus === 'friends' ? (
            <>
              <Link to={`/messages/${profile.id}`} className="btn-primary">
                <MessageSquare size={15} />
                Message
              </Link>
              <button type="button" onClick={() => remove.mutate()} className="btn-ghost">
                <UserMinus size={15} />
                Remove friend
              </button>
            </>
          ) : profile.friendStatus === 'pending_out' ? (
            <>
              <span className="pill">Request sent</span>
              <button type="button" onClick={() => remove.mutate()} className="btn-ghost">
                Cancel request
              </button>
            </>
          ) : profile.friendStatus === 'pending_in' ? (
            <Link to="/friends" className="btn-primary">
              <UserPlus size={15} />
              Respond to request
            </Link>
          ) : profile.friendStatus === 'blocked' ? (
            <span className="pill">Blocked</span>
          ) : (
            <button
              type="button"
              onClick={() => add.mutate()}
              disabled={add.isPending}
              className="btn-primary"
            >
              <UserPlus size={15} />
              Add friend
            </button>
          )}
        </div>

        {error && <p className="relative mt-3 text-xs text-red-400">{error}</p>}
      </section>
    </div>
  );
}
