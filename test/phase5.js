// Phase 5 acceptance: events and cutscenes (STORY.events in src/story-events.js, the Events tab in src/ws-events.js).
// 1. static: sources ASCII clean, no forbidden APIs, no dashes in UI prose, fences in order, no engine code changed;
// 2. the scaffold on both fixtures: six kinds, structural IDs, sites from the world, boss slots, idempotent, clean;
// 3. the golden path through the events alone, replayed byte for byte in two bare vm contexts from a Draft export;
// 4. endings feed the finale; edits survive a rebuild; orphans become the author's; the edit API and its refusals;
// 5. the Events tab under jsdom: list, pages, the nested command editor, the boss slot picker, the golden path, and the
//    playtester with Continue, choices, Win and Lose, Back, carry on, and the inspector;
// 6. two fresh pages build the same events; the round trip through Days 146, 147, 148.
// Run from test/.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { engine, ext } = require('./storyfx');
const { boot149, wait, ROOT } = require('./story');
const { in146, in147, in148 } = require('./compat');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
const J = JSON.stringify;
const OUT = path.join(__dirname, 'out');
const demoText = fs.readFileSync(path.join(OUT, 'demo148-bundle.json'), 'utf8');
const fourText = fs.readFileSync(path.join(OUT, 'four148-bundle.json'), 'utf8');
const canon = (v) => { if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => J(k) + ':' + canon(v[k])).join(',') + '}'; return J(v); };
const git = (cmd) => { try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString(); } catch (e) { return null; } };

async function prepared(text) {
  const r = await boot149();
  const { Kit, STORY } = r.win;
  Kit.bundle.importText(text); await wait(20);
  const b = Kit.bundle.current();
  STORY.quests.scaffold(b); STORY.dialogue.scaffold(b); STORY.flags.sync(b);
  return r;
}

(async () => {
  // ---------------------------------------------------------------- 1. Static.
  const names = ['story-events.js', 'ws-events.js', 'story-events.css'];
  const files = names.map((f) => path.join(ROOT, 'src', f));
  const read = (f) => fs.readFileSync(f, 'utf8');
  check('the three new sources exist and are pure ASCII', files.every((f) => fs.existsSync(f) && !/[^\x00-\x7f]/.test(read(f))));
  const forbidden = /roundRect|\.ellipse\(|window\.confirm|\beval\(|new Function|[^.\w]confirm\(|\.remove\(\)|localStorage|Math\.random/;
  check('no forbidden APIs in the new JavaScript (and no randomness or storage of its own)', files.slice(0, 2).every((f) => !forbidden.test(read(f))));
  const dashRe = new RegExp('\\u2013|\\u2014|\'[^\'\\n]*[A-Za-z] - [A-Za-z][^\'\\n]*\'');
  const strip = (t) => t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('no dashes used as punctuation in the new prose', files.slice(0, 2).every((f) => !dashRe.test(strip(read(f)))));
  const html = read(path.join(ROOT, 'index.html'));
  const at = (m) => html.indexOf(m);
  check('index.html carries STORY:EVENTS after STORY:DIALOGUE, WS:EVENTS after WS:DIALOGUE, and the events CSS fence', at('STORY:EVENTS BEGIN') > at('STORY:DIALOGUE END') && at('WS:EVENTS BEGIN') > at('WS:DIALOGUE END') && at('WS:EVENTS BEGIN') < at('WS:STORY149 BEGIN') && at('STORY:EVENTS CSS BEGIN') > 0 && html.split('// === STORY:EVENTS BEGIN ===').length === 2);
  const engineFiles = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /^engine-/.test(f));
  const changed = engineFiles.filter((f) => { const h = git('git show HEAD:src/' + f); return h !== null && h !== read(path.join(ROOT, 'src', f)); });
  check('Phase 5 changes no engine code: every src/engine-*.js equals the last commit', changed.length === 0, changed);
  const rootEng = read(path.join(ROOT, 'engine-story.js')), headRoot = git('git show HEAD:engine-story.js');
  check('the standalone engine-story.js is byte for byte what Phase 4 shipped', headRoot === null || headRoot === rootEng);

  // ---------------------------------------------------------------- 2. The scaffold on both fixtures.
  const want = { demo: { open: 2, talk: 2, prize: 2, boss: 2, exit: 1, finale: 1 }, four: { open: 6, talk: 6, prize: 6, boss: 6, exit: 5, finale: 1 } };
  const built = {};
  for (const [fx, text] of [['demo', demoText], ['four', fourText]]) {
    const { win, errors } = await prepared(text);
    const { Kit, STORY, ENGINE_STORY: ES } = win, E = STORY.events, b = Kit.bundle.current();
    const before = canon({ charter: b.charter, codex: b.codex, rules: b.rules, art: b.art, world: b.world });
    const flagsBefore = Object.keys(b.story.records.flg_).length;
    const rep = E.scaffold(b);
    const recs = Object.values(b.story.records.evt_), by = {};
    recs.forEach((r) => { by[r.kind] = (by[r.kind] || 0) + 1; });
    check(fx + ': the scaffold builds every kind the world asks for (' + J(want[fx]) + ')', J(Object.keys(by).sort().reduce((o, k) => (o[k] = by[k], o), {})) === J(Object.keys(want[fx]).sort().reduce((o, k) => (o[k] = want[fx][k], o), {})) && rep.created.length === recs.length, by);
    check(fx + ': every event ID derives from its structural key, and every generated event carries gen equal to its own digest', recs.every((r) => r.id === ES.ids.structural('evt_', r.key) && r.origin === 'generated' && r.gen === E.genOf(r) && !E.isEdited(r)));
    check(fx + ': records are filed in sorted order', J(Object.keys(b.story.records.evt_)) === J(Object.keys(b.story.records.evt_).sort()));
    const idx = STORY.engineIndex(b);
    const probs = recs.map((r) => [r.id, E.check(r, b, idx).filter((p) => p.level === 'error' || (p.level === 'warning' && p.code !== 'no-ending' && p.code !== 'unscored'))]).filter((x) => x[1].length);
    check(fx + ': no event has an error or an unexpected warning (the finale says endings are still to come)', !probs.length && E.check(recs.find((r) => r.kind === 'finale'), b, idx).some((p) => p.code === 'no-ending'), probs.slice(0, 2));
    const v = Kit.refreshValidation();
    check(fx + ': KIT:CORE validation has no errors and no broken references after the scaffold', !v.errors.length && !v.broken.length, v.errors.slice(0, 3).map((x) => x.recordId + ' ' + x.message));
    check(fx + ': the scaffold never touches charter, codex, rules, art, or world', canon({ charter: b.charter, codex: b.codex, rules: b.rules, art: b.art, world: b.world }) === before);
    const fin = E.finaleFlag();
    check(fx + ': the finale flag exists with its structural ID and the opener and finale once pages got their save slots', b.story.records.flg_[fin] && b.story.records.flg_[fin].key === 'flg|story|finale' && b.story.scaffold['flg|story|finale'] === fin &&
      recs.filter((r) => r.pages.some((p) => p.once)).every((r) => b.story.records.flg_[ES.ids.structural('flg_', 'flg|once|' + r.id)]) && Object.keys(b.story.records.flg_).length > flagsBefore);
    const snap = canon(b.story);
    const rep2 = E.scaffold(b);
    check(fx + ': a second run changes nothing', !rep2.changed && canon(b.story) === snap && /up to date/.test(E.reportText(rep2)));
    // Sites from the world.
    const world = b.world, zb = world.zones.bosses;
    const bosses = recs.filter((r) => r.kind === 'boss');
    check(fx + ': every boss event steps on the boss cell Day 148 placed, and starts the world troop where there is one', bosses.every((r) => { const z = zb.find((x) => x.site === r.dgn); const sb = r.pages[1].cmds.find((c) => c.op === 'startBattle'); return z && r.trigger === 'step' && r.map === z.map && J(r.at) === J(z.at) && (!z.troop || sb.trp === z.troop) && !!r.slot === !z.troop; }));
    const prizes = recs.filter((r) => r.kind === 'prize');
    check(fx + ': every seal chest steps on the prize chest of its key dungeon and sets that chapter\'s seal flag', prizes.every((r) => {
      const feats = world.records.map_[r.map].features; const f = feats.find((x) => x.kind === 'chest' && x.prize && J(x.at) === J(r.at));
      const seal = b.story.bindings['item:seal:' + r.chapter].flg;
      return f && f.item === 'item:seal:' + r.chapter && r.pages[1].cmds.some((c) => c.op === 'setFlag' && c.flg === seal && c.value === 1) && r.pages[1].cond && r.pages[1].cond.flg === seal;
    }));
    const ow = Object.values(world.records.map_).find((m) => m.kind === 'overworld');
    const exits = recs.filter((r) => r.kind === 'exit');
    check(fx + ': every exit steps on its overworld gate cell, completes the chapter, and runs the next opener', exits.every((r) => {
      const gates = ow.gates.filter((g) => g.cells && g.cells.some((c) => J(c) === J(r.at)));
      const cmds = r.pages[0].cmds;
      return r.map === ow.id && gates.length >= 1 && cmds.some((c) => c.op === 'questStage' && c.stage === 'done') && cmds.some((c) => c.op === 'callEvent' && b.story.records.evt_[c.evt] && b.story.records.evt_[c.evt].kind === 'open');
    }));
    const opens = recs.filter((r) => r.kind === 'open').sort((x, y) => b.charter.sections.chapters.findIndex((c) => c.id === x.chapter) - b.charter.sections.chapters.findIndex((c) => c.id === y.chapter));
    check(fx + ': openers fire at chapter start once, play the continent\'s field role, and after the first wait for the previous chapter', opens.every((r, i) => r.trigger === 'chapterStart' && r.pages[0].once === true &&
      r.pages[0].cmds.some((c) => c.op === 'music' && /^field:[a-z0-9_]+$/.test(c.role)) && (i === 0 ? r.pages[0].cond.op === 'chapter' : r.pages[0].cond.op === 'all' && r.pages[0].cond.of[1].is === 'done')));
    const talks = recs.filter((r) => r.kind === 'talk');
    check(fx + ': every main quest giver has a talk event that only moves the first stage, so the rest falls through to their dialogue', talks.length === want[fx].talk && talks.every((r) => r.trigger === 'talk' && b.story.npcDialogue[r.npc] && r.pages.every((p) => p.cond.op === 'quest' && p.cond.is === 'at' && p.cmds.some((c) => c.op === 'questStage'))));
    const finale = recs.find((r) => r.kind === 'finale'), lastBoss = bosses.find((r) => r.pages[1].cmds.find((c) => c.op === 'startBattle').win.some((c) => c.op === 'setFlag' && c.flg === fin));
    check(fx + ': the finale is an autorun on the finale boss map, once, on the finale flag the last boss win sets', finale.trigger === 'autorun' && lastBoss && finale.map === lastBoss.map && finale.pages[0].once === true && finale.pages[0].cond.flg === fin);
    built[fx] = { b: JSON.parse(J(b)), win, errors };
    check(fx + ': the page raised no errors', !errors.length, errors.slice(0, 2));
  }
  // Empty boss slots: the default pick, then a chosen troop.
  {
    const { win } = built.demo, E = win.STORY.events, b = win.Kit.bundle.current();
    const slot = E.bosses(b).find((x) => x.slot);
    check('demo: The Lowlands is an empty slot filled by default with its chapter\'s largest troop (ties by ID)', slot && slot.chapter === 'chp_the_lowlands_auem' && slot.troop === 'trp_lowland_pack_r3w4' && !slot.chosen);
    const bossId = Object.values(b.story.records.evt_).find((r) => r.kind === 'boss' && r.dgn === slot.dgn).id;
    const r1 = E.setBossTroop(slot.dgn, 'trp_lowland_slimes_ubsv');
    const ev = b.story.records.evt_[bossId];
    check('choosing a troop stores it in story.settings.bossTroops and refreshes the unedited boss event', r1.ok && r1.refreshed && b.story.settings.bossTroops[slot.dgn] === 'trp_lowland_slimes_ubsv' && ev.pages[1].cmds.find((c) => c.op === 'startBattle').trp === 'trp_lowland_slimes_ubsv' && !E.isEdited(ev));
    const wb = E.bosses(b).find((x) => !x.slot);
    check('a boss slot the world fills cannot be overridden from the story, and an unknown troop is refused', !E.setBossTroop(wb.dgn, 'trp_lowland_slimes_ubsv').ok && !E.setBossTroop(slot.dgn, 'trp_nope').ok);
    E.setBossTroop(slot.dgn, null);
    check('clearing the choice goes back to the default and removes the empty settings entry', b.story.settings.bossTroops === undefined && b.story.records.evt_[bossId].pages[1].cmds.find((c) => c.op === 'startBattle').trp === 'trp_lowland_pack_r3w4');
    check('Day 150 can resolve every boss: the world troop when set, else the troop of the story boss event naming the dungeon', E.bosses(b).every((x) => { const e = Object.values(b.story.records.evt_).find((r) => r.kind === 'boss' && r.dgn === x.dgn); return (x.slot ? e.slot === true : !e.slot) && e.pages[1].cmds.find((c) => c.op === 'startBattle').trp === x.troop; }));
  }

  // ---------------------------------------------------------------- 3. The golden path, in the page and in two bare vm contexts.
  for (const fx of ['demo', 'four']) {
    const { win } = built[fx], { Kit, STORY, ENGINE_STORY: ES } = win, E = STORY.events, b = Kit.bundle.current();
    const g = E.golden(b), g2 = E.golden(b);
    const mains = Object.values(b.story.records.qst_).filter((q) => q.kind === 'main');
    const allDone = mains.every((q) => g.state.quests[q.id].stage === q.stages[q.stages.length - 1].key && !g.state.quests[q.id].failed);
    const n = want[fx];
    check(fx + ': the golden path through events alone completes every main quest (' + mains.length + ') and reaches the finale', allDone && g.steps.length === n.open - n.exit + n.talk + n.prize + n.boss + n.exit + n.finale && g.steps[g.steps.length - 1].name === 'Finale' && g.state.chapter === b.charter.sections.chapters[b.charter.sections.chapters.length - 1].id, g.steps.map((s) => s.name));
    check(fx + ': it visits opener, giver, seal, boss, exit in order each chapter, and every seal and gate flag ends set', /^Opener/.test(g.steps[0].name) && /^Talk/.test(g.steps[1].name) && /^Seal/.test(g.steps[2].name) && /^Boss/.test(g.steps[3].name) && (fx === 'demo' ? /^Exit/.test(g.steps[4].name) : /^Exit/.test(g.steps[4].name)) &&
      Object.values(b.story.bindings).every((bd) => ES.state.flag(g.state, STORY.engineIndex(b), bd.flg) >= 1));
    check(fx + ': the golden path is deterministic (same state hash twice)', ES.state.hash(g.state) === ES.state.hash(g2.state) && J(g.steps) === J(g2.steps));
    // Replay from a Draft export in two bare vm contexts, the way Day 150 will hold only the engine and the bundle.
    const draft = JSON.parse(Kit.buildExport('draft', { engines: false }).files[0].text);
    const A = engine(rootEng), B = engine(rootEng);
    const replay = (X) => {
      const idx = X.index.build({ records: draft.story.records, bindings: draft.story.bindings, npcDialogue: draft.story.npcDialogue }, ext(draft));
      let s0 = X.state.create(idx, {});
      g.steps.forEach((step) => {
        let r = X.run.start(s0, step.evt, idx);
        for (let k = 0; k < 5000 && !r.done; k++) r = r.waiting === 'choice' ? X.run.choose(r.state, r.effect.options[0].index, idx) : r.waiting === 'battle' ? X.run.resolve(r.state, 'win', idx) : X.run.step(r.state, idx);
        s0 = r.state;
      });
      return { hash: X.state.hash(s0), digest: idx.digest };
    };
    const ra = replay(A), rb = replay(B);
    check(fx + ': two bare vm contexts holding only engine-story.js and the Draft replay the golden path to the page\'s exact state', ra.hash === rb.hash && ra.hash === ES.state.hash(g.state) && ra.digest === STORY.engineIndex(b).digest, { ra, rb, page: ES.state.hash(g.state) });
  }

  // ---------------------------------------------------------------- 4. Endings, edits, orphans, the edit API.
  {
    const { win } = built.demo, { Kit, STORY, ENGINE_STORY: ES } = win, E = STORY.events, b = Kit.bundle.current();
    const finId = E.idFor('evt|finale');
    const always = STORY.authored('end_', 'Delivered', { priority: 0, cond: { op: 'true' }, music: 'ending:1' });
    const rare = STORY.authored('end_', 'Kept', { priority: 10, cond: { op: 'flag', flg: E.finaleFlag(), cmp: 'gte', value: 2 }, music: 'ending:2' });
    b.story.records.end_[always.id] = always; b.story.records.end_[rare.id] = rare; Kit.index.invalidate(); Kit.bundle.touch('test');
    check('two hand made endings are in place (Phase 6 will generate them)', !!b.story.records.end_[always.id] && !!b.story.records.end_[rare.id]);
    const rep = E.scaffold(b);
    const fin = b.story.records.evt_[finId], cmds = fin.pages[0].cmds;
    const top = cmds.find((c) => c.op === 'if');
    check('rebuilding refreshes the unedited finale into an ending chain: highest priority first, the always ending as the last else', rep.refreshed.indexOf(finId) >= 0 && top && top.cond.flg === E.finaleFlag() && top.then.some((c) => c.op === 'ending' && c.end === rare.id) && top['else'].some((c) => c.op === 'ending' && c.end === always.id) && top.then[0].op === 'music' && top.then[0].role === 'ending:2');
    check('the finale no longer warns about a missing ending', !E.check(fin, b, STORY.engineIndex(b)).some((p) => p.code === 'no-ending'));
    const g = E.golden(b);
    check('the golden path now ends the game on the fallback ending', g.ended === always.id && !g.stuck);
    // An edit survives a rebuild that would otherwise refresh the event.
    const bossEv = Object.values(b.story.records.evt_).find((r) => r.kind === 'boss' && r.slot);
    const r0 = E.updatePage(bossEv.id, 1, { cmds: [{ op: 'text', lines: ['A custom warning.'] }].concat(bossEv.pages[1].cmds) });
    check('editing a page of a generated event marks it edited and keeps its origin', r0.ok && E.isEdited(b.story.records.evt_[bossEv.id]) && b.story.records.evt_[bossEv.id].origin === 'generated');
    const r1 = E.setBossTroop(bossEv.dgn, 'trp_lowland_slimes_ubsv');
    check('a new troop for an edited boss event is stored but the event is kept as the author left it', r1.ok && r1.kept && !r1.refreshed && b.story.records.evt_[bossEv.id].pages[1].cmds[0].lines[0] === 'A custom warning.');
    const rep2 = E.scaffold(b);
    check('a rebuild reports the edited event as kept and leaves it alone', rep2.kept.indexOf(bossEv.id) >= 0 && b.story.records.evt_[bossEv.id].pages[1].cmds[0].lines[0] === 'A custom warning.' && E.expected(b).stale === 0);
    const r2 = E.reset(bossEv.id);
    check('Reset to generated brings back the scaffold\'s event with the chosen troop', r2.ok && !E.isEdited(r2.record) && r2.record.pages[1].cmds.find((c) => c.op === 'startBattle').trp === 'trp_lowland_slimes_ubsv');
    // Orphans: a talk event the quests no longer ask for.
    const q1 = Object.values(b.story.records.qst_).find((q) => q.kind === 'main' && q.chapter === 'chp_the_lowlands_auem');
    const q2 = Object.values(b.story.records.qst_).find((q) => q.kind === 'main' && q.chapter === 'chp_the_far_shore_izf4');
    const talk1 = E.idFor('evt|talk|' + q1.giver), talk2 = E.idFor('evt|talk|' + q2.giver);
    const town = Object.values(b.world.records.twn_).find((t) => t.chapter === 'chp_the_lowlands_auem' && t.role === 'start');
    const other1 = town.people.find((p) => p !== q1.giver);
    E.updatePage(talk1, 0, { once: true });
    STORY.quests.update(q1.id, { giver: other1 }, b);
    const town2 = Object.values(b.world.records.twn_).find((t) => t.chapter === 'chp_the_far_shore_izf4' && t.role === 'start');
    STORY.quests.update(q2.id, { giver: town2.people.find((p) => p !== q2.giver) }, b);
    const rep3 = E.scaffold(b);
    check('when a giver changes, the old unedited talk event is dropped and the edited one becomes the author\'s', rep3.removed.indexOf(talk2) >= 0 && !b.story.records.evt_[talk2] && rep3.orphaned.indexOf(talk1) >= 0 && b.story.records.evt_[talk1].origin === 'user' && b.story.records.evt_[talk1].gen === undefined && !!b.story.records.evt_[E.idFor('evt|talk|' + other1)]);
    // The edit API refuses changes that add an error.
    const op = Object.values(b.story.records.evt_).find((r) => r.kind === 'open');
    const snap = canon(b.story.records.evt_);
    const bad = [
      E.setCmds(op.id, 0, op.pages[0].cmds.concat([{ op: 'startBattle', win: [] }])),
      E.setCmds(op.id, 0, op.pages[0].cmds.concat([{ op: 'questStage', qst: q1.id, stage: 'nowhere' }])),
      E.update(op.id, { trigger: 'step' }),
      E.removePage(op.id, 0),
      E.update(op.id, { name: '  ' }),
      E.add({ name: 'Nobody', trigger: 'talk' })];
    check('the edit API refuses a battle without a troop, a missing stage, a step without a site, the last page, a blank name, and a talk event without a person, writing nothing', bad.every((r) => !r.ok) && canon(b.story.records.evt_) === snap, bad.map((r) => r.ok));
    const added = E.add({ name: 'Bell tower', trigger: 'step', map: op.map || Object.keys(b.world.records.map_)[0], at: [2, 3], chapter: 'chp_the_lowlands_auem' });
    check('a hand made event gets a minted ID, origin user, kind custom, and one empty page', added.ok && added.record.origin === 'user' && added.record.kind === 'custom' && added.record.pages.length === 1 && /^evt_/.test(added.record.id) && added.record.key === 'user|' + added.record.id);
    const rep4 = E.scaffold(b);
    check('a rebuild keeps the hand made event', !!b.story.records.evt_[added.record.id] && rep4.removed.indexOf(added.record.id) < 0);
    // The command tree.
    const T = E.tree, l0 = [{ op: 'if', cond: { op: 'true' }, then: [{ op: 'wait', frames: 5 }] }, { op: 'startBattle', trp: 'x', win: [] }];
    const t1 = T.insert(l0, [0, 'else'], null, { op: 'wait', frames: 9 });
    const t2 = T.insert(t1, [1, 'win'], 0, { op: 'gil', by: 5 });
    const t3 = T.move(t2, [0], 1), t4 = T.remove(t3, [0]), t5 = T.put(t2, [0, 'then', 0], { op: 'wait', frames: 7 });
    check('the command tree inserts (creating a missing else), moves, removes, and replaces by path, never touching its input', t1[0]['else'][0].frames === 9 && t2[1].win[0].by === 5 && t3[0].op === 'startBattle' && t4.length === 1 && t4[0].op === 'if' && t5[0].then[0].frames === 7 && J(l0[0]['else']) === undefined && T.count(t2) === 5 && T.get(t2, [1, 'win', 0]).op === 'gil' && T.remove(l0, [5]) === null);
    check('children lists an if\'s then and else, a choice option\'s commands, and a battle\'s win, lose, and escape', J(T.children({ op: 'if', then: [] }).map((k) => k.seg)) === J([['then'], ['else']]) && J(T.children({ op: 'choice', options: [{ text: 'a' }, { text: 'b', cmds: [] }] }).map((k) => k.seg)) === J([['options', 0, 'cmds'], ['options', 1, 'cmds']]) && T.children({ op: 'startBattle', win: [], lose: [], escape: [] }).length === 3);
    check('cmdText reads all 21 commands as a sentence', ES.cmd.OPS.every((o) => { const t = E.cmdText(E.blank(o)); return typeof t === 'string' && t.length > 3 && !/Unknown/.test(t); }) && ES.cmd.OPS.length === 21);
    // The validator.
    const broken = STORY.authored('evt_', 'Broken call', { kind: 'custom', trigger: 'chapterStart', pages: [{ cmds: [{ op: 'callEvent', evt: 'evt_missing_zzzz' }] }] });
    b.story.records.evt_[broken.id] = broken; Kit.index.invalidate(); Kit.bundle.touch('test');
    const vv = Kit.refreshValidation();
    check('the validator story.events reports an event that calls a missing event', vv.errors.some((x) => x.recordId === broken.id));
    delete b.story.records.evt_[broken.id]; Kit.index.invalidate(); Kit.bundle.touch('test');
  }

  // ---------------------------------------------------------------- 5. The Events tab under jsdom.
  {
    const { win, errors } = await prepared(fourText);
    const { Kit, STORY } = win, d = win.document, E = STORY.events;
    Kit.go('events'); await wait(20);
    const ws = () => d.getElementById('ws');
    const btn = (re, root) => Array.from((root || ws()).querySelectorAll('button')).find((x) => re.test(x.textContent));
    check('the Events tab mounts with a build button and no events yet', /Build events from the world/.test(ws().textContent) && /No events yet/.test(ws().textContent));
    btn(/Build events from the world/).click(); await wait(30);
    check('Build makes 30 events and lists them, up to date', d.querySelectorAll('.ev-item').length === 30 && /up to date/.test(ws().textContent));
    check('the empty boss slot card offers a troop for The Marches', d.querySelectorAll('.ev-slot').length === 1 && /The Marches/.test(d.querySelector('.ev-slot').textContent));
    const sel = d.querySelector('.ev-slot select'); sel.value = 'trp_march_wolves_m1w7'; sel.dispatchEvent(new win.Event('change')); await wait(20);
    const mb = Object.values(Kit.bundle.current().story.records.evt_).find((r) => r.kind === 'boss' && r.slot);
    check('choosing a troop in the card updates the boss event', mb.pages[1].cmds.find((c) => c.op === 'startBattle').trp === 'trp_march_wolves_m1w7');
    // Filters and an open event.
    Array.from(d.querySelectorAll('.fg-filter button')).find((x) => x.textContent === 'Bosses').click(); await wait(10);
    check('the Bosses filter shows the six boss events', /6 of 30 events/.test(d.querySelector('.fg-count').textContent) && d.querySelectorAll('.ev-item').length === 6);
    const first = d.querySelector('.ev-item[data-evt="' + mb.id + '"] .fg-head'); first.click(); await wait(20);
    const item = () => d.querySelector('.ev-item[data-evt="' + mb.id + '"]');
    check('an open event shows its trigger, page tabs, a condition editor, and every command as a block, nested lists included', /Stepping on/.test(item().textContent) && item().querySelectorAll('.ev-pages button').length === 3 &&
      item().querySelectorAll('.ev-page .ev-cmd').length === E.tree.count(mb.pages[1].cmds) && item().querySelectorAll('.ev-kid').length >= 1 && /On a win/.test(item().textContent));
    const tabB = (re) => Array.from(item().querySelectorAll('.ev-pages button')).find((x) => re.test(x.textContent));
    tabB(/Page 1/).click(); await wait(10);
    check('page tabs switch the page shown', item().querySelectorAll('.ev-page .ev-cmd').length === 1);
    tabB(/Page 2/).click(); await wait(10);
    // Add a command through the dialog.
    const adders = item().querySelectorAll('.ev-adder');
    const topAdder = adders[adders.length - 1];
    topAdder.querySelector('select').value = 'wait'; btn(/^Add$/, topAdder).click(); await wait(20);
    const ov = d.getElementById('overlays');
    check('Add opens the command dialog for the chosen kind', /New: Wait/.test(ov.textContent));
    const fr = ov.querySelector('input[type=number]'); fr.value = '45';
    btn(/^Save$/, ov).click(); await wait(20);
    const after = Kit.bundle.current().story.records.evt_[mb.id].pages[1].cmds;
    check('Save inserts the command at the end of the page and the event is now edited', after[after.length - 1].op === 'wait' && after[after.length - 1].frames === 45 && E.isEdited(Kit.bundle.current().story.records.evt_[mb.id]) && !ov.textContent.trim());
    // A refused edit keeps the dialog open with the reason.
    const tb = Array.from(item().querySelectorAll('.ev-page .ev-cmd')).find((x) => /Battle/.test(x.textContent));
    btn(/^Edit$/, tb).click(); await wait(20);
    const clr = Array.from(ov.querySelectorAll('.ev-pick')); clr[0].click(); await wait(20);
    const pickList = Array.from(ov.querySelectorAll('.pick-item'));
    check('the troop picker lists the Rules troops', pickList.length >= 13);
    pickList.find((x) => /Slime King/.test(x.textContent)).click(); await wait(20);
    btn(/^Save$/, ov).click(); await wait(20);
    const sb = Kit.bundle.current().story.records.evt_[mb.id].pages[1].cmds.find((c) => c.op === 'startBattle');
    check('editing the battle through its dialog changes the troop', sb.trp === 'trp_slime_king_k4t2' && !ov.textContent.trim());
    const qcmd = { op: 'questStage', qst: Object.keys(Kit.bundle.current().story.records.qst_)[0], stage: 'nowhere' };
    const refused = E.setCmds(mb.id, 1, Kit.bundle.current().story.records.evt_[mb.id].pages[1].cmds.concat([qcmd]));
    check('a refused command list is reported and not saved', !refused.ok && !Kit.bundle.current().story.records.evt_[mb.id].pages[1].cmds.some((c) => c.stage === 'nowhere'));
    // Move and remove.
    const blocks = () => Array.from(item().querySelectorAll('.ev-page > .ev-list > .ev-cmd'));
    const firstOp = Kit.bundle.current().story.records.evt_[mb.id].pages[1].cmds[0].op;
    btn(/^Down$/, blocks()[0]).click(); await wait(20);
    check('Down moves a command one place later', Kit.bundle.current().story.records.evt_[mb.id].pages[1].cmds[1].op === firstOp);
    const nBefore = Kit.bundle.current().story.records.evt_[mb.id].pages[1].cmds.length;
    btn(/^Remove$/, blocks()[blocks().length - 1]).click(); await wait(20);
    check('Remove takes a command out', Kit.bundle.current().story.records.evt_[mb.id].pages[1].cmds.length === nBefore - 1);
    check('Reset to generated is offered for the edited event', !!btn(/Reset to generated/, item()));
    // The golden path panel.
    btn(/Play the golden path/).click(); await wait(30);
    check('Play the golden path lists every step and says how far it got', d.querySelectorAll('.ev-gsteps li').length === 25 && /6 of 6 main quests complete/.test(d.querySelector('.ev-golden').textContent));
    // The playtester: the boss, stop by stop.
    btn(/^Play$/, item()).click(); await wait(30);
    const play = () => d.getElementById('evPlay');
    check('Play on an event opens the playtester at its first stop with the inspector', /Page 2 runs/.test(play().textContent) && !!play().querySelector('.ev-insp') && !!btn(/^Continue$/, play()));
    btn(/^Continue$/, play()).click(); await wait(20);
    for (let k = 0; k < 6 && !btn(/^Win$/, play()); k++) { const c = btn(/^Continue$/, play()); if (!c) break; c.click(); await wait(15); }
    check('the battle stops for Win and Lose', !!btn(/^Win$/, play()) && !!btn(/^Lose$/, play()) && /Battle against Slime King/.test(play().textContent));
    btn(/^Lose$/, play()).click(); await wait(20);
    check('Lose with no loss list is game over', /Game over/.test(play().textContent) && !btn(/^Continue$/, play()));
    btn(/^Back$/, play()).click(); await wait(20);
    check('Back returns to the battle, exactly as it was', !!btn(/^Win$/, play()) && !/Game over/.test(play().textContent));
    btn(/^Win$/, play()).click(); await wait(20);
    for (let k = 0; k < 8 && btn(/^Continue$/, play()); k++) { btn(/^Continue$/, play()).click(); await wait(15); }
    const insp = play().querySelector('.ev-insp').textContent;
    check('after a win the event ends and the inspector shows the gate flags the boss opened', /The event ends/.test(play().textContent) && /Gate: vehicle:ship|vehicle/i.test(insp) && /The run is over/.test(play().textContent), insp.slice(0, 300));
    // A choice, through a hand made event.
    const S = Kit.bundle.current();
    const choiceEv = E.add({ name: 'Crossroads', trigger: 'chapterStart', chapter: 'chp_the_lowlands_auem' }).record;
    E.setCmds(choiceEv.id, 0, [{ op: 'choice', prompt: 'Which way?', options: [{ text: 'North', cmds: [{ op: 'gil', by: 50 }] }, { text: 'South', cmds: [{ op: 'gil', by: 7 }] }] }]);
    STORY.eventsUi.pt.evt = choiceEv.id; Kit.rerender(); await wait(20);
    btn(/^Play$/, play()).click(); await wait(20);
    check('a choice shows its options as buttons', Array.from(play().querySelectorAll('.ev-opt')).map((x) => x.textContent).join('|') === 'North|South');
    Array.from(play().querySelectorAll('.ev-opt'))[1].click(); await wait(20);
    for (let k = 0; k < 4 && btn(/^Continue$/, play()); k++) { btn(/^Continue$/, play()).click(); await wait(10); }
    check('picking an option runs its commands (gil 7 in the inspector)', /> South/.test(play().textContent) && /Gil\s*7/.test(play().querySelector('.ev-insp').textContent));
    // Carry on: the next run starts from where the last one ended.
    STORY.eventsUi.pt.carry = true;
    btn(/^Play$/, play()).click(); await wait(20);
    Array.from(play().querySelectorAll('.ev-opt'))[0].click(); await wait(20);
    for (let k = 0; k < 4 && btn(/^Continue$/, play()); k++) { btn(/^Continue$/, play()).click(); await wait(10); }
    check('carry on keeps the state between runs (gil 57)', /Gil\s*57/.test(play().querySelector('.ev-insp').textContent));
    Kit.go('flags'); await wait(10);
    const jumped = Kit.jump(choiceEv.id); await wait(20);
    check('jumping to an evt_ opens the Events tab with it expanded', jumped !== false && Kit.active() === 'events' && d.querySelector('.ev-item[data-evt="' + choiceEv.id + '"] .fg-body') && !d.querySelector('.ev-item[data-evt="' + choiceEv.id + '"] .fg-body').hidden);
    check('Settings opens the event settings dialog', (btn(/^Settings$/, d.querySelector('.ev-item[data-evt="' + choiceEv.id + '"]')).click(), await wait(20), /Event settings/.test(d.getElementById('overlays').textContent)));
    btn(/^Cancel$/, d.getElementById('overlays')).click(); await wait(10);
    check('the tab raised no errors through all of it', !errors.length && S === Kit.bundle.current(), errors.slice(0, 2));
    win.close();
  }

  // ---------------------------------------------------------------- 6. Two pages agree; the round trip.
  {
    const p1 = await prepared(fourText), p2 = await prepared(fourText);
    p1.win.STORY.events.scaffold(); p2.win.STORY.events.scaffold();
    const s1 = canon(p1.win.Kit.bundle.current().story), s2 = canon(p2.win.Kit.bundle.current().story);
    check('two fresh pages build byte for byte the same story with its events', s1 === s2);
    const { Kit } = p1.win, b7 = Kit.bundle.current();
    const draft = Kit.buildExport('draft');
    const db = JSON.parse(draft.files[0].text);
    check('the Draft carries the 30 events and the finale flag', Object.keys(db.story.records.evt_).length === 30 && !!db.story.records.flg_[p1.win.STORY.events.finaleFlag()]);
    const probe = (how) => async (w, K) => { const cb = K.bundle.current(); let err = null; try { K.buildExport(how, { engines: false }); } catch (e4) { err = e4.message; } return { same: ['charter', 'codex', 'rules', 'art', 'world'].filter((k) => J(cb[k] || null) !== J(db[k] || null)), err }; };
    const r146 = await in146(draft.files[0].text, probe('draft'));
    const r147 = await in147(draft.files[0].text, probe('draft'));
    const r148 = await in148(draft.files[0].text, probe('final'));
    [['146', r146], ['147', r147], ['148', r148]].forEach(([k, rr]) => {
      check('Day ' + k + ' opens the Draft with the events: hash verified, prior namespaces identical, no errors, no broken references', rr.matches && !rr.errors.length && !rr.broken.length && !rr.err && !rr.same.length, { m: rr.matches, e: (rr.errors || []).slice(0, 2), br: (rr.broken || []).slice(0, 2), err: rr.err, same: rr.same });
    });
    p2.win.Kit.bundle.importText(draft.files[0].text); await wait(20);
    check('the Draft reopens here with the same story', canon(p2.win.Kit.bundle.current().story) === canon(db.story));
    check('a reopened Draft needs no rebuild', !p2.win.STORY.events.scaffold().changed);
    p1.win.close(); p2.win.close();
  }
  built.demo.win.close(); built.four.win.close();

  const n = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(J(x.detail)).slice(0, 900))));
  fs.writeFileSync(path.join(OUT, 'phase5-report.json'), J({ passed: n, total: results.length, results }, null, 1));
  console.log('\n' + n + ' of ' + results.length + ' passed');
  process.exit(n === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
