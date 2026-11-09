// Downloads the latest Colorado Secretary of State results export (Clarity ENR "detailxml.zip"),
// saves its detail.xml as data/all_co_results.xml and rebuilds data/ballot-measures.js.
//
// Clarity publishes each results update as a numbered version; current_ver.txt names the latest
// one, and the zip lives at <base>/<election>/<version>/reports/detailxml.zip.
//
// Usage: node scripts/fetch-results.mjs [options]
//   --force           replace and rebuild even if the snapshot timestamp hasn't changed
//   --no-build        only download the XML, don't run build-ballot-measures.mjs
//   --ver <n>         use this results version instead of the current one
//   --election <id>   Clarity election id (default 127407, the 2026 General)
//   --out <file>      where to write the XML (default data/all_co_results.xml)
//
// Node 18 or newer (built-in fetch), no packages needed.
import { inflateRawSync } from "node:zlib";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = "https://results.enr.clarityelections.com/CO";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const opts = { force: false, build: true, ver: null, election: "127407", out: path.join(ROOT, "data/all_co_results.xml") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--force") opts.force = true;
    else if (a === "--no-build") opts.build = false;
    else if (a === "--ver") opts.ver = next();
    else if (a === "--election") opts.election = next();
    else if (a === "--out") opts.out = path.resolve(next());
    else if (a === "-h" || a === "--help") {
      const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
      console.log(lines.slice(0, lines.findIndex(l => !l.startsWith("//"))).map(l => l.slice(3)).join("\n"));
      process.exit(0);
    } else throw new Error(`Unknown option ${a} (see --help)`);
  }
  for (const [k, v] of [["--ver", opts.ver], ["--election", opts.election]])
    if (v !== null && !/^\d+$/.test(v)) throw new Error(`${k} must be a number, got "${v}"`);
  return opts;
}

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), cache: "no-store" });
  const body = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    const title = /html/.test(res.headers.get("content-type") ?? "") ? body.toString().match(/<TITLE>([^<]*)/i)?.[1] : null;
    throw new Error(`GET ${url} -> HTTP ${res.status}${title ? `: ${title.trim()}` : ""}`);
  }
  return body;
}

// Minimal zip reader: finds the entry via the central directory and inflates it
function unzipEntry(zip, pick) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--)
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Download is not a zip file");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt zip central directory");
    const nameLen = zip.readUInt16LE(p + 28);
    entries.push({
      method: zip.readUInt16LE(p + 10),
      compSize: zip.readUInt32LE(p + 20),
      size: zip.readUInt32LE(p + 24),
      offset: zip.readUInt32LE(p + 42),
      name: zip.toString("utf8", p + 46, p + 46 + nameLen)
    });
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  const e = pick(entries);
  if (!e) throw new Error(`No matching file in zip (contains: ${entries.map(x => x.name).join(", ") || "nothing"})`);
  const h = e.offset;
  if (zip.readUInt32LE(h) !== 0x04034b50) throw new Error("Corrupt zip local header");
  const start = h + 30 + zip.readUInt16LE(h + 26) + zip.readUInt16LE(h + 28);
  const raw = zip.subarray(start, start + e.compSize);
  const data = e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw) : null;
  if (!data) throw new Error(`Unsupported zip compression method ${e.method}`);
  if (data.length !== e.size) throw new Error(`${e.name}: expected ${e.size} bytes, got ${data.length}`);
  return { name: e.name, data };
}

const timestamp = xml => xml.match(/<Timestamp>([^<]*)<\/Timestamp>/)?.[1] ?? null;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const electionUrl = `${BASE}/${opts.election}`;

  const ver = opts.ver ?? (await get(`${electionUrl}/current_ver.txt`)).toString().trim();
  if (!/^\d+$/.test(ver)) throw new Error(`Unexpected current_ver.txt contents: "${ver.slice(0, 80)}"`);
  const zipUrl = `${electionUrl}/${ver}/reports/detailxml.zip`;
  console.log(`Results version ${ver}${opts.ver ? " (pinned)" : ""}: ${zipUrl}`);

  const zip = await get(zipUrl);
  const { name, data } = unzipEntry(zip, es => es.find(e => e.name === "detail.xml") ?? es.find(e => /\.xml$/i.test(e.name)));
  const xml = data.toString("utf8");

  // Sanity-check before touching the repo's copy
  const contests = (xml.match(/<Contest /g) ?? []).length;
  const stamp = timestamp(xml);
  if (!/<ElectionResult>/.test(xml) || !stamp || !contests)
    throw new Error(`${name} doesn't look like a Clarity results export (timestamp: ${stamp}, contests: ${contests})`);
  console.log(`${name}: ${(data.length / 1024).toFixed(0)} KB, ${contests} contests, snapshot ${stamp}`);

  const previous = existsSync(opts.out) ? readFileSync(opts.out) : null;
  const prevStamp = previous && timestamp(previous.toString("utf8"));
  if (prevStamp === stamp && !opts.force) {
    console.log(`Already up to date (${path.relative(ROOT, opts.out)} has the same snapshot). Use --force to rebuild anyway.`);
    return;
  }

  const tmp = `${opts.out}.download`;
  writeFileSync(tmp, data);
  renameSync(tmp, opts.out);
  console.log(`Wrote ${path.relative(ROOT, opts.out)}${prevStamp ? ` (was ${prevStamp})` : ""}`);

  if (!opts.build) return;
  const build = spawnSync(process.execPath, [path.join(ROOT, "scripts/build-ballot-measures.mjs"), opts.out], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) {
    // Keep the XML and the generated module in step: the build writes nothing on failure
    if (previous) {
      writeFileSync(opts.out, previous);
      console.error(`Build failed; restored the previous ${path.relative(ROOT, opts.out)}.`);
    }
    process.exitCode = build.status ?? 1;
  }
}

main().catch(err => {
  console.error(`fetch-results: ${err.message}`);
  process.exitCode = 1;
});
