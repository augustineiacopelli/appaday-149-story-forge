// === STORY:EVENTS BEGIN ===
(function () {
  'use strict';
  // Phase 5: events and cutscenes. An evt_ record is the shape ENGINE_STORY.pages and the runner already read:
  //   trigger mapEnter | talk | step | autorun | battleEnd | chapterStart
  //   map (map_), at [x, y] (step), npc (npc_, talk), trp (trp_, battleEnd, optional), priority (higher runs first)
  //   pages [{cond, cmds, once}]   the highest page whose condition passes runs (RPG Maker's rightmost rule)
  // and fields the engine ignores: kind (open | talk | arrive | prize | boss | exit | finale | custom), chapter, site (the
  // Day 148 progression node or region key the event stands on, for the Phase 7 walk), dgn (a boss event's dungeon), slot
  // (true when the story fills an empty boss slot), gen (the digest of what the scaffold made), notes.
  // The scaffold builds, from the world, the quests, and the endings, with structural IDs (so a rerun renames nothing):
  //   evt|open|<chp>    a chapter opener: chapterStart, once; music, narration, and the main quest's first stage
  //   evt|talk|<npc>    a talk event on every main quest giver: the first stage (arrive) moves on when you speak to them
  //   evt|arrive|<chp>  only when a main quest has no giver: entering the start town moves the first stage on instead
  //   evt|prize|<chp>   the key dungeon's prize chest (a step on its cell): sets the seal flags, shows the display item
  //   evt|boss|<chp>    the boss tile (a step on its cell): starts the world troop, or the troop the story chose for an
  //                     empty slot; a win sets the next chapter and vehicle flags (and the finale flag in the last chapter)
  //   evt|exit|<chp>    the overworld gate cell to the next region: the main quest's exit stage completes the chapter
  //   evt|finale        an autorun on the finale boss map once the finale flag is set: closes the last main quest and
  //                     picks the ending, highest priority whose condition passes (end_ records arrive in Phase 6)
  // DECISION, regeneration: a generated event carries gen, the digest of the record the scaffold made. A rerun refreshes
  // a generated event only while it is unedited (its digest still equals gen), so building quests or endings later updates
  // the events that read them, and an author's edit is never overwritten. An edited generated event the world no longer
  // asks for becomes the author's (origin user) instead of being deleted.
  // DECISION, empty boss slots: the troop the story chooses lives in story.settings.bossTroops {dgn_: trp_} (bindings hold
  // gate keys only, and the Phase 2 sync drops any other key). Unchosen, the scaffold picks the troop of that chapter with
  // the most members (ties by ID). Day 150 resolves a boss as the world troop when set, else the startBattle troop of the
  // story's boss event for that dungeon (the event whose dgn names it).
  // DECISION, chapter openers: Day 150 checks chapterStart events at a new game and whenever the chapter changes. A boss
  // win sets the next chapter's gate, so an opener after the first also waits for the previous main quest to be done, and
  // the previous chapter's exit event runs it with callEvent at landfall: the chapter card plays on arrival, once.
  // DECISION, talking: Day 150 runs a person's talk event when one of its pages passes, else their npcDialogue page. The
  // talk events here only hold pages for stages a dialogue does not move (a main quest's first stage), so every other
  // stage still falls through to the Phase 4 dialogue, and side quests stay with their offer, accept, and turn in dialogue.
  var U = Kit.util, ES = ENGINE_STORY, F = STORY.flags, Q = STORY.quests;
  function cur() { return Kit.bundle.current(); }
  var E = STORY.events = {};
  E.KINDS = ['open', 'talk', 'arrive', 'prize', 'boss', 'exit', 'finale', 'custom'];
  E.KIND_LABEL = { open: 'Opener', talk: 'Talk', arrive: 'Arrival', prize: 'Seal chest', boss: 'Boss', exit: 'Exit', finale: 'Finale', custom: 'Yours' };
  E.TRIGGERS = ES.pages.TRIGGERS.slice();
  E.TRIGGER_LABEL = { mapEnter: 'Entering a map', talk: 'Talking to a person', step: 'Stepping on a cell', autorun: 'At once on a map', battleEnd: 'After a battle', chapterStart: 'When a chapter starts' };
  E.FINALE_FLAG_KEY = 'flg|story|finale';
  E.PRIORITY = { finale: 20, boss: 10, prize: 10, exit: 5, open: 0, talk: 0, arrive: 0, custom: 0 };
  var ENVELOPE = { id: 1, key: 1, origin: 1, tags: 1, gen: 1 };
  function trim(s) { return String(s === undefined || s === null ? '' : s).trim(); }
  function cut(s, n) { s = trim(s); if (s.length <= n) return s; return s.slice(0, n - 3).replace(/\s+\S*$/, '') + '...'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function sortedObj(o) { var r = {}; Object.keys(o || {}).sort().forEach(function (k) { r[k] = o[k]; }); return r; }
  function nameOf(id, fb) { return STORY.nameOf ? STORY.nameOf(id, fb) : (fb || id || ''); }
  function isInt(v) { return F.isInt(v); }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  // ---------------------------------------------------------------- the Codex type
  var EVENT_FIELDS = [
    { key: 'kind', label: 'Kind', type: 'enum', values: E.KINDS, help: 'What the scaffold made this event for, or custom for one made by hand.' },
    { key: 'trigger', label: 'Trigger', type: 'enum', values: E.TRIGGERS, required: true, help: 'mapEnter, step, and autorun need a map (step also a cell); talk needs a person; battleEnd may name a troop; chapterStart needs no site.' },
    { key: 'map', label: 'Map', type: 'ref', refPrefix: 'map_' },
    { key: 'at', label: 'Cell', type: 'list', of: { type: 'int', min: 0, max: 4095 }, help: 'A cell [x, y] on the map, for a step event.' },
    { key: 'npc', label: 'Person', type: 'ref', refPrefix: 'npc_' },
    { key: 'trp', label: 'Troop', type: 'ref', refPrefix: 'trp_', help: 'For battleEnd: only after this troop. Empty means any battle.' },
    { key: 'dgn', label: 'Boss dungeon', type: 'ref', refPrefix: 'dgn_', help: 'The dungeon a boss event stands for. Day 150 uses its battle troop when the world left the slot empty.' },
    { key: 'slot', label: 'Fills an empty slot', type: 'bool' },
    { key: 'site', label: 'Site', type: 'text', max: 160, help: 'The Day 148 progression node or region this event stands on.' },
    { key: 'priority', label: 'Priority', type: 'int', min: -999, max: 999, help: 'When two events fire on the same spot, the higher priority runs first.' },
    { key: 'pages', label: 'Pages', type: 'list', itemLabel: 'Page', help: 'The highest page whose condition passes runs. A once page runs one time and then steps aside.', of: [
      { key: 'cond', label: 'Runs when', type: 'object' },
      { key: 'cmds', label: 'Commands', type: 'list' },
      { key: 'once', label: 'Once', type: 'bool' }
    ] },
    { key: 'gen', label: 'Generated digest', type: 'text', max: 40, derived: true, help: 'The digest of what the scaffold made. While the record still matches it, a rebuild may refresh it.' },
    { key: 'notes', label: 'Note', type: 'longtext', max: 1200 }
  ];
  Kit.codex.register({ name: STORY.TYPES['evt_'].name, prefix: 'evt_', label: STORY.TYPES['evt_'].label, ns: 'story', forge: STORY.FORGE, group: 'story', dependsOn: [], fields: U.clone(STORY.ENVELOPE_FIELDS).concat(EVENT_FIELDS) });

  // ---------------------------------------------------------------- ids and digests
  E.idFor = function (key) { return ES.ids.structural('evt_', key); };
  E.keys = {
    open: function (chp) { return 'evt|open|' + chp; },
    talk: function (npc) { return 'evt|talk|' + npc; },
    arrive: function (chp) { return 'evt|arrive|' + chp; },
    prize: function (chp) { return 'evt|prize|' + chp; },
    boss: function (chp) { return 'evt|boss|' + chp; },
    exit: function (chp) { return 'evt|exit|' + chp; },
    finale: function () { return 'evt|finale'; }
  };
  E.finaleFlag = function () { return F.idFor(E.FINALE_FLAG_KEY); };
  function strip(rec) { var o = {}; Object.keys(rec || {}).forEach(function (k) { if (!ENVELOPE[k]) o[k] = rec[k]; }); return o; }
  E.genOf = function (rec) { return ES.util.digest(ES.util.canon(strip(rec))); };
  // A generated event an author has changed since the scaffold made it.
  E.isEdited = function (rec) { return !!rec && rec.origin === 'generated' && typeof rec.gen === 'string' && E.genOf(rec) !== rec.gen; };
  function stamp(rec) { rec.gen = E.genOf(rec); return rec; }

  // ---------------------------------------------------------------- music roles (Day 147's vocabulary)
  // Static roles plus field:<slug of each continent label> (field:default when none) and ending:<n> per Charter ending,
  // computed the way Day 147's ART.musicRoles computes them, so a role named here is one Day 147 can score.
  E.STATIC_ROLES = ['title', 'town', 'dungeon', 'battle', 'boss', 'victory', 'defeat', 'ending'];
  function slug(s) { return U.slug ? U.slug(s) : trim(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  E.fieldRole = function (chp, b) {
    var c = STORY.chapters(b).filter(function (x) { return x.id === chp; })[0], s = c && typeof c.continentLabel === 'string' ? slug(c.continentLabel.trim()) : '';
    return 'field:' + (s || 'default');
  };
  E.musicRoles = function (b) {
    b = b || cur();
    var out = E.STATIC_ROLES.slice(), seen = {};
    STORY.chapters(b).forEach(function (c) { var s = typeof c.continentLabel === 'string' ? slug(c.continentLabel.trim()) : ''; if (s && !seen[s]) { seen[s] = 1; out.push('field:' + s); } });
    if (!Object.keys(seen).length) out.push('field:default');
    STORY.endings(b).forEach(function (e, i) { out.push('ending:' + (i + 1)); });
    var user = b && b.art && Array.isArray(b.art.musicRoles) ? b.art.musicRoles : [];
    user.forEach(function (r) { if (U.isObj(r) && r.kind === 'user' && typeof r.key === 'string' && out.indexOf(r.key) < 0) out.push(r.key); });
    return out;
  };

  // ---------------------------------------------------------------- reading the world
  function gateFlag(b, key) { var bd = b.story.bindings[key]; return U.isObj(bd) && typeof bd.flg === 'string' && bd.flg ? bd.flg : F.gateId(key); }
  function gateItem(b, key) { var bd = b.story.bindings[key]; return U.isObj(bd) && typeof bd.itm === 'string' && bd.itm ? bd.itm : null; }
  function flagIs(flg, cmp, value) { return { op: 'flag', flg: flg, cmp: cmp, value: value }; }
  function allOf(list) { return list.length === 0 ? null : list.length === 1 ? list[0] : { op: 'all', of: list }; }
  function anyOf(list) { return list.length === 0 ? null : list.length === 1 ? list[0] : { op: 'any', of: list }; }
  function worldName(id, fb, b) { var r = id && STORY.world.get(id, b); return r && r.name ? r.name : fb; }
  function chapterNodes(g, chp) {
    var m = {};
    (g ? g.nodes : []).forEach(function (n) { if (n.chapter === chp && n.golden && n.kind && n.role && !m[n.kind + ':' + n.role]) m[n.kind + ':' + n.role] = n; });
    return m;
  }
  function mainQuest(chp, b) { var id = Q.idFor(Q.mainKey(chp)); var q = b.story.records.qst_[id]; return q && Array.isArray(q.stages) && q.stages.length ? q : null; }
  function stageAfter(q, key) { for (var i = 0; i < q.stages.length - 1; i++) if (q.stages[i].key === key) return q.stages[i + 1]; return null; }
  function stageBy(q, test) { return q.stages.filter(test)[0] || null; }
  function atStage(q, key) { return { op: 'quest', qst: q.id, is: 'at', stage: key }; }
  function moveTo(q, key) { return { op: 'questStage', qst: q.id, stage: key }; }
  // The cell of a feature on a site's maps: {map, at} or null. Maps are searched in the order the world lists them.
  function featureOn(site, test, b) {
    var maps = site && Array.isArray(site.maps) ? site.maps : [];
    for (var i = 0; i < maps.length; i++) {
      var m = STORY.world.get(maps[i], b), fs = m && Array.isArray(m.features) ? m.features : [];
      for (var j = 0; j < fs.length; j++) if (U.isObj(fs[j]) && test(fs[j]) && Array.isArray(fs[j].at)) return { map: maps[i], at: [fs[j].at[0], fs[j].at[1]] };
    }
    return null;
  }
  function lastMap(site) { var m = site && Array.isArray(site.maps) ? site.maps : []; return m.length ? m[m.length - 1] : null; }
  function bossZone(dgnId, b) { var z = b.world && b.world.zones && Array.isArray(b.world.zones.bosses) ? b.world.zones.bosses : []; return z.filter(function (x) { return U.isObj(x) && x.site === dgnId; })[0] || null; }
  // The troop the story fills an empty boss slot with: the chosen one, else the troop of that chapter with the most
  // members (ties by ID), else the first troop of the Rules. null when the Rules have no troop at all.
  E.defaultTroop = function (chp, b) {
    var trs = STORY.rules('trp_', b), size = function (t) { return Array.isArray(t.members) ? t.members.length : 0; };
    var mine = trs.filter(function (t) { return t.chapter === chp; }).sort(function (x, y) { return size(y) - size(x) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0); });
    return mine.length ? mine[0].id : trs.length ? trs[0].id : null;
  };
  E.bossTroop = function (dgn, b) {
    b = b || cur();
    var d = STORY.world.get(dgn, b), z = bossZone(dgn, b), world = (z && z.troop) || (d && d.troop) || null;
    if (world) return { trp: world, slot: false, chosen: false };
    var set = b.story && b.story.settings && U.isObj(b.story.settings.bossTroops) ? b.story.settings.bossTroops : {};
    var have = typeof set[dgn] === 'string' && STORY.rules('trp_', b).some(function (t) { return t.id === set[dgn]; }) ? set[dgn] : null;
    return { trp: have || E.defaultTroop(d && d.chapter, b), slot: true, chosen: !!have };
  };
  // Every boss dungeon on the golden path with where its boss stands: [{chapter, dgn, name, map, at, troop, slot, chosen,
  // finale, grants}] in chapter order.
  E.bosses = function (b) {
    b = b || cur();
    var g = STORY.world.graph(b), chs = STORY.chapters(b), out = [];
    chs.forEach(function (c, i) {
      var n = chapterNodes(g, c.id)['dgn:boss'];
      if (!n || !n.record) return;
      var d = STORY.world.get(n.record, b), z = bossZone(n.record, b), spot = z && z.map && Array.isArray(z.at) ? { map: z.map, at: [z.at[0], z.at[1]] } : featureOn(d, function (f) { return f.kind === 'boss'; }, b);
      var t = E.bossTroop(n.record, b);
      out.push({ chapter: c.id, node: n.key, dgn: n.record, name: d && d.name || n.record, map: spot ? spot.map : lastMap(d), at: spot ? spot.at : null, troop: t.trp, slot: t.slot, chosen: t.chosen,
        finale: z ? !!z.finale : i === chs.length - 1, grants: (n.grants || []).filter(function (k) { return ES.gates.parse(k).kind !== 'seal'; }) });
    });
    return out;
  };

  // ---------------------------------------------------------------- endings (read for the finale; Phase 6 makes them)
  // end_ records in the order the finale tests them: highest priority first, then by structural key. A condition that is
  // missing or {op: 'true'} always passes, so nothing after it can ever be reached; the chain stops there.
  function alwaysTrue(c) { return c === undefined || c === null || (U.isObj(c) && c.op === 'true'); }
  E.endingOrder = function (b) {
    b = b || cur();
    return STORY.records.list('end_', b).slice().sort(function (x, y) {
      var px = isInt(x.priority) ? x.priority : 0, py = isInt(y.priority) ? y.priority : 0;
      return py - px || (String(x.key) < String(y.key) ? -1 : String(x.key) > String(y.key) ? 1 : 0);
    });
  };
  function endingCmds(list) {
    if (!list.length) return [];
    var e = list[0], then = [];
    if (typeof e.music === 'string' && e.music) then.push(/^mus_/.test(e.music) ? { op: 'music', mus: e.music } : { op: 'music', role: e.music });
    then.push({ op: 'ending', end: e.id });
    if (alwaysTrue(e.cond)) return then;
    var rest = endingCmds(list.slice(1)), c = { op: 'if', cond: clone(e.cond), then: then };
    if (rest.length) c['else'] = rest;
    return [c];
  }

  // ---------------------------------------------------------------- what the world and the quests ask for
  function giverSite(npc, b) {
    var g = STORY.world.graph(b), town = STORY.world.list('twn_', b).filter(function (t) { return Array.isArray(t.people) && t.people.indexOf(npc) >= 0; })[0];
    var n = town && g ? g.nodes.filter(function (x) { return x.record === town.id; })[0] : null;
    return n ? n.key : null;
  }
  function narrate(lines) { return { op: 'text', lines: lines.filter(function (l) { return !!trim(l); }) }; }
  // {events [{key, id, name, kind, chapter, body}], flags [{key, id, name, body}]}: every event and managed flag the world,
  // the quests, and the endings ask for, in a stable order. Pure: reads the bundle, writes nothing.
  E.wanted = function (b) {
    b = b || cur();
    var out = [], flags = [], g = STORY.world.graph(b), chs = STORY.chapters(b), ow = STORY.world.overworld(b), bosses = E.bosses(b), givers = {};
    if (!g) return { events: out, flags: flags };
    var finaleFlag = E.finaleFlag(), finaleBoss = null;
    function add(kind, key, name, chp, body) {
      body.kind = kind;
      if (chp) body.chapter = chp;
      if (body.priority === undefined) body.priority = E.PRIORITY[kind] || 0;
      out.push({ key: key, id: E.idFor(key), name: name, kind: kind, chapter: chp || null, body: body });
    }
    chs.forEach(function (c, i) {
      var n = chapterNodes(g, c.id), q = mainQuest(c.id, b), cn = c.name || c.id, town = n['twn:start'], townRec = town && STORY.world.get(town.record, b);
      var first = q ? q.stages[0] : null, second = q && first ? stageAfter(q, first.key) : null, giver = q && typeof q.giver === 'string' && STORY.world.get(q.giver, b) ? q.giver : null;
      var townMap = townRec && Array.isArray(townRec.maps) && townRec.maps.length ? townRec.maps[0] : null;
      // The chapter opener.
      var open = [{ op: 'fade', to: 'out', frames: 30 }, { op: 'music', role: E.fieldRole(c.id, b) }, narrate(['Chapter ' + (i + 1) + ': ' + cn + '.', cut(c.summary, 220)]), { op: 'fade', to: 'in', frames: 30 }];
      if (q && first) {
        open.push(moveTo(q, first.key));
        if (!giver && !townMap && second && !first.exitWhen) open.push(moveTo(q, second.key));
      }
      var prevQ = i > 0 ? mainQuest(chs[i - 1].id, b) : null, oc = { op: 'chapter', chp: c.id, cmp: 'eq' };
      if (prevQ) oc = { op: 'all', of: [oc, { op: 'quest', qst: prevQ.id, is: 'done' }] };
      add('open', E.keys.open(c.id), 'Opener: ' + cn, c.id, { trigger: 'chapterStart', site: 'reg|' + c.id, pages: [{ cond: oc, cmds: open, once: true }],
        notes: 'Plays once when ' + cn + ' begins: the field music, a line of narration, and the main quest set to its first stage.' + (prevQ ? ' It waits until the previous chapter is complete, so the boss win does not announce it early; the previous exit runs it on arrival.' : '') });
      // Who moves the first stage on: the giver (a talk event, gathered below) or, without one, entering the start town.
      if (q && first && second && !first.exitWhen) {
        if (giver) (givers[giver] = givers[giver] || []).push({ q: q, first: first, second: second, chapter: c.id, index: i });
        else if (townMap) add('arrive', E.keys.arrive(c.id), 'Arrival: ' + (townRec.name || cn), c.id, { trigger: 'mapEnter', map: townMap, site: town.key, pages: [{ cond: atStage(q, first.key), cmds: [narrate(['You reach ' + (townRec.name || 'the town') + '.']), moveTo(q, second.key)] }],
          notes: 'The main quest has no giver, so entering the start town moves its first stage on.' });
      }
      // The key dungeon's prize: the seal flags.
      var keyN = n['dgn:key'];
      if (keyN && keyN.record) {
        var dk = STORY.world.get(keyN.record, b), seals = (keyN.grants || []).filter(function (k) { return ES.gates.parse(k).kind === 'seal'; });
        if (seals.length) {
          var spot = featureOn(dk, function (f) { return f.kind === 'chest' && f.prize && seals.indexOf(f.item) >= 0; }, b) || featureOn(dk, function (f) { return f.kind === 'chest' && f.prize; }, b);
          var give = [narrate(['Inside the chest lies the seal of ' + cn + '.'])];
          seals.forEach(function (k) { var it = gateItem(b, k); if (it) give.push({ op: 'giveItem', itm: it, qty: 1 }); give.push({ op: 'setFlag', flg: gateFlag(b, k), value: 1 }); });
          var notHave = anyOf(seals.map(function (k) { return flagIs(gateFlag(b, k), 'lt', 1); }));
          var pb = { site: keyN.key, pages: [{ cmds: [narrate(['The chest is empty.'])] }, { cond: notHave, cmds: give }] };
          if (spot) { pb.trigger = 'step'; pb.map = spot.map; pb.at = spot.at; } else { pb.trigger = 'mapEnter'; pb.map = lastMap(dk); }
          pb.notes = spot ? 'The prize chest of ' + (dk && dk.name || 'the key dungeon') + '. Opening it sets the seal, which moves the main quest past its key stage.' : 'Day 148 placed no prize chest, so the seal is given on entering the deepest floor.';
          add('prize', E.keys.prize(c.id), 'Seal chest: ' + cn, c.id, pb);
        }
      }
      // The exit gate to the next region.
      var exitN = n['gate:exit'], exitStage = q ? stageBy(q, function (s) { return s.site === (exitN && exitN.key); }) || stageBy(q, function (s) { return s.key === 'exit'; }) : null;
      if (exitN && q && exitStage) {
        var after = stageAfter(q, exitStage.key), nextKey = (exitN.requires || []).filter(function (k) { return ES.gates.parse(k).kind === 'chapter'; })[0];
        var reg = (g.regions || []).filter(function (r) { return r.key === exitN.to; })[0], cell = null;
        (ow && Array.isArray(ow.gates) ? ow.gates : []).forEach(function (gt) { if (!cell && U.isObj(gt) && gt.gate === nextKey && (!exitN.regionRecord || gt.from === exitN.regionRecord) && Array.isArray(gt.cells) && gt.cells.length) cell = gt.cells[0]; });
        var words = exitN.via === 'landing' ? 'You make landfall on ' + (reg && reg.label || 'a new shore') + '.' : 'The road to ' + (reg && reg.label || 'the next region') + ' lies open.';
        var xc = [narrate([words])], nextCh = chs[i + 1];
        if (after) xc.push(moveTo(q, after.key));
        if (after && nextCh && after.key === q.stages[q.stages.length - 1].key) xc.push({ op: 'callEvent', evt: E.idFor(E.keys.open(nextCh.id)) });
        var xb = { site: exitN.key, pages: [{ cond: atStage(q, exitStage.key), cmds: xc }] };
        if (cell && ow) { xb.trigger = 'step'; xb.map = ow.id; xb.at = [cell[0], cell[1]]; } else if (ow) { xb.trigger = 'autorun'; xb.map = ow.id; xb.pages[0].once = true; }
        xb.notes = cell ? 'The overworld cell where ' + cn + ' gives way to the next region. Crossing it completes the chapter.' : 'Day 148 placed no gate cell, so the chapter completes on the overworld at once.';
        if (ow) add('exit', E.keys.exit(c.id), 'Exit: ' + cn, c.id, xb);
      }
    });
    // Talk events: one per main quest giver, a page per chapter they give a quest in (later chapters to the right).
    Object.keys(givers).sort().forEach(function (npc) {
      var list = givers[npc].sort(function (x, y) { return x.index - y.index; }), who = worldName(npc, 'the giver', b);
      var pages = list.map(function (x) {
        return { cond: atStage(x.q, x.first.key), cmds: [{ op: 'text', speaker: npc, lines: ['You made it, traveler. We have waited for you.', 'Your road leads on: ' + (trim(x.second.label) || x.second.key) + '.'] }, moveTo(x.q, x.second.key)] };
      });
      var body = { trigger: 'talk', npc: npc, pages: pages, notes: 'Speaking to ' + who + ' moves the main quest past its first stage. Any other time, ' + who + ' says their dialogue page.' };
      var site = giverSite(npc, b); if (site) body.site = site;
      add('talk', E.keys.talk(npc), 'Talk: ' + who, list[0].chapter, body);
    });
    // Bosses, and the finale after the last one.
    bosses.forEach(function (bs) {
      var cn = (chs.filter(function (c) { return c.id === bs.chapter; })[0] || {}).name || bs.chapter, flags = bs.grants.map(function (k) { return gateFlag(b, k); });
      var win = [{ op: 'music', role: 'victory' }];
      flags.forEach(function (f) { win.push({ op: 'setFlag', flg: f, value: 1 }); });
      var words = ['The ' + (nameOf(bs.troop, 'enemy') || 'enemy') + ' falls.'];
      if (bs.grants.indexOf('vehicle:ship') >= 0) words.push('A ship waits at the shore. It is yours now.');
      if (bs.grants.indexOf('vehicle:airship') >= 0) words.push('The airship is yours. The sky is open.');
      if (bs.finale) { win.push({ op: 'setFlag', flg: finaleFlag, value: 1 }); words.push('The last shadow is gone.'); finaleBoss = bs; }
      win.push(narrate(words));
      var battle = { op: 'startBattle', win: win };
      if (bs.troop) battle.trp = bs.troop;
      var notYet = bs.finale ? flagIs(finaleFlag, 'lt', 1) : anyOf(flags.map(function (f) { return flagIs(f, 'lt', 1); }));
      var body = { dgn: bs.dgn, site: bs.node, pages: [{ cmds: [narrate(['All is quiet now.'])] }, { cond: notYet, cmds: [{ op: 'music', role: 'boss' }, narrate(['Something stirs in the dark ahead.']), battle] }] };
      if (bs.slot) body.slot = true;
      if (bs.at && bs.map) { body.trigger = 'step'; body.map = bs.map; body.at = bs.at; } else { body.trigger = 'mapEnter'; body.map = bs.map; }
      body.notes = (bs.slot ? 'Day 148 left this boss slot empty, so the story fills it with ' + (bs.troop ? nameOf(bs.troop, bs.troop) : 'a troop you choose') + '. ' : '') + 'A win sets ' + (bs.finale ? 'the finale flag' : 'the gates the boss opens') + '; a loss is game over.';
      if (!body.map) return;
      if (!body.pages[1].cond) delete body.pages[1].cond;
      add('boss', E.keys.boss(bs.chapter), 'Boss: ' + cn, bs.chapter, body);
    });
    var lastCh = chs.length ? chs[chs.length - 1] : null, lastQ = lastCh ? mainQuest(lastCh.id, b) : null;
    var fin = [];
    if (lastQ) fin.push(moveTo(lastQ, lastQ.stages[lastQ.stages.length - 1].key));
    var ends = endingCmds(E.endingOrder(b));
    if (!ends.length) fin.push(narrate(['The tale is told.']));
    fin = fin.concat(ends);
    var fb = { trigger: 'autorun', map: finaleBoss ? finaleBoss.map : ow ? ow.id : null, site: finaleBoss ? finaleBoss.node : null, pages: [{ cond: flagIs(finaleFlag, 'gte', 1), cmds: fin, once: true }],
      notes: 'Runs once the finale boss falls: the last main quest completes and the ending is picked, the highest priority whose condition passes.' };
    if (!fb.site) delete fb.site;
    if (fb.map && chs.length) add('finale', E.keys.finale(), 'Finale', lastCh.id, fb);
    if (out.some(function (w) { return w.kind === 'finale'; })) flags.push({ key: E.FINALE_FLAG_KEY, id: finaleFlag, name: 'Finale reached', body: { kind: 'story', 'default': 0, range: [0, 1], notes: 'Set when the finale boss falls; the finale event reads it.' } });
    return { events: out, flags: flags };
  };
  function generated(w) { return stamp(STORY.envelope('evt_', w.key, w.name, w.body)); }

  // ---------------------------------------------------------------- the scaffold
  // Idempotent: a second run changes nothing and does not touch the bundle. Builds what is missing, refreshes unedited
  // generated events whose inputs moved, keeps edited ones, and drops (or hands to the author, when edited) events nothing
  // asks for. Syncs the flags afterward so every event with a once page gets its save slot. Returns a report.
  E.scaffold = function (b) {
    b = b || cur();
    var rep = { created: [], refreshed: [], kept: [], removed: [], orphaned: [], flagsMade: [], flagsDropped: [], hints: [], changed: false, skipped: null, sync: null };
    if (!b) { rep.skipped = 'No bundle is open.'; return rep; }
    var ready = STORY.readiness(b);
    if (ready !== true) { rep.skipped = ready; return rep; }
    STORY.ensure(b);
    F.sync(b);
    var s = b.story, R = s.records.evt_, FL = s.records.flg_, scaf = s.scaffold, W = E.wanted(b), want = {}, wantFlag = {};
    if (!STORY.chapters(b).some(function (c) { return mainQuest(c.id, b); })) rep.hints.push('Build quests first, so the events can move the main quests.');
    W.flags.forEach(function (f) {
      wantFlag[f.key] = 1;
      if (!FL[f.id]) { FL[f.id] = STORY.envelope('flg_', f.key, f.name, f.body); rep.flagsMade.push(f.id); }
      if (scaf[f.key] !== f.id) { scaf[f.key] = f.id; rep.changed = true; }
    });
    W.events.forEach(function (w) {
      want[w.key] = w;
      var have = R[w.id], fresh = generated(w);
      if (!have) { R[w.id] = fresh; rep.created.push(w.id); }
      else if (have.origin === 'generated' && fresh.gen !== have.gen) {
        if (E.isEdited(have)) rep.kept.push(w.id); else { R[w.id] = fresh; rep.refreshed.push(w.id); }
      }
      if (scaf[w.key] !== w.id) { scaf[w.key] = w.id; rep.changed = true; }
    });
    Object.keys(scaf).sort().forEach(function (k) {
      var id = scaf[k];
      if (k.indexOf('evt|') === 0 && !want[k]) {
        var r = R[id];
        if (r && r.origin === 'generated') { if (E.isEdited(r)) { r.origin = 'user'; delete r.gen; rep.orphaned.push(id); } else { delete R[id]; rep.removed.push(id); } }
        delete scaf[k]; rep.changed = true;
      } else if (k === E.FINALE_FLAG_KEY && !wantFlag[k]) {
        if (FL[id] && FL[id].origin === 'generated') { delete FL[id]; rep.flagsDropped.push(id); }
        delete scaf[k]; rep.changed = true;
      }
    });
    if (rep.created.length || rep.refreshed.length || rep.removed.length || rep.orphaned.length || rep.flagsMade.length || rep.flagsDropped.length || rep.changed) {
      s.records.evt_ = sortedObj(R); s.records.flg_ = sortedObj(FL); s.scaffold = sortedObj(scaf);
      rep.changed = true;
      if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-events'); }
    }
    rep.sync = F.sync(b);
    if (rep.sync.changed) rep.changed = true;
    return rep;
  };
  E.reportText = function (rep) {
    if (rep.skipped) return rep.skipped;
    var parts = [];
    if (rep.created.length) parts.push(plural(rep.created.length, 'event') + ' built');
    if (rep.refreshed.length) parts.push(plural(rep.refreshed.length, 'event') + ' updated');
    if (rep.kept.length) parts.push(plural(rep.kept.length, 'edited event') + ' kept as you left ' + (rep.kept.length === 1 ? 'it' : 'them'));
    if (rep.removed.length) parts.push(plural(rep.removed.length, 'event') + ' no longer needed');
    if (rep.orphaned.length) parts.push(plural(rep.orphaned.length, 'edited event') + ' kept as yours');
    var t = parts.length ? parts.join(', ') + '.' : 'Events are up to date.';
    return rep.hints.length ? t + ' ' + rep.hints.join(' ') : t;
  };
  // What a scaffold run would build and what is there, by kind: {byKind {kind: {want, have}}, missing, stale}.
  E.expected = function (b) {
    b = b || cur();
    var W = E.wanted(b).events, by = {}, s = b && b.story, missing = 0, stale = 0;
    E.KINDS.forEach(function (k) { by[k] = { want: 0, have: 0 }; });
    W.forEach(function (w) {
      var r = s && s.records.evt_[w.id];
      by[w.kind].want++;
      if (r) { by[w.kind].have++; if (r.origin === 'generated' && !E.isEdited(r) && generated(w).gen !== r.gen) stale++; } else missing++;
    });
    return { byKind: by, missing: missing, stale: stale };
  };
  // Chooses the troop for an empty boss slot (null goes back to the default) and refreshes that boss event when it is
  // unedited. Refuses a dungeon whose slot the world already fills.
  E.setBossTroop = function (dgn, trp, b) {
    b = b || cur();
    STORY.ensure(b);
    var t = E.bossTroop(dgn, b);
    if (!t.slot) return { ok: false, message: 'The world already gives this boss its troop.' };
    if (trp && !STORY.rules('trp_', b).some(function (x) { return x.id === trp; })) return { ok: false, message: trp + ' is not a troop in the Rules.' };
    var set = b.story.settings.bossTroops = U.isObj(b.story.settings.bossTroops) ? b.story.settings.bossTroops : {};
    if (trp) set[dgn] = trp; else delete set[dgn];
    b.story.settings.bossTroops = sortedObj(set);
    if (!Object.keys(set).length) delete b.story.settings.bossTroops;
    var w = E.wanted(b).events.filter(function (x) { return x.kind === 'boss' && x.body.dgn === dgn; })[0], R = b.story.records.evt_, rec = w && R[w.id], out = { ok: true, refreshed: false, kept: false };
    if (w && rec && rec.origin === 'generated') { if (E.isEdited(rec)) out.kept = true; else { R[w.id] = generated(w); out.refreshed = true; } }
    if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-events'); }
    return out;
  };

  // ---------------------------------------------------------------- checks
  // Everything ENGINE_STORY.pages.lint finds, plus cross field mistakes: [{level, code, path, message}]. idx must hold the
  // record (STORY.engineIndex, or E.indexWith for a candidate).
  E.check = function (rec, b, idx) {
    b = b || cur();
    var out = [];
    function add(level, code, path, message) { out.push({ level: level, code: code, path: path, message: message }); }
    if (!U.isObj(rec)) { add('error', 'not-object', '', 'An event is an object.'); return out; }
    ES.pages.lint(rec, idx, 'event', rec.id).forEach(function (p) { add(p.level, p.code, String(p.path).replace(/^event\.?/, ''), p.message); });
    if (rec.kind !== undefined && E.KINDS.indexOf(rec.kind) < 0) add('error', 'enum', 'kind', 'kind is one of ' + E.KINDS.join(', ') + '.');
    if (rec.chapter !== undefined && rec.chapter !== null && !STORY.chapters(b).some(function (c) { return c.id === rec.chapter; })) add('error', 'ref', 'chapter', rec.chapter + ' is not a chapter of the Charter.');
    if (rec.dgn !== undefined && rec.dgn !== null && !STORY.world.get(rec.dgn, b)) add('error', 'ref', 'dgn', rec.dgn + ' is not a dungeon of the world.');
    if (rec.map && STORY.world.get(rec.map, b) && Array.isArray(rec.at) && rec.at.length === 2) {
      var m = STORY.world.get(rec.map, b);
      if (isInt(m.w) && isInt(m.h) && (rec.at[0] >= m.w || rec.at[1] >= m.h)) add('error', 'range', 'at', 'The cell ' + rec.at.join(', ') + ' is outside ' + (m.name || rec.map) + ' (' + m.w + ' by ' + m.h + ').');
    }
    if (rec.kind === 'boss') {
      var hasTroop = false;
      (Array.isArray(rec.pages) ? rec.pages : []).forEach(function (p) { if (U.isObj(p)) ES.cmd.walk(p.cmds, function (c) { if (U.isObj(c) && c.op === 'startBattle' && c.trp) hasTroop = true; }); });
      if (!hasTroop) add('error', 'boss-troop', 'pages', 'This boss event starts no troop. Choose a troop for the empty boss slot.');
    }
    if (rec.kind === 'finale') {
      var ends = false;
      (Array.isArray(rec.pages) ? rec.pages : []).forEach(function (p) { if (U.isObj(p)) ES.cmd.walk(p.cmds, function (c) { if (U.isObj(c) && c.op === 'ending') ends = true; }); });
      if (!ends) add('warning', 'no-ending', 'pages', 'The finale reaches no ending yet. Endings arrive in Phase 6; then update the events.');
    }
    return out;
  };
  function indexWith(rec, b) {
    var recs = {};
    Object.keys(b.story.records).forEach(function (p) { recs[p] = b.story.records[p]; });
    recs.evt_ = {};
    Object.keys(b.story.records.evt_).forEach(function (k) { recs.evt_[k] = b.story.records.evt_[k]; });
    recs.evt_[rec.id] = rec;
    return ES.index.build({ records: recs, bindings: b.story.bindings, npcDialogue: b.story.npcDialogue }, STORY.engineExt(b));
  }
  E.indexWith = indexWith;
  Kit.validate.register('story.events', function (b, ctx) {
    var s = b.story;
    if (!s || !U.isObj(s.records) || !U.isObj(s.records.evt_)) return;
    var ids = Object.keys(s.records.evt_).sort();
    if (!ids.length) return;
    var idx = STORY.engineIndex(b), bossFor = {};
    ids.forEach(function (id) {
      var rec = s.records.evt_[id];
      E.check(rec, b, idx).forEach(function (p) { ctx.add({ recordId: id, fieldPath: p.path, message: p.message, level: p.level }); });
      if (U.isObj(rec) && rec.kind === 'boss' && rec.dgn) (bossFor[rec.dgn] = bossFor[rec.dgn] || []).push(id);
    });
    Object.keys(bossFor).sort().forEach(function (d) { if (bossFor[d].length > 1) ctx.add({ recordId: bossFor[d][0], fieldPath: 'dgn', message: 'Events ' + bossFor[d].join(' and ') + ' both stand for the boss of ' + d + '; Day 150 takes the first.', level: 'warning' }); });
  });

  // ---------------------------------------------------------------- editing
  function sameProblem(a, z) { return a.code === z.code && a.path === z.path && a.message === z.message; }
  function touch(b) { if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-events'); } }
  // Applies fn to a copy of the event. A result with an error string refuses the edit, and so does an edit that would add
  // an error the event did not already have. Nothing is written then. Returns {ok, record} or {ok: false, problems}.
  E.edit = function (id, fn, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.evt_, rec = R && R[id];
    if (!rec) return { ok: false, problems: [{ level: 'error', code: 'missing', path: 'id', message: 'That event does not exist.' }] };
    var before = E.check(rec, b, STORY.engineIndex(b)).filter(function (p) { return p.level === 'error'; });
    var next = U.clone(rec), r = fn(next);
    if (r && r.error) return { ok: false, problems: [{ level: 'error', code: 'edit', path: '', message: r.error }] };
    var fresh = E.check(next, b, indexWith(next, b)).filter(function (p) { return p.level === 'error' && !before.some(function (x) { return sameProblem(x, p); }); });
    if (fresh.length) return { ok: false, problems: fresh };
    R[id] = next;
    touch(b);
    return { ok: true, record: next };
  };
  // Event level fields. null or '' removes an optional field. A trigger change drops the site fields it no longer needs.
  var NEEDS = { mapEnter: ['map'], step: ['map', 'at'], autorun: ['map'], talk: ['npc'], battleEnd: ['trp'], chapterStart: [] };
  E.update = function (id, patch, b) {
    patch = patch || {};
    return E.edit(id, function (rec) {
      if (patch.name !== undefined) { var nm = trim(patch.name); if (!nm) return { error: 'An event needs a name.' }; rec.name = nm.slice(0, 120); }
      if (patch.notes !== undefined) rec.notes = trim(patch.notes).slice(0, 1200);
      ['chapter', 'map', 'npc', 'trp', 'trigger'].forEach(function (k) { if (patch[k] !== undefined) { if (patch[k] === null || patch[k] === '') delete rec[k]; else rec[k] = patch[k]; } });
      if (patch.at !== undefined) { if (patch.at === null) delete rec.at; else if (Array.isArray(patch.at) && patch.at.length === 2 && patch.at.every(function (v) { return isInt(v) && v >= 0; })) rec.at = [patch.at[0], patch.at[1]]; else return { error: 'A cell is two whole numbers, x and y, from 0.' }; }
      if (patch.priority !== undefined) { if (patch.priority === null || patch.priority === '') delete rec.priority; else if (isInt(patch.priority)) rec.priority = patch.priority; else return { error: 'Priority is a whole number.' }; }
      if (patch.trigger !== undefined) ['map', 'at', 'npc', 'trp'].forEach(function (k) { if (NEEDS[rec.trigger] && NEEDS[rec.trigger].indexOf(k) < 0 && !(k === 'trp' && rec.trigger === 'battleEnd')) delete rec[k]; });
    }, b);
  };
  function cleanPage(p) {
    var o = {};
    if (U.isObj(p) && p.cond !== undefined && p.cond !== null) o.cond = clone(p.cond);
    o.cmds = U.isObj(p) && Array.isArray(p.cmds) ? clone(p.cmds) : [];
    if (U.isObj(p) && p.once === true) o.once = true;
    return o;
  }
  E.addPage = function (id, page, b) { return E.edit(id, function (rec) { rec.pages = Array.isArray(rec.pages) ? rec.pages : []; rec.pages.push(cleanPage(page || {})); }, b); };
  // patch: any of cond (null for always), once, cmds.
  E.updatePage = function (id, i, patch, b) {
    patch = patch || {};
    return E.edit(id, function (rec) {
      var p = Array.isArray(rec.pages) ? rec.pages[i] : null;
      if (!U.isObj(p)) return { error: 'That page does not exist.' };
      if (patch.cond !== undefined) { if (patch.cond === null) delete p.cond; else p.cond = clone(patch.cond); }
      if (patch.once !== undefined) { if (patch.once) p.once = true; else delete p.once; }
      if (patch.cmds !== undefined) { if (!Array.isArray(patch.cmds)) return { error: 'Commands are a list.' }; p.cmds = clone(patch.cmds); }
    }, b);
  };
  E.removePage = function (id, i, b) {
    return E.edit(id, function (rec) {
      if (!Array.isArray(rec.pages) || !rec.pages[i]) return { error: 'That page does not exist.' };
      if (rec.pages.length < 2) return { error: 'An event keeps at least one page.' };
      rec.pages.splice(i, 1);
    }, b);
  };
  E.movePage = function (id, i, delta, b) {
    return E.edit(id, function (rec) {
      var j = i + delta;
      if (!Array.isArray(rec.pages) || !rec.pages[i] || j < 0 || j >= rec.pages.length) return { error: 'That page cannot move there.' };
      var t = rec.pages[i]; rec.pages[i] = rec.pages[j]; rec.pages[j] = t;
    }, b);
  };

  // ---------------------------------------------------------------- the command tree
  // A command is addressed the way the runner addresses one: a path of keys from a page's cmds, such as [2], [2, 'then', 0],
  // or [0, 'options', 1, 'cmds', 3]. A list is addressed by the path that leads to it ([] for the page's own list). Every
  // function returns a new list and never changes the one it was given; null means the path does not resolve.
  function valueAt(root, path) {
    var cur0 = root;
    for (var i = 0; i < path.length; i++) { if (cur0 === null || typeof cur0 !== 'object') return null; cur0 = cur0[path[i]]; }
    return cur0 === undefined ? null : cur0;
  }
  function listAt(root, path) { var v = valueAt(root, path); return Array.isArray(v) ? v : null; }
  // The keys under which a command holds a child list (an option holds its list under cmds).
  var CHILD_KEYS = { then: 1, 'else': 1, win: 1, lose: 1, escape: 1, cmds: 1 };
  E.tree = {
    get: function (list, path) { var l = listAt(list, path.slice(0, -1)), i = path[path.length - 1]; return l && U.isObj(l[i]) ? l[i] : null; },
    list: function (list, path) { return listAt(list, path); },
    // Puts cmd at path (replacing what is there).
    put: function (list, path, cmd) { var n = clone(list), l = listAt(n, path.slice(0, -1)), i = path[path.length - 1]; if (!l || i < 0 || i >= l.length) return null; l[i] = clone(cmd); return n; },
    // Inserts cmd into the list at listPath, at position at (the end when at is missing). Creates a missing child list of
    // an if, a battle, or a choice option when its parent command exists.
    insert: function (list, listPath, at, cmd) {
      var n = clone(list), l = listAt(n, listPath), last = listPath[listPath.length - 1];
      if (!l && listPath.length && CHILD_KEYS[last]) {
        var owner = valueAt(n, listPath.slice(0, -1));
        if (U.isObj(owner)) { owner[last] = []; l = owner[last]; }
      }
      if (!l) return null;
      var k = at === undefined || at === null || at > l.length ? l.length : Math.max(0, at);
      l.splice(k, 0, clone(cmd));
      return n;
    },
    remove: function (list, path) { var n = clone(list), l = listAt(n, path.slice(0, -1)), i = path[path.length - 1]; if (!l || !l[i]) return null; l.splice(i, 1); return n; },
    move: function (list, path, delta) {
      var n = clone(list), l = listAt(n, path.slice(0, -1)), i = path[path.length - 1], j = i + delta;
      if (!l || !l[i] || j < 0 || j >= l.length) return null;
      var t = l[i]; l[i] = l[j]; l[j] = t;
      return n;
    },
    // The child lists of a command as [{label, path (relative), list}] in a fixed order, including the empty ones a
    // command may hold, so the editor can offer an add control on each.
    children: function (c) {
      var out = [];
      if (!U.isObj(c)) return out;
      if (c.op === 'if') { out.push({ label: 'Then', seg: ['then'], list: c.then || [] }); out.push({ label: 'Else', seg: ['else'], list: c['else'] || [] }); }
      if (c.op === 'choice' && Array.isArray(c.options)) c.options.forEach(function (o, k) { out.push({ label: 'If chosen: ' + (U.isObj(o) && o.text ? o.text : 'option ' + (k + 1)), seg: ['options', k, 'cmds'], list: U.isObj(o) && Array.isArray(o.cmds) ? o.cmds : [] }); });
      if (c.op === 'startBattle') { out.push({ label: 'On a win', seg: ['win'], list: c.win || [] }); if (Array.isArray(c.lose)) out.push({ label: 'On a loss', seg: ['lose'], list: c.lose }); if (Array.isArray(c.escape)) out.push({ label: 'On an escape', seg: ['escape'], list: c.escape }); }
      return out;
    },
    count: function (list) { var n = 0; ES.cmd.walk(list, function () { n++; }); return n; }
  };
  E.setCmds = function (id, i, cmds, b) { return E.updatePage(id, i, { cmds: cmds }, b); };
  // A fresh command of each kind, filled with what can be guessed; the editor opens it before it is saved.
  E.blank = function (op) {
    switch (op) {
      case 'text': return { op: op, lines: ['...'] };
      case 'choice': return { op: op, prompt: '', options: [{ text: 'Yes', cmds: [] }, { text: 'No', cmds: [] }] };
      case 'if': return { op: op, cond: { op: 'true' }, then: [] };
      case 'setFlag': return { op: op, flg: '', value: 1 };
      case 'addFlag': return { op: op, flg: '', by: 1 };
      case 'giveItem': case 'takeItem': return { op: op, itm: '', qty: 1 };
      case 'gil': return { op: op, by: 100 };
      case 'questStage': return { op: op, qst: '', stage: '' };
      case 'party': return { op: op, chr: '', act: 'join' };
      case 'startBattle': return { op: op, trp: '', win: [] };
      case 'moveActor': return { op: op, who: 'player', path: ['down'] };
      case 'face': return { op: op, who: 'player', dir: 'down' };
      case 'wait': return { op: op, frames: 30 };
      case 'fade': return { op: op, to: 'out', frames: 30 };
      case 'music': return { op: op, role: 'town' };
      case 'sfx': return { op: op, sfx: '' };
      case 'changeMap': return { op: op, map: '', at: [0, 0], dir: 'down' };
      case 'vehicle': return { op: op, kind: 'ship', act: 'board' };
      case 'callEvent': return { op: op, evt: '' };
      case 'ending': return { op: op, end: '' };
    }
    return null;
  };
  E.OP_LABEL = { text: 'Show text', choice: 'Offer a choice', 'if': 'If a condition passes', setFlag: 'Set a flag', addFlag: 'Add to a flag', giveItem: 'Give an item', takeItem: 'Take an item', gil: 'Give or take gil', questStage: 'Move a quest', party: 'Party member joins or leaves',
    startBattle: 'Start a battle', moveActor: 'Move someone', face: 'Turn someone', wait: 'Wait', fade: 'Fade the screen', music: 'Play music', sfx: 'Play a sound', changeMap: 'Change map', vehicle: 'Board or leave a vehicle', callEvent: 'Run another event', ending: 'End the game' };
  E.OP_GROUPS = [['Story', ['text', 'choice', 'if', 'questStage', 'callEvent', 'ending']], ['State', ['setFlag', 'addFlag', 'giveItem', 'takeItem', 'gil', 'party']], ['Battle', ['startBattle']], ['Staging', ['moveActor', 'face', 'wait', 'fade', 'music', 'sfx', 'changeMap', 'vehicle']]];
  function who(v) { return v === 'player' ? 'the player' : nameOf(v, v || 'someone'); }
  function stageLabel(qst, key) { var q = cur() && cur().story.records.qst_[qst], s = q && Array.isArray(q.stages) ? q.stages.filter(function (x) { return x.key === key; })[0] : null; return s ? (s.label || key) : key; }
  // A command as one plain sentence, for the editor and the playtester.
  E.cmdText = function (c) {
    if (!U.isObj(c)) return 'Unreadable command';
    switch (c.op) {
      case 'text': return (c.speaker ? nameOf(c.speaker, c.speaker) + ': ' : 'Narration: ') + cut((Array.isArray(c.lines) ? c.lines : []).join(' '), 90);
      case 'choice': return 'Choice' + (c.prompt ? ' (' + cut(c.prompt, 40) + ')' : '') + ': ' + (Array.isArray(c.options) ? c.options.map(function (o) { return U.isObj(o) ? o.text : '?'; }).join(' / ') : '');
      case 'if': return 'If ' + (c.cond ? E.condText(c.cond) : 'always');
      case 'setFlag': return 'Set ' + nameOf(c.flg, c.flg || '?') + ' to ' + (c.value === undefined ? 1 : c.value);
      case 'addFlag': return 'Add ' + (c.by === undefined ? 1 : c.by) + ' to ' + nameOf(c.flg, c.flg || '?');
      case 'giveItem': return 'Give ' + (c.qty || 1) + ' ' + nameOf(c.itm, c.itm || '?');
      case 'takeItem': return 'Take ' + (c.qty || 1) + ' ' + nameOf(c.itm, c.itm || '?');
      case 'gil': return (c.by < 0 ? 'Take ' + (-c.by) : 'Give ' + c.by) + ' gil';
      case 'questStage': return c.fail ? 'Fail ' + nameOf(c.qst, c.qst || '?') : c.stage !== undefined ? nameOf(c.qst, c.qst || '?') + ' moves to ' + stageLabel(c.qst, c.stage) : nameOf(c.qst, c.qst || '?') + ' commits ' + c.branch + ' to ' + c.outcome;
      case 'party': return nameOf(c.chr, c.chr || '?') + (c.act === 'leave' ? ' leaves the party' : ' joins the party');
      case 'startBattle': return 'Battle: ' + (c.trp ? nameOf(c.trp, c.trp) : 'no troop chosen') + (Array.isArray(c.lose) ? '' : ' (a loss is game over)');
      case 'moveActor': return 'Move ' + who(c.who) + ' ' + (Array.isArray(c.path) ? c.path.join(' ') : '');
      case 'face': return 'Turn ' + who(c.who) + ' ' + (c.dir || '?');
      case 'wait': return 'Wait ' + (c.frames || 0) + ' frames';
      case 'fade': return 'Fade ' + (c.to || '?') + (c.frames ? ' over ' + c.frames + ' frames' : '');
      case 'music': return c.stop ? 'Stop the music' : 'Music: ' + (c.mus ? nameOf(c.mus, c.mus) : c.role || '?');
      case 'sfx': return 'Sound: ' + nameOf(c.sfx, c.sfx || '?');
      case 'changeMap': return 'Go to ' + nameOf(c.map, c.map || '?') + (Array.isArray(c.at) ? ' at ' + c.at.join(', ') : '');
      case 'vehicle': return (c.act === 'leave' ? 'Leave the ' : 'Board the ') + (c.kind || 'vehicle');
      case 'callEvent': return 'Run ' + nameOf(c.evt, c.evt || '?');
      case 'ending': return 'Ending: ' + nameOf(c.end, c.end || '?');
    }
    return 'Unknown command ' + String(c.op);
  };
  var CMPW = { gte: 'is at least', gt: 'is more than', eq: 'is', ne: 'is not', lte: 'is at most', lt: 'is less than' };
  E.condText = function (t) {
    if (!U.isObj(t)) return 'always';
    switch (t.op) {
      case 'true': return 'always';
      case 'all': return (t.of || []).map(E.condText).join(' and ') || 'always';
      case 'any': return (t.of || []).map(E.condText).join(' or ') || 'never';
      case 'not': return 'not (' + E.condText(t.of) + ')';
      case 'flag': return nameOf(t.flg, t.flg || '?') + ' ' + (CMPW[t.cmp || 'gte'] || t.cmp) + ' ' + (t.value === undefined ? 1 : t.value);
      case 'item': return 'holding ' + nameOf(t.itm, t.itm || '?') + ' ' + (CMPW[t.cmp || 'gte'] || t.cmp) + ' ' + (t.value === undefined ? 1 : t.value);
      case 'chapter': return 'the chapter ' + (CMPW[t.cmp || 'gte'] || t.cmp) + ' ' + nameOf(t.chp, t.chp || '?');
      case 'quest': return nameOf(t.qst, t.qst || '?') + (t.is === 'at' ? ' is at ' + stageLabel(t.qst, t.stage) : t.is === 'reached' ? ' has reached ' + stageLabel(t.qst, t.stage) : ' is ' + (t.is || 'done'));
    }
    return 'unknown condition';
  };

  // ---------------------------------------------------------------- adding, removing, resetting
  // An event an author makes by hand: spec {name, trigger, chapter, map, at, npc, trp}. One empty page, a minted ID.
  E.add = function (spec, b) {
    b = b || cur();
    spec = spec || {};
    var nm = trim(spec.name);
    if (!nm) return { ok: false, problems: [{ level: 'error', code: 'name', path: 'name', message: 'An event needs a name.' }] };
    var body = { kind: 'custom', trigger: spec.trigger || 'talk', priority: 0, pages: [{ cmds: [] }] };
    ['chapter', 'map', 'npc', 'trp'].forEach(function (k) { if (spec[k]) body[k] = spec[k]; });
    if (Array.isArray(spec.at)) body.at = [spec.at[0], spec.at[1]];
    var rec = STORY.authored('evt_', nm.slice(0, 120), body);
    var probs = E.check(rec, b, indexWith(rec, b)).filter(function (p) { return p.level === 'error'; });
    if (probs.length) return { ok: false, problems: probs };
    b.story.records.evt_[rec.id] = rec;
    b.story.records.evt_ = sortedObj(b.story.records.evt_);
    touch(b);
    return { ok: true, record: rec };
  };
  // Who runs this event from another: [{evt, name}], sorted.
  E.usedBy = function (id, b) {
    b = b || cur();
    var out = [];
    STORY.records.list('evt_', b).forEach(function (r) {
      var hit = false;
      (Array.isArray(r.pages) ? r.pages : []).forEach(function (p) { if (U.isObj(p)) ES.cmd.walk(p.cmds, function (c) { if (U.isObj(c) && c.op === 'callEvent' && c.evt === id) hit = true; }); });
      if (hit && r.id !== id) out.push({ evt: r.id, name: r.name });
    });
    return out;
  };
  // Removes an event. A generated one comes back with the next build. Events that ran it with callEvent keep a broken
  // reference the validator reports.
  E.remove = function (id, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.evt_, rec = R && R[id];
    if (!rec) return { ok: false, message: 'That event does not exist.' };
    var users = E.usedBy(id, b), scaf = b.story.scaffold;
    delete R[id];
    Object.keys(scaf).forEach(function (k) { if (scaf[k] === id && k.indexOf('evt|') === 0) delete scaf[k]; });
    touch(b);
    return { ok: true, usedBy: users };
  };
  E.reset = function (id, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.evt_, rec = R && R[id];
    if (!rec) return { ok: false, message: 'That event does not exist.' };
    if (rec.origin !== 'generated') return { ok: false, message: 'Only a generated event can be set back to what the world asks for.' };
    var w = E.wanted(b).events.filter(function (x) { return x.id === id; })[0];
    if (!w) return { ok: false, message: 'The world and the quests no longer ask for this event.' };
    R[id] = generated(w);
    touch(b);
    return { ok: true, record: R[id] };
  };

  // ---------------------------------------------------------------- reading
  E.list = function (b) {
    b = b || cur();
    var order = {}, kind = {};
    STORY.chapters(b).forEach(function (c, i) { order[c.id] = i; });
    E.KINDS.forEach(function (k, i) { kind[k] = i; });
    return STORY.records.list('evt_', b).slice().sort(function (x, y) {
      var ox = order[x.chapter] === undefined ? 99 : order[x.chapter], oy = order[y.chapter] === undefined ? 99 : order[y.chapter];
      var kx = kind[x.kind] === undefined ? 99 : kind[x.kind], ky = kind[y.kind] === undefined ? 99 : kind[y.kind];
      return ox - oy || kx - ky || ((x.name || '') < (y.name || '') ? -1 : (x.name || '') > (y.name || '') ? 1 : 0);
    });
  };
  // Where an event stands, in words.
  E.whereText = function (rec) {
    if (!U.isObj(rec)) return '';
    switch (rec.trigger) {
      case 'talk': return 'Talking to ' + nameOf(rec.npc, rec.npc || 'someone');
      case 'step': return 'Stepping on ' + (Array.isArray(rec.at) ? rec.at.join(', ') : '?') + ' in ' + nameOf(rec.map, rec.map || 'a map');
      case 'mapEnter': return 'Entering ' + nameOf(rec.map, rec.map || 'a map');
      case 'autorun': return 'At once in ' + nameOf(rec.map, rec.map || 'a map');
      case 'battleEnd': return 'After ' + (rec.trp ? 'a battle with ' + nameOf(rec.trp, rec.trp) : 'any battle');
      case 'chapterStart': return 'When the chapter starts';
    }
    return 'Unknown trigger';
  };
  E.summary = function (b) {
    b = b || cur();
    var recs = STORY.records.list('evt_', b), by = {}, pages = 0, cmds = 0, authored = 0, edited = 0, errors = 0, idx = recs.length ? STORY.engineIndex(b) : null;
    E.KINDS.forEach(function (k) { by[k] = 0; });
    recs.forEach(function (r) {
      by[r.kind] = (by[r.kind] || 0) + 1;
      (Array.isArray(r.pages) ? r.pages : []).forEach(function (p) { pages++; if (U.isObj(p)) cmds += E.tree.count(p.cmds); });
      if (r.origin === 'user') authored++;
      if (E.isEdited(r)) edited++;
      if (idx && E.check(r, b, idx).some(function (p) { return p.level === 'error'; })) errors++;
    });
    var ex = E.expected(b), slots = E.bosses(b).filter(function (x) { return x.slot; });
    return { total: recs.length, byKind: by, pages: pages, cmds: cmds, authored: authored, edited: edited, errors: errors, missing: ex.missing, stale: ex.stale, slots: slots };
  };

  // ---------------------------------------------------------------- the playtester
  // A start state: a new game, then the chapter (its gate flag and every earlier one set), quest stages, and flags.
  // opts {chapter, quests {qst: stage key, 'failed', or ''}, flags {flg: int}}.
  E.playState = function (b, opts) {
    b = b || cur();
    opts = opts || {};
    var idx = STORY.engineIndex(b), st = ES.state.create(idx, {});
    var ci = opts.chapter ? idx.chapters.indexOf(opts.chapter) : -1;
    for (var i = 0; i <= ci; i++) { var f = idx.chapterFlags[idx.chapters[i]]; if (f) st.flags[f] = 1; }
    Object.keys(opts.flags || {}).sort().forEach(function (k) { if (idx.flags[k]) st.flags[k] = Math.round(Number(opts.flags[k]) || 0); });
    Object.keys(opts.quests || {}).sort().forEach(function (q) {
      var def = idx.quests[q], stage = opts.quests[q];
      if (!def) return;
      if (stage === 'failed') st.quests[q] = { stage: st.quests[q].stage, failed: true, closed: [] };
      else if (stage && def.stageAt[stage] !== undefined) st.quests[q] = { stage: stage, failed: false, closed: [] };
    });
    st.chapter = ES.state.chapterOf(st, idx);
    return ES.util.copy(st);
  };
  // Effects that need nobody: the playtester logs them and carries on. Text, choices, battles, and the end stop it.
  var PASS = { music: 1, sfx: 1, fade: 1, wait: 1, moveActor: 1, face: 1, changeMap: 1, vehicle: 1, giveItem: 1, takeItem: 1, gil: 1, party: 1, questStage: 1, error: 1 };
  E.effectLine = function (e) {
    if (!U.isObj(e)) return null;
    switch (e.kind) {
      case 'text': return { cls: 'say', who: e.speaker ? nameOf(e.speaker, e.speaker) : '', text: (e.lines || []).join(' ') };
      case 'choice': return { cls: 'fx', text: e.prompt ? e.prompt : 'A choice.' };
      case 'startBattle': return { cls: 'fx', text: 'Battle against ' + nameOf(e.trp, e.trp || 'an unnamed troop') + '.' };
      case 'questStage': return { cls: 'fx', text: e.fail ? 'Quest failed: ' + nameOf(e.qst, e.qst) : 'Quest ' + nameOf(e.qst, e.qst) + (e.stage ? ' now at ' + stageLabel(e.qst, e.stage) : '') };
      case 'gil': return { cls: 'fx', text: 'Gil ' + (e.by >= 0 ? '+' : '') + e.by };
      case 'party': return { cls: 'fx', text: nameOf(e.chr, e.chr) + (e.act === 'leave' ? ' left the party' : ' joined the party') };
      case 'giveItem': case 'takeItem': return { cls: 'fx', text: (e.kind === 'takeItem' ? 'Lost ' : 'Got ') + (e.qty || 1) + ' ' + nameOf(e.itm, e.itm || 'an item') };
      case 'music': return { cls: 'stage', text: e.stop ? 'Music stops.' : 'Music: ' + (e.mus ? nameOf(e.mus, e.mus) : e.role) };
      case 'sfx': return { cls: 'stage', text: 'Sound: ' + nameOf(e.sfx, e.sfx) };
      case 'fade': return { cls: 'stage', text: 'Fade ' + e.to + '.' };
      case 'wait': return { cls: 'stage', text: 'Wait ' + e.frames + ' frames.' };
      case 'moveActor': return { cls: 'stage', text: who(e.who) + ' moves ' + (e.path || []).join(' ') + '.' };
      case 'face': return { cls: 'stage', text: who(e.who) + ' turns ' + e.dir + '.' };
      case 'changeMap': return { cls: 'stage', text: 'To ' + nameOf(e.map, e.map) + (Array.isArray(e.at) ? ' at ' + e.at.join(', ') : '') + '.' };
      case 'vehicle': return { cls: 'stage', text: (e.act === 'leave' ? 'Leave the ' : 'Board the ') + e.kind + '.' };
      case 'ending': return { cls: 'end', text: 'Ending: ' + nameOf(e.end, e.end) + '. The game is over.' };
      case 'gameover': return { cls: 'end', text: 'Game over: the battle was lost.' };
      case 'error': return { cls: 'err', text: 'Error: ' + (e.message || e.code) };
      case 'end': return { cls: 'fx', text: 'The event ends.' + (Array.isArray(e.quests) && e.quests.length ? ' ' + plural(e.quests.length, 'quest') + ' settled.' : '') };
      case 'none': return { cls: 'fx', text: 'Nothing happens: no page passes right now.' };
      case 'idle': return null;
    }
    return { cls: 'fx', text: 'Effect: ' + e.kind };
  };
  // A session is plain data: {evt, idx, frames [{r, log}]}. Every stop (text, choice, battle, the end) is a frame, so
  // Back returns to the state before the last one exactly. The engine owns every state; nothing here edits one.
  function stopHere(r) { return !U.isObj(r.effect) || r.done || r.waiting || !PASS[r.effect.kind]; }
  function run(sess, r, log) {
    log = log || [];
    for (var n = 0; n < 500; n++) {
      var ln = E.effectLine(r.effect); if (ln) log.push(ln);
      if (stopHere(r)) break;
      r = ES.run.step(r.state, sess.idx);
    }
    sess.frames.push({ r: r, log: log });
    return sess;
  }
  E.session = {
    begin: function (b, evt, state, opts) {
      b = b || cur();
      var idx = STORY.engineIndex(b), sess = { evt: evt, idx: idx, frames: [] };
      var page = opts && opts.page !== undefined && opts.page !== null ? opts.page : undefined;
      var pick = page !== undefined ? page : ES.pages.pick(evt, state, idx);
      var head = [{ cls: 'fx', text: pick >= 0 ? 'Page ' + (pick + 1) + ' runs.' : 'No page passes.' }];
      return run(sess, ES.run.start(state, evt, idx, page !== undefined ? { page: page } : null), head);
    },
    current: function (sess) { var f = sess && sess.frames[sess.frames.length - 1]; return f ? f.r : null; },
    next: function (sess) { var r = E.session.current(sess); if (!r || r.done || r.waiting) return sess; return run(sess, ES.run.step(r.state, sess.idx)); },
    choose: function (sess, option) { var r = E.session.current(sess), opt = r && r.effect && Array.isArray(r.effect.options) ? r.effect.options.filter(function (o) { return o.index === option; })[0] : null; return run(sess, ES.run.choose(r.state, option, sess.idx), [{ cls: 'pick', text: '> ' + (opt ? opt.text : 'option ' + (option + 1)) }]); },
    resolve: function (sess, outcome) { var r = E.session.current(sess); return run(sess, ES.run.resolve(r.state, outcome, sess.idx), [{ cls: 'pick', text: outcome === 'win' ? '> Won the battle' : outcome === 'lose' ? '> Lost the battle' : '> Escaped' }]); },
    back: function (sess) { if (sess && sess.frames.length > 1) sess.frames.pop(); return sess; },
    log: function (sess) { var out = []; (sess ? sess.frames : []).forEach(function (f) { out = out.concat(f.log); }); return out; }
  };
  // Runs one event to its end headlessly, answering each choice with its first visible option and each battle with a win.
  // Returns {state, effects, done}.
  E.runThrough = function (state, evt, idx, max) {
    var r = ES.run.start(state, evt, idx), effects = [];
    for (var n = 0; n < (max || 5000); n++) {
      effects.push(r.effect);
      if (r.done) break;
      if (r.waiting === 'choice') { var o = r.effect && Array.isArray(r.effect.options) && r.effect.options[0]; r = o ? ES.run.choose(r.state, o.index, idx) : ES.run.step(r.state, idx); continue; }
      if (r.waiting === 'battle') { r = ES.run.resolve(r.state, 'win', idx); continue; }
      r = ES.run.step(r.state, idx);
    }
    return { state: r.state, effects: effects, done: !!r.done };
  };
  // The golden path as a player who does what the story asks: from a new game, fire the first event in story order whose
  // active page has a condition (a page that waits for something, not an idle one), never the same event twice from the
  // same state, until the game ends or nothing is left to do. Returns {steps [{evt, name, page, effects [kinds]}], state,
  // ended, stuck}. A preview of the Phase 7 proof, not the proof itself: it follows one path.
  E.golden = function (b, opts) {
    b = b || cur();
    opts = opts || {};
    var idx = STORY.engineIndex(b), list = E.list(b).filter(function (e) { return idx.events[e.id]; }), st = ES.state.create(idx, {}), steps = [], tried = {};
    for (var n = 0; n < (opts.max || 400) && !st.ending; n++) {
      var h = ES.state.hash(st), pick = null;
      for (var i = 0; i < list.length && !pick; i++) {
        var e = list[i], p = ES.pages.pick(e.id, st, idx);
        if (p >= 0 && U.isObj(e.pages[p]) && e.pages[p].cond !== undefined && !tried[e.id + '@' + h]) pick = { e: e, p: p };
      }
      if (!pick) break;
      tried[pick.e.id + '@' + h] = 1;
      var r = E.runThrough(st, pick.e.id, idx);
      steps.push({ evt: pick.e.id, name: pick.e.name, page: pick.p, effects: r.effects.map(function (x) { return x && x.kind; }).filter(function (k) { return k && k !== 'end'; }) });
      st = r.state;
      if (!r.done) break;
    }
    return { steps: steps, state: st, ended: st.ending || null, stuck: !st.ending };
  };
  // What the inspector shows: {chapter, gil, party, items, flags [{flg, name, value, def, changed}], quests [{qst, name,
  // stage, label, failed, done, closed}], ending, running}.
  E.inspect = function (state, idx, b) {
    b = b || cur();
    var flags = [], quests = [], items = [];
    Object.keys(idx.flags).sort().forEach(function (f) { var v = ES.state.flag(state, idx, f), d = idx.flags[f]['default']; flags.push({ flg: f, name: nameOf(f, f), value: v, def: d, changed: v !== d }); });
    Object.keys(idx.quests).sort().forEach(function (q) {
      var s0 = state.quests[q] || { stage: null, failed: false, closed: [] }, def = idx.quests[q], last = def.stages.length ? def.stages[def.stages.length - 1].key : null;
      quests.push({ qst: q, name: nameOf(q, q), stage: s0.stage, label: s0.stage ? stageLabel(q, s0.stage) : 'Not started', failed: !!s0.failed, done: !s0.failed && s0.stage !== null && s0.stage === last, closed: (s0.closed || []).slice() });
    });
    Object.keys(state.items || {}).sort().forEach(function (k) { items.push({ itm: k, name: nameOf(k, k), qty: state.items[k] }); });
    return { chapter: state.chapter, chapterName: nameOf(state.chapter, state.chapter || ''), gil: state.gil, party: (state.party || []).slice(), items: items, flags: flags, quests: quests, ending: state.ending, running: !!state.run };
  };
})();
// === STORY:EVENTS END ===
