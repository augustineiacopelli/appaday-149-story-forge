// Builds the Story Forge fixtures by running Day 148's own page on its own Day 147 fixtures, so every fixture is a real
// Day 148 Final export: import the fixture, set seed 42, generate the whole world (progression, overworld, interiors,
// zones, and the side quest givers), check that nothing blocks a Final, then Kit.buildExport('final') with baking off
// (Day 150 regenerates every map from the seed; baking would add size to index.html and nothing a story needs).
// DECISION (Session 0): before Day 148 grows the world, one Day 146 shaped edit raises each chapter's targetMinutes (and
// the Charter's targetPlayHours to match, so Day 146's ratio check stays quiet) until the chapters reach the 12 hour
// floor that Phase 6 makes an error. Day 148's own fixtures sum to 120 and 450 minutes, so neither could ever export a
// Final from this forge. The edit is restamped with Day 146's own hash; Day 147's art does not read minutes.
// Outputs:
//   test/out/demo148-bundle.json  the Day 146 demo (two chapters, Westland and Eastland), dressed by 147, world by 148.
//   test/out/four148-bundle.json  six chapters on four continents, The Marches with no boss troop (an empty boss slot
//                                 for Day 149 to fill), two side quests whose givers Day 148 filled.
'use strict';
const fs = require('fs');
const path = require('path');
const { page148, in146, in147, in148, stamp, DIR148 } = require('./compat');
const OUT = path.join(__dirname, 'out');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED = 42;

// Chapter minutes per fixture, in Charter order: 2 x 360 = 720 for the demo, 780 for the four continents.
const MINUTES = { demo: [360, 360], four: [120, 90, 150, 120, 120, 180] };
async function twelveHours(key) {
  const src = JSON.parse(fs.readFileSync(path.join(DIR148, 'test', 'out', key + '147-bundle.json'), 'utf8'));
  const chs = src.charter.sections.chapters, mins = MINUTES[key];
  if (chs.length !== mins.length) throw new Error(key + ': expected ' + mins.length + ' chapters, found ' + chs.length);
  chs.forEach((c, i) => { c.targetMinutes = mins[i]; });
  src.charter.quotas.targetPlayHours = Math.round(mins.reduce((a, m) => a + m, 0) / 60);
  return stamp(src);
}
async function grow(key) {
  const { win, errors } = await page148({ dev: true });
  if (errors.length) throw new Error('Day 148 page errors: ' + errors.join('\n'));
  const { Kit, WORLD } = win;
  const imp = Kit.bundle.importText(await twelveHours(key)); await wait(20);
  if (!imp.matches) throw new Error(key + ': restamped hash does not verify in Day 148');
  const b = Kit.bundle.current();
  b.world.seed = SEED;
  WORLD.bake.set(b, false);
  WORLD.zones.apply();
  const why = WORLD.finalBlock(b);
  if (why) throw new Error(key + ': Day 148 refuses a Final: ' + why);
  const out = Kit.buildExport('final', { engines: false });
  const man = JSON.parse(out.files[1].text);
  return { text: out.files[0].text, bundle: JSON.parse(out.files[0].text), man, summary: Kit.validate.summary(Kit.refreshValidation()) };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = {};
  for (const [key, file] of [['demo', 'demo148-bundle.json'], ['four', 'four148-bundle.json']]) {
    const g = await grow(key);
    fs.writeFileSync(path.join(OUT, file), g.text);
    const b = g.bundle, R = b.world.records, n = (p) => Object.keys(R[p] || {}).length;
    const [c146, c147, c148] = [await in146(g.text), await in147(g.text), await in148(g.text)];
    const bossSlots = Object.values(R.dgn_).filter((d) => d.role === 'boss').map((d) => (d.troop ? 'troop' : 'EMPTY'));
    summary[key] = {
      file, bytes: g.text.length, minutes: b.charter.sections.chapters.map((c) => c.targetMinutes).join(' '), hours: b.charter.quotas.targetPlayHours, hash: b.kit.contentHash.slice(0, 12), seed: b.world.seed, in148: g.summary,
      forges: Object.keys(b.kit.forges).map((f) => f + ':' + b.kit.forges[f].status).join(' '), opened: b.kit.opened.join(' '),
      records: { map_: n('map_'), reg_: n('reg_'), npc_: n('npc_'), twn_: n('twn_'), dgn_: n('dgn_') },
      gates: Array.from(new Set(b.world.progression.nodes.reduce((a, x) => a.concat(x.requires, x.grants), []))).sort(),
      bossSlots, givers: Object.values(b.rules.sdq_ || {}).map((q) => q.giver || null), unresolved: g.man.unresolved.length,
      reopen: { 146: c146.summary, 147: c147.summary, 148: c148.rejected || c148.summary }
    };
  }
  console.log(JSON.stringify(summary, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
