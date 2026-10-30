// Inflates the page data build/filepack.ts packed. Plain objects pass through, so data
// written inline (tests, older pages) still works. Either way the data leaves with its one group
// tree, Simple's splits folded in as fine nodes (finetree.ts). Packed data needs basE91's
// `decode91`: in the page the boot script passes its own (boot.ts), so the viewer doesn't carry a copy.
import type { decode91 } from "./base91.ts";
import { treeOf } from "./finetree.ts";
import type { ViewerData } from "./state.ts";
import { decodeWire } from "./wire.ts";

/** The inflate pipeline for a packed string: the page data here, the fonts in exportsvg.ts. */
export const inflated = (s: string, decode: typeof decode91): Response => new Response(new Blob([decode(s)]).stream().pipeThrough(new DecompressionStream("deflate-raw")));

export async function unpack(data: ViewerData | string, decode?: typeof decode91): Promise<ViewerData> {
  const d = typeof data !== "string" ? data : decodeWire(JSON.parse(await inflated(data, decode!).text()));
  d.tree = treeOf(d);
  return d;
}
