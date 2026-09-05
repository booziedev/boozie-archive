import { useState } from 'react';
import { Disc3 } from 'lucide-react';

interface LogoProps {
  size?: number;
  className?: string;
  /** Adds the rounded accent tile behind the mark (used in the sidebar). */
  tile?: boolean;
}

/**
 * The site mark.
 *
 * Renders `public/icons/logo.png` when it is present and falls back to the
 * built-in disc glyph when it is not, so the app never shows a broken image
 * whether or not a custom logo has been dropped in. Replace that one file (and
 * run `npm run icons` to regenerate the favicon and PWA sizes) to rebrand every
 * place the mark appears.
 */
export function Logo({ size = 36, className = '', tile = true }: LogoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return tile ? (
      <span
        className={`flex items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-glow shadow-glow ${className}`}
        style={{ width: size, height: size }}
      >
        <Disc3 size={Math.round(size * 0.55)} className="text-white" />
      </span>
    ) : (
      <Disc3 size={size} className={`text-accent-400 ${className}`} />
    );
  }

  return (
    <img
      src="/icons/logo.png"
      alt=""
      width={size}
      height={size}
      decoding="async"
      onError={() => setFailed(true)}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
