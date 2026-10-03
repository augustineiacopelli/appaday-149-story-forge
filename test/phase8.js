// Phase 8 acceptance: the export, the Day 150 contract, and the standalone game proof. This suite is the definition of
// done for Day 149. A game must not need the forge: everything below that plays the story does it in a bare vm context
// holding only the five engine files of the game kit and a Final bundle.
// 1. static: new sources ASCII clean, no forbidden APIs or dashes in prose, the engine rules kept with the host section,
//    engine-battle.js byte equal to Day 146's fence, every root engine file matching the table the page carries;
// 2. per fixture (demo, four continents): import, scaffold, Final allowed, the manifest's day150 block complete;
// 3. the standalone proof: a bare context with only the five files replays the golden path and every ending to the walk's
//    exact end states, two contexts agree byte for byte, and no forge name exists in the context;
// 4. a save taken mid game, sent through JSON, and loaded finishes the golden path at the same end state;
// 5. every battle on the golden path runs through the real ENGINE_BATTLE from Day 146 with a party built from the story
//    state, deterministically;
// 6. a tampered path is refused with a reason, so replay is never a rubber stamp;
// 7. the game kit export: all five engines downloaded and checked by sha256, a tampered engine refused, and the exported
//    folder alone (load order from the manifest) plays the game;
// 8. Days 146, 147, 148 open the Final with every prior namespace identical (except sdq_.flag) and no broken references;
// 9. two fresh pages scaffold the same story and the same contract; the export tab shows the game kit and plays it.
// Run from test/.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { boot149, wait, ROOT } = require('./story');
const { in146, in147, in148, APP146 } = require('./compat');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
const J = JSON.stringify;
const OUT = path.join(__dirname, 'out');
const read = (f) => fs.readFileSync(f, 'utf8');
const canon = (v) => { if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => J(k) + ':' + canon(v[k])).join(',') + '}'; return J(v); };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const noHashLine = (s) => s.replace(/^\/\* Bundle hash [0-9a-f]+ \*\/\n/m, '');
const KIT = ['engine-render.js', 'engine-audio.js', 'engine-world.js', 'engine-battle.js', 'engine-story.js'];
const FIX = { demo: read(path.join(OUT, 'demo148-bundle.json')), four: read(path.join(OUT, 'four148-bundle.json')) };

// A page with the whole story built, the order a person would press the buttons.
async function prepared(text, setup) {
  const r = await boot149(setup ? { setup } : undefined);
  const { Kit, STORY } = r.win;
  Kit.bundle.importText(text); await wait(20);
  const b = Kit.bundle.current();
  STORY.quests.scaffold(b); STORY.dialogue.scaffold(b); STORY.flags.sync(b); STORY.ends.scaffold(b); STORY.events.scaffold(b);
  return r;
}
// The game: a bare context, the five engine texts, and nothing else. Returns the context and the names it holds.
function bareGame(texts) {
  const box = vm.createContext({});
  texts.forEach((t) => vm.runInContext(t, box));
  return box;
}
// A party for ENGINE_BATTLE from the story state: the chr_ ids in the party (the first character when the party is still
// empty), at the chapter's expected level, with no gear. Balance is Day 150's; this proves the seam.
function partyFor(bundle, state) {
  const chrs = Object.keys(bundle.rules.chr_ || {}).sort();
  const ids = (state.party && state.party.length ? state.party : chrs.slice(0, 1)).slice(0, 4);
  const eps = Object.values(bundle.rules.eps_ || {}).find((e) => e.chapter === state.chapter);
  const level = eps && eps.targetLevel ? eps.targetLevel : 10;
  return ids.map((chr) => ({ chr, level, equipment: [], materia: [], abilities: [], row: 'front' }));
}
const stripSdqFlag = (b) => { const c = JSON.parse(J(b)); Object.values((c.rules && c.rules.sdq_) || {}).forEach((r) => { delete r.flag; }); return c; };

(async () => {
  // ---------------------------------------------------------------- 1. Static.
  const names = ['engine-host.js', 'story-day150.js'];
  const files = names.map((f) => path.join(ROOT, 'src', f));
  check('the new sources exist and are pure ASCII', files.every((f) => fs.existsSync(f) && !/[^\x00-\x7f]/.test(read(f))));
  // The Phase 8 parts of ws-story149.js: the game kit reader, the export with the kit, and the Day 150 panel.
  const ws = read(path.join(ROOT, 'src', 'ws-story149.js'));
  const slice = (a, z) => ws.slice(ws.indexOf(a), ws.indexOf(z, ws.indexOf(a)));
  const wsNew = [slice('// The rest of the game kit', '// ---------------------------------------------------------------- manifest'), slice('// opts.kit (Final only)', 'function exportForm'), slice('// ---------------------------------------------------------------- the Day 150 panel', 'function renderExport')];
  check('the Phase 8 parts of ws-story149.js are found', wsNew.every((t) => t.length > 200));
  const forbidden = /roundRect|\.ellipse\(|window\.confirm|(^|[^.\w])eval\(|new Function|[^.\w]confirm\(|\.remove\(\)|localStorage|Math\.random/;
  check('no forbidden APIs, randomness, or storage in the new JavaScript', files.every((f) => !forbidden.test(read(f))) && wsNew.every((t) => !forbidden.test(t)));
  const dashRe = new RegExp('\\u2013|\\u2014|\'[^\'\\n]*[A-Za-z] - [A-Za-z][^\'\\n]*\'');
  const strip = (t) => t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('no dashes used as punctuation in the new prose', files.every((f) => !dashRe.test(strip(read(f)))) && wsNew.every((t) => !dashRe.test(strip(t))));
  const engText = read(path.join(ROOT, 'engine-story.js'));
  const fence = engText.slice(engText.indexOf('// === ENGINE:STORY BEGIN ==='));
  const sec = (name) => fence.indexOf('---------------- ' + name);
  check('the host section follows the walk, above the freeze line', sec('the host (Phase 8)') > sec('the walk (Phase 7)') && sec('the walk (Phase 7)') > 0 && sec('the host (Phase 8)') < fence.indexOf('later phases insert sections above this line'));
  const banned = { 'Math.random': /Math\.random/, Date: /\bDate\b/, performance: /\bperformance\b/, eval: /\beval\s*\(/, 'new Function': /new\s+Function/, 'for in': /for\s*\(\s*(var\s+)?\w+\s+in\b/, window: /\bwindow\b/, document: /\bdocument\b/, Kit: /\bKit\b/, STORY: /\bSTORY\b/, ENGINE_WORLD: /ENGINE_WORLD/, ENGINE_BATTLE: /ENGINE_BATTLE/, localStorage: /localStorage/, fetch: /\bfetch\b/, timers: /setTimeout|setInterval/ };
  const hits = Object.keys(banned).filter((k) => banned[k].test(fence.replace(/\/\/.*$/gm, '')));
  check('the whole engine fence keeps the rules with the host in it: no randomness, clocks, eval, for in, timers, network, host globals, or other engines', !hits.length && fence.split('Object.keys(').length === 2, hits);
  const day146 = read(APP146), bo = '// === ENGINE:BATTLE BEGIN ===', bc = '// === ENGINE:BATTLE END ===';
  const inner = (t) => { let a = t.indexOf(bo), z = t.indexOf(bc, a + 1); a = t.indexOf('\n', a); z = t.lastIndexOf('\n', z); return t.slice(a + 1, z + 1); };
  const battleRoot = read(path.join(ROOT, 'engine-battle.js'));
  check('engine-battle.js is Day 146\'s ENGINE:BATTLE fence byte for byte under Day 146\'s export header', battleRoot.slice(battleRoot.indexOf('*/\n') + 3) === inner(day146) && /^\/\* Saga Forge ENGINE:BATTLE, engine version 1\.0\.0\n/.test(battleRoot));
  const page = read(path.join(ROOT, 'index.html'));
  const table = JSON.parse(/FILES: (\[\{.*?\}\])/.exec(page)[1]);
  check('the page carries the game kit table: five files in load order (render, audio, world, battle, story) from Days 147, 147, 148, 146, 149', J(table.map((f) => f.file)) === J(KIT) && J(table.map((f) => f.owner)) === J([147, 147, 148, 146, 149]) && table.every((f) => f.version === '1.0.0'));
  check('every root engine file matches the sha256 and size in that table', table.every((f) => { const t = noHashLine(read(path.join(ROOT, f.file))); return sha(t) === f.sha256 && Buffer.byteLength(t) === f.bytes; }), table.map((f) => f.file + ' ' + f.sha256.slice(0, 8)));
  {
    const box = bareGame(KIT.map((f) => read(path.join(ROOT, f))));
    check('the five engines load into a bare context together and declare exactly their five globals', J(Object.keys(box).sort()) === J(['ENGINE_AUDIO', 'ENGINE_BATTLE', 'ENGINE_RENDER', 'ENGINE_STORY', 'ENGINE_WORLD']));
    const Hx = box.ENGINE_STORY.host;
    check('ENGINE_STORY.host is frozen with ext, world, load, newGame, moves, play, replay, and hash', Object.isFrozen(Hx) && ['ext', 'world', 'load', 'newGame', 'moves', 'play', 'replay', 'hash'].every((k) => typeof Hx[k] === 'function') && box.ENGINE_STORY.version === '1.0.0');
  }

  // ---------------------------------------------------------------- 2 to 7. Per fixture.
  const finals = {}, contracts = {};
  for (const fx of ['demo', 'four']) {
    const r = await prepared(FIX[fx]);
    const { Kit, STORY } = r.win;
    const b = Kit.bundle.current();
    check(fx + ': the fixture imports and the forge reports a clean world', STORY.readiness(b) === true && !STORY.worldCheck(b).length);
    check(fx + ': the forge reads the bundle through the engine host (engineExt and walkWorld are the host\'s)', canon(STORY.engineExt(b)) === canon(r.win.ENGINE_STORY.host.ext(b)) && canon(STORY.checks.walkWorld(b)) === canon(r.win.ENGINE_STORY.host.world(b)));
    let fin;
    try { fin = Kit.buildExport('final', { engines: true }); } catch (e) { fin = { error: e.message }; }
    check(fx + ': Final export is allowed', !fin.error, fin.error);
    if (fin.error) continue;
    const fb = JSON.parse(fin.files[0].text), man = JSON.parse(fin.files[1].text), d = man.day150;
    finals[fx] = { text: fin.files[0].text, bundle: fb, manifest: man, story: fin.files[2].text, hash: fin.hash };
    contracts[fx] = d;
    check(fx + ': Final stamps forges 149 final and opens story', fb.kit.forges['149'].status === 'final' && fb.kit.opened.indexOf('story') >= 0);
    check(fx + ': the manifest names forge 149, the bundle hash, nothing unresolved, and the five engine load order', man.forge === 149 && man.bundleHash === fin.hash && man.unresolved.length === 0 && J(man.loadOrder) === J(KIT) && man.engines.length === 5);
    check(fx + ': the day150 block is complete: contract 1, engines with sha256, api, new game, opening, saves, bosses, battle, effects, golden, endings, shell',
      !!d && d.contract === 1 && J(d.loadOrder) === J(KIT) && d.engines.every((e) => /^[0-9a-f]{64}$/.test(e.sha256)) && !!d.api.load && !!d.newGame && d.opening.steps.length > 0 && d.opening.faults === 0 &&
      d.opening.firstMoves.length > 0 && d.saves.derived.length > 0 && d.bosses.length > 0 && d.bosses.every((x) => x.troop && x.evt) && !!d.battle.outcomes && d.effects.commands.length === 21 &&
      !!d.golden && d.golden.full && d.golden.steps.length > 0 && d.endings.length >= 1 && d.shell.provides.length === 5 && d.shell.never.indexOf('Kit or STORY') >= 0, d && { opening: d.opening.steps.length, bosses: d.bosses });
    check(fx + ': the opening starts in the first chapter, and the start is the overworld', d.opening.chapter === fb.charter.sections.chapters[0].id && !!d.start.overworld);
    check(fx + ': every boss names its troop source, and an empty world slot is filled from the story side only', d.bosses.every((x) => {
      const zone = ((fb.world.zones && fb.world.zones.bosses) || []).find((z) => z && z.site === x.dgn), dg = fb.world.records.dgn_[x.dgn] || {};
      const wt = (zone && zone.troop) || dg.troop || null;
      return x.source === (wt ? 'world' : 'story') && (!wt || x.troop === wt) && !!fb.rules.trp_[x.troop];
    }), d.bosses);

    // 3. The standalone proof.
    const texts = KIT.slice(0, 4).map((f) => read(path.join(ROOT, f))).concat([finals[fx].story]);
    const box = bareGame(texts), H = box.ENGINE_STORY.host;
    const game = H.load(JSON.parse(finals[fx].text));
    const forgeNames = ['window', 'document', 'Kit', 'STORY', 'localStorage', 'indexedDB', 'fetch', 'WORLD', 'ART'];
    check(fx + ': the game context holds no forge or browser name at all', forgeNames.every((n) => !(n in box)));
    const gold = H.replay(game, d.golden.steps);
    check(fx + ': the bare game plays the golden path to the walk\'s ending and exact end state, with no runtime fault', gold.ok && gold.ending === d.golden.ending && gold.hash === d.golden.hash && gold.faults.length === 0 && gold.played === d.golden.steps.length, gold.error || { ending: gold.ending });
    const ends = d.endings.map((e) => { const x = H.replay(game, e.steps); return x.ok && x.ending === e.end && x.hash === e.hash && !x.faults.length; });
    check(fx + ': the bare game reaches every ending the walk found, each at its exact end state', ends.length >= 1 && ends.every(Boolean), ends);
    const box2 = bareGame(texts), g2 = box2.ENGINE_STORY.host.load(JSON.parse(finals[fx].text)), gold2 = box2.ENGINE_STORY.host.replay(g2, d.golden.steps);
    check(fx + ': two bare contexts play the golden path to the same state byte for byte', canon(gold.state) === canon(gold2.state) && J(gold.state) === J(gold2.state));
    const oneMove = H.newGame(game, {}, {});
    check(fx + ': a new game in the bare context matches the contract\'s opening (forced events, chapter, state, first moves)', canon(oneMove.steps.map((s) => ({ by: s.by, evt: s.evt }))) === canon(d.opening.steps.map((s) => ({ by: s.by, evt: s.evt }))) && oneMove.state.chapter === d.opening.chapter && H.hash(oneMove.state) === d.opening.hash && canon(H.moves(game, oneMove.state)) === canon(d.opening.firstMoves));
    let effects = 0, texts2 = 0;
    H.replay(game, d.golden.steps, { effect: (e) => { effects++; if (e && e.kind === 'text') texts2++; } });
    check(fx + ': the effect hook sees what a game draws: text and the other effects of the golden path', effects > d.golden.steps.length && texts2 > 0, { effects, texts: texts2 });

    // 4. A save mid game.
    const cut = d.golden.steps.findIndex((s, i) => i > 0 && i >= Math.floor(d.golden.steps.length / 2) && ['mapEnter', 'step', 'talk', 'dialogue', 'autorun'].indexOf(s.by) >= 0 && (() => { const pre = H.replay(game, d.golden.steps.slice(0, i)); return pre.ok; })());
    const first = H.replay(game, d.golden.steps.slice(0, cut));
    const save = box.ENGINE_STORY.save.toSave(first.state, game.idx);
    const loaded = box.ENGINE_STORY.save.fromSave(JSON.parse(J(save)), game.idx);
    const rest = H.replay(game, d.golden.steps.slice(cut), { state: loaded });
    check(fx + ': a save taken halfway through the golden path, sent through JSON, and loaded finishes at the same ending and end state', cut > 0 && first.ok && !save.error && Array.isArray(save.flags) && rest.ok && rest.ending === d.golden.ending && rest.hash === d.golden.hash, { cut, err: rest.error });
    check(fx + ': the save refuses to be taken mid event and after the ending', !!box.ENGINE_STORY.save.toSave(gold.state, game.idx).error);

    // 5. Battles through the real ENGINE_BATTLE.
    const battles = [];
    const B = box.ENGINE_BATTLE, fbData = JSON.parse(finals[fx].text);
    H.replay(game, d.golden.steps, { battle: (q) => {
      const data = { ruleset: fbData.charter.ruleset, records: fbData.rules, party: partyFor(fbData, q.state), troopId: q.trp, weatherId: null };
      let a, z;
      try { a = B.run(data, 12345, null, { events: false }).result; z = B.run(JSON.parse(J(data)), 12345, null, { events: false }).result; } catch (e) { a = { error: e.message }; }
      battles.push({ trp: q.trp, outcome: a && a.outcome, same: !!z && J(a) === J(z), story: d.battle.outcomes[a && a.outcome] });
    } });
    check(fx + ': every golden path battle runs in the real ENGINE_BATTLE with a party from the story state, deterministically, and maps to a story outcome', battles.length >= 1 && battles.every((x) => ['win', 'lose', 'flee', 'timeout'].indexOf(x.outcome) >= 0 && x.same && ['win', 'lose', 'escape'].indexOf(x.story) >= 0), battles);
    check(fx + ': every golden path battle is a troop the contract lists as a boss or a troop in the Rules', battles.every((x) => !!fbData.rules.trp_[x.trp]));

    // 6. A tampered path is refused.
    const bad1 = d.golden.steps.map((s) => JSON.parse(J(s)));
    const mi = bad1.findIndex((s) => s.by === 'talk' || s.by === 'dialogue' || s.by === 'step' || s.by === 'mapEnter');
    bad1.splice(mi, 1);
    const t1 = H.replay(game, bad1);
    check(fx + ': a path missing a move is refused with a reason naming the step', !t1.ok && !!t1.error && /^(unavailable|diverged|record)$/.test(t1.error.code) && /Step \d+|recorded/.test(t1.error.message), t1.error);
    const bad2 = d.golden.steps.map((s) => JSON.parse(J(s)));
    const bi = bad2.findIndex((s) => Array.isArray(s.battles));
    if (bi >= 0) { bad2[bi].battles[0].trp = 'trp_not_this_one'; const t2 = H.replay(game, bad2); check(fx + ': a path that names the wrong troop is refused', !t2.ok && t2.error.code === 'battle', t2.error); }
    const t3 = H.replay(game, d.golden.steps.concat([d.golden.steps[d.golden.steps.length - 1]]));
    check(fx + ': a path that goes on after the ending is refused', !t3.ok);

    // 7. The game kit export, with this page's own files served beside it.
    const served = {};
    KIT.slice(0, 4).forEach((f) => { served[f] = read(path.join(ROOT, f)); });
    const r2 = await prepared(FIX[fx], (win) => {
      Object.defineProperty(win, 'crypto', { value: crypto.webcrypto, configurable: true });
      win.fetch = (u) => { const f = String(u).split('/').pop(); return served[f] !== undefined ? Promise.resolve({ ok: true, text: () => Promise.resolve(served[f]) }) : Promise.resolve({ ok: false }); };
    });
    const downloads = [];
    r2.win.Kit.util.download = (name, text) => { downloads.push({ name, text }); };
    const ex = r2.win.STORY.exportNow('final', { engines: true, kit: true });
    const kit = ex && ex.kit ? await ex.kit : null;
    await wait(ex ? (ex.files.length + 6) * 360 : 0);
    check(fx + ': the Final game kit export downloads all five engines, the bundle, and the manifest, nothing missing', !!kit && kit.files.length === 4 && kit.missing.length === 0 && downloads.length === 7, kit && kit.missing);
    const dir = path.join(OUT, 'phase8-kit-' + fx);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    downloads.forEach((f) => fs.writeFileSync(path.join(dir, f.name), f.text));
    const manName = downloads.map((f) => f.name).find((n) => /-story-manifest\.json$/.test(n)), bunName = downloads.map((f) => f.name).find((n) => /\.json$/.test(n) && n !== manName);
    const m2 = JSON.parse(read(path.join(dir, manName)));
    check(fx + ': each engine in the exported folder matches the manifest\'s sha256 (any bundle hash line aside)', m2.day150.engines.every((e) => fs.existsSync(path.join(dir, e.file)) && sha(noHashLine(read(path.join(dir, e.file)))) === e.sha256));
    const kbox = bareGame(m2.day150.loadOrder.map((f) => read(path.join(dir, f))));
    const kb = JSON.parse(read(path.join(dir, bunName)));
    const kplay = kbox.ENGINE_STORY.host.replay(kbox.ENGINE_STORY.host.load(kb), m2.day150.golden.steps);
    check(fx + ': the exported folder alone, loaded in the manifest\'s order, plays the game to its ending', kplay.ok && kplay.ending === m2.day150.golden.ending && kplay.hash === m2.day150.golden.hash && kb.kit.contentHash === m2.bundleHash, kplay.error);
    served['engine-world.js'] = served['engine-world.js'] + '\n// tampered\n';
    const k3 = await r2.win.STORY.engines.kit();
    check(fx + ': a tampered engine beside the page is refused, never shipped, and named as missing', k3.files.length === 3 && k3.missing.length === 1 && k3.missing[0].file === 'engine-world.js' && /sha256/.test(k3.missing[0].why), k3.missing);
    const r3 = await prepared(FIX[fx]);
    const off = await r3.win.STORY.engines.kit();
    check(fx + ': opened offline (nothing to fetch), the kit names all four files missing instead of failing', off.files.length === 0 && off.missing.length === 4);
  }

  // ---------------------------------------------------------------- 8. Days 146, 147, 148 open the Final.
  for (const fx of Object.keys(finals)) {
    const t = finals[fx].text, fb = finals[fx].bundle, src = JSON.parse(FIX[fx]);
    const prior = (bb) => { const c = stripSdqFlag(bb); return canon({ charter: c.charter, codex: c.codex, rules: c.rules, art: c.art, world: c.world }); };
    check(fx + ': every prior namespace in the Final is identical to the Day 148 fixture except sdq_.flag', prior(fb) === prior(src));
    check(fx + ': sdq_.flag is the only field the story wrote outside its namespace, and each points at a story flag', Object.values(fb.rules.sdq_ || {}).every((s) => typeof s.flag === 'string' && !!fb.story.records.flg_[s.flag]));
    const o146 = await in146(t), o147 = await in147(t), o148 = await in148(t);
    check(fx + ': Day 146 opens the Final with no errors and no broken references', !o146.rejected && o146.summary.errors === 0 && o146.broken.length === 0, o146.rejected || o146.errors.slice(0, 3));
    check(fx + ': Day 147 opens the Final with no errors and no broken references', !o147.rejected && o147.summary.errors === 0 && o147.broken.length === 0, o147.rejected || o147.errors.slice(0, 3));
    check(fx + ': Day 148 opens the Final with no errors and no broken references', !o148.rejected && o148.summary.errors === 0 && o148.broken.length === 0, o148.rejected || o148.errors.slice(0, 3));
  }

  // ---------------------------------------------------------------- 9. Two pages agree; the export tab.
  {
    const a = await prepared(FIX.four), z = await prepared(FIX.four);
    const sa = a.win.Kit.bundle.current().story, sz = z.win.Kit.bundle.current().story;
    check('two fresh pages scaffold the same story byte for byte', canon(sa.records) === canon(sz.records) && canon(sa.bindings) === canon(sz.bindings) && canon(sa.npcDialogue) === canon(sz.npcDialogue));
    const ca = a.win.STORY.day150(a.win.Kit.bundle.current()), cz = z.win.STORY.day150(z.win.Kit.bundle.current());
    check('two fresh pages write the same Day 150 contract', canon(ca) === canon(cz) && canon(ca) === canon(contracts.four));
    const { win } = a, d = win.document;
    win.STORY.checks.run(win.Kit.bundle.current());
    win.Kit.go('export'); await wait(80);
    const panel = d.querySelector('#ws .s9-d150');
    check('the export tab shows the game kit: five files in load order with their source day and sha256', !!panel && panel.querySelectorAll('tbody tr').length === 5 && /1\. engine-render\.js/.test(panel.textContent) && /5\. engine-story\.js/.test(panel.textContent) && /Day 146/.test(panel.textContent));
    const play = Array.from(panel.querySelectorAll('button')).find((x) => /Play the golden path/.test(x.textContent));
    if (play) play.click();
    const res = panel.querySelector('.s9-play-res');
    check('Play the golden path runs the game loop in the page and reports the walk\'s exact end state', !!play && !!res && /msg-ok/.test(res.className) && /Played \d+ steps through the game loop/.test(res.textContent), res && res.textContent);
    check('the export dialog offers the whole game kit for a Final, on by default', /the whole game kit/.test(d.querySelector('#ws').textContent) && win.STORY.exportUi.kit === true);
  }

  const failed = results.filter((x) => !x.ok);
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + J(x.detail === undefined ? null : x.detail).slice(0, 600))));
  fs.writeFileSync(path.join(OUT, 'phase8-report.json'), J(results, null, 2));
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' passed');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
