// Extracts the statewide ballot measures (Yes/For vs No/Against, all 64 counties)
// from a Secretary of State results XML snapshot into a small JSON file.
//
// Usage: node scripts/build-ballot-measures.mjs [input.xml] [output.json]
import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2] ?? "data/all_co_results.xml";
const output = process.argv[3] ?? "data/ballot-measures.json";

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const decode = s => s.replace(/&(amp|lt|gt|quot|apos);/g, m => ENTITIES[m]);
const attrs = line => Object.fromEntries([...line.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? "");

// The file has one element per line, so a line scanner with a little state is enough
function parseContests(xml) {
  const contests = [];
  let contest = null, choice = null;
  for (const line of xml.split("\n")) {
    const t = line.trim();
    if (t.startsWith("<Contest ")) {
      contest = { ...attrs(t), choices: [] };
      contests.push(contest);
    } else if (t.startsWith("</Contest>")) {
      contest = choice = null;
    } else if (contest && t.startsWith("<Choice ")) {
      choice = { ...attrs(t), counties: {} };
      contest.choices.push(choice);
    } else if (choice && t.startsWith("</Choice>")) {
      choice = null;
    } else if (choice && t.startsWith("<County ")) {
      const a = attrs(t);
      choice.counties[a.name] = Number(a.votes);
    }
  }
  return contests;
}

const xml = readFileSync(input, "utf8");
const contests = parseContests(xml);
const skipped = { "judicial retention (Yes/No)": 0, "not statewide": 0, "candidate race": 0 };
const measures = [];

for (const c of contests) {
  const yes = c.choices.find(ch => ch.text === "Yes/For");
  const no = c.choices.find(ch => ch.text === "No/Against");
  if (!yes || !no) {
    const plain = c.choices.some(ch => ch.text === "Yes") && c.choices.some(ch => ch.text === "No");
    skipped[plain ? "judicial retention (Yes/No)" : "candidate race"]++;
    continue;
  }
  if (c.countiesParticipating !== "64") { skipped["not statewide"]++; continue; }

  const names = Object.keys(yes.counties);
  const problems = [];
  if (names.length !== 64) problems.push(`${names.length} counties in Yes/For`);
  if (names.some(n => !(n in no.counties))) problems.push("Yes/For and No/Against counties differ");
  const sum = ch => Object.values(ch.counties).reduce((a, b) => a + b, 0);
  if (sum(yes) !== Number(yes.totalVotes)) problems.push(`Yes/For county sum ${sum(yes)} != totalVotes ${yes.totalVotes}`);
  if (sum(no) !== Number(no.totalVotes)) problems.push(`No/Against county sum ${sum(no)} != totalVotes ${no.totalVotes}`);
  if (problems.length) throw new Error(`Contest ${c.key} "${c.text}": ${problems.join("; ")}`);

  measures.push({
    key: c.key,
    title: c.text,
    precinctsReportingPercent: Number(c.precinctsReportingPercent),
    counties: Object.fromEntries(names.map(n => [n, { yes: yes.counties[n], no: no.counties[n] }]))
  });
}

if (!measures.length) throw new Error("No statewide ballot measures found.");

const out = {
  election: tag(xml, "ElectionName"),
  date: tag(xml, "ElectionDate"),
  snapshot: tag(xml, "Timestamp"),
  measures
};
writeFileSync(output, JSON.stringify(out) + "\n");

console.log(`${measures.length} ballot measures -> ${output}`);
for (const m of measures) console.log(`  ${m.key}  ${m.title}  (${m.precinctsReportingPercent}% of precincts reporting)`);
console.log("Skipped:", Object.entries(skipped).map(([k, v]) => `${v} ${k}`).join(", "));
