// Phase 7 acceptance: validation and the reachability proof (ENGINE_STORY.walk in src/engine-walk.js, STORY.checks in
// src/story-checks.js, the check cards in src/ws-validation.js and src/story-validation.css).
// 1. static: sources ASCII clean, no forbidden APIs, no dashes in UI prose, fences in order, the engine rules kept, the walk
//    spliced last, structural IDs and digests unchanged by the faster hashing;
// 2. the walk alone in bare vm contexts over the hand authored story: runtime errors found with their paths, no ending means
//    no finish, the cap is reported and never blames states it did not explore, two contexts agree byte for byte;
// 3. the scaffolded stories on both fixtures: every chapter, main quest, gate, ending, and side quest reached, no softlock,
//    the golden path finishes every main quest, and two bare contexts holding only engine-story.js and the Draft's world
//    picture walk to the page's exact result;
// 4. the six checks: both stories proven, and seeded faults caught by the right card with the right code (references and
//    the world stamp, smells, runtime errors and autorun loops, the cap, every proof, a softlock trap, the floor);
// 5. Final export: refused with a reason while a check fails, allowed once proven, and Days 146, 147, 148 open the Final;
// 6. the Validation tab under jsdom: the waiting card, six cards with failing first, paths, jumps, Confirm this world,
//    Show more, Walk again, the Final card;
// 7. two fresh pages agree; a stamped Draft round trips through Days 146, 147, 148 and back.
// Run from test/.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { engine, story } = require('./storyfx');
const { boot149, wait, ROOT } = require('./story');
const { in146, in147, in148 } = require('./compat');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
const J = JSON.stringify;
const OUT = path.join(__dirname, 'out');
const demoText = fs.readFileSync(path.join(OUT, 'demo148-bundle.json'), 'utf8');
const fourText = fs.readFileSync(path.join(OUT, 'four148-bundle.json'), 'utf8');
const canon = (v) => { if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => J(k) + ':' + canon(v[k])).join(',') + '}'; return J(v); };
const read = (f) => fs.readFileSync(f, 'utf8');

// A page with the whole story built: quests, dialogue, flags, endings, events (the order a person would press the buttons).
async function prepared(text) {
  const r = await boot149();
  const { Kit, STORY } = r.win;
  Kit.bundle.importText(text); await wait(20);
  const b = Kit.bundle.current();
  STORY.quests.scaffold(b); STORY.dialogue.scaffold(b); STORY.flags.sync(b); STORY.ends.scaffold(b); STORY.events.scaffold(b);
  return r;
}
const codes = (res, key) => (res.cards.find((c) => c.key === key) || { items: [] }).items.map((x) => x.level + ':' + x.code);
const has = (res, key, code) => codes(res, key).some((c) => c === code);
const status = (res, key) => (res.cards.find((c) => c.key === key) || {}).status;

(async () => {
  // ---------------------------------------------------------------- 1. Static.
  const names = ['engine-walk.js', 'story-checks.js', 'ws-validation.js', 'story-validation.css'];
  const files = names.map((f) => path.join(ROOT, 'src', f));
  check('the four new sources exist and are pure ASCII', files.every((f) => fs.existsSync(f) && !/[^\x00-\x7f]/.test(read(f))));
  const forbidden = /roundRect|\.ellipse\(|window\.confirm|(^|[^.\w])eval\(|new Function|[^.\w]confirm\(|\.remove\(\)|localStorage|Math\.random/;
  check('no forbidden APIs in the new JavaScript (and no randomness or storage of its own)', files.slice(0, 3).every((f) => !forbidden.test(read(f))));
  const dashRe = new RegExp('\\u2013|\\u2014|\'[^\'\\n]*[A-Za-z] - [A-Za-z][^\'\\n]*\'');
  const strip = (t) => t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('no dashes used as punctuation in the new prose', files.slice(0, 3).every((f) => !dashRe.test(strip(read(f)))));
  const html = read(path.join(ROOT, 'index.html'));
  const at = (m) => html.indexOf(m);
  check('index.html carries STORY:CHECKS after STORY:ENDINGS, WS:VALIDATION before WS:STORY149, and the validation CSS fence', at('STORY:CHECKS BEGIN') > at('STORY:ENDINGS END') && at('WS:VALIDATION BEGIN') > at('WS:ENDINGS END') && at('WS:VALIDATION BEGIN') < at('WS:STORY149 BEGIN') && at('STORY:VALIDATION CSS BEGIN') > 0);
  const engText = read(path.join(ROOT, 'engine-story.js'));
  const fence = engText.slice(engText.indexOf('// === ENGINE:STORY BEGIN ==='));
  const sec = (name) => fence.indexOf('---------------- ' + name);
  check('the walk is the last engine section, spliced above the freeze line', sec('the walk (Phase 7)') > sec('saves (Phase 1)') && sec('saves (Phase 1)') > 0 && sec('the walk (Phase 7)') < fence.indexOf('later phases insert sections above this line'));
  const banned = { 'Math.random': /Math\.random/, Date: /\bDate\b/, performance: /\bperformance\b/, eval: /\beval\s*\(/, 'new Function': /new\s+Function/, 'for in': /for\s*\(\s*(var\s+)?\w+\s+in\b/, window: /\bwindow\b/, document: /\bdocument\b/, Kit: /\bKit\b/, ENGINE_WORLD: /ENGINE_WORLD/, localStorage: /localStorage/, timers: /setTimeout|setInterval/ };
  const hits = Object.keys(banned).filter((k) => banned[k].test(fence.replace(/\/\/.*$/gm, '')));
  check('the whole engine fence still keeps the rules: no randomness, clocks, eval, for in, timers, or host globals, and Object.keys only in util.keys', !hits.length && fence.split('Object.keys(').length === 2, hits);
  check('the hash loops use a bound imul, not a global Math lookup per character', !/Math\.imul\(/.test(fence) && /var imul = Math\.imul/.test(fence));
  const ES = engine();
  check('ENGINE_STORY.walk exists, frozen, with run, hash, abstract, and the cap of 50000; the engine is still version 1.0.0', !!ES.walk && Object.isFrozen(ES.walk) && typeof ES.walk.run === 'function' && ES.walk.CAP === 50000 && ES.version === '1.0.0');
  check('structural IDs and digests are unchanged by the faster hashing (known values from Phase 0)', ES.ids.structural('flg_', 'flg|gate|chapter:chp_the_lowlands_auem') === 'flg_flg_gate_chapter_chp_the_lowlands_auem_j0bo' && ES.util.digest('abc') === ES.util.digest(['abc']) && /^[0-9a-f]{16}$/.test(ES.walk.hash('x')));
  check('the abstract state clears gil and party (no condition can read them) and keeps everything else', (() => { const a = ES.walk.abstract({ flags: { f: 1 }, items: { i: 2 }, gil: 900, party: ['chr_a'], quests: {}, chapter: 'c', seen: {}, ending: null, run: null }); return a.gil === 0 && a.party.length === 0 && a.flags.f === 1 && a.items.i === 2; })());

  // ---------------------------------------------------------------- 2. The walk alone, over the hand authored story.
  {
    const b = JSON.parse(demoText), S = story(ES, b), idx = ES.index.build(S.story, S.ext);
    const R = ES.walk.run(idx, {}, {});
    const errCodes = R.errors.map((e) => e.code).sort();
    check('the walk finds the hand authored story\'s faults: both halves of the recursive call pair, the backward moves, a move on a failed quest', ['recursion', 'backward', 'failed'].every((c) => errCodes.indexOf(c) >= 0) && R.errors.filter((e) => e.code === 'recursion').length === 2, errCodes);
    check('every runtime error carries the event and a path from a new game', R.errors.every((e) => (e.evt || e.npc) && Array.isArray(e.path) && e.path[0].by === 'newGame'), R.errors.map((e) => e.path.length));
    check('the story has no reachable ending, so every state is stuck and the deepest point is reported', !Object.keys(R.endings).length && R.softlock.count === R.stats.states && !!R.softlock.deepest && R.softlock.deepest.depth === R.stats.maxDepth, R.softlock);
    const R2 = engine().walk.run(engine().index.build(S.story, S.ext), {}, {});
    check('two bare vm contexts walk the hand authored story to the same result byte for byte', J(R) === J(R2));
  }

  // ---------------------------------------------------------------- 3. The scaffolded stories.
  const built = {};
  for (const [fx, text] of [['demo', demoText], ['four', fourText]]) {
    const r = await prepared(text); built[fx] = r;
    const { Kit, STORY, ENGINE_STORY: PES } = r.win;
    const b = Kit.bundle.current(), C = STORY.checks;
    const t0 = Date.now(), res = C.run(b), ms = Date.now() - t0, R = res.run.result, W = res.run.world;
    const mains = STORY.quests.list(b).filter((q) => q.kind === 'main'), sides = STORY.quests.list(b).filter((q) => q.kind === 'side');
    check(fx + ': every chapter entered, every main and side quest completed, every ending reached', STORY.chapters(b).every((c) => R.chapters[c.id]) && mains.every((q) => R.questsDone[q.id]) && sides.every((q) => R.questsDone[q.id]) && STORY.records.list('end_', b).every((e) => R.endings[e.id]), { ch: Object.keys(R.chapters).length, done: Object.keys(R.questsDone).length });
    check(fx + ': no softlock, no runtime error, the walk not capped', R.softlock.count === 0 && !R.errors.length && !R.stats.capped, { s: R.softlock, e: R.errors.slice(0, 2) });
    check(fx + ': the golden path finishes every main quest before its ending, and it is longer than the shortest path to an ending', R.goldenFull && !!R.golden.ending && mains.every((q) => !R.endedWithout[q.id] || R.golden.path.length >= R.endedWithout[q.id].path.length));
    check(fx + ': every gate a new game does not open is set, by a seal chest or a boss, no later on the golden path than where it is first needed', (res.cards.find((c) => c.key === 'proofs').gates || []).every((g) => g.setter && g.setter.evt && /evt_evt_(prize|boss)_/.test(g.setter.evt) && g.site) && (res.cards.find((c) => c.key === 'proofs').gates || []).length === PES.gates.keys(b.world.progression).length - b.world.progression.start.length);
    check(fx + ': all six checks pass (warnings only), proven, and Final is not blocked', res.errors === 0 && res.cards.length === 6 && res.cards.every((c) => c.status !== 'fail') && C.finalBlock(b) === '', res.cards.map((c) => c.key + ' ' + c.status + ' ' + c.items.filter((x) => x.level === 'error').map((x) => x.message).join('; ')));
    check(fx + ': the smells are real and named: shadowed giver pages and unseen offer nodes, the last boss\'s quiet page', has(res, 'smells', 'warning:npc-page-never-wins') && has(res, 'smells', 'warning:unseen-node') && has(res, 'smells', 'warning:page-never-wins') && !has(res, 'smells', 'warning:unreachable-node'), codes(res, 'smells').filter((x, i, a) => a.indexOf(x) === i));
    check(fx + ': the proofs warn that an ending can be reached while an earlier main quest is unfinished, with the path', has(res, 'proofs', 'warning:skippable') && res.cards.find((c) => c.key === 'proofs').items.find((x) => x.code === 'skippable').path.length > 2);
    check(fx + ': every event and person the story uses has a site the walk can place', !W.unknown.length, W.unknown);
    check(fx + ': the results are memoized until the bundle changes', C.run(b) === res && C.ready(b) && (() => { Kit.bundle.touch('test'); return !C.ready(b); })());
    // The walk again in bare vm contexts, from the Draft export and the page's world picture.
    const draft = Kit.buildExport('draft', { engines: true }), db = JSON.parse(draft.files[0].text), engFile = draft.files[2].text;
    const world = JSON.parse(J({ sites: W.sites, events: W.events, npcs: W.npcs }));
    const bare = (text) => { const box = vm.createContext({}); vm.runInContext(text, box); const E2 = box.ENGINE_STORY; const ext2 = JSON.parse(J(STORY.engineExt(Kit.bundle.current()))); const I = E2.index.build({ records: db.story.records, bindings: db.story.bindings, npcDialogue: db.story.npcDialogue }, ext2); return J(E2.walk.run(I, world, { cap: 50000, goal: mains.map((q) => q.id) })); };
    const a1 = bare(engFile), a2 = bare(engFile);
    check(fx + ': two bare vm contexts holding only the exported engine-story.js and the Draft walk to the page\'s exact result', a1 === a2 && a1 === J(C.walk(Kit.bundle.current()).result));
    check(fx + ': the manifest carries the six checks and the walk statistics', JSON.parse(draft.files[1].text).checks.proven === true && JSON.parse(draft.files[1].text).walk.states === R.stats.states && JSON.parse(draft.files[1].text).walk.golden.full === true);
    if (fx === 'demo') fs.writeFileSync(path.join(OUT, 'phase7-demo-walk.json'), J({ story: { records: db.story.records, bindings: db.story.bindings, npcDialogue: db.story.npcDialogue }, ext: STORY.engineExt(Kit.bundle.current()), world, goal: mains.map((q) => q.id) }));
    check(fx + ': the page walks the story in reasonable time under jsdom', ms < 20000, ms);
    if (fx === 'four') check('four: 862 states and 2141 moves, six chapters, eight quests (two side), one ending', R.stats.states === 862 && R.stats.edges === 2141 && Object.keys(R.chapters).length === 6 && Object.keys(R.questsDone).length === 8 && sides.length === 2, R.stats);
  }

  // The walk alone again, over the demo story the page just built (saved by section 3 as plain data).
    // The real demo story, capped.
  {
    const demoWalk = JSON.parse(read(path.join(OUT, 'phase7-demo-walk.json')));
    const idxD = ES.index.build(demoWalk.story, demoWalk.ext);
    const capped = ES.walk.run(idxD, demoWalk.world, { cap: 5, goal: demoWalk.goal });
    check('the cap stops the walk, says so, and leaves the unexplored states out of the softlock proof', capped.stats.capped && capped.stats.states === 5 && capped.stats.frontier > 0 && capped.softlock.count === 0, capped.stats);
    const full = ES.walk.run(idxD, demoWalk.world, { goal: demoWalk.goal });
    check('without the cap the demo story walks to 19 states and 25 moves, every ending reached, nothing stuck', !full.stats.capped && full.stats.states === 19 && full.stats.edges === 25 && Object.keys(full.endings).length === 2 && full.softlock.count === 0 && !full.errors.length, full.stats);
    const noGoal = ES.walk.run(idxD, demoWalk.world, {});
    check('the golden path with the main quests as its goal finishes them all; without a goal it is the shortest path to any ending', full.goldenFull && full.golden.path.length > noGoal.golden.path.length && Object.keys(full.endedWithout).length > 0, { full: full.golden.path.length, any: noGoal.golden.path.length });
    // An event the world cannot place stays open; a site whose flags are unset closes it.
    const onX = (list) => list.reduce((o, k) => { o[k] = { site: 'twn|x' }; return o; }, {});
    const closed = ES.walk.run(idxD, { sites: { 'twn|x': { requires: ['flg_never_zz99'] } }, events: onX(Object.keys(idxD.events)), npcs: onX(Object.keys(idxD.known.npc_)) }, {});
    check('a site whose required flag never holds keeps every event on it closed (only the new game\'s forced events run)', closed.stats.states <= 2 && !Object.keys(closed.endings).length);
  }

  // ---------------------------------------------------------------- 4. Seeded faults, each caught by the right card.
  {
    const { win } = built.demo, { Kit, STORY } = win, C = STORY.checks, E = STORY.events;
    const pristine = J(Kit.bundle.current());
    const fresh = () => { Kit.bundle.load(JSON.parse(pristine)); return Kit.bundle.current(); };
    const touch = () => { Kit.index.invalidate(); Kit.bundle.touch('test'); };
    const evtOf = (b, key) => b.story.records.evt_[E.idFor(key)];
    const chs = (b) => STORY.chapters(b).map((c) => c.id);
    const townMap = (b, chp) => STORY.world.list('twn_', b).find((t) => t.chapter === chp && t.role === 'start').maps[0];
    const put = (b, prefix, name, body) => { const r = STORY.authored(prefix, name, body); b.story.records[prefix][r.id] = r; return r; };

    // References: a command naming a flag that does not exist.
    let b = fresh();
    put(b, 'evt_', 'Broken', { trigger: 'mapEnter', map: townMap(b, chs(b)[0]), kind: 'custom', pages: [{ cmds: [{ op: 'setFlag', flg: 'flg_missing_zz99', value: 1 }] }] });
    touch();
    let res = C.run(b);
    check('references: a command naming a missing flag fails the References card (lint and unresolved) and blocks Final', status(res, 'references') === 'fail' && has(res, 'references', 'error:lint') && has(res, 'references', 'error:unresolved') && /References/.test(C.finalBlock(b)), codes(res, 'references'));
    // The world stamp.
    b = fresh(); delete b.story.settings.worldHash; touch(); res = C.run(b);
    check('references: a story with no world stamp fails with world-unstamped and offers to confirm', has(res, 'references', 'error:world-unstamped') && res.cards[0].items.some((x) => x.action === 'stamp'));
    b = fresh(); const npc0 = Object.keys(b.world.records.npc_)[0]; b.world.records.npc_[npc0].notes = 'changed in Day 148'; touch(); res = C.run(b);
    check('references: a world changed since the story was built fails with world-changed', has(res, 'references', 'error:world-changed') && !C.worldCurrent(b));
    C.stamp(b); res = C.run(b);
    check('confirming the world stamps it and the References card passes again', C.worldCurrent(b) && status(res, 'references') === 'pass');
    b = fresh(); STORY.events.scaffold(b); res = C.run(b);
    check('a scaffold rerun on an unchanged world keeps the stamp and does not touch the bundle', C.worldCurrent(b) && !STORY.events.scaffold(b).changed);

    // Smells and runtime errors in one story.
    b = fresh();
    const map1 = townMap(b, chs(b)[0]);
    const never = put(b, 'flg_', 'Never set', { kind: 'story', default: 0, range: [0, 1] });
    const orphan = put(b, 'flg_', 'Never read', { kind: 'story', default: 0, range: [0, 1] });
    put(b, 'evt_', 'Idle choice', { trigger: 'mapEnter', map: map1, kind: 'custom', pages: [{ cmds: [{ op: 'choice', options: [{ text: 'Left', cmds: [{ op: 'text', lines: ['Left it is.'] }] }, { text: 'Right', cmds: [] }] }] }, { cond: { op: 'flag', flg: never.id, cmp: 'gte', value: 1 }, cmds: [{ op: 'text', lines: ['Never.'] }] }] });
    put(b, 'evt_', 'Orphan setter', { trigger: 'mapEnter', map: map1, kind: 'custom', pages: [{ cmds: [{ op: 'setFlag', flg: orphan.id, value: 1 }] }] });
    const stuckQ = put(b, 'qst_', 'Stuck story', { kind: 'bstory', chapter: chs(b)[0], stages: [{ key: 'a', label: 'A', sets: [] }, { key: 'b', label: 'B', sets: [] }, { key: 'c', label: 'C', sets: [] }], branches: [{ key: 'g', label: 'G', outcomes: [{ key: 'x', label: 'X', sets: [] }, { key: 'y', label: 'Y', sets: [] }] }] });
    put(b, 'evt_', 'Twice decided', { trigger: 'mapEnter', map: map1, kind: 'custom', pages: [{ cmds: [{ op: 'questStage', qst: stuckQ.id, branch: 'g', outcome: 'x' }, { op: 'questStage', qst: stuckQ.id, branch: 'g', outcome: 'y' }] }] });
    put(b, 'evt_', 'Endless', { trigger: 'autorun', map: map1, kind: 'custom', pages: [{ cmds: [{ op: 'text', lines: ['Again.'] }] }] });
    put(b, 'dlg_', 'Unsaid', { kind: 'custom', start: 'a', nodes: { a: { lines: ['Nobody hears this.'] } } });
    touch(); res = C.run(b);
    ['inert-choice', 'read-never-set', 'set-never-read', 'stage-no-exit', 'page-never-wins', 'unused-dialogue'].forEach((code) => check('smells: ' + code + ' is reported as a warning', has(res, 'smells', 'warning:' + code), codes(res, 'smells').filter((x, i, a) => a.indexOf(x) === i)));
    check('smells never fail a story on their own', status(res, 'smells') === 'warn');
    check('the walk: deciding a branch group twice is a runtime error with the event and its path', has(res, 'walk', 'error:run-closed') && res.cards.find((c) => c.key === 'walk').items.find((x) => x.code === 'run-closed').path.length >= 1);
    check('the walk: an autorun that changes nothing and passes again is an error (the player would be stuck in it)', has(res, 'walk', 'error:run-autorun-loop'), codes(res, 'walk'));
    check('the B story that never completes is a proof warning, not an error', has(res, 'proofs', 'warning:bstory') && !has(res, 'proofs', 'error:bstory'));

    // The cap.
    b = fresh(); b.story.settings.walkCap = 4; touch(); res = C.run(b);
    check('the cap: a warning that names it, the proofs cannot pass, and no false softlock', has(res, 'walk', 'warning:cap') && /cap of 4/.test(res.cards.find((c) => c.key === 'walk').items[0].message) && status(res, 'proofs') === 'fail' && !has(res, 'softlock', 'error:softlock') && has(res, 'softlock', 'warning:cap'));

    // Proofs: the first seal is never set.
    b = fresh();
    const prize1 = evtOf(b, 'evt|prize|' + chs(b)[0]);
    prize1.pages[1].cmds = prize1.pages[1].cmds.filter((c) => c.op !== 'setFlag'); prize1.origin = 'user'; delete prize1.gen;
    touch(); res = C.run(b);
    check('proofs: with the first seal never set, its gate never opens, chapter two is never entered, a main quest and the endings are never reached', ['error:gate-never', 'error:chapter', 'error:main-quest', 'error:ending'].every((c) => has(res, 'proofs', c)), codes(res, 'proofs'));
    check('no softlock card: nothing reaches an ending, so it reports where progress stops, with the path and the quests at that point', has(res, 'softlock', 'error:no-finish') && res.cards.find((c) => c.key === 'softlock').items[0].path.length >= 1 && res.cards.find((c) => c.key === 'softlock').items[0].quests.length >= 1);

    // Proofs: the ship opens later on the golden path than where it is first needed.
    b = fresh();
    const boss1 = evtOf(b, 'evt|boss|' + chs(b)[0]), shipFlg = b.story.bindings['vehicle:ship'].flg;
    const strip2 = (list) => list.map((c) => { const o = JSON.parse(J(c)); if (o.op === 'startBattle') o.win = o.win.filter((w) => !(w.op === 'setFlag' && w.flg === shipFlg)); return o; });
    boss1.pages[1].cmds = strip2(boss1.pages[1].cmds); boss1.origin = 'user'; delete boss1.gen;
    const shipGiver = put(b, 'evt_', 'Harbor master', { trigger: 'mapEnter', map: townMap(b, chs(b)[1]), kind: 'custom', pages: [{ cond: { op: 'flag', flg: shipFlg, cmp: 'lt', value: 1 }, cmds: [{ op: 'setFlag', flg: shipFlg, value: 1 }] }] });
    touch(); res = C.run(b);
    const go = res.cards.find((c) => c.key === 'proofs').items.find((x) => x.code === 'gate-order');
    check('proofs: a gate set by something later on the golden path than its first reader fails gate-order, naming both places', !!go && go.recordId === shipGiver.id && /vehicle:ship/.test(go.message) && /gate\|/.test(go.message), codes(res, 'proofs'));
    check('the story still finishes, so that is the only failing proof', res.cards.find((c) => c.key === 'proofs').items.filter((x) => x.level === 'error').length === 1 && status(res, 'softlock') === 'pass');

    // Proofs: an ending no condition reaches, and a side quest nothing completes.
    b = fresh();
    const lost = put(b, 'flg_', 'Lost cause', { kind: 'story', default: 0, range: [0, 1] });
    put(b, 'end_', 'Unreachable', { cond: { op: 'flag', flg: lost.id, cmp: 'gte', value: 1 }, priority: 50 });
    put(b, 'qst_', 'Forever side', { kind: 'side', chapter: chs(b)[0], stages: [{ key: 'a', label: 'A', sets: [] }, { key: 'b', label: 'B', sets: [] }] });
    touch(); STORY.events.refreshFinale(b); touch(); res = C.run(b);
    check('proofs: an ending whose condition never holds is never reached, and a side quest nothing completes fails', has(res, 'proofs', 'error:ending') && has(res, 'proofs', 'error:side-quest'), codes(res, 'proofs'));

    // No softlock: a choice that makes the boss unbeatable.
    b = fresh();
    const doom = put(b, 'flg_', 'Doom', { kind: 'story', default: 0, range: [0, 1] });
    put(b, 'evt_', 'Crossroads', { trigger: 'mapEnter', map: map1, kind: 'custom', pages: [{ once: true, cmds: [{ op: 'choice', prompt: 'Which way?', options: [{ text: 'Stay', cmds: [] }, { text: 'Doom', cmds: [{ op: 'setFlag', flg: doom.id, value: 1 }] }] }] }] });
    const boss1b = evtOf(b, 'evt|boss|' + chs(b)[0]);
    boss1b.pages[1].cond = { op: 'all', of: [boss1b.pages[1].cond, { op: 'flag', flg: doom.id, cmp: 'lt', value: 1 }] }; boss1b.origin = 'user'; delete boss1b.gen;
    touch(); res = C.run(b);
    const trap = res.cards.find((c) => c.key === 'softlock').items.find((x) => x.code === 'softlock');
    check('no softlock: choosing Doom (which makes the boss unbeatable) is reported as a trap whose path ends with that choice', !!trap && /"Doom"/.test(trap.path[trap.path.length - 1]) && status(res, 'softlock') === 'fail', trap);
    check('every chapter, quest, and ending is still reachable another way, so only the softlock card fails', status(res, 'proofs') !== 'fail' && res.cards.filter((c) => c.status === 'fail').map((c) => c.key).join() === 'softlock');
    check('Final is refused, naming the No softlock card', /No softlock/.test(C.finalBlock(b)));

    // The floor.
    b = fresh(); b.charter.sections.chapters[0].targetMinutes = 10; touch(); res = C.run(b);
    check('the floor: chapters short of 720 minutes fail the floor card', has(res, 'floor', 'error:floor') && /short of the 720/.test(res.cards.find((c) => c.key === 'floor').items[0].message));
    Kit.bundle.load(JSON.parse(pristine));
  }

  // ---------------------------------------------------------------- 5. Final export.
  {
    const { win } = built.demo, { Kit, STORY } = win;
    const b0 = JSON.parse(J(Kit.bundle.current()));
    b0.story.settings.walkCap = 4; Kit.bundle.load(JSON.parse(J(b0))); await wait(10);
    let err = null; try { Kit.buildExport('final'); } catch (e) { err = e.message; }
    check('Final is refused while a story check fails, naming the card and the first reason', /story checks? fails?/.test(err || '') && /The proofs/.test(err || '') && Kit.bundle.current().kit.opened.indexOf('story') < 0, err);
    b0.story.settings.walkCap = 50000; Kit.bundle.load(JSON.parse(J(b0))); await wait(10);
    const fin = Kit.buildExport('final');
    const fb = JSON.parse(fin.files[0].text), fman = JSON.parse(fin.files[1].text);
    check('a proven story exports Final: story opened, forge 149 final, the manifest proven with its walk', fb.kit.opened.indexOf('story') >= 0 && fb.kit.forges['149'].status === 'final' && fman.checks.proven === true && fman.checks.cards.length === 6 && fman.walk.states === 19 && fman.walk.softlocks === 0 && !fman.unresolved.length, { opened: fb.kit.opened, checks: fman.checks && fman.checks.errors });
    check('the Final carries the world stamp, equal to the hash of its world', fb.story.settings.worldHash === fman.checks.worldHash && fman.checks.worldHash === fman.checks.worldStamp);
    for (const [k, fn] of [['146', in146], ['147', in147], ['148', in148]]) {
      const r = await fn(fin.files[0].text);
      check('Day ' + k + ' opens the 149 Final: 0 errors, 0 broken, 0 forward', r.matches && !r.summary.errors && !r.summary.broken && !r.summary.forward, r.rejected || r.summary);
    }
  }

  // ---------------------------------------------------------------- 6. The Validation tab.
  {
    const r6 = await prepared(demoText), { win, errors } = r6, { Kit, STORY } = win, d = win.document, C = STORY.checks;
    const ws = () => d.getElementById('ws');
    const btn = (re, root) => Array.from((root || d).querySelectorAll('button')).find((x) => re.test(x.textContent));
    Kit.go('export');
    check('the tab first draws a waiting card and never walks while drawing', !!ws().querySelector('.vc-card[data-check="waiting"]') && !C.ready() && /waits for the story checks/.test(ws().textContent));
    await wait(400);
    const cards = () => Array.from(ws().querySelectorAll('.vc-card')).map((c) => c.getAttribute('data-check'));
    check('then six cards, warnings before passes, and a Proven chip', cards().length === 6 && cards()[0] === 'smells' && /Proven/.test(ws().textContent), cards());
    check('the Final card is enabled once the story is proven', !d.querySelector('#ws input[value=final]').disabled && /Opens the story namespace/.test(ws().textContent));
    check('the manifest preview no longer blocks on the walk and the validator findings fold away', !!ws().querySelector('details.vc-path') && /Created\d+ story IDs/.test(ws().textContent));
    const smells = ws().querySelector('.vc-card[data-check="smells"]');
    check('a card shows six findings and a Show more button', smells.querySelectorAll('.vc-item').length === 6 && !!btn(/^Show \d+ more$/, smells));
    btn(/^Show \d+ more$/, smells).click(); await wait(20);
    const smells2 = ws().querySelector('.vc-card[data-check="smells"]');
    check('Show more lists every finding, then Show fewer', smells2.querySelectorAll('.vc-item').length === C.run().cards.find((c) => c.key === 'smells').items.length && !!btn(/^Show fewer$/, smells2));
    const proofs = ws().querySelector('.vc-card[data-check="proofs"]');
    check('the proofs card lists the gates in golden order with who opens each', !!proofs.querySelector('.vc-gates') && proofs.querySelectorAll('.vc-gates tbody tr').length === 4 && /Seal chest/.test(proofs.textContent));
    check('a skippable main quest shows its path as a numbered list', !!proofs.querySelector('.vc-item details.vc-path ol li'));
    // Jumps.
    const pageItem = Array.from(ws().querySelectorAll('.vc-card[data-check="smells"] .vc-item')).find((x) => /Page \d never runs/.test(x.textContent));
    btn(/^Jump$/, pageItem).click(); await wait(30);
    check('Jump on an event page opens the Events tab', Kit.active() === 'events');
    Kit.go('export'); await wait(30);
    const npcItem = Array.from(ws().querySelectorAll('.vc-card[data-check="smells"] .vc-item')).find((x) => /never wins/.test(x.textContent) && /Elder/.test(x.textContent));
    btn(/^Jump$/, npcItem).click(); await wait(30);
    check('Jump on a person\'s page opens the Dialogue tab on its People view', Kit.active() === 'dialogue' && STORY.dialogueUi.view === 'people');
    Kit.go('export'); await wait(30);
    // A failing story: the floor card first.
    const b = Kit.bundle.current(); b.story.settings.walkCap = 4; Kit.index.invalidate(); Kit.bundle.touch('test'); Kit.rerender(); await wait(400);
    check('a failing card comes first and the Final card is disabled with the reason', cards()[0] === 'proofs' && d.querySelector('#ws input[value=final]').disabled && /story checks? fails?/.test(ws().textContent), cards());
    btn(/^Jump$/, ws().querySelector('.vc-card[data-check="proofs"]')).click(); await wait(30);
    check('Jump on an unreached chapter opens the Quests tab at its main quest', Kit.active() === 'quests');
    b.story.settings.walkCap = 50000; Kit.index.invalidate(); Kit.bundle.touch('test');
    // Confirm this world.
    delete b.story.settings.worldHash; Kit.index.invalidate(); Kit.bundle.touch('test');
    Kit.go('export'); await wait(400);
    const conf = btn(/^Confirm this world$/, ws());
    check('an unstamped story offers Confirm this world on the References card, which fails', !!conf && cards()[0] === 'references');
    conf.click(); await wait(20);
    btn(/^Confirm the world$/, d.getElementById('overlays')).click(); await wait(450);
    check('confirming stamps the world and the story is proven again', C.worldCurrent() && /Proven/.test(ws().textContent) && cards()[0] !== 'references');
    btn(/^Walk again$/, ws()).click();
    check('Walk again forgets the results and shows the waiting card', !!ws().querySelector('.vc-card[data-check="waiting"]'));
    await wait(400);
    check('and then the cards again', cards().length === 6);
    check('no script errors on the page through all of it', errors.length === 0, errors.slice(0, 2));
    win.close();
  }

  // ---------------------------------------------------------------- 7. Two pages agree; the round trip.
  {
    const p1 = await prepared(fourText), p2 = await prepared(fourText);
    const s1 = J(p1.win.STORY.checks.summary()) + J(p1.win.STORY.checks.walkStats()), s2 = J(p2.win.STORY.checks.summary()) + J(p2.win.STORY.checks.walkStats());
    check('two fresh pages prove the four continent story to the same summary and walk statistics byte for byte', s1 === s2);
    check('and stamp the same world hash into the same story', canon(p1.win.Kit.bundle.current().story) === canon(p2.win.Kit.bundle.current().story) && !!p1.win.STORY.checks.stamped());
    const { Kit } = p1.win, draft = Kit.buildExport('draft', { engines: false }), db = JSON.parse(draft.files[0].text);
    const probe = (how) => async (w, K) => { const cb = K.bundle.current(); let err = null; try { K.buildExport(how, { engines: false }); } catch (e4) { err = e4.message; } return { same: ['charter', 'codex', 'rules', 'art', 'world', 'story'].filter((k) => J(cb[k] || null) !== J(db[k] || null)), err }; };
    const rr = { 146: await in146(draft.files[0].text, probe('draft')), 147: await in147(draft.files[0].text, probe('draft')), 148: await in148(draft.files[0].text, probe('final')) };
    Object.keys(rr).forEach((k) => check('Day ' + k + ' opens the stamped Draft: hash verified, every namespace identical (story and its stamp included), no errors', rr[k].matches && !rr[k].errors.length && !rr[k].broken.length && !rr[k].err && !rr[k].same.length, { m: rr[k].matches, e: (rr[k].errors || []).slice(0, 2), err: rr[k].err, same: rr[k].same }));
    p2.win.Kit.bundle.importText(draft.files[0].text); await wait(20);
    check('the Draft reopens here proven, with its stamp current and nothing to rebuild', p2.win.STORY.checks.worldCurrent() && p2.win.STORY.checks.run().errors === 0 && !p2.win.STORY.events.scaffold().changed);
    p1.win.close(); p2.win.close();
  }
  built.demo.win.close(); built.four.win.close();

  const n = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(J(x.detail)).slice(0, 900))));
  fs.writeFileSync(path.join(OUT, 'phase7-report.json'), J({ passed: n, total: results.length, results }, null, 1));
  console.log('\n' + n + ' of ' + results.length + ' passed');
  process.exit(n === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
