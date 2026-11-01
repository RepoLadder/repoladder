// Which Ask key action a keypress means. Pure. `/`, Cmd/Ctrl+K and Escape outside the input belong to Search and the board.
export type KeyIn = { key: string; typing: boolean; inAsk: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; hasPanelOpen: boolean; canSubmit?: boolean; blocked?: boolean };
export type KeyAct = "focus" | "submit" | "collapse" | "blur" | null;

export function keyAction(k: KeyIn): KeyAct {
  if (k.blocked || k.metaKey || k.ctrlKey || k.altKey) return null;
  if (k.inAsk) {
    if (k.key === "Enter") return k.canSubmit === false ? null : "submit";
    if (k.key === "Escape") return k.hasPanelOpen ? "collapse" : "blur";
    return null;
  }
  return k.key === "?" && !k.typing ? "focus" : null;
}
