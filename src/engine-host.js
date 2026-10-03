  // ---------------------------------------------------------------- the host (Phase 8)
  // Everything a game needs to run this story from a Final bundle alone, with no forge page: no Kit, no STORY, no
  // storage, no network. Day 150 calls these; the forge itself now calls ext and world too, so the page, the walk, and a
  // shipped game all read a bundle the same way.
  //   ext(bundle)    the IDs and roles the index may name (what the forge used to gather on its own)
  //   world(bundle)  the walk's picture of the world: {sites, events, npcs, unknown, golden, pos}
  //   load(bundle)   {version, idx, pidx, ext, world, goal, roles}: a game, built once
  //   newGame(game, opts, hooks)        a fresh state with the forced events of a new game played: {state, steps, ...}
  //   moves(game, state)                what the player may do now: [{by, evt, npc, map}] in the walk's fixed order
  //   play(game, state, move, hooks)    one move and every forced event after it, down one path: {state, steps, ...}
  //   replay(game, path, opts)          plays a walk path (golden or any ending's) and checks every step against it;
  //                                     opts {effect(e, ctx), battle(question, ctx)} observe without deciding;
  //                                     opts.state starts from that state (a loaded save) instead of a new game
  //   hash(state)                       the walk's 64 bit hash of a state's abstract form
  // hooks {begin(ctx), decide(question, ctx), effect(effect, ctx)}, all optional. begin is called as each run starts with
  // ctx {by, evt, npc}; returning false stops before the run. decide answers {kind 'choice', options [{index, text}]} with
  // a position in options, and {kind 'battle', trp, canLose, canEscape, state} with 'win', 'lose', or 'escape'; a missing hook
  // picks the first option and wins. A battle is where Day 150 runs ENGINE_BATTLE and reports the outcome. effect sees
  // every effect the runner returns (text, music, changeMap, and so on), which is what a game draws and plays.
  // The forced events after a move follow the walk's chain exactly (chapterStart on a chapter change, battleEnd after the
  // battles, autoruns on the move's map), because the walk is what proved the story can be finished.
  function hostList(b, ns, prefix) {
    var m = b && b[ns] && (ns === 'rules' ? b.rules[prefix] : isObj(b[ns].records) ? b[ns].records[prefix] : null);
    if (!isObj(m)) return [];
    var out = [], k = keys(m);
    for (var i = 0; i < k.length; i++) if (isObj(m[k[i]])) out.push(m[k[i]]);
    return out;
  }
  function hostGet(b, ns, id) {
    var p = prefixOf(id), m = p && b && b[ns] && isObj(b[ns].records) ? b[ns].records[p] : null;
    return isObj(m) && isObj(m[id]) ? m[id] : null;
  }
  function hostGraph(b) { var g = b && b.world && b.world.progression; return isObj(g) && isArray(g.nodes) && g.nodes.length ? g : null; }
  function hostChapters(b) { var s = b && b.charter && b.charter.sections; return s && isArray(s.chapters) ? s.chapters.filter(isObj) : []; }
  function hostExt(b) {
    var ids = {};
    function add(prefix, list) { var a = ids[prefix] || []; for (var i = 0; i < list.length; i++) a.push(list[i].id); ids[prefix] = a.sort(); }
    add('npc_', hostList(b, 'world', 'npc_')); add('map_', hostList(b, 'world', 'map_'));
    add('trp_', hostList(b, 'rules', 'trp_')); add('itm_', hostList(b, 'rules', 'itm_')); add('eqp_', hostList(b, 'rules', 'eqp_')); add('chr_', hostList(b, 'rules', 'chr_'));
    add('mus_', hostList(b, 'art', 'mus_')); add('sfx_', hostList(b, 'art', 'sfx_')); add('por_', hostList(b, 'art', 'por_'));
    var chapters = [], cl = hostChapters(b);
    for (var c = 0; c < cl.length; c++) if (typeof cl[c].id === 'string') chapters.push(cl[c].id);
    ids.chp_ = chapters.slice().sort();
    var roles = [], ml = hostList(b, 'art', 'mus_');
    for (var m = 0; m < ml.length; m++) if (ml[m].subject && ml[m].subject.kind === 'role' && typeof ml[m].subject.ref === 'string') roles.push(ml[m].subject.ref.replace(/^music:/, ''));
    var g = hostGraph(b);
    return { chapters: chapters, start: g && isArray(g.start) ? g.start.slice() : [], ids: ids, roles: roles.sort() };
  }
  // Sites are Day 148's progression nodes (requires read through the story's bindings) and its regions (a region needs
  // the gate that leads into it). An event stands on its site when that names a site, else on its person's site (talk),
  // else on its map's site. Anything placed nowhere stays open and is listed in unknown.
  function hostWorld(b) {
    var g = hostGraph(b), story = b && isObj(b.story) ? b.story : {}, bind = isObj(story.bindings) ? story.bindings : {};
    var sites = {}, order = [], byRecord = {}, golden = [], chapterOf = {}, unknown = [], i, j;
    function flags(list) {
      var o = [];
      if (isArray(list)) for (var f = 0; f < list.length; f++) { var bd = bind[list[f]]; if (isObj(bd) && typeof bd.flg === 'string' && o.indexOf(bd.flg) < 0) o.push(bd.flg); }
      return o.sort();
    }
    function site(k, req) { if (sites[k] === undefined) order.push(k); sites[k] = { requires: req }; }
    if (g) {
      for (i = 0; i < g.nodes.length; i++) {
        var n = g.nodes[i];
        site(n.key, flags(n.requires));
        chapterOf[n.key] = n.chapter || null;
        if (n.record) byRecord[n.record] = n.key;
        if (n.golden) golden.push(n.key);
      }
      var regions = isArray(g.regions) ? g.regions : [], gates = isArray(g.gates) ? g.gates : [];
      for (i = 0; i < regions.length; i++) {
        var r = regions[i], gate = null;
        for (j = 0; j < gates.length && !gate; j++) if (isObj(gates[j]) && gates[j].to === r.key) gate = gates[j];
        site(r.key, flags(gate ? gate.requires : (r.chapter ? ['chapter:' + r.chapter] : [])));
        chapterOf[r.key] = r.chapter || null;
        if (r.record) byRecord[r.record] = r.key;
      }
    }
    function siteOfRecord(id) {
      if (!id) return null;
      if (byRecord[id]) return byRecord[id];
      var rec = hostGet(b, 'world', id);
      return rec && rec.region && byRecord[rec.region] ? byRecord[rec.region] : null;
    }
    function siteOfMap(m) { var rec = m && hostGet(b, 'world', m); return rec && rec.site ? siteOfRecord(rec.site) : null; }
    var maps = hostList(b, 'world', 'map_'), ow = null, events = {}, npcs = {};
    for (i = 0; i < maps.length && !ow; i++) if (maps[i].kind === 'overworld') ow = maps[i];
    var evm = isObj(story.records) && isObj(story.records.evt_) ? story.records.evt_ : {}, evs = [], ek = keys(evm);
    for (i = 0; i < ek.length; i++) if (isObj(evm[ek[i]])) evs.push(evm[ek[i]]);
    for (i = 0; i < evs.length; i++) {
      var e = evs[i], at = null, why = '';
      if (typeof e.site === 'string' && sites[e.site]) at = e.site;
      else if (e.trigger === 'talk' && e.npc) { var p = hostGet(b, 'world', e.npc); at = p ? siteOfRecord(p.site) : null; why = 'its person stands nowhere on the progression graph'; }
      else if (e.map) { at = siteOfMap(e.map); why = ow && e.map === ow.id ? '' : 'its map belongs to no site on the progression graph'; }
      if (typeof e.site === 'string' && e.site && !sites[e.site]) why = 'its site ' + e.site + ' is not on the progression graph';
      events[e.id] = { site: at };
      if (!at && why && e.trigger !== 'chapterStart' && e.trigger !== 'battleEnd') unknown.push({ kind: 'event', id: e.id, why: why });
    }
    var people = hostList(b, 'world', 'npc_');
    for (i = 0; i < people.length; i++) npcs[people[i].id] = { site: siteOfRecord(people[i].site), map: people[i].map || null };
    var talkers = keys(isObj(story.npcDialogue) ? story.npcDialogue : {});
    for (i = 0; i < talkers.length; i++) {
      if (!npcs[talkers[i]]) unknown.push({ kind: 'npc', id: talkers[i], why: 'this person is not in the world' });
      else if (!npcs[talkers[i]].site) unknown.push({ kind: 'npc', id: talkers[i], why: 'this person stands nowhere on the progression graph' });
    }
    // Golden order: the golden nodes as Day 148 lists them; a region or an optional site takes its chapter's first.
    var pos = {}, firstOf = {};
    for (i = 0; i < golden.length; i++) { pos[golden[i]] = i; var c = chapterOf[golden[i]]; if (c && firstOf[c] === undefined) firstOf[c] = i; }
    for (i = 0; i < order.length; i++) { var k = order[i]; if (pos[k] === undefined && chapterOf[k] && firstOf[chapterOf[k]] !== undefined) pos[k] = firstOf[chapterOf[k]]; }
    return { sites: sites, events: events, npcs: npcs, unknown: unknown, golden: golden, pos: pos };
  }
  // The events by role, each list in the order the host checks them (the walk builds the same lists).
  function hostRoles(idx, W) {
    var R = { voluntary: [], chapterStart: [], battleEnd: [], autoruns: [], talkBy: {}, npcs: [] }, set = {};
    each(idx.events, function (e, id) {
      if (VOLUNTARY[e.trigger]) R.voluntary.push(id);
      if (e.trigger === 'autorun') R.autoruns.push(id);
      if (e.trigger === 'chapterStart') R.chapterStart.push(id);
      if (e.trigger === 'battleEnd') R.battleEnd.push(id);
      if (e.trigger === 'talk' && typeof e.npc === 'string') { (R.talkBy[e.npc] = R.talkBy[e.npc] || []).push(id); set[e.npc] = 1; }
    });
    var order = byPriority(idx);
    R.chapterStart.sort(order); R.battleEnd.sort(order); R.autoruns.sort(order);
    each(R.talkBy, function (list) { list.sort(order); });
    each(idx.npcDialogue, function (p, npc) { set[npc] = 1; });
    each(W.npcs, function (p, npc) { if (R.talkBy[npc] || idx.npcDialogue[npc]) set[npc] = 1; });
    R.npcs = keys(set);
    return R;
  }
  function hostLoad(b) {
    var story = b && isObj(b.story) ? b.story : {}, ext = hostExt(b), W = hostWorld(b);
    var idx = buildIndex({ records: story.records, bindings: story.bindings, npcDialogue: story.npcDialogue }, ext);
    var goal = [], qs = isObj(story.records) && isObj(story.records.qst_) ? story.records.qst_ : {};
    each(qs, function (q, id) { if (isObj(q) && q.kind === 'main' && isArray(q.stages) && q.stages.length && idx.quests[id]) goal.push(id); });
    return { version: S.version, idx: idx, pidx: dlPlayIndex(idx), ext: ext, world: W, goal: goal, roles: hostRoles(idx, W) };
  }
  function hostMapOf(game, mv) {
    if (mv.npc) return npcInfo(game.world, mv.npc).map || null;
    var e = mv.evt && game.idx.events[mv.evt];
    return e && e.map ? e.map : null;
  }
  // What the player may do from a quiet state, in the walk's order: events they can walk into, then people to talk to.
  function hostMoves(game, st) {
    var R = game.roles, W = game.world, idx = game.idx, pidx = game.pidx, out = [], i;
    if (!st || st.run || st.ending) return out;
    for (i = 0; i < R.voluntary.length; i++) {
      var id = R.voluntary[i];
      if (siteOpen(W, evtSite(W, id), st, idx) && pickPage(id, st, pidx) >= 0) out.push({ by: idx.events[id].trigger, evt: id, map: idx.events[id].map || null });
    }
    for (i = 0; i < R.npcs.length; i++) {
      var npc = R.npcs[i], info = npcInfo(W, npc), list = R.talkBy[npc] || [], te = null;
      if (!siteOpen(W, info.site, st, idx)) continue;
      for (var t = 0; t < list.length && !te; t++) if (pickPage(list[t], st, pidx) >= 0) te = list[t];
      if (te) { out.push({ by: 'talk', evt: te, npc: npc, map: info.map || null }); continue; }
      if (dlPick(idx.npcDialogue[npc], st, idx) >= 0) out.push({ by: 'dialogue', npc: npc, map: info.map || null });
    }
    return out;
  }
  function hostCall(hooks, name, a, b2) { return hooks && typeof hooks[name] === 'function' ? hooks[name](a, b2) : undefined; }
  // Drives one run down one path. rec collects {choices [text], battles [{trp, outcome}]} the way the walk records them.
  function hostDrive(game, r, isDlg, hooks, ctx, rec, faults) {
    var pidx = game.pidx, steps = 0;
    while (r) {
      var e = r.effect;
      if (isObj(e) && e.kind === 'error') faults.push({ code: e.code, message: e.message, evt: ctx.evt || null, npc: ctx.npc || null });
      hostCall(hooks, 'effect', copy(e), ctx);
      if (isObj(e) && e.kind === 'gameover') return { state: r.state, gameover: true };
      if (r.done) return { state: r.state };
      if (r.waiting === 'choice') {
        var opts = isObj(e) && isArray(e.options) ? e.options : [], pick = hostCall(hooks, 'decide', { kind: 'choice', options: copy(opts) }, ctx);
        if (pick === undefined && !(hooks && hooks.decide)) pick = 0;
        if (typeof pick !== 'number' || pick < 0 || pick >= opts.length || pick !== Math.floor(pick)) return { state: r.state, error: { code: 'undecided', message: 'No answer for a choice in ' + (ctx.evt || ctx.npc) + '.' } };
        rec.choices.push(opts[pick].text);
        r = isDlg ? dlChoose(r.state, r.cursor, opts[pick].index, pidx) : choose(r.state, opts[pick].index, pidx);
        continue;
      }
      if (r.waiting === 'battle') {
        var w = r.state.run && r.state.run.wait, trp = w && w.trp != null ? w.trp : null;
        var out = hostCall(hooks, 'decide', { kind: 'battle', trp: trp, canLose: !!(isObj(e) && e.canLose), canEscape: !!(isObj(e) && e.canEscape), state: copy(r.state) }, ctx);
        if (out === undefined && !(hooks && hooks.decide)) out = 'win';
        if (out !== 'win' && out !== 'lose' && out !== 'escape') return { state: r.state, error: { code: 'undecided', message: 'No outcome for a battle in ' + (ctx.evt || ctx.npc) + '.' } };
        rec.battles.push({ trp: trp, outcome: out });
        var rr = resolve(r.state, out, pidx);
        r = isDlg ? dlDrive(rr, r.cursor, pidx) : rr;
        continue;
      }
      if (++steps > WALK_STEPS) return { state: r.state, error: { code: 'runaway', message: 'A run took more than ' + WALK_STEPS + ' steps without stopping.' } };
      r = isDlg ? dlStep(r.state, r.cursor, pidx) : step(r.state, pidx);
    }
    return { state: null, error: { code: 'lost', message: 'The run stopped without a state.' } };
  }
  function hostStep(ctx, rec) {
    var s = { by: ctx.by };
    if (ctx.evt) s.evt = ctx.evt;
    if (ctx.npc) s.npc = ctx.npc;
    if (rec.choices.length) s.choices = rec.choices;
    if (rec.battles.length) s.battles = rec.battles;
    return copy(s);
  }
  function hostWon(rec) { var o = []; for (var i = 0; i < rec.battles.length; i++) if (rec.battles[i].trp) o.push(rec.battles[i].trp); return o; }
  // The forced events after a move (or at a new game), the walk's chain followed down the one path the hooks choose.
  function hostChain(game, st, fc, hooks, out) {
    var R = game.roles, idx = game.idx, pidx = game.pidx, W = game.world;
    var queue = fc.queue.slice(), battles = fc.battles.slice(), chapter = fc.chapter, depth = 0;
    for (;;) {
      if (st.ending) return st;
      if (depth > WALK_CHAIN) { out.error = { code: 'chain', message: 'Forced events ran more than ' + WALK_CHAIN + ' times in a row after one move.' }; return st; }
      var next = null, kind = null, i, j;
      if (st.chapter !== chapter) { chapter = st.chapter; for (i = 0; i < R.chapterStart.length; i++) queue.push({ evt: R.chapterStart[i], kind: 'chapterStart' }); }
      if (battles.length) {
        for (i = 0; i < battles.length; i++) for (j = 0; j < R.battleEnd.length; j++) {
          var ev = idx.events[R.battleEnd[j]];
          if (ev.trp == null || ev.trp === battles[i]) queue.push({ evt: R.battleEnd[j], kind: 'battleEnd' });
        }
        battles = [];
      }
      while (!next && queue.length) { var q = queue.shift(); if (pickPage(q.evt, st, pidx) >= 0) { next = q.evt; kind = q.kind; } }
      if (!next && fc.map) for (i = 0; i < R.autoruns.length && !next; i++) {
        var aid = R.autoruns[i];
        if (idx.events[aid].map === fc.map && siteOpen(W, evtSite(W, aid), st, idx) && pickPage(aid, st, pidx) >= 0) { next = aid; kind = 'autorun'; }
      }
      if (!next) return st;
      var ctx = { by: kind, evt: next }, rec = { choices: [], battles: [] };
      if (hostCall(hooks, 'begin', copy(ctx)) === false) { out.error = { code: 'stopped', message: 'The host stopped before ' + next + '.' }; return st; }
      var h0 = hash64(canon(abstractOf(st))), o = hostDrive(game, start(st, next, pidx), false, hooks, ctx, rec, out.faults);
      if (o.error) { out.error = o.error; return o.state || st; }
      out.steps.push(hostStep(ctx, rec));
      if (o.gameover) { out.gameover = true; return o.state; }
      if (kind === 'autorun' && hash64(canon(abstractOf(o.state))) === h0) { out.error = { code: 'autorun-loop', message: 'Autorun ' + next + ' passes again as soon as it ends and changes nothing.' }; return st; }
      st = o.state; battles = hostWon(rec); depth++;
    }
  }
  function hostResult(st, out) {
    return { state: st, steps: out.steps, ending: st && st.ending ? st.ending : null, gameover: !!out.gameover, error: out.error || null, faults: out.faults };
  }
  function hostNew(game, opts, hooks) {
    var out = { steps: [], faults: [] }, st = createState(game.idx, isObj(opts) ? opts : {});
    st = hostChain(game, st, { chapter: null, map: null, battles: [], queue: [] }, hooks, out);
    return hostResult(st, out);
  }
  function hostPlay(game, st, mv, hooks) {
    var out = { steps: [], faults: [] };
    if (!isObj(mv) || (mv.by !== 'dialogue' && !(mv.evt && game.idx.events[mv.evt]))) { out.error = { code: 'move', message: 'That is not a move.' }; return hostResult(st, out); }
    if (st.run || st.ending) { out.error = { code: 'busy', message: st.ending ? 'The game has ended.' : 'An event is running.' }; return hostResult(st, out); }
    var ctx = { by: mv.by }, rec = { choices: [], battles: [] }, map = mv.map !== undefined ? mv.map : hostMapOf(game, mv);
    if (mv.evt) ctx.evt = mv.evt;
    if (mv.npc) ctx.npc = mv.npc;
    if (hostCall(hooks, 'begin', copy(ctx)) === false) { out.error = { code: 'stopped', message: 'The host stopped before the move.' }; return hostResult(st, out); }
    var o = mv.by === 'dialogue' ? hostDrive(game, dlTalk(st, mv.npc, game.pidx), true, hooks, ctx, rec, out.faults) : hostDrive(game, start(st, mv.evt, game.pidx), false, hooks, ctx, rec, out.faults);
    if (o.error) { out.error = o.error; return hostResult(o.state || st, out); }
    out.steps.push(hostStep(ctx, rec));
    if (o.gameover) { out.gameover = true; return hostResult(o.state, out); }
    var after = hostChain(game, o.state, { chapter: st.chapter, map: map || null, battles: hostWon(rec), queue: [] }, hooks, out);
    return hostResult(after, out);
  }
  var FORCED = { chapterStart: 1, battleEnd: 1 };
  // Plays a walk path step by step: each move must be one moves() offers, every run must start where the path says, and
  // every choice and battle is answered from the path. opts {effect, battle} observe without deciding; opts.state starts
  // from a quiet state (a loaded save) instead of a new game. Returns {ok, state, ending, hash, played, steps, error, faults}.
  function hostReplay(game, path, opts) {
    opts = isObj(opts) ? opts : {};
    var list = [], cur = 0, active = null, ci = 0, bi = 0, fail = null, faults = [], seen = [], st, i;
    if (isArray(path)) for (i = 0; i < path.length; i++) if (isObj(path[i]) && path[i].by !== 'newGame') list.push(path[i]);
    var hooks = {
      begin: function (ctx) {
        var s = list[cur];
        if (!s || s.by !== ctx.by || (s.evt || null) !== (ctx.evt || null) || (s.npc || null) !== (ctx.npc || null)) {
          fail = fail || { code: 'diverged', at: cur, message: 'Step ' + (cur + 1) + ' should be ' + (s ? s.by + ' ' + (s.evt || s.npc) : 'the end') + ', but the game ran ' + ctx.by + ' ' + (ctx.evt || ctx.npc) + '.' };
          return false;
        }
        active = s; cur++; ci = 0; bi = 0;
        return true;
      },
      decide: function (q, ctx) {
        if (q.kind === 'choice') {
          var want = active && isArray(active.choices) ? active.choices[ci++] : undefined;
          for (var k = 0; k < q.options.length; k++) if (q.options[k].text === want) return k;
          fail = fail || { code: 'choice', at: cur - 1, message: 'No option "' + want + '" in ' + (ctx.evt || ctx.npc) + '.' };
          return -1;
        }
        var b2 = active && isArray(active.battles) ? active.battles[bi++] : null;
        if (typeof opts.battle === 'function') opts.battle(copy(q), ctx);
        if (!isObj(b2) || (b2.trp || null) !== (q.trp || null)) { fail = fail || { code: 'battle', at: cur - 1, message: 'Battle ' + q.trp + ' is not the one the path fought.' }; return null; }
        return b2.outcome;
      },
      effect: function (e, ctx) { if (typeof opts.effect === 'function') opts.effect(e, ctx); }
    };
    function take(r) { for (var f = 0; f < r.faults.length; f++) faults.push(r.faults[f]); for (var s = 0; s < r.steps.length; s++) seen.push(r.steps[s]); if (r.error && !fail) fail = r.error; if (r.gameover && !fail) fail = { code: 'gameover', at: cur - 1, message: 'The path lost a battle with no lose list.' }; }
    if (isObj(opts.state)) st = copy(opts.state);
    else { var r0 = hostNew(game, {}, hooks); take(r0); st = r0.state; }
    while (!fail && cur < list.length) {
      var s = list[cur], mv = null, avail = hostMoves(game, st);
      if (FORCED[s.by]) { fail = { code: 'diverged', at: cur, message: 'Step ' + (cur + 1) + ' is a forced ' + s.by + ' event, but no move led to it.' }; break; }
      for (i = 0; i < avail.length && !mv; i++) if (avail[i].by === s.by && (avail[i].evt || null) === (s.evt || null) && (avail[i].npc || null) === (s.npc || null)) mv = avail[i];
      if (!mv) { fail = { code: 'unavailable', at: cur, message: 'Step ' + (cur + 1) + ' (' + s.by + ' ' + (s.evt || s.npc) + ') is not a move the player can make here.' }; break; }
      var r = hostPlay(game, st, mv, hooks);
      take(r); st = r.state;
    }
    // Comparing what ran with the path itself checks the recorded choices and battles too, not just the starts.
    if (!fail && canon(seen) !== canon(list)) fail = { code: 'record', at: cur, message: 'The game ran the path\'s steps but recorded different choices or battles.' };
    return { ok: !fail, state: st, ending: st && st.ending ? st.ending : null, hash: st ? hash64(canon(abstractOf(st))) : null, played: cur, steps: list.length, error: fail, faults: faults };
  }
  S.host = { ext: hostExt, world: hostWorld, load: hostLoad, newGame: hostNew, moves: hostMoves, play: hostPlay, replay: hostReplay,
    hash: function (st) { return hash64(canon(abstractOf(st))); } };
