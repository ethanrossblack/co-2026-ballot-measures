# Colorado County Vote Visualizer

An interactive view of how Colorado voted on each statewide ballot measure. All 64 counties are drawn with **area proportional to their votes**, then dropped into two physics containers, **Yes** and **No**, where they fall, stack and can be dragged around. A sortable, searchable table underneath gives the exact numbers.

Both containers share one scale, so you can compare the Yes and No sides by eye: the more area a county covers, the more votes it cast on that side.

## Features

- **Pick a measure** from the dropdown (Amendments 81-87 and Propositions NN, 132-137 in the current data). The choice is stored in the URL, e.g. `?measure=6060`, so you can share a link to a specific measure.
- **Circles or map shapes.** Counties start as equal-area circles. One click morphs them into their real outlines (and back).
- **Play with it.** Drag or fling any county, shake the containers, turn gravity off, or use the **Size** slider to scale every shape.
- **Linked highlighting.** Hover a county in either container, or anywhere on its table row, and it lights up in both containers with a label such as `Adams County: 100,137 yes votes (52.4% of county)`.
- **Results table.** Yes/No bar, margin, and total for every county plus a statewide row. Search by name and sort 16 ways (by county, Yes, No, % Yes, margin, total, closest races, vote differential).
- Light and dark mode, and a stacked layout on narrow screens (the table fits phone widths without sideways scrolling).

Results come from a Secretary of State snapshot, so they are only as final as that snapshot. The page shows the percentage of precincts reporting and the snapshot time under the title.

## Run it locally

There is no build step and no framework. The page uses ES modules, which browsers won't load from `file://`, so serve the folder with any static server:

```bash
npx serve .
# or
python3 -m http.server
```

Then open the address it prints. A network connection is needed to load the pinned libraries from CDNs ([d3](https://d3js.org) 7.9.0, topojson-client 3.1.0, poly-decomp 0.3.0, [Matter.js](https://brm.io/matter-js/) 0.19.0) and the fonts from Google Fonts (system fonts are used if they fail).

## Publish on GitHub Pages

The repo is already a static site: `index.html` at the root, relative URLs only, and a `.nojekyll` file.

1. Push the repository to GitHub.
2. Go to **Settings > Pages > Build and deployment**, choose **Deploy from a branch**, and select `main` and `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`.

Keep any new URLs relative (no leading `/`), because a project site is served under `/<repo>/`.

## Update the election data

The page reads `data/ballot-measures.js`, which is generated from the Secretary of State results export.

1. Replace `data/all_co_results.xml` with a newer export.
2. Regenerate the data (Node 16 or newer, no packages needed):

   ```bash
   node scripts/build-ballot-measures.mjs        # optional: [input.xml] [output.js]
   ```

3. Commit and push.

The script keeps only statewide ballot measures: contests with `Yes/For` and `No/Against` choices that cover all 64 counties. Judicial retention, candidate races and measures that cover only some counties are skipped and counted in the summary it prints. It stops with an error if a measure is missing a county or if county votes don't add up to the XML's totals.

## Project layout

```
index.html                  the page (markup only)
css/styles.css              styles
src/                        ES modules
  main.js                   page wiring: measure picker, buttons, size slider, animation loop
  config.js                 tuning constants
  state.js                  small shared mutable state
  format.js                 number formatting and shared helpers
  matter.js                 Matter.js setup
  counties.js               projects the county outlines
  results.js                turns a measure into per-county results
  table.js                  results table, sorting, search
  shapes.js                 outline simplification, resampling, physics bodies
  sim.js                    one physics world (one container)
data/
  colorado-topo.js          trimmed county outlines used by the page
  ballot-measures.js        generated results used by the page
  colorado-counties.json    original county TopoJSON
  all_co_results.xml        Secretary of State results snapshot (source)
scripts/build-ballot-measures.mjs   XML -> data/ballot-measures.js
archive/                    two earlier, self-contained prototypes
dev-tools/                  headless-browser tests
```

## How it works

- **Equal-area map.** County outlines are projected with a conic equal-area projection, so scaling a shape preserves its area relative to the others exactly. A county's shape is scaled so its area equals `votes × k`, where `k` is the single scale shared by both containers.
- **Physics.** [Matter.js](https://brm.io/matter-js/) simulates each container. A county's collision shape is a simplified, convex-decomposed version of its largest outline; the full-detail outline is what gets drawn.
- **Data.** The XML is distilled by a script into a small JavaScript module, so the page does no parsing or fetching at runtime.

## Tests

The `dev-tools` suite drives the real page in headless Chromium (35+ checks covering the picker, table contents, hover linking, sorting, search and layout). It replaces Matter.js with a stub so it can run without a network, which means it does not test real physics.

```bash
cd dev-tools
npm install
npx playwright install chromium
node e2e-test.js        # Node 20+; exits 1 if any check fails
```

Quick syntax check of the modules:

```bash
for f in src/*.js; do node --input-type=module --check < "$f" || echo "BAD $f"; done
```

## Known limitations

- Only statewide Yes/No measures are shown. Judicial retention, candidate races and measures covering part of the state are not.
- The smallest counties are only a few pixels wide on a small container (e.g. Kiowa, San Juan). Use the Size slider to enlarge everything.
- On phones the table drops its sort arrows and uses smaller type to fit; checked down to 320 px wide. Use the sort dropdown for the full set of sorts.
- Only a county's largest outline is collidable; islands and holes are drawn but pass through other shapes, and during the circle-to-map morph holes appear at the end.
- Hovering a shape does not highlight its table row.

## Data and credits

- Election results: Colorado Secretary of State results export (`data/all_co_results.xml`).
- Built with d3, topojson-client, poly-decomp and Matter.js; fonts are Barlow and Barlow Condensed from Google Fonts.
- The `archive/` pages use 2020 Census county populations.
