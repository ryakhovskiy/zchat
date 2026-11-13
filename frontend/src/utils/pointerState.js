// Tracks whether a touch is currently down, so overlays opened by a long-press can ignore
// input until that same finger lifts (its release would otherwise click whatever is now
// under it: the scrim, or even an action button).

const STALE_MS = 15000; // a pointerup can be lost (browser quirks): never trust "down" for longer
const down = new Map(); // pointerId -> pointerdown timestamp
const releaseListeners = new Set();

const prune = () => {
  const now = Date.now();
  for (const [id, at] of down) if (now - at > STALE_MS) down.delete(id);
};

if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') down.set(e.pointerId, Date.now());
    },
    true
  );
  const release = (e) => {
    if (!down.delete(e.pointerId)) return;
    prune();
    if (down.size === 0) {
      const callbacks = [...releaseListeners];
      releaseListeners.clear();
      callbacks.forEach((fn) => fn());
    }
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
}

export const isTouchDown = () => {
  prune();
  return down.size > 0;
};

/** Calls `fn` once, when no touch is down any more. Returns an unsubscribe function. */
export const onTouchRelease = (fn) => {
  releaseListeners.add(fn);
  return () => releaseListeners.delete(fn);
};
