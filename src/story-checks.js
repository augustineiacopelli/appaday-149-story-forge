// === STORY:CHECKS BEGIN ===
(function () {
  'use strict';
  // Phase 7: validation and the reachability proof. Six checks, each a card on the Validation tab:
  //   references  every story record's references resolve, every gate key is bound, every condition and command passes
  //               lint (all through Kit.validate and the story validators), the side quest flags resolve, every event
  //               and person stands somewhere the walk can place, and the world is the one the story was built on;
  //   smells      a choice that changes nothing, a dialogue node nobody ever sees, an event page or person's page that
  //               never wins, a flag set but never read, a flag read but never set, a quest stage with no way out;
  //   walk        ENGINE_STORY.walk over abstract story states: what it explored, any runtime error a playthrough meets,
  //               an autorun that would loop, and the cap, which is reported by name and is never a silent pass;
  //   proofs      every chapter entered, every main quest completed, every gate flag set by something that stands no
  //               later in golden order than the first place that needs it, every ending reached, every side quest
  //               completed in some playthrough;
  //   softlock    from every state a playthrough can reach, an ending is still reachable (reverse reachability over the
  //               explored graph), each failure reported with the path that leads into it;
  //   floor       the chapters' target minutes reach the 720 minute floor (side and B story minutes never count).
  // Final export is refused while any card has an error, while the world differs from the one the story was stamped on,
  // and while any reference is unresolved.
  // DECISION, the world stamp: story.settings.worldHash records the 64 bit hash of the world namespace each time a scaffold
  // (quests, dialogue, events, endings) builds from it. A world regenerated in Day 148 after the story was written no
  // longer matches, and Final waits until the story is rebuilt on it or the author confirms it on the Validation tab.
  var U = Kit.util, ES = ENGINE_STORY, F = STORY.flags, Q = STORY.quests, E = STORY.events, X = STORY.ends;
  function cur() { return Kit.bundle.current(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function nameOf(id, fb) { return STORY.nameOf ? STORY.nameOf(id, fb) : (fb || id || ''); }
  var C = STORY.checks = {};
  C.CARDS = [
    { key: 'references', title: 'References', lead: 'Every reference resolves, every gate key is bound, and every condition and command passes lint.' },
    { key: 'smells', title: 'Story smells', lead: 'Things that work but are probably not what you meant. Warnings only.' },
    { key: 'walk', title: 'The walk', lead: 'Every playthrough the story allows, explored state by state.' },
    { key: 'proofs', title: 'The proofs', lead: 'Every chapter, main quest, gate, ending, and side quest is reachable.' },
    { key: 'softlock', title: 'No softlock', lead: 'From every state a player can reach, an ending is still reachable.' },
    { key: 'floor', title: 'The 12 hour floor', lead: 'The chapters reach the playtime floor. Optional quests never count toward it.' }
  ];

  // ---------------------------------------------------------------- the world stamp
  var whCache = { b: null, key: null, hash: null };
  C.worldHash = function (b) {
    b = b || cur();
    if (!b || !U.isObj(b.world)) return null;
    var key = b === cur() ? Kit.index(b) : null;
    if (key && whCache.b === b && whCache.key === key) return whCache.hash;
    var h = ES.walk.hash(ES.util.canon(b.world));
    if (key) whCache = { b: b, key: key, hash: h };
    return h;
  };
  C.stamped = function (b) { b = b || cur(); var s = b && b.story && b.story.settings; return s && typeof s.worldHash === 'string' ? s.worldHash : null; };
  C.worldCurrent = function (b) { b = b || cur(); var s = C.stamped(b); return !!s && s === C.worldHash(b); };
  // Records the current world as the one the story stands on. Touches the bundle only when the stamp changes.
  C.stamp = function (b) {
    b = b || cur();
    if (!b || !U.isObj(b.story) || !U.isObj(b.world)) return false;
    STORY.ensure(b);
    var h = C.worldHash(b);
    if (!h || b.story.settings.worldHash === h) return false;
    b.story.settings.worldHash = h;
    if (b === cur()) Kit.bundle.touch('story-checks');
    return true;
  };
  // Every scaffold stamps the world it built from.
  function stamping(obj) {
    if (!obj || typeof obj.scaffold !== 'function' || obj.scaffold.stamps) return;
    var raw = obj.scaffold;
    obj.scaffold = function (b) { var rep = raw.apply(this, arguments); var bb = b || cur(); if (rep && !rep.skipped && STORY.readiness(bb) === true) C.stamp(bb); return rep; };
    obj.scaffold.stamps = true;
  }
  [Q, STORY.dialogue, E, X].forEach(stamping);

  // ---------------------------------------------------------------- the world as the walk sees it
  // {sites {siteKey: {requires [flg]}}, events {evt: {site}}, npcs {npc: {site, map}}, unknown [{kind, id, why}]}.
  // Sites are Day 148's progression nodes (requires lists its gate keys, read through the story's bindings) and its
  // regions (a region needs the gate that leads into it). An event stands on its site field when that names a node or a
  // region, else on the site of its map, else on its person's site. A record the world places nowhere stays open and is
  // listed in unknown, so the References card can say so.
  C.walkWorld = function (b) {
    b = b || cur();
    var g = STORY.world.graph(b), bind = b.story.bindings || {}, sites = {}, byRecord = {}, golden = [], chapterOf = {}, unknown = [];
    function flags(list) { var o = []; (list || []).forEach(function (k) { var bd = bind[k]; if (U.isObj(bd) && typeof bd.flg === 'string' && o.indexOf(bd.flg) < 0) o.push(bd.flg); }); return o.sort(); }
    if (g) {
      g.nodes.forEach(function (n) {
        sites[n.key] = { requires: flags(n.requires) };
        chapterOf[n.key] = n.chapter || null;
        if (n.record) byRecord[n.record] = n.key;
        if (n.golden) golden.push(n.key);
      });
      (g.regions || []).forEach(function (r) {
        var gate = (g.gates || []).filter(function (x) { return U.isObj(x) && x.to === r.key; })[0];
        sites[r.key] = { requires: flags(gate ? gate.requires : (r.chapter ? ['chapter:' + r.chapter] : [])) };
        chapterOf[r.key] = r.chapter || null;
        if (r.record) byRecord[r.record] = r.key;
      });
    }
    function siteOfRecord(id) {
      if (!id) return null;
      if (byRecord[id]) return byRecord[id];
      var rec = STORY.world.get(id, b);
      return rec && rec.region && byRecord[rec.region] ? byRecord[rec.region] : null;
    }
    function siteOfMap(m) { var rec = m && STORY.world.get(m, b); return rec && rec.site ? siteOfRecord(rec.site) : null; }
    var ow = STORY.world.overworld(b), events = {}, npcs = {};
    STORY.records.list('evt_', b).forEach(function (e) {
      var site = null, why = '';
      if (typeof e.site === 'string' && sites[e.site]) site = e.site;
      else if (e.trigger === 'talk' && e.npc) { var p = STORY.world.get(e.npc, b); site = p ? siteOfRecord(p.site) : null; why = 'its person stands nowhere on the progression graph'; }
      else if (e.map) { site = siteOfMap(e.map); why = ow && e.map === ow.id ? '' : 'its map belongs to no site on the progression graph'; }
      if (typeof e.site === 'string' && e.site && !sites[e.site]) why = 'its site ' + e.site + ' is not on the progression graph';
      events[e.id] = { site: site };
      if (!site && why && e.trigger !== 'chapterStart' && e.trigger !== 'battleEnd') unknown.push({ kind: 'event', id: e.id, why: why });
    });
    STORY.world.list('npc_', b).forEach(function (n) {
      var site = siteOfRecord(n.site);
      npcs[n.id] = { site: site, map: n.map || null };
    });
    Object.keys(b.story.npcDialogue || {}).sort().forEach(function (npc) {
      if (!npcs[npc]) unknown.push({ kind: 'npc', id: npc, why: 'this person is not in the world' });
      else if (!npcs[npc].site) unknown.push({ kind: 'npc', id: npc, why: 'this person stands nowhere on the progression graph' });
    });
    // Golden order: the golden nodes as Day 148 lists them. A region or an optional site takes the place of its chapter's
    // first golden node.
    var pos = {}, firstOf = {};
    golden.forEach(function (k, i) { pos[k] = i; var c = chapterOf[k]; if (c && firstOf[c] === undefined) firstOf[c] = i; });
    Object.keys(sites).forEach(function (k) { if (pos[k] === undefined && chapterOf[k] && firstOf[chapterOf[k]] !== undefined) pos[k] = firstOf[chapterOf[k]]; });
    return { sites: sites, events: events, npcs: npcs, unknown: unknown, golden: golden, pos: pos };
  };

  // ---------------------------------------------------------------- the walk
  function mainQuests(b) { return Q.list(b).filter(function (q) { return q.kind === 'main' && Array.isArray(q.stages) && q.stages.length; }); }
  var walkCache = { b: null, key: null, out: null };
  // {world, result, ms}. Memoized per bundle on KIT:CORE's index identity, so any edit runs it again.
  C.walk = function (b) {
    b = b || cur();
    var key = b === cur() ? Kit.index(b) : null;
    if (key && walkCache.b === b && walkCache.key === key) return walkCache.out;
    var W = C.walkWorld(b), idx = STORY.engineIndex(b), cap = Number(b.story.settings.walkCap) || ES.walk.CAP, t0 = Date.now();
    var res = ES.walk.run(idx, { sites: W.sites, events: W.events, npcs: W.npcs }, { cap: cap, goal: mainQuests(b).map(function (q) { return q.id; }) });
    var out = { world: W, result: res, ms: Date.now() - t0 };
    if (key) walkCache = { b: b, key: key, out: out };
    return out;
  };

  // ---------------------------------------------------------------- reading a path
  // One step of a walk path in words, for the cards and the tests.
  C.stepText = function (s) {
    if (!U.isObj(s)) return '';
    var what;
    switch (s.by) {
      case 'newGame': return 'A new game starts';
      case 'talk': what = 'Talk to ' + nameOf(s.npc, s.npc); break;
      case 'dialogue': what = 'Talk to ' + nameOf(s.npc, s.npc); break;
      case 'step': what = 'Step on ' + nameOf(s.evt, s.evt); break;
      case 'mapEnter': what = 'Enter ' + nameOf(s.evt, s.evt); break;
      case 'autorun': what = nameOf(s.evt, s.evt) + ' runs'; break;
      case 'chapterStart': what = nameOf(s.evt, s.evt) + ' plays'; break;
      case 'battleEnd': what = nameOf(s.evt, s.evt) + ' follows the battle'; break;
      default: what = nameOf(s.evt || s.npc, s.evt || s.npc || s.by);
    }
    if (Array.isArray(s.choices) && s.choices.length) what += ', choosing ' + s.choices.map(function (c) { return '"' + c + '"'; }).join(' then ');
    if (Array.isArray(s.battles) && s.battles.length) what += ', ' + s.battles.map(function (x) { return x.outcome === 'win' ? 'winning' : x.outcome === 'lose' ? 'losing' : 'escaping'; }).join(' then ');
    return what;
  };
  C.pathText = function (path) { return (path || []).filter(function (s) { return s.by !== 'newGame'; }).map(C.stepText); };

  // ---------------------------------------------------------------- static readings for the smells
  var INERT = { face: 1, fade: 1, gil: 1, moveActor: 1, music: 1, party: 1, sfx: 1, text: 1, vehicle: 1, wait: 1, changeMap: 1 };
  function inertList(list) {
    var ok = true;
    if (!Array.isArray(list)) return true;
    ES.cmd.walk(list, function (c) { if (U.isObj(c) && !INERT[c.op] && c.op !== 'if' && c.op !== 'choice') ok = false; });
    return ok;
  }
  // Every command list a story can run, with where it lives: [{recordId, fieldPath, cmds, dlg, node}].
  function allLists(b) {
    var out = [];
    STORY.records.list('evt_', b).forEach(function (e) { (e.pages || []).forEach(function (p, i) { if (U.isObj(p) && Array.isArray(p.cmds)) out.push({ recordId: e.id, fieldPath: 'pages[' + i + ']', cmds: p.cmds }); }); });
    STORY.records.list('dlg_', b).forEach(function (d) {
      Object.keys(U.isObj(d.nodes) ? d.nodes : {}).sort().forEach(function (k) { var c = ES.dlg.compile(d, k); if (c) out.push({ recordId: d.id, fieldPath: 'nodes.' + k, cmds: c.cmds, dlg: d, node: k }); });
    });
    return out;
  }

  // ---------------------------------------------------------------- the six checks
  function card(key) { var c = C.CARDS.filter(function (x) { return x.key === key; })[0]; return { key: key, title: c.title, lead: c.lead, items: [], facts: [] }; }
  function item(cd, level, code, message, where) {
    var it = { level: level, code: code, message: message };
    Object.keys(where || {}).forEach(function (k) { if (where[k] !== undefined && where[k] !== null) it[k] = where[k]; });
    cd.items.push(it);
  }
  function pathOf(w) { return w && Array.isArray(w.path) ? C.pathText(w.path) : []; }

  function references(b, run, cd) {
    var res = Kit.validate(b), mine = function (x) { return x.recordId === 'story' || STORY.PREFIXES.indexOf(Kit.ids.prefixOf(x.recordId)) >= 0; };
    res.errors.filter(mine).forEach(function (x) { item(cd, 'error', 'lint', x.message, { recordId: x.recordId, fieldPath: x.fieldPath }); });
    res.broken.filter(mine).forEach(function (x) { item(cd, 'error', 'broken', x.message, { recordId: x.recordId, fieldPath: x.fieldPath }); });
    // Every ID a story record names, wherever it sits (conditions and commands included), must resolve.
    var idx = Kit.index(b), own = {}, bad = {};
    STORY.PREFIXES.forEach(function (p) { Object.keys(b.story.records[p] || {}).forEach(function (id) { own[id] = 1; }); });
    function scan(node, rid, depth) {
      if (depth > 24 || node == null) return;
      if (typeof node === 'string') { if (/^[a-z]{3}_[a-z0-9_]*[a-z0-9]$/.test(node) && Kit.ids.isValid(node) && !own[node] && !idx.byId[node] && !bad[node]) bad[node] = rid; return; }
      if (typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(function (x) { scan(x, rid, depth + 1); }); return; }
      Object.keys(node).sort().forEach(function (k) { if (k !== 'id') scan(node[k], rid, depth + 1); });
    }
    STORY.PREFIXES.forEach(function (p) { Object.keys(b.story.records[p] || {}).sort().forEach(function (id) { scan(b.story.records[p][id], id, 0); }); });
    ['bindings', 'npcDialogue'].forEach(function (k) { scan(b.story[k], 'story', 0); });
    Object.keys(bad).sort().forEach(function (id) { item(cd, 'error', 'unresolved', id + ' does not resolve to any record.', { recordId: bad[id] }); });
    STORY.forwardRefs(b).filter(function (f) { return !f.ok; }).forEach(function (f) { item(cd, 'error', 'forward', 'Side quest ' + nameOf(f.recordId, f.recordId) + ' names completion flag ' + f.id + ', which is not a story flag.', { recordId: f.recordId, tab: 'flags' }); });
    run.world.unknown.forEach(function (u) { item(cd, 'warning', 'site', nameOf(u.id, u.id) + ' cannot be placed: ' + u.why + '. The walk treats it as always reachable.', u.kind === 'npc' ? { npc: u.id } : { recordId: u.id }); });
    var stamp = C.stamped(b), now = C.worldHash(b);
    if (!stamp) item(cd, 'error', 'world-unstamped', 'The story has no record of the world it was built on. Rebuild it from the Quests, Dialogue, or Events tab, or confirm this world below.', { action: 'stamp' });
    else if (stamp !== now) item(cd, 'error', 'world-changed', 'The world changed since the story was built on it (Day 148 regenerated it). Rebuild the quests, dialogue, and events on this world, or confirm it below once you have checked them.', { action: 'stamp' });
    cd.facts.push(['World hash', now ? now : 'none'], ['Story built on', stamp ? (stamp === now ? 'this world' : stamp) : 'not recorded'], ['Story records', String(STORY.count(b))]);
  }

  function smells(b, run, cd) {
    var R = run.result, capped = R.stats.capped, never = capped ? 'before the walk reached its cap' : 'in any playthrough';
    // A choice that changes nothing.
    allLists(b).forEach(function (L) {
      ES.cmd.walk(L.cmds, function (c, p, pt) {
        if (!U.isObj(c) || c.op !== 'choice' || !Array.isArray(c.options) || c.options.length < 2) return;
        if (!c.options.every(function (o) { return !U.isObj(o) || inertList(o.cmds); })) return;
        if (L.dlg) {
          var n = L.dlg.nodes[L.node], nexts = (n.choices || []).map(function (ch) { return U.isObj(ch) && ch.next ? ch.next : ''; });
          if (nexts.some(function (x) { return x !== nexts[0]; })) return;
        }
        item(cd, 'warning', 'inert-choice', 'This choice changes nothing, whichever option is picked' + (L.dlg ? ' (every option leads to the same place)' : '') + '.', { recordId: L.recordId, fieldPath: L.fieldPath });
      });
    });
    // Dialogue nobody opens, and nodes nobody sees.
    // A dialogue opens at its start node or at the node a page names (Phase 4), so every entry counts as a way in.
    var opened = {};
    Object.keys(b.story.npcDialogue || {}).forEach(function (npc) { (b.story.npcDialogue[npc] || []).forEach(function (p) { if (U.isObj(p) && p.dlg) { (opened[p.dlg] = opened[p.dlg] || {})[typeof p.node === 'string' && p.node ? p.node : ''] = 1; } }); });
    STORY.records.list('dlg_', b).forEach(function (d) {
      if (!opened[d.id]) { item(cd, 'warning', 'unused-dialogue', 'No person\'s page opens this dialogue, so nobody ever says it.', { recordId: d.id }); return; }
      var reach = {};
      Object.keys(opened[d.id]).forEach(function (entry) { ES.dlg.reach(entry ? { nodes: d.nodes, start: entry } : d).order.forEach(function (k) { reach[k] = 1; }); });
      var stat = Object.keys(U.isObj(d.nodes) ? d.nodes : {}).sort().filter(function (k) { return !reach[k]; });
      stat.forEach(function (k) { item(cd, 'warning', 'unreachable-node', 'Nothing leads to node ' + k + '.', { recordId: d.id, fieldPath: 'nodes.' + k }); });
      Object.keys(U.isObj(d.nodes) ? d.nodes : {}).sort().forEach(function (k) {
        if (stat.indexOf(k) >= 0 || R.dialogueNodes[d.id + '#' + k]) return;
        item(cd, 'warning', 'unseen-node', 'Node ' + k + ' is never seen ' + never + ': the page that opens it never wins, or the choice that leads to it never shows.', { recordId: d.id, fieldPath: 'nodes.' + k });
      });
    });
    // Pages that never win.
    STORY.records.list('evt_', b).forEach(function (e) {
      (e.pages || []).forEach(function (p, i) {
        if (R.pages[e.id + '#' + i]) return;
        item(cd, 'warning', 'page-never-wins', 'Page ' + (i + 1) + ' never runs ' + never + '.', { recordId: e.id, fieldPath: 'pages[' + i + ']' });
      });
    });
    Object.keys(b.story.npcDialogue || {}).sort().forEach(function (npc) {
      (b.story.npcDialogue[npc] || []).forEach(function (p, i) {
        if (R.npcPages[npc + '#' + i]) return;
        item(cd, 'warning', 'npc-page-never-wins', nameOf(npc, npc) + ': page ' + (i + 1) + ' never wins ' + never + '.', { npc: npc, recordId: U.isObj(p) ? p.dlg : null });
      });
    });
    // Flags set but never read, and read but never set. The world's grants describe the world, not the story, so they
    // do not count as setting a flag; a new game's open gates do. Quest completion flags are outputs for Day 146 and
    // Day 150, so nothing in the story needs to read them. Gate flags are left to the proofs.
    var xr = F.xref(b), gateFlags = {}, outputs = {};
    Object.keys(b.story.bindings || {}).forEach(function (k) { var bd = b.story.bindings[k]; if (U.isObj(bd) && bd.flg) gateFlags[bd.flg] = 1; });
    STORY.records.list('qst_', b).forEach(function (q) { if (q.completeFlag) outputs[q.completeFlag] = 1; });
    STORY.rules('sdq_', b).forEach(function (q) { if (q.flag) outputs[q.flag] = 1; });
    STORY.records.list('flg_', b).forEach(function (f) {
      if (f.derived || gateFlags[f.id]) return;
      var x = xr[f.id] || { reads: [], sets: [] }, sets = x.sets.filter(function (s) { return !(s.kind === 'world' && s.where === 'grants'); });
      if (sets.length && !x.reads.length && !outputs[f.id]) item(cd, 'warning', 'set-never-read', 'This flag is set but nothing reads it.', { recordId: f.id });
      if (x.reads.length && !sets.length) item(cd, 'warning', 'read-never-set', 'Something reads this flag but nothing ever sets it, so it stays at ' + (F.isInt(f['default']) ? f['default'] : 0) + '.', { recordId: f.id });
    });
    // Quest stages with no way out: not the last stage, no exit condition, and no command anywhere moves the quest past it.
    var moves = {};
    allLists(b).forEach(function (L) { var r = ES.cmd.refs(L.cmds); Object.keys(r.quests).forEach(function (q) { (moves[q] = moves[q] || {}); r.quests[q].forEach(function (s) { moves[q][s] = 1; }); }); });
    STORY.records.list('qst_', b).forEach(function (q) {
      var st = Array.isArray(q.stages) ? q.stages : [];
      st.forEach(function (s, i) {
        if (i === st.length - 1 || !U.isObj(s) || s.exitWhen) return;
        var out = false;
        for (var j = i + 1; j < st.length && !out; j++) if (moves[q.id] && moves[q.id][st[j].key]) out = true;
        if (!out) item(cd, 'warning', 'stage-no-exit', 'Stage ' + (s.label || s.key) + ' has no exit condition and nothing moves the quest past it.', { recordId: q.id, fieldPath: 'stages[' + i + ']' });
      });
    });
  }

  function walkCard(b, run, cd) {
    var R = run.result, S = R.stats;
    if (S.capped) item(cd, 'warning', 'cap', 'The walk stopped at its cap of ' + S.cap + ' states (story.settings.walkCap). States past it were not explored, so the proofs below cover only what was reached.', {});
    R.errors.forEach(function (e) {
      var level = e.code === 'fork-cap' || e.code === 'chain' ? 'warning' : 'error';
      item(cd, level, 'run-' + e.code, (e.evt ? nameOf(e.evt, e.evt) + ': ' : e.npc ? nameOf(e.npc, e.npc) + ': ' : '') + e.message, { recordId: e.evt || e.dlg || null, npc: e.evt ? null : e.npc, path: C.pathText(e.path) });
    });
    cd.facts.push(['States', String(S.states) + (S.capped ? ' (cap ' + S.cap + ')' : '')], ['Moves between them', String(S.edges)], ['Longest shortest path', plural(S.maxDepth, 'move')],
      ['Runs played', String(S.runs)], ['Moves that change nothing', String(S.selfLoops)], ['Game overs (reloads)', String(S.gameovers)], ['Time', run.ms + ' ms']);
  }

  function proofs(b, run, cd) {
    var R = run.result, W = run.world, capped = R.stats.capped, why = capped ? ' before the walk reached its cap' : '';
    var chs = STORY.chapters(b), mains = mainQuests(b), mainOf = {};
    mains.forEach(function (q) { mainOf[q.chapter] = q; });
    chs.forEach(function (c, i) {
      if (R.chapters[c.id]) return;
      var q = mainOf[c.id];
      item(cd, 'error', 'chapter', 'Chapter ' + (i + 1) + ', ' + (c.name || c.id) + ', is never entered' + why + '. Its chapter gate flag is never set.', q ? { recordId: q.id } : { recordId: 'story', fieldPath: 'bindings' });
    });
    mains.forEach(function (q) { if (!R.questsDone[q.id]) item(cd, 'error', 'main-quest', 'Main quest ' + (q.name || q.id) + ' never completes' + why + '.', { recordId: q.id }); });
    if (!mains.length && chs.length) item(cd, 'error', 'no-main', 'The story has no main quests. Build them on the Quests tab.', { tab: 'quests' });
    // Gate flags, in golden order. Every gate a new game does not open must be set by something, and that something must
    // stand no later on the golden path than the first place that needs the gate.
    var g = STORY.world.graph(b), start = g && Array.isArray(g.start) ? g.start : [], order = [];
    if (g) {
      var firstReader = {};
      W.golden.forEach(function (k) { var n = g.nodes.filter(function (x) { return x.key === k; })[0]; (n && n.requires || []).forEach(function (gk) { if (firstReader[gk] === undefined) firstReader[gk] = k; }); });
      STORY.world.gateKeys(b).forEach(function (k) {
        var bd = b.story.bindings[k], flg = U.isObj(bd) ? bd.flg : null;
        if (!flg || start.indexOf(k) >= 0) return;
        var set = R.setters[flg], reader = firstReader[k] || null, row = { key: k, flg: flg, reader: reader, setter: set || null, site: null };
        order.push(row);
        if (!R.flags[flg] || !set) { item(cd, 'error', 'gate-never', 'Gate ' + k + ' never opens' + why + ': nothing in the story sets ' + nameOf(flg, flg) + '.', { recordId: flg }); return; }
        var site = set.evt ? (W.events[set.evt] || {}).site : set.npc ? (W.npcs[set.npc] || {}).site : null;
        row.site = site || null;
        if (site && reader && W.pos[site] !== undefined && W.pos[reader] !== undefined && W.pos[site] > W.pos[reader]) {
          item(cd, 'error', 'gate-order', 'Gate ' + k + ' is first needed at ' + reader + ', but the story opens it at ' + site + ', later on the golden path.', set.evt ? { recordId: set.evt } : { npc: set.npc });
        }
      });
    }
    STORY.records.list('end_', b).forEach(function (e) {
      if (!R.endings[e.id]) item(cd, 'error', 'ending', 'Ending ' + (e.name || e.id) + ' is never reached' + why + '.', { recordId: e.id });
    });
    if (!STORY.records.list('end_', b).length) item(cd, 'error', 'no-endings', 'The story has no endings. Build them on the Start tab.', { tab: 'start' });
    Q.list(b).forEach(function (q) {
      if (q.kind !== 'side' && q.kind !== 'bstory') return;
      if (!R.questsDone[q.id]) item(cd, q.kind === 'side' ? 'error' : 'warning', q.kind === 'side' ? 'side-quest' : 'bstory', (q.kind === 'side' ? 'Side quest ' : 'B story ') + (q.name || q.id) + ' never completes in any playthrough' + why + '.', { recordId: q.id });
    });
    mains.forEach(function (q) {
      var w = R.endedWithout[q.id];
      if (w && R.questsDone[q.id]) item(cd, 'warning', 'skippable', 'A playthrough can reach an ending without finishing ' + (q.name || q.id) + '.', { recordId: q.id, path: pathOf(w) });
    });
    if (R.golden && !R.goldenFull && mains.length && mains.every(function (q) { return R.questsDone[q.id]; })) item(cd, 'warning', 'golden-partial', 'Every main quest can be finished, but no single playthrough finishes all of them and then reaches an ending.', { tab: 'quests' });
    cd.gates = order;
    cd.facts.push(['Chapters entered', Object.keys(R.chapters).length + ' of ' + chs.length], ['Main quests completed', mains.filter(function (q) { return R.questsDone[q.id]; }).length + ' of ' + mains.length],
      ['Endings reached', Object.keys(R.endings).length + ' of ' + STORY.records.list('end_', b).length], ['Golden path', R.golden ? plural(C.pathText(R.golden.path).length, 'step') + (R.goldenFull ? ', every main quest done' : '') : 'none']);
  }

  function softlock(b, run, cd) {
    var R = run.result, L = R.softlock;
    if (R.stats.capped) item(cd, 'warning', 'cap', 'States past the cap were not explored, so they count as able to finish. Raise the cap to prove them too.', {});
    if (!Object.keys(R.endings).length && L.deepest) {
      item(cd, 'error', 'no-finish', 'No playthrough reaches any ending. Progress stops here.', { path: pathOf(L.deepest), quests: questsText(L.deepest) });
    } else L.reported.forEach(function (w) {
      item(cd, 'error', 'softlock', (w.deadEnd ? 'A dead end: nothing more can happen' : 'A trap: play goes on, but no ending can be reached any more') + ' after this path.', { path: pathOf(w), quests: questsText(w) });
    });
    var unreported = L.entries - L.reported.length;
    if (unreported > 0) item(cd, 'error', 'softlock-more', unreported + ' more ways into a state with no ending (' + L.count + ' stuck states in all).', {});
    cd.facts.push(['Stuck states', String(L.count)], ['Ways in', String(L.entries)], ['Dead ends', String(L.deadEnds)]);
  }
  function questsText(w) { var q = w && w.quests ? w.quests : {}; return Object.keys(q).sort().map(function (k) { return nameOf(k, k) + ': ' + q[k]; }); }

  function floor(b, run, cd) {
    var p = X.playtime(b);
    if (!p.meets) item(cd, 'error', 'floor', 'The chapters add up to ' + p.main + ' minutes, short of the ' + p.floor + ' minute floor by ' + p.short + '. Raise chapter target minutes in Saga Forge (Day 146).', { tab: 'start' });
    cd.facts.push(['Main story', p.main + ' of ' + p.floor + ' minutes (' + (p.main / 60).toFixed(1) + ' hours)'], ['Side quests', p.side.minutes + ' minutes, not counted'], ['B stories', p.bstory.minutes + ' minutes, not counted']);
  }

  // ---------------------------------------------------------------- running them
  var runCache = { b: null, key: null, out: null };
  // {cards [{key, title, lead, status pass|warn|fail, errors, warnings, items, facts}], errors, warnings, run}. Memoized
  // like the walk. Cards whose input is missing (no world yet) say so instead of running.
  C.run = function (b) {
    b = b || cur();
    var key = b === cur() ? Kit.index(b) : null;
    if (key && runCache.b === b && runCache.key === key) return runCache.out;
    STORY.ensure(b);
    var ready = STORY.readiness(b), cards = C.CARDS.map(function (c) { return card(c.key); }), by = {}, run = null;
    cards.forEach(function (c) { by[c.key] = c; });
    if (ready !== true) cards.forEach(function (c) { item(c, 'error', 'not-ready', ready, {}); });
    else {
      run = C.walk(b);
      references(b, run, by.references); smells(b, run, by.smells); walkCard(b, run, by.walk); proofs(b, run, by.proofs); softlock(b, run, by.softlock); floor(b, run, by.floor);
    }
    var errors = 0, warnings = 0;
    cards.forEach(function (c) {
      c.errors = c.items.filter(function (x) { return x.level === 'error'; }).length;
      c.warnings = c.items.length - c.errors;
      c.status = c.errors ? 'fail' : c.warnings ? 'warn' : 'pass';
      c.items.sort(function (x, z) { return (x.level === 'error' ? 0 : 1) - (z.level === 'error' ? 0 : 1); });
      errors += c.errors; warnings += c.warnings;
    });
    var out = { cards: cards, errors: errors, warnings: warnings, run: run };
    if (key) runCache = { b: b, key: key, out: out };
    return out;
  };
  // True when the checks for this bundle's current state are already worked out (the tab draws at once, else it waits).
  C.ready = function (b) { b = b || cur(); return !!b && runCache.b === b && runCache.key === Kit.index(b); };
  // Forgets the memoized results, so the next read walks again.
  C.invalidate = function () { runCache = { b: null, key: null, out: null }; walkCache = { b: null, key: null, out: null }; };
  // Why Final is refused, or '' when the story is proven.
  C.finalBlock = function (b) {
    b = b || cur();
    var r = C.run(b), bad = r.cards.filter(function (c) { return c.errors; });
    if (!bad.length) return '';
    var firstErr = bad[0].items.filter(function (x) { return x.level === 'error'; })[0];
    return 'Final export is blocked: ' + plural(r.errors, 'story check') + ' fail' + (r.errors === 1 ? 's' : '') + ' (' + bad.map(function (c) { return c.title; }).join(', ') + '). First: ' + firstErr.message;
  };
  // The manifest's checks block: no timings, so two pages agree byte for byte.
  C.summary = function (b) {
    b = b || cur();
    var r = C.run(b);
    return {
      engineVersion: ES.version, proven: !r.errors, errors: r.errors, warnings: r.warnings, worldHash: C.worldHash(b), worldStamp: C.stamped(b), storyDigest: STORY.engineIndex(b).digest,
      cards: r.cards.map(function (c) { return { key: c.key, title: c.title, status: c.status, errors: c.errors, warnings: c.warnings, codes: c.items.map(function (x) { return x.code; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort() }; })
    };
  };
  C.walkStats = function (b) {
    b = b || cur();
    var r = C.run(b);
    if (!r.run) return null;
    var R = r.run.result, S = R.stats;
    return { states: S.states, edges: S.edges, expanded: S.expanded, capped: S.capped, cap: S.cap, maxDepth: S.maxDepth, runs: S.runs, gameovers: S.gameovers,
      endings: Object.keys(R.endings).sort(), golden: R.golden ? { steps: R.golden.path.length, full: R.goldenFull, ending: R.golden.ending } : null, softlocks: R.softlock.count, digest: R.digest };
  };
  // Opens the place an item points at: a record and field, a person's pages, or a tab.
  C.jump = function (it) {
    if (!it) return false;
    if (it.npc && !(it.recordId && Kit.ids.prefixOf(it.recordId) === 'evt_')) { if (!Kit.go('dialogue')) return false; if (STORY.WS && STORY.WS.dialogue && STORY.WS.dialogue.focus) STORY.WS.dialogue.focus(it.npc); return true; }
    if (it.recordId && Kit.jump.can(it.recordId)) return Kit.jump(it.recordId, it.fieldPath);
    if (it.tab) return Kit.go(it.tab);
    return false;
  };
  C.canJump = function (it) { return !!it && (!!it.npc || !!it.tab || (!!it.recordId && Kit.jump.can(it.recordId))); };
})();
// === STORY:CHECKS END ===
