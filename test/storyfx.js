// A small hand authored story over a Day 148 fixture, for exercising ENGINE_STORY before the scaffold exists (Phase 2 to
// 6 generate the real thing). Also the engine context loader and the bundle side ext, built in plain Node the way the
// page's STORY.engineExt builds it, so a test can compare the page's index with Day 150's.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

// A bare vm context holding only engine-story.js (or the given engine text), as Day 150 would load it.
function engine(text) {
  const box = vm.createContext({});
  vm.runInContext(text || fs.readFileSync(path.join(ROOT, 'engine-story.js'), 'utf8'), box, { filename: 'engine-story.js' });
  return box.ENGINE_STORY;
}
const sorted = (o) => Object.keys(o || {}).sort();
function ext(b) {
  const ids = {};
  const ids0 = (m) => sorted(m).filter((k) => m[k] && typeof m[k] === 'object');
  ['npc_', 'map_'].forEach((p) => { ids[p] = ids0(b.world.records[p]); });
  ['trp_', 'itm_', 'eqp_', 'chr_'].forEach((p) => { ids[p] = ids0(b.rules[p]); });
  ['mus_', 'sfx_', 'por_'].forEach((p) => { ids[p] = ids0(b.art.records[p]); });
  const chapters = b.charter.sections.chapters.map((c) => c.id);
  ids.chp_ = chapters.slice().sort();
  const roles = sorted(b.art.records.mus_).map((k) => b.art.records.mus_[k]).filter((m) => m.subject && m.subject.kind === 'role').map((m) => m.subject.ref.replace(/^music:/, '')).sort();
  return { chapters, start: b.world.progression.start.slice(), ids, roles };
}

// The story. Flags: one per gate key (bound), plus talked, count (range 0 to 3), greedy, kind, mainDone, sideDone.
// Quests: main (arrive, key, boss, exit, each stage exiting on the flag the next site sets) and side (offered, accepted,
// done; one branch group 'ring' with outcomes keep and give; fails once chapter two begins). Events cover every command.
function story(ES, b) {
  const X = ext(b), F = (k) => ES.ids.structural('flg_', 'flg|' + k), Q = (k) => ES.ids.structural('qst_', 'qst|' + k), V = (k) => ES.ids.structural('evt_', 'evt|' + k), N = (k) => ES.ids.structural('end_', 'end|' + k);
  const [c1, c2] = X.chapters, g = ES.gates.keys(b.world.progression);
  const flg_ = {}, bindings = {};
  const flag = (id, name, kind, extra) => { flg_[id] = Object.assign({ id, name, key: 'test|' + id, kind, default: 0, origin: 'generated', notes: '', tags: [] }, extra || {}); return id; };
  g.forEach((k) => { const id = flag(F('gate|' + k), 'Gate ' + k, 'gate'); bindings[k] = { flg: id }; });
  const f = {
    ch1: bindings['chapter:' + c1].flg, ch2: bindings['chapter:' + c2].flg, seal1: bindings['item:seal:' + c1].flg, ship: (bindings['vehicle:ship'] || {}).flg,
    talked: flag(F('talked'), 'Talked', 'story'), count: flag(F('count'), 'Count', 'counter', { range: [0, 3] }),
    greedy: flag(F('greedy'), 'Greedy', 'story'), kind: flag(F('kind'), 'Kind', 'story'), mainDone: flag(F('main-done'), 'Main done', 'quest'), sideDone: flag(F('side-done'), 'Side done', 'quest'),
    neg: flag(F('neg'), 'Starts at minus two', 'counter', { default: -2 })
  };
  bindings['item:seal:' + c1].itm = X.ids.itm_[3];
  const fl = (flg, cmp, value) => ({ op: 'flag', flg, cmp, value });
  const q = { main: Q('main'), side: Q('side') };
  const qst_ = {};
  qst_[q.main] = { id: q.main, name: 'Main', key: 'test|main', kind: 'main', chapter: c1, origin: 'generated', notes: '', tags: [], completeFlag: f.mainDone,
    stages: [{ key: 'arrive', label: 'Arrive', sets: [], exitWhen: fl(f.talked, 'gte', 1) }, { key: 'key', label: 'Find the seal', sets: [], exitWhen: fl(f.seal1, 'gte', 1) },
      { key: 'boss', label: 'Beat the boss', sets: [{ flg: f.count, value: 1 }], exitWhen: fl(f.ch2, 'gte', 1) }, { key: 'exit', label: 'Leave', sets: [] }] };
  qst_[q.side] = { id: q.side, name: 'Side', key: 'test|side', kind: 'side', chapter: c1, origin: 'generated', notes: '', tags: [], completeFlag: f.sideDone,
    stages: [{ key: 'offered', label: 'Offered', sets: [] }, { key: 'accepted', label: 'Accepted', sets: [] }, { key: 'done', label: 'Done', sets: [] }],
    branches: [{ key: 'ring', label: 'The ring', outcomes: [{ key: 'keep', label: 'Keep it', sets: [{ flg: f.greedy, value: 1 }] }, { key: 'give', label: 'Give it back', sets: [{ flg: f.kind, value: 1 }] }] }],
    fail: { cond: { op: 'chapter', chp: c2, cmp: 'gte' }, sets: [{ flg: f.count, value: 3 }] } };
  const npc = X.ids.npc_[0], npc2 = X.ids.npc_[1], ow = b.world.records.map_ && sorted(b.world.records.map_).find((k) => b.world.records.map_[k].kind === 'overworld');
  const trpBoss = X.ids.trp_.find((t) => /warden/.test(t)) || X.ids.trp_[0], itm = X.ids.itm_[0], eqp = X.ids.eqp_[0], chr = X.ids.chr_[1], por = X.ids.por_[0], sfx = X.ids.sfx_[0];
  const e = { open: V('open'), elder: V('elder'), boss: V('boss'), shared: V('shared'), caller: V('caller'), loopA: V('loop-a'), loopB: V('loop-b'), finale: V('finale'), stage: V('stage'), shop: V('shop') };
  const end = { good: N('0|good'), plain: N('1|plain') };
  const evt_ = {};
  const ev = (id, rec) => { evt_[id] = Object.assign({ id, name: id, key: 'test|' + id, origin: 'generated', notes: '', tags: [], priority: 0 }, rec); };
  ev(e.open, { trigger: 'autorun', map: ow, pages: [{ once: true, cmds: [
    { op: 'fade', to: 'in', frames: 30 }, { op: 'music', role: 'field:' + b.charter.sections.chapters[0].continentLabel.toLowerCase() },
    { op: 'text', speaker: chr, por, lines: ['The road begins here.', 'Mind the slimes.'] },
    { op: 'questStage', qst: q.main, stage: 'arrive' }, { op: 'party', chr, act: 'join' }, { op: 'gil', by: 50 }] }] });
  ev(e.elder, { trigger: 'talk', npc, pages: [
    { cmds: [{ op: 'text', speaker: npc, lines: ['Will you find my ring?'] },
      { op: 'choice', prompt: 'Help?', options: [
        { text: 'Yes', cmds: [{ op: 'questStage', qst: q.side, stage: 'accepted' }, { op: 'setFlag', flg: f.talked }] },
        { text: 'Later', cmds: [{ op: 'addFlag', flg: f.count, by: 1 }] },
        { text: 'Secret', cond: fl(f.greedy, 'eq', 1), cmds: [{ op: 'text', lines: ['Hidden.'] }] }], cancel: 1 }] },
    { cond: { op: 'quest', qst: q.side, is: 'at', stage: 'accepted' }, cmds: [
      { op: 'choice', options: [
        { text: 'Keep it', cmds: [{ op: 'questStage', qst: q.side, branch: 'ring', outcome: 'keep' }, { op: 'giveItem', itm: eqp }] },
        { text: 'Give it', cmds: [{ op: 'questStage', qst: q.side, branch: 'ring', outcome: 'give' }, { op: 'gil', by: -1000 }] }] },
      // Trying the other outcome of a decided group is refused with an error effect and writes nothing.
      { op: 'questStage', qst: q.side, branch: 'ring', outcome: 'give' },
      { op: 'questStage', qst: q.side, stage: 'done' }] },
    { cond: { op: 'quest', qst: q.side, is: 'done' }, cmds: [{ op: 'text', speaker: 'Elder', lines: ['Thank you again.'] }] }] });
  ev(e.boss, { trigger: 'step', map: ow, at: [3, 4], pages: [{ cond: fl(f.seal1, 'gte', 1), cmds: [
    { op: 'music', role: 'boss' }, { op: 'sfx', sfx },
    { op: 'startBattle', trp: trpBoss, win: [{ op: 'setFlag', flg: f.ch2 }, { op: 'if', cond: { op: 'true' }, then: f.ship ? [{ op: 'setFlag', flg: f.ship }] : [] }, { op: 'giveItem', itm, qty: 998 }, { op: 'giveItem', itm, qty: 5 }],
      escape: [{ op: 'text', lines: ['You fled.'] }] },
    { op: 'changeMap', map: ow, at: [5, 6], dir: 'down' }, { op: 'vehicle', kind: 'ship', act: 'board' }] }] });
  ev(e.shared, { trigger: 'chapterStart', pages: [{ cmds: [{ op: 'text', lines: ['Shared page zero.'] }] }, { once: true, cmds: [{ op: 'addFlag', flg: f.count, by: 5 }, { op: 'text', lines: ['Shared once.'] }] }] });
  ev(e.caller, { trigger: 'talk', npc: npc2, pages: [{ cmds: [{ op: 'moveActor', who: npc2, path: ['up', 'up', 'left'] }, { op: 'face', who: 'player', dir: 'up' }, { op: 'callEvent', evt: e.shared }, { op: 'wait', frames: 20 },
    { op: 'takeItem', itm, qty: 2 }, { op: 'if', cond: { op: 'item', itm, cmp: 'gte', value: 1000 }, then: [{ op: 'text', lines: ['Impossible.'] }], else: [{ op: 'text', lines: ['Held ok.'] }] }] }] });
  ev(e.loopA, { trigger: 'chapterStart', pages: [{ cmds: [{ op: 'callEvent', evt: e.loopB }, { op: 'text', lines: ['After the loop.'] }] }] });
  ev(e.loopB, { trigger: 'chapterStart', pages: [{ cmds: [{ op: 'callEvent', evt: e.loopA }] }] });
  ev(e.finale, { trigger: 'mapEnter', map: ow, pages: [{ cond: { op: 'chapter', chp: c2 }, cmds: [
    { op: 'if', cond: { op: 'all', of: [fl(f.kind, 'eq', 1), { op: 'quest', qst: q.main, is: 'done' }] }, then: [{ op: 'ending', end: end.good }] },
    { op: 'ending', end: end.plain }, { op: 'text', lines: ['Never shown.'] }] }] });
  ev(e.stage, { trigger: 'chapterStart', pages: [{ cmds: [{ op: 'questStage', qst: q.main, stage: 'exit' }, { op: 'questStage', qst: q.main, stage: 'key' }, { op: 'questStage', qst: q.side, fail: true }] }] });
  const end_ = {};
  end_[end.good] = { id: end.good, name: 'Good', key: 'test|good', origin: 'generated', notes: '', tags: [], priority: 2, cond: { op: 'flag', flg: f.kind } };
  end_[end.plain] = { id: end.plain, name: 'Plain', key: 'test|plain', origin: 'generated', notes: '', tags: [], priority: 0, cond: { op: 'true' } };
  return { story: { records: { flg_, qst_, dlg_: {}, evt_, end_ }, bindings }, ext: X, f, q, e, end, ids: { npc, npc2, ow, trpBoss, itm, eqp, chr, por, sfx, c1, c2 } };
}
module.exports = { engine, ext, story, ROOT };
