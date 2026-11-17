import { useEffect, useState } from 'react';

const get = (query) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;

/** Subscribes to a CSS media query. */
export const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => get(query));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
};

// Must match the breakpoints documented in themes.css (cannot use custom properties in @media)
export const PHONE_QUERY = '(max-width: 767.98px)';
export const useIsPhone = () => useMediaQuery(PHONE_QUERY);

/** True on touch-first devices (finger, no hover); decides long-press vs right-click. */
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)');
