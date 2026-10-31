# repoladder

Architecture diagrams grounded in your code that stay in sync.

## Command line

```
npx repoladder build . --default     # writes .repoladder/diagram.html; open it in a browser
npx repoladder export . [--board id] [--format svg|png] [--theme light|dark]
```

Needs Node.js 20.6 or newer. The first run downloads about 25MB (the D2 layout engine's wasm plus TypeScript). The first `build` from an interactive terminal asks once about anonymous usage stats (default no; never in CI or piped runs): [PRIVACY.md](https://github.com/repoladder/repoladder/blob/main/PRIVACY.md). For AI grouping, use the [Claude Code plugin](https://github.com/repoladder/repoladder). [repoladder.com](https://repoladder.com)

## Library

```js
import { buildFromFiles, analyzeFiles, VERSION } from "repoladder";
const result = await buildFromFiles({ "src/index.ts": "export const a = 1;\n" });
// result.html is a self-contained page; result.engineVersion === VERSION

// facts only: the extracted structure, no layout or HTML; same limits and error codes
const analysis = analyzeFiles(files); // analysis.facts

// optional progress events (raw, unthrottled; errors thrown by the callback are ignored)
await buildFromFiles(files, { onProgress: (e) => console.log(e.stage, e.kind, e.done, e.total) });
```

Needs Node.js 20.6 or newer; ESM only. Every page it builds carries
`<meta name="generator" content="repoladder@<version>">`. Pin an exact version when the output must be
reproducible.
