'use client';

/**
 * Registers the /sw.js service worker on first paint of the driver
 * app. Skips registration on http://localhost when not in HTTPS, since
 * SW registration requires a secure context.
 */
import { useEffect } from 'react';

export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    // SW only works on secure origins; localhost is treated as secure
    // for development.
    const isSecure = window.isSecureContext;
    if (!isSecure) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/driver/' }).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[driver-sw] registration failed', err);
    });
  }, []);
  return null;
}
