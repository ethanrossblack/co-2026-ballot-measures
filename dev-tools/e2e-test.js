#!/usr/bin/env node
// End-to-end checks for ../index.html in a headless browser, with NO network.
//
// Matter.js, poly-decomp and topojson-client are replaced with the stand-ins in this folder, so
// bodies sit on a fixed grid instead of falling. That is enough to test hover, labels, the table,
// sorting, search and layout. It does NOT test real physics (stacking, jitter, dragging, morph visuals).
//
// Setup (once):  cd dev-tools && npm install && npx playwright install chromium
// Run:           node e2e-test.js          (exit code 1 if any check fails)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ballot-measures.js'), 'utf8').replace(/^export default /, '').replace(/;\s*$/, ''));
const MEASURE_KEY = '6060'; // Amendment 87, the measure the table/hover checks run against
const M = DATA.measures.find(m => m.key === MEASURE_KEY);
const stateYes = Object.values(M.counties).reduce((a, c) => a + c.yes, 0);
const stateNo = Object.values(M.counties).reduce((a, c) => a + c.no, 0);
const stateTotal = stateYes + stateNo;


function findD3() {
  for (const dir of require.resolve.paths('d3') || []) {
    const f = path.join(dir, 'd3', 'dist', 'd3.min.js');
    if (fs.existsSync(f)) return f;
  }
  throw new Error('d3 not found. Run `npm install` in dev-tools/.');
}
const D3 = findD3();
const STUB = path.join(__dirname, 'matter-stub.js');
const SHIM = path.join(__dirname, 'topojson-shim.js');

let failed = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `\n      ${detail}` : ''}`);
};
const nf = n => n.toLocaleString('en-US');

// The page is made of ES modules, which browsers refuse to load from file://, so serve the repo
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'index.html') : f;
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const HTML = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Record every string drawn to a canvas, so tooltips (which are canvas text) can be asserted
  await page.addInitScript(() => {
    window.__texts = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__texts.push(String(t)); return orig.call(this, t, ...a); };
  });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('d3@')) return route.fulfill({ path: D3, contentType: 'text/javascript' });
    if (u.includes('topojson-client')) return route.fulfill({ path: SHIM, contentType: 'text/javascript' });
    if (u.includes('poly-decomp') || u.includes('matter-js')) return route.fulfill({ path: STUB, contentType: 'text/javascript' });
    return u.startsWith('http://127.0.0.1') ? route.continue() : route.abort();
  });

  await page.goto(`${HTML}?sides=on&measure=${MEASURE_KEY}`);
  await page.waitForSelector('#measure option', { state: 'attached' });
  await page.waitForTimeout(5500); // let the staggered drop finish (64 counties x 70 ms)

  // Modules keep their state private, so read it by importing the (shared) state module
  const stateOf = key => page.evaluate(async k => (await import('/src/state.js')).state[k], key);
  const clearTexts = () => page.evaluate(() => { window.__texts = []; });
  const countyLabels = async () => {
    await page.waitForTimeout(250);
    const t = await page.evaluate(() => [...new Set(window.__texts.filter(x => x.includes(' County:')))]);
    await clearTexts();
    return t;
  };
  const names = () => page.$$eval('#results-table tbody td.name', t => t.map(x => x.textContent));
  const rows = () => page.$$eval('#results-table tbody tr[data-id]', trs => trs.map(r => {
    const title = r.querySelector('.split-wrap').title;
    const m = title.match(/Yes ([\d,]+) \(.*No ([\d,]+) \(/);
    const yes = +m[1].replace(/,/g, ''), no = +m[2].replace(/,/g, '');
    const strong = r.querySelector('.margin-main strong');
    return {
      name: r.children[0].textContent, yes, no, total: yes + no,
      yesW: parseFloat(r.querySelector('.seg.yes').style.width), noW: parseFloat(r.querySelector('.seg.no').style.width),
      counts: [...r.querySelectorAll('.split-counts span')].map(x => x.textContent),
      marginText: r.querySelector('.margin-main').textContent, marginSub: r.querySelector('.margin-sub').textContent,
      numWeight: getComputedStyle(strong).fontWeight, wordWeight: getComputedStyle(r.querySelector('.margin-main span')).fontWeight,
      subWeight: getComputedStyle(r.querySelector('.margin-sub')).fontWeight,
      totalMain: r.querySelector('.total-main').textContent, totalSub: r.querySelector('.total-sub').textContent
    };
  }));

  // ---- Page basics --------------------------------------------------------------
  ok('page loads with no script errors', errors.length === 0, errors.join(' | '));
  ok('starts as circles', (await stateOf('shapeMode')) === 'circle');
  ok('shape button offers map shapes', (await page.$eval('#shape', e => e.textContent)) === 'Show map shapes');

  // ---- Measure picker -----------------------------------------------------------------
  const opts = await page.$$eval('#measure option', t => t.map(o => [o.value, o.textContent]));
  ok('picker lists all 14 statewide measures', opts.length === 14 && opts.length === DATA.measures.length, `got ${opts.length}`);
  ok('picker has no judicial or candidate contests', opts.every(([, t]) => /^(Amendment|Proposition) /.test(t)), JSON.stringify(opts));
  ok('?measure= deep link selects that measure', (await page.$eval('#measure', e => e.value)) === MEASURE_KEY);
  ok('title shows the measure', (await page.$eval('#title', e => e.textContent)) === M.title);
  ok('snapshot note shows reporting progress',
    (await page.$eval('#snapshot-note', e => e.textContent)).includes(`${M.precinctsReportingPercent}% of precincts reporting`));

  // ---- Table content --------------------------------------------------------------
  let d = await rows();
  ok('64 county rows', d.length === 64, `got ${d.length}`);
  ok('starts sorted A to Z', JSON.stringify(await names()) === JSON.stringify([...(await names())].sort((a, b) => a.localeCompare(b))) && d[0].name === 'Adams');
  ok('bar segments sum to 100%', d.every(r => Math.abs(r.yesW + r.noW - 100) < 1e-6));
  const pctLabelsOK = await page.$$eval('#results-table tbody tr', trs => trs.every(r => {
    const w = parseFloat(r.querySelector('.seg.yes').style.width);
    return r.querySelector('.seg.yes .lab').textContent === w.toFixed(1) + '%';
  }));
  ok('Yes percent labels match bar widths', pctLabelsOK);
  ok('counts under the bar equal the votes', d.every(r => r.counts[0] === nf(r.yes) && r.counts[1] === nf(r.no)));
  ok('margin text correct for all rows', d.every(r => {
    const pts = Math.abs(r.yes - r.no) / r.total * 100;
    let n = pts.toFixed(1); if (n === '0.0') n = pts.toFixed(2);
    return r.marginText === `+${n} ${r.yes > r.no ? 'Yes' : 'No'}`;
  }));
  ok('margin number and Yes/No word are bold, differential is regular',
    d.every(r => r.numWeight === '700' && r.wordWeight === '700' && r.subWeight === '400'));
  ok('differential under margin is the bare vote gap', d.every(r => r.marginSub === nf(Math.abs(r.yes - r.no))));
  ok('total shows count and share of state underneath', d.every(r => {
    const share = r.total / stateTotal;
    return r.totalMain === nf(r.total) && r.totalSub === (share * 100).toFixed(share < 0.01 ? 2 : 1) + '%';
  }));
  const foot = await page.$eval('#results-table tfoot tr', r => [r.children[0].textContent, r.querySelector('.margin-main').textContent, r.querySelector('.margin-sub').textContent, r.querySelector('.total-main').textContent, r.querySelector('.total-sub').textContent]);
  const diff = stateYes - stateNo, pts = Math.abs(diff) / stateTotal * 100;
  const footExpected = [`+${pts.toFixed(1)} ${diff > 0 ? 'Yes' : 'No'}`, nf(Math.abs(diff)), nf(stateTotal), '100.0%'];
  ok('Statewide footer row', foot.join('|') === ['Statewide', ...footExpected].join('|'), foot.join('|'));

  // ---- Hover: table row -> canvases -------------------------------------------------
  await clearTexts();
  const adams = page.locator('#results-table tbody tr', { has: page.locator('td.name', { hasText: /^Adams$/ }) });
  const A = M.counties.Adams;
  for (const [what, sel] of [['name', 'td.name'], ['bar', 'td.split-cell'], ['margin', 'td.margin-cell'], ['total', 'td.total-cell']]) {
    await adams.locator(sel).hover();
    const id = await stateOf('tableHoverId');
    const labels = await countyLabels();
    ok(`hovering the ${what} cell highlights the county and labels both containers (with name)`,
      id === '08001' && labels.includes(`Adams County: ${nf(A.yes)} yes votes (${(A.yes / (A.yes + A.no) * 100).toFixed(1)}% of county)`) && labels.includes(`Adams County: ${nf(A.no)} no votes (${(A.no / (A.yes + A.no) * 100).toFixed(1)}% of county)`),
      `id=${id} labels=${JSON.stringify(labels)}`);
  }
  await page.locator('#results-table tfoot tr td').first().hover();
  await page.waitForTimeout(200); await clearTexts();
  ok('Statewide row does not highlight anything', (await stateOf('tableHoverId')) === null && (await countyLabels()).length === 0);

  // ---- Hover: canvas -> other canvas -----------------------------------------------
  await page.locator('.side[data-side="yes"] canvas').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
  const yc = await page.locator('.side[data-side="yes"] canvas').boundingBox();
  await page.mouse.move(yc.x + 85, yc.y + 85); await page.mouse.move(yc.x + 90, yc.y + 90);
  await page.waitForTimeout(200); await clearTexts();
  const onYes = await countyLabels();
  ok('hovering a shape labels both containers and the margin map',
    onYes.length === 3 && onYes.every(t => t.startsWith('Denver County:')) && onYes.some(t => /Denver County: (Yes|No) by [\d,]+ votes \(\d+\.\d% margin\)/.test(t)), JSON.stringify(onYes));
  await page.mouse.move(600, 5);

  // ---- Switching measures -------------------------------------------------------------
  const other = DATA.measures.find(m => m.key !== MEASURE_KEY);
  await page.selectOption('#measure', other.key);
  await page.waitForTimeout(300);
  const oy = Object.values(other.counties).reduce((a, c) => a + c.yes, 0);
  const on = Object.values(other.counties).reduce((a, c) => a + c.no, 0);
  const ofoot = await page.$eval('#results-table tfoot tr', r => r.querySelector('.total-main').textContent);
  ok('picking another measure updates title and statewide total',
    (await page.$eval('#title', e => e.textContent)) === other.title && ofoot === nf(oy + on), `${other.title} ${ofoot}`);
  ok('picking a measure updates the URL', new URL(page.url()).searchParams.get('measure') === other.key);
  await page.selectOption('#measure', MEASURE_KEY);
  await page.waitForTimeout(300);
  ok('switching back restores the first measure', (await page.$eval('#title', e => e.textContent)) === M.title);
  await page.waitForTimeout(5500); // let the re-drop finish before canvas checks
  await page.evaluate(() => window.scrollTo(0, 0));

  // ---- Sorting: dropdown + header buttons -------------------------------------------
  const measure = {
    name: r => r.name, yes: r => r.yes, no: r => r.no, share: r => r.yes / r.total, margin: r => (r.yes - r.no) / r.total,
    total: r => r.total, absMargin: r => Math.abs(r.yes - r.no) / r.total, diff: r => Math.abs(r.yes - r.no)
  };
  const optionValues = await page.$$eval('#sort-select option', t => t.map(o => o.value));
  ok('dropdown offers 16 sorts', optionValues.length === 16, `got ${optionValues.length}`);
  let allSorted = true;
  for (const o of optionValues) {
    const [k, dir] = o.split(':');
    await page.selectOption('#sort-select', o);
    const v = (await rows()).map(measure[k]);
    const good = v.every((x, i) => i === 0 || (k === 'name'
      ? (dir === 'asc' ? v[i - 1].localeCompare(x) <= 0 : v[i - 1].localeCompare(x) >= 0)
      : (dir === 'asc' ? v[i - 1] <= x + 1e-12 : v[i - 1] >= x - 1e-12)));
    if (!good) { allSorted = false; console.log('      not sorted:', o); }
  }
  ok('every dropdown option sorts correctly', allSorted);
  await page.selectOption('#sort-select', 'diff:desc');
  ok('extra measures clear the header arrows',
    (await page.$$eval('#results-table .sort-btn', t => [...new Set(t.map(x => x.dataset.sort))])).join() === 'none');
  const btn = k => `#results-table .sort-btn[data-key="${k}"]`;
  await page.click(btn('yes'));
  ok('header click syncs the dropdown (desc first)', (await page.$eval('#sort-select', e => e.value)) === 'yes:desc');
  await page.click(btn('yes'));
  ok('second header click reverses and syncs', (await page.$eval('#sort-select', e => e.value)) === 'yes:asc');

  // ---- Search ----------------------------------------------------------------------
  await page.selectOption('#sort-select', 'name:asc');
  await page.fill('#county-search', 'san');
  ok('search "san" -> San Juan, San Miguel', JSON.stringify(await names()) === JSON.stringify(['San Juan', 'San Miguel']), JSON.stringify(await names()));
  await page.fill('#county-search', 'elpaso');
  ok('search "elpaso" -> El Paso', JSON.stringify(await names()) === JSON.stringify(['El Paso']));
  await page.fill('#county-search', 'zzz');
  ok('no matches shows an empty-state row', (await page.$eval('#results-table td.empty', e => e.colSpan)) === 4);
  await page.fill('#county-search', '');
  ok('clearing search restores 64 rows', (await names()).length === 64);

  // ---- Layout: table column centered on wide windows ----------------------------------
  let centered = true;
  for (const w of [1900, 1600, 1300, 1100]) {
    await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(100);
    const g = await page.evaluate(() => { const r = document.querySelector('#results-table').getBoundingClientRect(); return [r.left, document.documentElement.clientWidth - r.right]; });
    if (Math.abs(g[0] - g[1]) > 1) { centered = false; console.log(`      not centered at ${w}px:`, g); }
  }
  ok('table is centered at 1100-1900px wide', centered);

  // ---- Layout toggle (map layout) -----------------------------------------------
  ok('starts in falling layout', (await stateOf('layoutMode')) === 'fall' && !(await page.$eval('#gravity', e => e.disabled)));
  await page.click('#layout');
  ok('map layout: state, outlines, gravity disabled',
    (await stateOf('layoutMode')) === 'map' && (await stateOf('shapeMode')) === 'map' && (await page.$eval('#gravity', e => e.disabled)));
  ok('map layout: button offers the way back', (await page.$eval('#layout', e => e.textContent)) === 'Back to falling');
  await page.click('#layout');
  ok('back to falling re-enables gravity', (await stateOf('layoutMode')) === 'fall' && !(await page.$eval('#gravity', e => e.disabled)));
  await page.click('#shape'); // restore circles for the checks below
  ok('layout toggling leaves no script errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
