// Viewer entry. Runs in the browser: esbuild bundles this to an IIFE (see build/viewer.ts)
// that defines `repoladder`; the page's boot script (boot.ts) unpacks it and calls `repoladder.start(data)`.
import { installCrumbs } from "./crumbs.ts";
import { installEmbed } from "./embed.ts";
import { openHash } from "./deeplink.ts";
import { installDock } from "./dock.ts";
import { installDeselect } from "./deselect.ts";
import { installFilters } from "./filterui.ts";
import { installFit } from "./fit.ts";
import { installFocus } from "./focus.ts";
import { installFocusZoom } from "./focuszoom.ts";
import { featuresOf, type Features } from "../features.ts";
import { installDial } from "./dial.ts";
import { installExport, type ExportKind } from "./exportui.ts";
import { installHistory, unrecorded } from "./history.ts";
import { here, installNavigation, restore, select, show } from "./navigate.ts";
import { installPanZoom } from "./panzoom.ts";
import { installZoomKeys } from "./zoomkeys.ts";
import { installStory } from "./story.ts";
import { installSearch } from "./search.ts";
import { installBarMenuKeys } from "./barmenu.ts";
import { installTopActions } from "./topactions.ts";
import { installSheet } from "./sheet.ts";
import { installTours, playTour } from "./tour.ts";
import { installTourLinks } from "./tourlink.ts";
import { installTourTrail } from "./tourtrail.ts";
import { groupTours, installTourList, walkHook } from "./walk.ts";
import { st, type ViewerData } from "./state.ts";
import { installStops, viewStop } from "./stopview.ts";
import { installFullscreen } from "./fullscreen.ts";
import { installCut, viewCut } from "./cutview.ts";
import { finishTransition } from "./transition.ts";
import { travel, travelTiming } from "./travel.ts";
import { unpack } from "./unpack.ts";
import type { decode91 } from "./base91.ts";

declare global {
  interface Window { __repoladder?: { boards: string[]; show: (id: string) => void; tour: (id: string, step?: number) => void; walk: typeof walkHook; stop: typeof viewStop; cut: typeof viewCut; travel: typeof travel; travelTiming: typeof travelTiming; exportView: (kind: ExportKind) => Promise<Blob>; tours: typeof groupTours; features: Features } }
}

/** `decode` is the boot script's basE91 decoder (boot.ts), for packed data. */
export async function start(packed: ViewerData | string, decode?: typeof decode91, fonts?: string): Promise<void> {
  installEmbed();
  const data = await unpack(packed, decode);
  st.data = data;
  installNavigation();
  const exportView = installExport(decode, fonts);
  installBarMenuKeys();
  installHistory(here, restore);
  installCrumbs();
  installFilters();
  installPanZoom();
  installZoomKeys();
  installFullscreen();
  installDock();
  installFit();
  installSheet();
  installFocus();
  installFocusZoom();
  installDeselect(select);
  installTours();
  installTourTrail();
  installTourList();
  installTourLinks();
  installStory();
  installSearch();
  installTopActions();
  // turning the detail dial isn't a history step
  installStops((id, back, hit) => unrecorded(() => show(id, back, hit)));
  installCut((id) => unrecorded(() => show(id, undefined, null, true)));
  // Lets scripts/shots.ts visit every board with the viewer's own navigation.
  window.__repoladder = { boards: Object.keys(data.layout), show: (id) => { show(id); finishTransition(); }, tour: playTour, walk: walkHook,
    // the detail dial's stops by key (stopview.ts), and one board cut at any budget (cutview.ts)
    stop: viewStop, cut: viewCut,
    // up, across, down between any two boards (travel.ts), and its timings for scripts
    travel, travelTiming,
    // the Export button's three outputs (exportui.ts) and the grouping's tours (scripts/readme-media.ts)
    exportView, tours: groupTours, features: featuresOf(data) };
  openHash(show, true);
  // the dial's DOM, keys, double-click, remembered stop and elkjs warm-up all live in installDial
  if (featuresOf(data).dial) installDial();
  window.addEventListener("hashchange", () => openHash(show));
}
