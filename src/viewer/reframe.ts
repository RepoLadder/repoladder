// The Reframe button (#zfit): shown only when the view is off the board's fit, so pressing it never does nothing.
import { st } from "./state.ts";

type View = number[];

/** Whether two views are the same, to the half unit. */
export const sameView = (a: View, b: View) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.5);

/** The view is the board's fit. */
export const atFit = () => sameView(st.view, st.base);

/** Set while something else frames the board (walkthrough, tour): Reframe stays hidden. */
let owned = false;
export const setOwned = (on: boolean) => void (owned = on);

/** Shows Reframe only off the fit. A no-op before the button or the board exist. */
export function syncReframe(): void {
  const b = typeof document === "undefined" ? null : document.getElementById("zfit");
  if (!b || !st.svgEl) return;
  b.hidden = atFit() || owned;
}
