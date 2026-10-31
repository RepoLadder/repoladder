// Facts and a grouping to the model, layout and page: the steps of `build`, shared by cli.ts and lib.ts.
// No process, console or disk access here: messages go through `log`, progress through `onProgress`, failures are thrown as BuildError.
import { assign, defaultGrouping } from "../model/grouping.ts";
import { resolveTours } from "../model/tours.ts";
import { resolveFlows } from "../model/flows.ts";
import { deriveTours } from "../model/derivedtours.ts";
import { buildModel, type Model } from "../model/rollup.ts";
import type { Facts, Grouping } from "../model/schema.ts";
import { addSnippets } from "../model/snippets.ts";
import { simpleTree, SPLIT_OVER, unsplitLeaves } from "../model/splits.ts";
import { withAutoSplits } from "../model/autosplits.ts";
import { DEFAULT_FEATURES, type Features } from "../features.ts";
import { simpleStop } from "../model/simple.ts";
import { renderHtml } from "./html.ts";
import { layoutPasses, type Passes } from "./passes.ts";
import { stepSync, type OnProgress } from "./progress.ts";
import { timedSync } from "./timings.ts";
import { DEFAULT_PROFILE, type Profile } from "../model/profile.ts";

/** A clean failure: `message` is what the CLI prints on stderr; `code` is what a usage ping reports; `status` the CLI's exit code. */
export class BuildError extends Error {
  code: string; status: number;
  constructor(code: string, status: number, message: string) { super(message); this.name = "BuildError"; this.code = code; this.status = status; }
}

export interface ModelOpts { read: (file: string) => string | null; usingDefault: boolean; warn: boolean; log: (line: string) => void; profile?: Profile }

/** The model for a grouping, with snippets, tours and flows; throws BuildError on an invalid grouping. */
export function modelOf(facts: Facts, grouping: Grouping, o: ModelOpts): Model {
  const a = assign(grouping, facts);
  if (o.warn) for (const w of a.warnings) o.log(`warning: ${w}`);
  if (a.errors.length) throw new BuildError("INVALID_GROUPING", 2, `INVALID grouping\n${a.errors.join("\n")}`);
  const model = buildModel(facts, grouping, a.leafOf, o.profile);
  addSnippets(model, o.read);
  const tours = resolveTours(grouping, model);
  if (tours.errors.length) throw new BuildError("INVALID_TOURS", 2, `INVALID tours\n${tours.errors.join("\n")}`);
  if (o.warn) for (const w of tours.warnings) o.log(`warning: ${w}`);
  if (tours.tours.length) model.tours = tours.tours;
  const flows = resolveFlows(grouping, model, facts);
  if (flows.errors.length) throw new BuildError("INVALID_FLOWS", 2, `INVALID flows\n${flows.errors.join("\n")}`);
  if (Object.keys(flows.flows).length) model.flows = flows.flows;
  // tours from the file graph, entry to sink, so `--default` gets tours too (derivedtours.ts)
  const derived = deriveTours(model, facts, model.tours);
  if (derived.length) model.derivedTours = derived;
  // the detail dial's Less stop: Claude's named splits, never made up (splits.ts); with no Claude
  // (`--default`), one more round of the default grouping's own splitting (autosplits.ts)
  const simple = simpleTree(o.usingDefault ? withAutoSplits(grouping, facts, o.profile) : grouping, facts, a.leafOf);
  if (simple) model.simple = simpleStop(facts, model, simple);
  if (o.warn) for (const d of simple?.dropped ?? []) o.log(`warning: split of "${d.id}" is not drawn: ${d.why}`);
  if (o.warn && !o.usingDefault) {
    const todo = unsplitLeaves(grouping, a.leafOf);
    const added = Object.keys(model.simple?.nodes ?? {}).filter((id) => !model.nodes[id]).length;
    const kept = simple ? `${simple.kept.length} split${simple.kept.length === 1 ? "" : "s"} add ${added} boards` : "no splits, so no Less stop on the dial";
    o.log(`SIMPLE ${kept}${todo.length ? `; ${todo.length} leaves over ${SPLIT_OVER} files have no split: ${todo.map((l) => `${l.id} (${l.files})`).join(", ")}` : ""}`);
  }
  return model;
}

export interface DiagramOpts {
  facts: Facts;
  /** null: the default (folder) grouping, with the mechanical splits of `build --default` */
  grouping: Grouping | null;
  /** The default grouping already computed for exactly these facts; used only when `grouping` is null. */
  defaultGrouping?: Grouping;
  read: (file: string) => string | null;
  lane?: boolean; // default true
  cacheDir?: string; // the CLI's out dir; the library passes none
  log?: (line: string) => void; // default: drop the lines
  onProgress?: OnProgress; // default: no progress events
  profile?: Profile; // the fidelity profile (model/profile.ts); default: full
  features?: Features; // the launch switches (features.ts); default: launch state
}

/** The grouping without its story (the same object when it has none). */
export function withoutStory(g: Grouping): Grouping {
  if (!g.story) return g;
  const { story: _story, ...rest } = g;
  return rest as Grouping;
}

export async function buildDiagram(o: DiagramOpts): Promise<Passes & { html: string }> {
  const usingDefault = o.grouping === null;
  const features = o.features ?? DEFAULT_FEATURES;
  const profile = o.profile ?? DEFAULT_PROFILE;
  const chosen = o.grouping ?? stepSync(o.onProgress, { stage: "grouping" }, () => timedSync("grouping", () => o.defaultGrouping ?? defaultGrouping(o.facts, profile)));
  const log = o.log ?? (() => {});
  // The story switch (features.ts): off drops the story before any validation, model or layout step.
  const grouping = features.story ? chosen : withoutStory(chosen);
  if (!features.story && chosen.story) log("story is off for this build, so the grouping's story is ignored (REPOLADDER_STORY=1 or --story turns it on)");
  const passes = await layoutPasses({
    facts: o.facts, grouping, splitting: usingDefault, profile,
    modelOf: (g, first) => modelOf(o.facts, g, { read: o.read, usingDefault, warn: first, log, profile }),
    cacheDir: o.cacheDir, lane: o.lane ?? true, onProgress: o.onProgress,
  });
  const html = stepSync(o.onProgress, { stage: "render" }, () => timedSync("render", () => renderHtml(passes.model, passes.layout, o.features)));
  return { ...passes, html };
}
