  // ---------------------------------------------------------------- dialogue (Phase 4)
  // A dlg_ record is a graph of nodes the player walks by talking to someone:
  //   {speaker, por, start, nodes {key: {speaker, por, prompt, lines [string], cmds [cmd], next | choices [{text, cond, cmds, next}]}}}
  // A node says its lines, runs its cmds (any command in the closed vocabulary), then either follows next, or shows its
  // choices and follows the next of the one picked. A node with neither next nor a chosen next ends the conversation.
  // Choices that fail their condition are hidden; if every choice is hidden the conversation ends there.
  // The graph is the one place in the story that may loop back (ask again), so a cycle is allowed through a choice and is
  // an error when it holds only next links, which would never wait for the player.
  //   compile(rec, node)  the node as an ordinary command list: a text command, the node's cmds, then a choice command.
  //                       Dialogue therefore runs through the same runner as an event; nothing else is interpreted.
  //   playIndex(idx)      a copy of the index that also holds one synthetic event per dialogue node, so the runner can run it.
  //   begin, step, choose, play, talk   drive a conversation. Each returns {state, effect, waiting, done, cursor}; the cursor is
  //                       plain JSON ({dlg, node, then, quests, visits, path}) that the host hands back on the next call.
  //   pick(pages, state, idx)  story.npcDialogue pages [{cond, dlg, node}] (node optional: where in the dialogue it opens): the highest page whose condition passes and whose
  //                       dialogue exists wins, RPG Maker's rightmost rule again.
  //   lint, lintPages, reach, edges, refs   checking and reading, for the tab, the validator, and Phase 7's walk.
  var DL_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/, DL_MAX_NODES = 200, DL_MAX_VISITS = 2000, DL_LONG_LINE = 140;
  function dlNode(rec, key) { return isObj(rec) && isObj(rec.nodes) && typeof key === 'string' && isObj(rec.nodes[key]) ? rec.nodes[key] : null; }
  function dlEventKey(dlg, node) { return 'dlg:' + dlg + ':' + node; }
  function dlSpeaker(rec, n) {
    var s = n.speaker !== undefined && n.speaker !== null && n.speaker !== '' ? n.speaker : rec.speaker;
    return s === undefined || s === null || s === '' ? null : s;
  }
  function dlCompile(rec, key) {
    var n = dlNode(rec, key);
    if (!n) return null;
    var cmds = [], lines = Array.isArray(n.lines) ? n.lines.filter(function (l) { return typeof l === 'string'; }) : [];
    if (lines.length) {
      var t = { op: 'text', lines: copy(lines) }, sp = dlSpeaker(rec, n), por = n.por || rec.por;
      if (sp !== null) t.speaker = sp;
      if (typeof por === 'string' && por) t.por = por;
      cmds.push(t);
    }
    if (Array.isArray(n.cmds)) for (var i = 0; i < n.cmds.length; i++) cmds.push(copy(n.cmds[i]));
    var next = null, choiceNext = [], hasChoice = false;
    if (Array.isArray(n.choices) && n.choices.length) {
      var opts = [];
      for (var c = 0; c < n.choices.length; c++) {
        var ch = n.choices[c];
        if (!isObj(ch)) continue;
        var o = { text: String(ch.text === undefined || ch.text === null ? '' : ch.text) };
        if (ch.cond !== undefined && ch.cond !== null) o.cond = copy(ch.cond);
        o.cmds = Array.isArray(ch.cmds) ? copy(ch.cmds) : [];
        opts.push(o);
        choiceNext.push(typeof ch.next === 'string' && ch.next ? ch.next : null);
      }
      var cc = { op: 'choice', options: opts };
      if (typeof n.prompt === 'string' && n.prompt) cc.prompt = n.prompt;
      cmds.push(cc);
      hasChoice = true;
    } else if (typeof n.next === 'string' && n.next) next = n.next;
    return { cmds: cmds, next: next, choiceNext: choiceNext, hasChoice: hasChoice };
  }
  function dlPlayIndex(idx) {
    var ev = {}, out = {};
    each(idx.events, function (e, k) { ev[k] = e; });
    each(idx.dialogues, function (rec, id) {
      each(isObj(rec) && isObj(rec.nodes) ? rec.nodes : {}, function (n, k) {
        var c = dlCompile(rec, k);
        if (c) ev[dlEventKey(id, k)] = { trigger: 'talk', pages: [{ cmds: c.cmds }] };
      });
    });
    each(idx, function (v, k) { out[k] = v; });
    out.events = ev;
    return out;
  }
  function dlEnter(rec, cur, node) {
    var c = dlCompile(rec, node);
    cur.node = node; cur.path.push(node); cur.visits++;
    cur.then = c && !c.hasChoice ? c.next : null;
  }
  // Takes a runner result for the current node and carries the conversation on: a node that finished hands over to the
  // next one without showing anything in between; everything else goes back to the host as it is.
  function dlDrive(r, cur, idx) {
    cur = copy(cur);
    for (var guard = 0; guard < DL_MAX_VISITS + 4; guard++) {
      var e = r.effect;
      if (!(e && e.kind === 'end' && r.done)) return { state: r.state, effect: e, waiting: r.waiting, done: r.done, cursor: cur };
      if (Array.isArray(e.quests)) for (var q = 0; q < e.quests.length; q++) cur.quests.push(e.quests[q]);
      var rec = idx.dialogues[cur.dlg], next = r.state.ending ? null : cur.then;
      if (!next) return { state: r.state, effect: { kind: 'end', dlg: cur.dlg, quests: cur.quests }, waiting: null, done: true, cursor: cur };
      if (!dlNode(rec, next)) { var f = fault(r.state, 'node', 'Node ' + next + ' is not in dialogue ' + cur.dlg + '.', { dlg: cur.dlg }); return { state: f.state, effect: f.effect, waiting: null, done: true, cursor: cur }; }
      if (cur.visits >= DL_MAX_VISITS) { var g = fault(r.state, 'runaway', 'The conversation visited ' + DL_MAX_VISITS + ' nodes without stopping.', { dlg: cur.dlg }); return { state: g.state, effect: g.effect, waiting: null, done: true, cursor: cur }; }
      dlEnter(rec, cur, next);
      r = start(r.state, dlEventKey(cur.dlg, next), idx);
    }
    var h = fault(r.state, 'runaway', 'The conversation did not settle.', { dlg: cur.dlg });
    return { state: h.state, effect: h.effect, waiting: null, done: true, cursor: cur };
  }
  function dlBegin(state, dlg, idx, opts) {
    opts = isObj(opts) ? opts : {};
    var rec = idx.dialogues[dlg], st = copy(state);
    var first = typeof opts.node === 'string' && opts.node ? opts.node : (rec && typeof rec.start === 'string' ? rec.start : null);
    var cur = { dlg: dlg, node: null, then: null, quests: [], visits: 0, path: [] };
    if (!rec) { var f0 = fault(st, 'ref', 'Dialogue ' + dlg + ' is not in this story.', { dlg: dlg }); return { state: f0.state, effect: f0.effect, waiting: null, done: !f0.state.run, cursor: cur }; }
    if (!dlNode(rec, first)) { var f1 = fault(st, 'node', 'Dialogue ' + dlg + ' has no start node.', { dlg: dlg }); return { state: f1.state, effect: f1.effect, waiting: null, done: !f1.state.run, cursor: cur }; }
    if (st.run) { var b0 = busy(st); return { state: b0.state, effect: b0.effect, waiting: b0.waiting, done: false, cursor: cur }; }
    if (st.ending) { var f2 = fault(st, 'ended', 'The game has ended (' + st.ending + ').'); return { state: f2.state, effect: f2.effect, waiting: null, done: true, cursor: cur }; }
    dlEnter(rec, cur, first);
    return dlDrive(start(st, dlEventKey(dlg, first), idx), cur, idx);
  }
  function dlStep(state, cursor, idx) { return dlDrive(step(state, idx), cursor, idx); }
  function dlChoose(state, cursor, option, idx) {
    var cur = copy(cursor), rec = idx.dialogues[cur.dlg], c = dlCompile(rec, cur.node), r = choose(state, option, idx);
    if (r.effect && r.effect.kind !== 'error') cur.then = c && c.choiceNext[option] ? c.choiceNext[option] : null;
    return dlDrive(r, cur, idx);
  }
  // play(state, dlg, idx, answers): runs a whole conversation headlessly. answers {choices [option index], battles ['win'...],
  // node (start elsewhere), max}. Stops at the first question it has no answer for.
  function dlPlay(state, dlg, idx, answers) {
    answers = isObj(answers) ? answers : {};
    var cq = Array.isArray(answers.choices) ? answers.choices : [], bq = Array.isArray(answers.battles) ? answers.battles : [];
    var ci = 0, bi = 0, max = intOr(answers.max, 10000), effects = [];
    var r = dlBegin(state, dlg, idx, answers.node !== undefined ? { node: answers.node } : null);
    for (var n = 0; n < max; n++) {
      effects.push(r.effect);
      if (r.done) break;
      if (r.waiting === 'choice') { if (ci >= cq.length) break; r = dlChoose(r.state, r.cursor, cq[ci++], idx); continue; }
      if (r.waiting === 'battle') {
        if (bi >= bq.length) break;
        var rr = resolve(r.state, bq[bi++], idx);
        r = dlDrive(rr, r.cursor, idx);
        continue;
      }
      r = dlStep(r.state, r.cursor, idx);
    }
    return { state: r.state, effects: effects, waiting: r.waiting, done: r.done, cursor: r.cursor, path: r.cursor.path.slice(), used: { choices: ci, battles: bi } };
  }

  // ---------------------------------------------------------------- who says what: the page list of a person
  function dlOpen(p) { return !isObj(p) || p.cond === undefined || p.cond === null || (isObj(p.cond) && p.cond.op === 'true'); }
  function dlPick(pages, state, idx) {
    if (!Array.isArray(pages)) return -1;
    for (var i = pages.length - 1; i >= 0; i--) {
      var p = pages[i];
      if (!isObj(p) || typeof p.dlg !== 'string' || !idx.dialogues[p.dlg]) continue;
      if (evalCond(p.cond, state, idx)) return i;
    }
    return -1;
  }
  // talk(state, npc, idx, opts): the conversation the person would start now, or {effect {kind none}} when no page passes.
  function dlTalk(state, npc, idx, opts) {
    var pages = idx.npcDialogue && idx.npcDialogue[npc], at = dlPick(pages, state, idx);
    if (at < 0) { var st = copy(state); return { state: st, effect: { kind: 'none', npc: npc }, waiting: null, done: true, cursor: null, page: -1 }; }
    var o = isObj(opts) ? copy(opts) : {};
    if (o.node === undefined && typeof pages[at].node === 'string' && pages[at].node) o.node = pages[at].node;
    var r = dlBegin(state, pages[at].dlg, idx, o);
    r.page = at;
    return r;
  }
  function dlLintPages(pages, idx, path) {
    var out = [];
    path = path || 'pages';
    if (!Array.isArray(pages)) { problem(out, path, 'error', 'not-list', 'A person\'s dialogue is a list of pages.'); return out; }
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i], pp = path + '[' + i + ']';
      if (!isObj(p)) { problem(out, pp, 'error', 'not-object', 'A page is {cond, dlg}.'); continue; }
      noIdField(p, pp, out);
      if (typeof p.dlg !== 'string' || !p.dlg) problem(out, pp + '.dlg', 'error', 'missing', 'A page needs dlg, a dialogue.');
      else if (!refOk(idx, 'dlg_', p.dlg)) problem(out, pp + '.dlg', 'error', 'ref', p.dlg + ' is not a dialogue in this story.');
      if (p.node !== undefined && p.node !== null && p.node !== '') {
        var target = typeof p.dlg === 'string' && idx.dialogues ? idx.dialogues[p.dlg] : null;
        if (typeof p.node !== 'string') problem(out, pp + '.node', 'error', 'type', 'node is the key of a node in the dialogue.');
        else if (target && !dlNode(target, p.node)) problem(out, pp + '.node', 'error', 'ref', 'Node ' + p.node + ' is not a node of ' + p.dlg + '.');
      }
      lintCond(p.cond, idx, pp + '.cond', out, 0);
      for (var j = i + 1; j < pages.length; j++) if (dlOpen(pages[j]) && isObj(pages[j]) && typeof pages[j].dlg === 'string' && refOk(idx, 'dlg_', pages[j].dlg)) { problem(out, pp, 'warning', 'shadowed', 'Page ' + (j + 1) + ' always passes and sits after this page, so this page is never shown.'); break; }
    }
    return out;
  }

  // ---------------------------------------------------------------- reading the graph
  // Every link between nodes, in node key order: [{from, to, kind 'next' or 'choice', i (choice index), text}].
  function dlEdges(rec) {
    var out = [];
    each(isObj(rec) && isObj(rec.nodes) ? rec.nodes : {}, function (n, k) {
      if (!isObj(n)) return;
      if (Array.isArray(n.choices) && n.choices.length) {
        for (var i = 0; i < n.choices.length; i++) if (isObj(n.choices[i]) && typeof n.choices[i].next === 'string' && n.choices[i].next) out.push({ from: k, to: n.choices[i].next, kind: 'choice', i: i, text: String(n.choices[i].text || '') });
      } else if (typeof n.next === 'string' && n.next) out.push({ from: k, to: n.next, kind: 'next', i: -1, text: '' });
    });
    return out;
  }
  // reach(rec): the nodes a conversation can visit from start, breadth first: {order [keys], unreachable [keys, sorted]}.
  function dlReach(rec) {
    var nodes = isObj(rec) && isObj(rec.nodes) ? rec.nodes : {}, edges = dlEdges(rec), from = {}, seen = {}, order = [], q = [];
    for (var e = 0; e < edges.length; e++) (from[edges[e].from] = from[edges[e].from] || []).push(edges[e].to);
    if (isObj(nodes[rec && rec.start])) { seen[rec.start] = 1; q.push(rec.start); }
    for (var h = 0; h < q.length; h++) {
      order.push(q[h]);
      var outs = from[q[h]] || [];
      for (var i = 0; i < outs.length; i++) if (isObj(nodes[outs[i]]) && !seen[outs[i]]) { seen[outs[i]] = 1; q.push(outs[i]); }
    }
    var un = [];
    each(nodes, function (n, k) { if (!seen[k]) un.push(k); });
    return { order: order, unreachable: un };
  }
  // A cycle made only of next links (no node on it asks the player anything), as a list of node keys, or null.
  function dlLoop(rec) {
    var nodes = isObj(rec) && isObj(rec.nodes) ? rec.nodes : {}, nxt = {}, color = {}, found = null;
    each(nodes, function (n, k) { if (isObj(n) && !(Array.isArray(n.choices) && n.choices.length) && typeof n.next === 'string' && n.next && isObj(nodes[n.next])) nxt[k] = n.next; });
    function walk(k, trail) {
      if (found) return;
      color[k] = 1; trail.push(k);
      var t = nxt[k];
      if (t !== undefined) {
        if (color[t] === 1) found = trail.slice(trail.indexOf(t));
        else if (!color[t]) walk(t, trail);
      }
      trail.pop(); color[k] = 2;
    }
    each(nxt, function (t, k) { if (!color[k]) walk(k, []); });
    return found;
  }
  // Everything a conversation reads, sets, and names, in cmd.refs's shape, over every node's compiled command list.
  function dlRefs(rec) {
    var all = [];
    each(isObj(rec) && isObj(rec.nodes) ? rec.nodes : {}, function (n, k) { var c = dlCompile(rec, k); if (c) for (var i = 0; i < c.cmds.length; i++) all.push(c.cmds[i]); });
    return cmdRefs(all);
  }

  // ---------------------------------------------------------------- lint
  function dlLint(rec, idx, path) {
    var out = [];
    path = path || 'dialogue';
    if (!isObj(rec)) { problem(out, path, 'error', 'not-object', 'A dialogue is an object.'); return out; }
    function who(v, p) {
      if (v === undefined || v === null || v === '') return;
      if (typeof v !== 'string') { problem(out, p, 'error', 'type', 'A speaker is a chr_, an npc_, or a plain name.'); return; }
      if (/^(chr|npc)_/.test(v) && !refOk(idx, v.slice(0, 4), v)) problem(out, p, 'error', 'ref', v + ' does not resolve to a ' + (v.slice(0, 3) === 'chr' ? 'party character' : 'person') + '.');
    }
    function por(v, p) { if (v !== undefined && v !== null && v !== '' && !refOk(idx, 'por_', v)) problem(out, p, 'error', 'ref', String(v) + ' is not a portrait.'); }
    who(rec.speaker, path + '.speaker');
    por(rec.por, path + '.por');
    if (!isObj(rec.nodes) || !keys(rec.nodes).length) { problem(out, path + '.nodes', 'error', 'missing', 'A dialogue needs at least one node.'); return out; }
    var nk = keys(rec.nodes);
    if (nk.length > DL_MAX_NODES) problem(out, path + '.nodes', 'error', 'too-many', 'A dialogue holds up to ' + DL_MAX_NODES + ' nodes; this one has ' + nk.length + '.');
    if (typeof rec.start !== 'string' || !rec.start) problem(out, path + '.start', 'error', 'missing', 'A dialogue needs start, the node it opens with.');
    else if (!isObj(rec.nodes[rec.start])) problem(out, path + '.start', 'error', 'ref', 'The start node ' + rec.start + ' is not a node of this dialogue.');
    for (var i = 0; i < nk.length; i++) {
      var k = nk[i], n = rec.nodes[k], p = path + '.nodes.' + k;
      if (!DL_KEY_RE.test(k)) problem(out, p, 'error', 'node-key', 'A node key uses lowercase letters, digits, and underscores, starts with a letter, and holds up to 32 characters.');
      if (!isObj(n)) { problem(out, p, 'error', 'not-object', 'A node is an object.'); continue; }
      noIdField(n, p, out);
      who(n.speaker, p + '.speaker');
      por(n.por, p + '.por');
      if (n.lines !== undefined) {
        if (!Array.isArray(n.lines) || !n.lines.every(function (l) { return typeof l === 'string'; })) problem(out, p + '.lines', 'error', 'type', 'lines is a list of strings.');
        else for (var l = 0; l < n.lines.length; l++) {
          if (!n.lines[l].trim()) problem(out, p + '.lines[' + l + ']', 'warning', 'empty-line', 'This line is empty.');
          else if (n.lines[l].length > DL_LONG_LINE) problem(out, p + '.lines[' + l + ']', 'warning', 'long-line', 'This line holds ' + n.lines[l].length + ' characters; more than ' + DL_LONG_LINE + ' will not fit a text box comfortably. Split it.');
        }
      }
      if (n.prompt !== undefined && typeof n.prompt !== 'string') problem(out, p + '.prompt', 'error', 'type', 'prompt is text.');
      if (n.cmds !== undefined) lintList(n.cmds, idx, p + '.cmds', out, 0, null);
      var hasChoices = Array.isArray(n.choices) && n.choices.length > 0;
      if (n.choices !== undefined && !Array.isArray(n.choices)) problem(out, p + '.choices', 'error', 'type', 'choices is a list.');
      if (hasChoices && n.next !== undefined && n.next !== null && n.next !== '') problem(out, p, 'error', 'next-and-choices', 'A node follows next or shows choices, not both.');
      if (n.next !== undefined && n.next !== null && n.next !== '' && !hasChoices && !isObj(rec.nodes[n.next])) problem(out, p + '.next', 'error', 'ref', 'Node ' + n.next + ' is not a node of this dialogue.');
      if (hasChoices) {
        if (n.choices.length < 2) problem(out, p + '.choices', 'warning', 'one-option', 'A single choice is not a choice. Use next instead.');
        var open = 0;
        for (var c = 0; c < n.choices.length; c++) {
          var ch = n.choices[c], cp = p + '.choices[' + c + ']';
          if (!isObj(ch)) { problem(out, cp, 'error', 'not-object', 'A choice is {text, cond, cmds, next}.'); continue; }
          noIdField(ch, cp, out);
          if (typeof ch.text !== 'string' || !ch.text.trim()) problem(out, cp + '.text', 'error', 'missing', 'Every choice needs text.');
          lintCond(ch.cond, idx, cp + '.cond', out, 0);
          if (ch.cmds !== undefined) lintList(ch.cmds, idx, cp + '.cmds', out, 0, null);
          if (ch.next !== undefined && ch.next !== null && ch.next !== '' && !isObj(rec.nodes[ch.next])) problem(out, cp + '.next', 'error', 'ref', 'Node ' + ch.next + ' is not a node of this dialogue.');
          if (ch.cond === undefined || ch.cond === null || (isObj(ch.cond) && ch.cond.op === 'true')) open++;
        }
        if (!open) problem(out, p + '.choices', 'warning', 'all-conditional', 'Every choice has a condition. If none passes the conversation ends here without showing anything.');
      } else if (!Array.isArray(n.lines) || !n.lines.length) {
        if (!(Array.isArray(n.cmds) && n.cmds.length) && !n.next) problem(out, p, 'warning', 'empty', 'This node says nothing, does nothing, and goes nowhere.');
      }
    }
    var loop = dlLoop(rec);
    if (loop) problem(out, path + '.nodes.' + loop[0] + '.next', 'error', 'loop', 'Nodes ' + loop.join(', ') + ' follow each other forever without asking the player anything.');
    if (isObj(rec.nodes[rec.start])) {
      var un = dlReach(rec).unreachable;
      for (var u = 0; u < un.length; u++) problem(out, path + '.nodes.' + un[u], 'warning', 'unreachable', 'Nothing leads to node ' + un[u] + ', so nobody can ever see it.');
    }
    return out;
  }
  S.dlg = {
    KEY_RE: DL_KEY_RE, MAX_NODES: DL_MAX_NODES, MAX_VISITS: DL_MAX_VISITS, LONG_LINE: DL_LONG_LINE,
    eventKey: dlEventKey, compile: dlCompile, playIndex: dlPlayIndex,
    begin: dlBegin, step: dlStep, choose: dlChoose, play: dlPlay, talk: dlTalk,
    pick: dlPick, lintPages: dlLintPages, lint: dlLint,
    edges: dlEdges, reach: dlReach, loop: dlLoop, refs: dlRefs
  };
