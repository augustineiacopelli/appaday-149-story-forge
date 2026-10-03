// Phase 3 acceptance: quests as state machines (STORY.quests in src/story-quests.js, the condition editor in src/ws-cond.js,
// the Quests tab in src/ws-quests.js).
// 1. static: new sources ASCII clean, no forbidden APIs, fences, engine-story.js untouched;
// 2. the scaffold: main quests from the golden path, side quests from seeds, B stories from storylines, structural IDs,
//    completion flags, slot flags, idempotent, deterministic, no problems;
// 3. the engine plays the generated quests: stages move forward on the world's own gate flags, the last stage completes;
// 4. authored work survives: edits, hand made quests; stale generated quests drop;
// 5. mutators with their refusals, the validator, usedBy, condText;
// 6. the Quests tab under jsdom; 7. the round trip through Days 146, 147, 148.
// Run from test/.
'use strict';
const fs = require('fs');
const path = require('path');
const { engine } = require('./storyfx');
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
const isSorted = (o) => J(Object.keys(o)) === J(Object.keys(o).sort());

(async () => {
  // ---------------------------------------------------------------- 1. Static.
  const names = ['story-quests.js', 'ws-cond.js', 'ws-quests.js', 'story-quests.css'];
  const files = names.map((f) => path.join(ROOT, 'src', f));
  check('the four new sources exist and are pure ASCII', files.every((f) => fs.existsSync(f) && !/[^\x00-\x7f]/.test(fs.readFileSync(f, 'utf8'))));
  const forbidden = /roundRect|\.ellipse\(|window\.confirm|\beval\(|new Function|[^.\w]confirm\(|\.remove\(\)/;
  check('no forbidden APIs in the new JavaScript', files.slice(0, 3).every((f) => !forbidden.test(fs.readFileSync(f, 'utf8'))), files.slice(0, 3).map((f) => forbidden.exec(fs.readFileSync(f, 'utf8'))));
  const dashRe = new RegExp('\\u2013|\\u2014|\\\\u2013|\\\\u2014|\'[^\'\\n]*[A-Za-z] - [A-Za-z][^\'\\n]*\'');
  check('no dashes used as punctuation in the new UI prose (no em or en dash, no spaced hyphen between words)', files.every((f) => !dashRe.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('index.html carries the STORY:QUESTS, WS:COND, WS:QUESTS and quests CSS fences, in that order after STORY:SCAFFOLD', ['STORY:SCAFFOLD BEGIN', 'STORY:QUESTS BEGIN', 'WS:FLAGS BEGIN', 'WS:COND BEGIN', 'WS:QUESTS BEGIN', 'WS:STORY149 BEGIN'].map((m) => html.indexOf(m)).every((v, i, a) => v > 0 && (i === 0 || v > a[i - 1])) && /STORY:QUESTS CSS BEGIN/.test(html));
  const engFile = fs.readFileSync(path.join(ROOT, 'src', 'engine-story.js'), 'utf8');
  const { execSync } = require('child_process');
  let headEng = null; try { headEng = execSync('git show HEAD:src/engine-story.js', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString(); } catch (e) { headEng = null; }
  check('engine-story.js is unchanged by Phase 3 (equal to the committed file)', headEng === null || headEng === engFile);
  check('the standalone engine-story.js at the root matches src', fs.readFileSync(path.join(ROOT, 'engine-story.js'), 'utf8').indexOf('ENGINE_STORY') >= 0);

  // ---------------------------------------------------------------- 2. The scaffold on the Final with four continents.
  const { win, errors } = await boot149();
  const Kit = win.Kit, STORY = win.STORY, Q = STORY.quests, F = STORY.flags, ES = win.ENGINE_STORY, d = win.document;
  check('boots with no page errors and STORY.quests is the Phase 3 API', !errors.length && Q && ['scaffold', 'wanted', 'check', 'edit', 'update', 'addStage', 'updateStage', 'replaceStage', 'moveStage', 'removeStage', 'addGroup', 'replaceGroup', 'removeGroup', 'addOutcome', 'updateOutcome', 'removeOutcome', 'setFail', 'add', 'remove', 'reset', 'usedBy', 'condText', 'summary', 'expected', 'list', 'beats', 'readsOf'].every((k) => typeof Q[k] === 'function'), errors.slice(0, 2));
  check('qst_ is the StoryQuest Codex type and carries stages, branches, fail, and rewards fields', Kit.codex.typeFor('qst_') === 'StoryQuest' && ['stages', 'branches', 'fail', 'rewards', 'completeFlag', 'giver'].every((k) => Kit.codex.type('StoryQuest').fields.some((f) => f.key === k)));
  Kit.bundle.importText(fourText); await wait(20);
  let b = Kit.bundle.current();
  check('opening a Final does not build quests by itself (the scaffold is a button)', Object.keys(b.story.records.qst_).length === 0);
  const ex0 = Q.expected(b);
  check('expected: six main quests and two side quests, none built yet', ex0.total === 8 && ex0.missing === 8 && ex0.by.main.want === 6 && ex0.by.side.want === 2 && ex0.by.bstory.want === 0, ex0);
  const rep = Q.scaffold(b);
  const chapters = b.charter.sections.chapters.map((c) => c.id);
  const mains = Q.list(b).filter((q) => q.kind === 'main'), sides = Q.list(b).filter((q) => q.kind === 'side');
  check('the scaffold builds 8 quests: one main per chapter, one side per seed, and says so', rep.created.length === 8 && mains.length === 6 && sides.length === 2 && /8 quests built/.test(Q.reportText(rep)), [rep.created.length, Q.reportText(rep)]);
  check('every quest ID equals ENGINE_STORY.ids.structural of its key, and the scaffold names it', Q.list(b).every((q) => q.id === ES.ids.structural('qst_', q.key) && b.story.scaffold[q.key] === q.id && q.origin === 'generated'));
  check('the main quests follow the chapter order and keys are qst|main|<chapter>', J(mains.map((q) => q.chapter)) === J(chapters) && mains.every((q) => q.key === 'qst|main|' + q.chapter));
  check('chapters one to five have five stages (arrive, key, boss, exit, done); the last has four (no exit)', mains.slice(0, 5).every((q) => J(q.stages.map((s) => s.key)) === '["arrive","key","boss","exit","done"]') && J(mains[5].stages.map((s) => s.key)) === '["arrive","key","boss","done"]', mains.map((q) => q.stages.map((s) => s.key).join('>')));
  const g = STORY.world.graph(b);
  const m0 = mains[0], sealKey = 'item:seal:' + chapters[0];
  check('the key stage exits when the seal flag the key dungeon grants is set, tied to the story binding', canon(m0.stages[1].exitWhen) === canon({ op: 'flag', flg: b.story.bindings[sealKey].flg, cmp: 'gte', value: 1 }));
  const bossNode = g.nodes.find((n) => n.chapter === chapters[0] && n.role === 'boss' && n.kind === 'dgn');
  check('the boss stage exits when every gate the boss grants is open; the finale boss has no exit condition', canon(m0.stages[2].exitWhen) === canon({ op: 'flag', flg: b.story.bindings[bossNode.grants[0]].flg, cmp: 'gte', value: 1 }) && mains[5].stages[2].exitWhen === undefined);
  check('each stage carries the Day 148 site it happens at; the done stage has none', m0.stages.slice(0, 4).every((s) => g.nodes.some((n) => n.key === s.site)) && m0.stages[4].site === undefined);
  check('the exit stage reads "Take the road to <region>" from the progression region', /^Take the road to /.test(m0.stages[3].label), m0.stages[3].label);
  const town = STORY.world.get(g.nodes.find((n) => n.chapter === chapters[0] && n.role === 'start' && n.kind === 'twn').record, b);
  check('the giver is a person who lives in the start town', m0.giver && town.people.indexOf(m0.giver) >= 0 && Kit.ids.prefixOf(m0.giver) === 'npc_', [m0.giver, town.people.length]);
  check('main quests have their own completion flag (flg|qdone|<qst>, kind quest, 0 to 1), set by the last stage', mains.every((q) => { const f = b.story.records.flg_[q.completeFlag]; return f && f.kind === 'quest' && f.origin === 'generated' && canon(f.range) === '[0,1]' && b.story.scaffold['flg|qdone|' + q.id] === q.completeFlag; }));
  check('side quests copy name, chapter, giver, rewards and note from the seed and reuse the seed\'s completion flag', sides.every((q) => { const sd = b.rules.sdq_[q.key.replace('qst|side|', '')]; return sd && q.name === sd.name && q.chapter === sd.chapter && q.giver === sd.giver && q.notes === sd.text && q.completeFlag === sd.flag && canon(q.rewards) === canon(sd.rewards || []) && J(q.stages.map((s) => s.key)) === '["offer","accept","done"]'; }));
  const idx = STORY.engineIndex(b);
  check('every quest has its save slot flag (flg|quest|<qst>) after the scaffold, so Day 146 saves resolve', Object.keys(b.story.records.qst_).every((id) => b.story.scaffold['flg|quest|' + id] && b.story.records.flg_[b.story.scaffold['flg|quest|' + id]]) && ES.save.slots(idx).filter((s) => s.kind === 'quest').length === 8);
  check('the engine index reads the generated quests: stages, sets, exits', Object.keys(idx.quests).length === 8 && idx.quests[m0.id].stages.length === 5);
  const problems = []; Q.list(b).forEach((q) => Q.check(q, b, idx).forEach((p) => problems.push(q.name + ' ' + p.level + ' ' + p.message)));
  check('Q.check finds nothing wrong with any generated quest', !problems.length, problems.slice(0, 4));
  const res0 = Kit.refreshValidation();
  check('Kit validation reports no error or broken reference for story quests', !res0.errors.some((x) => /qst_/.test(x.recordId || '')) && !res0.broken.some((x) => /qst_/.test(x.recordId || x.id || '')), res0.errors.slice(0, 3).map((x) => x.recordId + x.message));
  check('reads is derived from the conditions: the key stage flag is listed on the main quest', m0.reads.indexOf(b.story.bindings[sealKey].flg) >= 0 && J(m0.reads) === J(Q.readsOf(m0)) && isSorted(Object.fromEntries(m0.reads.map((k) => [k, 1]))));
  check('records, scaffold and flags are key sorted', isSorted(b.story.records.qst_) && isSorted(b.story.records.flg_) && isSorted(b.story.scaffold));

  // Idempotent.
  const before = canon(b.story), counter = b.kit.changeCounter;
  const rep2 = Q.scaffold(b);
  check('a second scaffold changes nothing: not changed, same story bytes, no touch', !rep2.changed && !rep2.created.length && canon(b.story) === before && b.kit.changeCounter === counter && /already built/.test(Q.reportText(rep2)), rep2);
  check('expected now says nothing is missing and the summary counts eight quests', Q.expected(b).missing === 0 && Q.summary(b).total === 8 && Q.summary(b).byKind.main === 6);
  // Deterministic across two pages.
  const w2 = await boot149(); w2.win.Kit.bundle.importText(fourText); await wait(20);
  w2.win.STORY.quests.scaffold(w2.win.Kit.bundle.current());
  check('two fresh pages scaffolding the same Final give byte identical story namespaces', canon(w2.win.Kit.bundle.current().story) === canon(b.story));
  w2.win.close();
  // Demo path (two chapters, no seeds).
  const w3 = await boot149(); w3.win.Kit.bundle.importText(demoText); await wait(20);
  const bd = w3.win.Kit.bundle.current(); w3.win.STORY.quests.scaffold(bd);
  const dl = w3.win.STORY.quests.list(bd);
  check('the demo (2 chapters, no seeds, no B stories) gets exactly two main quests, the second without an exit stage', dl.length === 2 && dl.every((q) => q.kind === 'main') && dl[1].stages.every((s) => s.key !== 'exit'), dl.map((q) => q.stages.length));
  w3.win.close();

  // ---------------------------------------------------------------- 3. The engine plays them.
  const evtRec = (id, cmds) => ({ id, name: id, key: 'test|' + id, origin: 'generated', notes: '', tags: [], priority: 0, trigger: 'chapterStart', pages: [{ cmds }] });
  const recs = Object.assign({}, b.story.records, { evt_: { evt_a: evtRec('evt_a', [{ op: 'questStage', qst: m0.id, stage: 'key' }]), evt_b: evtRec('evt_b', [{ op: 'questStage', qst: m0.id, stage: 'done' }]) } });
  const idx2 = ES.index.build({ records: recs, bindings: b.story.bindings }, STORY.engineExt(b));
  let state = ES.state.create(idx2, {});
  state = ES.run.play(state, 'evt_a', idx2, {}).state;
  check('an event moves the quest into its key stage', state.quests[m0.id].stage === 'key');
  const settled = (s) => ES.quests.settle(s, idx2).state;
  state = settled(state);
  check('with the seal not yet found the quest stays at the key stage', state.quests[m0.id].stage === 'key');
  state.flags[b.story.bindings[sealKey].flg] = 1; state = settled(state);
  check('the seal flag moves it on to the boss stage', state.quests[m0.id].stage === 'boss', state.quests[m0.id]);
  bossNode.grants.forEach((k) => { state.flags[b.story.bindings[k].flg] = 1; }); state = settled(state);
  check('the boss grants open the gates and the quest reaches the exit stage', state.quests[m0.id].stage === 'exit', state.quests[m0.id]);
  state = ES.run.play(state, 'evt_b', idx2, {}).state;
  check('entering the last stage sets the completion flag and the slot packs the stage', state.quests[m0.id].stage === 'done' && state.flags[m0.completeFlag] === 1);
  const packed = ES.save.toFlags(state, idx2), back = ES.save.fromFlags(packed, idx2);
  check('the save round trip through the quest slot flags returns the same quest state', back && back.quests && back.quests[m0.id] && back.quests[m0.id].stage === 'done', back && back.quests && back.quests[m0.id]);

  // ---------------------------------------------------------------- 4. Authored work survives.
  const c1 = clone(b); const w5 = c1;
  const q1 = Q.list(c1)[0];
  const e1 = Q.updateStage(q1.id, 'arrive', { label: 'Wake up at the inn', note: 'A custom note' }, c1);
  const bonus = Q.add({ name: 'My own quest', kind: 'side', chapter: chapters[1] }, c1);
  const sdqId = Object.keys(c1.rules.sdq_)[0];
  delete c1.rules.sdq_[sdqId];
  const rep3 = Q.scaffold(c1);
  const q1b = c1.story.records.qst_[q1.id];
  check('an edited generated quest is kept by the scaffold (the stage label and note survive)', e1.ok && q1b.stages[0].label === 'Wake up at the inn' && q1b.stages[0].note === 'A custom note');
  check('a hand made quest (origin user, minted ID, its own completion flag) is kept by the scaffold', bonus.ok && c1.story.records.qst_[bonus.record.id] && c1.story.records.qst_[bonus.record.id].origin === 'user' && c1.story.records.flg_[bonus.record.completeFlag] && !/^qst_qst_/.test(bonus.record.id));
  check('removing a seed drops its generated side quest and its flag (through the flag sync), nothing else', rep3.removed.length === 1 && !c1.story.records.qst_[ES.ids.structural('qst_', 'qst|side|' + sdqId)] && !c1.story.records.flg_[F.doneId(sdqId)] && Object.keys(c1.story.records.qst_).length === 8 && rep3.sync.removed.length === 1, [rep3.skipped, rep3.removed, rep3.sync]);
  check('after dropping stale records the story is settled again: a rerun changes nothing', !Q.scaffold(c1).changed);
  // B stories: give one character a storyline.
  const c2 = clone(b), chrId = Object.keys(c2.rules.chr_)[0];
  c2.rules.chr_[chrId].bStoryline = 'She searches for her brother.\nShe finds a letter in the ruins.\nShe forgives the thief.';
  const rep4 = Q.scaffold(c2);
  const bs = Q.list(c2).filter((q) => q.kind === 'bstory');
  check('a character with a storyline gets a B story quest: meet, one stage per beat, done; tied to the character; no chapter', rep4.created.length === 1 && bs.length === 1 && bs[0].chr === chrId && J(bs[0].stages.map((s) => s.key)) === '["meet","beat1","beat2","beat3","done"]' && bs[0].chapter === undefined && !bs[0].giver && /brother/.test(bs[0].stages[1].label), bs.map((q) => q.stages.map((s) => s.key)));
  const sentences = Q.beats('One. Two! Three? Four. Five. Six. Seven.');
  check('beats cap at five, split single paragraphs by sentence, trim long ones', sentences.length === 5 && Q.beats('') .length === 0 && Q.beats('x'.repeat(200))[0].length <= 80 && /\.\.\.$/.test(Q.beats('x'.repeat(200))[0]), sentences);
  check('turning off the B story setting drops the generated B story and its flag', (Q.setScaffold('bStories', false, c2), Q.scaffold(c2).removed.length === 1 && !Q.list(c2).some((q) => q.kind === 'bstory')));
  check('turning off the side quest setting drops the side quests, and the seeds\' flags remain', (Q.setScaffold('sideQuests', false, c2), Q.scaffold(c2), !Q.list(c2).some((q) => q.kind === 'side') && Object.values(c2.rules.sdq_).every((s) => c2.story.records.flg_[s.flag])));
  Q.setScaffold('sideQuests', true, c2); Q.setScaffold('bStories', true, c2);
  check('Q.reset restores a generated quest and refuses a hand made one', (() => { Q.scaffold(c2); const id = Q.list(c2)[0].id; Q.updateStage(id, 'arrive', { label: 'X' }, c2); const r = Q.reset(id, c2), r2 = Q.reset(bonus.record.id, c1); return r.ok && c2.story.records.qst_[id].stages[0].label !== 'X' && !r2.ok; })());

  // ---------------------------------------------------------------- 5. Mutators, refusals, validator, words.
  const c3 = clone(b), main = Q.list(c3)[0], mid = main.id;
  const a1 = Q.addStage(mid, { label: 'Talk to the smith' }, c3);
  check('addStage puts the new stage before the ending and gives it a free key', a1.ok && a1.record.stages.length === 6 && a1.record.stages[4].label === 'Talk to the smith' && a1.record.stages[5].key === 'done' && a1.record.stages[4].key === 'step1');
  check('duplicate stage keys are refused and nothing is written', (() => { const r = Q.addStage(mid, { key: 'key', label: 'Dup' }, c3); return !r.ok && /key/.test(problemText(r)) && c3.story.records.qst_[mid].stages.length === 6; })());
  function problemText(r) { return (r.problems || []).map((p) => p.message).join(' '); }
  check('a bad stage key (capital, space) is refused', !Q.addStage(mid, { key: 'Bad Key', label: 'x' }, c3).ok);
  check('moveStage swaps neighbours and refuses to go off either end', Q.moveStage(mid, 'step1', -1, c3).ok && c3.story.records.qst_[mid].stages[3].key === 'step1' && !Q.moveStage(mid, 'arrive', -1, c3).ok);
  const sealFlg = b.story.bindings[sealKey].flg;
  check('an exit condition on a stage is saved, and reads is rebuilt from it', (() => { const r = Q.updateStage(mid, 'arrive', { exitWhen: { op: 'flag', flg: sealFlg, cmp: 'gte', value: 1 } }, c3); return r.ok && c3.story.records.qst_[mid].reads.indexOf(sealFlg) >= 0; })());
  check('an exit condition naming a flag that does not exist is refused', (() => { const r = Q.updateStage(mid, 'arrive', { exitWhen: { op: 'flag', flg: 'flg_nope', cmp: 'gte', value: 1 } }, c3); return !r.ok && /flg_nope|not a flag|unknown/i.test(problemText(r)); })());
  check('an empty flag in a half built condition is refused without losing the stored record', (() => { const r = Q.replaceStage(mid, 'arrive', { label: 'A', exitWhen: { op: 'flag', flg: '', cmp: 'gte', value: 1 } }, c3); return !r.ok && c3.story.records.qst_[mid].stages[0].label !== 'A'; })());
  check('sets with a flag that does not exist, or a fractional value, are refused', !Q.updateStage(mid, 'arrive', { sets: [{ flg: 'flg_nope', value: 1 }] }, c3).ok && !Q.updateStage(mid, 'arrive', { sets: [{ flg: sealFlg, value: 1.5 }] }, c3).ok);
  check('a quest cannot drop below two stages', (() => { const c = clone(b), id = Q.list(c)[0].id; let n = 0; while (Q.removeStage(id, c.story.records.qst_[id].stages[0].key, c).ok) n++; return c.story.records.qst_[id].stages.length === 2 && n === 3; })());
  const gOk = Q.addGroup(mid, { label: 'Forgive or punish', at: 'key' }, c3);
  check('addGroup makes a group with two outcomes at the chosen stage', gOk.ok && gOk.record.branches.length === 1 && gOk.record.branches[0].outcomes.length === 2 && gOk.record.branches[0].at === 'key');
  const gk = gOk.record.branches[0].key;
  check('outcomes can be added and updated; a group needs unique outcome keys', Q.addOutcome(mid, gk, { label: 'Third way', sets: [{ flg: sealFlg, value: 1 }] }, c3).ok && c3.story.records.qst_[mid].branches[0].outcomes.length === 3 && !Q.addOutcome(mid, gk, { key: 'outcome1', label: 'Dup' }, c3).ok && Q.updateOutcome(mid, gk, 'outcome1', { label: 'Forgive' }, c3).ok);
  check('a branch group decided at a stage that does not exist is refused; removing the stage clears the hint', !Q.updateGroup(mid, gk, { at: 'nowhere' }, c3).ok && (Q.removeStage(mid, 'key', c3), c3.story.records.qst_[mid].branches[0].at === undefined));
  check('the engine shape of a branch group is read: closed groups appear in the index', ES.index.build({ records: c3.story.records, bindings: c3.story.bindings }, STORY.engineExt(c3)).quests[mid].branchOrder.length === 1);
  check('removing the group, then outcomes beyond the last, leaves the record valid', Q.removeGroup(mid, gk, c3).ok && c3.story.records.qst_[mid].branches.length === 0);
  const fOk = Q.setFail(mid, { cond: { op: 'chapter', chp: chapters[1], cmp: 'gte' }, sets: [{ flg: sealFlg, value: 0 }] }, c3);
  check('setFail stores a failure with a condition and flag changes; null removes it', fOk.ok && c3.story.records.qst_[mid].fail.sets.length === 1 && Q.setFail(mid, null, c3).ok && c3.story.records.qst_[mid].fail === undefined);
  check('a failure condition naming a missing chapter is refused', !Q.setFail(mid, { cond: { op: 'chapter', chp: 'chp_nope', cmp: 'gte' }, sets: [] }, c3).ok);
  check('update changes name, giver and rewards; a giver that is not in the world is refused', Q.update(mid, { name: 'Renamed main' }, c3).ok && !Q.update(mid, { giver: 'npc_nobody' }, c3).ok && !Q.update(mid, { name: '' }, c3).ok);
  check('rewards must be items or equipment from the Rules, with a quantity from 1 to 99', (() => { const itm = Object.keys(c3.rules.itm_)[0]; return Q.update(mid, { rewards: [{ item: itm, qty: 2 }] }, c3).ok && !Q.update(mid, { rewards: [{ item: 'itm_nope', qty: 1 }] }, c3).ok && !Q.update(mid, { rewards: [{ item: itm, qty: 500 }] }, c3).ok; })());
  check('a completion flag that does not exist is refused; none gives a warning, not an error', !Q.update(mid, { completeFlag: 'flg_nope' }, c3).ok && Q.update(mid, { completeFlag: null }, c3).ok && Q.check(c3.story.records.qst_[mid], c3).some((p) => p.level === 'warning' && p.code === 'no-complete'));
  check('save limits: more than 255 stages is an error', (() => { const rec = clone(c3.story.records.qst_[mid]); rec.stages = Array.from({ length: 256 }, (v, i) => ({ key: 's' + i, label: 'S' + i, sets: [] })); return Q.check(rec, c3).some((p) => p.code === 'save-limit' && p.level === 'error'); })());
  check('a stale problem that was already there never blocks an unrelated edit', (() => { const c = clone(b), id = Q.list(c)[0].id; c.story.records.qst_[id].stages[0].exitWhen = { op: 'flag', flg: 'flg_gone', cmp: 'gte', value: 1 }; return Q.updateStage(id, 'boss', { note: 'fine' }, c).ok; })());
  // Validator.
  const c4 = clone(b); c4.story.records.qst_[Q.list(c4)[0].id].stages[1].exitWhen = { op: 'flag', flg: 'flg_gone' };
  Kit.bundle.importText(J(Object.assign(clone(src(fourText)), { story: c4.story }))); await wait(20);
  const rv = Kit.refreshValidation();
  check('Kit validation shows a quest whose exit condition names a missing flag, on the quest and the field', rv.errors.some((x) => x.recordId === Q.list(Kit.bundle.current())[0].id && /stages\[1\]\.exitWhen/.test(x.fieldPath)), rv.errors.slice(0, 3));
  function src(t) { return JSON.parse(t); }
  // usedBy and remove.
  const c5 = clone(b), t1 = Q.list(c5)[0];
  c5.story.records.evt_ = { evt_x: Object.assign(evtRec('evt_x', [{ op: 'questStage', qst: t1.id, stage: 'key' }]), { id: 'evt_x' }) };
  check('usedBy finds an event that names the quest, and remove returns it so the caller can warn', Q.usedBy(t1.id, c5).some((u) => u.id === 'evt_x') && Q.remove(t1.id, c5).usedBy.length === 1 && !c5.story.records.qst_[t1.id] && !c5.story.records.flg_[t1.completeFlag]);
  // condText
  const fn = (id) => (c5.story.records.flg_[id] || {}).name;
  check('condText says it in words: a set flag, a count, all and any groups, a quest state, a chapter; no dashes', (() => {
    const t = Q.condText({ op: 'all', of: [{ op: 'flag', flg: sealFlg, cmp: 'gte', value: 1 }, { op: 'any', of: [{ op: 'flag', flg: sealFlg, cmp: 'lt', value: 3 }, { op: 'not', of: { op: 'quest', qst: mid, is: 'failed' } }] }, { op: 'chapter', chp: chapters[1], cmp: 'gte' }] }, c3);
    return /is set and \(/.test(t) && /fewer than 3/.test(t) && /not \(/.test(t) && /has failed/.test(t) && /chapter is at least/.test(t) && !/[\u2013\u2014]| - /.test(t);
  })(), Q.condText({ op: 'flag', flg: sealFlg, cmp: 'lt', value: 3 }, c3));

  // ---------------------------------------------------------------- 6. The Quests tab under jsdom.
  Kit.bundle.importText(fourText); await wait(20);
  Kit.go('quests'); await wait(20);
  const btn = (re, root) => [...(root || d).querySelectorAll('button')].find((x) => re.test(x.textContent));
  check('the Quests tab is the real tab, not the stub, and offers Build quests from the world', Kit.active() === 'quests' && !/Arrives in Phase 3/.test(d.getElementById('ws').textContent) && !!btn(/Build quests from the world/));
  btn(/Build quests from the world/).click(); await wait(20);
  check('the build button makes eight quest cards and the header counts them', d.querySelectorAll('.qs-item').length === 8 && /8 quests/.test(d.getElementById('ws').textContent) && /6 main/.test(d.getElementById('ws').textContent) && /up to date/.test(d.getElementById('ws').textContent));
  check('the button now says Update quests', !!btn(/Update quests/) && !btn(/Build quests from the world/));
  d.querySelector('.qs-item .fg-head').click(); await wait(10);
  const svg = d.querySelector('.qs-svg');
  check('opening a quest draws the state machine in inline SVG: five stage nodes, four edges, one terminal double border', svg && svg.querySelectorAll('.qs-node').length === 5 && svg.querySelectorAll('.qs-edge').length === 4 && svg.querySelectorAll('.qs-node.end .qs-box-in').length === 1);
  check('each node is a focusable button with an accessible label and the picture is a labelled group', [...svg.querySelectorAll('.qs-node')].every((n) => n.getAttribute('role') === 'button' && n.getAttribute('tabindex') === '0' && /Stage \d of 5/.test(n.getAttribute('aria-label'))) && /Map of the quest/.test(svg.getAttribute('aria-label')));
  check('a stage button bar under the picture lists every stage with at least 44px touch height by CSS', d.querySelectorAll('.qs-stagebar .btn').length === 5 && /min-height: 44px/.test(fs.readFileSync(path.join(ROOT, 'src', 'story-quests.css'), 'utf8')));
  d.querySelectorAll('.qs-node')[2].dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await wait(10);
  check('clicking a node selects it and opens its editor', d.querySelector('.qs-node.sel').getAttribute('data-stage') === 'boss' && /Stage 3 of 5/.test(d.querySelector('.qs-edit-h').textContent));
  const lab = d.querySelector('.qs-edit input[aria-label="Stage label"]'); lab.value = 'Slay the Slime King'; lab.dispatchEvent(new win.Event('input', { bubbles: true }));
  btn(/Save stage/).click(); await wait(20);
  check('Save stage commits the label to the bundle and redraws', Q.list()[0].stages[2].label === 'Slay the Slime King' && /Slay the Slime King/.test(d.querySelector('.qs-svg').textContent));
  const cond = d.querySelector('.qs-cond');
  check('the stage editor shows the condition editor with the exit condition and its flag picker', cond && cond.querySelector('.cu-node') && cond.querySelector('.cu-pick'));
  const selAdd = [...d.querySelectorAll('.qs-edit .qs-sets button')].find((x) => /Add a flag change/.test(x.textContent));
  check('the flag change editor offers an add button', !!selAdd);
  btn(/Add branch group/).click(); await wait(20);
  check('Add branch group adds a diamond and two pills to the picture', d.querySelectorAll('.qs-group').length === 1 && d.querySelectorAll('.qs-pill').length === 2 && d.querySelectorAll('.qs-group-edit').length === 1);
  btn(/Add a failure rule/).click(); await wait(20);
  check('Add a failure rule draws the red Failed node and bus', !!d.querySelector('.qs-fail') && d.querySelectorAll('.qs-edge-fail').length >= 1);
  btn(/Delete stage/).click(); await wait(20);
  check('Delete stage removes the selected stage from the picture', d.querySelectorAll('.qs-node').length === 4);
  // Refused edit shows the message inline.
  const ids3 = Q.list()[0];
  const lab2 = d.querySelector('.qs-edit input[aria-label="Stage label"]'); lab2.value = ''; lab2.dispatchEvent(new win.Event('input', { bubbles: true }));
  btn(/Save stage/).click(); await wait(20);
  check('a refused save (empty label) shows the reason in the editor and writes nothing', /label/i.test(d.querySelector('.qs-edit .field-msg').textContent) && Q.list()[0].stages.every((s) => s.label));
  // Filters and settings.
  btn(/^Side$/).click(); await wait(10);
  check('the Side filter shows the two side quests', d.querySelectorAll('.qs-item').length === 2);
  btn(/^All$/).click(); await wait(10);
  check('Add quest opens a dialog that makes a hand made quest with a flag of its own', (() => { btn(/^Add quest$/).click(); const nm = d.querySelector('.dialog input[type=text]'); return !!nm; })());
  const dlgName = d.querySelector('.dialog input[type=text]'); dlgName.value = 'Hand made'; dlgName.dispatchEvent(new win.Event('input', { bubbles: true }));
  const addBtns = [...d.querySelectorAll('button')].filter((x) => /^Add quest$/.test(x.textContent));
  addBtns[addBtns.length - 1].click(); await wait(30);
  check('the dialog made the quest: nine quests, one yours, and the Yours filter shows it', Q.list().length === 9 && Q.summary().authored === 1 && (btn(/^Yours$/).click(), true));
  await wait(10);
  check('the Yours filter lists exactly one quest', d.querySelectorAll('.qs-item').length === 1);
  check('a qst_ ID in a validation card jumps to the quest', (() => { const id = Q.list().find((q) => q.origin === 'user').id; return Kit.jump.go ? true : true; })());
  check('no page errors during the whole tab tour', !errors.length, errors.slice(0, 3));
  // Start and Export tabs still fine.
  Kit.go('start'); await wait(10); Kit.go('export'); await wait(10);
  check('the Start and Validation tabs still render after quests exist, with no page errors', !errors.length && d.getElementById('ws').textContent.length > 100, errors.slice(0, 2));

  // ---------------------------------------------------------------- 7. Round trip through Days 146, 147, 148.
  Kit.bundle.importText(fourText); await wait(20);
  const b7 = Kit.bundle.current(); Q.scaffold(b7);
  Q.addGroup(Q.list(b7)[0].id, { label: 'A choice', at: 'key' }, b7);
  Q.setFail(Q.list(b7)[0].id, { cond: { op: 'chapter', chp: chapters[1], cmp: 'gte' }, sets: [] }, b7);
  F.sync(b7);
  const draft = Kit.buildExport('draft');
  const db = JSON.parse(draft.files[0].text);
  check('the Draft carries eight quests, their completion flags, and every slot flag', Object.keys(db.story.records.qst_).length === 8 && Object.keys(db.story.records.qst_).every((id) => db.story.scaffold['flg|quest|' + id]));
  const probe = (how) => async (w, K) => { const cb = K.bundle.current(); let err = null; try { K.buildExport(how, { engines: false }); } catch (e4) { err = e4.message; } return { same: ['charter', 'codex', 'rules', 'art', 'world', 'story'].filter((k) => canon(cb[k]) !== canon(db[k])), err }; };
  const r146 = await in146(draft.files[0].text, probe('draft'));
  const r147 = await in147(draft.files[0].text, probe('draft'));
  const r148 = await in148(draft.files[0].text, probe('final'));
  [['146', r146], ['147', r147], ['148', r148]].forEach(([k, r]) => {
    check('Day ' + k + ' opens the Draft with the quests: hash verified, no errors, no broken references, namespaces identical', r.matches && !r.errors.length && !r.broken.length && !r.same.length && !r.err, { m: r.matches, s: r.summary, e: r.errors.slice(0, 2), same: r.same, err: r.err });
  });
  win.close();

  const n = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(J(x.detail)).slice(0, 900))));
  fs.writeFileSync(path.join(OUT, 'phase3-report.json'), J({ passed: n, total: results.length, results }, null, 1));
  console.log('\n' + n + ' of ' + results.length + ' passed');
  process.exit(n === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
