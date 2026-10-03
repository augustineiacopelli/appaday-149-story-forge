  // ---------------------------------------------------------------- the walk (Phase 7)
  // A deterministic search over abstract story states that proves what a story can and cannot reach. It plays the real
  // runner, so what it proves is what Day 150 will do. Nothing here reads a bundle: the caller hands over the index and a
  // small picture of the world.
  //   run(idx, world, opts)
  //     world {sites {siteKey: {requires [flg]}}, events {evt: {site}}, npcs {npc: {site, map}}}
  //       A site is open when every flag it requires is 1 or more. An event or person with no site, or a site the world
  //       does not list, is always open (the page reports those as warnings).
  //     opts {cap (states, default 50000), forks (per move, default 4096)}
  // The player's moves from a quiet state (no run, no ending), in a fixed order:
  //   an event triggered by mapEnter, step, or autorun whose site is open and whose page passes (sorted by ID);
  //   talking to a person at an open site: their talk event when one passes (highest priority, then ID), else the
  //   page of their dialogue that passes (sorted by person).
  // After every run the host's own rules fire, in this order, until none applies: chapterStart events when the chapter
  // changed (priority, then ID), battleEnd events for the battles that run fought, and autoruns on the map the player is
  // standing on. A forced autorun that leaves the state exactly as it was would run forever, and is reported.
  // Choices fork on every visible option; battles fork on win, and on lose and escape when the battle has those lists. A
  // loss without a lose list is game over: the player reloads, so it leads nowhere and is only counted.
  // DECISION, the abstract state: the engine state with gil and party cleared, because no condition can read either, so
  // two states that differ only there behave the same forever. Everything else is kept exactly, flags included.
  // States are keyed by a 64 bit hash of their canonical JSON (FNV-1a and xmur3 side by side), because a 32 bit hash
  // would likely collide somewhere in 50000 states. The search is breadth first, so the first path found to anything is
  // a shortest one. Reaching the cap stops the search and is reported; it is never a silent pass.
  var WALK_CAP = 50000, WALK_FORKS = 4096, WALK_CHAIN = 64, WALK_STEPS = 20000, WALK_REPORT = 5;
  var VOLUNTARY = { autorun: 1, mapEnter: 1, step: 1 };
  // Commands that cannot change an abstract state (gil and party are not part of it). A list made only of these, nested
  // through if and choice, is inert: running it ends exactly where it began, so the walk counts it without playing it.
  var INERT_OPS = { face: 1, fade: 1, gil: 1, moveActor: 1, music: 1, party: 1, sfx: 1, text: 1, vehicle: 1, wait: 1, changeMap: 1 };
  function inertList(list, depth) {
    if (!Array.isArray(list)) return true;
    if (depth > MAX_NEST + 1) return false;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!isObj(c)) continue;
      if (INERT_OPS[c.op]) continue;
      if (c.op === 'if') { if (!inertList(c.then, depth + 1) || !inertList(c['else'], depth + 1)) return false; continue; }
      if (c.op === 'choice') { if (Array.isArray(c.options)) for (var o = 0; o < c.options.length; o++) if (isObj(c.options[o]) && !inertList(c.options[o].cmds, depth + 1)) return false; continue; }
      return false;
    }
    return true;
  }
  function hash64(s) { return digest(s).slice(0, 8) + ('0000000' + (xmur3(s)() >>> 0).toString(16)).slice(-8); }
  function abstractOf(st) { var a = copy(st); a.gil = 0; a.party = []; a.run = null; return a; }
  function siteOpen(W, site, st, idx) {
    if (typeof site !== 'string' || !site) return true;
    var s = W.sites[site];
    if (!isObj(s) || !Array.isArray(s.requires)) return true;
    for (var i = 0; i < s.requires.length; i++) if (readFlag(st, idx, s.requires[i]) < 1) return false;
    return true;
  }
  function evtSite(W, evt) { var e = W.events[evt]; return isObj(e) && typeof e.site === 'string' ? e.site : null; }
  function npcInfo(W, npc) { var n = W.npcs[npc]; return isObj(n) ? n : {}; }
  function byPriority(idx) {
    return function (a, z) {
      var pa = intOr(idx.events[a].priority, 0), pz = intOr(idx.events[z].priority, 0);
      return pz - pa || (a < z ? -1 : a > z ? 1 : 0);
    };
  }
  function walkRun(idx, world, opts) {
    opts = isObj(opts) ? opts : {};
    var W = { sites: isObj(world) && isObj(world.sites) ? world.sites : {}, events: isObj(world) && isObj(world.events) ? world.events : {}, npcs: isObj(world) && isObj(world.npcs) ? world.npcs : {} };
    var cap = Math.max(1, intOr(opts.cap, WALK_CAP)), forkCap = Math.max(1, intOr(opts.forks, WALK_FORKS));
    var pidx = dlPlayIndex(idx);
    // The events by role, each list in the order the host checks them.
    var voluntary = [], chapterStart = [], battleEnd = [], autoruns = [], talkBy = {}, npcSet = {};
    each(idx.events, function (e, id) {
      if (VOLUNTARY[e.trigger]) voluntary.push(id);
      if (e.trigger === 'autorun') autoruns.push(id);
      if (e.trigger === 'chapterStart') chapterStart.push(id);
      if (e.trigger === 'battleEnd') battleEnd.push(id);
      if (e.trigger === 'talk' && typeof e.npc === 'string') { (talkBy[e.npc] = talkBy[e.npc] || []).push(id); npcSet[e.npc] = 1; }
    });
    var order = byPriority(idx);
    chapterStart.sort(order); battleEnd.sort(order); autoruns.sort(order);
    each(talkBy, function (list) { list.sort(order); });
    each(idx.npcDialogue, function (p, npc) { npcSet[npc] = 1; });
    each(W.npcs, function (p, npc) { if (talkBy[npc] || idx.npcDialogue[npc]) npcSet[npc] = 1; });
    var npcs = keys(npcSet);
    // Inert pages and conversations, worked out once. An autorun is never skipped: running it is how the walk finds an
    // autorun that would loop forever.
    var inertMemo = {};
    function inertPage(evt, page) {
      var k = 'e|' + seenKey(evt, page);
      if (inertMemo[k] === undefined) { var e = idx.events[evt], p = e && e.pages[page]; inertMemo[k] = !!p && e.trigger !== 'autorun' && !p.once && inertList(p.cmds, 0) ? 1 : 0; }
      return inertMemo[k] === 1;
    }
    // A conversation from its entry node: the nodes it can reach through any next or choice, and whether every one of
    // them is inert. {inert, nodes [keys]}.
    function inertTalk(dlg, entry) {
      var k = 'd|' + dlg + '|' + entry;
      if (inertMemo[k] !== undefined) return inertMemo[k];
      var rec = idx.dialogues[dlg], seen = {}, q = [], ok = true;
      if (dlNode(rec, entry)) { seen[entry] = 1; q.push(entry); }
      for (var h = 0; h < q.length; h++) {
        var c = dlCompile(rec, q[h]);
        if (!c || !inertList(c.cmds, 0)) ok = false;
        var nx = c ? (c.hasChoice ? c.choiceNext : [c.next]) : [];
        for (var i = 0; i < nx.length; i++) if (nx[i] && dlNode(rec, nx[i]) && !seen[nx[i]]) { seen[nx[i]] = 1; q.push(nx[i]); }
      }
      inertMemo[k] = { inert: ok && q.length > 0, nodes: q };
      return inertMemo[k];
    }

    // What the search learns. Every first is a node index; the node's parent chain is a shortest path to it.
    var nodes = [], at = {}, edges = [], adj = [];
    var facts = { endings: {}, chapters: {}, questsDone: {}, questsStarted: {}, questsFailed: {}, endedWithout: {}, flags: {}, pages: {}, nodesSeen: {}, npcPages: {}, setters: {} };
    var errors = [], errSeen = {}, stats = { runs: 0, selfLoops: 0, gameovers: 0, forkCaps: 0, chainCaps: 0, autorunLoops: 0, maxDepth: 0 };
    var expanding = -1, moveNow = null;

    function noteError(code, message, where) {
      var k = code + '|' + (where.evt || '') + '|' + (where.npc || '') + '|' + message;
      if (errSeen[k]) return;
      errSeen[k] = 1;
      errors.push({ code: code, message: message, evt: where.evt || null, npc: where.npc || null, dlg: where.dlg || null, node: expanding, move: moveNow ? copy(moveNow) : null });
    }
    function first(map, key, n) { if (map[key] === undefined) map[key] = n; }
    function addNode(st, parent, move) {
      var a = abstractOf(st), h = hash64(canon(a));
      if (at[h] !== undefined) return { i: at[h], fresh: false };
      if (nodes.length >= cap) return { i: -1, fresh: false };
      var i = nodes.length, depth = parent < 0 ? 0 : nodes[parent].depth + 1;
      nodes.push({ h: h, st: a, parent: parent, move: move, depth: depth, expanded: false });
      adj.push([]);
      at[h] = i;
      if (depth > stats.maxDepth) stats.maxDepth = depth;
      if (a.ending) first(facts.endings, a.ending, i);
      if (a.chapter) first(facts.chapters, a.chapter, i);
      each(idx.quests, function (def, q) {
        var qs = a.quests[q];
        if (!isObj(qs) || qs.stage == null) return;
        first(facts.questsStarted, q, i);
        if (qs.failed) first(facts.questsFailed, q, i);
        else if (def.stages.length && qs.stage === def.stages[def.stages.length - 1].key) first(facts.questsDone, q, i);
      });
      // An ending reached while a quest is unfinished: the page reads this to say a main quest can be skipped.
      if (a.ending) each(idx.quests, function (def, q) { if (!evalCond({ op: 'quest', qst: q, is: 'done' }, a, idx)) first(facts.endedWithout, q, i); });
      each(idx.flags, function (f, id) { if (readFlag(a, idx, id) !== f['default']) first(facts.flags, id, i); });
      return { i: i, fresh: true };
    }
    // A flag that a run moved off its default for the first time anywhere is credited to that run's root: the event the
    // player stood on, or the person they talked to. The page turns roots into sites for the golden order proof.
    function noteSetters(before, after, root) {
      each(idx.flags, function (f, id) {
        if (facts.setters[id] || readFlag(after, idx, id) === readFlag(before, idx, id) || readFlag(after, idx, id) === f['default']) return;
        facts.setters[id] = { evt: root.evt || null, npc: root.npc || null, node: expanding };
      });
    }
    function noteFrames(st) {
      var run = st && st.run;
      if (!run || !Array.isArray(run.stack)) return;
      for (var i = 0; i < run.stack.length; i++) {
        var fr = run.stack[i];
        if (typeof fr.evt === 'string' && fr.evt.indexOf('dlg:') !== 0) first(facts.pages, seenKey(fr.evt, fr.page), expanding);
      }
    }
    function noteCursor(cur) { if (cur && Array.isArray(cur.path)) for (var i = 0; i < cur.path.length; i++) first(facts.nodesSeen, cur.dlg + '#' + cur.path[i], expanding); }

    // Plays one run to every quiet end it can reach. first is the runner's first result (with its cursor for a
    // conversation). Returns [{state, choices [text], battles [{trp, outcome}]}] in a fixed order.
    function drive(r0, isDlg, root) {
      stats.runs++;
      var stack = [{ r: r0, choices: [], battles: [] }], outs = [], seen = {}, forks = 0;
      while (stack.length) {
        var it = stack.pop(), r = it.r, steps = 0;
        while (r) {
          var e = r.effect;
          noteFrames(r.state);
          if (isDlg) noteCursor(r.cursor);
          if (isObj(e) && e.kind === 'error') noteError(e.code, e.message, { evt: root.evt, npc: root.npc, dlg: e.dlg || (r.cursor && r.cursor.dlg) || null });
          if (isObj(e) && e.kind === 'gameover') { stats.gameovers++; r = null; break; }
          if (r.done || r.waiting) break;
          if (++steps > WALK_STEPS) { noteError('runaway', 'A run took more than ' + WALK_STEPS + ' steps without stopping.', root); r = null; break; }
          r = isDlg ? dlStep(r.state, r.cursor, pidx) : step(r.state, pidx);
        }
        if (!r) continue;
        if (r.done) { outs.push({ state: r.state, choices: it.choices, battles: it.battles }); continue; }
        var key = hash64(canon(r.state) + '|' + (isDlg && r.cursor ? r.cursor.dlg + '|' + r.cursor.node + '|' + r.cursor.then : ''));
        if (seen[key]) continue;
        seen[key] = 1;
        if (++forks > forkCap) { stats.forkCaps++; noteError('fork-cap', 'One move forked into more than ' + forkCap + ' paths; the rest of it was not explored.', root); break; }
        var kids = [];
        if (r.waiting === 'choice') {
          var opts0 = isObj(r.effect) && Array.isArray(r.effect.options) ? r.effect.options : [];
          for (var o = 0; o < opts0.length; o++) {
            var nr = isDlg ? dlChoose(r.state, r.cursor, opts0[o].index, pidx) : choose(r.state, opts0[o].index, pidx);
            kids.push({ r: nr, choices: it.choices.concat([opts0[o].text]), battles: it.battles });
          }
        } else if (r.waiting === 'battle') {
          var trp = r.state.run && r.state.run.wait ? r.state.run.wait.trp : null, outcomes = ['win'];
          if (isObj(r.effect) && r.effect.canLose) outcomes.push('lose');
          if (isObj(r.effect) && r.effect.canEscape) outcomes.push('escape');
          for (var b = 0; b < outcomes.length; b++) {
            var rr = resolve(r.state, outcomes[b], pidx);
            if (isDlg) rr = dlDrive(rr, r.cursor, pidx);
            kids.push({ r: rr, choices: it.choices, battles: it.battles.concat([{ trp: trp == null ? null : trp, outcome: outcomes[b] }]) });
          }
        }
        for (var k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
      }
      for (var i = 0; i < outs.length; i++) noteSetters(root.before, outs[i].state, root);
      return outs;
    }
    function runEvent(st, evt, root) {
      root.before = st;
      return drive(start(st, evt, pidx), false, root);
    }
    function runTalk(st, npc, root) {
      root.before = st;
      var r = dlTalk(st, npc, pidx);
      if (r.page >= 0) first(facts.npcPages, npc + '#' + r.page, expanding);
      return drive(r, true, root);
    }
    // The host's own rules after a run: chapterStart on a chapter change, battleEnd after battles, autoruns on the map
    // the player stands on. item {state, path [steps], fc {chapter, map, battles [trp], queue [evt]}}.
    function chain(item, out, depth) {
      var st = item.state, fc = item.fc;
      if (st.ending) { out.push(item); return; }
      if (depth > WALK_CHAIN) { stats.chainCaps++; noteError('chain', 'Forced events ran more than ' + WALK_CHAIN + ' times in a row after one move.', {}); out.push(item); return; }
      // queue holds forced events already due ({evt, kind}); each is run in turn if its page passes when its turn comes.
      var queue = fc.queue.slice(), battles = fc.battles.slice(), chapter = fc.chapter, next = null, kind = null;
      if (st.chapter !== chapter) { chapter = st.chapter; for (var cs = 0; cs < chapterStart.length; cs++) queue.push({ evt: chapterStart[cs], kind: 'chapterStart' }); }
      if (battles.length) {
        for (var bi = 0; bi < battles.length; bi++) for (var be = 0; be < battleEnd.length; be++) {
          var ev = idx.events[battleEnd[be]];
          if (ev.trp == null || ev.trp === battles[bi]) queue.push({ evt: battleEnd[be], kind: 'battleEnd' });
        }
        battles = [];
      }
      while (!next && queue.length) { var q = queue.shift(); if (pickPage(q.evt, st, pidx) >= 0) { next = q.evt; kind = q.kind; } }
      if (!next && fc.map) {
        for (var ai = 0; ai < autoruns.length && !next; ai++) {
          var aid = autoruns[ai];
          if (idx.events[aid].map === fc.map && siteOpen(W, evtSite(W, aid), st, idx) && pickPage(aid, st, pidx) >= 0) { next = aid; kind = 'autorun'; }
        }
      }
      if (!next) { out.push(item); return; }
      var h0 = hash64(canon(abstractOf(st))), outs = runEvent(st, next, { evt: next });
      for (var i = 0; i < outs.length; i++) {
        var o = outs[i], won = [];
        for (var w = 0; w < o.battles.length; w++) if (o.battles[w].trp) won.push(o.battles[w].trp);
        if (kind === 'autorun' && hash64(canon(abstractOf(o.state))) === h0) {
          stats.autorunLoops++;
          noteError('autorun-loop', 'This autorun passes again as soon as it ends and changes nothing, so the player would be stuck in it forever.', { evt: next });
          out.push(item);
          continue;
        }
        var stepRec = { by: kind, evt: next };
        if (o.choices.length) stepRec.choices = o.choices;
        if (o.battles.length) stepRec.battles = o.battles;
        chain({ state: o.state, path: item.path.concat([stepRec]), fc: { chapter: chapter, map: fc.map, battles: won, queue: queue.slice() } }, out, depth + 1);
      }
    }
    // Every quiet state a move can end in, with the steps that got there.
    function settleMove(outs, mainStep, map, chapterBefore) {
      var done = [];
      for (var i = 0; i < outs.length; i++) {
        var o = outs[i], s0 = copy(mainStep), won = [];
        if (o.choices.length) s0.choices = o.choices;
        if (o.battles.length) s0.battles = o.battles;
        for (var w = 0; w < o.battles.length; w++) if (o.battles[w].trp) won.push(o.battles[w].trp);
        chain({ state: o.state, path: [s0], fc: { chapter: chapterBefore, map: map, battles: won, queue: [] } }, done, 0);
      }
      return done;
    }
    function moves(st) {
      var out = [];
      for (var i = 0; i < voluntary.length; i++) {
        var id = voluntary[i];
        if (!siteOpen(W, evtSite(W, id), st, idx)) continue;
        var p = pickPage(id, st, pidx);
        if (p < 0) continue;
        first(facts.pages, seenKey(id, p), expanding);
        if (inertPage(id, p)) { stats.selfLoops++; continue; }
        out.push({ by: idx.events[id].trigger, evt: id, map: idx.events[id].map || null });
      }
      for (var n = 0; n < npcs.length; n++) {
        var npc = npcs[n], info = npcInfo(W, npc);
        if (!siteOpen(W, info.site, st, idx)) continue;
        var list = talkBy[npc] || [], te = null, tp = -1;
        for (var t = 0; t < list.length && !te; t++) { tp = pickPage(list[t], st, pidx); if (tp >= 0) te = list[t]; }
        if (te) {
          first(facts.pages, seenKey(te, tp), expanding);
          if (inertPage(te, tp)) { stats.selfLoops++; continue; }
          out.push({ by: 'talk', evt: te, npc: npc, map: info.map || null });
          continue;
        }
        var pages = idx.npcDialogue[npc], at = dlPick(pages, st, idx);
        if (at < 0) continue;
        var pg = pages[at], entry = typeof pg.node === 'string' && pg.node ? pg.node : idx.dialogues[pg.dlg].start, it = inertTalk(pg.dlg, entry);
        if (it.inert) {
          first(facts.npcPages, npc + '#' + at, expanding);
          for (var v = 0; v < it.nodes.length; v++) first(facts.nodesSeen, pg.dlg + '#' + it.nodes[v], expanding);
          stats.selfLoops++;
          continue;
        }
        out.push({ by: 'dialogue', npc: npc, map: info.map || null });
      }
      return out;
    }
    function link(from, outcome, path) {
      var r = addNode(outcome, from, path);
      if (r.i < 0) return false;
      if (r.i === from) { stats.selfLoops++; return true; }
      if (adj[from].indexOf(r.i) < 0) { adj[from].push(r.i); edges.push([from, r.i]); }
      return true;
    }

    // ---- the search
    var newGame = createState(idx, {});
    addNode(newGame, -1, [{ by: 'newGame' }]);
    var capped = false;
    // A new game plays its forced events (the first chapter's opener) before the player can move.
    expanding = 0; moveNow = null;
    var boot = [];
    chain({ state: newGame, path: [{ by: 'newGame' }], fc: { chapter: null, map: null, battles: [], queue: [] } }, boot, 0);
    var booted = boot.length !== 1 || hash64(canon(abstractOf(boot[0].state))) !== nodes[0].h;
    if (booted) {
      nodes[0].boot = true;
      for (var bi = 0; bi < boot.length; bi++) if (!link(0, boot[bi].state, boot[bi].path)) capped = true;
      nodes[0].expanded = true;
    }
    for (var head = booted ? 1 : 0; head < nodes.length; head++) {
      var nd = nodes[head];
      expanding = head;
      if (nd.st.ending) { nd.expanded = true; continue; }
      var ms = moves(nd.st);
      for (var m = 0; m < ms.length; m++) {
        var mv = ms[m], outs, stepRec = { by: mv.by };
        moveNow = stepRec;
        if (mv.evt) stepRec.evt = mv.evt;
        if (mv.npc) stepRec.npc = mv.npc;
        if (mv.by === 'dialogue') outs = runTalk(nd.st, mv.npc, { npc: mv.npc });
        else outs = runEvent(nd.st, mv.evt, { evt: mv.evt, npc: mv.npc || null });
        var settled = settleMove(outs, stepRec, mv.map, nd.st.chapter);
        for (var s = 0; s < settled.length; s++) if (!link(head, settled[s].state, settled[s].path)) capped = true;
      }
      // A state the cap cut short keeps counting as unexplored, so the softlock proof never blames it for edges it lost.
      nd.expanded = !capped;
      if (capped) break;
    }
    expanding = -1; moveNow = null;

    // ---- no softlock: reverse reachability from every ending (and, when capped, from every state not yet expanded,
    // since the search cannot say where those lead).
    var rev = [];
    for (var ri = 0; ri < nodes.length; ri++) rev.push([]);
    for (var ei = 0; ei < edges.length; ei++) rev[edges[ei][1]].push(edges[ei][0]);
    var good = [], queue0 = [];
    for (var gi = 0; gi < nodes.length; gi++) { good.push(false); if (nodes[gi].st.ending || !nodes[gi].expanded) { good[gi] = true; queue0.push(gi); } }
    for (var qh = 0; qh < queue0.length; qh++) { var pr = rev[queue0[qh]]; for (var pi = 0; pi < pr.length; pi++) if (!good[pr[pi]]) { good[pr[pi]] = true; queue0.push(pr[pi]); } }
    var stuck = [], entries = [], deadEnds = 0;
    for (var si = 0; si < nodes.length; si++) {
      if (good[si]) continue;
      stuck.push(si);
      if (!adj[si].length) deadEnds++;
      if (nodes[si].parent < 0 || good[nodes[si].parent]) entries.push(si);
    }
    // The deepest stuck state shows where progress stops when nothing reaches an ending at all.
    var deepest = -1;
    for (var di = 0; di < stuck.length; di++) if (deepest < 0 || nodes[stuck[di]].depth > nodes[deepest].depth) deepest = stuck[di];

    function pathTo(i) {
      var chainOut = [];
      for (var c = i; c >= 0; c = nodes[c].parent) chainOut.push(nodes[c].move);
      var out = [];
      for (var k = chainOut.length - 1; k >= 0; k--) for (var j = 0; j < chainOut[k].length; j++) out.push(copy(chainOut[k][j]));
      return out;
    }
    function where(i) { var n = nodes[i]; return { node: i, depth: n.depth, hash: n.h, chapter: n.st.chapter, ending: n.st.ending || null, path: pathTo(i) }; }
    // A stuck state's started quests, {qst: stage key or 'failed'}, so a report can say where the story stood.
    function questsAt(i) { var q = {}; each(nodes[i].st.quests, function (qs, k) { if (isObj(qs) && qs.stage != null) q[k] = qs.failed ? 'failed' : qs.stage; }); return q; }
    function firstMap(map, withPath) { var o = {}; each(map, function (i, k) { o[k] = withPath ? where(i) : { node: i, depth: i >= 0 ? nodes[i].depth : -1 }; }); return o; }
    var softlocks = [];
    for (var en = 0; en < entries.length && softlocks.length < WALK_REPORT; en++) {
      var w0 = where(entries[en]);
      w0.quests = questsAt(entries[en]);
      w0.deadEnd = !adj[entries[en]].length;
      softlocks.push(w0);
    }
    var setters = {};
    each(facts.setters, function (s, f) { setters[f] = { evt: s.evt, npc: s.npc, node: s.node, depth: s.node >= 0 ? nodes[s.node].depth : -1 }; });
    var errs = [];
    for (var er = 0; er < errors.length; er++) { var x = copy(errors[er]); x.path = x.node >= 0 ? pathTo(x.node).concat(x.move ? [x.move] : []) : []; delete x.move; errs.push(x); }
    var frontier = 0;
    for (var fi = 0; fi < nodes.length; fi++) if (!nodes[fi].expanded) frontier++;
    // The golden path: the shortest path to an ending with every quest in opts.goal done (the page passes the main
    // quests), else the shortest path to any ending. Breadth first order makes the first such node a shortest one.
    var goal = Array.isArray(opts.goal) ? opts.goal.filter(function (q) { return !!idx.quests[q]; }) : [], goldenEnd = -1, goldenAny = -1;
    for (var gn = 0; gn < nodes.length && goldenEnd < 0; gn++) {
      if (!nodes[gn].st.ending) continue;
      if (goldenAny < 0) goldenAny = gn;
      var all = true;
      for (var gq = 0; gq < goal.length && all; gq++) if (!evalCond({ op: 'quest', qst: goal[gq], is: 'done' }, nodes[gn].st, idx)) all = false;
      if (all) goldenEnd = gn;
    }
    var goldenFull = goldenEnd >= 0;
    if (goldenEnd < 0) goldenEnd = goldenAny;
    return {
      version: S.version, digest: idx.digest,
      stats: { states: nodes.length, edges: edges.length, expanded: nodes.length - frontier, frontier: frontier, capped: capped, cap: cap, maxDepth: stats.maxDepth, runs: stats.runs,
        selfLoops: stats.selfLoops, gameovers: stats.gameovers, forkCaps: stats.forkCaps, chainCaps: stats.chainCaps, autorunLoops: stats.autorunLoops, boot: booted },
      endings: firstMap(facts.endings, true), chapters: firstMap(facts.chapters, true), questsDone: firstMap(facts.questsDone, true),
      questsStarted: firstMap(facts.questsStarted, false), questsFailed: firstMap(facts.questsFailed, false), flags: firstMap(facts.flags, false),
      pages: firstMap(facts.pages, false), dialogueNodes: firstMap(facts.nodesSeen, false), npcPages: firstMap(facts.npcPages, false), setters: setters,
      golden: goldenEnd >= 0 ? where(goldenEnd) : null, goldenFull: goldenFull, goal: goal, endedWithout: firstMap(facts.endedWithout, true),
      softlock: { count: stuck.length, entries: entries.length, deadEnds: deadEnds, reported: softlocks, deepest: deepest >= 0 ? (function () { var w = where(deepest); w.quests = questsAt(deepest); return w; })() : null },
      errors: errs
    };
  }
  S.walk = { CAP: WALK_CAP, FORKS: WALK_FORKS, run: walkRun, hash: hash64, abstract: abstractOf };
