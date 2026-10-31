// The fullscreen toggle (#zfs): the diagram and its tour card (#stage), not the page. Hidden where the Fullscreen API is missing or refused.
import { $ } from "./state.ts";

export function fsState(on: boolean): { label: string; pressed: string } {
  return on ? { label: "Exit full screen", pressed: "true" } : { label: "Full screen", pressed: "false" };
}

export function installFullscreen(): void {
  const b = $("zfs"), stage = $("stage");
  if (!document.fullscreenEnabled) return;
  b.hidden = false;
  const sync = () => {
    const { label, pressed } = fsState(document.fullscreenElement === stage);
    b.setAttribute("aria-pressed", pressed);
    b.setAttribute("aria-label", label);
    b.title = label;
  };
  b.onclick = async () => {
    try {
      await (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen());
    } catch {
      b.hidden = true;
    }
  };
  document.addEventListener("fullscreenchange", sync);
  sync();
}
