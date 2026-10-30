// The fullscreen toggle (#zfs): the whole page. Hidden where the Fullscreen API is missing or refused.
import { $ } from "./state.ts";

export function installFullscreen(): void {
  const b = $("zfs");
  if (!document.fullscreenEnabled) return;
  b.hidden = false;
  const sync = () => {
    const on = !!document.fullscreenElement, label = on ? "Exit full screen" : "Full screen";
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", label);
    b.title = label;
  };
  b.onclick = async () => {
    try {
      await (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
    } catch {
      b.hidden = true;
    }
  };
  document.addEventListener("fullscreenchange", sync);
  sync();
}
