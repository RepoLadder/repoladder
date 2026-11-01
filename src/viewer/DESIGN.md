# Viewer design notes

The diagram should look like a well-kept engineering notebook: the RepoLadder brand look. Light is the brand paper and ink; dark is the charcoal ramp. One clear hue per kind of part, and selection in the brand accent (mint in dark, forest green in light). Keep later changes consistent with this note.

## Tokens: one source
`theme.ts` composes the palette for light and dark (`THEMES`) from `@repoladder/brand` (change brand colors there, not here), adds only the viewer-only tokens `scrim`, `shadow`, `float` and `float-raised`, and holds the font stacks (`FONTS`). `test/colors.test.ts` fails on a color literal outside `theme.ts` (its one exception is the generated brand mark in `build/mark.ts`).
- The page gets them as CSS custom properties: `build/viewer.ts` prepends `tokenCss()` to the bundled CSS. Dark applies on the OS preference unless the page pins `data-theme`, as the Artifact rules require.
- The viewer's own export (`exportsvg.ts`) clones the live board and inlines the page's matching rules through `resolveTokens()`.
- The SVG export (`build/export.ts`) uses the same diagram CSS (`board.css`) with `resolveTokens()` swapping each `var(--x)` for its literal value.

Don't hard-code a color in CSS or TS; add a token.

| Token | Use |
|---|---|
| `ground` | page background |
| `paper` | plain canvas fill (no dot grid); also the fill of context boxes, the stacked card and edge-label pills |
| `surface` | panels, zoom buttons |
| `ink`, `muted`, `sub` | names, secondary text, the file count under a name |
| `line`, `soft` | hairlines and dividers, hover fills |
| `accent-ink` | text on an accent fill (filled buttons) |
| `accent`, `halo` | selection and focus: the brand accent (mint in dark, forest green in light), so it stays distinct from the kind hues |
| `text-micro/small/body/lg/h3`, `lh-micro/small/body` | the chrome type scale (`TYPE` in `theme.ts`), 12 / 14 / 16 / 18 / 20px and line-heights 1.4 / 1.5 / 1.6, mirroring the site's `theme.css`; not a theme group |
| `radius`, `radius-sm`, `pill` | shape, not color (`SHAPE` in `theme.ts`): 12px for cards, controls and Copy chips, 8px for controls nested inside a 12px card, 999px for the remaining chips |
| `space-1..6` | spacing scale on a 4px grid (`SPACE`): 4, 8, 12, 16, 24, 32px. 8, 16 and 24 are the side panel's rhythm |
| `shadow-1..3`, `float-blur` | floating-chrome elevation (`ELEVATION`), built on the `shadow` color: 1px/2px, 4px/12px and 12px/32px blur, and the backdrop blur, `0px` (off) |
| `float`, `float-raised` | floating surfaces: `float` is the brand `surface`; `float-raised` is the brand `paper`, the neutral nearest `surface` that differs from it (both keep `ink` at 4.5:1 or better), so no color is invented. A popover over a panel uses `float-raised` and lets `shadow-2` carry the lift |
| `scrim`, `shadow` | the dim behind the search dialog; the shadow of the phone sheet and the crumb menu |
| `wire`, `call` | import arrows, runtime-call arrows (dashed, orange) |
| `<kind>`, `<kind>-line` | tint and strong line per kind: `web`, `backend`, `library`, `scripts`, `part` (no kind), `svc` |

### Floating chrome
Nothing uses these tokens yet beyond the design check's "Floating surfaces" specimen; the restyle tickets adopt them.
- A floating panel is `--float` with `--radius`, a 1px `--line` border and `--space-*` padding; menus and popovers above it use `--float-raised`; controls nested in a card use `--radius-sm`.
- Shadows: `--shadow-1` for resting controls, `--shadow-2` for panels, `--shadow-3` for popovers and sheets.
- No blur unless `--float-blur` is raised: a surface that wants it writes `backdrop-filter: blur(var(--float-blur))` (a no-op at `0px`).

### Stylesheets
`styles.css` is only the entry (its comment and the ordered `@import`s, which `build/viewer.ts` bundles). Rule order across the imports is the cascade (the narrow-screen rules deliberately override earlier ones), so new CSS goes in the file for its area, new files are added in the right place in the list, and every file stays under 200 lines (`board.css`, 300, may not grow; `test/cssfiles.test.ts`). Tests read the whole stack through `test/helpers/viewercss.ts`.
- `board.css`, `walk.css`, `stops.css`, `dial.css`: the diagram's own styling, the walkthrough, tour stops and the detail dial.
- `chrome.css`: page shell and header. `buttons.css`: the shared button skin and coarse-pointer sizes. `panel.css`: side panel rhythm and boxes.
- `store.css`: data store panel. `tourcard.css`: the tour card. `story.css`: the story level.
- `focus.css`: focus, selection and search. `filters.css`: filter chips and file boxes.
- `narrow.css`: narrow screens (the phone sheet) and touch targets. `cards.css`: collection panel, actor cards, connection counts, history buttons.
- `trail.css`: breadcrumbs, depth badge, service panel, the everything board, tour trail and copy link. `footer.css`: footer links and embedded mode.

## Type
- **Scale.** Chrome text (side panel, toolbar, breadcrumbs, search, sheets, tour, dial) uses only the site's scale, as `var(--text-*)`: micro 12 (labels, chips, metadata, identifiers), small 14 (secondary prose, buttons, breadcrumbs, the page's base), body 16 (primary prose, icon buttons), lg 18 (phone headings, coarse-pointer icon buttons), h3 20 (page and panel headings). `test/typescale.test.ts` fails on any other chrome size. Exceptions: `.counts b` (24px, the one stat numeral), the search input (never below 16px: iOS zooms smaller inputs on focus), and diagram text (boxes, wires, `.captions .cap`, file boxes), whose size the box-size model fixes.
- Display and UI: **Geist** (one embedded variable subset; UI text uses weights 500–700 on the scale above). Box names, the page title and panel headings use `--font-display`; body text, buttons, chips, search, menus, file-box names and story arrow labels use `--font-ui`.
- Mono: **Geist Mono** (embedded) only for code-like text (file paths, commits, ids and identifiers, snippets, evidence), the small uppercase section labels, and diagram boxes and wires. Everything else is Geist, with `font-variant-numeric: tabular-nums` wherever digits align.
- The fonts ride in the page as their own packed blob, which `boot.ts` registers with `FontFace` (no URL is fetched, so no CSP allowance is needed). The subsets live in `src/viewer/fonts/` and `scripts/fonts.ts` regenerates them; the OFL licence travels in the blob.
- Glyphs the subsets lack, CLI exports and the viewer's saved SVG (`EXPORT_FONTS`) use the system stacks; the viewer's PNG embeds the Geist subsets for rasterizing only (OFL: the fonts are embedded in a document, never saved as font files; NOTICE already covers the pages).

## Boxes by kind
Each kind has a silhouette as well as a color, so kinds read without labels and without color vision (`shapes.ts`, shared by viewer and export):

| Kind | Hue | Shape |
|---|---|---|
| Web app (`web`) | blue | browser window: top bar with three dots, rounded corners (10) |
| Server (`backend`) | green | rack unit: solid left rail with three status lights, tighter corners |
| Library (`library`) | violet | folder: a tab on top, corners 12 |
| Scripts (`scripts`) | slate | terminal: square corners, `>_` prompt in the corner |
| No single kind (`part`) | warm gray | plain rounded card, corners 12 |
| Shared hub (any kind) | its kind | double border (inset outline) |
| Elsewhere (context) | its kind's line | dashed outline on paper, muted name |
| External service | rose | cylinder with a tinted lid, its category glyph above the name |
| Data store | teal | cylinder with a solid lid, the database glyph above the name |
| Has more inside | its kind | a second card offset behind it (stack) |

A part's kind comes from the model (`ModelNode.kind`): the package kind with the most lines in it, where files that define endpoints count as backend.

## Service icons
Parts are told apart by silhouette; services and stores (all cylinders) by a glyph for their category (`src/analyze/services.ts` assigns it: database, payments, ai, email, sms, auth, storage, analytics, monitoring, search, cloud, messaging, other; stores are always database). The glyphs (`icons.ts`) are original single-path line drawings on a 16×16 grid, stroked in the cylinder's line color with round caps, never filled and never brand logos. On the board they are 20px, centred above the name in room `build/layout.ts` adds for them (`ICON_ROOM`); the legend lists each category on the board with its glyph, and the side panel puts the glyph before the service's name. The page carries only the glyphs its services use (`build/html.ts`); the SVG export draws them too. A new glyph should match: same grid, 1–3 strokes, readable at 16px.

## Wires
Imports: neutral line with a count pill. Runtime calls: dashed orange, label in orange. Service SDK: dotted rose, no label. Every wire runs on its own from start to end: arrows are never bundled into a shared trunk (the owner: "impossible to trace a single line, i hate it"). "Elsewhere" boxes and services sit in a lane at the board's edge (`build/lane.ts`), spaced like the board's own boxes.

## Size and strength
`weight.ts` (shared by layout, viewer and export) encodes how much each thing matters:
- **Box size** is uniform: every part and context box on a board shares one size (room for the longest name and sub lines among them), services and stores share another, and file boxes share one. Code volume reads from the sub line ("38 files · 6.2k lines"), not from the box: the owner found varied sizes messier ("just feels cleaner with them all the same size").
- **Arrow width** follows imports + 3 × calls, in four buckets (`w1`–`w4`: up to 4, 19, 79, then above). Calls stay dashed. Service and data wires keep their fixed styles.
- **Readable names.** D2's gaps between boxes are fixed, so a busy board fitted to the canvas used to shrink names to a few pixels. `build/layout.ts` lays a board out with boxes scaled up by a "spread" factor (1 to 3) and scales the result back down, which tightens the gaps; it picks the smallest spread at which names render at least 11.5px on a 1280×800 desktop. Very dense boards (dozens of drawn edges) can still fall short.

## Chrome
The canvas is the page: it fills the window edge to edge (outside embedded mode) with a quiet dot grid (`canvas.css`, CSS on the canvas element only, so exports have none), and the header, the wide-window side panel and the tour card float over it on `--float` with `--shadow-2`. `dock.ts` measures the header and the panel and publishes `--dock-top` and `--dock-right` on the root; the zoom strip, Back/Forward, the dial and the tour card anchor to them, and `region.ts` (`openRegion`, `atRegion`) frames the fit, a selection and a tour step in the part of the canvas they leave open (plus, on a phone, above the sheet's peek). The phone's canvas runs under the bottom sheet. The RepoLadder mark sits at the header's left, both theme variants inline (`mark.ts`), toggled with the token selectors and linked to the landing page; the page's favicon is the same mark. Page title in display type, breadcrumbs as underlined muted links with the current rung in ink, meta in Geist at the right, its commit in mono. Cards, controls, the search box and the Copy chips round to `--radius` (12px); pills are only the crumb "…", legend dots and the kbd hint. Buttons share one skin at the top of `buttons.css` (the site's `button.tsx` variants): outline (tour Back/Exit, focus buttons, Search, Copy chips), ghost (zoom and history strips, export menu) and filled (tour Next, phone Open: `--accent` background with `--accent-ink` text, never `--surface`). Every disabled button is `opacity:.5` with no pointer events. On coarse pointers each is at least 44px; desktop stays dense (28-30px strips). The map strip (top right) is, in order: full screen (the diagram and its tour card only; the header, side panel and Search are not shown, and Esc or the button exits; hidden where the Fullscreen API is missing or refused, as on iPhone Safari), Reframe (back to the readable fit; shown only off the fit, hidden during a walkthrough or tour), +, −, export (`fullscreen.ts`, `reframe.ts`). Strip dividers skip hidden buttons. The export menu and its note stack above the detail dial (`z-index` 5 over the dial's 3). Focus is a 2px accent ring at offset 2 (-2 inside clipped containers). Section labels are small mono capitals in the accent. The side panel keeps one rhythm: 24px between blocks, 8px from a label to its card, 16px card padding; the notes under the cards are grouped in one block, and the id row wraps its Copy pills under a long id. Boxes on the overview views (the story, who uses it, tours, overview or inside, the Key) are collapsible cards whose label is their summary (`box.ts`); only the leading box starts open, and open/closed resets on every re-render except the Key's. The notes under the Key are one collapsed "Notes" box, last in the column. Single-box detail panels stay always open. The legend sits in its own Key card, open by default; a close is remembered for the session in a module variable and in `localStorage` where available (the hosted map runs in a sandboxed iframe without `allow-same-origin`, so there it lasts only until the page reloads and a visitor always starts with it open). It lists only what is on the current board, using the same shapes as the diagram. Its items for services, stores, elsewhere boxes and each wire type are filter toggles (struck through when off); two extra toggles draw the edges the rollup hid (arrows into shared parts, dotted; weaker connections, thin), as plain curves the viewer bends around boxes. A small card at the canvas bottom-left says when filters or a focus are on. Overview lists show a kind swatch before each name.

### Embedded mode
`?embed=1` on the page URL (the hosted site frames the map this way; `embed.ts`) is decided at runtime, never stored in the page. The title bar and the "Made with" footer are hidden by CSS (`<header>`, `#meta` and `<footer class="made">` stay in the DOM), the crumbs and Search move into a toolbar strip above the board, and the canvas fills the frame, keeping its framed grid layout (no floating chrome, no dock; the tour card sits below the canvas). Sheet, story and focus-zoom heights are measured from the toolbar's bottom edge. Copied links drop the param (`shareLink`). A stored map gets this only after an engine release and a rebuild; older viewers ignore the param.

## Story board
When the grouping has a `story`, the page opens on it (`story.ts`, `figures.ts`). It is for someone who has never seen the system:
- Actors are outside the code, so they are drawn in **ink**, not in a kind hue: an ink-outlined card like every other box, with a round medallion (head and shoulders) for a person or a squared one (app grid) for an outside system, the name beside it and its role under the name. All actor cards share one width and stand in one column, in the order the grouping lists them, so their arrows leave a visible edge. Their arrows are solid ink with what they do in plain words, one phrase per line, in the UI font, on a pill that sits on the arrow's own straight run in a lane beside the cards, clear of every other line.
- D2 lays it out with ELK left to right, always, so it reads like a sentence: column headings "People & systems", "Its parts", "What it relies on". Code arrows are quieter there (no counts, lighter).
- The narrative sits in the side panel (on a phone, a bottom sheet that opens half raised on the story board), sentences numbered. References are underlined in the hue of what they name (dotted ink for actors). Pointing at a sentence fades everything it does not name; tapping it pins that and zooms to it. On a phone the board opens at the readable zoom on what the first sentence names: actor, arrow and part together when they fit, otherwise the part with its arrow and pill, the actor just off the left edge (`fit.ts` spanStart, #288).

Off for launch (`src/features.ts`, `story: false`; see Launch switches): the build drops the grouping's `story`, so `data.story` is absent and the page is the story-less shape `--default` already builds: the overview is the root board; `#_story` and actor-id links fall through as unknown and open the overview; a tour step whose board is `_story` is remapped to `root` by `landAt`. `REPOLADDER_STORY=1` / `--story` brings it back (re-run `/map` with the same switch so the digest asks for a story).

## Motion
Moving between rungs is a zoom, not a page change (`transition.ts`): opening a part blows its box up to fill the canvas while the inner board grows out of it, and going up shrinks the board back into its box on the parent. Jumps over several rungs (breadcrumbs, tours, links) zoom through the box one rung down from the shallower board; a sideways move (unrelated boards, a tour start from the overview, a dial-stop change) shuffles: the boxes both boards draw glide from their old spot to the new one, everything else fades, and wires fade rather than re-route (past 60 shared boxes it is a crossfade). "Elsewhere" boxes glide from where those parts sat on the other board. A click, breadcrumb or link move is 400ms, ease-in-out; a tour move (`travel.ts`, `travelTiming`) is longer where it dives, about 560ms for a single dive and 300ms per rung on a deeper one. Transforms and opacity only. Under `prefers-reduced-motion` every move is a 220ms crossfade.

Selecting a box or an arrow zooms to fit it, its neighbors and their arrows (`focuszoom.ts`, on every board but the story board, and not during a tour), 420ms ease-in-out, then leaves the view to the reader: pan, wheel, pinch and the zoom buttons work as usual and nothing pulls it back. Clearing the selection glides back to the board's fit only if the reader has not moved the view. localStorage `repoladder.zoom` = `off` turns it off.

## Launch switches
`src/features.ts` holds the switches (`dial`, `story`), both off for launch. With the dial off the page shows only the Default stop: `stopview.ts` `stopDefs()` offers just `default`, and `main.ts` does not call `installDial()`, so the dial, its `[` / `]` / Alt+arrow keys, double-click-home, elkjs warm-up and remembered stop never run. A remembered `repoladder.detail`, a `tour.<id>.<n>` link and a tour step at another stop all fall back to Default through `landOn`; steps authored at an upward stop are mapped onto the boxes Default draws (`mapStep`), and the stored value is left untouched. Only keys that differ from the defaults are baked into the page (`ViewerData.features`). The story switch is applied in `buildDiagram` (`withoutStory`), not in the viewer. Turn the dial on with `REPOLADDER_DIAL=1`, `build --dial`, or `buildFromFiles(files, { features: { dial: true } })`. `simple` and `fgraph` are still built while it is off, so turning it on is instant; skipping them would be a later saving.

## Design check
`npm run design` builds two offline sample maps (`test/fixtures/tourapp`, `checkin`) and shoots each panel state of the viewer (overview, a selected box, arrow, service and store, a nested board, a tour step with its walk card, search open, the story board when a map has one, and on a phone the sheet at peek, half and full) in desktop light, desktop dark and phone light. It writes `.gallery/design/index.html`, with a reference section under the states: the theme tokens, `--radius` and `--pill`, the `--text-*` type scale when the viewer has one, and crops of the real controls next to a plain-HTML approximation of the site's buttons.

To see what a change did, shoot the base branch in a worktree first, then `npm run design -- --compare <that worktree>/.gallery/design`; it writes `compare.html` and a side-by-side PNG per changed state. Shots that differ only by antialiasing noise (under 0.2% of pixels off by more than 16 levels) count as unchanged, so a change smaller than that will not be listed.

The script uses only the viewer's existing hooks (`window.__repoladder`, the DOM). `SEL` in `scripts/design.ts` holds every selector it uses, so a renamed class is fixed in one place.

