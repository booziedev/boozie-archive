import { gradientFor, initials } from '../lib/format';
import type { PublicProfile } from '../lib/types';

interface AvatarProps {
  profile: Pick<PublicProfile, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'accentColor'>;
  size?: number;
  className?: string;
  /** Shows a coloured ring in the profile's accent colour. */
  ring?: boolean;
}

/**
 * Profile picture with a deterministic gradient fallback.
 *
 * Avatar URLs are validated server-side against the media host allowlist, so
 * what lands here is always one of the picker's providers — animated GIFs
 * included, which is why this is a plain <img> rather than a background image.
 */
export function Avatar({ profile, size = 40, className = '', ring = false }: AvatarProps) {
  const name = profile.displayName || profile.username;
  const accent = profile.accentColor ?? undefined;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: gradientFor(profile.id || profile.username),
        boxShadow: ring && accent ? `0 0 0 2px ${accent}` : undefined,
      }}
      title={name}
    >
      {profile.avatarUrl ? (
        <img
          src={profile.avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          className="font-semibold uppercase text-white/70"
          style={{ fontSize: Math.max(10, size * 0.36) }}
        >
          {initials(name)}
        </span>
      )}
    </span>
  );
}
