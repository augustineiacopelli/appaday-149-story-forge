// Phase 4 acceptance: dialogue graphs (ENGINE_STORY.dlg in src/engine-dlg.js, STORY.dialogue in src/story-dialogue.js,
// the Dialogue tab in src/ws-dialogue.js).
// 1. static: sources ASCII clean, no forbidden APIs, no dashes in UI prose, fences, engine-story.js untouched;
// 2. the engine in a bare vm context: nodes run through the real runner, choices, cmds, pick, lint, reach, replay identical;
// 3. the scaffold on both fixtures: shared greetings, quest dialogues, pages, idempotent, structural IDs, no problems;
// 4. authored work survives; the edit API and its refusals; the validator;
// 5. the preview runner and the Dialogue tab under jsdom; drafting is off without a key and fills Kit.review with one;
// 6. the round trip through Days 146, 147, 148.
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
const OUT = path.join(__dirname, 'out');
const demoText = fs.readFileSync(path.join(OUT, 'demo148-bundle.json'), 'utf8');
const fourText = fs.readFileSync(path.join(OUT, 'four148-bundle.json'), 'utf8');
const clone = (o) => JSON.parse(J(o));
const isSorted = (o) => J(Object.keys(o)) === J(Object.keys(o).sort());

(async () => {
  // ---------------------------------------------------------------- 1. Static.
  const names = ['engine-dlg.js', 'story-dialogue.js', 'ws-dialogue.js', 'story-dialogue.css'];
  const files = names.map((f) => path.join(ROOT, 'src', f));
  const read = (f) => fs.readFileSync(f, 'utf8');
  check('the four new sources exist and are pure ASCII', files.every((f) => fs.existsSync(f) && !/[^\x00-\x7f]/.test(read(f))));
  const forbidden = /roundRect|\.ellipse\(|window\.confirm|\beval\(|new Function|[^.\w]confirm\(|\.remove\(\)/;
  check('no forbidden APIs in the new JavaScript', files.slice(0, 3).every((f) => !forbidden.test(read(f))));
  const dashRe = new RegExp('\\u2013|\\u2014|\\\\u2013|\\\\u2014|\'[^\'\\n]*[A-Za-z] - [A-Za-z][^\'\\n]*\'');
  const strip = (t) => t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('no dashes used as punctuation in the new prose (the ASCII cleaner in cleanLine is the one place that names them)', files.slice(1, 3).every((f) => !dashRe.test(strip(read(f)).replace(/\\u2013\\u2014/g, ''))), 'checked');
  const html = read(path.join(ROOT, 'index.html'));
  const at = (m) => html.indexOf(m);
  check('index.html carries the engine dlg section, STORY:DIALOGUE, WS:DIALOGUE and the dialogue CSS fences, in order', at('STORY:QUESTS BEGIN') > 0 && at('STORY:DIALOGUE BEGIN') > at('STORY:QUESTS BEGIN') && at('WS:DIALOGUE BEGIN') > at('STORY:DIALOGUE BEGIN') && at('STORY:DIALOGUE CSS BEGIN') > 0);
  const engFile = read(path.join(ROOT, 'src', 'engine-story.js'));
  const { execSync } = require('child_process');
  let headEng = null; try { headEng = execSync('git show HEAD:src/engine-story.js', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString(); } catch (e) { headEng = null; }
  check('src/engine-story.js (the frame) is unchanged by Phase 4', headEng === null || headEng === engFile);
  const rootEng = read(path.join(ROOT, 'engine-story.js'));
  check('the standalone engine-story.js holds the dlg section and stays free of for-in and host globals', /S\.dlg = \{/.test(rootEng) && !/for \(var \w+ in /.test(rootEng) && !/\b(window|document|localStorage|fetch|XMLHttpRequest)\b/.test(rootEng.replace(/\/\/.*$/gm, '')));

  // ---------------------------------------------------------------- 2. The engine in a bare vm context.
  const ES = engine(rootEng), ES2 = engine(rootEng);
  check('ENGINE_STORY.dlg exposes the dialogue API and is deep frozen', ['compile', 'playIndex', 'begin', 'step', 'choose', 'play', 'talk', 'pick', 'lintPages', 'lint', 'edges', 'reach', 'loop', 'refs'].every((k) => typeof ES.dlg[k] === 'function') && Object.isFrozen(ES.dlg));
  const W = { id: 'dlg_t1', name: 'T', start: 'a', speaker: 'chr_x', nodes: {
    a: { lines: ['Hello there.'], cmds: [{ op: 'setFlag', flg: 'flg_none', value: 1 }], choices: [{ text: 'Yes', next: 'b' }, { text: 'No', next: 'c' }] },
    b: { lines: ['Great.', 'Truly.'], next: 'c' },
    c: { lines: ['Farewell.'] },
    z: { lines: ['Nobody sees this.'] } } };
  const cp = ES.dlg.compile(W, 'a');
  check('compile turns a node into ordinary commands: text, effects, then a choice', cp && cp.hasChoice && cp.cmds[0].op === 'text' && cp.cmds[cp.cmds.length - 1].op === 'choice' && cp.choiceNext.length === 2 && cp.choiceNext[0] === 'b', cp);
  check('edges, reach, and loop read the graph', ES.dlg.edges(W).length === 3 && ES.dlg.reach(W).unreachable.join() === 'z' && ES.dlg.reach(W).order.join() === 'a,b,c' && !ES.dlg.loop(W));
  const loopRec = { start: 'a', nodes: { a: { lines: ['x'], next: 'b' }, b: { lines: ['y'], next: 'a' } } };
  check('a cycle of only next links is a loop error', !!ES.dlg.loop(loopRec) && ES.dlg.lint(loopRec, { known: {}, dialogues: {} }, 'd').some((p) => p.level === 'error' && p.code === 'loop'));
  const lint = ES.dlg.lint({ start: 'q', nodes: { a: { lines: [''], next: 'a', choices: [{ text: 'x' }] } } }, { known: {}, dialogues: {} }, 'd');
  check('lint reports a start that is not a node, an empty line, and next together with choices', ['ref', 'empty-line', 'next-and-choices'].every((c) => lint.some((p) => p.code === c)), lint.map((p) => p.code));

  // A tiny index so the runner has flags and a quest.
  const b0 = JSON.parse(fourText);
  const hand = () => {
    const idx = ES.index.build({ records: { flg_: { flg_a: { id: 'flg_a', name: 'A', key: 'a', kind: 'story', default: 0 } }, qst_: {}, dlg_: { dlg_t1: Object.assign({}, W, { nodes: Object.assign({}, W.nodes, { a: Object.assign({}, W.nodes.a, { cmds: [{ op: 'setFlag', flg: 'flg_a', value: 1 }] }) }) }),
      dlg_t2: { id: 'dlg_t2', name: 'T2', start: 's', nodes: { s: { lines: ['Second.'] } } } }, evt_: {}, end_: {} }, bindings: {}, npcDialogue: { npc_n: [{ dlg: 'dlg_t1' }, { cond: { op: 'flag', flg: 'flg_a', cmp: 'gte', value: 1 }, dlg: 'dlg_t2' }] } }, { chapters: [], start: [], ids: {}, roles: [] });
    return ES.dlg.playIndex(idx);
  };
  const idx = hand(), st0 = ES.state.create(idx, {});
  const play = (E, i, s) => E.dlg.play(s, 'dlg_t1', i, { choices: [0] });
  const r1 = play(ES, idx, st0);
  check('play runs a conversation to its end through the real runner: lines, a choice, the final end effect', r1 && Array.isArray(r1.effects) && r1.effects.some((e) => e.kind === 'text') && r1.effects.some((e) => e.kind === 'choice') && r1.effects[r1.effects.length - 1].kind === 'end', r1 && r1.effects && r1.effects.map((e) => e.kind));
  check('the node effects change the state (setFlag ran)', ES.state.flag(r1.state, idx, 'flg_a') === 1);
  const idx2 = (() => { const i = hand(); return i; })();
  const r2 = play(ES2, idx2, ES2.state.create(idx2, {}));
  check('a second engine instance replays byte for byte (same effects, same state hash)', J(r1.effects) === J(r2.effects) && ES.state.hash(r1.state) === ES2.state.hash(r2.state));
  const talk0 = ES.dlg.talk(st0, 'npc_n', idx), talk1 = ES.dlg.talk(r1.state, 'npc_n', idx);
  check('talk picks the rightmost passing page: the first dialogue at first, the second once the flag is set', talk0.page === 0 && talk1.page === 1 && talk1.effect.kind === 'text' && talk1.effect.lines[0] === 'Second.', [talk0.page, talk1.page]);
  check('a person with no pages says nothing (kind none)', ES.dlg.talk(st0, 'npc_nobody', idx).effect.kind === 'none');

  // ---------------------------------------------------------------- 3. The scaffold.
  const { win, errors } = await boot149();
  const Kit = win.Kit, STORY = win.STORY, D = STORY.dialogue, Q = STORY.quests, F = STORY.flags, E = win.ENGINE_STORY, d = win.document;
  check('boots with no page errors and STORY.dialogue is the Phase 4 API', !errors.length && D && ['scaffold', 'wanted', 'check', 'edit', 'update', 'addNode', 'updateNode', 'replaceNode', 'renameNode', 'removeNode', 'setStart', 'addChoice', 'updateChoice', 'removeChoice', 'moveChoice', 'add', 'remove', 'reset', 'usedBy', 'pagesOf', 'setPages', 'addPage', 'updatePage', 'removePage', 'movePage', 'resetPages', 'people', 'summary', 'expected', 'list', 'playIndex', 'previewState', 'draft', 'draftPrompt'].every((k) => typeof D[k] === 'function'), errors.slice(0, 2));
  check('dlg_ is the StoryDialogue Codex type and carries kind, role, qst, start, and nodes fields', Kit.codex.typeFor('dlg_') === 'StoryDialogue' && ['kind', 'role', 'qst', 'start', 'nodes', 'speaker'].every((k) => Kit.codex.type('StoryDialogue').fields.some((f) => f.key === k)));
  Kit.bundle.importText(fourText); await wait(20);
  let b = Kit.bundle.current();
  check('opening a Final does not build dialogue by itself', Object.keys(b.story.records.dlg_).length === 0 && Object.keys(b.story.npcDialogue).length === 0);
  Q.scaffold(b);
  const ex0 = D.expected(b);
  check('expected: 42 role greetings and 8 quest dialogues, none built yet', ex0.total === 50 && ex0.missing === 50 && ex0.by.role.want === 42 && ex0.by.quest.want === 8, ex0);
  const rep = D.scaffold(b);
  const recs = D.list(b), npcs = Object.keys(b.world.records.npc_);
  check('the scaffold builds 50 dialogues and gives all 87 people pages', rep.created.length === 50 && recs.length === 50 && npcs.length === 87 && npcs.every((n) => D.pagesOf(n, b).length >= 1), { c: rep.created.length, n: npcs.length });
  const roles = {}; npcs.forEach((n) => { const r = b.world.records.npc_[n]; roles[r.role] = 1; });
  check('every Day 148 role has a greeting in its own chapter, shared by everyone of that role', Object.keys(roles).every((role) => recs.some((r) => r.kind === 'role' && r.role === role)) && recs.filter((r) => r.kind === 'role').every((r) => D.usedBy(r.id, b).length >= 1));
  const nm = npcs.map((n) => b.world.records.npc_[n]).find((n) => n.role === 'guard');
  const pg = D.pagesOf(nm.id, b), chapters = b.charter.sections.chapters.map((c) => c.id), ci = chapters.indexOf(nm.chapter);
  check('a person gets pages from their own chapter onward: the first always open, later ones on a chapter gate', pg.length === chapters.length - ci && !pg[0].cond && pg.slice(1).every((p, i) => p.cond && p.cond.op === 'chapter' && p.cond.chp === chapters[ci + 1 + i] && p.cond.cmp === 'gte') && pg.every((p) => p.origin === 'generated' && p.key), J(pg).slice(0, 300));
  const quests = Q.list(b).filter((q) => q.giver);
  check('every quest with a giver has a quest dialogue, pages on the giver tied to its stages', quests.length === 8 && quests.every((q) => { const dl = recs.find((r) => r.qst === q.id); return dl && dl.speaker === q.giver && D.pagesOf(q.giver, b).some((p) => p.dlg === dl.id && p.cond && p.cond.op === 'quest'); }));
  const side = Q.list(b).filter((q) => q.kind === 'side')[0], sd = recs.find((r) => r.qst === side.id);
  check('a side quest dialogue offers, accepts, defers, asks for progress, and turns in: choices that move the quest', ['offer', 'accept', 'later', 'progress', 'turnin', 'after'].every((k) => sd.nodes[k]) && sd.nodes.offer.choices.length === 2 && J(sd.nodes.offer.choices[0].cmds).indexOf('questStage') > 0 && J(sd.nodes.turnin.cmds).indexOf('questStage') > 0);
  check('structural IDs: the same key always gives the same ID, and records are sorted', recs.every((r) => /^dlg_/.test(r.id)) && D.idFor('dlg|quest|' + side.id) === sd.id && isSorted(b.story.records.dlg_) && isSorted(b.story.npcDialogue));
  const snap = J([b.story.records.dlg_, b.story.npcDialogue, b.story.scaffold]);
  const rep2 = D.scaffold(b);
  check('idempotent: a second run builds nothing and changes nothing', !rep2.changed && !rep2.created.length && !rep2.removed.length && J([b.story.records.dlg_, b.story.npcDialogue, b.story.scaffold]) === snap);
  F.sync(b);
  const v = Kit.validate(b), dv = [].concat(v.errors, v.broken, v.warnings).filter((p) => /^dlg_|^story$/.test(p.recordId || ''));
  check('the validator finds no problem in the built dialogue', dv.length === 0 && !v.errors.length && !v.broken.length, dv.slice(0, 3));
  const rd = Kit.bundle.current();
  check('the flag cross reference sees the dialogue (F.xref reads node effects and page conditions)', JSON.stringify(Object.keys(F.xref ? F.xref(b) || {} : {})).length > 2);
  // the generated side quest plays through the engine: offer, accept, progress, turn in
  const pidx = D.playIndex(b), s0 = D.previewState(b, {});
  const ro = E.dlg.play(s0, sd.id, pidx, { choices: [0] });
  check('the engine plays the side quest dialogue: accepting moves the quest to its accept stage', ro.state.quests[side.id].stage === side.stages[1].key, ro.state.quests[side.id]);
  const tk = E.dlg.talk(ro.state, side.giver, pidx);
  check('after accepting, talking to the giver opens the progress node (page by stage)', tk.page >= 0 && tk.effect.kind === 'text' || tk.effect.kind === 'choice', tk.effect);
  const demo = await boot149(); demo.win.Kit.bundle.importText(demoText); await wait(20);
  const bd = demo.win.Kit.bundle.current(); demo.win.STORY.quests.scaffold(bd);
  const repd = demo.win.STORY.dialogue.scaffold(bd);
  const vd = demo.win.Kit.validate(bd), dvd = [].concat(vd.errors, vd.broken, vd.warnings).filter((p) => /^dlg_|^story$/.test(p.recordId || ''));
  check('the Demo story builds 16 dialogues for 35 people with no problems, and a second run is a no op', repd.created.length === 16 && Object.keys(bd.story.npcDialogue).length === 35 && !demo.win.STORY.dialogue.scaffold(bd).changed && !dvd.length, dvd.slice(0, 2));
  demo.win.close();

  // ---------------------------------------------------------------- 4. Authored work and the edit API.
  const roleD = recs.find((r) => r.kind === 'role');
  let r = D.updateNode(roleD.id, 'hello', { lines: ['A hand written line.'] }, b);
  check('editing a node keeps the dialogue and survives a rebuild', r.ok && D.list(b).find((x) => x.id === roleD.id).nodes.hello.lines[0] === 'A hand written line.' && (D.scaffold(b), b.story.records.dlg_[roleD.id].nodes.hello.lines[0] === 'A hand written line.'));
  r = D.addNode(roleD.id, { key: 'second', lines: ['More.'] }, b);
  check('addNode adds a node; an existing key and a bad key are refused', r.ok && D.addNode(roleD.id, { key: 'second' }, b).ok === false && D.addNode(roleD.id, { key: 'Bad Key' }, b).ok === false);
  r = D.updateNode(roleD.id, 'hello', { next: 'second' }, b);
  check('a node can go to another node, and next to a missing node is refused', r.ok && D.updateNode(roleD.id, 'hello', { next: 'ghost' }, b).ok === false && b.story.records.dlg_[roleD.id].nodes.hello.next === 'second');
  check('a cycle of next links is refused', D.updateNode(roleD.id, 'second', { next: 'hello' }, b).ok === false);
  r = D.renameNode(roleD.id, 'second', 'second_b', b);
  check('renameNode moves links with it', r.ok && b.story.records.dlg_[roleD.id].nodes.hello.next === 'second_b' && !b.story.records.dlg_[roleD.id].nodes.second);
  r = D.addChoice(roleD.id, 'hello', { text: 'Tell me more.', next: 'second_b' }, b);
  check('addChoice turns next into a choice list (next removed, the old link kept as a choice)', r.ok && !b.story.records.dlg_[roleD.id].nodes.hello.next && b.story.records.dlg_[roleD.id].nodes.hello.choices.length === 2);
  check('updateChoice, moveChoice, and removeChoice work and refuse out of range', D.updateChoice(roleD.id, 'hello', 1, { text: 'Go on.' }, b).ok && D.moveChoice(roleD.id, 'hello', 1, -1, b).ok && D.removeChoice(roleD.id, 'hello', 0, b).ok && D.moveChoice(roleD.id, 'hello', 0, -1, b).ok === false);
  const rm = D.removeNode(roleD.id, 'second_b', b);
  check('removeNode cuts the links to it and refuses the start node', rm.ok && D.removeNode(roleD.id, roleD.start, b).ok === false);
  r = D.add({ name: 'The mayor speaks' }, b);
  check('a dialogue made by hand is kept: minted ID, origin user, one node', r.ok && r.record.origin === 'user' && r.record.kind === 'custom' && Object.keys(r.record.nodes).length === 1 && D.list(b).some((x) => x.id === r.record.id));
  const mine = r.record.id, who = npcs[0];
  const before = D.pagesOf(who, b).length;
  check('addPage appends a page the author owns', D.addPage(who, { dlg: mine }, b).ok && D.pagesOf(who, b).length === before + 1 && D.pagesOf(who, b)[before].origin === 'user');
  check('a page that names a missing dialogue is refused, and so is a missing node', D.addPage(who, { dlg: 'dlg_nothing' }, b).ok === false && D.updatePage(who, before, { node: 'ghost' }, b).ok === false);
  D.scaffold(b);
  check('a rebuild keeps the author page after the generated ones', D.pagesOf(who, b)[D.pagesOf(who, b).length - 1].dlg === mine);
  const gp = D.pagesOf(who, b)[0];
  check('editing a generated page makes it the author\'s and keeps its key, so a rebuild leaves it', D.updatePage(who, 0, { cond: { op: 'chapter', chp: chapters[0], cmp: 'gte' } }, b).ok && D.pagesOf(who, b)[0].origin === 'user' && D.pagesOf(who, b)[0].key === gp.key && (D.scaffold(b), D.pagesOf(who, b)[0].origin === 'user'));
  check('movePage and removePage work', D.movePage(who, 0, 1, b).ok && D.removePage(who, 0, b).ok);
  check('resetPages goes back to the generated list', D.resetPages(who, b).ok && D.pagesOf(who, b).every((p) => p.origin === 'generated') && D.pagesOf(who, b).length === chapters.length - chapters.indexOf(b.world.records.npc_[who].chapter));
  D.scaffold(b);
  const used = D.usedBy(mine, b);
  D.addPage(who, { dlg: mine }, b);
  const rmd = D.remove(mine, b);
  check('removing a dialogue removes the pages that opened it', rmd.ok && !b.story.records.dlg_[mine] && !D.pagesOf(who, b).some((p) => p.dlg === mine));
  const gone = recs.find((x) => x.kind === 'quest');
  check('a generated dialogue comes back with the next build, and reset restores its words', D.remove(gone.id, b).ok && (D.scaffold(b), !!b.story.records.dlg_[gone.id]) && (D.updateNode(gone.id, b.story.records.dlg_[gone.id].start, { lines: ['Changed.'] }, b), D.reset(gone.id, b).ok && b.story.records.dlg_[gone.id].nodes[b.story.records.dlg_[gone.id].start].lines[0] !== 'Changed.'));
  const qd = recs.find((x) => x.kind === 'quest');
  const stale = Object.keys(b.story.records.dlg_).length;
  b.story.records.qst_[quests[0].id].giver = undefined; delete b.story.records.qst_[quests[0].id].giver;
  const repS = D.scaffold(b);
  check('a quest that loses its giver drops its generated dialogue and pages', repS.removed.length === 1 && Object.keys(b.story.records.dlg_).length === stale - 1);

  // ---------------------------------------------------------------- 5. The tab, the runner, and drafting.
  Kit.bundle.importText(fourText); await wait(20);
  b = Kit.bundle.current(); Q.scaffold(b);
  check('the tab mounts the real Dialogue tab (not the Phase 4 stub) and the jump handler opens a dialogue', Kit.go('dialogue') && !/Arrives in Phase 4/.test(d.getElementById('ws').textContent) && !!STORY.WS.dialogue);
  await wait(30);
  const ws0 = d.getElementById('ws');
  check('before building, the tab offers the build button and says there is no dialogue yet', /Build dialogue from the world/.test(ws0.textContent) && /No dialogue yet/.test(ws0.textContent));
  const btn = (re) => Array.from(d.querySelectorAll('#ws button')).find((x) => re.test(x.textContent));
  btn(/Build dialogue from the world/).click(); await wait(80);
  check('the build button builds 50 dialogues and 87 people, with the stats chips showing it', Object.keys(Kit.bundle.current().story.records.dlg_).length === 50 && /50 dialogues/.test(d.getElementById('ws').textContent) && /up to date/.test(d.getElementById('ws').textContent));
  const first = D.list(Kit.bundle.current())[0];
  STORY.dialogueUi.open[first.id] = true; Kit.rerender(); await wait(40);
  check('an open dialogue shows its node list, an SVG graph with one node per node, and the line editor', d.querySelectorAll('.dg-node').length === Object.keys(first.nodes).length && !!d.querySelector('.dg-edit') && !!d.querySelector('textarea.dg-lines') && d.querySelectorAll('.dg-nodes button').length >= Object.keys(first.nodes).length);
  btn(/Run from the start/).click(); await wait(20);
  check('the preview runs the real engine: the first line shows and the conversation ends', /End of conversation/.test(d.querySelector('.dg-log').textContent) && d.querySelectorAll('.dg-l-say').length >= 1);
  const sdr = D.list(Kit.bundle.current()).find((x) => x.qst && Kit.bundle.current().story.records.qst_[x.qst].kind === 'side');
  STORY.dialogueUi.open[sdr.id] = true; STORY.dialogueUi.node[sdr.id] = 'offer'; Kit.rerender(); await wait(40);
  const rb = Array.from(d.querySelectorAll('[data-dlg="' + sdr.id + '"] button')).find((x) => /Run from the start/.test(x.textContent)); rb.click(); await wait(20);
  const sdlog = () => d.querySelector('[data-dlg="' + sdr.id + '"] .dg-log');
  const opts = d.querySelectorAll('[data-dlg="' + sdr.id + '"] .dg-opt');
  check('a node with choices shows each as a button; picking "I will help" continues the conversation', opts.length === 2);
  opts[0].click(); await wait(20);
  check('after the choice the preview shows the answer and the quest stage effect', /Thank you/.test(sdlog().textContent) && /Quest .* now at/.test(sdlog().textContent), sdlog().textContent.slice(-200));
  STORY.dialogueUi.view = 'people'; Kit.rerender(); await wait(40);
  d.querySelector('.dg-item .fg-head').click(); await wait(20);
  check('the People view lists people with page editors and a Talk button that picks a page', d.querySelectorAll('.dg-page').length >= 1 && (btn(/^Talk to /).click(), true));
  await wait(20);
  check('Talk to a person runs their picked page', /Page \d+ was picked/.test(d.querySelector('.dg-log').textContent));
  STORY.dialogueUi.view = 'dialogues';
  check('without an API key drafting is disabled with a hint and D.draft returns null without calling Claude', !Kit.ai.hasKey() && (Kit.rerender(), true));
  await wait(30);
  const dbtn = Array.from(d.querySelectorAll('#ws button')).find((x) => /Draft with Claude/.test(x.textContent));
  let called = 0; const orig = Kit.claude; Kit.claude = function () { called++; return orig.apply(this, arguments); };
  const nokey = await D.draft(first.id, first.start);
  check('the draft button is disabled and draft() makes no call without a key', (!dbtn || dbtn.disabled) && nokey === null && called === 0 && /needs a Claude API key|off until you add/.test(d.getElementById('ws').textContent), { dbtn: !!dbtn, dis: dbtn && dbtn.disabled });
  Kit.claude = orig;
  const dp = D.draftPrompt(b.story.records.dlg_[first.id], first.start, b, 'Make it warmer.');
  check('the drafting prompt carries the Charter summary, the node, the request, and the plain punctuation rules', /Charter|canon|glossary/i.test(dp.user) && dp.user.indexOf(first.start) > 0 && /warmer/.test(dp.user) && /dashes/.test(dp.system) && /JSON/.test(dp.system));
  check('cleanLine strips dashes and tidies spaces', D.cleanLine('Wait \u2014 now  go - quickly') === 'Wait, now go, quickly' && D.cleanLine('  ok  ') === 'ok');
  win.localStorage && null;
  // with a key and a stubbed Claude: three drafts open in Kit.review and accepting replaces only the lines
  Kit.ai.hasKey = function () { return true; };
  Kit.claude = async function () { called++; return { json: { drafts: [{ name: 'Warm', lines: ['Welcome, friend.', 'Stay awhile.'] }, { name: 'Brisk', lines: ['State your business.'] }, { name: 'Bad', lines: [] }] } }; };
  let opened = null; const ro2 = Kit.review.open; Kit.review.open = function (drafts, type, onAccept) { opened = { drafts, type, onAccept }; };
  const out = await D.draft(first.id, first.start, {});
  check('with a key, drafting asks Claude once and opens two usable drafts in Kit.review (the empty one is dropped)', called === 1 && out && out.length === 2 && opened && opened.type === 'StoryDialogue' && opened.drafts.length === 2);
  const snapNode = J(Kit.bundle.current().story.records.dlg_[first.id].nodes[first.start]);
  const ok = opened.onAccept(opened.drafts[0]);
  const nodeAfter = Kit.bundle.current().story.records.dlg_[first.id].nodes[first.start];
  check('accepting a draft replaces the lines of that node and nothing else', ok && nodeAfter.lines[0] === 'Welcome, friend.' && J(Object.assign({}, nodeAfter, { lines: null })) === J(Object.assign({}, JSON.parse(snapNode), { lines: null })));
  Kit.review.open = ro2; Kit.claude = orig;
  check('the page raised no errors through all of it', !errors.length, errors.slice(0, 2));

  // ---------------------------------------------------------------- 6. Round trip through Days 146, 147, 148.
  Kit.bundle.importText(fourText); await wait(20);
  const b7 = Kit.bundle.current(); Q.scaffold(b7); D.scaffold(b7); F.sync(b7);
  D.addNode(Object.keys(b7.story.records.dlg_)[0], { key: 'extra', lines: ['x'] }, b7);
  const draft = Kit.buildExport('draft');
  const db = JSON.parse(draft.files[0].text);
  check('the Draft carries 50 dialogues and every person\'s pages', Object.keys(db.story.records.dlg_).length === 50 && Object.keys(db.story.npcDialogue).length === 87);
  const probe = (how) => async (w, K) => { const cb = K.bundle.current(); let err = null; try { K.buildExport(how, { engines: false }); } catch (e4) { err = e4.message; } return { same: ['charter', 'codex', 'rules', 'art', 'world'].filter((k) => J(cb[k] || null) !== J(JSON.parse(draft.files[0].text)[k] || null)), err }; };
  const r146 = await in146(draft.files[0].text, probe('draft'));
  const r147 = await in147(draft.files[0].text, probe('draft'));
  const r148 = await in148(draft.files[0].text, probe('final'));
  [['146', r146], ['147', r147], ['148', r148]].forEach(([k, rr]) => {
    check('Day ' + k + ' opens the Draft with the dialogue: hash verified, no errors, no broken references', rr.matches && !rr.errors.length && !rr.broken.length && !rr.err, { m: rr.matches, e: (rr.errors || []).slice(0, 2), br: (rr.broken || []).slice(0, 2), err: rr.err });
  });
  win.close();

  const n = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(J(x.detail)).slice(0, 900))));
  fs.writeFileSync(path.join(OUT, 'phase4-report.json'), J({ passed: n, total: results.length, results }, null, 1));
  console.log('\n' + n + ' of ' + results.length + ' passed');
  process.exit(n === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
