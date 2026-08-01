/**
 * Admin v2 mobile breakpoint — one boolean the whole v2 surface branches on.
 * Same 768px line as src/hooks/use-mobile.jsx, but initialised synchronously
 * so the first paint on a phone never flashes the desktop chrome.
 */
import { useEffect, useState } from 'react';

const QUERY = '(max-width: 767px)';

// jsdom (vitest) ships no matchMedia — treat that as desktop so the existing
// component tests keep exercising the layout they were written against.
const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

export function useAdminV2Mobile() {
  const [mobile, setMobile] = useState(() => canMatch() && window.matchMedia(QUERY).matches);

  useEffect(() => {
    if (!canMatch()) return undefined;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setMobile(mql.matches);
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return mobile;
}
