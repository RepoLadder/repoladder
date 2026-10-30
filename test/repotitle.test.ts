import { test } from "node:test";
import assert from "node:assert/strict";
import { repoTitleHtml } from "../src/viewer/repotitle.ts";

test("off the overview the repo name is a button back to home", () => {
  assert.equal(repoTitleHtml("acme", false, "root"), '<button data-go="root" title="Back to the overview">acme</button>');
  assert.match(repoTitleHtml("acme", false, "story"), /data-go="story"/);
});

test("on the overview it is plain text", () => {
  assert.equal(repoTitleHtml("acme", true, "root"), "acme");
});

test("hostile names are escaped in both forms", () => {
  const bad = `<img src=x onerror="a">`;
  for (const on of [true, false]) {
    const h = repoTitleHtml(bad, on, "root");
    assert.ok(!h.includes("<img"));
  }
});

test("renderRepoTitle targets home() and goes plain once there, story level or not", async () => {
  const { st, home } = await import("../src/viewer/state.ts");
  const { renderRepoTitle } = await import("../src/viewer/repotitle.ts");
  const h = { innerHTML: "" };
  (globalThis as any).document = { querySelector: () => h };
  for (const story of [undefined, { actors: {} }]) {
    st.data = { repo: "acme", story } as any;
    st.cur = "somewhere";
    renderRepoTitle();
    assert.ok(h.innerHTML.includes(`data-go="${home()}"`), h.innerHTML);
    st.cur = home();
    renderRepoTitle();
    assert.equal(h.innerHTML, "acme");
  }
  delete (globalThis as any).document;
});
