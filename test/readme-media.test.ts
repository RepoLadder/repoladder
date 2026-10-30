import { test } from "node:test";
import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import { BACK_MS, INTRO_MS, OUTRO_MS, TOUR_END_MS, clipPath, ffconcat, findForbidden, motionFps, parseArgs, trimFrames, type Frame } from "../scripts/readme-media.ts";

test("parseArgs defaults to the dark two-tour recording", () => {
  const d = parseArgs([]);
  assert.equal(d.theme, "dark");
  assert.deepEqual(d.tours, ["map-a-repo", "lay-out-a-board"]);
  assert.equal(d.width, 1280);
  assert.equal(d.height, 800);
  assert.equal(d.gifWidth, 960);
  assert.equal(d.fps, 15);
  assert.equal(d.step, 4200);
  assert.equal(d.poster, "");
  assert.equal(d.posterStep, 1);
  assert.equal(d.frames, "");
  assert.equal(d.video, "");
  assert.deepEqual(d.forbid, []);
  assert.equal(d.list, false);
  assert.equal(d.allTours, false);
  assert.equal(d.format, "gif");
  assert.equal(d.maxSeconds, 0);
  assert.ok(d.outDir.endsWith(".gallery/media"));
  assert.ok(d.out.endsWith("docs/media/tour.gif"));
});

test("parseArgs takes gif or webm", () => {
  const w = parseArgs(["--format", "webm"]);
  assert.equal(w.format, "webm");
  assert.ok(w.out.endsWith("docs/media/tour.webm"));
  assert.throws(() => parseArgs(["--format", "mp4"]), /--format must be gif or webm/);
});

test("parseArgs checks --max-seconds", () => {
  assert.equal(parseArgs(["--max-seconds", "12"]).maxSeconds, 12);
  assert.equal(parseArgs(["--max-seconds", "7.5"]).maxSeconds, 7.5);
  for (const v of ["0", "-3", "abc", "1e3"]) assert.throws(() => parseArgs(["--max-seconds", v]), /--max-seconds must be a positive number/, v);
});

test("parseArgs rejects clashing flags", () => {
  const bad: [string[], RegExp][] = [
    [["--all-tours", "--tours", "a"], /--all-tours and --tours can't be combined/],
    [["--all-tours", "--out", "x.gif"], /--all-tours writes to --out-dir, not --out/],
    [["--all-tours", "--poster", "p.png"], /--poster and --frames need a single recording/],
    [["--all-tours", "--frames", "f"], /--poster and --frames need a single recording/],
    [["--out-dir", "d"], /--out-dir needs --all-tours/],
  ];
  for (const [a, re] of bad) assert.throws(() => parseArgs(a), re, a.join(" "));
  const ok = parseArgs(["--all-tours", "--out-dir", "o"]);
  assert.ok(ok.allTours && ok.outDir.endsWith("/o"));
});

test("clipPath names a clip from repo and tour", () => {
  assert.equal(clipPath("/o", "code/wehb", "map a repo", "gif"), "/o/code-wehb-map-a-repo.gif");
  assert.equal(clipPath("/o", "r", "///", "webm"), "/o/r-x.webm");
});

test("trimFrames caps a recording", () => {
  const f = (t: number, c: string): Frame => ({ t, png: Buffer.from(c) });
  const frames = [f(0, "a"), f(1000, "b"), f(2000, "c"), f(3000, "d")];
  assert.equal(trimFrames(frames, 0), frames);
  const cut = trimFrames(frames, 2000);
  assert.deepEqual(cut.map((x) => x.t), [0, 1000, 2000]);
  assert.equal(cut.at(-1)!.png.toString(), "b");
  assert.deepEqual(trimFrames(frames, 500).map((x) => x.t), [0, 500]);
  assert.deepEqual(trimFrames(frames, 3000).map((x) => x.t), [0, 1000, 2000, 3000]);
  assert.deepEqual(trimFrames(frames, 9000), frames);
  assert.deepEqual(trimFrames([f(5000, "z")], 1000).map((x) => x.t), [5000, 1000]);
});

test("parseArgs takes either theme and rejects others", () => {
  assert.equal(parseArgs(["--theme", "dark"]).theme, "dark");
  assert.equal(parseArgs(["--theme", "light"]).theme, "light");
  assert.throws(() => parseArgs(["--theme", "blue"]), /--theme must be light or dark/);
});

test("parseArgs resolves the poster path and step", () => {
  const a = parseArgs(["--poster", "x/p.png", "--poster-step", "2"]);
  assert.ok(isAbsolute(a.poster));
  assert.ok(a.poster.endsWith("x/p.png"));
  assert.equal(a.posterStep, 2);
});

test("parseArgs rejects a bad poster step", () => {
  for (const v of ["0", "abc", "-1", "1.5"]) assert.throws(() => parseArgs(["--poster-step", v]), /positive integer/, v);
});

test("parseArgs takes --forbid words and a --video dir", () => {
  assert.deepEqual(parseArgs(["--forbid", "acme,foo"]).forbid, ["acme", "foo"]);
  const v = parseArgs(["--video", "x/v"]).video;
  assert.ok(isAbsolute(v));
  assert.ok(v.endsWith("x/v"));
});

test("the pauses are pinned", () => {
  assert.deepEqual([INTRO_MS, BACK_MS, TOUR_END_MS, OUTRO_MS], [2000, 1400, 1200, 800]);
});

test("findForbidden returns the matching lines, case-insensitively and de-duplicated", () => {
  assert.deepEqual(findForbidden("Made with Acme · Feedback\nOK\n  Acme turns\nOK\nAcme turns", ["acme"]), ["Made with Acme · Feedback", "Acme turns"]);
  assert.deepEqual(findForbidden("RepoLadder", ["acme"]), []);
});

test("ffconcat lists each frame with how long it shows and holds the last one", () => {
  assert.equal(ffconcat([0, 16, 33, 1033]), [
    "ffconcat version 1.0", "file '00000.png'", "duration 0.0160", "file '00001.png'", "duration 0.0170", "file '00002.png'", "duration 1.0000", "file '00003.png'", "file '00003.png'", "",
  ].join("\n"));
  const dup = ffconcat([0, 0.5, 10]);
  assert.ok(!dup.includes("00000.png"), "a frame replaced within 1 ms is dropped");
  assert.ok(!dup.includes("duration 0.0000"));
});

test("motionFps reads the gaps while the page moves", () => {
  assert.equal(motionFps([0, 16, 33, 50, 2050]), 58.8);
  assert.equal(motionFps([0, 5000]), 0);
});
