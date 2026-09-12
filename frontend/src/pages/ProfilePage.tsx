import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Check,
  Loader2,
  MessageSquare,
  Pencil,
  Radio,
  UserMinus,
  UserPlus,
} from 'lucide-react';

import { Avatar } from '../components/Avatar';
import { FeaturedShowcase } from '../components/FeaturedShowcase';
import { ListeningNow } from '../components/ListeningNow';
import { ShowcaseEditor } from '../components/ShowcaseEditor';
import { ErrorState } from '../components/states';
import { playlists, social } from '../lib/api';
import { PlaylistCard } from './PlaylistsPage';
import { useAuth } from '../context/AuthContext';
import { usePresence } from '../context/PresenceContext';
import { formatDate } from '../lib/format';
import { ACCEPTED_IMAGES, MAX_IMAGE_MB } from '../lib/images';
import type { PublicProfile } from '../lib/types';

/**
 * Somebody's profile.
 *
 * Self and other render the *same* page. That matters more than it sounds: a
 * showcase is something you curate for other people to look at, and until this
 * split existed opening your own profile put you straight into form fields, so
 * there was no way to see what anybody else saw. Editing is now a mode on top
 * of the real thing, held in the URL so a reload keeps it and the back button
 * leaves it.
 */
export function ProfilePage() {
  const { username } = useParams<{ username?: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const isSelf = !username || username.toLowerCase() === user?.username.toLowerCase();
  const editing = isSelf && params.get('edit') === '1';

  const profileQuery = useQuery({
    queryKey: isSelf ? ['profile', 'me'] : ['profile', username],
    queryFn: () => (isSelf ? social.myProfile() : social.profile(username!)),
    // The track shown here comes from the shared presence poll; this query only
    // needs to catch slower things, like them turning listening-along off.
    refetchInterval: isSelf ? false : 30_000,
    refetchIntervalInBackground: false,
  });

  const profile = profileQuery.data?.profile;
  const showcase = profileQuery.data?.showcase;

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

  const setEditing = (next: boolean) => {
    const updated = new URLSearchParams(params);
    if (next) updated.set('edit', '1');
    else updated.delete('edit');
    setParams(updated, { replace: true });
  };

  const onSaved = () => {
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
    void queryClient.invalidateQueries({ queryKey: ['friends'] });
  };

  return (
    /*
      Wider than the rest of the account pages: a row of five featured tiles —
      let alone ten — has nowhere to go at the 2xl this used to be.
    */
    <div className="max-w-4xl space-y-6">
      {editing && <ProfileEditor profile={profile} onSaved={onSaved} />}

      <ProfileHeader
        profile={profile}
        isSelf={isSelf}
        editing={editing}
        onToggleEdit={setEditing}
      />

      {editing && showcase ? (
        <ShowcaseEditor showcase={showcase} />
      ) : (
        showcase && <FeaturedShowcase showcase={showcase} />
      )}

      <ProfilePlaylists profile={profile} isSelf={isSelf} />
    </div>
  );
}

/**
 * The header everybody sees, including its owner.
 *
 * One piece of markup for both cases; only the row of actions differs, which
 * is what guarantees your own profile looks like your profile.
 */
function ProfileHeader({
  profile,
  isSelf,
  editing,
  onToggleEdit,
}: {
  profile: PublicProfile;
  isSelf: boolean;
  editing: boolean;
  onToggleEdit: (next: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { statusOf } = usePresence();
  const [error, setError] = useState<string | null>(null);
  // Live, so their track updates as they skip rather than on the next refetch.
  const listeningNow = statusOf(profile.id) ?? profile.listeningNow ?? null;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile'] }),
      queryClient.invalidateQueries({ queryKey: ['friends'] }),
    ]);
  const onError = (actionError: unknown) =>
    setError(actionError instanceof Error ? actionError.message : 'That action failed.');

  const add = useMutation({
    mutationFn: () => social.addFriend(profile.id),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: () => social.removeFriend(profile.id),
    onSuccess: refresh,
    onError,
  });

  return (
    <section className="surface relative overflow-hidden p-6">
      <div className="relative flex flex-wrap items-center gap-5">
        <Avatar profile={profile} size={88} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold text-white">
            {profile.displayName || profile.username}
          </h1>
          <p className="truncate text-sm text-zinc-500">@{profile.username}</p>
          {listeningNow ? (
            <ListeningNow now={listeningNow} className="mt-1.5" />
          ) : (
            <p className="mt-1 text-xs text-zinc-600">Joined {formatDate(profile.createdAt)}</p>
          )}
        </div>
      </div>

      {profile.bio && (
        <p className="relative mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
          {profile.bio}
        </p>
      )}

      <div className="relative mt-5 flex flex-wrap items-center gap-2">
        {isSelf ? (
          <button
            type="button"
            onClick={() => onToggleEdit(!editing)}
            className={editing ? 'btn-primary' : 'btn-ghost'}
          >
            {editing ? <Check size={15} /> : <Pencil size={15} />}
            {editing ? 'Done' : 'Edit profile'}
          </button>
        ) : profile.friendStatus === 'friends' ? (
          <>
            <Link to={`/messages/${profile.id}`} className="btn-primary">
              <MessageSquare size={15} />
              Message
            </Link>
            <ListenAlongButton profile={profile} />
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
  );
}

/**
 * Name, bio and picture.
 *
 * Shown above the live header while editing, so a change can be checked
 * against the real thing rather than a mock of it.
 */
function ProfileEditor({ profile, onSaved }: { profile: PublicProfile; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
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
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (uploadError) =>
      setError(uploadError instanceof Error ? uploadError.message : 'Could not upload that image.'),
  });

  const removePicture = useMutation({
    mutationFn: () => social.removeAvatar(),
    onSuccess: () => {
      setError(null);
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
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setError(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_IMAGE_MB} MB.`,
      );
      return;
    }
    upload.mutate(file);
  }

  /*
   * Only the two fields this form owns are sent. The server patches what it is
   * given and leaves everything else alone, so this can no longer clobber an
   * avatar somebody just uploaded.
   */
  const save = useMutation({
    mutationFn: () =>
      social.updateProfile({
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
      }),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      onSaved();
    },
    onError: (saveError) =>
      setError(saveError instanceof Error ? saveError.message : 'Could not save your profile.'),
  });

  return (
    <section className="surface space-y-5 p-5">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
          Editing your profile
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Everything below this panel is exactly what other people see.
        </p>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_IMAGES}
        onChange={onFilePicked}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          aria-label="Change your profile picture"
          title="Click to upload a picture or GIF"
          className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          <Avatar profile={profile} size={64} />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
            {upload.isPending ? (
              <Loader2 size={18} className="animate-spin text-white" />
            ) : (
              <Camera size={18} className="text-white" />
            )}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed text-zinc-600">
            {upload.isPending
              ? 'Uploading…'
              : `Click your picture to change it — PNG, JPEG, WebP or an animated GIF, up to ${MAX_IMAGE_MB} MB.`}
          </p>
          {profile.avatarUrl && (
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
      </div>

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
          Save name and bio
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-400">
            <Check size={15} />
            Saved
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * The playlists on somebody's profile.
 *
 * Filtered by the same rules as everywhere else, so this only ever shows what
 * the viewer could already have found: public lists, friends-only ones when
 * they are friends, and anything they were invited to by name. On your own
 * profile it is simply all of yours.
 */
function ProfilePlaylists({ profile, isSelf }: { profile: PublicProfile; isSelf: boolean }) {
  const query = useQuery({
    queryKey: ['playlists', 'owner', profile.id],
    queryFn: () => playlists.list(profile.id),
  });

  const found = query.data?.playlists ?? [];
  // A generated list is private to the people in it and would read oddly on a
  // profile, so only hand-made ones are shown here.
  const visible = found.filter((playlist) => playlist.kind === 'manual');

  if (query.isLoading || visible.length === 0) return null;

  return (
    <section className="surface p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold uppercase tracking-[0.14em] text-zinc-300">Playlists</h2>
        {isSelf && (
          <Link to="/playlists" className="text-xs text-zinc-500 transition-colors hover:text-zinc-300">
            Manage
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {visible.slice(0, 6).map((playlist) => (
          <PlaylistCard key={playlist.id} playlist={playlist} />
        ))}
      </div>
    </section>
  );
}

function ListenAlongButton({ profile }: { profile: PublicProfile }) {
  const { party, isFollowing, listenAlongWith, leaveParty, statusOf } = usePresence();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const followingThem = isFollowing && party?.hostId === profile.id;

  /*
   * Both live: the button appears the moment they start playing something.
   *
   * Something *here*, though. A status scrobbled from Spotify says what they
   * are listening to, but there is no player of theirs to follow and no file
   * behind the track — offering to join would hand whoever pressed it an empty
   * room.
   */
  const status = statusOf(profile.id);
  if (!profile.canListenAlong || !status || status.source !== 'archive') return null;

  async function start() {
    setFailure(null);
    setBusy(true);
    try {
      await listenAlongWith(profile.id);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not start listening along.');
    } finally {
      setBusy(false);
    }
  }

  if (followingThem) {
    return (
      <button type="button" onClick={() => void leaveParty()} className="btn-ghost">
        <Radio size={15} className="text-accent-400" />
        Stop listening along
      </button>
    );
  }

  return (
    <>
      <button type="button" onClick={() => void start()} disabled={busy} className="btn-ghost">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Radio size={15} />}
        Listen together
      </button>
      {failure && <span className="text-xs text-red-400">{failure}</span>}
    </>
  );
}
