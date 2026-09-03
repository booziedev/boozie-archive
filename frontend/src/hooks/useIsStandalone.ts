import { useEffect, useState } from 'react';

/**
 * True when the app runs as an installed PWA (iOS home screen or a desktop
 * install). Used to hide the "add to home screen" hint and to add the extra
 * bottom padding the home indicator needs.
 */
export function useIsStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(display-mode: standalone)');
    const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
    const update = () => setStandalone(query.matches || iosStandalone);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return standalone;
}

/** True on iOS/iPadOS Safari, where installing works differently to Chrome. */
export function useIsIOS(): boolean {
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const ua = window.navigator.userAgent;
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS 13+ reports as a Mac; the touch points give it away.
      (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    setIos(isIOS);
  }, []);
  return ios;
}
