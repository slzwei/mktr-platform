import { useEffect, useState } from 'react';

const QUERY = '(max-width: 719px)';

/** Marketplace mobile breakpoint — matches the ≤719px media queries in marketplace.css. */
export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
