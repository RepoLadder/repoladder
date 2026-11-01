// The popover menu under a top-bar button (Tours, Filters): positioned from the button, one at a time, closed by
// Escape (before the board or a tour hears it), Tab, a click outside or on a choice; arrows move through the buttons.
let current: { el: HTMLElement; anchor: HTMLElement } | null = null;

export const closeBarMenu = (refocus = false): void => {
  if (!current) return;
  const { el, anchor } = current;
  current = null;
  el.remove();
  anchor.setAttribute("aria-expanded", "false");
  if (refocus) anchor.focus();
};

export const barMenuOpen = (): boolean => !!current;

export function openBarMenu(anchor: HTMLElement, html: string, label: string, closeOnPick = true): void {
  closeBarMenu();
  const el = document.createElement("div");
  el.className = "bmenu exp-ui";
  el.setAttribute("role", "menu");
  el.setAttribute("aria-label", label);
  el.innerHTML = html;
  // in the body, not the canvas: the stage is its own stacking context, under the side panel
  document.body.append(el);
  const a = anchor.getBoundingClientRect();
  el.style.top = `${a.bottom + 4}px`;
  el.style.maxHeight = `${Math.max(120, innerHeight - a.bottom - 16)}px`;
  el.style.right = `${Math.max(4, Math.min(innerWidth - a.right, innerWidth - el.offsetWidth - 4))}px`;
  anchor.setAttribute("aria-expanded", "true");
  current = { el, anchor };
  const items = () => [...el.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  items()[0]?.focus({ preventScroll: true });
  el.onclick = (e) => { if (closeOnPick && (e.target as Element).closest("button")) closeBarMenu(true); };
  el.onkeydown = (e) => {
    if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); closeBarMenu(true); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const l = items(), i = l.indexOf(document.activeElement as HTMLElement);
      l[(i + (e.key === "ArrowDown" ? 1 : l.length - 1)) % l.length]?.focus();
    }
  };
}

// Registered once from main.ts beside installExport, early enough to run before the tour's own Escape handler.
export function installBarMenuKeys(): void {
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !current) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeBarMenu(true);
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (current && !(e.target as Element).closest(".bmenu") && !current.anchor.contains(e.target as Node)) closeBarMenu();
  });
}
