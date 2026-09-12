import { useEffect, useState } from 'react';

import { mediaUrl } from '../lib/api';
import { mediaCrossOrigin } from '../lib/config';
import { gradientFor, initials } from '../lib/format';

interface CoverImageProps {
  /** Album, artist or track id — the API resolves all three. */
  id: string;
  name: string;
  /**
   * An explicit image path, which wins over `id`.
   *
   * For artwork this server holds but the library index does not know about —
   * an uploaded image, or a catalogue picture we cached. Always a path on this
   * origin; a remote URL here would leak the viewer's IP to whoever serves it,
   * which is exactly what the caching exists to prevent. `id` and `name` still
   * seed the placeholder underneath.
   */
  src?: string | null;
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
  src = null,
  size = 320,
  hasCover = true,
  rounded = 'rounded-xl',
  className = '',
  eager = false,
}: CoverImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // A new entity — or a new explicit image — means a new picture to fade in.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [id, src, size]);

  // `hasCover` is the library index saying there is nothing to fetch; it has
  // no say over an image we were handed directly.
  const showImage = (src || hasCover) && !failed;

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
          src={src || mediaUrl.cover(id, size)}
          alt=""
          // Sends the session cookie when the API is on another origin.
          crossOrigin={mediaCrossOrigin()}
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
