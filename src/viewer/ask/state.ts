// The Ask panel's state machine: pure, so every transition is a table test. The view only draws what this says.
import type { Segment } from "../../model/cite.ts";

export type Phase = "idle" | "loading" | "streaming" | "done" | "error" | "no-agent" | "stopped";
export type Turn = { q: string; text: string; segments?: Segment[] | null; tools: string[] };
export type Problem = { code: string; message: string };
export type State = { phase: Phase; turns: Turn[]; conversation?: string; error?: Problem };
export type Ev =
  | { type: "submit"; q: string }
  | { type: "start"; conversation: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "done"; text: string; segments: Segment[] | null; conversation?: string }
  | { type: "error"; code: string; message: string }
  | { type: "stop" }
  | { type: "retry" }
  | { type: "reset" }
  | { type: "unavailable"; code: string; message: string };

export const initial = (): State => ({ phase: "idle", turns: [] });
export const busy = (s: State) => s.phase === "loading" || s.phase === "streaming";

const last = (s: State, f: (t: Turn) => Turn): Turn[] => s.turns.map((t, i) => (i === s.turns.length - 1 ? f(t) : t));

export function reduce(s: State, e: Ev): State {
  switch (e.type) {
    case "submit":
      if (busy(s) || s.phase === "no-agent" || !e.q.trim()) return s;
      return { phase: "loading", turns: [...s.turns, { q: e.q.trim(), text: "", tools: [] }], conversation: s.conversation };
    case "start":
      return busy(s) ? { ...s, conversation: e.conversation } : s;
    case "text":
      return busy(s) ? { ...s, phase: "streaming", turns: last(s, (t) => ({ ...t, text: t.text + e.text })) } : s;
    case "tool":
      return busy(s) ? { ...s, phase: "streaming", turns: last(s, (t) => ({ ...t, tools: [...t.tools, e.name] })) } : s;
    case "done":
      if (!busy(s)) return s;
      return { phase: "done", turns: last(s, (t) => ({ ...t, text: e.text, segments: e.segments })), conversation: e.conversation ?? s.conversation };
    case "error": {
      if (!busy(s)) return s;
      // a first question that failed leaves no conversation on the server to follow up on
      const lost = s.turns.length === 1 || e.code === "UNKNOWN_CONVERSATION";
      return { phase: "error", turns: s.turns, conversation: lost ? undefined : s.conversation, error: { code: e.code, message: e.message } };
    }
    case "stop":
      return busy(s) ? { phase: "stopped", turns: s.turns, conversation: s.conversation } : s;
    case "retry":
      return s.phase === "error" ? { phase: "idle", turns: s.turns.slice(0, -1), conversation: s.conversation } : s;
    case "reset":
      return initial();
    case "unavailable":
      return { phase: "no-agent", turns: [], error: { code: e.code, message: e.message } };
  }
}
