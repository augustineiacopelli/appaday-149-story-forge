  // ---------------------------------------------------------------- the runner (Phase 1)
  // Runs an event one effect at a time. The engine never draws, plays, or waits: each call returns
  //   {state, effect, waiting, done}
  // and the host performs the effect (shows the text, fades, plays the music), then calls step again. waiting is null,
  // 'choice' (call choose), or 'battle' (call resolve); done is true once the run is over. Every effect's kind is its
  // command's op (text, choice, startBattle, giveItem, and so on, with the command's fields copied in), or one of:
  //   end       the event finished; quests lists any quest stages that advanced or failed as it settled
  //   none      start found no page whose condition passes; nothing ran
  //   idle      step was called with nothing running
  //   gameover  a battle was lost with no lose list
  //   error     {code, message}; nothing was written, and the run carries on from the next command
  // Silent commands (if, setFlag, addFlag, callEvent) change the state without an effect of their own.
  // The run lives in state.run as plain data: {evt, page, stack [{evt, page, path, i}], wait}. path is the list of keys
  // from a page's cmds down to the list the frame is walking (for example [2, 'then'] or [0, 'options', 1, 'cmds']), so
  // a state in the middle of a cutscene can be saved, copied, hashed, and resumed exactly.
  var MAX_STACK = 32, MAX_SILENT = 100000;
  function nodeAt(idx, evt, page, path) {
    var e = idx && idx.events[evt], node = e && isObj(e.pages[page]) ? e.pages[page].cmds : null;
    for (var i = 0; node != null && i < path.length; i++) node = node[path[i]];
    return node == null ? null : node;
  }
  // Every returned state is a canonical copy (sorted keys), so equal states are equal byte for byte.
  function result(st, effect) {
    st = copy(st);
    var w = st.run && st.run.wait ? st.run.wait.kind : null;
    return { state: st, effect: effect, waiting: w, done: !st.run };
  }
  function fault(st, code, message, extra) {
    var e = { kind: 'error', code: code, message: message };
    each(extra, function (v, k) { e[k] = copy(v); });
    return result(st, e);
  }
  function effectOf(c) {
    var e = {};
    each(c, function (v, k) { if (k !== 'op') e[k] = copy(v); });
    e.kind = c.op;
    return e;
  }
  function applySets(st, idx, sets) { for (var i = 0; i < sets.length; i++) writeFlag(st, idx, sets[i].flg, sets[i].value); }
  function questState(st, qst) {
    var q = st.quests[qst];
    if (!isObj(q)) q = st.quests[qst] = { stage: null, failed: false, closed: [] };
    if (!Array.isArray(q.closed)) q.closed = [];
    return q;
  }
  function lastStage(def) { return def.stages.length - 1; }
  function enterStage(st, idx, def, qs, to) {
    var from = qs.stage == null ? -1 : def.stageAt[qs.stage];
    for (var s = from + 1; s <= to; s++) applySets(st, idx, def.stages[s].sets);
    qs.stage = def.stages[to].key;
    if (to === lastStage(def) && def.completeFlag) writeFlag(st, idx, def.completeFlag, 1);
  }
  // questStage: every check happens before anything is written, so a refusal leaves the state exactly as it was.
  function questCmd(st, idx, c) {
    var def = idx.quests[c.qst];
    if (!def) return { error: ['ref', 'Quest ' + c.qst + ' is not in this story.'] };
    var qs = st.quests[c.qst] || { stage: null, failed: false, closed: [] }, cur = qs.stage == null ? -1 : def.stageAt[qs.stage];
    var done = !qs.failed && def.stages.length > 0 && cur === lastStage(def);
    if (c.fail === true) {
      if (done) return { error: ['done', 'Quest ' + c.qst + ' is already complete, so it cannot fail.'] };
      if (qs.failed) return { effect: { kind: 'questStage', qst: c.qst, fail: true, changed: false } };
      qs = questState(st, c.qst);
      qs.failed = true;
      if (def.fail) applySets(st, idx, def.fail.sets);
      return { effect: { kind: 'questStage', qst: c.qst, fail: true, changed: true } };
    }
    if (c.branch !== undefined) {
      var g = def.branches[c.branch], o = g && g.outcomes[c.outcome];
      if (!o) return { error: ['ref', 'Outcome ' + c.outcome + ' of branch group ' + c.branch + ' is not in ' + c.qst + '.'] };
      if (qs.failed) return { error: ['failed', 'Quest ' + c.qst + ' has failed, so its branches are closed.'] };
      if (qs.closed && qs.closed.indexOf(c.branch) >= 0) return { error: ['closed', 'Branch group ' + c.branch + ' of ' + c.qst + ' was already decided; its other outcomes are closed.'] };
      qs = questState(st, c.qst);
      qs.closed.push(c.branch);
      qs.closed.sort();
      applySets(st, idx, o.sets);
      return { effect: { kind: 'questStage', qst: c.qst, branch: c.branch, outcome: c.outcome, label: o.label, changed: true } };
    }
    var to = def.stageAt[c.stage];
    if (to === undefined) return { error: ['ref', 'Stage ' + c.stage + ' is not a stage of ' + c.qst + '.'] };
    if (qs.failed) return { error: ['failed', 'Quest ' + c.qst + ' has failed; its stages no longer change.'] };
    if (to < cur) return { error: ['backward', 'Quest ' + c.qst + ' is past stage ' + c.stage + '; stages only move forward.'] };
    if (to === cur) return { effect: { kind: 'questStage', qst: c.qst, stage: c.stage, label: def.stages[to].label, done: to === lastStage(def), changed: false } };
    enterStage(st, idx, def, questState(st, c.qst), to);
    return { effect: { kind: 'questStage', qst: c.qst, stage: c.stage, label: def.stages[to].label, done: to === lastStage(def), changed: true } };
  }
  // Quests settle when an event ends: a failing condition fails a quest that is not complete, and a stage whose exitWhen
  // passes moves on to the next stage, repeatedly, in sorted quest order. Returns the list of changes.
  function settle(st, idx) {
    var changes = [], guard = 0, moved = true;
    while (moved && guard++ < 10000) {
      moved = false;
      each(idx.quests, function (def, qst) {
        var qs = st.quests[qst];
        if (!isObj(qs) || qs.stage == null || qs.failed || !def.stages.length) return;
        var cur = def.stageAt[qs.stage];
        if (cur === undefined) return;
        if (cur < lastStage(def) && def.fail && def.fail.cond != null && evalCond(def.fail.cond, st, idx)) {
          qs.failed = true; applySets(st, idx, def.fail.sets); st.chapter = chapterOf(st, idx);
          changes.push({ qst: qst, failed: true }); moved = true;
        } else if (cur < lastStage(def) && def.stages[cur].exitWhen != null && evalCond(def.stages[cur].exitWhen, st, idx)) {
          enterStage(st, idx, def, qs, cur + 1); st.chapter = chapterOf(st, idx);
          changes.push({ qst: qst, from: def.stages[cur].key, to: qs.stage }); moved = true;
        }
      });
    }
    return changes;
  }
  function onStack(run, evt) { for (var i = 0; i < run.stack.length; i++) if (run.stack[i].evt === evt) return true; return false; }
  function advance(st, idx) {
    for (var guard = 0; guard < MAX_SILENT; guard++) {
      var run = st.run;
      if (!run) return result(st, { kind: 'idle' });
      var top = run.stack[run.stack.length - 1];
      if (!top) {
        var evt = run.evt;
        st.run = null;
        return result(st, { kind: 'end', evt: evt, quests: settle(st, idx) });
      }
      var list = nodeAt(idx, top.evt, top.page, top.path);
      if (!Array.isArray(list) || top.i >= list.length) { run.stack.pop(); continue; }
      var c = list[top.i], here = top.path.concat([top.i]);
      top.i++;
      if (!isObj(c)) continue;
      switch (c.op) {
        case 'if': {
          var br = evalCond(c.cond, st, idx) ? 'then' : 'else';
          if (Array.isArray(c[br]) && c[br].length) {
            if (run.stack.length >= MAX_STACK) return fault(st, 'too-deep', 'Commands nest more than ' + MAX_STACK + ' frames.');
            run.stack.push({ evt: top.evt, page: top.page, path: here.concat([br]), i: 0 });
          }
          continue;
        }
        case 'setFlag':
          if (typeof c.flg !== 'string') return fault(st, 'ref', 'setFlag needs flg.');
          writeFlag(st, idx, c.flg, intOr(c.value, 1)); st.chapter = chapterOf(st, idx);
          continue;
        case 'addFlag':
          if (typeof c.flg !== 'string') return fault(st, 'ref', 'addFlag needs flg.');
          writeFlag(st, idx, c.flg, readFlag(st, idx, c.flg) + intOr(c.by, 1)); st.chapter = chapterOf(st, idx);
          continue;
        case 'callEvent': {
          if (!idx.events[c.evt]) return fault(st, 'ref', 'Event ' + c.evt + ' is not in this story.');
          if (onStack(run, c.evt)) return fault(st, 'recursion', 'Event ' + c.evt + ' is already running; an event cannot call itself, even through another.');
          if (run.stack.length >= MAX_STACK) return fault(st, 'too-deep', 'Calls nest more than ' + MAX_STACK + ' frames.');
          var pg = pickPage(c.evt, st, idx);
          if (pg < 0) continue;
          if (idx.events[c.evt].pages[pg].once) st.seen[seenKey(c.evt, pg)] = 1;
          run.stack.push({ evt: c.evt, page: pg, path: [], i: 0 });
          continue;
        }
        case 'text':
          return result(st, { kind: 'text', speaker: c.speaker == null ? null : copy(c.speaker), por: c.por == null ? null : c.por, lines: Array.isArray(c.lines) ? copy(c.lines) : [] });
        case 'choice': {
          var vis = [], opts = [];
          if (Array.isArray(c.options)) for (var o = 0; o < c.options.length; o++) if (isObj(c.options[o]) && evalCond(c.options[o].cond, st, idx)) { vis.push(o); opts.push({ index: o, text: String(c.options[o].text || '') }); }
          if (!vis.length) continue;
          run.wait = { kind: 'choice', evt: top.evt, page: top.page, path: here, options: vis };
          return result(st, { kind: 'choice', prompt: c.prompt == null ? null : String(c.prompt), options: opts, cancel: vis.indexOf(c.cancel) >= 0 ? c.cancel : null });
        }
        case 'startBattle':
          run.wait = { kind: 'battle', evt: top.evt, page: top.page, path: here, trp: c.trp };
          return result(st, { kind: 'startBattle', trp: c.trp, canLose: Array.isArray(c.lose), canEscape: Array.isArray(c.escape) });
        case 'giveItem': case 'takeItem': {
          if (typeof c.itm !== 'string') return fault(st, 'ref', c.op + ' needs itm.');
          var held = intOr(st.items[c.itm], 0), q = Math.max(1, intOr(c.qty, 1));
          var next = c.op === 'giveItem' ? Math.min(999, held + q) : Math.max(0, held - q);
          if (next) st.items[c.itm] = next; else delete st.items[c.itm];
          return result(st, { kind: c.op, itm: c.itm, qty: next - held, held: next });
        }
        case 'gil': {
          var g0 = st.gil;
          st.gil = Math.max(0, intOr(st.gil, 0) + intOr(c.by, 0));
          return result(st, { kind: 'gil', by: st.gil - g0, gil: st.gil });
        }
        case 'questStage': {
          var r = questCmd(st, idx, c);
          if (r.error) return fault(st, r.error[0], r.error[1], { qst: c.qst });
          st.chapter = chapterOf(st, idx);
          return result(st, r.effect);
        }
        case 'party': {
          var at = st.party.indexOf(c.chr);
          if (c.act === 'join' && at < 0 && typeof c.chr === 'string') st.party.push(c.chr);
          if (c.act === 'leave' && at >= 0) st.party.splice(at, 1);
          return result(st, { kind: 'party', chr: c.chr, act: c.act, party: copy(st.party) });
        }
        case 'ending':
          st.ending = typeof c.end === 'string' ? c.end : null;
          st.run = null;
          return result(st, { kind: 'ending', end: st.ending });
        case 'moveActor': case 'face': case 'wait': case 'fade': case 'music': case 'sfx': case 'changeMap': case 'vehicle':
          return result(st, effectOf(c));
        default:
          return fault(st, 'op', 'Unknown command op ' + JSON.stringify(c.op) + ' was skipped.');
      }
    }
    st.run = null;
    return fault(st, 'runaway', 'The event ran ' + MAX_SILENT + ' silent commands without an effect and was stopped.');
  }
  function busy(st) { return st.run ? fault(st, st.run.wait ? 'waiting' : 'busy', st.run.wait ? 'The run is waiting for ' + (st.run.wait.kind === 'choice' ? 'a choice' : 'a battle result') + '.' : 'Another event is already running.') : null; }
  function start(state, evt, idx, opts) {
    var st = copy(state);
    opts = isObj(opts) ? opts : {};
    if (st.run) return busy(st);
    if (st.ending) return fault(st, 'ended', 'The game has ended (' + st.ending + ').');
    var e = idx.events[evt];
    if (!e) return fault(st, 'ref', 'Event ' + evt + ' is not in this story.');
    var page = opts.page !== undefined ? intOr(opts.page, -1) : pickPage(evt, st, idx);
    if (opts.page !== undefined && !isObj(e.pages[page])) return fault(st, 'page', 'Event ' + evt + ' has no page ' + opts.page + '.');
    if (page < 0) return result(st, { kind: 'none', evt: evt });
    if (e.pages[page].once) st.seen[seenKey(evt, page)] = 1;
    st.run = { evt: evt, page: page, stack: [{ evt: evt, page: page, path: [], i: 0 }], wait: null };
    return advance(st, idx);
  }
  function step(state, idx) {
    var st = copy(state);
    if (st.run && st.run.wait) return busy(st);
    return advance(st, idx);
  }
  function choose(state, option, idx) {
    var st = copy(state), w = st.run && st.run.wait;
    if (!w || w.kind !== 'choice') return fault(st, 'not-waiting', 'Nothing is waiting for a choice.');
    if (w.options.indexOf(option) < 0) return fault(st, 'option', 'Option ' + option + ' is not one of the options shown.');
    var c = nodeAt(idx, w.evt, w.page, w.path);
    st.run.wait = null;
    var top = st.run.stack[st.run.stack.length - 1], opt = c && Array.isArray(c.options) ? c.options[option] : null;
    if (top && opt && Array.isArray(opt.cmds) && opt.cmds.length) st.run.stack.push({ evt: w.evt, page: w.page, path: w.path.concat(['options', option, 'cmds']), i: 0 });
    return advance(st, idx);
  }
  function resolve(state, outcome, idx) {
    var st = copy(state), w = st.run && st.run.wait;
    if (!w || w.kind !== 'battle') return fault(st, 'not-waiting', 'Nothing is waiting for a battle result.');
    if (outcome !== 'win' && outcome !== 'lose' && outcome !== 'escape') return fault(st, 'outcome', 'A battle ends in win, lose, or escape.');
    var c = nodeAt(idx, w.evt, w.page, w.path) || {};
    if (outcome === 'escape' && !Array.isArray(c.escape)) return fault(st, 'no-escape', 'This battle has no escape list, so it cannot be escaped.');
    st.run.wait = null;
    if (outcome === 'lose' && !Array.isArray(c.lose)) { st.run = null; return result(st, { kind: 'gameover', trp: w.trp }); }
    if (Array.isArray(c[outcome]) && c[outcome].length) st.run.stack.push({ evt: w.evt, page: w.page, path: w.path.concat([outcome]), i: 0 });
    return advance(st, idx);
  }
  // play(state, evt, idx, answers): runs a whole event headlessly, answering choices and battles from answers
  // {choices [option index], battles ['win' or 'lose' or 'escape'], max steps (default 10000)} in order, and stops at the
  // first question it has no answer for. Returns {state, effects, waiting, done}. Tests, the walk, and Day 150's replay
  // use it; the playtester steps by hand.
  function play(state, evt, idx, answers) {
    answers = isObj(answers) ? answers : {};
    var cq = Array.isArray(answers.choices) ? answers.choices : [], bq = Array.isArray(answers.battles) ? answers.battles : [];
    var ci = 0, bi = 0, max = intOr(answers.max, 10000), effects = [];
    var r = start(state, evt, idx, answers.page !== undefined ? { page: answers.page } : null);
    for (var n = 0; n < max; n++) {
      effects.push(r.effect);
      if (r.done) break;
      if (r.waiting === 'choice') { if (ci >= cq.length) break; r = choose(r.state, cq[ci++], idx); continue; }
      if (r.waiting === 'battle') { if (bi >= bq.length) break; r = resolve(r.state, bq[bi++], idx); continue; }
      r = step(r.state, idx);
    }
    return { state: r.state, effects: effects, waiting: r.waiting, done: r.done, used: { choices: ci, battles: bi } };
  }
  S.run = { start: start, step: step, choose: choose, resolve: resolve, play: play, active: function (state) { return !!(state && state.run); } };
  S.quests = { settle: function (state, idx) { var st = copy(state), ch = settle(st, idx); return { state: st, changes: ch }; } };
