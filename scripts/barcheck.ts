// Usage: npm run barcheck
// Checks the floating top bar (src/viewer/topactions.ts, barmenu.ts, search.ts) in Playwright Chromium: builds
// test/fixtures/tourapp offline; at 1280x800, 390x844 and embedded it asserts `/` and Cmd/Ctrl+K open search and Escape
// returns focus to the trigger, the Tab order (brand, Search, Tours, Filters, Export), that Enter opens each menu, that
// arrows move inside it and Escape closes it and refocuses the button, that a tour row plays the tour, that at phone
// width every bar button has a name and its label is hidden, and that embedded Export sits in the toolbar.
// Prints BARCHECK_OK <n> or BARCHECK_FAILED <why> (exit 1).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let n = 0;
const fails: string[] = [];
const check = (ok: boolean, why: string) => { n++; if (!ok) fails.push(why); };

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const tmp = mkdtempSync(join(tmpdir(), "barcheck-"));
  execFileSync("node", [join(root, "src", "cli.ts"), "build", join(root, "test", "fixtures", "tourapp"), "--default", "--out", tmp], { stdio: "inherit" });
  const url = pathToFileURL(join(tmp, "diagram.html")).href;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    for (const m of [{ n: "wide", w: 1280, h: 800, q: "" }, { n: "phone", w: 390, h: 844, q: "" }, { n: "embed", w: 1280, h: 800, q: "?embed=1" }]) {
      const ctx = await browser.newContext({ viewport: { width: m.w, height: m.h }, reducedMotion: "reduce" });
      const p = await ctx.newPage();
      await p.goto(url + m.q);
      await p.waitForFunction(() => (window as any).__repoladder, null, { timeout: 5000 });
      await p.waitForTimeout(400);
      const active = () => p.evaluate(() => { const e = document.activeElement as HTMLElement | null; return e ? (e.id || e.className || e.tagName) : ""; });
      const searchOpen = () => p.evaluate(() => !document.querySelector<HTMLElement>(".search")!.hidden);
      // (a) search keys
      await p.locator("body").click({ position: { x: 5, y: m.h - 5 } });
      await p.keyboard.press("/");
      check(await searchOpen() && (await p.evaluate(() => document.activeElement?.tagName)) === "INPUT", `${m.n}: / opens search with the input focused`);
      await p.keyboard.press("Escape");
      check(!(await searchOpen()) && (await active()).includes("sbtn"), `${m.n}: Escape closes search and refocuses the trigger`);
      await p.keyboard.press("Control+k");
      check(await searchOpen(), `${m.n}: Ctrl+K opens search`);
      await p.keyboard.press("Escape");
      // (c) names and labels
      const bar = await p.evaluate(() => [...document.querySelectorAll<HTMLElement>(".sbtn, .tbact")].filter((b) => b.offsetParent).map((b) => {
        const lbl = b.querySelector<HTMLElement>(".lbl");
        return { id: b.id || "sbtn", name: b.getAttribute("aria-label") || b.title || lbl?.textContent || "", lblShown: !!lbl && lbl.offsetParent !== null, iconShown: !!b.querySelector("svg") };
      }));
      check(bar.every((b) => b.name && b.iconShown), `${m.n}: every bar button has a name and an icon`);
      if (m.n === "phone") check(bar.every((b) => !b.lblShown), "phone: label text is hidden");
      if (m.n === "wide") check(bar.every((b) => b.lblShown), "wide: label text is shown");
      if (m.n === "embed") {
        check(await p.evaluate(() => !!document.querySelector(".tbar #zexp")), "embed: Export is inside the toolbar");
        await p.locator("#zexp").focus();
        await p.keyboard.press("Enter");
        check(await p.locator(".xmenu").count() === 1, "embed: Export opens by keyboard");
        await p.keyboard.press("Escape");
        await ctx.close();
        continue;
      }
      // (b) tab order
      await p.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await p.evaluate(() => { document.querySelector<HTMLElement>(".brand")!.focus(); });
      const seen: string[] = [await active()];
      for (let i = 0; i < 12 && !seen.includes("zexp"); i++) {
        await p.keyboard.press("Tab");
        seen.push(await active());
      }
      const order = seen.map((s) => (s.includes("brand") ? "brand" : s.includes("sbtn") ? "search" : s)).filter((s) => ["brand", "search", "tbtours", "tbfilters", "zexp"].includes(s));
      check(order.join() === "brand,search,tbtours,tbfilters,zexp", `${m.n}: tab order is brand, search, tours, filters, export (got ${order.join()})`);
      // menus
      for (const id of ["tbtours", "tbfilters"]) {
        await p.locator(`#${id}`).focus();
        await p.keyboard.press("Enter");
        check(await p.locator(".bmenu").count() === 1 && (await p.getAttribute(`#${id}`, "aria-expanded")) === "true", `${m.n}: Enter opens ${id}`);
        const count = await p.locator(".bmenu button").count();
        if (count > 1) {
          const a = await p.evaluate(() => document.activeElement?.textContent);
          await p.keyboard.press("ArrowDown");
          check((await p.evaluate(() => document.activeElement?.textContent)) !== a, `${m.n}: ArrowDown moves inside ${id}`);
          await p.keyboard.press("ArrowUp");
          check((await p.evaluate(() => document.activeElement?.textContent)) === a, `${m.n}: ArrowUp moves back inside ${id}`);
        }
        await p.keyboard.press("Escape");
        check(await p.locator(".bmenu").count() === 0 && (await active()) === id, `${m.n}: Escape closes ${id} and refocuses it`);
      }
      await p.locator("#zexp").focus();
      await p.keyboard.press("Enter");
      check(await p.locator(".xmenu button").count() === 3, `${m.n}: Enter opens Export`);
      await p.keyboard.press("Escape");
      // the Tours menu lists what the panel's Tours box lists
      await p.locator("#tbtours").focus();
      await p.keyboard.press("Enter");
      const menuRows = await p.evaluate(() => [...document.querySelectorAll(".bmenu [data-tour]")].map((e) => (e as HTMLElement).dataset.tour).join());
      const panelRows = await p.evaluate(() => [...document.querySelectorAll("#details .walk-panel [data-tour]")].map((e) => (e as HTMLElement).dataset.tour).join());
      check(!!menuRows && menuRows === panelRows, `${m.n}: the Tours menu matches the panel's Tours box`);
      await p.keyboard.press("Escape");
      // a tour row plays the tour
      await p.locator("#tbtours").focus();
      await p.keyboard.press("Enter");
      await p.keyboard.press("Enter");
      await p.waitForTimeout(500);
      check(await p.locator(".walk-card").count() > 0, `${m.n}: Enter on a tour row plays the tour`);
      check(await p.locator(".bmenu").count() === 0, `${m.n}: choosing a tour closes the menu`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  if (fails.length) { for (const f of fails) console.log(`BARCHECK_FAILED ${f}`); process.exit(1); }
  console.log(`BARCHECK_OK ${n}`);
}
main().catch((e) => { console.log(`BARCHECK_FAILED ${e instanceof Error ? e.message : e}`); process.exit(1); });
