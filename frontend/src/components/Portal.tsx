import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Renders children at the end of `<body>`, outside whatever is above them.
 *
 * Every overlay in this app needs this, and until now none of them had it.
 * `position: fixed` does not mean "the viewport" — it means "the nearest
 * ancestor with a transform, a filter, a backdrop-filter or containment", and
 * only the viewport when there is no such ancestor. This app has both:
 *
 *  - `.surface` carries `backdrop-blur-xl`, so every panel in the app traps
 *    fixed descendants;
 *  - `animate-fade-up` and friends use `animation-fill-mode: both`, which
 *    leaves the last keyframe's `transform: translateY(0)` on the element
 *    permanently — still a transform, still a containing block.
 *
 * So a dialog opened from a track row was being positioned, clipped *and*
 * stacked inside the track list, which is why the album header painted over
 * the top of it. Rendering into `<body>` is the fix, and it is the reason a
 * `z-50` on a dialog now means what it says.
 */
export function Portal({ children }: { children: ReactNode }) {
  // No SSR here, so `document.body` is always available by render time.
  return createPortal(children, document.body);
}
