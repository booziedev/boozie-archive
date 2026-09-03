import { useEffect, useState } from 'react';

import { mediaUrl } from '../lib/api';
import { gradientFor, initials } from '../lib/format';

interface CoverImageProps {
  /** Album, artist or track id — the API resolves all three. */
  id: string;
  name: string;
  size?: 128 | 320 | 640;
  /** Skip the network request entirely when the index says there is no art. */
  hasCover?: boolean;
  rounded?: string;
  className?: string;
  eager?: boolean;
}

/**
 * Cover art with a deterministic gradient placeholder.
 *
 * The placeholder is always rendered underneath the image so there is never a
 * blank tile: the image simply fades in on top once it has decoded, and a
 * failed request (missing artwork) just leaves the gradient in place.
 */
export function CoverImage({
  id,
  name,
  size = 320,
  hasCover = true,
  rounded = 'rounded-xl',
  className = '',
  eager = false,
}: CoverImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // A new entity means a new image: reset the fade state.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [id, size]);

  const showImage = hasCover && !failed;

  return (
    <div
      className={`relative isolate overflow-hidden ${rounded} bg-ink-800 ${className}`}
      style={{ background: gradientFor(id || name) }}
    >
      <div
        aria-hidden
        className="absolute inset-0 flex items-center justify-center font-semibold tracking-widest text-white/25"
        style={{ fontSize: 'clamp(1rem, 22cqw, 3rem)', containerType: 'inline-size' }}
      >
        {initials(name)}
      </div>

      {showImage && (
        <img
          src={mediaUrl.cover(id, size)}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-vault ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Subtle sheen so flat artwork still reads as a physical object. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-card-sheen mix-blend-overlay" />
    </div>
  );
}
