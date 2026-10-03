// Phase 0 acceptance: scaffold, import gate, export, fixtures. Boots Story Forge and checks the static contract (fences,
// verbatim KIT:CORE, the three vendored engines, the ENGINE:STORY base), the story skeleton and Codex types, the import
// gate (no Day 148 Final, world not opened, a world that does not validate cleanly), records and the envelope, the Draft
// export and its manifest, Final refused until Phase 7, the open policy with the sdq_.flag forward field, the round trip
// (a Story Draft reopens in Days 146, 147, and 148 with every prior namespace canonically identical and no new errors,
// and comes back), own storage keys with the IndexedDB fallback and the Day 148 draft offer, and the fixtures.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { boot149, ROOT, wait } = require('./story');
const { in146, in147, in148, stamp, DIR147, DIR148 } = require('./compat');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const PRIOR = ['charter', 'codex', 'rules', 'art', 'world'];
function sameNs(a, b, keys) { return (keys || PRIOR).filter((k) => canon(a[k]) !== canon(b[k])); }
const OUT = path.join(__dirname, 'out');
const demoText = fs.readFileSync(path.join(OUT, 'demo148-bundle.json'), 'utf8');
const fourText = fs.readFileSync(path.join(OUT, 'four148-bundle.json'), 'utf8');
const cut = (t, a, z) => t.slice(t.indexOf(a), t.indexOf(z) + z.length);

(async () => {
  // ---------------------------------------------------------------- 0. Static contract.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const nonAscii = []; html.split('\n').forEach((l, i) => { if (/[^\x00-\x7e]/.test(l)) nonAscii.push(i + 1); });
  check('index.html is pure ASCII', !nonAscii.length, nonAscii.slice(0, 5));
  const s0 = html.lastIndexOf('<script>'), script = html.slice(s0 + 8, html.lastIndexOf('</script>'));
  let syntaxOk = true; try { new Function(script); } catch (e) { syntaxOk = e.message; }
  check('inline script parses', syntaxOk === true, syntaxOk);
  const fences = ['KIT:CORE', 'ENGINE:STORY', 'STORY:STORE', 'STORY:DEMO', 'WS:STORY149', 'APP:BOOT'];
  const at = fences.map((f) => script.indexOf('// === ' + f + ' BEGIN ==='));
  check('script fences in order: KIT:CORE, ENGINE:STORY, STORY:STORE, STORY:DEMO, WS:STORY149, APP:BOOT', at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), at);
  check('every fence opens and closes exactly once', fences.every((f) => script.split('// === ' + f + ' BEGIN ===').length === 2 && script.split('// === ' + f + ' END ===').length === 2));
  check('CSS fences KIT:CORE CSS then STORY:SHELL CSS', html.indexOf('/* === KIT:CORE CSS BEGIN === */') >= 0 && html.indexOf('/* === STORY:SHELL CSS BEGIN === */') > html.indexOf('/* === KIT:CORE CSS END === */'));
  const k146 = fs.readFileSync(require('../day146'), 'utf8');
  check('KIT:CORE JS and CSS byte for byte equal to Day 146', cut(html, '// === KIT:CORE BEGIN ===', '// === KIT:CORE END ===') === cut(k146, '// === KIT:CORE BEGIN ===', '// === KIT:CORE END ===') &&
    cut(html, '/* === KIT:CORE CSS BEGIN === */', '/* === KIT:CORE CSS END === */') === cut(k146, '/* === KIT:CORE CSS BEGIN === */', '/* === KIT:CORE CSS END === */'));
  const rd = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');
  const vend = ['engine-render.js', 'engine-audio.js'].map((f) => rd(ROOT, f) === rd(DIR147, f) && rd(ROOT, f) === rd(DIR148, f));
  check('vendored engine-render.js and engine-audio.js byte equal to Day 147 and to Day 148\'s copies', vend.every(Boolean), vend);
  const noHash = (s) => s.replace(/^\/\* Bundle hash [0-9a-f]+ \*\/\n/m, '');
  check('vendored engine-world.js byte equal to Day 148\'s root file (bundle hash line aside)', noHash(rd(ROOT, 'engine-world.js')) === noHash(rd(DIR148, 'engine-world.js')) && rd(ROOT, 'engine-world.js').indexOf('Bundle hash') < 0);
  check('page loads the three engines by relative script tags, render, audio, world, before the inline script', /<script src="engine-render\.js"><\/script>\s*<script src="engine-audio\.js"><\/script>\s*<script src="engine-world\.js"><\/script>\s*<script>/.test(html));
  check('backlink appears in header and footer', html.split('href="https://augustineiacopelli.github.io/appaday/"').length === 3);
  check('no forbidden APIs (roundRect, ellipse, confirm, bare remove)', !/\.roundRect\(|\.ellipse\(|window\.confirm|\bconfirm\(\s*['"]|[^a-zA-Z.]remove\(\)|\)\.remove\(\)/.test(script.replace(/\/\/.*$/gm, '')));
  const engFile = rd(ROOT, 'engine-story.js');
  const engFence = cut(script, '// === ENGINE:STORY BEGIN ===', '// === ENGINE:STORY END ===') + '\n';
  check('engine-story.js is the ENGINE:STORY fence byte for byte under its header', engFile.endsWith(engFence) && /^\/\* Story Forge ENGINE:STORY, engine version 1\.0\.0\n/.test(engFile));
  // Determinism and isolation rules for the fence (comments stripped first).
  const code = engFence.replace(/\/\/.*$/gm, '');
  const banned = { 'Math.random': /Math\.random/, 'Date': /\bDate\b/, 'performance': /\bperformance\b/, 'eval': /\beval\s*\(/, 'new Function': /new\s+Function/, 'for in': /for\s*\(\s*(var\s+)?\w+\s+in\b/, 'window': /\bwindow\b/, 'document': /\bdocument\b/, 'Kit': /\bKit\b/, 'ENGINE_WORLD': /ENGINE_WORLD/, 'localStorage': /localStorage/ };
  const hits = Object.keys(banned).filter((k) => banned[k].test(code));
  const ok = code.split('Object.keys(').length - 1;
  check('ENGINE:STORY uses no Math.random, Date, performance, eval, new Function, for in, or host global, and Object.keys only inside util.keys, which sorts', !hits.length && ok === 1 && /function keys\(o\) \{ return o && typeof o === 'object' \? Object\.keys\(o\)\.sort\(\)/.test(code), { hits, objectKeys: ok });
  const boxA = vm.createContext({}), boxB = vm.createContext({}); let vmErr = null;
  try { vm.runInContext(engFile, boxA); vm.runInContext(engFile, boxB); } catch (e) { vmErr = e.message; }
  const ES = boxA.ENGINE_STORY;
  check('engine-story.js loads alone in a bare context and declares one deep frozen global', !vmErr && Object.keys(boxA).join() === 'ENGINE_STORY' && Object.isFrozen(ES) && Object.isFrozen(ES.ids) && Object.isFrozen(ES.ids.PREFIXES) && ES.version === '1.0.0', vmErr || Object.keys(boxA));
  // Structural IDs: the same hash as ENGINE_WORLD, valid KIT IDs, story prefixes only, identical in two contexts.
  const wbox = vm.createContext({}); vm.runInContext(rd(ROOT, 'engine-render.js'), wbox); vm.runInContext(rd(ROOT, 'engine-world.js'), wbox);
  const EW = wbox.ENGINE_WORLD, keys1500 = [];
  for (let i = 0; i < 1500; i++) keys1500.push(['flg|gate|chapter:chp_x' + i, 'qst|main|chp_' + (i * 7919 % 10007), 'dlg|npc_' + i + '|offer', 'evt|boss|dgn_' + i, 'end|' + i + '|Delivered ' + i][i % 5]);
  check('ENGINE_STORY.hash.str and ids.slug equal ENGINE_WORLD\'s on 1500 keys', keys1500.every((k) => ES.hash.str(k) === EW.hash.str(k) && ES.ids.slug(k) === EW.ids.slug(k)));
  const idsA = keys1500.map((k, i) => ES.ids.structural(['flg_', 'qst_', 'dlg_', 'evt_', 'end_'][i % 5], k)), idsB = keys1500.map((k, i) => boxB.ENGINE_STORY.ids.structural(['flg', 'qst', 'dlg', 'evt', 'end'][i % 5], k));
  const ID_RE = /^[a-z]{3}_[a-z0-9_]*[a-z0-9]$/;
  check('structural IDs: valid KIT IDs, no collisions in 1500 keys, the same in two contexts, with or without the underscore', idsA.every((x) => ID_RE.test(x)) && new Set(idsA).size === 1500 && canon(idsA) === canon(idsB));
  let refused = 0; ['dgn_', 'chr_', 'map'].forEach((p) => { try { ES.ids.structural(p, 'x'); } catch (e) { refused++; } });
  check('ids.structural refuses world and rules prefixes', refused === 3 && /^flg_flg_gate_vehicle_ship_[a-z0-9]{4}$/.test(ES.ids.structural('flg', 'flg|gate|vehicle:ship')), ES.ids.structural('flg', 'flg|gate|vehicle:ship'));
  const G = (t) => JSON.parse(t).world.progression;
  const kinds = (g) => { const c = {}; ES.gates.keys(g).forEach((k) => { const p = ES.gates.parse(k); c[p.kind] = (c[p.kind] || 0) + 1; }); return c; };
  const kFour = kinds(G(fourText)), kDemo = kinds(G(demoText)), vDemo = G(demoText).vehicles;
  check('gates.keys and parse read Day 148\'s graph: four has 6 chapter keys, 6 seals, ship, airship, nothing unknown', canon(kFour) === canon({ airship: 1, chapter: 6, seal: 6, ship: 1 }), kFour);
  check('the demo graph: 2 chapter keys, 2 seals, the vehicles its graph names', kDemo.chapter === 2 && kDemo.seal === 2 && !kDemo.other && !!kDemo.ship === !!vDemo.ship && !!kDemo.airship === !!vDemo.airship, { kDemo, vDemo: Object.keys(vDemo).filter((k) => vDemo[k]) });
  check('gates.parse names the chapter of chapter and seal keys and returns other for anything else', ES.gates.parse('item:seal:chp_a_b1').chapter === 'chp_a_b1' && ES.gates.parse('chapter:chp_q_z9').kind === 'chapter' && ES.gates.parse('item:key:dgn|x').kind === 'other');

  // ---------------------------------------------------------------- 1. Boot.
  let { win, errors } = await boot149();
  let Kit = win.Kit, STORY = win.STORY, d = win.document;
  check('boots with no page errors', !errors.length, errors.slice(0, 2));
  check('ENGINE_RENDER, ENGINE_AUDIO, ENGINE_WORLD from the vendored files and ENGINE_STORY from the fence', win.ENGINE_RENDER && win.ENGINE_AUDIO && win.ENGINE_WORLD && win.ENGINE_WORLD.version === '1.0.0' && win.ENGINE_STORY && win.ENGINE_STORY.version === '1.0.0');
  const tabs = Array.from(d.querySelectorAll('#tabs .tab')).map((t) => t.dataset.ws + (t.classList.contains('locked') ? '(locked)' : ''));
  check('six tabs and Dev: start, flags, quests, dialogue, events, export; all but start and dev locked without a world', tabs.join(' ') === 'start flags(locked) quests(locked) dialogue(locked) events(locked) export(locked) dev', tabs.join(' '));
  check('the sixth tab is Validation and Export, and the active tab is start', /Validation and Export/.test(d.querySelector('#tabs .tab[data-ws=export]').textContent) && Kit.active() === 'start');
  const fresh = Kit.bundle.current().story;
  check('a fresh bundle gets the story skeleton: records, bindings, scaffold, npcDialogue, settings, overrides', fresh.version === '1.0.0' && fresh.generator.name === 'appaday-149-story' && fresh.generator.version === '1.0.0' &&
    ['flg_', 'qst_', 'dlg_', 'evt_', 'end_'].every((p) => fresh.records[p] && !Object.keys(fresh.records[p]).length) && ['bindings', 'scaffold', 'npcDialogue', 'overrides'].every((k) => fresh[k] && typeof fresh[k] === 'object' && !Object.keys(fresh[k]).length) &&
    fresh.settings.floorMinutes === 720 && fresh.settings.walkCap === 50000 && fresh.settings.draftTier === 'sonnet', fresh);
  check('five story prefixes reserved by KIT:CORE for forge 149 in namespace story, each with a Codex type', STORY.PREFIXES.every((p) => Kit.codex.prefixInfo(p).forge === 149 && Kit.codex.prefixInfo(p).ns === 'story') &&
    canon(STORY.PREFIXES.map((p) => Kit.codex.typeFor(p))) === canon(['StoryFlag', 'StoryQuest', 'StoryDialogue', 'StoryEvent', 'StoryEnding']));
  const sid = STORY.envelope('flg_', 'flg|gate|vehicle:ship', 'Ship').id;
  check('structural IDs are valid KIT IDs from ENGINE_STORY', Kit.ids.isValid(sid) && sid === win.ENGINE_STORY.ids.structural('flg', 'flg|gate|vehicle:ship') && sid === ES.ids.structural('flg', 'flg|gate|vehicle:ship'), sid);

  // ---------------------------------------------------------------- 2. The import gate.
  const day147 = fs.readFileSync(path.join(DIR148, 'test', 'out', 'demo147-bundle.json'), 'utf8');
  const asDraft = JSON.parse(demoText); asDraft.kit.forges['148'].status = 'draft';
  const closed = JSON.parse(demoText); closed.kit.opened = closed.kit.opened.filter((n) => n !== 'world');
  const lostGiver = JSON.parse(fourText); const gq = Object.keys(lostGiver.rules.sdq_).sort()[0], gid = lostGiver.rules.sdq_[gq].giver; delete lostGiver.world.records.npc_[gid];
  const oldGen = JSON.parse(demoText); oldGen.world.generator.version = '0.9.0';
  const noSite = JSON.parse(demoText); const siteId = noSite.world.progression.nodes.find((n) => n.role === 'boss').record; delete noSite.world.records.dgn_[siteId];
  const badKey = JSON.parse(demoText); const tw = Object.keys(badKey.world.records.twn_)[0]; badKey.world.records.twn_[tw].key = 'twn|moved|elsewhere';
  const noGraph = JSON.parse(demoText); noGraph.world.progression = {};
  const gate = (b) => { try { Kit.bundle.importText(typeof b === 'string' ? b : JSON.stringify(b)); return 'accepted'; } catch (e) { return e.message; } };
  const titleBefore = Kit.bundle.current().kit.title;
  const g = { notJson: gate('{nope'), notSaga: gate({ hello: 1 }), day147: gate(day147), asDraft: gate(asDraft), closed: gate(closed), lostGiver: gate(lostGiver), oldGen: gate(oldGen), noSite: gate(noSite), badKey: gate(badKey), noGraph: gate(noGraph) };
  check('import refuses a Day 147 export and a Day 148 Draft: no Day 148 Final, with a readable reason', /no Day 148 Final export/.test(g.day147) && /no Day 148 Final export/.test(g.asDraft), [g.day147, g.asDraft]);
  check('import refuses a Final whose world namespace is not opened', /world namespace is not opened/.test(g.closed), g.closed);
  check('import refuses a world that does not validate cleanly: a missing giver, with the reason', /does not validate cleanly/.test(g.lostGiver) && /giver|Broken reference/.test(g.lostGiver), g.lostGiver);
  check('import refuses another World Forge engine version, a missing site record, a tampered structural key, and no graph', /engine 0\.9\.0/.test(g.oldGen) && /has no world record/.test(g.noSite) && /structural key/.test(g.badKey) && /no progression graph/.test(g.noGraph), [g.oldGen, g.noSite, g.badKey, g.noGraph]);
  check('import refuses non bundles and bad JSON', /not a Saga Forge bundle/.test(g.notSaga) && /not valid JSON/.test(g.notJson));
  check('a refused import leaves the draft untouched', Kit.bundle.current().kit.title === titleBefore);
  const imp = Kit.bundle.importText(demoText); await wait(20);
  let b = Kit.bundle.current();
  const src = JSON.parse(demoText);
  check('a Day 148 Final export imports with its hash verified', imp.matches === true && b.kit.title === 'Demo Saga');
  check('import leaves charter, codex, rules, art, and world canonically identical', !sameNs(b, src).length, sameNs(b, src));
  check('import fills the story skeleton and nothing else', canon(Object.keys(b).sort()) === canon(Object.keys(src).sort()) && b.story.version === '1.0.0' && STORY.count(b) === Object.keys(b.story.records.flg_).length && !Object.keys(b.story.records.qst_).length && Object.keys(b.story.bindings).length === ES.gates.keys(b.world.progression).length && Object.values(b.story.records.flg_).every((x) => x.origin === 'generated') && Object.keys(b.kit).every((k) => k === 'updatedAt' || canon(b.kit[k]) === canon(src.kit[k])), { kd: Object.keys(b.kit).filter((k) => canon(b.kit[k]) !== canon(src.kit[k])), c: STORY.count(b), f: Object.keys(b.story.records.flg_).length, q: Object.keys(b.story.records.qst_).length, bi: Object.keys(b.story.bindings).length, g: ES.gates.keys(b.world.progression).length, o: Object.values(b.story.records.flg_).map((x) => x.origin).join() });
  let res = Kit.refreshValidation();
  check('the demo validates with no errors or broken references, and the world check is clean', !res.errors.length && !res.broken.length && !STORY.worldCheck(b).length, Kit.validate.summary(res));
  check('the four continent fixture imports too', gate(fourText) === 'accepted' && Kit.bundle.current().charter.sections.chapters.length === 6);
  Kit.go('start'); await wait(20);
  let ws = d.getElementById('ws').textContent;
  check('Start: world check clean with record counts, six chapters, 13.0 hours at the floor, The Marches an empty slot', /World checkClean/.test(ws) && /reg_ 6twn_ 7dgn_ 18npc_ 87map_ 32/.test(ws) && /13\.0 hours of main story/.test(ws) && /The chapters reach the 12 hour floor/.test(ws) && /The Marches[^]*?empty slot/.test(ws) && d.querySelectorAll('.s9-wide tbody tr').length === 6, ws.slice(0, 400));
  check('Start: 14 gate keys to bind by kind, the empty boss slot named, both side quests with giver and no flag yet, one ending', /names 14 world local gate keys/.test(ws) && /Chapter keys/.test(ws) && /Seals/.test(ws) && /Ship/.test(ws) && /Airship/.test(ws) && /1 boss dungeon with an empty troop slot: The Marches/.test(ws) &&
    !/not filled yet/.test(ws) && /Completion flag/.test(ws) && /The lost ring/.test(ws) && /Delivered/.test(ws));
  check('later tabs unlock once a ready bundle is loaded', !d.querySelectorAll('#tabs .tab.locked').length);
  for (const t of ['flags', 'quests', 'dialogue', 'events']) { Kit.go(t); await wait(5); }
  check('Flags, Quests, Dialogue, Events are stubs naming their phase', Kit.active() === 'events' && /Arrives in Phase 5/.test(d.getElementById('ws').textContent));

  // ---------------------------------------------------------------- 3. Records, validation, the envelope.
  Kit.bundle.importText(demoText); await wait(10); b = Kit.bundle.current();
  const chp = b.charter.sections.chapters[0].id;
  const flg = STORY.records.put(STORY.envelope('flg_', 'flg|gate|chapter:' + chp, 'Reached ' + chp, { chapter: chp, kind: 'gate', initial: 1 }));
  const qst = STORY.records.put(STORY.authored('qst_', 'A hand made quest', { chapter: chp, kind: 'side', stages: [{ key: 'begin', label: 'Begin', sets: [] }, { key: 'done', label: 'Done', sets: [] }] }));
  Kit.bundle.touch('test');
  let idx = Kit.index();
  check('story records are indexed by KIT:CORE under story.records', idx.byId[flg.id] && idx.byId[qst.id] && idx.byId[flg.id].path.indexOf('story.records.flg_') === 0, idx.byId[flg.id] && idx.byId[flg.id].path);
  check('a scaffolded record is structural and generated; a hand made one is minted and user', flg.origin === 'generated' && flg.id === win.ENGINE_STORY.ids.structural('flg', flg.key) && qst.origin === 'user' && /^qst_a_hand_made_quest_[a-z0-9]{4}$/.test(qst.id) && qst.key === 'user|' + qst.id, [flg.id, qst.id]);
  res = Kit.refreshValidation();
  check('story records validate with the envelope types (chapter refs resolve)', !res.errors.length && !res.broken.length, Kit.validate.summary(res));
  let bad = false; try { STORY.records.put({ id: 'dgn_nope_ab12', name: 'x' }); } catch (e) { bad = true; }
  check('STORY.records.put refuses non story prefixes', bad);
  b.story.records.flg_[flg.id].key = 'flg|something|else'; Kit.bundle.touch('test');
  res = Kit.refreshValidation();
  check('a scaffolded record whose key no longer derives its ID is a warning; a user record is exempt', res.warnings.some((w) => w.recordId === flg.id && /structural key/.test(w.message)) && !res.warnings.some((w) => w.recordId === qst.id), res.warnings.map((w) => w.message));
  b.story.records.flg_[flg.id].key = 'flg|gate|chapter:' + chp; Kit.bundle.touch('test');

  // ---------------------------------------------------------------- 4. Draft export and the manifest.
  let draft = Kit.buildExport('draft');
  let db = JSON.parse(draft.files[0].text), man = JSON.parse(draft.files[1].text);
  check('Draft export: three files (bundle, story manifest, engine-story.js)', draft.files.map((f) => f.name).join(' ') === 'demo-saga-bundle.json demo-saga-story-manifest.json engine-story.js', draft.files.map((f) => f.name));
  check('Draft stamps forge 149 and leaves forges 146, 147, and 148 untouched', db.kit.forges['149'].status === 'draft' && db.kit.forges['149'].engineVersion === '1.0.0' && db.kit.forges['149'].worldGeneratorVersion === '1.0.0' && ['146', '147', '148'].every((f) => canon(db.kit.forges[f]) === canon(src.kit.forges[f])), db.kit.forges);
  check('Draft leaves story out of kit.opened', db.kit.opened.join() === 'charter,rules,art,world', db.kit.opened);
  check('manifest: forge 149, hash equals the bundle hash, created story IDs, the chapter referenced, nothing unresolved, world clean, load order',
    man.forge === 149 && man.bundleHash === db.kit.contentHash && man.created.indexOf(flg.id) >= 0 && man.created.indexOf(qst.id) >= 0 && man.created.length === STORY.count(db) && !man.unresolved.length && man.referenced.indexOf(chp) >= 0 && man.worldCheck.clean && man.world.seed === 42 &&
    canon(man.loadOrder) === canon(['engine-render.js', 'engine-audio.js', 'engine-world.js', 'engine-story.js']) && man.checks === null && man.day150 === null, man);
  const engOut = draft.files[2].text;
  check('exported engine-story.js is the page fence under a header carrying the bundle hash, the repository file plus that line', engOut.endsWith(engFence) && engOut.indexOf('/* Bundle hash ' + draft.hash + ' */\n') > 0 &&
    engOut === engFile.replace('reads no host global. */\n', 'reads no host global. */\n/* Bundle hash ' + draft.hash + ' */\n'));
  let finalErr = null; try { Kit.buildExport('final'); } catch (e) { finalErr = e.message; }
  check('Final is refused until Phase 7 proves the story, with a readable reason', /not been proven yet/.test(finalErr || '') && Kit.bundle.current().kit.opened.indexOf('story') < 0, finalErr);
  Kit.go('export'); await wait(20); ws = d.getElementById('ws').textContent;
  check('the Validation and Export tab: counts, world clean, the Final block, Draft and Final cards, manifest preview, size', /0 errors/.test(ws) && /World clean/.test(ws) && /not been proven yet/.test(ws) && /Created\d+ story IDs/.test(ws) && /Unresolved0/.test(ws) && /engine-render\.js, engine-audio\.js, engine-world\.js, engine-story\.js/.test(ws) && d.querySelectorAll('#ws input[name=s9Status]').length === 2 && d.querySelector('#ws input[value=final]').disabled);

  // ---------------------------------------------------------------- 5. Round trip into Days 146, 147, 148 and back.
  const base = { 146: await in146(demoText), 147: await in147(demoText), 148: await in148(demoText) };
  const draftText = draft.files[0].text, ALL = PRIOR.concat(['story']);
  const reexp = {};
  const probe = (forge, how) => async (w, K) => {
    const cb = K.bundle.current();
    let out = null, err = null; try { out = K.buildExport(how, forge === '148' ? { engines: false } : forge === '147' ? { engines: false } : undefined); } catch (e) { err = e.message; }
    const re = out ? JSON.parse(out.files[0].text) : null;
    return { diff: sameNs(cb, db, ALL), reStory: re && canon(re.story) === canon(db.story), reForge149: re && canon(re.kit.forges['149']) === canon(db.kit.forges['149']), err, reText: out && out.files[0].text, opened: re && re.kit.opened };
  };
  const r146 = await in146(draftText, probe('146', 'draft'));
  const r147 = await in147(draftText, probe('147', 'draft'));
  const r148 = await in148(draftText, probe('148', 'final'));
  [['146', r146], ['147', r147], ['148', r148]].forEach(([k, r]) => {
    check('Day ' + k + ' opens the 149 Draft: hash verified, prior namespaces and story identical', r.matches && !r.diff.length, r.rejected || r.diff);
    check('Day ' + k + ' sees no new errors or broken references', canon(r.summary) === canon(base[k].summary) && canon(r.errors) === canon(base[k].errors), { now: r.summary, before: base[k].summary, err: r.errors.slice(0, 3) });
    check('Day ' + k + ' re-exports (' + (k === '148' ? 'Final' : 'Draft') + ') with story and forge 149 untouched', !r.err && r.reStory && r.reForge149, r.err);
    reexp[k] = r.reText;
  });
  check('Day 148 still exports a Final over the Story Draft, and keeps world opened and story closed', r148.opened && r148.opened.indexOf('world') >= 0 && r148.opened.indexOf('story') < 0, r148.opened);
  for (const k of ['146', '147', '148']) {
    const r = Kit.bundle.importText(reexp[k]); await wait(10);
    const cb = Kit.bundle.current();
    check('149 reopens the Day ' + k + ' re-export: hash verified, every namespace identical to the 149 Draft', r.matches && !sameNs(cb, db, ALL).length && STORY.records.get(flg.id) && STORY.records.get(qst.id), sameNs(cb, db, ALL).concat([(function(){var x=cb.story,y=db.story,o=[];["records","bindings","scaffold"].forEach(function(s){var ks=Object.keys(Object.assign({},x[s],y[s]));ks.forEach(function(p){if(canon(x[s][p])!==canon(y[s][p]))o.push(s+"."+p+" "+String(canon(x[s][p])).slice(0,200)+" VS "+String(canon(y[s][p])).slice(0,200));});});return o.slice(0,6);})()]));
  }
  const r148draft = await in148(draftText, async (w, K) => { const o = K.buildExport('draft', { engines: false }); return { t: o.files[0].text }; });
  check('a Day 148 Draft re-export is refused here (it is no longer a Day 148 Final), with the reason', /no Day 148 Final export/.test(gate(r148draft.t)), gate(r148draft.t));

  // ---------------------------------------------------------------- 6. The forward field sdq_.flag and the open policy.
  Kit.bundle.importText(fourText); await wait(10); b = Kit.bundle.current();
  const sdq = Object.keys(b.rules.sdq_).sort();
  const c1 = b.charter.sections.chapters[0].id;
  const done = STORY.records.put(STORY.envelope('flg_', 'flg|quest|' + sdq[0] + '|done', 'Lost ring returned', { chapter: c1, kind: 'quest', initial: 0 }));
  b.rules.sdq_[sdq[0]].flag = done.id;
  b.rules.sdq_[sdq[1]].flag = 'flg_missing_zz99';
  Kit.bundle.touch('test');
  check('forward refs: one resolving flag, one missing; story cannot open', STORY.forwardRefs(b).map((f) => f.ok).join() === 'true,false' && !STORY.canOpen(b), STORY.forwardRefs(b));
  res = Kit.refreshValidation();
  check('with story closed both flags read as forward here, never broken', !res.broken.length && res.forward.filter((f) => f.owedBy === 149).length === 2, Kit.validate.summary(res));
  draft = Kit.buildExport('draft'); db = JSON.parse(draft.files[0].text); man = JSON.parse(draft.files[1].text);
  check('Draft keeps story closed; export repairs a dangling sdq_.flag to the generated one, so nothing is unresolved', db.kit.opened.indexOf('story') < 0 && !man.unresolved.length && man.forward.length === 2 && db.rules.sdq_[sdq[1]].flag !== 'flg_missing_zz99', man.unresolved);
  const fw146 = await in146(draft.files[0].text, (w, K, r) => ({ forward: r.forward.filter((x) => x.owedBy === 149).map((x) => x.id).sort() }));
  check('Day 146 imports it: 0 broken, both flags forward and owed by 149', fw146.matches && !fw146.summary.broken && canon(fw146.forward) === canon([done.id, db.rules.sdq_[sdq[1]].flag].sort()), fw146);
  check('the world check ignores story problems: a dangling story flag does not make the world unclean', !STORY.worldCheck(b).length);
  // Stand in for Phase 7's checks so the Final path can be proven now (Phase 7 replaces STORY.checks with the real ones).
  b.rules.sdq_[sdq[1]].flag = done.id; Kit.bundle.touch('test');
  STORY.checks = { finalBlock: () => null, summary: () => ({ standIn: true }) };
  const fin = Kit.buildExport('final');
  const fb = JSON.parse(fin.files[0].text), fman = JSON.parse(fin.files[1].text);
  const srcFour = JSON.parse(fourText);
  check('Final opens story, stamps forge 149 final, leaves 146, 147, and 148 alone', fb.kit.opened.indexOf('story') >= 0 && fb.kit.forges['149'].status === 'final' && ['146', '147', '148'].every((f) => canon(fb.kit.forges[f]) === canon(srcFour.kit.forges[f])) && fman.storyOpened && !fman.unresolved.length, fb.kit.opened);
  const noFlags = (r) => { const c = JSON.parse(JSON.stringify(r)); Object.keys(c.sdq_ || {}).forEach((k) => { delete c.sdq_[k].flag; }); return c; };
  check('Final changes nothing outside story but sdq_.flag', sameNs(fb, srcFour, ['charter', 'codex', 'art', 'world']).length === 0 && canon(noFlags(fb.rules)) === canon(noFlags(srcFour.rules)));
  for (const [k, fn] of [['146', in146], ['147', in147], ['148', in148]]) {
    const r = await fn(fin.files[0].text, (w, K, rr) => ({ forward: rr.forward.length }));
    check('Day ' + k + ' opens the 149 Final: flags resolve, 0 errors, 0 broken, 0 forward', r.matches && !r.summary.errors && !r.summary.broken && !r.forward, r.rejected || r.summary);
  }
  // Control: an opened story with a missing flag is exactly what the policy prevents. Day 146 would call it broken.
  const leak = JSON.parse(fin.files[0].text); leak.rules.sdq_[sdq[1]].flag = 'flg_missing_zz99';
  const leak146 = await in146(await stamp(leak));
  check('control: an opened story with a missing flag is broken in Day 146 (why story opens only on Final)', leak146.summary.broken === 1, leak146.summary);
  delete STORY.checks;

  // ---------------------------------------------------------------- 7. Own storage keys, the Day 148 draft, IndexedDB.
  const w148draft = JSON.stringify(JSON.parse(fourText));
  ({ win, errors } = await boot149({ storage: { 'kit:draft': demoText, 'world148:draft': w148draft, 'kit:ui': JSON.stringify({ tab: 'export' }) } }));
  const offer = Array.prototype.some.call(win.document.querySelectorAll('#ws button'), (x) => /Day 148 draft/.test(x.textContent));
  check('149 keeps its own draft and offers the Day 148 draft on Start', win.Kit.bundle.current().kit.title === 'Untitled Saga' && win.Kit.active() === 'start' && offer && !errors.length, { title: win.Kit.bundle.current().kit.title, active: win.Kit.active(), offer });
  await win.STORY.openDay148Draft(); await wait(20);
  check('Open the Day 148 draft copies it in and leaves world148:draft and kit:draft untouched', win.Kit.bundle.current().kit.title === 'Four Continents' && win.localStorage.getItem('world148:draft') === w148draft && win.localStorage.getItem('kit:draft') === demoText && JSON.parse(win.localStorage.getItem('story149:draft')).kit.title === 'Four Continents');
  const notFinal = JSON.parse(fourText); notFinal.kit.forges['148'].status = 'draft';
  ({ win, errors } = await boot149({ storage: { 'world148:draft': JSON.stringify(notFinal) } }));
  const refusedOpen = await win.STORY.openDay148Draft();
  check('a Day 148 draft that is not a Final is refused with the gate\'s reason', refusedOpen === false && win.Kit.bundle.current().kit.title === 'Untitled Saga' && /no Day 148 Final export/.test(win.document.getElementById('toasts').textContent));
  const SP = win.Storage.prototype, orig = SP.setItem;
  SP.setItem = function (k, v) { if (k === 'story149:draft') throw new Error('QuotaExceededError'); return orig.call(this, k, v); };
  win.Kit.bundle.save();
  const shown = !win.document.getElementById('storeBanner').hidden;
  SP.setItem = orig; win.Kit.bundle.save();
  check('storage banner shows on a refused save and clears on success', shown && win.document.getElementById('storeBanner').hidden);
  const fi = require(path.join(__dirname, 'node_modules', 'fake-indexeddb'));
  const factory = new fi.IDBFactory();
  const store = {};
  ({ win, errors } = await boot149({ indexedDB: factory }));
  win.Kit.bundle.importText(fourText); await wait(10);
  const SP2 = win.Storage.prototype, orig2 = SP2.setItem;
  SP2.setItem = function (k, v) { if (k === 'story149:draft') throw new Error('QuotaExceededError'); return orig2.call(this, k, v); };
  win.Kit.bundle.save();
  await wait(80);
  const where = win.STORY.storage.where('kit:draft');
  for (let i = 0; i < win.localStorage.length; i++) { const k = win.localStorage.key(i); store[k] = win.localStorage.getItem(k); }
  SP2.setItem = orig2;
  check('a refused localStorage save moves the draft to IndexedDB with a marker', where === 'idb' && store['story149:where:story149:draft'] === '1' && !store['story149:draft'] && win.document.getElementById('storeBanner').hidden, { where, keys: Object.keys(store) });
  const again = await boot149({ indexedDB: factory, storage: store });
  check('the next boot restores the draft from IndexedDB', again.win.Kit.bundle.current().kit.title === 'Four Continents' && !again.errors.length, again.win.Kit.bundle.current().kit.title);
  check('only story149: keys were written (no kit:draft, no world148:, no art147:)', Object.keys(store).every((k) => /^story149:/.test(k) || k === 'kit:settings'), Object.keys(store));

  // ---------------------------------------------------------------- 8. Dev tab fixtures.
  ({ win, errors } = await boot149());
  check('STORY_DEMO fixtures are the Day 148 exports, verbatim', canon(win.STORY_DEMO.fixture('demo')) === canon(JSON.parse(demoText)) && canon(win.STORY_DEMO.fixture('four')) === canon(JSON.parse(fourText)));
  const fx = (t) => { const x = JSON.parse(t); return { f148: x.kit.forges['148'].status, opened: x.kit.opened.indexOf('world') >= 0, minutes: x.charter.sections.chapters.reduce((a, c) => a + c.targetMinutes, 0), seed: x.world.seed }; };
  check('both fixtures are Day 148 Finals, world opened, seed 42, at or over 720 minutes', [fx(demoText), fx(fourText)].every((x) => x.f148 === 'final' && x.opened && x.seed === 42 && x.minutes >= 720), [fx(demoText), fx(fourText)]);
  await win.STORY.loadFixture('four'); await wait(10);
  check('Dev loads a fixture into a fresh draft, ready', win.Kit.bundle.current().kit.title === 'Four Continents' && win.STORY.readiness() === true && !errors.length);

  const pass = results.filter((r) => r.ok).length;
  results.forEach((r) => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + String(JSON.stringify(r.detail)).slice(0, 600))));
  console.log('\n' + pass + ' of ' + results.length + ' passed');
  fs.writeFileSync(path.join(OUT, 'phase0-report.json'), JSON.stringify({ results }, null, 2));
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
