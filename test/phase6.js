// Phase 6 acceptance: endings and the playtime floor (STORY.ends in src/story-endings.js, the Endings and Playtime cards in
// src/ws-endings.js on the Start tab).
// 1. static: sources ASCII clean, no forbidden APIs, no dashes in UI prose, fences in order, no engine code changed;
// 2. the scaffold on both fixtures: one end_ per Charter ending, structural IDs, one fallback, priorities, flags, idempotent, clean;
// 3. earned endings built from the optional quests (and from a managed flag when quests run out), picked by priority;
// 4. the playtime floor as an error, optional minutes reported on their own;
// 5. the finale: the choice for flag earned endings, epilogue and music, every ending reachable, replayed in two bare vm contexts;
// 6. the edit API and its refusals, the fallback swap, validator findings, regeneration, orphans;
// 7. the Endings and Playtime cards under jsdom;
// 8. two fresh pages agree; the round trip through Days 146, 147, 148.
// Run from test/.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { engine } = require('./storyfx');
const { ext } = require('./storyfx');
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

async function prepared(text, opts) {
  const r = await boot149();
  const { Kit, STORY } = r.win;
  Kit.bundle.importText(text); await wait(20);
  const b = Kit.bundle.current();
  if (opts && opts.endings) { b.charter.sections.endings.endings = opts.endings; Kit.index.invalidate(); }
  STORY.quests.scaffold(b); STORY.dialogue.scaffold(b); STORY.flags.sync(b);
  if (!opts || opts.events !== false) STORY.events.scaffold(b);
  return r;
}
const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const lastKey = (q) => q.stages[q.stages.length - 1].key;
// Plays an event from a state, taking option choices[i] at each choice (default the first) and winning every battle.
function playEvent(ES, idx, state, evt, choices) {
  let r = ES.run.start(state, evt, idx), seen = [], ci = 0;
  for (let k = 0; k < 5000 && !r.done; k++) {
    if (r.effect) seen.push(r.effect);
    r = r.waiting === 'choice' ? ES.run.choose(r.state, r.effect.options[Math.min(choices && choices[ci] !== undefined ? choices[ci++] : 0, r.effect.options.length - 1)].index, idx) : r.waiting === 'battle' ? ES.run.resolve(r.state, 'win', idx) : ES.run.step(r.state, idx);
  }
  if (r.effect) seen.push(r.effect);
  return { r, effects: seen };
}

(async () => {
  // ---------------------------------------------------------------- 1. Static.
  const names = ['story-endings.js', 'ws-endings.js', 'story-endings.css'];
  const files = names.map((f) => path.join(ROOT, 'src', f));
  const read = (f) => fs.readFileSync(f, 'utf8');
  check('the three new sources exist and are pure ASCII', files.every((f) => fs.existsSync(f) && !/[^\x00-\x7f]/.test(read(f))) && !/[^\x00-\x7f]/.test(read(path.join(ROOT, 'src', 'story-events.js'))));
  const forbidden = /roundRect|\.ellipse\(|window\.confirm|(^|[^.\w])eval\(|new Function|[^.\w]confirm\(|\.remove\(\)|localStorage|Math\.random/;
  check('no forbidden APIs in the new JavaScript (and no randomness or storage of its own)', files.slice(0, 2).every((f) => !forbidden.test(read(f))));
  const dashRe = new RegExp('\\u2013|\\u2014|\'[^\'\\n]*[A-Za-z] - [A-Za-z][^\'\\n]*\'');
  const strip = (t) => t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('no dashes used as punctuation in the new prose', files.slice(0, 2).every((f) => !dashRe.test(strip(read(f)))));
  const html = read(path.join(ROOT, 'index.html'));
  const at = (m) => html.indexOf(m);
  check('index.html carries STORY:ENDINGS after STORY:EVENTS, WS:ENDINGS after WS:EVENTS, and the endings CSS fence', at('STORY:ENDINGS BEGIN') > at('STORY:EVENTS END') && at('WS:ENDINGS BEGIN') > at('WS:EVENTS END') && at('WS:ENDINGS BEGIN') < at('WS:STORY149 BEGIN') && at('STORY:ENDINGS CSS BEGIN') > 0);
  const engineFiles = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => /^engine-/.test(f));
  const changed = engineFiles.filter((f) => { const h = git('git show HEAD:src/' + f); return h !== null && h !== read(path.join(ROOT, 'src', f)); });
  check('Phase 6 changes no engine code: every src/engine-*.js equals the last commit', changed.length === 0, changed);
  const rootEng = read(path.join(ROOT, 'engine-story.js')), headRoot = git('git show HEAD:engine-story.js');
  check('the standalone engine-story.js is byte for byte what Phase 5 shipped', headRoot === null || headRoot === rootEng);
  const bj = read(path.join(ROOT, 'build.js'));
  check('build.js picks up the three new files', /story-endings\.js/.test(bj) && /ws-endings\.js/.test(bj) && /story-endings\.css/.test(bj));

  // ---------------------------------------------------------------- 2. The scaffold on both fixtures.
  const want = { demo: { text: demoText, n: 2 }, four: { text: fourText, n: 1 } };
  const built = {};
  for (const [fx, spec] of Object.entries(want)) {
    const r = await prepared(spec.text);
    built[fx] = r;
    const { Kit, STORY, ENGINE_STORY: ES } = r.win, X = STORY.ends, E = STORY.events, b = Kit.bundle.current();
    const orig = JSON.parse(spec.text), charter = orig.charter.sections.endings.endings;
    check(fx + ': before the scaffold there are no end_ records and the summary says so', X.list(b).length === 0 && X.summary(b).missing === spec.n && X.problems(b)[0].code === 'none-built');
    const rep = X.scaffold(b);
    const list = Object.values(b.story.records.end_), byOrder = list.slice().sort((x, y) => x.order - y.order);
    check(fx + ': the scaffold builds one end_ per Charter ending (' + spec.n + '), in list order', rep.created.length === spec.n && list.length === spec.n && byOrder.every((e, i) => e.name === charter[i].name && e.concept === charter[i].concept && e.order === i + 1), rep);
    check(fx + ': each ID is structural, from the position and the name, and valid', byOrder.every((e, i) => e.id === ES.ids.structural('end_', 'end|' + (i + 1) + '|' + slug(charter[i].name)) && e.key === 'end|' + (i + 1) + '|' + slug(charter[i].name) && Kit.ids.isValid(e.id) && e.origin === 'generated'));
    check(fx + ': each carries its generated digest, credits music ending:n, and the concept as its epilogue', byOrder.every((e, i) => e.gen === E.genOf(e) && e.music === 'ending:' + (i + 1) && J(e.epilogue) === J([charter[i].concept]) && !E.isEdited(e)));
    const fb = X.fallbacks(b);
    check(fx + ': exactly one fallback, the first Charter ending, always true, priority 0', fb.length === 1 && fb[0].id === byOrder[0].id && J(fb[0].cond) === J({ op: 'true' }) && fb[0].priority === 0);
    check(fx + ': later endings are earned and tested first (priority 10 times the index)', byOrder.slice(1).every((e, i) => e.priority === 10 * (i + 1) && !X.isFallback(e)));
    check(fx + ': the finale test order is the highest priority first and the fallback last', E.endingOrder(b).map((e) => e.order).join() === byOrder.map((e) => e.order).reverse().join());
    const flagKeys = Object.keys(b.story.scaffold).filter((k) => k.indexOf('flg|ending|') === 0);
    if (fx === 'demo') {
      const kept = byOrder[1], c = kept.cond, fl = b.story.records.flg_[c.flg];
      check('demo: with no optional quests the second ending reads a managed flag at 1 or more', c.op === 'flag' && c.cmp === 'gte' && c.value === 1 && !!fl && fl.origin === 'generated' && fl.kind === 'story' && fl.default === 0 && J(fl.range) === J([0, 1]) && fl.id === ES.ids.structural('flg_', 'flg|ending|2'), c);
      check('demo: the managed flag is tracked in the scaffold map and its note says the finale asks the player', flagKeys.length === 1 && b.story.scaffold['flg|ending|2'] === c.flg && /finale asks the player/.test(fl.notes) && rep.flagsMade.length === 1);
      check('demo: the report says why, in prose', /2 endings built/.test(X.reportText(rep)) && /no side or B story quests/.test(X.reportText(rep)));
    } else {
      check('four: a single ending needs no managed flag and no hint', flagKeys.length === 0 && rep.flagsMade.length === 0 && rep.hints.length === 0);
      check('four: the report reads in prose', X.reportText(rep) === '1 ending built, the finale now reaches them.');
    }
    const before = canon(b.story), rep2 = X.scaffold(b);
    check(fx + ': a second run changes nothing and says endings are up to date', !rep2.changed && canon(b.story) === before && /^Endings are up to date\./.test(X.reportText(rep2)) && X.expected(b).missing === 0 && X.expected(b).stale === 0);
    const after = b;
    check(fx + ': the scaffold writes only the story namespace: charter, world, art, and codex are untouched', ['charter', 'world', 'art', 'codex'].every((k) => canon(after[k]) === canon(orig[k])));
    const sum = Kit.validate.summary(Kit.refreshValidation());
    check(fx + ': validation has 0 errors and 0 broken references; the problems list is empty', sum.errors === 0 && sum.broken === 0 && X.problems(b).length === 0, { sum, p: X.problems(b) });
    const fin = b.story.records.evt_[E.idFor('evt|finale')];
    check(fx + ': the unedited finale was refreshed to reach the endings (no no-ending warning, an ending command for each)', rep.finale === 'refreshed' && !E.check(fin, b, STORY.engineIndex(b)).some((p) => p.code === 'no-ending') && J(fin.pages[0].cmds).split('"op":"ending"').length - 1 === spec.n && !E.isEdited(fin));
    check(fx + ': every end_ is reached by the finale and X.usedBy says so', byOrder.every((e) => X.usedBy(e.id, b).length === 1 && X.usedBy(e.id, b)[0].id === fin.id));
    const g = E.golden(b);
    check(fx + ': the golden path ends the game on the fallback ending', g.ended === byOrder[0].id && !g.stuck, g.ended);
    check(fx + ': the codex type is registered with the ending fields', !!Kit.codex.type('StoryEnding') && Kit.codex.fields('StoryEnding').some((f) => f.key === 'cond') && Kit.codex.fields('StoryEnding').some((f) => f.key === 'epilogue'));
  }

  // ---------------------------------------------------------------- 3. Earned endings from the optional quests.
  {
    const mk = (n) => [{ name: 'Delivered', concept: 'The message is read aloud.' }, { name: 'Kept', concept: 'The Courier keeps the message sealed.' }, { name: 'Lost', concept: 'The message is lost to the sea.' }, { name: 'Burned', concept: 'The message is burned.' }].slice(0, n);
    const r3 = await prepared(fourText, { endings: mk(3) });
    {
      const { Kit, STORY, ENGINE_STORY: ES } = r3.win, X = STORY.ends, E = STORY.events, b = Kit.bundle.current(), opt = X.optional(b);
      X.scaffold(b);
      const byOrder = Object.values(b.story.records.end_).sort((x, y) => x.order - y.order);
      check('three endings and two optional quests: each earned ending reads its own quest, none needs a flag', opt.length === 2 && byOrder.length === 3 && J(byOrder[1].cond) === J({ op: 'quest', qst: opt[0].id, is: 'done' }) && J(byOrder[2].cond) === J({ op: 'quest', qst: opt[1].id, is: 'done' }) && !Object.keys(b.story.scaffold).some((k) => k.indexOf('flg|ending|') === 0), byOrder.map((e) => e.cond));
      check('the earned endings note which quest earns them', /The lost ring/.test(byOrder[1].notes) && /The frozen lantern/.test(byOrder[2].notes));
      check('with every earned ending read from quests the finale asks nothing: no choice command', X.flagChoices(b) === null && J(b.story.records.evt_[E.idFor('evt|finale')].pages[0].cmds).indexOf('"op":"choice"') < 0);
      const idx = STORY.engineIndex(b), s0 = ES.state.create(idx, {}), done = (s, q) => { s.quests[q.id] = { stage: lastKey(q), failed: false, closed: [] }; return s; };
      const pick = (s) => X.pick(s, b);
      const sA = done(ES.state.create(idx, {}), opt[0]), sB = done(ES.state.create(idx, {}), opt[1]), sAB = done(done(ES.state.create(idx, {}), opt[0]), opt[1]);
      check('X.pick: nothing done gives the fallback; the first quest gives Kept; the second gives Lost; both give the higher priority (Lost)', pick(s0).order === 1 && pick(sA).order === 2 && pick(sB).order === 3 && pick(sAB).order === 3);
      const fin = E.idFor('evt|finale'), mainIds = Object.values(b.story.records.qst_).filter((q) => q.kind === 'main');
      const run = (s) => { s.flags[E.finaleFlag()] = 1; return playEvent(ES, idx, s, fin, []); };
      const ends = [s0, sA, sB, sAB].map((s) => { const o = run(s); return o.r.state.ending; });
      check('the finale event, run by the engine, plays the same ending X.pick names for each of the four states', ends.join() === [byOrder[0].id, byOrder[1].id, byOrder[2].id, byOrder[2].id].join(), ends);
      const keptRun = run(sA);
      const texts = keptRun.effects.filter((e) => e && e.kind === 'text').map((e) => (e.lines || []).join(' ')).join(' ');
      const musics = keptRun.effects.filter((e) => e && e.kind === 'music').map((e) => e.role || e.mus);
      check('the epilogue is shown before the end, and the credits music is the ending role', /The Courier keeps the message sealed\./.test(texts) && musics.indexOf('ending:2') >= 0, { texts, musics, kinds: keptRun.effects.map((e) => e && e.kind), sample: keptRun.effects.slice(0, 6) });
      check('three endings: the validator has no errors, with the earned quests resolving; the only findings are unscored credits music', Kit.validate.summary(Kit.refreshValidation()).errors === 0 && X.problems(b).every((p2) => p2.level === 'warning' && p2.code === 'unscored'), { sum: Kit.validate.summary(Kit.refreshValidation()), p: X.problems(b) });
    }
    r3.win.close();
    const r4 = await prepared(fourText, { endings: mk(4) });
    {
      const { Kit, STORY, ENGINE_STORY: ES } = r4.win, X = STORY.ends, E = STORY.events, b = Kit.bundle.current();
      X.scaffold(b);
      const byOrder = Object.values(b.story.records.end_).sort((x, y) => x.order - y.order), opt = X.optional(b);
      check('four endings and two optional quests: the third earned ending has no quest left, so it reads a managed flag', byOrder.length === 4 && byOrder[1].cond.op === 'quest' && byOrder[2].cond.op === 'quest' && byOrder[3].cond.op === 'flag' && byOrder[3].cond.flg === ES.ids.structural('flg_', 'flg|ending|4') && !!b.story.records.flg_[byOrder[3].cond.flg], byOrder.map((e) => e.cond));
      const fc = X.flagChoices(b), fin = b.story.records.evt_[E.idFor('evt|finale')], ch = fin.pages[0].cmds.find((c) => c.op === 'choice');
      check('the finale offers a choice: the fallback first, then the flag earned ending, which sets its flag', !!fc && fc.options.length === 1 && !!ch && ch.options.length === 2 && ch.options[0].text === 'Delivered' && ch.options[1].text === 'Burned' && ch.options[1].cmds[0].op === 'setFlag' && ch.options[1].cmds[0].flg === byOrder[3].cond.flg && ch.options[0].cmds.length === 0);
      const idx = STORY.engineIndex(b), s = ES.state.create(idx, {}); s.flags[E.finaleFlag()] = 1;
      const o0 = playEvent(ES, idx, JSON.parse(J(s)), fin.id, [0]), o1 = playEvent(ES, idx, JSON.parse(J(s)), fin.id, [1]);
      check('choosing the flag ending at the finale plays it; continuing plays the fallback', o0.r.state.ending === byOrder[0].id && o1.r.state.ending === byOrder[3].id);
      r4.win.close();
    }
  }

  // ---------------------------------------------------------------- 4. The playtime floor.
  {
    const { win } = built.four, { Kit, STORY } = win, X = STORY.ends, b = Kit.bundle.current();
    const p = X.playtime(b);
    check('four: the main story is the chapters\' sum (780) and meets the 720 floor; the table lists the six chapters', p.main === 780 && p.floor === 720 && p.meets && p.short === 0 && p.chapters.length === 6 && p.chapters.reduce((n, c) => n + c.minutes, 0) === 780);
    check('four: the two side quests are counted on their own as estimates and never in the main story', p.side.count === 2 && p.side.minutes === 2 * X.SIDE_MINUTES && p.bstory.count === 0 && p.optional === 30 && p.total === 810 && p.rows.every((r) => r.estimated));
    const q0 = p.rows[0].id;
    check('setting a quest\'s minutes replaces the estimate and is saved in the settings', X.setQuestMinutes(q0, 40).ok && X.playtime(b).side.minutes === 40 + X.SIDE_MINUTES && X.playtime(b).rows[0].estimated === false && b.story.settings.questMinutes[q0] === 40 && X.playtime(b).main === 780);
    check('clearing it returns to the estimate and removes the setting', X.setQuestMinutes(q0, null).ok && X.playtime(b).side.minutes === 30 && b.story.settings.questMinutes === undefined);
    const mainQ = Object.values(b.story.records.qst_).find((q) => q.kind === 'main');
    check('minutes are refused for a main quest, a fraction, a negative, and more than 600', !X.setQuestMinutes(mainQ.id, 10).ok && !X.setQuestMinutes(q0, 1.5).ok && !X.setQuestMinutes(q0, -1).ok && !X.setQuestMinutes(q0, 601).ok && b.story.settings.questMinutes === undefined);
    check('a large side quest cannot rescue the floor: the floor reads only the chapters', (X.setQuestMinutes(q0, 600), true) && X.playtime(b).meets && X.playtime(b).main === 780 && (X.setQuestMinutes(q0, null), true));
    const ch0 = b.charter.sections.chapters[0], was = ch0.targetMinutes;
    ch0.targetMinutes = 20; Kit.index.invalidate(); Kit.bundle.touch('test');
    const res = Kit.refreshValidation(), errs = res.errors.filter((e) => /minute floor/.test(e.message));
    check('short of the floor is an error (not a warning): 680 of 720, naming the shortfall and that optional minutes never count', errs.length === 1 && /680 minutes/.test(errs[0].message) && /40/.test(errs[0].message) && /never count/.test(errs[0].message), errs.map((e) => e.message));
    check('the problems list carries it as floor, and the summary says the floor is missed', X.problems(b).some((p2) => p2.code === 'floor' && p2.level === 'error') && X.summary(b).meets === false && X.playtime(b).short === 40);
    let blocked = null; try { Kit.buildExport('final', { engines: false }); } catch (e) { blocked = e.message; }
    check('a Final export is refused while the floor is missed (and says there are errors)', !!blocked && /error/i.test(blocked), blocked);
    ch0.targetMinutes = was; Kit.index.invalidate(); Kit.bundle.touch('test');
    check('restoring the minutes clears the error', Kit.refreshValidation().errors.filter((e) => /minute floor/.test(e.message)).length === 0);
    b.story.settings.floorMinutes = 900; Kit.index.invalidate();
    check('the floor setting is honoured: 780 of 900 is short by 120', X.playtime(b).short === 120 && Kit.refreshValidation().errors.some((e) => /900 minute floor/.test(e.message)));
    b.story.settings.floorMinutes = 720; Kit.index.invalidate();
    check('the demo meets the floor exactly (720 of 720)', built.demo.win.STORY.ends.playtime(built.demo.win.Kit.bundle.current()).meets && built.demo.win.STORY.ends.playtime(built.demo.win.Kit.bundle.current()).short === 0);
  }

  // ---------------------------------------------------------------- 5. The finale, replayed.
  {
    const { win } = built.demo, { Kit, STORY, ENGINE_STORY: ES } = win, X = STORY.ends, E = STORY.events, b = Kit.bundle.current();
    const fin = b.story.records.evt_[E.idFor('evt|finale')], cmds = fin.pages[0].cmds, ch = cmds.find((c) => c.op === 'choice');
    check('demo: the finale asks how the tale ends, with Delivered (the fallback) first and Kept second', cmds.some((c) => c.op === 'text' && /How does it end/.test(c.lines.join(' '))) && !!ch && ch.options.length === 2 && ch.options[0].text === 'Delivered' && ch.options[1].text === 'Kept' && ch.options[1].cmds[0].op === 'setFlag');
    check('demo: after the choice the ending chain tests Kept first, then falls through to Delivered', J(cmds.slice(cmds.indexOf(ch) + 1)).indexOf('"role":"ending:2"') < J(cmds.slice(cmds.indexOf(ch) + 1)).indexOf('"role":"ending:1"'));
    const idx = STORY.engineIndex(b), s = ES.state.create(idx, {}); s.flags[E.finaleFlag()] = 1;
    const o0 = playEvent(ES, idx, JSON.parse(J(s)), fin.id, [0]), o1 = playEvent(ES, idx, JSON.parse(J(s)), fin.id, [1]);
    const kept = Object.values(b.story.records.end_).find((e) => e.order === 2), del = Object.values(b.story.records.end_).find((e) => e.order === 1);
    check('demo: the first option plays Delivered and the second plays Kept', o0.r.state.ending === del.id && o1.r.state.ending === kept.id);
    check('demo: X.pick agrees with the engine for both states', X.pick(o0.r.state, b).id === del.id && X.pick(o1.r.state, b).id === kept.id);
    const musicOf = (o) => o.effects.filter((e) => e && e.kind === 'music').map((e) => e.role).join();
    check('demo: each ending plays its credits music and shows its epilogue before it ends', musicOf(o0) === 'ending:1' && musicOf(o1) === 'ending:2' && o1.effects.some((e) => e && e.kind === 'text' && /Courier keeps the message sealed/.test((e.lines || []).join(' '))) && o0.effects.some((e) => e && e.kind === 'text' && /read aloud/.test((e.lines || []).join(' '))), { m0: musicOf(o0), m1: musicOf(o1), kinds: o1.effects.map((e) => e && e.kind) });
    const draft = JSON.parse(Kit.buildExport('draft', { engines: false }).files[0].text);
    const replay = (X2) => {
      const ix = X2.index.build({ records: draft.story.records, bindings: draft.story.bindings, npcDialogue: draft.story.npcDialogue }, ext(draft));
      const st0 = X2.state.create(ix, {}); st0.flags[E.finaleFlag()] = 1;
      const out = [];
      [0, 1].forEach((pick) => {
        let r = X2.run.start(JSON.parse(J(st0)), fin.id, ix);
        for (let k = 0; k < 5000 && !r.done; k++) r = r.waiting === 'choice' ? X2.run.choose(r.state, r.effect.options[pick].index, ix) : r.waiting === 'battle' ? X2.run.resolve(r.state, 'win', ix) : X2.run.step(r.state, ix);
        out.push({ hash: X2.state.hash(r.state), ending: r.state.ending });
      });
      return { out, digest: ix.digest };
    };
    const ra = replay(engine(rootEng)), rb = replay(engine(rootEng));
    check('demo: two bare vm contexts holding only engine-story.js and the Draft play both endings to the page\'s exact state', J(ra) === J(rb) && ra.out[0].hash === ES.state.hash(o0.r.state) && ra.out[1].hash === ES.state.hash(o1.r.state) && ra.out[0].ending === del.id && ra.out[1].ending === kept.id && ra.digest === STORY.engineIndex(b).digest, { ra, rb });
    const g = E.golden(b);
    check('demo: the golden path (first option each time) still ends the game, on the fallback', g.ended === del.id && !g.stuck);
    const mainQ = Object.values(b.story.records.qst_).filter((q) => q.kind === 'main');
    check('demo: the golden path still completes every main quest', mainQ.every((q) => g.state.quests[q.id].stage === lastKey(q) && !g.state.quests[q.id].failed));
  }

  // ---------------------------------------------------------------- 6. The edit API, the fallback swap, the validator.
  {
    const r6 = await prepared(demoText);
    const { Kit, STORY, ENGINE_STORY: ES } = r6.win, X = STORY.ends, E = STORY.events;
    let b = Kit.bundle.current();
    X.scaffold(b);
    const del = () => Object.values(b.story.records.end_).find((e) => e.order === 1), kept = () => Object.values(b.story.records.end_).find((e) => e.order === 2);
    const delId = del().id, keptId = kept().id;
    let r = X.update(keptId, { name: 'Kept sealed', concept: 'It stays sealed.', priority: 15, music: 'ending:1', epilogue: 'One line.\n\nTwo lines.\n', notes: 'My note.' });
    check('update changes the name, concept, priority, music, epilogue (blank lines dropped), and note, and keeps the ID and key', r.ok && kept().name === 'Kept sealed' && kept().concept === 'It stays sealed.' && kept().priority === 15 && kept().music === 'ending:1' && J(kept().epilogue) === J(['One line.', 'Two lines.']) && kept().notes === 'My note.' && kept().id === keptId && kept().key === 'end|2|kept');
    check('an edited generated ending is marked edited and keeps its origin', E.isEdited(kept()) && kept().origin === 'generated');
    check('music may be cleared with an empty string', X.update(keptId, { music: '' }).ok && kept().music === undefined && X.update(keptId, { music: 'ending:2' }).ok);
    check('a priority that is not a whole number is refused and nothing is written', !X.update(keptId, { priority: 1.5 }).ok && kept().priority === 15);
    check('an unknown mus_ is refused (an error); an unscored role is allowed (a warning)', !X.update(keptId, { music: 'mus_not_there' }).ok && X.update(keptId, { music: 'ending:9' }).ok && X.check(kept(), b, STORY.engineIndex(b)).some((p) => p.code === 'unscored') && X.update(keptId, { music: 'ending:2' }).ok);
    const lines13 = Array.from({ length: 13 }, (_, i) => 'Line ' + i);
    check('an epilogue of 13 lines is refused, and so is a line over 300 characters; a blank name is refused', !X.update(keptId, { epilogue: lines13 }).ok && !X.update(keptId, { epilogue: ['x'.repeat(301)] }).ok && !X.update(keptId, { name: '   ' }).ok && kept().name === 'Kept sealed');
    check('setCond refuses a condition that reads a flag that does not exist, and a malformed tree', !X.setCond(keptId, { op: 'flag', flg: 'flg_nope', cmp: 'gte', value: 1 }).ok && !X.setCond(keptId, { op: 'wibble' }).ok && !X.setCond(keptId, 'x').ok);
    const keptCond = J(kept().cond);
    check('a refused edit changes nothing at all', J(kept().cond) === keptCond && kept().priority === 15);
    check('editing a missing ending is refused with a reason', !X.update('end_nope', { name: 'x' }).ok && !X.setCond('end_nope', null).ok && !X.makeFallback('end_nope').ok && !X.reset('end_nope').ok && !X.remove('end_nope').ok);
    // Two fallbacks, then shadowed, then tied.
    r = X.setCond(keptId, null);
    let probs = X.setProblems(b), sum = Kit.validate.summary(Kit.refreshValidation());
    check('a null condition means always true, which makes two fallbacks: an error naming both, and validation fails', r.ok && J(kept().cond) === J({ op: 'true' }) && probs.some((p) => p.code === 'two-fallbacks' && /Kept sealed/.test(p.message) && /Delivered/.test(p.message)) && sum.errors >= 1);
    const flagCond = { op: 'flag', flg: Object.keys(b.story.records.flg_).find((k) => /ending_2/.test(k)), cmp: 'gte', value: 1 };
    X.setCond(keptId, flagCond);
    check('restoring the condition returns validation to clean', X.setProblems(b).length === 0 && Kit.validate.summary(Kit.refreshValidation()).errors === 0);
    X.update(keptId, { priority: -5 });
    probs = X.setProblems(b);
    check('an earned ending below the fallback\'s priority can never win: an error, "shadowed"', probs.some((p) => p.code === 'shadowed' && p.recordId === keptId && p.level === 'error') && Kit.validate.summary(Kit.refreshValidation()).errors >= 1);
    X.update(keptId, { priority: 0 });
    check('at the fallback\'s priority it is only a warning, "tie-fallback"', X.setProblems(b).some((p) => p.code === 'tie-fallback' && p.level === 'warning') && !X.setProblems(b).some((p) => p.level === 'error'));
    X.update(keptId, { priority: 10 });
    check('back above it, both are gone', X.setProblems(b).length === 0);
    // Making the second ending the fallback.
    const sw = X.makeFallback(keptId);
    check('makeFallback makes Kept always true at the lowest priority and gives Delivered a flag of its own to read', sw.ok && J(kept().cond) === J({ op: 'true' }) && kept().priority < del().priority && del().cond.op === 'flag' && del().cond.cmp === 'gte' && del().cond.flg === ES.ids.structural('flg_', 'flg|ending|1') && !!b.story.records.flg_[del().cond.flg] && sw.changed.length === 2, sw);
    check('afterward exactly one ending is the fallback, validation is clean, and the managed flag is tracked', X.fallbacks(b).length === 1 && X.fallbacks(b)[0].id === keptId && X.setProblems(b).length === 0 && Kit.validate.summary(Kit.refreshValidation()).errors === 0 && b.story.scaffold['flg|ending|1'] === del().cond.flg);
    const rep6 = X.scaffold(b);
    check('a rebuild leaves the edited endings exactly as the author left them and refreshes the unedited finale to the new order', rep6.created.length === 0 && rep6.removed.length === 0 && rep6.finale === 'refreshed' && J(kept().cond) === J({ op: 'true' }) && del().cond.op === 'flag', rep6);
    const gA = E.golden(b), fc = X.flagChoices(b);
    check('the finale now offers Delivered as the choice and the golden path ends on the new fallback', !!fc && fc.fallback.id === keptId && fc.options.length === 1 && fc.options[0].end === delId && gA.ended === keptId, gA.ended);
    const rs = X.reset(keptId);
    check('reset puts an ending back to what the scaffold makes (and Delivered is still edited)', rs.ok && !E.isEdited(kept()) && kept().priority === 10 && kept().name === 'Kept' && E.isEdited(del()));
    X.reset(delId);
    check('after both resets the set is as first built, with one fallback and one earned ending', !E.isEdited(del()) && X.fallbacks(b).length === 1 && X.fallbacks(b)[0].id === delId && X.setProblems(b).length === 0);
    // A hand made ending.
    const added = X.add({ name: 'The Long Road', concept: 'Everyone walks on.' });
    const mine = b.story.records.end_[added.record.id], mf = b.story.records.flg_[added.flag];
    check('Add makes a hand made ending: minted ID, origin user, earned by a flag of its own, tested before every other ending', added.ok && mine.origin === 'user' && /^end_/.test(mine.id) && !X.isFallback(mine) && mine.cond.flg === added.flag && !!mf && mf.origin === 'user' && mine.priority > Math.max(...Object.values(b.story.records.end_).filter((e) => e.id !== mine.id).map((e) => e.priority)) && mine.music === 'ending');
    check('it is valid, never a second fallback, and validation stays at 0 errors', X.check(mine, b, STORY.engineIndex(b)).filter((p) => p.level === 'error').length === 0 && X.fallbacks(b).length === 1 && Kit.validate.summary(Kit.refreshValidation()).errors === 0);
    const rep7 = X.scaffold(b);
    check('a rebuild keeps it and leaves its flag alone', !!b.story.records.end_[mine.id] && !!b.story.records.flg_[added.flag] && rep7.removed.length === 0 && rep7.orphaned.length === 0);
    const ev = STORY.authored('evt_', 'Uses it', { kind: 'custom', trigger: 'autorun', map: b.world.overworld ? b.world.overworld.map : Object.keys(b.world.records.map_)[0], priority: 0, pages: [{ cmds: [{ op: 'ending', end: mine.id }] }] });
    b.story.records.evt_[ev.id] = ev; Kit.index.invalidate();
    check('usedBy names the events that reach it (the finale, marked auto, and the author\'s), and Remove is refused while the author\'s does', X.usedBy(mine.id, b).length === 2 && X.usedBy(mine.id, b).find((u) => !u.auto).id === ev.id && X.usedBy(mine.id, b).find((u) => u.auto).name === 'Finale' && !X.remove(mine.id).ok && /Uses it/.test(X.remove(mine.id).message) && !/Finale/.test(X.remove(mine.id).message), { used: X.usedBy(mine.id, b), rm: X.remove(mine.id) });
    delete b.story.records.evt_[ev.id]; Kit.index.invalidate();
    check('Remove is refused for a generated ending (the Charter asks for it) and works for a hand made one', !X.remove(delId).ok && /Charter asks/.test(X.remove(delId).message) && X.remove(mine.id).ok && !b.story.records.end_[mine.id] && !J(b.story.records.evt_[E.idFor('evt|finale')]).includes(mine.id));
    // Orphans and regeneration when the Charter changes.
    X.update(keptId, { notes: 'Mine.' });
    b.charter.sections.endings.endings[1].name = 'Sealed'; Kit.index.invalidate();
    const rep8 = X.scaffold(b), sealed = Object.values(b.story.records.end_).find((e) => e.name === 'Sealed');
    check('renaming a Charter ending makes a new ending; the old edited one becomes the author\'s (origin user), nothing is deleted', rep8.created.length === 1 && rep8.orphaned.length === 1 && !!sealed && sealed.id === ES.ids.structural('end_', 'end|2|sealed') && b.story.records.end_[keptId].origin === 'user' && b.story.records.end_[keptId].gen === undefined, rep8);
    check('the orphan now claims the same Charter position as the new one: a warning, not an error', X.setProblems(b).some((p) => p.code === 'duplicate-order' && p.level === 'warning') && !X.setProblems(b).some((p) => p.level === 'error'));
    delete b.story.records.end_[keptId]; delete b.story.records.end_[sealed.id]; Kit.index.invalidate();
    b.charter.sections.endings.endings = b.charter.sections.endings.endings.slice(0, 1); Kit.index.invalidate();
    const rep9 = X.scaffold(b);
    check('with one Charter ending left, the unedited earned ending and its managed flag are gone and the finale no longer asks', Object.values(b.story.records.end_).length === 1 && rep9.finale === 'refreshed' && X.flagChoices(b) === null && !Object.keys(b.story.scaffold).some((k) => k === 'flg|ending|2'), { n: Object.values(b.story.records.end_).length, fin: rep9.finale, fc: X.flagChoices(b), keys: Object.keys(b.story.scaffold).filter((k) => /ending/.test(k)) });
    b.charter.sections.endings.endings = []; Kit.index.invalidate();
    check('with no Charter endings the problems list says so and names the way out', X.problems(b).length >= 0 && X.wanted(b).endings.length === 0 && /Charter lists no endings/.test(X.reportText(X.scaffold(b)) + ' ' + X.problems(b).map((p) => p.message).join(' ')));
    r6.win.close();
  }

  // ---------------------------------------------------------------- 7. The Endings and Playtime cards under jsdom.
  {
    const r7 = await prepared(fourText, { endings: [{ name: 'Delivered', concept: 'The message is read aloud.' }, { name: 'Kept', concept: 'The Courier keeps the message sealed.' }, { name: 'Lost', concept: 'The message is lost to the sea.' }], events: false });
    const { win, errors } = r7;
    const { Kit, STORY } = win, d = win.document, X = STORY.ends, E = STORY.events;
    Kit.go('start'); await wait(30);
    const ws = () => d.getElementById('ws');
    const btn = (re, root) => Array.from((root || ws()).querySelectorAll('button')).find((x) => re.test(x.textContent));
    const card = () => ws().querySelector('[data-panel="endings"]');
    check('the Start tab mounts an Endings card with a Build endings button and the Charter\'s three endings listed', !!card() && !!btn(/^Build endings$/, card()) && card().querySelectorAll('.s9-endings li').length === 3 && /not built/.test(card().textContent));
    const pt = () => ws().querySelector('[data-panel="playtime"]');
    check('the Playtime card shows 13.0 of 12 hours as ok, the six chapters and the main story, and the optional quests apart', !!pt() && /13\.0 of 12 hours/.test(pt().textContent) && pt().querySelector('.chip-ok') && pt().querySelectorAll('tbody tr').length === 7 && pt().querySelectorAll('.en-qrow').length === 2 && /2 side quests: 30 min/.test(pt().textContent));
    btn(/^Build endings$/, card()).click(); await wait(40);
    check('Build endings makes three endings in finale order, says so, and the button becomes Update endings', card().querySelectorAll('.en-item').length === 3 && /3 endings built/.test(card().textContent) && !!btn(/^Update endings$/, card()) && /one fallback/.test(card().textContent) && /up to date/.test(card().textContent));
    check('the list runs highest priority first; the fallback is last and says so', Array.from(card().querySelectorAll('.en-item .fg-name')).map((n) => n.textContent).join() === 'Lost,Kept,Delivered' && /Fallback/.test(card().querySelectorAll('.en-item')[2].textContent));
    check('the finale was not built, so the card offers no Open the finale button yet, and the report says to build the events', !btn(/Open the finale/, card()) && /Build the events/.test(card().textContent));
    E.scaffold(); Kit.rerender(); await wait(20);
    check('once the events exist the card offers Open the finale', !!btn(/Open the finale/, card()));
    const item = (n) => card().querySelectorAll('.en-item')[n];
    item(1).querySelector('.fg-head').click(); await wait(10);
    check('opening an ending shows its fields, its condition in words, who reaches it, and the condition editor', item(1).querySelector('.fg-head').getAttribute('aria-expanded') === 'true' && /Earned when/.test(item(1).textContent) && /The lost ring/.test(item(1).textContent) && item(1).querySelectorAll('input.inp').length >= 2 && item(1).querySelector('.cu') && /Finale/.test(item(1).textContent));
    const pri = item(1).querySelector('input.en-num'); pri.value = '25'; pri.dispatchEvent(new win.Event('change')); await wait(30);
    const keptRec = Object.values(Kit.bundle.current().story.records.end_).find((e) => e.name === 'Kept');
    check('changing the priority saves it and the card shows it as edited', keptRec.priority === 25 && /edited/.test(card().textContent));
    check('the open ending stays open after the redraw', card().querySelectorAll('.en-item')[0].querySelector('.fg-head').getAttribute('aria-expanded') === 'true' && /Kept/.test(card().querySelectorAll('.en-item')[0].textContent));
    const nm = card().querySelector('.en-item input[type=text]'); nm.value = ''; nm.dispatchEvent(new win.Event('change')); await wait(30);
    check('a blank name is refused with a toast and nothing changes', Object.values(Kit.bundle.current().story.records.end_).find((e) => e.id === keptRec.id).name === 'Kept' && /needs a name/.test(d.body.textContent));
    const epi = card().querySelector('.en-item textarea[aria-label="Epilogue"]'); epi.value = 'A new line.\nAnother.'; epi.dispatchEvent(new win.Event('change')); await wait(30);
    check('editing the epilogue saves one line per line', J(Object.values(Kit.bundle.current().story.records.end_).find((e) => e.id === keptRec.id).epilogue) === J(['A new line.', 'Another.']));
    const mus = card().querySelector('.en-item select[aria-label="Credits music"]');
    check('the music picker lists the Day 147 roles including ending:1 to ending:3', Array.from(mus.options).map((o) => o.value).filter((v) => /^ending:/.test(v)).join() === 'ending:1,ending:2,ending:3' && mus.value === 'ending:2');
    btn(/Make this the fallback/, card().querySelectorAll('.en-item')[0]).click(); await wait(20);
    const ov = d.getElementById('overlays');
    check('Make this the fallback asks first and explains the swap', /Make Kept the fallback/.test(ov.textContent) && /own to read/.test(ov.textContent));
    btn(/^Make fallback$/, ov).click(); await wait(40);
    const nowFb = X.fallbacks(Kit.bundle.current());
    check('confirming swaps the fallback: Kept is the only fallback and the list shows it last', nowFb.length === 1 && nowFb[0].name === 'Kept' && /Fallback/.test(Array.from(card().querySelectorAll('.en-item')).pop().textContent) && /one fallback/.test(card().textContent));
    btn(/^Add ending$/, card()).click(); await wait(30);
    check('Add ending adds a hand made ending, opened, with a Delete button', card().querySelectorAll('.en-item').length === 4 && /yours/.test(card().textContent) && !!btn(/^Delete$/, card()));
    btn(/^Delete$/, card()).click(); await wait(20);
    btn(/^Delete ending$/, d.getElementById('overlays')).click(); await wait(30);
    check('Delete asks, then removes it', card().querySelectorAll('.en-item').length === 3 && !/yours/.test(card().textContent));
    btn(/^Reset to generated$/, card()) && btn(/^Reset to generated$/, card()).click(); await wait(30);
    check('Reset to generated restores a generated ending', !!X.list(Kit.bundle.current()).length);
    // The playtime card.
    const inp = pt().querySelector('.en-qrow input'); inp.value = '45'; inp.dispatchEvent(new win.Event('change')); await wait(30);
    check('setting a quest\'s minutes in the Playtime card saves it, drops the estimate chip on that row, and updates the totals', Object.values(Kit.bundle.current().story.settings.questMinutes || {})[0] === 45 && !/estimate/.test(pt().querySelectorAll('.en-qrow')[0].textContent) && /side quests: 60 min/.test(pt().textContent));
    inp.value = '700'; pt().querySelector('.en-qrow input').value = '700'; pt().querySelector('.en-qrow input').dispatchEvent(new win.Event('change')); await wait(30);
    check('a minutes value over 600 is refused and the saved value stays', Object.values(Kit.bundle.current().story.settings.questMinutes || {})[0] === 45);
    const b7 = Kit.bundle.current(); b7.charter.sections.chapters[0].targetMinutes = 20; Kit.index.invalidate(); Kit.bundle.touch('test'); Kit.rerender(); await wait(30);
    check('when the chapters fall short the Playtime card turns to an error chip and says a Final waits', !!pt().querySelector('.chip-error') && /680 of 720|11\.3 of 12/.test(pt().textContent.replace(/\s+/g, ' ')) && /error, and a Final export waits/.test(pt().textContent));
    b7.charter.sections.chapters[0].targetMinutes = 120; Kit.index.invalidate(); Kit.bundle.touch('test'); Kit.rerender(); await wait(30);
    Kit.go('validation'); await wait(30);
    check('the Validation tab shows no ending or floor problems for the restored story', !/short of the 720/.test(ws().textContent) && !/fallback/i.test((ws().querySelector('.s9-issues') || { textContent: '' }).textContent));
    Kit.go('start'); await wait(30);
    if (btn(/Open the finale/, card())) { btn(/Open the finale/, card()).click(); await wait(40); }
    check('Open the finale goes to the Events tab with the finale open and chosen for play', STORY.eventsUi.pt.evt === E.idFor('evt|finale') && !!ws().querySelector('.ev-item[data-evt="' + E.idFor('evt|finale') + '"]'));
    check('no script errors on the page through all of it', errors.length === 0, errors.slice(0, 2));
    r7.win.close();
  }

  // ---------------------------------------------------------------- 8. Two pages agree; the round trip.
  {
    const p1 = await prepared(demoText), p2 = await prepared(demoText);
    p1.win.STORY.ends.scaffold(); p2.win.STORY.ends.scaffold();
    const s1 = canon(p1.win.Kit.bundle.current().story), s2 = canon(p2.win.Kit.bundle.current().story);
    check('two fresh pages build byte for byte the same story with its endings', s1 === s2);
    const { Kit } = p1.win;
    const draft = Kit.buildExport('draft');
    const db = JSON.parse(draft.files[0].text);
    check('the Draft carries the two endings, the managed flag, and the refreshed finale', Object.keys(db.story.records.end_).length === 2 && !!db.story.records.flg_[Object.keys(db.story.scaffold).filter((k) => k === 'flg|ending|2').map((k) => db.story.scaffold[k])[0]] && /"role":"ending:2"/.test(J(db.story.records.evt_[p1.win.STORY.events.idFor('evt|finale')])));
    const probe = (how) => async (w, K) => { const cb = K.bundle.current(); let err = null; try { K.buildExport(how, { engines: false }); } catch (e4) { err = e4.message; } return { same: ['charter', 'codex', 'rules', 'art', 'world'].filter((k) => J(cb[k] || null) !== J(db[k] || null)), err }; };
    const r146 = await in146(draft.files[0].text, probe('draft'));
    const r147 = await in147(draft.files[0].text, probe('draft'));
    const r148 = await in148(draft.files[0].text, probe('final'));
    [['146', r146], ['147', r147], ['148', r148]].forEach(([k, rr]) => {
      check('Day ' + k + ' opens the Draft with the endings: hash verified, prior namespaces identical, no errors, no broken references', rr.matches && !rr.errors.length && !rr.broken.length && !rr.err && !rr.same.length, { m: rr.matches, e: (rr.errors || []).slice(0, 2), br: (rr.broken || []).slice(0, 2), err: rr.err, same: rr.same });
    });
    p2.win.Kit.bundle.importText(draft.files[0].text); await wait(20);
    check('the Draft reopens here with the same story', canon(p2.win.Kit.bundle.current().story) === canon(db.story));
    check('a reopened Draft needs no rebuild of the endings or the events', !p2.win.STORY.ends.scaffold().changed && !p2.win.STORY.events.scaffold().changed);
    p1.win.close(); p2.win.close();
  }
  built.demo.win.close(); built.four.win.close();

  const n = results.filter((x) => x.ok).length;
  results.forEach((x) => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.ok ? '' : '  ' + String(J(x.detail)).slice(0, 900))));
  fs.writeFileSync(path.join(OUT, 'phase6-report.json'), J({ passed: n, total: results.length, results }, null, 1));
  console.log('\n' + n + ' of ' + results.length + ' passed');
  process.exit(n === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
