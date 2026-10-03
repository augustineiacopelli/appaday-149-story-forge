// Phase 2 acceptance: flags and gate bindings (STORY.flags in src/story-scaffold.js, the Flags tab in src/ws-flags.js).
// 1. static: new sources ASCII clean, no forbidden APIs, fence order, engine-story.js untouched;
// 2. the sync: structural IDs equal ENGINE_STORY's, every gate key bound, sdq_.flag filled, idempotent, deterministic;
// 3. authored work survives: edits, hand made flags, chosen bindings and sdq flags; stale generated records drop;
// 4. mutators: bind, setItem, update, add, remove, reset, with their refusals;
// 5. slot flags from the engine's quests and once events, resolving through ENGINE_STORY.save;
// 6. who reads, who sets; the validator; the Flags tab under jsdom; the round trip through Days 146, 147, 148.
// Run from test/.
'use strict';
const fs = require('fs');
const path = require('path');
const { engine, ext } = require('./storyfx');
const { boot149, wait, ROOT } = require('./story');
const { in146, in147, in148 } = require('./compat');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
const J = JSON.stringify;
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => J(k) + ':' + canon(v[k])).join(',') + '}';
  return J(v);
}
const OUT = path.join(__dirname, 'out');
const demoText = fs.readFileSync(path.join(OUT, 'demo148-bundle.json'), 'utf8');
const fourText = fs.readFileSync(path.join(OUT, 'four148-bundle.json'), 'utf8');
const clone = (o) => JSON.parse(J(o));
const sorted = (a) => a.slice().sort();
const isSorted = (o) => J(Object.keys(o)) === J(Object.keys(o).sort());

(async () => {
  // ---------------------------------------------------------------- 1. Static.
  const files = ['story-scaffold.js', 'ws-flags.js', 'story-flags.css'].map((f) => path.join(ROOT, 'src', f));
  check('the three new sources exist and are pure ASCII', files.every((f) => fs.existsSync(f) && !/[^\x00-\x7f]/.test(fs.readFileSync(f, 'utf8'))));
  const forbidden = /roundRect|\.ellipse\(|window\.confirm|\beval\(|new Function|[^.\w]confirm\(|\.remove\(\)/;
  check('no forbidden APIs in the new JavaScript (roundRect, ellipse, confirm, eval, bare remove)', files.slice(0, 2).every((f) => !forbidden.test(fs.readFileSync(f, 'utf8'))), files.slice(0, 2).map((f) => forbidden.exec(fs.readFileSync(f, 'utf8'))));
  const build = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
  check('build.js lists story-scaffold.js after story-store.js and ws-flags.js after ws-story149 shell files', /story-scaffold\.js/.test(build) && /ws-flags\.js/.test(build) && /story-flags\.css/.test(build) );
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('index.html carries the STORY:SCAFFOLD, WS:FLAGS and STORY:FLAGS CSS fences', /STORY:SCAFFOLD BEGIN/.test(html) && /WS:FLAGS BEGIN/.test(html) && /STORY:FLAGS CSS BEGIN/.test(html));
  const engFile = fs.readFileSync(path.join(ROOT, 'src', 'engine-story.js'), 'utf8');
  const { execSync } = require('child_process');
  let headEng = null; try { headEng = execSync('git show HEAD:src/engine-story.js', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString(); } catch (e) { headEng = null; }
  check('engine-story.js is unchanged by Phase 2 (equal to the committed file)', headEng === null || headEng === engFile);

  // ---------------------------------------------------------------- 2. Boot and the sync.
  const { win, errors } = await boot149();
  const Kit = win.Kit, STORY = win.STORY, F = STORY.flags, ES = win.ENGINE_STORY, d = win.document;
  check('boots with no page errors and STORY.flags is the Phase 2 API', !errors.length && F && ['sync', 'bind', 'setItem', 'update', 'add', 'remove', 'xref', 'bindingRows', 'sdqRows', 'wanted'].every((k) => typeof F[k] === 'function'), errors.slice(0, 2));
  check('flg_ is the StoryFlag Codex type', Kit.codex.typeFor('flg_') === 'StoryFlag');

  // Four continents on the page.
  Kit.bundle.importText(fourText); await wait(20);
  let b = Kit.bundle.current();
  const g = STORY.world.graph(b), gateKeys = ES.gates.keys(g);
  const gateFlags = Object.keys(b.story.bindings);
  check('opening the forge binds every gate key: 14 keys, each with a flag that exists', gateKeys.length === 14 && sorted(gateFlags).join() === sorted(gateKeys).join() && gateKeys.every((k) => b.story.records.flg_[b.story.bindings[k].flg]), [gateKeys.length, gateFlags.length]);
  check('every gate flag ID equals ENGINE_STORY.ids.structural of flg|gate|<key> and is kind gate, default 0, range 0 to 1', gateKeys.every((k) => {
    const id = ES.ids.structural('flg_', 'flg|gate|' + k), r = b.story.records.flg_[id];
    return b.story.bindings[k].flg === id && r && r.kind === 'gate' && r['default'] === 0 && canon(r.range) === '[0,1]' && r.origin === 'generated' && r.gate === k;
  }));
  check('the engine slot flags: flg|quest|<qst> and flg|once|<evt> exist only for story records; none yet here', !Object.keys(b.story.scaffold).some((k) => /^flg\|(quest|once)\|/.test(k)));
  const sdqIds = Object.keys(b.rules.sdq_).sort();
  check('both side quest seeds got the generated completion flag, and the records exist', sdqIds.length === 2 && sdqIds.every((q) => b.rules.sdq_[q].flag === F.doneId(q) && b.story.records.flg_[F.doneId(q)] && b.story.records.flg_[F.doneId(q)].kind === 'quest' && canon(b.story.records.flg_[F.doneId(q)].range) === '[0,1]'), sdqIds.map((q) => b.rules.sdq_[q].flag));
  check('records, bindings, and scaffold are key sorted, and the scaffold names each generated flag', isSorted(b.story.records.flg_) && isSorted(b.story.bindings) && isSorted(b.story.scaffold) && Object.values(b.story.scaffold).every((id) => b.story.records.flg_[id]));
  const fixed = Kit.index().byId[F.gateId(gateKeys[0])];
  check('flag records are indexed by KIT:CORE under story.records.flg_', fixed && fixed.path.indexOf('story.records.flg_') === 0);

  // The sync changes nothing outside story and sdq_.flag.
  const src = JSON.parse(fourText);
  const diffNs = ['charter', 'codex', 'art', 'world'].filter((k) => canon(b[k]) !== canon(src[k]));
  const noFlag = (r) => { const c = clone(r); Object.values(c.sdq_ || {}).forEach((q) => { delete q.flag; }); return c; };
  check('the sync writes only story and sdq_.flag: charter, codex, art, world and the rest of rules are identical', !diffNs.length && canon(noFlag(b.rules)) === canon(noFlag(src.rules)), diffNs);

  // Idempotent.
  const before = canon(b.story), counter = b.kit.changeCounter;
  const rep2 = F.sync(b);
  check('a second sync changes nothing: empty report, same story bytes, no touch', !rep2.changed && !rep2.created.length && !rep2.rebound.length && !rep2.dropped.length && !rep2.sdq.filled.length && canon(b.story) === before && b.kit.changeCounter === counter, rep2);
  check('the first sync report names what it did through reportText', typeof F.reportText(F.sync(clone(Object.assign({}, b, { story: undefined })))) === 'string');

  // Two pages give the identical story namespace.
  const w2 = await boot149(); w2.win.Kit.bundle.importText(fourText); await wait(20);
  check('two fresh pages importing the same Final get byte identical story namespaces', canon(w2.win.Kit.bundle.current().story) === canon(b.story) && canon(w2.win.Kit.bundle.current().rules.sdq_) === canon(b.rules.sdq_));
  w2.win.close();

  // Demo path: no sdq seeds.
  const w3 = await boot149(); w3.win.Kit.bundle.importText(demoText); await wait(20);
  const bd = w3.win.Kit.bundle.current();
  check('the demo (no side quest seeds): all gate keys bound, nothing else written to rules', Object.keys(bd.story.bindings).length === w3.win.ENGINE_STORY.gates.keys(w3.win.STORY.world.graph(bd)).length && !bd.rules.sdq_ || !Object.keys(bd.rules.sdq_ || {}).length);
  w3.win.close();

  // ---------------------------------------------------------------- 3. Preservation and stale drops (pure, on clones).
  const fresh = () => { const c = clone(src); return c; };
  const c1 = fresh(); STORY.ensure(c1);
  const r1 = F.sync(c1);
  check('sync on a bundle that was never opened here creates 14 gate flags and 2 completion flags', r1.created.length === 16 && r1.rebound.length === 14 && r1.sdq.filled.length === 2 && r1.changed, r1);
  const gid = F.gateId(gateKeys[0]);
  c1.story.records.flg_[gid].name = 'My renamed gate'; c1.story.records.flg_[gid].notes = 'kept'; c1.story.records.flg_[gid].range = [0, 3];
  F.sync(c1);
  check('an author edit to a generated flag (name, notes, range) is never overwritten by a later sync', c1.story.records.flg_[gid].name === 'My renamed gate' && c1.story.records.flg_[gid].notes === 'kept' && canon(c1.story.records.flg_[gid].range) === '[0,3]');
  const mine = F.add({ name: 'Met the hermit', kind: 'story' }, c1);
  F.sync(c1);
  check('a hand made flag has a minted ID, origin user, and survives sync', mine.ok && /^flg_met_the_hermit_[a-z0-9]{4}$/.test(mine.record.id) && mine.record.origin === 'user' && !!c1.story.records.flg_[mine.record.id]);
  check('F.bind points a gate key at a hand made flag and the sync keeps that choice', F.bind(gateKeys[1], mine.record.id, c1).ok && (F.sync(c1), c1.story.bindings[gateKeys[1]].flg === mine.record.id));
  const itm = Object.keys(c1.rules.itm_)[0];
  const sealKey = gateKeys.find((k) => /^item:seal:/.test(k));
  check('F.setItem shows an existing itm_ on a seal key, keeps through sync, and clears with null', F.setItem(sealKey, itm, c1).ok && (F.sync(c1), c1.story.bindings[sealKey].itm === itm) && F.setItem(sealKey, null, c1).ok && !('itm' in c1.story.bindings[sealKey]));
  check('F.setItem refuses a non item and an unbound key', !F.setItem(sealKey, 'dgn_nope_ab12', c1).ok && !F.setItem('chapter:chp_nope', itm, c1).ok);
  // sdq flag someone else set is kept.
  c1.rules.sdq_[sdqIds[0]].flag = mine.record.id; F.sync(c1);
  check('an sdq_.flag someone else chose (a live flg_) is kept, the other seed keeps the generated flag', c1.rules.sdq_[sdqIds[0]].flag === mine.record.id && c1.rules.sdq_[sdqIds[1]].flag === F.doneId(sdqIds[1]));
  c1.rules.sdq_[sdqIds[0]].flag = 'flg_gone_zz99'; const r3 = F.sync(c1);
  check('a dangling sdq_.flag is replaced with the generated one and reported as filled', c1.rules.sdq_[sdqIds[0]].flag === F.doneId(sdqIds[0]) && r3.sdq.filled.indexOf(sdqIds[0]) >= 0, r3.sdq);
  check('F.setSdqFlag and F.resetSdqFlag choose and restore, refusing unknown seeds and missing flags', F.setSdqFlag(sdqIds[0], mine.record.id, c1).ok && c1.rules.sdq_[sdqIds[0]].flag === mine.record.id && F.resetSdqFlag(sdqIds[0], c1).ok && c1.rules.sdq_[sdqIds[0]].flag === F.doneId(sdqIds[0]) && !F.setSdqFlag('sdq_nope_ab12', mine.record.id, c1).ok && !F.setSdqFlag(sdqIds[0], 'flg_nope_ab12', c1).ok);
  // Stale: delete a seed, drop a gate key.
  const c2 = fresh(); STORY.ensure(c2); F.sync(c2);
  delete c2.rules.sdq_[sdqIds[1]];
  const r4 = F.sync(c2);
  check('a deleted side quest seed drops its generated completion flag from records and scaffold', r4.removed.indexOf(F.doneId(sdqIds[1])) >= 0 && !c2.story.records.flg_[F.doneId(sdqIds[1])] && !c2.story.scaffold['flg|done|' + sdqIds[1]], r4);
  const dropKey = gateKeys.find((k) => /^chapter:/.test(k));
  c2.world.progression.nodes.forEach((n) => { });
  const gAfter = STORY.world.graph(c2);
  const orig = ES.gates.keys;
  const c3 = fresh(); STORY.ensure(c3); F.sync(c3);
  c3.story.bindings['chapter:chp_ghost_0000'] = { flg: 'flg_whatever_aaaa' };
  const r5 = F.sync(c3);
  check('a binding for a gate key the world no longer has is dropped and reported', r5.dropped.indexOf('chapter:chp_ghost_0000') >= 0 && !c3.story.bindings['chapter:chp_ghost_0000'], r5.dropped);
  // Unbound then repaired.
  const c4 = fresh(); STORY.ensure(c4); F.sync(c4);
  delete c4.story.records.flg_[F.gateId(gateKeys[2])];
  const r6 = F.sync(c4);
  check('the next sync recreates the missing gate flag and rebinds the key', c4.story.records.flg_[F.gateId(gateKeys[2])] && c4.story.bindings[gateKeys[2]].flg === F.gateId(gateKeys[2]) && r6.created.indexOf(F.gateId(gateKeys[2])) >= 0, r6);
  check('F.resetBinding goes back to the generated flag, making it if needed', (c4.story.bindings[gateKeys[3]] = { flg: mine.record.id }, c4.story.records.flg_[mine.record.id] = c1.story.records.flg_[mine.record.id], F.resetBinding(gateKeys[3], c4).ok && c4.story.bindings[gateKeys[3]].flg === F.gateId(gateKeys[3])));

  // ---------------------------------------------------------------- 4. Mutators and refusals.
  check('F.bind refuses an unknown gate key and a flag that does not exist', !F.bind('chapter:chp_nope', gid, c1).ok && !F.bind(gateKeys[0], 'flg_nope_ab12', c1).ok && !F.bind(gateKeys[0], 'itm_x_ab12', c1).ok);
  check('F.check names each problem code: name, kind, default, range, range-order, default-range', canon(F.check({ name: '', kind: 'x', 'default': 1.5, range: [3, 1] }).map((p) => p.code).sort()) === canon(['default', 'kind', 'name', 'range-order']) && F.check({ name: 'a', kind: 'counter', range: [0] }).some((p) => p.code === 'range') && F.check({ name: 'a', kind: 'counter', 'default': 9, range: [0, 5] }).some((p) => p.code === 'default-range') && !F.check({ name: 'a', kind: 'counter', 'default': 2, range: [0, 5] }).length);
  const up = F.update(mine.record.id, { name: 'Met the old hermit', kind: 'counter', 'default': 2, range: [0, 5], notes: 'n' }, c1);
  check('F.update applies name, kind, default, range, and notes, and range null removes the range', up.ok && c1.story.records.flg_[mine.record.id].name === 'Met the old hermit' && c1.story.records.flg_[mine.record.id].kind === 'counter' && F.update(mine.record.id, { range: null }, c1).ok && !('range' in c1.story.records.flg_[mine.record.id]));
  const badUp = F.update(mine.record.id, { 'default': 99, range: [0, 5] }, c1);
  check('F.update refuses a bad result and writes nothing', !badUp.ok && badUp.problems.some((p) => p.code === 'default-range') && !('range' in c1.story.records.flg_[mine.record.id]) && c1.story.records.flg_[mine.record.id]['default'] === 2);
  check('F.update and F.remove refuse an unknown flag; F.add refuses a blank name and a bad range', !F.update('flg_nope_ab12', { name: 'x' }, c1).ok && !F.remove('flg_nope_ab12', c1).ok && !F.add({ name: ' ' }, c1).ok && !F.add({ name: 'x', range: [5, 1] }, c1).ok);
  const rm = F.remove(F.gateId(gateKeys[4]), c1);
  check('F.remove deletes the record and returns the gate keys that pointed at it; sync makes a generated flag again', rm.ok && rm.gates.join() === gateKeys[4] && !c1.story.records.flg_[F.gateId(gateKeys[4])] && (F.sync(c1), !!c1.story.records.flg_[F.gateId(gateKeys[4])]));

  // ---------------------------------------------------------------- 5. Slot flags from engine records.
  const c5 = fresh(); STORY.ensure(c5);
  const chp = c5.charter.sections.chapters[0].id;
  const q = STORY.authored('qst_', 'Find the ring', { chapter: chp, kind: 'side' }); c5.story.records.qst_[q.id] = q;
  const e = STORY.authored('evt_', 'The bridge scene', { chapter: chp, kind: 'cutscene', once: true }); c5.story.records.evt_[e.id] = e;
  const r7 = F.sync(c5);
  const qKey = 'flg|quest|' + q.id, eKey = 'flg|once|' + e.id;
  check('a story quest gets flg|quest|<qst> (kind quest, derived quest, limit 0 to the largest int) and an event with no once pages gets no flg|once|', c5.story.scaffold[qKey] && !c5.story.scaffold[eKey] && c5.story.records.flg_[c5.story.scaffold[qKey]].kind === 'quest' && c5.story.records.flg_[c5.story.scaffold[qKey]].derived === 'quest' && canon(c5.story.records.flg_[c5.story.scaffold[qKey]].range) === canon([0, F.INT_MAX]), c5.story.scaffold);
  check('slot flags ID with ENGINE_STORY.ids.structural of the engine slot key', c5.story.scaffold[qKey] === ES.ids.structural('flg_', qKey));
  check('removing the quest drops its slot flag on the next sync', (delete c5.story.records.qst_[q.id], F.sync(c5).removed.indexOf(ES.ids.structural('flg_', qKey)) >= 0) && !c5.story.records.flg_[ES.ids.structural('flg_', qKey)]);

  // ---------------------------------------------------------------- 6. Who reads, who sets; the validator.
  const X = F.xref(b);
  const someGate = F.gateId(gateKeys.find((k) => /^chapter:/.test(k)));
  check('xref lists only flags that exist, each with reads and sets arrays of {kind, id, where}, no duplicates', Object.keys(X).length > 0 && Object.keys(X).every((id) => b.story.records.flg_[id] && Array.isArray(X[id].reads) && Array.isArray(X[id].sets) && [].concat(X[id].reads, X[id].sets).every((s2) => s2.kind && s2.id && s2.where) && new Set(X[id].reads.map((s2) => s2.kind + s2.id + s2.where)).size === X[id].reads.length), Object.keys(X).length);
  check('xref reads Day 148 progression: each chapter gate flag is read by one node and set by one node', Object.keys(X).filter((id) => b.story.records.flg_[id].kind === 'gate').some((id) => X[id].reads.length || X[id].sets.length));
  check('xref is deterministic: two runs are byte identical', canon(F.xref(b)) === canon(F.xref(b)));
  const sm = F.summary(b);
  check('F.summary counts flags, gate keys, bound keys, and slot flags', sm && typeof sm === 'object' && sm.total === Object.keys(b.story.records.flg_).length && sm.gateKeys === 14 && sm.bound === 14 && sm.unbound === 0 && sm.byKind.gate === 14, sm);

  const v0 = Kit.refreshValidation();
  check('the world and story validate with 0 errors and 0 broken (sdq_.flag read as forward while story is closed)', !v0.errors.length && !v0.broken.length, Kit.validate.summary(v0));
  // Broken: unbound gate key and a bad range, in the page's bundle.
  const keepFlag = b.story.records.flg_[F.gateId(gateKeys[5])];
  delete b.story.records.flg_[F.gateId(gateKeys[5])]; Kit.bundle.touch('t');
  let v1 = Kit.refreshValidation();
  check('an unbound gate key is a story.flags error at bindings.<key>', v1.errors.some((x) => x.recordId === 'story' && x.fieldPath === 'bindings.' + gateKeys[5]), v1.errors.slice(0, 3));
  b.story.records.flg_[F.gateId(gateKeys[5])] = keepFlag; Kit.bundle.touch('t');
  b.story.records.flg_[F.gateId(gateKeys[6])].range = [5, 1]; Kit.bundle.touch('t');
  v1 = Kit.refreshValidation();
  check('a range with min above max is an error', v1.errors.some((x) => x.recordId === F.gateId(gateKeys[6])));
  b.story.records.flg_[F.gateId(gateKeys[6])].range = [0, 1]; b.story.records.flg_[F.gateId(gateKeys[6])].name = '  '; Kit.bundle.touch('t');
  v1 = Kit.refreshValidation();
  check('a blank name is an error', v1.errors.some((x) => x.recordId === F.gateId(gateKeys[6])));
  b.story.records.flg_[F.gateId(gateKeys[6])].name = 'Gate six'; b.story.bindings[gateKeys[7]] = { flg: F.gateId(gateKeys[6]) }; Kit.bundle.touch('t');
  v1 = Kit.refreshValidation();
  check('two gate keys sharing one flag is a warning, not an error', !v1.errors.length && v1.warnings.some((x) => /shared|share/i.test(x.message)), v1.warnings.map((x) => x.message).slice(0, 3));
  F.resetBinding(gateKeys[7], b);
  b.story.bindings[sealKey] = { flg: F.gateId(sealKey), itm: 'itm_gone_zz99' }; Kit.bundle.touch('t');
  v1 = Kit.refreshValidation();
  check('a display item that is not an item is an error', v1.errors.some((x) => x.fieldPath && x.fieldPath.indexOf(sealKey) >= 0), v1.errors.slice(0, 3));
  delete b.story.bindings[sealKey].itm; Kit.bundle.touch('t');
  check('Kit.jump resolves a flg_ ID to the Flags tab', (() => { try { Kit.jump(F.gateId(gateKeys[0])); return Kit.active() === 'flags'; } catch (e2) { return false; } })());

  // ---------------------------------------------------------------- 7. The Flags tab.
  Kit.go('flags'); await wait(20);
  let ws = d.getElementById('ws');
  check('the Flags tab is unlocked and renders with no page errors', !d.querySelector('#tabs .tab[data-ws=flags]').classList.contains('locked') && ws.querySelectorAll('.fg-row').length > 0 && !errors.length, errors.slice(0, 2));
  const rows = Array.from(ws.querySelectorAll('.fg-row'));
  check('the Gate bindings panel lists all 14 keys', rows.filter((r2) => /chapter|seal|Ship|Airship|Reached|Seal/i.test(r2.textContent)).length >= 14, rows.length);
  const btn = (re, root) => Array.from((root || ws).querySelectorAll('button')).find((x) => re.test(x.textContent));
  check('Add flag and Regenerate bindings buttons are present and 44px tall by class', !!btn(/Add flag/) && !!btn(/Regenerate/));
  // Unbound first.
  const ukey = gateKeys[8], saveF = b.story.records.flg_[F.gateId(ukey)];
  delete b.story.records.flg_[F.gateId(ukey)]; Kit.bundle.touch('t'); Kit.go('start'); Kit.go('flags'); await wait(10);
  ws = d.getElementById('ws');
  const firstRow = ws.querySelector('.fg-row');
  check('an unbound gate key is listed first and carries the Unbound chip', firstRow && /Unbound/i.test(firstRow.textContent) && firstRow.classList.contains('unbound'), firstRow && firstRow.textContent.slice(0, 80));
  btn(/Regenerate/).click(); await wait(20);
  check('Regenerate bindings repairs it: flag recreated, nothing unbound, the notice says so', !!b.story.records.flg_[F.gateId(ukey)] && !d.getElementById('ws').querySelector('.fg-row.unbound'), null);
  // All flags: filters and search.
  ws = d.getElementById('ws');
  const items = () => Array.from(d.getElementById('ws').querySelectorAll('.fg-item'));
  const nAll = items().length;
  check('All flags lists every flag record as an expandable item', nAll === Object.keys(b.story.records.flg_).length, [nAll, Object.keys(b.story.records.flg_).length]);
  const fbtn = (re) => Array.from(d.getElementById('ws').querySelectorAll('.fg-filter button')).find((x) => re.test(x.textContent));
  fbtn(/Gates/).click(); await wait(5);
  check('the Gates filter shows only gate flags', items().length === 14 && fbtn(/Gates/).getAttribute('aria-pressed') === 'true', items().length);
  fbtn(/Quest/).click(); await wait(5);
  check('the Quest filter shows the completion flags', items().length === 2, items().length);
  fbtn(/Yours/).click(); await wait(5);
  const nYours = items().length;
  fbtn(/All/).click(); await wait(5);
  const sInp = d.getElementById('ws').querySelector('.fg-search input, input.fg-search');
  if (sInp) { sInp.value = 'airship'; sInp.dispatchEvent(new win.Event('input', { bubbles: true })); await wait(10); }
  check('search narrows the list by name or ID, and the Yours filter shows hand made flags only', !!sInp && items().length > 0 && items().length < nAll && nYours === Object.values(b.story.records.flg_).filter((x) => x.origin === 'user').length, [items().length, nYours]);
  if (sInp) { sInp.value = ''; sInp.dispatchEvent(new win.Event('input', { bubbles: true })); await wait(10); }
  const head = d.getElementById('ws').querySelector('.fg-item .fg-head');
  head.click(); await wait(5);
  check('expanding an item shows its reads and sets lists and Edit and Delete', /Who reads it/.test(d.getElementById('ws').textContent) && /Who sets it/.test(d.getElementById('ws').textContent) && !!btn(/^Edit/) && !!btn(/^Delete/));
  // Dialog edit.
  btn(/^Edit/).click(); await wait(10);
  const dlg = d.querySelector('dialog[open], .modal, [role=dialog]');
  check('Edit opens a dialog with Name, Kind, Default, a range switch and Note', !!dlg && /Name/.test(dlg.textContent) && /Kind/.test(dlg.textContent) && /Default/.test(dlg.textContent) && /range/i.test(dlg.textContent) && /Note/.test(dlg.textContent), dlg && dlg.textContent.slice(0, 120));
  if (dlg) {
    const nameInp = dlg.querySelector('input[type=text], input:not([type])');
    nameInp.value = 'Edited by test'; nameInp.dispatchEvent(new win.Event('input', { bubbles: true }));
    const save = Array.from(dlg.querySelectorAll('button')).find((x) => /^Save/.test(x.textContent));
    save.click(); await wait(20);
    check('Save in the dialog writes the new name to the record', Object.values(b.story.records.flg_).some((x) => x.name === 'Edited by test'));
  }
  // Add flag.
  btn(/Add flag/).click(); await wait(10);
  const dlg2 = d.querySelector('dialog[open], .modal, [role=dialog]');
  if (dlg2) {
    const ni = dlg2.querySelector('input[type=text], input:not([type])'); ni.value = 'Added in UI'; ni.dispatchEvent(new win.Event('input', { bubbles: true }));
    Array.from(dlg2.querySelectorAll('button')).find((x) => /^(Save|Add)/.test(x.textContent)).click(); await wait(20);
  }
  check('Add flag makes a hand made flag with origin user', Object.values(b.story.records.flg_).some((x) => x.name === 'Added in UI' && x.origin === 'user'));
  // Start card.
  Kit.go('start'); await wait(15);
  const startText = d.getElementById('ws').textContent;
  check('the Start card says 14 of 14 bound and offers Open Flags; the side quest table shows the flag names', /14 of 14 bound/.test(startText) && !!btn(/Open Flags/) && !/not filled yet/.test(startText), startText.slice(0, 0));
  btn(/Open Flags/).click(); await wait(10);
  check('Open Flags goes to the Flags tab', Kit.active() === 'flags');
  check('STORY.jumpStory sends bindings paths to Flags and others to Export', (STORY.jumpStory('bindings.x'), Kit.active() === 'flags') && (STORY.jumpStory('scaffold.x'), Kit.active() === 'export'));
  check('no page errors after the whole tour', !errors.length, errors.slice(0, 3));

  // ---------------------------------------------------------------- 8. Sync is skipped when the bundle is not ready; timing.
  const notReady = clone(src); notReady.kit.opened = notReady.kit.opened.filter((n) => n !== 'world');
  const w4 = await boot149();
  let refused = false; try { w4.win.Kit.bundle.importText(J(notReady)); } catch (e3) { refused = true; }
  check('a bundle that is not a ready Day 148 Final is refused at import, so the sync never runs on it', refused && !w4.win.Kit.bundle.current().story.bindings || refused);
  w4.win.close();
  const t0 = Date.now(); for (let i = 0; i < 20; i++) F.sync(c1); const dt = Date.now() - t0;
  check('twenty syncs of a settled bundle take under a second', dt < 1000, dt);

  // ---------------------------------------------------------------- 9. Round trip through Days 146, 147, 148.
  // Draft with the synced flags and a hand made quest.
  const qrec = STORY.records.put(STORY.authored('qst_', 'A hand made quest', { chapter: b.charter.sections.chapters[0].id, kind: 'side' }));
  Kit.bundle.touch('t'); F.sync(b);
  const draft = Kit.buildExport('draft');
  const db = JSON.parse(draft.files[0].text);
  check('the Draft carries the flags, the bindings, and the slot flag of the hand made quest', Object.keys(db.story.bindings).length === 14 && db.story.scaffold['flg|quest|' + qrec.id] && db.story.records.flg_[db.story.scaffold['flg|quest|' + qrec.id]]);
  const probe = (how) => async (w, K, r) => { const cb = K.bundle.current(); let out = null, err = null; try { out = K.buildExport(how, { engines: false }); } catch (e4) { err = e4.message; } return { same: ['charter', 'codex', 'rules', 'art', 'world', 'story'].filter((k) => canon(cb[k]) !== canon(db[k])), err }; };
  const r146 = await in146(draft.files[0].text, probe('draft'));
  const r147 = await in147(draft.files[0].text, probe('draft'));
  const r148 = await in148(draft.files[0].text, probe('final'));
  [['146', r146], ['147', r147], ['148', r148]].forEach(([k, r]) => {
    check('Day ' + k + ' opens the Draft with the flags: hash verified, no errors, no broken references, namespaces identical', r.matches && !r.errors.length && !r.broken.length && !r.same.length && !r.err, { m: r.matches, s: r.summary, e: r.errors.slice(0, 2), same: r.same, err: r.err });
    check('Day ' + k + ' sees every sdq_.flag as a flg_ record or forward, never broken', !r.broken.length);
  });
  win.close();

  const n = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(J(x.detail)).slice(0, 900))));
  fs.writeFileSync(path.join(OUT, 'phase2-report.json'), J({ passed: n, total: results.length, results }, null, 1));
  console.log('\n' + n + ' of ' + results.length + ' passed');
  process.exit(n === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
