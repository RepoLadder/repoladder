// Usage: npm run shots:phone [-- --only name,name] [-- --scheme light|dark|both] [-- --device iphone-15|iphone-se|all] [-- --hash <fragment>] [-- --settle <ms>] [-- --out <dir>] [-- --shutdown] [-- --export] [-- --embed]
// Mobile Safari check (the `phone` test tier): serves the built launch demos to the dedicated
// "repoladder Phone *" iOS 17.5 simulators and screenshots each one. It touches no other simulator.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pngSize } from "./pngsize.ts";

export const PREFIX = "repoladder Phone ";
export const RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-17-5";
export const VIEWPORT = '<meta name="viewport" content="width=device-width,initial-scale=1">';
export const DEVICES = [
  { id: "iphone-15", name: "repoladder Phone iPhone 15", type: "com.apple.CoreSimulator.SimDeviceType.iPhone-15" },
  { id: "iphone-se", name: "repoladder Phone iPhone SE", type: "com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation" },
] as const;
type Device = (typeof DEVICES)[number];

// Polls for the viewer hook, waits for the embedded fonts, lets two frames paint, then tells the server the page is ready.
// With `export=1` in the page URL (--export) it then runs the viewer's own PNG export and posts the bytes back.
export const READY_SCRIPT = `<script>(function(){var t=Date.now();(function p(){if(!window.__repoladder&&Date.now()-t<15000)return setTimeout(p,100);(document.fonts&&document.fonts.ready||Promise.resolve()).then(function(){requestAnimationFrame(function(){requestAnimationFrame(function(){var q=location.search;new Image().src="/__ready"+q+(q?"&":"?")+"hooked="+(window.__repoladder?1:0);if(/[?&]export=1/.test(q)){var w=window.__repoladder;Promise.resolve().then(function(){return w.exportView("png")}).then(function(b){return fetch("/__export"+q,{method:"POST",body:b})}).catch(function(e){fetch("/__export"+q+"&err="+encodeURIComponent(e&&e.message||String(e)),{method:"POST"})});}});});});})();})();</script>`;

export function wrapHtml(html: string): string {
  const head = html.includes('name="viewport"') ? "" : VIEWPORT + "\n";
  return head + html + "\n" + READY_SCRIPT;
}

export type Args = { only?: string[]; schemes: ("light" | "dark")[]; devices: Device[]; hash?: string; settleMs: number; out?: string; shutdown: boolean; export: boolean; embed: boolean };

export function parseArgs(argv: string[]): Args {
  const a: Args = { schemes: ["light", "dark"], devices: [...DEVICES], settleMs: 2000, shutdown: false, export: false, embed: false };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${f} needs a value`); return v; };
    if (f === "--only") a.only = val().split(",").filter(Boolean);
    else if (f === "--scheme") {
      const v = val();
      if (v === "both") a.schemes = ["light", "dark"];
      else if (v === "light" || v === "dark") a.schemes = [v];
      else throw new Error(`bad --scheme "${v}" (light, dark or both)`);
    } else if (f === "--device") {
      const v = val();
      if (v === "all") a.devices = [...DEVICES];
      else {
        const d = DEVICES.find((x) => x.id === v);
        if (!d) throw new Error(`bad --device "${v}" (iphone-15, iphone-se or all)`);
        a.devices = [d];
      }
    } else if (f === "--embed") a.embed = true;
    else if (f === "--hash") a.hash = val().replace(/^#/, "");
    else if (f === "--settle") {
      const v = val();
      const n = Number(v);
      if (v.trim() === "" || !Number.isFinite(n) || n < 0) throw new Error(`bad --settle "${v}" (milliseconds, 0 or more)`);
      a.settleMs = n;
    } else if (f === "--out") a.out = val();
    else if (f === "--shutdown") a.shutdown = true;
    else if (f === "--export") a.export = true;
    else throw new Error(`unknown flag "${f}"`);
  }
  return a;
}

type SimList = { devices?: Record<string, { name: string; udid: string; state: string; isAvailable?: boolean }[]> };
export function findDevice(listJson: unknown, name: string, runtime = RUNTIME): { udid: string; state: string } | undefined {
  const d = (listJson as SimList)?.devices?.[runtime] ?? [];
  const hit = d.find((x) => x.name === name && x.isAvailable !== false);
  return hit && { udid: hit.udid, state: hit.state };
}

export function runtimeAvailable(listJson: unknown, runtime = RUNTIME): boolean {
  const r = (listJson as { runtimes?: { identifier: string; isAvailable?: boolean }[] })?.runtimes ?? [];
  return r.some((x) => x.identifier === runtime && x.isAvailable !== false);
}

export function shotPath(out: string, deviceId: string, demo: string, scheme: string): string {
  return join(out, deviceId, `${demo}-${scheme}.png`);
}

/** Where the viewer's exported PNG for a shot goes: beside it, `-export.png` for `.png`. */
export const exportPath = (out: string, deviceId: string, demo: string, scheme: string): string => shotPath(out, deviceId, demo, scheme).replace(/\.png$/, "-export.png");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const simctl = (...args: string[]) => execFileSync("xcrun", ["simctl", ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
const simJson = (what: "devices" | "runtimes") => JSON.parse(simctl("list", what, "-j"));

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = parseArgs(process.argv.slice(2));
  if (process.platform !== "darwin") throw new Error("the phone tier needs macOS (iOS Simulator)");
  const work = join(root, ".gallery", "demos");
  const resultsFile = join(work, "results.json");
  if (!existsSync(resultsFile)) throw new Error("no demo gallery yet: run `npm run gallery -- --demos --jobs 1` first");
  const results: { name: string; status: string }[] = JSON.parse(readFileSync(resultsFile, "utf8"));
  const demos = results.filter((r) => r.status === "ok" && (!args.only || args.only.includes(r.name)) && existsSync(join(work, "out", r.name, "diagram.html"))).map((r) => r.name);
  if (args.only) for (const n of args.only) if (!demos.includes(n)) throw new Error(`no built demo diagram for "${n}"`);
  if (!demos.length) throw new Error("no demo gallery yet: run `npm run gallery -- --demos --jobs 1` first (no built demos)");
  if (!runtimeAvailable(simJson("runtimes"))) throw new Error("iOS 17.5 simulator runtime not installed (Xcode > Settings > Components); not falling back to another runtime");

  const out = resolve(args.out ?? join(work, "phone"));
  rmSync(join(out, "pages"), { recursive: true, force: true });
  mkdirSync(join(out, "pages"), { recursive: true });
  const pages = new Map<string, string>();
  for (const d of demos) {
    const html = wrapHtml(readFileSync(join(work, "out", d, "diagram.html"), "utf8"));
    writeFileSync(join(out, "pages", `${d}.html`), html);
    pages.set(`/${d}.html`, html);
  }

  const ready = new Map<string, boolean>();
  const exported = new Map<string, { bytes?: Buffer; err?: string }>();
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname === "/__export" && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const r = u.searchParams.get("r");
        if (r) exported.set(r, u.searchParams.has("err") ? { err: u.searchParams.get("err")! } : { bytes: Buffer.concat(chunks) });
        res.writeHead(204).end();
      });
    } else if (u.pathname === "/__ready") {
      const r = u.searchParams.get("r");
      if (r) ready.set(r, u.searchParams.get("hooked") === "1");
      res.writeHead(204).end();
    } else if (req.method === "GET" && pages.has(u.pathname)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(pages.get(u.pathname));
    } else res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  process.stdout.write(`SERVING http://127.0.0.1:${port}/\n`);

  const t0 = performance.now();
  let total = 0, failed = 0;
  const bootedByUs: { name: string; udid: string }[] = [];
  try {
    const udids = new Map<string, string>();
    for (const dev of args.devices) {
      if (!dev.name.startsWith(PREFIX)) throw new Error(`refusing to touch non-prefixed device ${dev.name}`);
      let found = findDevice(simJson("devices"), dev.name);
      if (!found) {
        const udid = simctl("create", dev.name, dev.type, RUNTIME).trim();
        process.stdout.write(`CREATED ${dev.name} ${udid}\n`);
        found = { udid, state: "Shutdown" };
      }
      if (found.state !== "Booted") {
        bootedByUs.push({ name: dev.name, udid: found.udid });
        try { simctl("boot", found.udid); } catch (e) { if (!/current state: Booted/i.test(String(e))) throw e; }
        process.stdout.write(`BOOTED ${dev.name} ${found.udid}\n`);
      }
      simctl("bootstatus", found.udid, "-b");
      simctl("status_bar", found.udid, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--wifiBars", "3", "--cellularBars", "4");
      udids.set(dev.id, found.udid);
    }

    for (const dev of args.devices) {
      const udid = udids.get(dev.id)!;
      for (const scheme of args.schemes) {
        simctl("ui", udid, "appearance", scheme);
        for (const demo of demos) {
          total++;
          // the first Safari launch after a boot can time out or load late; reopen once or twice before failing
          let token = "";
          let why = "";
          for (let attempt = 1; attempt <= 3; attempt++) {
            token = `${dev.id}-${scheme}-${demo}-${Date.now()}-${attempt}`;
            try {
              simctl("openurl", udid, `http://127.0.0.1:${port}/${demo}.html?r=${token}${args.export ? "&export=1" : ""}${args.embed ? "&embed=1" : ""}${args.hash ? `#${args.hash}` : ""}`);
            } catch { why = "simctl openurl failed"; await sleep(3000); continue; }
            const deadline = Date.now() + (attempt === 3 ? 30_000 : 15_000);
            while (!ready.has(token) && Date.now() < deadline) await sleep(250);
            if (ready.has(token)) { why = ""; break; }
            why = "page never reported ready";
          }
          if (why) {
            process.stdout.write(`PHONESHOT_FAILED ${demo} ${dev.id} ${scheme} ${why}\n`);
            failed++;
            continue;
          }
          if (!ready.get(token)) {
            process.stdout.write(`PHONESHOT_WARN ${demo} ${dev.id} ${scheme} viewer hook never appeared\n`);
            failed++;
          }
          await sleep(args.settleMs);
          const file = shotPath(out, dev.id, demo, scheme);
          mkdirSync(dirname(file), { recursive: true });
          simctl("io", udid, "screenshot", file);
          process.stdout.write(`PHONESHOT ${file}\n`);
          if (args.export) {
            const deadline = Date.now() + 15_000;
            while (!exported.has(token) && Date.now() < deadline) await sleep(250);
            const x = exported.get(token), size = x?.bytes && pngSize(x.bytes);
            if (x?.bytes && size) {
              const ef = exportPath(out, dev.id, demo, scheme);
              writeFileSync(ef, x.bytes);
              process.stdout.write(`PHONEEXPORT ${ef} ${size.w}x${size.h}\n`);
            } else {
              process.stdout.write(`PHONEEXPORT_FAILED ${demo} ${dev.id} ${scheme} ${x?.err ?? (x ? "not a PNG" : "no export arrived")}\n`);
              failed++;
            }
          }
        }
      }
    }
  } finally {
    server.close();
    if (args.shutdown) for (const b of bootedByUs) {
      if (!b.name.startsWith(PREFIX)) continue;
      try { simctl("shutdown", b.udid); } catch { /* already down */ }
    }
  }
  if (failed) {
    process.stdout.write(`PHONESHOTS_FAILED ${failed} of ${total} shots failed\n`);
    process.exitCode = 1;
  } else process.stdout.write(`PHONESHOTS_OK ${total} shots in ${((performance.now() - t0) / 1000).toFixed(0)}s\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (e) {
    process.stdout.write(`PHONESHOTS_FAILED ${(e as Error).message}\n`);
    process.exit(1);
  }
}
