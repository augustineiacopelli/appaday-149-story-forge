// Phase 1 acceptance: the ENGINE:STORY core. Loads engine-story.js alone in bare vm contexts (as Day 150 will) and checks
// 1. the static contract: sections spliced in order, one deep frozen global, the determinism rules on the whole fence;
// 2. the index and the new game state;
// 3. conditions: every op and comparison, lint for each mistake, what a tree reads;
// 4. commands: lint for each op's mistakes, the id field rule, self calls, and the refs summary;
// 5. pages: the highest passing page wins, once pages step aside, event lint;
// 6. the runner: every command's effect, silent commands, choices with hidden options, battles won, lost, and escaped,
//    calls with recursion refused, endings, errors that write nothing, branch exclusivity, quests settling on exitWhen
//    and fail, the chapter following its bound flag, waiting and busy refusals, and immutability of the input state;
// 7. saves: the derived slots, the round trip through Day 146's flags list, defaults left out, limits;
// 8. determinism: whole cutscenes replayed in two vm contexts, and in the page, byte for byte;
// 9. the page: STORY.engineIndex equals the index Day 150 builds from the same bundle, memoized until the bundle moves.
// Run from test/.
'use strict';
const fs = require('fs');
const path = require('path');
const { engine, story, ext, ROOT } = require('./storyfx');
const { boot149, wait } = require('./story');
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
const J = JSON.stringify;
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => J(k) + ':' + canon(v[k])).join(',') + '}';
  return J(v);
}
const OUT = path.join(__dirname, 'out');
const demo = JSON.parse(fs.readFileSync(path.join(OUT, 'demo148-bundle.json'), 'utf8'));
const four = JSON.parse(fs.readFileSync(path.join(OUT, 'four148-bundle.json'), 'utf8'));
const codes = (list) => list.map((p) => p.code).sort();
const has = (list, code, pathPart) => list.some((p) => p.code === code && (!pathPart || p.path.indexOf(pathPart) >= 0));

(async () => {
  // ---------------------------------------------------------------- 1. static contract
  const engText = fs.readFileSync(path.join(ROOT, 'engine-story.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sections = ['index (Phase 1)', 'conditions (Phase 1)', 'commands (Phase 1)', 'the runner (Phase 1)', 'pages (Phase 1)', 'saves (Phase 1)', 'later phases insert sections above this line'];
  const at = sections.map((s) => engText.indexOf('// ---------------------------------------------------------------- ' + s));
  check('engine sections spliced above the freeze line in order: index, conditions, commands, runner, pages, saves', at.every((x, i) => x > 0 && (!i || x > at[i - 1])), at);
  const fence = engText.slice(engText.indexOf('// === ENGINE:STORY BEGIN ==='));
  check('the page carries the same ENGINE:STORY fence as engine-story.js', html.indexOf(fence.trim()) > 0);
  const code = fence.replace(/\/\/.*$/gm, '');
  const banned = { 'Math.random': /Math\.random/, Date: /\bDate\b/, performance: /\bperformance\b/, eval: /\beval\s*\(/, 'new Function': /new\s+Function/, 'for in': /for\s*\(\s*(var\s+)?\w+\s+in\b/, window: /\bwindow\b/, document: /\bdocument\b/, Kit: /\bKit\b/, ENGINE_WORLD: /ENGINE_WORLD/, localStorage: /localStorage/, setTimeout: /setTimeout|setInterval/, 'Math.sin/cos/exp/log/pow': /Math\.(sin|cos|tan|exp|log|pow|atan)/ };
  const hits = Object.keys(banned).filter((k) => banned[k].test(code));
  check('the whole fence keeps the rules: no randomness, clocks, eval, for in, timers, host globals, and Object.keys only in util.keys', !hits.length && code.split('Object.keys(').length === 2, hits);
  const ES = engine(), ES2 = engine();
  const api = ['index.build', 'state.create', 'state.hash', 'state.flag', 'state.chapterOf', 'cond.eval', 'cond.lint', 'cond.reads', 'cmd.lint', 'cmd.walk', 'cmd.refs', 'pages.pick', 'pages.lint', 'run.start', 'run.step', 'run.choose', 'run.resolve', 'run.play', 'run.active', 'quests.settle', 'save.toFlags', 'save.fromFlags', 'save.toSave', 'save.fromSave', 'save.slots', 'save.limits'];
  const missing = api.filter((n) => { const [a, b] = n.split('.'); return !ES[a] || typeof ES[a][b] !== 'function'; });
  check('the API is all there: ' + api.length + ' functions', !missing.length, missing);
  const frozen = ['index', 'state', 'cond', 'cmd', 'pages', 'run', 'quests', 'save'].every((k) => Object.isFrozen(ES[k])) && Object.isFrozen(ES.cmd.OPS) && Object.isFrozen(ES.save.LIMITS);
  check('every section is deep frozen, version 1.0.0', frozen && ES.version === '1.0.0');
  check('the closed vocabularies: 8 condition ops, 21 commands, 6 triggers', ES.cond.OPS.length === 8 && ES.cmd.OPS.length === 21 && ES.pages.TRIGGERS.length === 6 &&
    J(ES.cmd.OPS) === J(['addFlag', 'callEvent', 'changeMap', 'choice', 'ending', 'face', 'fade', 'gil', 'giveItem', 'if', 'moveActor', 'music', 'party', 'questStage', 'setFlag', 'sfx', 'startBattle', 'takeItem', 'text', 'vehicle', 'wait']), [ES.cond.OPS, ES.cmd.OPS, ES.pages.TRIGGERS]);

  // ---------------------------------------------------------------- 2. index and state
  const S = story(ES, demo), I = ES.index.build(S.story, S.ext), { f, q, e, end, ids } = S;
  check('index: flags with defaults and ranges, quests shaped, events, endings, chapters in Charter order', Object.keys(I.flags).length === Object.keys(S.story.records.flg_).length &&
    J(I.flags[f.count].range) === '[0,3]' && I.flags[f.neg].default === -2 && I.quests[q.main].stages.length === 4 && I.quests[q.main].stageAt.boss === 2 &&
    J(I.quests[q.side].branchOrder) === '["ring"]' && Object.keys(I.events).length === 9 && Object.keys(I.endings).length === 2 && J(I.chapters) === J([ids.c1, ids.c2]));
  check('index: every gate bound, chapter flags known, the start gate resolved to its flag, roles without the music: prefix', Object.keys(I.gates).length === ES.gates.keys(demo.world.progression).length &&
    I.chapterFlags[ids.c1] === f.ch1 && I.chapterFlags[ids.c2] === f.ch2 && J(I.start) === J([f.ch1]) && I.roles.battle && I.roles['field:westland'] && !I.roles['music:battle'] && I.gates['item:seal:' + ids.c1].itm);
  const I2 = ES2.index.build(JSON.parse(J(S.story)), JSON.parse(J(S.ext)));
  check('index: the same in a second vm context, byte for byte, digest included', J(I) === J(I2) && /^[0-9a-f]{8}:1$/.test(I.digest));
  const shuffled = JSON.parse(J(S.story)); shuffled.records.flg_ = Object.fromEntries(Object.entries(shuffled.records.flg_).reverse());
  check('index: record key order does not matter', J(ES.index.build(shuffled, S.ext)) === J(I));
  const src = JSON.parse(J(S.story)); const Ix = ES.index.build(src, S.ext); src.records.flg_[f.talked].default = 9;
  check('index: owns its copies, so a later edit of the source changes nothing built', Ix.flags[f.talked].default === 0);
  const bad = ES.index.build({ records: { flg_: { flg_a_1234: { default: 7, range: [0, 3] }, flg_b_1234: { default: 1.5 } } } }, {});
  check('index: a default outside the range is clamped, a fraction is 0', bad.flags.flg_a_1234.default === 3 && bad.flags.flg_b_1234.default === 0);
  const s0 = ES.state.create(I, { gil: 10, party: [ids.chr, ids.chr], items: { [ids.itm]: 2000, bogus: -1 } });
  check('new game: every flag at its default, the start gate at 1, chapter one, empty quests, items capped at 999, party deduplicated',
    s0.flags[f.ch1] === 1 && s0.flags[f.ch2] === 0 && s0.flags[f.neg] === -2 && s0.chapter === ids.c1 && s0.quests[q.main].stage === null && s0.items[ids.itm] === 999 && !('bogus' in s0.items) &&
    J(s0.party) === J([ids.chr]) && s0.gil === 10 && s0.run === null && s0.ending === null && J(Object.keys(s0)) === J(Object.keys(s0).sort()));
  check('state.hash is stable and order free', ES.state.hash(s0) === ES2.state.hash(JSON.parse(J(s0))) && ES.state.hash(s0) !== ES.state.hash(Object.assign({}, s0, { gil: 11 })));

  // ---------------------------------------------------------------- 3. conditions
  const C = (t, st) => ES.cond.eval(t, st || s0, I);
  const st1 = Object.assign(JSON.parse(J(s0)), { flags: Object.assign({}, s0.flags, { [f.count]: 2 }) });
  const cmpTable = [['eq', 2, true], ['eq', 3, false], ['ne', 3, true], ['gt', 1, true], ['gt', 2, false], ['gte', 2, true], ['lt', 3, true], ['lt', 2, false], ['lte', 2, true], ['lte', 1, false]];
  check('flag: all six comparisons against value', cmpTable.every(([cmp, v, want]) => C({ op: 'flag', flg: f.count, cmp, value: v }, st1) === want));
  check('flag: defaults to gte 1; an unset flag reads its default', C({ op: 'flag', flg: f.ch1 }) && !C({ op: 'flag', flg: f.ch2 }) && C({ op: 'flag', flg: f.neg, cmp: 'eq', value: -2 }) && C({ op: 'flag', flg: 'flg_unknown_0000', cmp: 'eq', value: 0 }));
  check('true, missing (null and undefined) pass; all, any, not; empty all passes and empty any fails',
    C({ op: 'true' }) && C(null) && C(undefined) && C({ op: 'all', of: [] }) && !C({ op: 'any', of: [] }) && C({ op: 'not', of: { op: 'flag', flg: f.ch2 } }) &&
    C({ op: 'any', of: [{ op: 'flag', flg: f.ch2 }, { op: 'true' }] }) && !C({ op: 'all', of: [{ op: 'true' }, { op: 'flag', flg: f.ch2 }] }));
  check('item counts itm_ and eqp_ held', C({ op: 'item', itm: ids.itm, cmp: 'eq', value: 999 }) && !C({ op: 'item', itm: ids.eqp }) && C({ op: 'item', itm: ids.eqp, cmp: 'eq', value: 0 }));
  const inCh2 = Object.assign(JSON.parse(J(s0)), { chapter: ids.c2 });
  check('chapter compares Charter positions (default gte)', C({ op: 'chapter', chp: ids.c1 }) && !C({ op: 'chapter', chp: ids.c2 }) && C({ op: 'chapter', chp: ids.c2 }, inCh2) && C({ op: 'chapter', chp: ids.c2, cmp: 'lt' }) && !C({ op: 'chapter', chp: 'chp_nope_0000' }));
  const qs = JSON.parse(J(s0)); qs.quests[q.main].stage = 'boss'; qs.quests[q.side] = { stage: 'accepted', failed: true, closed: [] };
  check('quest: at, reached (not after failing), started, done, failed', C({ op: 'quest', qst: q.main, is: 'at', stage: 'boss' }, qs) && C({ op: 'quest', qst: q.main, is: 'reached', stage: 'key' }, qs) &&
    !C({ op: 'quest', qst: q.main, is: 'reached', stage: 'exit' }, qs) && C({ op: 'quest', qst: q.main, is: 'started' }, qs) && !C({ op: 'quest', qst: q.main, is: 'done' }, qs) &&
    C({ op: 'quest', qst: q.side, is: 'failed' }, qs) && !C({ op: 'quest', qst: q.side, is: 'reached', stage: 'offered' }, qs) && !C({ op: 'quest', qst: q.main, is: 'started' }));
  let deep = { op: 'true' }; for (let i = 0; i < 40; i++) deep = { op: 'not', of: deep };
  check('an unknown op, a string, and a tree deeper than 32 all fail closed (never throw)', !C({ op: 'eval', code: 'true' }) && !C('true') && !C(deep) && !C({ op: 'all' }));
  const L = (t) => ES.cond.lint(t, I);
  check('lint: a clean tree has no problems', !L({ op: 'all', of: [{ op: 'flag', flg: f.ch1 }, { op: 'item', itm: ids.eqp }, { op: 'chapter', chp: ids.c2, cmp: 'lt' }, { op: 'quest', qst: q.main, is: 'reached', stage: 'key' }, { op: 'not', of: { op: 'true' } }] }).length);
  check('lint: unknown op, unresolved flag, item, chapter, quest, stage; bad cmp; fractional value; missing of; strings',
    has(L({ op: 'nope' }), 'op') && has(L({ op: 'flag', flg: 'flg_nope_0000' }), 'ref') && has(L({ op: 'item', itm: ids.chr }), 'ref') && has(L({ op: 'chapter', chp: 'chp_x_0000' }), 'ref') &&
    has(L({ op: 'quest', qst: 'qst_x_0000', is: 'at' }), 'ref') && has(L({ op: 'quest', qst: q.main, is: 'at', stage: 'nowhere' }), 'ref') && has(L({ op: 'quest', qst: q.main, is: 'sideways' }), 'is') &&
    has(L({ op: 'flag', flg: f.ch1, cmp: '>=' }), 'cmp') && has(L({ op: 'flag', flg: f.ch1, value: 1.5 }), 'not-int') && has(L({ op: 'any' }), 'missing') && has(L({ op: 'not', of: [] }), 'missing') && has(L('flag'), 'not-object'));
  check('lint: an id field, a comparison no value in the flag\'s range can pass, an empty any, too deep', has(L({ op: 'true', id: 'x' }), 'id-field') && has(L({ op: 'flag', flg: f.count, cmp: 'gt', value: 3 }), 'never') &&
    has(L({ op: 'any', of: [] }), 'never') && has(L(deep), 'too-deep'));
  check('lint paths point into the tree', L({ op: 'all', of: [{ op: 'true' }, { op: 'flag', flg: 'flg_nope_0000' }] })[0].path === 'cond.of[1].flg');
  check('reads: every flag, item, chapter, and quest a tree reads, sorted and unique', J(ES.cond.reads({ op: 'any', of: [{ op: 'flag', flg: f.kind }, { op: 'not', of: { op: 'flag', flg: f.ch1 } }, { op: 'flag', flg: f.kind }, { op: 'item', itm: ids.itm }, { op: 'quest', qst: q.side, is: 'failed' }, { op: 'chapter', chp: ids.c2 }] })) ===
    J({ flags: [f.ch1, f.kind].sort(), items: [ids.itm], chapters: [ids.c2], quests: [q.side] }));

  // ---------------------------------------------------------------- 4. commands
  const CL = (list, ctx) => ES.cmd.lint(list, I, 'cmds', ctx);
  let allClean = true, dirty = {};
  Object.keys(S.story.records.evt_).forEach((id) => { const p = ES.pages.lint(S.story.records.evt_[id], I, id, id).filter((x) => x.level === 'error'); if (p.length && id !== e.loopA && id !== e.loopB) { allClean = false; dirty[id] = p; } });
  check('the test story lints clean, every event, every command', allClean, dirty);
  const bads = [
    ['text', { op: 'text', lines: [] }, 'missing'], ['text', { op: 'text', lines: ['x'], speaker: 'npc_nobody_0000' }, 'ref'], ['text', { op: 'text', lines: ['x'], por: 'por_x_0000' }, 'ref'],
    ['choice', { op: 'choice', options: [] }, 'missing'], ['choice', { op: 'choice', options: [{ text: '' }, { text: 'b' }] }, 'missing'], ['choice', { op: 'choice', options: [{ text: 'a' }, { text: 'b' }], cancel: 2 }, 'range'],
    ['if', { op: 'if', cond: { op: 'bogus' }, then: [] }, 'op'], ['setFlag', { op: 'setFlag', flg: 'flg_nope_0000' }, 'ref'], ['addFlag', { op: 'addFlag', flg: f.count, by: 0.5 }, 'not-int'],
    ['giveItem', { op: 'giveItem', itm: ids.chr }, 'ref'], ['takeItem', { op: 'takeItem', itm: ids.itm, qty: 0 }, 'range'], ['gil', { op: 'gil' }, 'missing'],
    ['questStage', { op: 'questStage', qst: q.main, stage: 'nope' }, 'ref'], ['questStage', { op: 'questStage', qst: q.side, branch: 'ring', outcome: 'sell' }, 'ref'], ['questStage', { op: 'questStage', qst: q.side, stage: 'done', fail: true }, 'mode'],
    ['party', { op: 'party', chr: ids.chr, act: 'kick' }, 'enum'], ['startBattle', { op: 'startBattle', trp: 'trp_none_0000' }, 'ref'], ['startBattle', { op: 'startBattle', trp: ids.trpBoss, win: [{ op: 'nope' }] }, 'op'],
    ['moveActor', { op: 'moveActor', who: 'player', path: ['north'] }, 'missing'], ['face', { op: 'face', who: ids.npc, dir: 'north' }, 'enum'], ['face', { op: 'face', who: 'npc_ghost_0000', dir: 'up' }, 'ref'],
    ['wait', { op: 'wait', frames: 0 }, 'range'], ['fade', { op: 'fade', to: 'sideways' }, 'enum'], ['music', { op: 'music' }, 'missing'], ['music', { op: 'music', mus: 'mus_none_0000' }, 'ref'], ['music', { op: 'music', role: 'field:atlantis' }, 'unscored'],
    ['sfx', { op: 'sfx', sfx: ids.chr }, 'ref'], ['changeMap', { op: 'changeMap', map: ids.ow, at: [1] }, 'type'], ['changeMap', { op: 'changeMap', map: 'map_nowhere_0000' }, 'ref'],
    ['vehicle', { op: 'vehicle', kind: 'balloon', act: 'board' }, 'enum'], ['callEvent', { op: 'callEvent', evt: 'evt_nope_0000' }, 'ref'], ['ending', { op: 'ending', end: 'end_nope_0000' }, 'ref'], ['unknown', { op: 'goto', to: 3 }, 'op']
  ];
  const missed = bads.filter(([, c, want]) => !has(CL([c]), want)).map(([n, c, want]) => n + ':' + want + ' got ' + J(codes(CL([c]))));
  check('lint catches every op\'s mistakes (' + bads.length + ' cases)', !missed.length, missed);
  check('lint covers all 21 ops with a mistake each', new Set(bads.map((x) => x[0])).size === 22);
  check('lint: an id field anywhere, a self call, nesting past 16, a list that is not a list', has(CL([{ op: 'wait', frames: 1, id: 'x' }]), 'id-field') && has(CL([{ op: 'callEvent', evt: e.loopA }], { evt: e.loopA }), 'recursion') &&
    has(CL((() => { let l = [{ op: 'wait', frames: 1 }]; for (let i = 0; i < 18; i++) l = [{ op: 'if', cond: { op: 'true' }, then: l }]; return l; })()), 'too-deep') && has(ES.cmd.lint('nope', I), 'not-list'));
  check('lint: warnings for a one option choice, an if with no lists, an if with no condition, but no errors', (() => { const p = CL([{ op: 'choice', options: [{ text: 'a' }] }, { op: 'if', cond: { op: 'true' } }, { op: 'if', then: [] }]); return p.every((x) => x.level === 'warning') && has(p, 'one-option') && has(p, 'empty') && has(p, 'always'); })());
  check('lint paths name the nested command', CL([{ op: 'if', cond: { op: 'true' }, then: [{ op: 'choice', options: [{ text: 'a', cmds: [{ op: 'nope' }] }, { text: 'b' }] }] }])[0].path === 'cmds[0].then[0].options[0].cmds[0].op');
  const refs = ES.cmd.refs(S.story.records.evt_[e.elder].pages[1].cmds.concat(S.story.records.evt_[e.boss].pages[0].cmds, S.story.records.evt_[e.caller].pages[0].cmds));
  check('refs: sets, reads, quest moves, items given and taken, events called, battles, every ID by prefix', J(refs.sets.flags) === J([f.ch2, f.ship].sort()) && J(refs.reads.items) === J([ids.itm]) &&
    J(refs.quests[q.side]) === J(['done', 'ring.give', 'ring.keep']) && J(refs.items.give) === J([ids.eqp, ids.itm].sort()) && J(refs.items.take) === J([ids.itm]) && J(refs.events) === J([e.shared]) &&
    J(refs.battles) === J([ids.trpBoss]) && refs.refs.npc_ && refs.refs.sfx_[0] === ids.sfx && refs.refs.map_[0] === ids.ow, refs);
  let visited = 0; ES.cmd.walk(S.story.records.evt_[e.elder].pages[0].cmds, () => visited++);
  check('walk visits nested commands depth first (2 + 2 + 1 + 1 in the elder\'s first page)', visited === 6, visited);

  // ---------------------------------------------------------------- 5. pages
  const elder = S.story.records.evt_[e.elder];
  const stAcc = JSON.parse(J(s0)); stAcc.quests[q.side].stage = 'accepted';
  const stDone = JSON.parse(J(s0)); stDone.quests[q.side].stage = 'done';
  check('pick: the highest page whose condition passes wins (rightmost rule)', ES.pages.pick(e.elder, s0, I) === 0 && ES.pages.pick(e.elder, stAcc, I) === 1 && ES.pages.pick(e.elder, stDone, I) === 2 && ES.pages.pick(elder, stDone, I) === 2);
  const seenSt = JSON.parse(J(s0)); seenSt.seen[e.shared + '#1'] = 1;
  check('pick: a once page that has run steps aside for the page below; none passing is -1', ES.pages.pick(e.shared, s0, I) === 1 && ES.pages.pick(e.shared, seenSt, I) === 0 && ES.pages.pick(e.boss, s0, I) === -1 && ES.pages.pick('evt_none_0000', s0, I) === -1);
  const PL = (rec) => ES.pages.lint(rec, I, 'event', 'evt_x_0000');
  check('event lint: trigger, its site (map, npc, cell, troop), pages, once, priority',
    has(PL({ trigger: 'hover', pages: [{ cmds: [] }] }), 'enum') && has(PL({ trigger: 'talk', pages: [{ cmds: [] }] }), 'missing', 'npc') && has(PL({ trigger: 'step', map: ids.ow, pages: [{ cmds: [] }] }), 'missing', 'at') &&
    has(PL({ trigger: 'mapEnter', map: 'map_x_0000', pages: [{ cmds: [] }] }), 'ref', 'map') && has(PL({ trigger: 'battleEnd', trp: 'trp_x_0000', pages: [{ cmds: [] }] }), 'ref') && has(PL({ trigger: 'chapterStart', pages: [] }), 'missing', 'pages') &&
    has(PL({ trigger: 'chapterStart', pages: [{}] }), 'missing', 'cmds') && has(PL({ trigger: 'chapterStart', pages: [{ cmds: [], once: 'yes' }] }), 'type') && has(PL({ trigger: 'chapterStart', priority: 1.5, pages: [{ cmds: [] }] }), 'not-int') &&
    !PL({ trigger: 'battleEnd', pages: [{ cmds: [] }] }).length);
  check('event lint: an autorun page that is not once and never changes what it reads warns of a loop', has(PL({ trigger: 'autorun', map: ids.ow, pages: [{ cond: { op: 'flag', flg: f.talked, cmp: 'eq', value: 0 }, cmds: [{ op: 'wait', frames: 1 }] }] }), 'autorun-loop') &&
    !has(PL({ trigger: 'autorun', map: ids.ow, pages: [{ cond: { op: 'flag', flg: f.talked, cmp: 'eq', value: 0 }, cmds: [{ op: 'setFlag', flg: f.talked }] }] }), 'autorun-loop'));

  // ---------------------------------------------------------------- 6. the runner
  const frozenIn = JSON.parse(J(s0)), before = J(frozenIn);
  let r = ES.run.start(frozenIn, e.open, I);
  check('start never touches the state passed in', J(frozenIn) === before);
  const kinds = (res) => res.effects.map((x) => x.kind).join(' ');
  const p1 = ES.run.play(s0, e.open, I);
  check('the opening cutscene: fade, music, text, quest, party, gil, end; once page marked; main quest started', kinds(p1) === 'fade music text questStage party gil end' && p1.done &&
    p1.state.seen[e.open + '#0'] === 1 && p1.state.quests[q.main].stage === 'arrive' && J(p1.state.party) === J([ids.chr]) && p1.state.gil === 60 && p1.state.run === null, kinds(p1));
  const tx = p1.effects[2], mu = p1.effects[1];
  check('effects carry their command\'s fields: text speaker, portrait, lines; music role', tx.speaker === ids.chr && tx.por === ids.por && J(tx.lines) === J(['The road begins here.', 'Mind the slimes.']) && mu.role === 'field:westland' && mu.op === undefined);
  check('a once page never runs twice: the opening has no page left', ES.run.start(p1.state, e.open, I).effect.kind === 'none');
  const p2 = ES.run.play(p1.state, e.elder, I, { choices: [0] });
  const ch = p2.effects[1];
  check('a choice hides options whose condition fails, keeps original indexes, and names the cancel option', ch.kind === 'choice' && J(ch.options.map((o) => o.index)) === '[0,1]' && ch.cancel === 1 && ch.prompt === 'Help?');
  check('choosing Yes: the side quest is accepted, talked is set, and the main quest settles from arrive to key on the way out', kinds(p2) === 'text choice questStage end' && p2.state.quests[q.side].stage === 'accepted' &&
    p2.state.flags[f.talked] === 1 && p2.state.quests[q.main].stage === 'key' && J(p2.effects[3].quests) === J([{ qst: q.main, from: 'arrive', to: 'key' }]), p2.effects[3]);
  // Waiting and option refusals.
  const w1 = ES.run.start(p1.state, e.elder, I); const w2 = ES.run.step(w1.state, I); const w3 = ES.run.step(w2.state, I);
  check('step refuses while a choice is waiting, and so does start; resolve refuses without a battle', w2.waiting === 'choice' && w3.effect.kind === 'error' && w3.effect.code === 'waiting' && w3.waiting === 'choice' &&
    ES.run.start(w2.state, e.caller, I).effect.code === 'waiting' && ES.run.resolve(w2.state, 'win', I).effect.code === 'not-waiting' && J(w3.state) === J(w2.state));
  const w4 = ES.run.choose(w2.state, 2, I);
  check('choosing a hidden option is refused and the choice stays open', w4.effect.code === 'option' && w4.waiting === 'choice' && J(w4.state) === J(w2.state));
  const later = ES.run.choose(w2.state, 1, I);
  check('choosing Later adds to the counter and carries on past the choice', later.effect.kind === 'end' && later.state.flags[f.count] === 1);
  // Branches and exclusivity.
  const p3 = ES.run.play(p2.state, e.elder, I, { choices: [1] });
  const errAt = p3.effects.findIndex((x) => x.kind === 'error');
  check('branch: giving the ring back sets kind, closes the ring group, and takes gil down to 0, never below', p3.state.flags[f.kind] === 1 && J(p3.state.quests[q.side].closed) === '["ring"]' && p3.state.gil === 0 && p3.effects[2].by === -60);
  check('branch: the other outcome is then refused with an error effect and writes nothing, and the run carries on to done', errAt === 3 && p3.effects[errAt].code === 'closed' && p3.state.flags[f.greedy] === 0 &&
    p3.state.quests[q.side].stage === 'done' && p3.state.flags[f.sideDone] === 1 && p3.done);
  const p3k = ES.run.play(p2.state, e.elder, I, { choices: [0] });
  check('branch: keeping it instead sets greedy and gives the ring', p3k.state.flags[f.greedy] === 1 && p3k.state.flags[f.kind] === 0 && p3k.state.items[ids.eqp] === 1);
  check('pages move with the quest: after done, the elder says thank you', kinds(ES.run.play(p3.state, e.elder, I)) === 'text end');
  // Battles.
  const noSeal = ES.run.start(p3.state, e.boss, I);
  check('a step event with no passing page runs nothing', noSeal.effect.kind === 'none' && noSeal.done);
  const sealed = JSON.parse(J(p3.state)); sealed.flags[f.seal1] = 1;
  const b1 = ES.run.play(sealed, e.boss, I);
  check('the boss: music, sfx, then the battle waits with canLose false and canEscape true', kinds(b1) === 'music sfx startBattle' && b1.waiting === 'battle' && b1.effects[2].trp === ids.trpBoss && b1.effects[2].canLose === false && b1.effects[2].canEscape === true);
  const won = ES.run.play(sealed, e.boss, I, { battles: ['win'] });
  check('win: chapter two flag and ship set silently, items stack to 999 and no further, then the map change and the ship', kinds(won) === 'music sfx startBattle giveItem giveItem changeMap vehicle end' &&
    won.state.flags[f.ch2] === 1 && won.state.flags[f.ship] === 1 && won.effects[3].held === 999 && won.effects[3].qty === 0 && won.effects[4].qty === 0 && won.effects[5].map === ids.ow && J(won.effects[5].at) === '[5,6]');
  check('the chapter follows its bound flag: chapter two now, and the main quest settles boss to exit (completeFlag set)', won.state.chapter === ids.c2 && won.state.quests[q.main].stage === 'exit' && won.state.flags[f.mainDone] === 1 &&
    J(won.effects[7].quests) === J([{ qst: q.main, from: 'key', to: 'boss' }, { qst: q.main, from: 'boss', to: 'exit' }]), won.effects[7]);
  check('entering a stage applies its sets (boss sets count to 1)', won.state.flags[f.count] === 1);
  const lost = ES.run.play(sealed, e.boss, I, { battles: ['lose'] });
  check('lose with no lose list is game over: the run ends, nothing after runs', kinds(lost) === 'music sfx startBattle gameover' && lost.done && lost.state.run === null && lost.state.flags[f.ch2] === 0);
  const fled = ES.run.play(sealed, e.boss, I, { battles: ['escape'] });
  check('escape runs the escape list and carries on', kinds(fled) === 'music sfx startBattle text changeMap vehicle end');
  const b2 = ES.run.resolve(b1.state, 'draw', I);
  check('a battle outcome other than win, lose, or escape is refused and the battle still waits', b2.effect.code === 'outcome' && b2.waiting === 'battle');
  // Side quest failing on chapter two.
  check('settle: the side quest, accepted but not done, fails when chapter two begins, applying its fail sets', (() => {
    const s = JSON.parse(J(p2.state)); s.flags[f.seal1] = 1;
    const r2 = ES.run.play(s, e.boss, I, { battles: ['win'] });
    return r2.state.quests[q.side].failed === true && r2.state.flags[f.count] === 3 && r2.effects[r2.effects.length - 1].quests.some((c) => c.qst === q.side && c.failed);
  })());
  // Calls, once, and recursion.
  const cl = ES.run.play(won.state, e.caller, I);
  check('callEvent runs the callee\'s active page (once), then returns: move, face, text, wait, takeItem, else branch', kinds(cl) === 'moveActor face text wait takeItem text end' && cl.effects[2].lines[0] === 'Shared once.' &&
    cl.state.flags[f.count] === 3 && cl.state.seen[e.shared + '#1'] === 1 && cl.effects[4].qty === -2 && cl.effects[4].held === 997 && cl.effects[5].lines[0] === 'Held ok.' && J(cl.effects[0].path) === '["up","up","left"]');
  const cl2 = ES.run.play(cl.state, e.caller, I);
  check('called again, the once page has run, so page zero shows through', cl2.effects[2].lines[0] === 'Shared page zero.');
  const loop = ES.run.play(s0, e.loopA, I);
  check('a call cycle (A calls B calls A) is refused with an error effect, and the rest still runs', kinds(loop) === 'error text end' && loop.effects[0].code === 'recursion', kinds(loop));
  // Stage rules.
  const sg = ES.run.play(p1.state, e.stage, I);
  check('questStage: skipping ahead applies every skipped stage\'s sets; moving back is refused; failing a complete quest is refused',
    kinds(sg) === 'questStage error questStage end' && sg.state.quests[q.main].stage === 'exit' && sg.state.flags[f.count] === 3 && sg.state.flags[f.mainDone] === 1 && sg.effects[1].code === 'backward' &&
    sg.effects[2].fail === true && sg.state.quests[q.side].failed === true, kinds(sg));
  const fin = ES.run.play(cl.state, e.finale, I);
  check('the finale: an all condition picks the good ending; nothing after an ending runs; the game is over', kinds(fin) === 'ending' && fin.effects[0].end === end.good && fin.state.ending === end.good && fin.done &&
    ES.run.start(fin.state, e.caller, I).effect.code === 'ended');
  const greedyFin = ES.run.play(won.state, e.finale, I);
  check('without kind, the plain ending', greedyFin.state.ending === (won.state.flags[f.kind] ? end.good : end.plain));
  const busy = ES.run.start(b1.state, e.caller, I);
  check('only one event runs at a time; step with nothing running is idle', busy.effect.code === 'waiting' && ES.run.step(s0, I).effect.kind === 'idle' && ES.run.start(s0, 'evt_x_0000', I).effect.code === 'ref');
  const forced = ES.run.start(s0, e.elder, I, { page: 2 });
  check('the playtester can force a page; a page that is not there is refused', forced.effect.kind === 'text' && ES.run.start(s0, e.elder, I, { page: 9 }).effect.code === 'page');
  const mid = ES.run.play(p1.state, e.elder, I);
  const resumed = ES.run.choose(JSON.parse(J(mid.state)), 0, I);
  check('a state paused mid cutscene is plain JSON: copied through JSON and resumed in another context, it finishes the same', J(ES2.run.choose(JSON.parse(J(mid.state)), 0, I2)) === J(resumed) && J(mid.state.run.wait.path) === '[1]');
  const clamp = ES.run.play(Object.assign(JSON.parse(J(s0)), { flags: Object.assign({}, s0.flags, { [f.count]: 3 }) }), e.elder, I, { choices: [1] });
  check('addFlag clamps to the flag\'s range', clamp.state.flags[f.count] === 3);
  const settled = ES.quests.settle(Object.assign(JSON.parse(J(p1.state)), { flags: Object.assign({}, p1.state.flags, { [f.talked]: 1, [f.seal1]: 1 }) }), I);
  check('quests.settle on its own chains exitWhen across stages and reports each move', settled.state.quests[q.main].stage === 'boss' && settled.changes.length === 2);

  // ---------------------------------------------------------------- 7. saves
  const slots = ES.save.slots(I);
  check('save slots: one per quest and one per event with once pages, structural, sorted', slots.length === 4 && slots.every((s, i) => !i || slots[i - 1].flg < s.flg) && ES.save.questSlot(q.main) === ES.ids.structural('flg_', 'flg|quest|' + q.main) &&
    slots.filter((s) => s.kind === 'once').map((s) => s.of).sort().join() === [e.open, e.shared].sort().join(), slots);
  const rt = (st) => { const L2 = ES.save.toFlags(st, I); const back = ES2.save.fromFlags(JSON.parse(J(L2)), I2, { gil: st.gil, party: st.party, items: st.items }); return { L2, back }; };
  const strip = (st) => { const c = JSON.parse(J(st)); c.run = null; return canon(c); };
  const samples = [s0, p1.state, p2.state, p3.state, won.state, cl.state, sg.state];
  const rts = samples.map(rt);
  check('round trip: ' + samples.length + ' states through Day 146\'s flags list and back, in another context, identical', rts.every((x, i) => strip(x.back) === strip(samples[i])), rts.map((x, i) => strip(x.back) === strip(samples[i])));
  const L3 = rts[3].L2;
  check('the flags list is [{flg, value}] whole numbers, sorted, defaults left out, quest packed', L3.every((x, i) => Object.keys(x).join() === 'flg,value' && Number.isInteger(x.value) && (!i || L3[i - 1].flg < x.flg)) &&
    !L3.some((x) => x.flg === f.greedy) && L3.find((x) => x.flg === ES.save.questSlot(q.side)).value === (3 | (1 << 9)), L3);
  const zeroStart = JSON.parse(J(s0)); zeroStart.flags[f.ch1] = 0;
  check('a start gate set back to 0 survives the round trip (saves start from defaults, not a new game)', ES.save.fromFlags(ES.save.toFlags(zeroStart, I), I).flags[f.ch1] === 0);
  const failedRt = rt(sg.state);
  check('a failed quest and an accepted branch pack and unpack', failedRt.back.quests[q.side].failed === true && rts[3].back.quests[q.side].closed[0] === 'ring');
  check('toSave refuses mid event and after an ending; fromSave takes party members as objects', ES.save.toSave(mid.state, I).error && ES.save.toSave(fin.state, I).error &&
    (() => { const sv = ES.save.toSave(won.state, I); sv.party = sv.party.map((c) => ({ chr: c, level: 5 })); const back = ES.save.fromSave(JSON.parse(J(sv)), I); return strip(back) === strip(won.state) && sv.chapter === ids.c2 && sv.inventory[0].qty === 999; })());
  const big = ES.index.build({ records: { qst_: { qst_big_0000: { stages: Array.from({ length: 300 }, (_, i) => ({ key: 's' + i })), branches: Array.from({ length: 23 }, (_, i) => ({ key: 'g' + i, outcomes: [{ key: 'a' }] })) } },
    evt_: { evt_big_0000: { trigger: 'chapterStart', pages: Array.from({ length: 33 }, () => ({ once: true, cmds: [] })) } } } }, {});
  check('save limits: 255 stages, 22 branch groups, once pages 0 to 30', J(codes(ES.save.limits(big))) === J(['save-limit', 'save-limit', 'save-limit']) && !ES.save.limits(I).length);

  // ---------------------------------------------------------------- 8. determinism
  const script = (E, Ix, s) => {
    const trace = [];
    const go = (st, evt, ans) => { const p = E.run.play(st, evt, Ix, ans); trace.push(p.effects, E.state.hash(p.state)); return p.state; };
    let st = go(s, e.open); st = go(st, e.elder, { choices: [0] }); st = go(st, e.elder, { choices: [1] }); st.flags[f.seal1] = 1;
    st = go(st, e.boss, { battles: ['win'] }); st = go(st, e.caller); st = go(st, e.caller); st = go(st, e.loopA); st = go(st, e.finale);
    trace.push(E.save.toFlags(st, Ix));
    return J(trace) + J(st);
  };
  const tA = script(ES, I, ES.state.create(I, { gil: 10 })), tB = script(ES2, I2, ES2.state.create(I2, { gil: 10 }));
  check('a whole playthrough replays byte for byte in two vm contexts (effects, state hashes, final state, saved flags)', tA === tB && tA.length > 3000, tA.length);
  // The four continent fixture: the same story shape over 6 chapters indexes and runs the same way twice.
  const S4 = story(ES, four), I4a = ES.index.build(S4.story, S4.ext), I4b = ES2.index.build(JSON.parse(J(S4.story)), JSON.parse(J(S4.ext)));
  check('the four continent fixture: 14 gate keys bound, 6 chapters, same index and playthrough in two contexts', Object.keys(I4a.gates).length === 14 && I4a.chapters.length === 6 && J(I4a) === J(I4b) &&
    (() => { const run = (E, Ix) => J(E.run.play(E.state.create(Ix), S4.e.open, Ix)); return run(ES, I4a) === run(ES2, I4b); })());

  // ---------------------------------------------------------------- 9. the page
  const { win, errors } = await boot149();
  const { STORY, Kit } = win;
  STORY.loadFixture('demo'); await wait(20);
  const b = Kit.bundle.current();
  const pageExt = JSON.parse(J(STORY.engineExt(b)));
  check('STORY.engineExt equals the ext Day 150 builds from the bundle', canon(pageExt) === canon(ext(demo)), { page: Object.keys(pageExt.ids).map((k) => k + pageExt.ids[k].length) });
  b.story.records = JSON.parse(J(S.story.records)); b.story.bindings = JSON.parse(J(S.story.bindings)); Kit.bundle.touch('test');
  const pi = STORY.engineIndex(b);
  check('STORY.engineIndex equals the bare engine\'s index of the same bundle, byte for byte', J(pi) === J(I));
  check('memoized while the bundle is unchanged, rebuilt after a change', STORY.engineIndex(b) === pi && (Kit.bundle.touch('again'), STORY.engineIndex(b) !== pi));
  const pageTrace = script(win.ENGINE_STORY, STORY.engineIndex(b), win.ENGINE_STORY.state.create(STORY.engineIndex(b), { gil: 10 }));
  check('the same playthrough in the page (jsdom) gives the same bytes as in the bare contexts', pageTrace === tA);
  check('no page errors', !errors.length, errors.slice(0, 3));
  win.close();

  const n = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(J(x.detail)).slice(0, 900))));
  fs.writeFileSync(path.join(OUT, 'phase1-report.json'), J({ passed: n, total: results.length, results }, null, 1));
  console.log('\n' + n + ' of ' + results.length + ' passed');
  process.exit(n === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
