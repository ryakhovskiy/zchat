import { useEffect } from 'react';

/**
 * Keeps --app-height equal to the *visual* viewport so the composer stays above the on-screen
 * keyboard on iOS Safari (where 100dvh does not shrink for the keyboard). Where the layout
 * viewport already resizes (Chrome Android with interactive-widget=resizes-content) the two
 * values agree and nothing visible changes. Without visualViewport support the CSS falls back
 * to 100dvh / 100vh.
 */
export const useAppHeight = () => {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return undefined;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
        // iOS scrolls the (non-scrollable) page up when the keyboard opens: undo that
        if (vv.offsetTop > 0) window.scrollTo(0, 0);
      });
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--app-height');
    };
  }, []);
};
