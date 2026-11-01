// Entry of the served-only Ask bundle (global `repoladderAsk`), appended to the page by `repoladder serve`. It is never imported by
// the viewer, so published and exported pages hold none of it. Fails closed: with no token or a failed probe it draws nothing.
import { probe, readToken } from "./api.ts";
import { mount } from "./view.ts";

type Host = { locate: (ref: { file: string; line?: number } | { box: string }) => boolean };
const hostOf = () => (window as unknown as { __repoladder?: Host }).__repoladder;

async function begin(): Promise<void> {
  const token = readToken(location.search);
  const canvas = document.getElementById("canvas");
  const host = hostOf();
  if (!token || !canvas || !host) return;
  const f: typeof fetch = (i, o) => fetch(i, o);
  const status = await probe(f, token);
  if (!status) return;
  mount({ canvas, token, status, fetch: f, locate: host.locate });
}

/** The viewer starts first when it can; otherwise wait for its ready event. */
export function start(): void {
  if (hostOf()) void begin();
  else window.addEventListener("repoladder:ready", () => void begin(), { once: true });
}
