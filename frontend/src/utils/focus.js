// Focus helpers that understand shadow DOM (emoji-mart renders inside a shadow root).

const CANDIDATE =
  'a[href], button, textarea, input, select, summary, [contenteditable="true"], [tabindex]';

const isTabbable = (el) => {
  if (el.disabled || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
  if (el.tabIndex < 0) return false; // tabindex="-1" (roving radios, programmatic focus targets)
  if (el.tagName === 'INPUT' && el.type === 'hidden') return false;
  if (el.getClientRects().length === 0) return false;
  return getComputedStyle(el).visibility !== 'hidden';
};

/** Tabbable elements under `root` in DOM order, descending into open shadow roots. */
export const getTabbables = (root) => {
  const found = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (child.matches(CANDIDATE) && isTabbable(child)) found.push(child);
      if (child.shadowRoot) visit(child.shadowRoot);
      visit(child);
    }
  };
  visit(root);
  return found;
};

/** document.activeElement, resolved through shadow roots to the element that really has focus. */
export const deepActiveElement = () => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
};

/** The ancestor of `el` (crossing shadow boundaries via hosts) that lives in `container`'s light tree. */
export const lightTreeAncestor = (el, container) => {
  let node = el;
  while (node) {
    if (container.contains(node)) return node;
    const rootNode = node.getRootNode();
    node = rootNode instanceof ShadowRoot ? rootNode.host : null;
  }
  return null;
};

/**
 * Keeps Tab / Shift+Tab inside `container`. Call from a keydown handler; returns true if it
 * handled (prevented) the event.
 */
export const trapTab = (event, container) => {
  const items = getTabbables(container);
  if (items.length === 0) {
    event.preventDefault();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = deepActiveElement();
  const index = items.indexOf(active);
  const activeLight = active ? lightTreeAncestor(active, container) : null;

  let wrapTo = null;
  if (!activeLight || activeLight === container) {
    // Focus is on the panel itself (or outside): enter at the start/end
    wrapTo = event.shiftKey ? last : first;
  } else if (index >= 0) {
    if (event.shiftKey && active === first) wrapTo = last;
    else if (!event.shiftKey && active === last) wrapTo = first;
  } else {
    // Focused element is inside but not tabbable (e.g. a tabindex=-1 radio): wrap when it is
    // positioned before the first / after the last tab stop
    const firstLight = lightTreeAncestor(first, container);
    const lastLight = lightTreeAncestor(last, container);
    const before = (a, b) => a !== b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (event.shiftKey && before(activeLight, firstLight)) wrapTo = last;
    else if (!event.shiftKey && before(lastLight, activeLight)) wrapTo = first;
  }

  if (wrapTo) {
    event.preventDefault();
    wrapTo.focus({ preventScroll: true });
    return true;
  }
  return false;
};
