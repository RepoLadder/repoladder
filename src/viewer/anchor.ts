// Where a popover opens relative to the button that owns it: downward from a button in the upper half of the canvas,
// upward from one in the lower half, so the menu and the note stay inside the canvas wherever the button sits.
export interface Anchor { top?: number; bottom?: number; right: number }

export function anchorFor(b: DOMRect, c: DOMRect): Anchor {
  const gap = (v: number) => Math.max(0, v), right = gap(c.right - b.right);
  return b.top + b.bottom > c.top + c.bottom ? { bottom: gap(c.bottom - b.top + 4), right } : { top: gap(b.bottom - c.top + 4), right };
}

/** Applies an anchor to an absolutely positioned element, clearing the side it doesn't use. */
export function place(e: HTMLElement, a: Anchor): void {
  const px = (v?: number) => (v === undefined ? "auto" : `${v}px`);
  e.style.top = px(a.top);
  e.style.bottom = px(a.bottom);
  e.style.right = px(a.right);
}
