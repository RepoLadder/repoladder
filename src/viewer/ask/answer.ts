// Turns an Ask answer into DOM without ever parsing markup: `answerPlan` (pure) lists the pieces, `renderPlan` builds them with
// createElement and textContent only. Verification happens on the server (src/serve/facts.ts); only its verdicts are drawn here.
import { candidates, NOT_FOUND, type Segment, type Target } from "../../model/cite.ts";

export type PlanItem = { tag: "span" | "button" | "p" | "br"; text?: string; cls: string; ref?: Target; title?: string };
export type PlanInput = { mode: "streaming"; text: string } | { mode: "settled"; segments: Segment[] | null; text?: string };

const NOTE = "Citations could not be checked: no code facts are loaded.";

export function answerPlan(input: PlanInput): PlanItem[] {
  if (input.mode === "streaming") {
    const out: PlanItem[] = [];
    let at = 0;
    for (const c of candidates(input.text)) {
      if (c.start > at) out.push({ tag: "span", text: input.text.slice(at, c.start), cls: "" });
      out.push({ tag: "span", text: c.text, cls: "cite cite-wait", title: "checking against the code" });
      at = c.end;
    }
    if (at < input.text.length) out.push({ tag: "span", text: input.text.slice(at), cls: "" });
    return out;
  }
  if (!input.segments) return [{ tag: "span", text: input.text ?? "", cls: "" }, { tag: "p", text: NOTE, cls: "cite-note" }];
  return input.segments.map((s): PlanItem => {
    if ("text" in s) return { tag: "span", text: s.text, cls: "" };
    if (s.verified && s.target) return { tag: "button", text: s.ref, cls: "cite cite-ok", ref: s.target, title: "open in the map" };
    return { tag: "span", text: `${s.ref} (${s.reason ?? NOT_FOUND})`, cls: "cite cite-no" };
  });
}

export function renderPlan(doc: Document, plan: PlanItem[], onOpen: (ref: Target) => void): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const it of plan) {
    const el = doc.createElement(it.tag);
    if (it.cls) el.className = it.cls;
    if (it.title) el.title = it.title;
    if (it.text !== undefined) el.textContent = it.text;
    if (it.tag === "button") {
      (el as HTMLButtonElement).type = "button";
      const ref = it.ref;
      if (ref) el.addEventListener("click", () => onOpen(ref));
    }
    frag.appendChild(el);
  }
  return frag;
}
