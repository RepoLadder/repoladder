// The Ask bar and answer panel: builds the DOM (createElement and textContent only, never markup strings), feeds the state
// machine from the server's stream and draws what it says. Answers go through answer.ts, so only checked citations are links.
import type { Target } from "../../model/cite.ts";
import { answerPlan, renderPlan } from "./answer.ts";
import { ask, probe, type AskEvent, type Status } from "./api.ts";
import { keyAction } from "./keys.ts";
import { busy, initial, reduce, type Ev, type State } from "./state.ts";

export type Deps = { canvas: HTMLElement; token: string; status: Status; fetch: typeof fetch; locate: (t: Target) => boolean };

const RECHECK = new Set(["NO_CLAUDE", "OLD_CLI", "SIGNED_OUT"]);

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  if (el instanceof HTMLButtonElement) el.type = "button";
  return el;
}

export function mount(d: Deps): void {
  let state: State = d.status.available ? initial() : reduce(initial(), { type: "unavailable", code: d.status.code, message: d.status.message });
  let starters = d.status.available ? d.status.starters : [];
  let open = false, ctrl: AbortController | undefined, frame = 0, lastQ = "";

  const root = h("div", ""), bar = h("div", "ask-bar"), input = h("input", "ask-input"), act = h("button", "ask-act", "Send");
  root.id = "ask";
  root.setAttribute("role", "search");
  root.setAttribute("aria-label", "Ask about this code");
  input.type = "text";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Ask a question about this code");
  const panel = h("div", "ask-panel"), turns = h("div", "ask-turns"), note = h("p", "ask-note"), tray = h("div", "ask-tray"), row = h("div", "ask-row");
  note.setAttribute("aria-live", "polite");
  panel.append(turns, note, tray, row);
  bar.append(input, act);
  // bar first: Tab goes bar, Send/Stop, then the panel's starters and citations; CSS puts the panel above the bar on wide screens
  root.append(bar, panel);
  for (const t of ["pointerdown", "click", "dblclick", "wheel"]) root.addEventListener(t, (e) => e.stopPropagation());

  const dispatch = (e: Ev) => {
    const next = reduce(state, e);
    if (next === state) return;
    state = next;
    if (e.type === "submit") open = true;
    if (busy(state) && e.type !== "submit") { if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); }); return; }
    draw();
  };

  const send = (q: string) => {
    if (busy(state) || !q.trim() || state.phase === "no-agent") return;
    lastQ = q.trim();
    dispatch({ type: "submit", q });
    if (!busy(state)) return;
    input.value = "";
    const mine = (ctrl = new AbortController());
    void ask(d.fetch, d.token, { question: lastQ, conversation: state.conversation }, mine.signal, (e: AskEvent) => { if (mine === ctrl) dispatch(e as Ev); });
  };

  const stop = () => { ctrl?.abort(); dispatch({ type: "stop" }); };

  const recheck = async () => {
    const s = await probe(d.fetch, d.token);
    if (!s) return dispatch({ type: "unavailable", code: "AGENT_FAILED", message: "RepoLadder could not reach its local server. Run `repoladder serve` again if it is not running." });
    if (s.available) { starters = s.starters; state = initial(); draw(); }
    else dispatch({ type: "unavailable", code: s.code, message: s.message });
  };

  const btn = (label: string, on: () => void) => { const b = h("button", "ask-ghost", label); b.onclick = on; return b; };

  function draw() {
    const pinned = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 8;
    const ph = state.phase, hasTurns = state.turns.length > 0;
    const showPanel = open && (hasTurns || ph === "no-agent" || (ph === "idle" && starters.length > 0));
    panel.hidden = !showPanel;
    root.dataset.phase = ph;
    root.classList.toggle("has-panel", showPanel);
    input.disabled = ph === "no-agent";
    input.placeholder = ph === "no-agent" ? "Ask is unavailable" : hasTurns ? "Ask a follow-up" : "Ask about this code";
    act.textContent = busy(state) ? "Stop" : "Send";
    act.disabled = ph === "no-agent";
    act.onclick = busy(state) ? stop : () => send(input.value);
    act.setAttribute("aria-label", busy(state) ? "Stop the answer" : "Send the question");
    turns.replaceChildren();
    state.turns.forEach((t, i) => {
      const block = h("div", "ask-turn");
      block.append(h("p", "ask-q", t.q));
      const a = h("div", "ask-a");
      const settled = t.segments !== undefined;
      const plan = settled ? answerPlan({ mode: "settled", segments: t.segments ?? null, text: t.text }) : answerPlan({ mode: "streaming", text: t.text });
      a.append(renderPlan(document, plan, (ref) => { d.locate(ref); }));
      if (ph === "stopped" && i === state.turns.length - 1) a.append(h("span", "ask-muted", " (stopped)"));
      block.append(a);
      turns.append(block);
    });
    const lastTurn = state.turns[state.turns.length - 1];
    note.textContent = ph === "loading" ? "Asking Claude Code…" : ph === "streaming" && lastTurn?.tools.length ? "Looking at the code…" : "";
    note.hidden = !note.textContent;
    tray.replaceChildren();
    row.replaceChildren();
    if (ph === "idle" && !hasTurns) for (const s of starters) { const b = h("button", "ask-starter", s); b.onclick = () => send(s); tray.append(b); }
    if (ph === "error" || ph === "no-agent") {
      const e = state.error!;
      tray.append(h("p", "ask-err", e.message));
      if (ph === "no-agent" || RECHECK.has(e.code)) row.append(btn("Check again", () => void recheck()));
      else row.append(btn("Try again", () => { dispatch({ type: "retry" }); send(lastQ); }));
    }
    if (ph === "done" || ph === "stopped" || ph === "error") row.append(btn("New question", () => { dispatch({ type: "reset" }); input.focus(); }));
    if (pinned) panel.scrollTop = panel.scrollHeight;
  }

  root.addEventListener("keydown", (ev) => {
    const inInput = ev.target === input;
    const a = keyAction({ key: ev.key, typing: inInput, inAsk: true, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey, hasPanelOpen: !panel.hidden, canSubmit: inInput && !!input.value.trim() && !busy(state), blocked: false });
    if (a === "submit" && inInput) { ev.preventDefault(); send(input.value); }
    else if (a === "collapse" || a === "blur") {
      // handled here so the board's own Escape (up a level) doesn't also fire
      ev.stopPropagation();
      ev.preventDefault();
      if (a === "collapse") { open = false; draw(); } else (ev.target as HTMLElement).blur();
    }
  });
  input.addEventListener("focus", () => { if (!open) { open = true; draw(); } });
  input.addEventListener("click", () => { if (!open) { open = true; draw(); } });
  document.addEventListener("keydown", (ev) => {
    if (root.contains(ev.target as Node)) return;
    const t = ev.target as Element | null;
    const a = keyAction({ key: ev.key, typing: !!t?.closest?.("input,textarea,select,[contenteditable]"), inAsk: false, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey, hasPanelOpen: false, blocked: !!document.fullscreenElement || !!document.querySelector("dialog[open]") });
    if (a === "focus" && !input.disabled) { ev.preventDefault(); input.focus(); }
  });
  d.canvas.append(root);
  draw();
}
