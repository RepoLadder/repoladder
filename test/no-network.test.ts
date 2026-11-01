// The engine makes no network calls (#367): analyze, build and model only read the files they are given.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import type TS from "typescript";

const ts: typeof TS = createRequire(import.meta.url)("typescript");

// Scanned recursively. src/viewer is browser code shipped inside the output page, not the engine.
const ENGINE_DIRS = ["src/analyze", "src/build", "src/model"];
const NETWORK_MODULES = ["http", "https", "http2", "net", "tls", "dns", "dgram"];
// src/serve listens on loopback only (PRIVACY.md): it may import named entries of node:http, nothing else network-capable.
const SERVE_DIR = "src/serve";
const NETWORK_GLOBALS = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"];
// "<file>" -> why it may reach the network. These files are skipped entirely.
const ALLOW: Record<string, string> = {
  "src/usage.ts": "the opt-in usage ping (PRIVACY.md): sends nothing unless the user said yes, the URL is set and no opt-out env var is set",
  "src/cli.ts": "the CLI entry point; it calls sendPing() from src/usage.ts after a build, outside the engine",
};
const CHILD_PROCESS_OK: Record<string, string> = {
  "src/analyze/files.ts": "runs git locally (ls-files, rev-parse) to list the repo's files; no network",
  "src/serve/ask.ts": "spawns the user's own claude CLI headless (argv array, no shell) to answer a question under repoladder serve; see PRIVACY.md",
  "src/serve/open.ts": "spawns the platform's browser opener with an argv array and the local URL; no network code of its own",
  "src/install.ts": "runs npm install for the plugin's runtime deps on the explicit install command, outside the engine",
};
const DYNAMIC_IMPORT_OK: Record<string, string> = {
  "src/build/export.ts": "import(name) loads optional playwright to render local SVGs to PNG with page.setContent; it never navigates",
};
const NETWORK_CAPABLE = ["src/usage.ts", "src/cli.ts"];
// spawn with an argv array is the only way src/serve starts a process: a shell string is never built
const SHELL_EXEC = ["exec", "execSync", "execFile", "execFileSync"];
const SERVE_HTTP_NAMES = ["createServer", "STATUS_CODES"];

const bareName = (spec: string) => spec.replace(/^node:/, "");
const isNetworkModule = (spec: string) => {
  const b = bareName(spec);
  return NETWORK_MODULES.some((m) => b === m || b.startsWith(`${m}/`));
};
const isChildProcess = (spec: string) => bareName(spec) === "child_process";

export function scanSource(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const handled = new Set<TS.Node>();
  const inEngine = ENGINE_DIRS.some((d) => file.startsWith(`${d}/`));
  const inServe = file.startsWith(`${SERVE_DIR}/`);
  const report = (n: TS.Node, what: string) => out.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${what}`);

  // only `import { createServer, STATUS_CODES } from "node:http"`: named, from http itself
  const serveHttpOk = (n: TS.Node, spec: string) => {
    if (bareName(spec) !== "http" || !ts.isImportDeclaration(n)) return false;
    const b = n.importClause?.namedBindings;
    return !n.importClause?.name && !!b && ts.isNamedImports(b) && b.elements.every((e) => e.isTypeOnly || n.importClause!.isTypeOnly || SERVE_HTTP_NAMES.includes((e.propertyName ?? e.name).text));
  };
  const checkSpec = (n: TS.Node, lit: TS.Node, spec: string, verb: string) => {
    handled.add(lit);
    if (isNetworkModule(spec) && !(inServe && serveHttpOk(n, spec))) report(n, `${verb} ${spec}`);
    if (isChildProcess(spec) && !(file in CHILD_PROCESS_OK)) report(n, "uses child_process");
    if (spec.startsWith(".")) {
      const resolved = posix.normalize(posix.join(posix.dirname(file), spec));
      if (inEngine && NETWORK_CAPABLE.includes(resolved)) report(n, `imports ${resolved} (network-capable)`);
      if (!inServe && file !== "src/cli.ts" && resolved.startsWith(`${SERVE_DIR}/`)) report(n, `imports ${resolved} (network-capable)`);
    }
  };
  const isKey = (n: TS.Identifier) => {
    const p = n.parent;
    return (
      (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p)) &&
      p.name === n
    );
  };
  const isLoader = (e: TS.Expression) =>
    e.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(e) && e.text === "require") ||
    (ts.isPropertyAccessExpression(e) && e.name.text === "require") ||
    ts.isCallExpression(e);

  const walk = (n: TS.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) {
      checkSpec(n, n.moduleSpecifier, n.moduleSpecifier.text, "imports");
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteralLike(n.moduleReference.expression)) {
      checkSpec(n, n.moduleReference.expression, n.moduleReference.expression.text, "imports");
    } else if (ts.isCallExpression(n) && isLoader(n.expression)) {
      const arg = n.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) checkSpec(n, arg, arg.text, "loads");
      else if (n.expression.kind === ts.SyntaxKind.ImportKeyword && !(file in DYNAMIC_IMPORT_OK)) report(n, "dynamic import of a non-literal specifier");
    } else if (ts.isStringLiteralLike(n) && !handled.has(n)) {
      if (/^node:/.test(n.text) && isNetworkModule(n.text)) report(n, `mentions ${n.text}`);
    } else if (ts.isIdentifier(n) && NETWORK_GLOBALS.includes(n.text) && !isKey(n)) {
      report(n, `uses ${n.text}`);
    } else if (inServe && ts.isIdentifier(n) && SHELL_EXEC.includes(n.text) && !isKey(n)) {
      report(n, `uses ${n.text}`);
    } else if (inServe && ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && n.name.text === "shell" && n.initializer.kind !== ts.SyntaxKind.FalseKeyword) {
      report(n, "sets shell");
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

// the served in-page Ask client: the only viewer file that may call fetch (it exists once the Ask client has landed)
const VIEWER_NETWORK_OK = ["src/viewer/ask/api.ts"];
const VIEWER_DIR = "src/viewer";

const tsFiles = (root: string, dir: string): string[] =>
  existsSync(join(root, dir)) ? readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts")).map((f) => `${dir}/${f.replaceAll("\\", "/")}`) : [];

/** Every .ts file under src/ (the engine, src/serve, the viewer and the top-level modules). */
export function scanTree(root: string): string[] {
  const files = tsFiles(root, "src");
  return files
    .filter((f) => !(f in ALLOW) && !VIEWER_NETWORK_OK.includes(f))
    .sort()
    .flatMap((f) => scanSource(f, readFileSync(join(root, f), "utf8")));
}

/** The published page is browser code: no Node imports, no src/serve, and the top-level modules never import the Ask client. */
export function scanViewer(root: string): string[] {
  const out: string[] = [];
  for (const file of tsFiles(root, VIEWER_DIR).sort()) {
    const sf = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
    const topLevel = posix.dirname(file) === VIEWER_DIR;
    const check = (n: TS.Node, spec: string) => {
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      if (/^node:/.test(spec) || ["fs", "path", "os", "child_process", "http", "https", "net", "crypto"].includes(spec)) out.push(`${file}:${line}: imports ${spec}`);
      if (spec.startsWith(".")) {
        const resolved = posix.normalize(posix.join(posix.dirname(file), spec));
        if (resolved.startsWith("src/serve/")) out.push(`${file}:${line}: imports ${resolved}`);
        if (topLevel && resolved.startsWith(`${VIEWER_DIR}/ask/`)) out.push(`${file}:${line}: imports the Ask client ${resolved}`);
      }
    };
    const walk = (n: TS.Node) => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) check(n, n.moduleSpecifier.text);
      else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) check(n, n.arguments[0].text);
      ts.forEachChild(n, walk);
    };
    walk(sf);
  }
  return out;
}

test("the scanner catches network code and skips comments, strings and keys", () => {
  const root = mkdtempSync(join(tmpdir(), "cw-nonet-"));
  mkdirSync(join(root, "src/analyze"), { recursive: true });
  const bad: [string, string][] = [
    ['import http from "node:http";', "imports node:http"],
    ['import { connect } from "net";', "imports net"],
    ['export * from "node:dns/promises";', "imports node:dns/promises"],
    ['import dg from "dgram";', "imports dgram"],
    ['const t = await import("tls");', "loads tls"],
    ['const r = require("https");', "loads https"],
    ['const m = "node:http2"; await import(m);', "mentions node:http2"],
    ['const n = "node:net"; await import(n);', "dynamic import of a non-literal specifier"],
    ['fetch("https://x");', "uses fetch"],
    ['globalThis.fetch("x");', "uses fetch"],
    ['new WebSocket("ws://x");', "uses WebSocket"],
    ["new XMLHttpRequest();", "uses XMLHttpRequest"],
    ['navigator.sendBeacon("x");', "uses sendBeacon"],
    ['new EventSource("x");', "uses EventSource"],
    ['import { execFileSync } from "node:child_process";', "uses child_process"],
    ['import https from "https";', "imports https"],
    ['import h2 from "node:http2";', "imports node:http2"],
    ['import tls from "node:tls";', "imports node:tls"],
    ['import dns from "dns/promises";', "imports dns/promises"],
    ['export { x } from "net/foo";', "imports net/foo"],
    ['import nh from "node:http/sub";', "imports node:http/sub"],
    ['import ng from "node:net";', "imports node:net"],
    ['import d from "node:dgram";', "imports node:dgram"],
    ['import { sendPing } from "../usage.ts";', "imports src/usage.ts (network-capable)"],
    ['import { main } from "../cli.ts";', "imports src/cli.ts (network-capable)"],
  ];
  writeFileSync(join(root, "src/analyze/bad.ts"), bad.map(([l]) => l).join("\n") + "\n");
  const good = [
    '// fetch("x") and import("node:http") in a comment',
    "/* new WebSocket() */",
    'const kind = "http";',
    'const callee = "fetch";',
    "const re = /^(fetch|axios)$/;",
    "const o = { fetch: 1 }; type T = { fetch(): void };",
    'import { join } from "node:path";',
  ];
  writeFileSync(join(root, "src/analyze/good.ts"), good.join("\n") + "\n");
  writeFileSync(join(root, "src/usage.ts"), 'fetch("x");\n');

  const found = scanTree(root);
  assert.deepEqual(found.filter((f) => f.includes("good.ts") || f.includes("usage.ts:")), []);
  bad.forEach(([line, what], i) => {
    const hit = `src/analyze/bad.ts:${i + 1}: ${what}`;
    assert.ok(found.includes(hit), `not caught: ${line} (expected "${hit}")`);
  });
});

test("src/serve may listen on loopback via named node:http imports and nothing else", () => {
  const root = mkdtempSync(join(tmpdir(), "cw-nonet-serve-"));
  mkdirSync(join(root, "src/serve"), { recursive: true });
  mkdirSync(join(root, "src/analyze"), { recursive: true });
  mkdirSync(join(root, "src/build"), { recursive: true });
  const bad: [string, string][] = [
    ['import http from "node:http";', "imports node:http"],
    ['import * as http from "node:http";', "imports node:http"],
    ['import { request } from "node:http";', "imports node:http"],
    ['import { get } from "http";', "imports http"],
    ['import https from "node:https";', "imports node:https"],
    ['import net from "node:net";', "imports node:net"],
    ['import { spawn } from "node:child_process";', "uses child_process"],
    ['fetch("x");', "uses fetch"],
  ];
  writeFileSync(join(root, "src/serve/bad.ts"), bad.map(([l]) => l).join("\n") + "\n");
  writeFileSync(join(root, "src/serve/good.ts"), ['import { createServer, STATUS_CODES } from "node:http";', 'import { createServer as cs } from "http";', 'import { createServer as c2, type IncomingMessage } from "node:http";', 'import { join } from "node:path";'].join("\n") + "\n");
  writeFileSync(join(root, "src/serve/open.ts"), 'import { spawn } from "node:child_process";\n');
  writeFileSync(join(root, "src/analyze/imp.ts"), 'import { startServer } from "../serve/index.ts";\n');
  writeFileSync(join(root, "src/build/imp2.ts"), 'export { x } from "../serve/open.ts";\n');
  writeFileSync(join(root, "src/lib.ts"), 'import { startServer } from "./serve/index.ts";\n');
  writeFileSync(join(root, "src/cli.ts"), 'import { startServer } from "./serve/index.ts";\n');
  const found = scanTree(root);
  assert.deepEqual(found.filter((f) => f.includes("good.ts") || f.startsWith("src/serve/open.ts") || f.startsWith("src/cli.ts")), []);
  bad.forEach(([line, what], i) => {
    const hit = `src/serve/bad.ts:${i + 1}: ${what}`;
    assert.ok(found.includes(hit), `not caught: ${line} (expected "${hit}")`);
  });
  assert.ok(found.includes("src/analyze/imp.ts:1: imports src/serve/index.ts (network-capable)"));
  assert.ok(found.includes("src/build/imp2.ts:1: imports src/serve/open.ts (network-capable)"));
  assert.ok(found.includes("src/lib.ts:1: imports src/serve/index.ts (network-capable)"));
});

test("src/serve may spawn only with an argv array: exec* and a shell option are reported", () => {
  const root = mkdtempSync(join(tmpdir(), "cw-nonet-exec-"));
  mkdirSync(join(root, "src/serve"), { recursive: true });
  const bad: [string, string][] = [
    ['import { exec } from "node:fs";', "uses exec"],
    ["cp.execSync(cmd);", "uses execSync"],
    ["cp.execFile(a, b);", "uses execFile"],
    ["cp.execFileSync(a, b);", "uses execFileSync"],
    ["spawn(a, b, { shell: true });", "sets shell"],
    ['spawn(a, b, { "shell": process.platform === "win32" });', "sets shell"],
  ];
  writeFileSync(join(root, "src/serve/bad.ts"), bad.map(([l]) => l).join("\n") + "\n");
  writeFileSync(join(root, "src/serve/good.ts"), ["spawn(a, b, { shell: false, cwd: c });", "const o = { exec: 1 };"].join("\n") + "\n");
  const found = scanTree(root);
  assert.deepEqual(found.filter((f) => f.includes("good.ts")), []);
  bad.forEach(([line, what], i) => assert.ok(found.includes(`src/serve/bad.ts:${i + 1}: ${what}`), `not caught: ${line}`));
});

test("claude.ts and stage.ts stay free of child_process", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const f of ["src/serve/claude.ts", "src/serve/stage.ts"]) {
    assert.ok(!(f in CHILD_PROCESS_OK), f);
    assert.doesNotMatch(readFileSync(join(root, f), "utf8"), /child_process/, f);
  }
});

test("analyze, build and model make no network calls", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  assert.deepEqual(
    scanTree(root),
    [],
    "the engine must only read the files it is given (PRIVACY.md); network code belongs in src/usage.ts behind consent, and an exception needs an entry with its reason in this file's allowlists",
  );
});

test("the whole of src/ is scanned: only src/serve, src/usage.ts and src/cli.ts may import a network module, and only src/viewer/ask/api.ts may use a network global", () => {
  const root = mkdtempSync(join(tmpdir(), "cw-nonet-all-"));
  for (const d of ["src/viewer/ask", "src/other"]) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, "src/viewer/page.ts"), 'fetch("x");\n');
  writeFileSync(join(root, "src/viewer/ask/api.ts"), 'fetch("/api/ask");\n');
  writeFileSync(join(root, "src/viewer/ask/other.ts"), 'new WebSocket("x");\n');
  writeFileSync(join(root, "src/other/net.ts"), 'import net from "node:net";\nimport { x } from "../serve/index.ts";\n');
  const found = scanTree(root);
  assert.ok(found.includes("src/viewer/page.ts:1: uses fetch"));
  assert.ok(found.includes("src/viewer/ask/other.ts:1: uses WebSocket"));
  assert.ok(found.includes("src/other/net.ts:1: imports node:net"));
  assert.ok(found.includes("src/other/net.ts:2: imports src/serve/index.ts (network-capable)"));
  assert.ok(!found.some((f) => f.startsWith("src/viewer/ask/api.ts")));
});

test("viewer scan: no Node imports, no src/serve, and top-level modules never import the Ask client", () => {
  const root = mkdtempSync(join(tmpdir(), "cw-nonet-viewer-"));
  mkdirSync(join(root, "src/viewer/ask"), { recursive: true });
  writeFileSync(join(root, "src/viewer/bad.ts"), 'import { readFileSync } from "node:fs";\nimport { s } from "../serve/index.ts";\nimport { a } from "./ask/api.ts";\nexport { b } from "./ask/panel.ts";\nconst m = await import("./ask/lazy.ts");\n');
  writeFileSync(join(root, "src/viewer/good.ts"), 'import { x } from "./box.ts";\nimport type { T } from "../model/schema.ts";\n');
  writeFileSync(join(root, "src/viewer/ask/inner.ts"), 'import { a } from "./api.ts";\nimport { fs } from "fs";\n');
  const found = scanViewer(root);
  assert.deepEqual(found, [
    "src/viewer/ask/inner.ts:2: imports fs",
    "src/viewer/bad.ts:1: imports node:fs",
    "src/viewer/bad.ts:2: imports src/serve/index.ts",
    "src/viewer/bad.ts:3: imports the Ask client src/viewer/ask/api.ts",
    "src/viewer/bad.ts:4: imports the Ask client src/viewer/ask/panel.ts",
    "src/viewer/bad.ts:5: imports the Ask client src/viewer/ask/lazy.ts",
  ]);
});

test("the published viewer code follows its import boundaries", () => {
  assert.deepEqual(scanViewer(fileURLToPath(new URL("..", import.meta.url))), []);
});

test("every allowlist entry still exists", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const f of [...Object.keys(ALLOW), ...Object.keys(CHILD_PROCESS_OK), ...Object.keys(DYNAMIC_IMPORT_OK)]) {
    assert.ok(existsSync(join(root, f)), `stale allowlist entry: ${f}`);
  }
});
