// One stack for every overlay (sheets, call UI, image lightbox). Keyboard handling (Esc, Tab trap)
// belongs to the topmost overlay only, so e.g. an incoming call that appears above an open
// Settings sheet gets the first Esc instead of the sheet behind it.

const stack = [];

/** Registers an open overlay; returns a token for isTopOverlay / popOverlay. */
export const pushOverlay = () => {
  const token = {};
  stack.push(token);
  return token;
};

export const popOverlay = (token) => {
  const index = stack.indexOf(token);
  if (index >= 0) stack.splice(index, 1);
};

export const isTopOverlay = (token) => stack[stack.length - 1] === token;
