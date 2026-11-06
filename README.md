# Colorado county vote visualizations: project handoff

This file is a complete handoff for a new Claude session on a different machine. Read it first, then work from the files in this folder. Nothing here depends on the previous conversation.

## 1. What this project is

A set of standalone HTML pages that draw all 64 Colorado counties with **area proportional to a number**, keeping each county's real outline (or morphing it to a circle), inside 2D physics containers where the shapes fall, stack and can be dragged.

The project grew in three steps. **`colorado-ballot-measure.html` is the current, main deliverable.** The other two pages are earlier stages kept for reference and are not updated with later features.

| Stage | File | What it does |
|---|---|---|
| 1 | `colorado-counties-by-population.html` | Static layout: counties in rows, largest to smallest, area ∝ 2020 Census population. SVG. |
| 2 | `colorado-counties-gravity.html` | Same population-scaled shapes dropped into one Matter.js box (drag, Shake, Gravity toggle). |
| 3 | `colorado-ballot-measure.html` | **Main page.** Two containers, Yes and No, sized by votes on a ballot measure, plus a rich results table. |

## 2. Folder contents

```
colorado-county-viz/
├── README.md                              this file
├── colorado-ballot-measure.html           MAIN PAGE (about 420 KB; data embedded)
├── colorado-counties-gravity.html         stage 2
├── colorado-counties-by-population.html   stage 1
├── data/
│   ├── colorado-counties.json             source TopoJSON of the 64 counties (original, untrimmed)
│   └── amendment_87_results.csv           sample election results (the page's embedded default)
└── dev-tools/                             optional: headless-browser checks that need no network
    ├── e2e-test.js                        29 pass/fail checks against the main page
    ├── matter-stub.js                     stand-in for Matter.js + poly-decomp
    ├── topojson-shim.js                   stand-in for topojson-client
    └── package.json                       playwright + d3 dev dependencies
```

The HTML pages are **self-contained**: county shapes and data are embedded inline, so the `data/` files are sources, not runtime dependencies.

## 3. Running it

No build step, no framework. Open an HTML file in a browser, or serve the folder (`npx serve .`) and visit `/colorado-ballot-measure.html`.

Network is needed only to load libraries from CDNs (pinned versions) and Google Fonts (falls back to system fonts):

- `d3@7.9.0` and `topojson-client@3.1.0` (jsDelivr)
- `poly-decomp@0.3.0` (jsDelivr)
- `matter-js@0.19.0` (cdnjs)

## 4. The main page: current behavior

### Containers and physics
- Two outlined containers side by side, **Yes** (left) and **No** (right). They stack vertically below 760 px wide.
- Each county's **area is proportional to its votes on that side**. Both sides share **one scale** (px² per vote), so county areas and each side's total covered area are directly comparable.
- Shapes **start as equal-area circles**. A header button toggles to the county outlines ("Show map shapes" / "Show as circles") with a **550 ms morph animation** in both directions. Physics bodies swap instantly; only the drawing is tweened.
- Counties drop in largest first, so big ones land at the bottom. Free rotation is on. Drag or fling with mouse or touch.
- Header buttons: **Load CSV**, **Drop again**, **Shake**, **Gravity on/off**, shape toggle. The two sides are separate Matter worlds; the buttons act on both.
- Hover or drag a county on either side: it highlights on **both** sides, with a label on each, e.g. `Adams County: 91,280 yes votes (51.5% of county)`. The side under the pointer shows the label by the cursor; the other side pins it above the county.

### Results table (below the containers)
The heading, controls and table share one centered column (max width `58rem` plus padding); on narrower windows it fills the width. The header row is sticky.

- **Controls:** a search box, a **Sort by** dropdown and a result count ("4 of 64 counties").
- **Columns:** County | Yes/No bar | Margin | Total. All sortable; the default is County A to Z.
  - **Yes/No bar:** one rectangle split by vote share (teal Yes, amber No). The **percentage** is inside each segment (hidden automatically if the segment is too narrow to hold it) and the **vote counts** sit beneath, Yes at the left end and No at the right end. The header has three sort buttons that mirror the bar: **Yes** (Yes votes), **% Yes** (Yes share), **No** (No votes).
  - **Margin:** net lead in percentage points, e.g. `+3.1 Yes` or `+14.1 No`, all **bold**. The cell is filled with the leading side's color. Under it, in smaller regular type, is the raw vote differential (the bare number, e.g. `5,451`). A tie shows "Even". One decimal place, two if the lead would round to 0.0. Sorts from biggest Yes lead to biggest No lead. The hover tooltip reads "Yes leads by 5,451 votes".
  - **Total:** county total votes, with the county's share of the statewide total in smaller type underneath (e.g. `10.0%`; two decimals under 1%).
  - **Statewide footer row:** totals, with the same bar, margin and total styling; it never sorts or highlights.
- **Sort dropdown** (`#sort-select`) has 16 options in two groups. It stays in sync with header clicks. Choosing an "Other measures" option clears the header arrows.
  - *Table columns:* County, Yes votes, No votes, % Yes, Margin, Total, each in both directions.
  - *Other measures:* **Closest races first / Widest margins first** (size of the lead in points, either side) and **Vote differential (largest / smallest first)** (raw vote gap).
- **Search:** case-insensitive substring match on county name, plus a space-insensitive *prefix* match so `elpaso` finds El Paso without `san` matching Las Animas. A no-match state shows a message row.
- **Row hover:** hovering **anywhere on a county row** highlights that county in both containers and shows the labelled tooltips. Hover state is cleared when the table is rebuilt (sort, search) or the pointer leaves.
- Light and dark mode via CSS variables (`prefers-color-scheme`).

### Loading other measures
**Load CSV** accepts any comma-delimited file with a header row, a county column and yes and no columns. Detection is by header keyword, case-insensitive, **first match wins**:

| Column | Header regex |
|---|---|
| County | `/county\|name/i` |
| Yes | `/\byes\b\|\bfor\b/i` (e.g. `Yes`, `Yes/For`, `Votes For`) |
| No | `/\bno\b\|\bagainst\b/i` (e.g. `No`, `No/Against`) |

Other columns (Registered Voters, Total) are ignored; totals are computed as Yes + No. County names are matched ignoring case, a trailing "County", spaces and punctuation. Rows named Total/Totals/Statewide/All are skipped. Unmatched rows and counties missing from the file are listed under the header. The page title comes from the file name (`amendment_87_results.csv` becomes "Amendment 87").

The **embedded default** lives in `<script type="text/csv" id="results-csv" data-title="Amendment 87">…</script>`. To change the default measure, replace that block's contents and `data-title` (the CSV must not contain the text `</script>`).

## 5. Data facts

- **County shapes:** the TopoJSON in `data/colorado-counties.json` has object `colorado-counties` with 64 geometries and original properties including `GEOID` (5-digit FIPS, e.g. `08031` = Denver) and `NAME`. The pages embed a trimmed, minified copy in `<script type="application/json" id="colorado-topo">` where each geometry has `id` = GEOID and `properties` = `{ name }`. Coordinates are lon/lat with clockwise exterior rings (what d3 expects, so no rewinding is needed).
- **Projection:** `d3.geoConicEqualArea().parallels([37.5, 40.5]).rotate([105.5, 0]).fitSize([1000, 1000], collection)`. Equal-area, so scaling preserves relative area exactly.
- **Population (stages 1 and 2 only):** `POPULATION_2020`, an object keyed by FIPS with `[name, count]`, 2020 Decennial Census.
- **Amendment 87 sample:** 64 counties, all matching the map. Statewide Yes 1,233,852 and No 1,197,357 (total 2,431,209). Yes share is 50.75%, which displays as **50.8%**, margin **+1.5 Yes**, differential 36,495.

## 6. Code map: `colorado-ballot-measure.html`

One inline `<script>` (the one with no attributes). Sections, in order:

1. **`CONFIG`**: `fillRatio` 0.40 (share of a container the larger side fills), `simplifyPx` 0.8, `minLabelPx` 46, `dropIntervalMs` 70, `body` (Matter options: friction 0.6, frictionStatic 1, frictionAir 0.02, restitution 0, slop 0.1), `shakeStrength` 1, `morphMs` 550, `morphPoints` 64.
2. **Shared helpers:** `fmt`, `pct`, `countyLabel(name, side, votes, share)` (the one wording used for every canvas tooltip), `normName`, `msg`. Global `shapeMode` is `"circle"` or `"map"` (default `"circle"`).
3. **County geometry:** `loadCounties()` projects the embedded TopoJSON and stores each county's projected rings and `projArea`; `COUNTIES`, `COUNTY_BY_KEY`, `COUNTY_BY_ID`.
4. **Results CSV:** `parseResults(text)` returns `{ byId, totals, unmatched, missing }`; `titleFromFilename`.
5. **Results table:**
   - State: `tableState {key, dir}`, `tableRows`, `tableHoverId`, `tableQuery`, `SORT_GROUPS`, `sortSelect`.
   - Builders: `splitBar`, `fitSegLabels`, `fmtMargin`, `tdMargin`, `tdTotal`, `tdBar`, `fmtShare`, `renderTable`, `setTableData`.
   - Wiring: header click, dropdown change, search input, row hover (`tbody` mouseover uses `tr[data-id]`).
   - Sort keys are `name`, `yes`, `no`, `share`, `margin` (signed), `total`, `absMargin`, `diff`; ties fall back to county name.
6. **Shape helpers:** `simplify` (Douglas-Peucker), `resample`, `alignTo`, `easeInOut`, `buildCountyBody(c, value, k, mode)`.
7. **`createSim(side, sectionEl)`:** one Matter engine, runner, mouse and canvas per side; returns `{ resize, drop, morph, shake, setGravity, pick, draw, area }`.
8. **Page wiring:** `dropBoth()` computes the shared scale, `showResults`, file input, buttons, resize handling, and the `frame()` loop.

### Key mechanics
- **Shared scale:** `k = fillRatio × min(stage areas) / max(totalYes, totalNo)` px² per vote.
- **Outline shapes:** scale factor `s = sqrt(value·k / projArea)`. Circles: radius `sqrt(value·k / π)`. Both have the same area for the same votes.
- **Physics vs drawing:** collision shape = the county's largest ring, simplified (about 0.8 px) and convex-decomposed with poly-decomp; falls back to the convex hull if decomposition fails, drops under 85% of the area, or the county is tiny. The **full-detail outline is drawn** at the body's position and angle, using a stored centre-of-mass `offset`.
- **Morph:** each body stores `morphPts` (its main ring resampled to 64 points). `morph(mode)` rebuilds each body in the new shape at the same position, velocity and angle, then tweens the drawing from old to new points in the body's own frame (`alignTo` fixes winding and start index to minimize travel).
- **Hover linking:** each frame, every sim's `pick()` reports the county under its pointer. `frame()` uses the first non-null pick, else `tableHoverId`, and calls `draw(colors, id, isSource)` on both sims.
- **Stability tuning:** sleeping on, fixed 60 Hz timestep, zero bounce, higher friction and more slop, to stop resting jitter.
- **Pointer coordinates:** the canvas is DPR-scaled, so `Mouse.setScale(mouse, {x: 1/dpr, y: 1/dpr})` after each resize; Matter's wheel listeners are removed so the page can scroll.

## 7. Key decisions and why

- **Uniform scaling of real outlines in an equal-area projection**: area reads directly as the quantity and outlines stay recognizable.
- **Everything embedded.** The first version fetched shapes and Census data from the network and was fragile. Now only libraries and fonts load remotely.
- **One shared scale across Yes and No** so the two sides can be compared by eye.
- **Separate physics worlds per side**, with shared controls.
- **Rotation stays free.** A north-up lock (`Body.setInertia(body, Infinity)` after creating the body) was built and then reverted at the user's request.
- **Circles by default** with an animated morph, because circles pack and compare more cleanly. Only the drawn shape animates; animating collision shapes would mean rebuilding 128 bodies per frame.
- **Table as a first-class view:** the bar shows share at a glance, counts and differentials sit in a second line, and every number is sortable.
- **Lenient CSV parsing** that reports problems instead of failing.
- **Hover from the table matches hover on a shape**, including the county name in tooltips.

## 8. Testing and dev notes

The previous environment had **no network**, so Matter.js could not load there. To test the real page anyway, `dev-tools/` stubs Matter.js (bodies sit on a fixed grid, no physics), poly-decomp and topojson-client, then drives the real page in headless Chromium and records canvas text so tooltips can be asserted.

```bash
cd dev-tools && npm install && npx playwright install chromium
node e2e-test.js        # prints PASS/FAIL per check, exits 1 on any failure
```

The suite covers: shape default, table content (bars, counts, margins, totals, footer), row hover from every cell type, canvas hover labels, all 16 sort options, header and dropdown sync, search, and table centering. It all passes against the packaged page.

**Not verifiable with the stub** (check in a real browser): actual falling and stacking, jitter, dragging, and the look of the morph animation.

Quick syntax check of the page script after edits:

```bash
python3 - <<'EOF'
import re
h = open('colorado-ballot-measure.html').read()
open('/tmp/page.js', 'w').write(re.findall(r'<script>(.*?)</script>', h, re.S)[0])
EOF
node --check /tmp/page.js
```

### Pitfalls already hit
- **Flex containers swallow a bare leading space.** `" Yes"` after a `<strong>` rendered as `+3.1Yes` once `.margin-main` became flex. The word now lives in its own `<span>` with `white-space: pre`. Check rendered layout, not just `textContent`.
- **Playwright element screenshots of tall elements misplace sticky headers** (the header appears mid-table). Take viewport screenshots after scrolling instead.
- **Test traps:** `hover()` scrolls the page (re-scroll before testing canvas hover); canvas text recorded before the pointer moved can leak into the next check; clicking the same header twice toggles direction.
- **Compound Matter bodies recalculate inertia** when built, so set inertia after creation if you ever lock rotation again.
- An earlier message misquoted the Amendment 87 Yes share as 50.7%; it is 50.75%, displayed as 50.8%.

## 9. Known limitations

- **Smallest counties are tiny:** about 4 to 6 px wide on an 800×600 container (Kiowa's 107 Yes votes, San Juan's 202 No votes). Raise `CONFIG.fillRatio` (for example 0.5) to enlarge everything.
- **Phone-width windows:** the table has a minimum width (about 536 px), so the page scrolls sideways below roughly 560 px. This predates the centering change and has not been addressed. Containers do stack.
- **CSV limits:** comma-delimited only; one row per county (a later duplicate overwrites); first-match header detection, so a header like `No. of Precincts` placed before the real No column would be picked wrongly. Precinct-level data must be totaled by county first.
- **Holes and islands:** only the largest ring gets a collision shape. Other rings and holes are drawn but not collidable, and during a morph only the main ring animates (holes appear at the end). Very concave outlines can briefly self-intersect mid-morph.
- **Stages 1 and 2** use the older population data and lack the table, circles and linking features.
- **Not built:** hovering a shape does not highlight its table row.

## 10. Ideas the user has not requested yet (ask before building)

- Elections with more than two sides (candidate races): N containers, or a selector.
- Highlight the matching table row when hovering a shape.
- A mobile layout for the table (cards or a horizontally scrolling table with a sticky first column).
- A measure picker with several embedded results.
- Export an image of the containers.

## 11. Working style that has worked

- The user is a platform engineer (JS/TS, AWS, Terraform, Kubernetes) who prefers **professional, concise responses**.
- Make **targeted edits to the existing file** rather than rewriting it, re-run `node --check`, and run `dev-tools/e2e-test.js` when possible.
- When a request is ambiguous, pick the sensible reading, say which you chose, and offer the alternative in one line (for example: replacing the Yes and No columns with one bar column, and offering to restore them).
- The user reviews in a browser and reports back, sometimes with inline review comments on the rendered page; small visual tweaks are typical.
- Deliver the finished HTML file for download. Say plainly what was tested and what could only be checked in the user's browser.
