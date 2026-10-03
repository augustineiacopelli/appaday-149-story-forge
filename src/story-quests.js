// === STORY:QUESTS BEGIN ===
(function () {
  'use strict';
  // Phase 3: quests as state machines. A qst_ record is the shape the engine already reads (ENGINE_STORY.index questShape):
  //   kind main | side | bstory, chapter, giver (npc_), chr (chr_, B stories), name, notes
  //   stages [{key, label, sets [{flg, value}], exitWhen cond, site, note}]   in order; the last stage ends the quest
  //   branches [{key, label, at (a stage key, drawing hint), outcomes [{key, label, sets}]}]   exclusive groups
  //   fail {cond, sets}   completeFlag (flg_)   reads (derived, the flags its conditions read)   rewards [{item, qty}]
  // The scaffold builds, from the world and the Charter and with structural IDs (so a rerun renames nothing):
  //   one main quest per chapter, straight from the golden path: arrive, clear the key dungeon, defeat the boss, take the exit
  //   one side quest per side quest seed (sdq_), offer, accept, done, its completion flag the seed's own flag
  //   one B story quest per character whose bStoryline is not empty, one stage per beat of the text
  // Main and B story quests get a completion flag of their own (family flg|qdone|<qst>). The scaffold never edits a world
  // record, never overwrites a record that exists (an author's edits stay), and drops a generated quest only when the
  // world, the seeds, or the Charter no longer ask for it. Quests the author makes by hand use Kit.ids.mint (origin user).
  var U = Kit.util, ES = ENGINE_STORY, F = STORY.flags;
  function cur() { return Kit.bundle.current(); }
  var Q = STORY.quests = {};
  Q.KINDS = ['main', 'side', 'bstory'];
  Q.KIND_LABEL = { main: 'Main', side: 'Side', bstory: 'B story' };
  Q.KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
  Q.MAX_STAGES = ES.save.LIMITS.stages;
  Q.MAX_GROUPS = ES.save.LIMITS.groups;
  Q.DONE_FAMILY = 'flg|qdone|';
  Q.MAX_BEATS = 5;
  var isInt = F.isInt;
  function sortedObj(o) { var r = {}; Object.keys(o || {}).sort().forEach(function (k) { r[k] = o[k]; }); return r; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function trim(s) { return String(s === undefined || s === null ? '' : s).trim(); }
  function hasChapter(id, b) { return STORY.chapters(b).some(function (x) { return x.id === id; }); }
  function chapterName(id, b) { var c = STORY.chapters(b).filter(function (x) { return x.id === id; })[0]; return c ? (c.name || id) : id; }
  function cut(s, n) { s = trim(s); if (s.length <= n) return s; return s.slice(0, n - 3).replace(/\s+\S*$/, '') + '...'; }

  // ---------------------------------------------------------------- the Codex type
  var SETS_OF = [
    { key: 'flg', label: 'Flag', type: 'ref', refPrefix: 'flg_', required: true },
    { key: 'value', label: 'Value', type: 'int', min: F.INT_MIN, max: F.INT_MAX }
  ];
  var QUEST_FIELDS = [
    { key: 'kind', label: 'Kind', type: 'enum', values: Q.KINDS, required: true, help: 'main: one per chapter on the golden path. side: from a side quest seed. bstory: a character\'s personal subplot.' },
    { key: 'giver', label: 'Giver', type: 'ref', refPrefix: 'npc_', help: 'The person who offers the quest.' },
    { key: 'chr', label: 'Character', type: 'ref', refPrefix: 'chr_', help: 'The party member a B story belongs to.' },
    { key: 'completeFlag', label: 'Completion flag', type: 'ref', refPrefix: 'flg_', help: 'The engine sets this flag to 1 when the last stage is entered.' },
    { key: 'stages', label: 'Stages', type: 'list', itemLabel: 'Stage', help: 'In order. A stage moves on when its exit condition passes or when an event moves it. The last stage ends the quest.', of: [
      { key: 'key', label: 'Key', type: 'text', required: true, max: 32 },
      { key: 'label', label: 'Label', type: 'text', required: true, max: 120 },
      { key: 'site', label: 'Site', type: 'text', max: 160, help: 'The Day 148 progression node this stage happens at.' },
      { key: 'note', label: 'Note', type: 'text', max: 300 },
      { key: 'sets', label: 'Sets when entered', type: 'list', itemLabel: 'Flag', of: SETS_OF },
      { key: 'exitWhen', label: 'Exits when', type: 'object' }
    ] },
    { key: 'branches', label: 'Branches', type: 'list', itemLabel: 'Group', help: 'Exclusive groups: committing to one outcome closes the others.', of: [
      { key: 'key', label: 'Key', type: 'text', required: true, max: 32 },
      { key: 'label', label: 'Label', type: 'text', required: true, max: 120 },
      { key: 'at', label: 'Decided at stage', type: 'text', max: 32 },
      { key: 'outcomes', label: 'Outcomes', type: 'list', itemLabel: 'Outcome', of: [
        { key: 'key', label: 'Key', type: 'text', required: true, max: 32 },
        { key: 'label', label: 'Label', type: 'text', required: true, max: 120 },
        { key: 'sets', label: 'Sets', type: 'list', itemLabel: 'Flag', of: SETS_OF }
      ] }
    ] },
    { key: 'fail', label: 'Failure', type: 'object', of: [
      { key: 'cond', label: 'Fails when', type: 'object' },
      { key: 'sets', label: 'Sets when failed', type: 'list', itemLabel: 'Flag', of: SETS_OF }
    ] },
    { key: 'reads', label: 'Reads', type: 'refList', refPrefix: 'flg_', derived: true, help: 'The flags its conditions read. Derived.' },
    { key: 'rewards', label: 'Rewards', type: 'list', itemLabel: 'Reward', of: [
      { key: 'item', label: 'Item', type: 'ref', refPrefix: ['itm_', 'eqp_'], required: true },
      { key: 'qty', label: 'Quantity', type: 'int', min: 1, max: 99 }
    ] },
    { key: 'notes', label: 'Note', type: 'longtext', max: 1200 }
  ];
  Kit.codex.register({ name: STORY.TYPES['qst_'].name, prefix: 'qst_', label: STORY.TYPES['qst_'].label, ns: 'story', forge: STORY.FORGE, group: 'story', dependsOn: [], fields: U.clone(STORY.ENVELOPE_FIELDS).concat(QUEST_FIELDS) });

  // ---------------------------------------------------------------- ids
  Q.idFor = function (key) { return ES.ids.structural('qst_', key); };
  Q.mainKey = function (chp) { return 'qst|main|' + chp; };
  Q.sideKey = function (sdq) { return 'qst|side|' + sdq; };
  Q.bstoryKey = function (chr) { return 'qst|bstory|' + chr; };
  Q.doneId = function (qst) { return F.idFor(Q.DONE_FAMILY + qst); };

  // ---------------------------------------------------------------- reading the world
  function gateFlag(b, key) { var bd = b.story.bindings[key]; return U.isObj(bd) && typeof bd.flg === 'string' && bd.flg ? bd.flg : F.gateId(key); }
  function flagTest(flg) { return { op: 'flag', flg: flg, cmp: 'gte', value: 1 }; }
  function allOf(list) { return list.length === 0 ? null : list.length === 1 ? list[0] : { op: 'all', of: list }; }
  function nameOfWorld(id, fallback, b) { var r = id && STORY.world.get(id, b); return r && r.name ? r.name : fallback; }
  function chapterNodes(g, chp) {
    var m = {};
    g.nodes.forEach(function (n) { if (n.chapter === chp && n.golden && n.kind && n.role && !m[n.kind + ':' + n.role]) m[n.kind + ':' + n.role] = n; });
    return m;
  }
  function pickGiver(town, b) {
    var ids = town && Array.isArray(town.people) ? town.people : [], recs = ids.map(function (id) { return STORY.world.get(id, b); }).filter(function (r) { return !!r; });
    var pick = recs.filter(function (r) { return /elder/i.test(r.name || ''); })[0] || recs.filter(function (r) { return r.role === 'resident'; })[0] ||
      recs.filter(function (r) { return r.role === 'innkeeper'; })[0] || recs[0];
    return pick ? pick.id : null;
  }
  // The golden path of one chapter as quest stages. Gate flags come from the story's own bindings.
  function mainBody(chp, i, b) {
    var g = STORY.world.graph(b), n = g ? chapterNodes(g, chp) : {}, last = i === STORY.chapters(b).length - 1;
    var town = n['twn:start'], keyN = n['dgn:key'], boss = n['dgn:boss'], exit = n['gate:exit'];
    var townRec = town && town.record ? STORY.world.get(town.record, b) : null;
    var grantsOf = function (node, wantSeal) { return (node && node.grants || []).filter(function (k) { var kind = ES.gates.parse(k).kind; return wantSeal ? kind === 'seal' : kind !== 'seal'; }).map(function (k) { return flagTest(gateFlag(b, k)); }); };
    var stages = [];
    stages.push({ key: 'arrive', label: 'Arrive at ' + (townRec && townRec.name || 'the start town'), sets: [], site: town ? town.key : undefined });
    if (keyN) stages.push({ key: 'key', label: 'Clear ' + nameOfWorld(keyN.record, 'the key dungeon', b), sets: [], exitWhen: allOf(grantsOf(keyN, true)) || undefined, site: keyN.key });
    if (boss) stages.push({ key: 'boss', label: 'Defeat the boss at ' + nameOfWorld(boss.record, 'the boss dungeon', b), sets: [], exitWhen: allOf(grantsOf(boss, false)) || undefined, site: boss.key });
    if (exit) {
      var reg = (g.regions || []).filter(function (r) { return r.key === exit.to; })[0];
      stages.push({ key: 'exit', label: reg ? 'Take the road to ' + (reg.label || 'the next region') : 'Take the exit', sets: [], site: exit.key });
    }
    stages.push({ key: 'done', label: last ? 'The finale is won' : 'Chapter complete', sets: [] });
    stages.forEach(function (st) { if (st.exitWhen === undefined) delete st.exitWhen; if (st.site === undefined) delete st.site; });
    var body = { kind: 'main', chapter: chp, stages: stages, branches: [], rewards: [], notes: 'The golden path of ' + chapterName(chp, b) + ', one stage for each site Day 148 puts on it.' };
    var giver = pickGiver(townRec, b);
    if (giver) body.giver = giver;
    return body;
  }
  function sideBody(q, b) {
    var gv = q.giver ? nameOfWorld(q.giver, 'the giver', b) : '', rewards = [];
    (Array.isArray(q.rewards) ? q.rewards : []).forEach(function (r) { if (U.isObj(r) && typeof r.item === 'string') rewards.push(isInt(r.qty) ? { item: r.item, qty: r.qty } : { item: r.item }); });
    var have = typeof q.flag === 'string' && Kit.ids.prefixOf(q.flag) === 'flg_' && b.story.records.flg_[q.flag] ? q.flag : F.doneId(q.id);
    var body = { kind: 'side', stages: [
      { key: 'offer', label: gv ? gv + ' asks for help' : 'Hear the request', sets: [] },
      { key: 'accept', label: q.name || 'Do what was asked', sets: [] },
      { key: 'done', label: 'Quest complete', sets: [] }], branches: [], rewards: rewards, completeFlag: have, notes: trim(q.text) };
    if (typeof q.chapter === 'string' && hasChapter(q.chapter, b)) body.chapter = q.chapter;
    if (typeof q.giver === 'string' && q.giver) body.giver = q.giver;
    return body;
  }
  // The beats of a free text storyline: one per line, or one per sentence when it is a single paragraph.
  Q.beats = function (text) {
    var t = trim(String(text || '').replace(/\r/g, '')), parts;
    if (!t) return [];
    parts = t.split(/\n+/).map(trim).filter(Boolean);
    if (parts.length === 1) parts = (t.match(/[^.!?]+[.!?]*/g) || []).map(trim).filter(Boolean);
    return parts.slice(0, Q.MAX_BEATS).map(function (s) { return cut(s, 80); });
  };
  function bstoryBody(c, b) {
    var beats = Q.beats(c.bStoryline), stages = [{ key: 'meet', label: 'Meet ' + (c.name || 'the character'), sets: [] }];
    beats.forEach(function (t, i) { stages.push({ key: 'beat' + (i + 1), label: t, sets: [] }); });
    stages.push({ key: 'done', label: 'Their story is told', sets: [] });
    return { kind: 'bstory', chr: c.id, stages: stages, branches: [], rewards: [], notes: trim(c.bStoryline) };
  }

  // Every quest the world, the seeds, and the Charter ask for, in a stable order: [{key, id, name, kind, body, flag}], where
  // flag is the completion flag the scaffold makes for it (main and B story quests; a side quest uses its seed's flag).
  Q.wanted = function (b) {
    b = b || cur();
    var out = [], s = b && b.story, set = s && s.settings && s.settings.scaffold || {};
    if (!b || !s) return out;
    STORY.chapters(b).forEach(function (c, i) {
      if (typeof c.id !== 'string') return;
      var key = Q.mainKey(c.id), id = Q.idFor(key);
      out.push({ key: key, id: id, name: 'Main: ' + (c.name || c.id), kind: 'main', body: mainBody(c.id, i, b), flag: true });
    });
    if (set.sideQuests !== false) STORY.rules('sdq_', b).forEach(function (q) {
      var key = Q.sideKey(q.id);
      out.push({ key: key, id: Q.idFor(key), name: q.name || q.id, kind: 'side', body: sideBody(q, b), flag: false });
    });
    if (set.bStories !== false) STORY.rules('chr_', b).forEach(function (c) {
      if (!Q.beats(c.bStoryline).length) return;
      var key = Q.bstoryKey(c.id);
      out.push({ key: key, id: Q.idFor(key), name: (c.name || c.id) + ': B story', kind: 'bstory', body: bstoryBody(c, b), flag: true });
    });
    out.forEach(function (w) { if (w.flag) w.body.completeFlag = Q.doneId(w.id); w.body.reads = Q.readsOf(w.body); });
    return out;
  };
  function completionFlag(w) {
    var body = { kind: 'quest', 'default': 0, range: [0, 1], notes: 'Set when the quest ' + w.name + ' is finished. The engine sets it when the last stage is entered.' };
    if (w.body.chapter) body.chapter = w.body.chapter;
    return { key: Q.DONE_FAMILY + w.id, name: w.name + ' completed', body: body };
  }

  // ---------------------------------------------------------------- reads
  Q.readsOf = function (q) {
    var seen = {};
    function add(tree) { ES.cond.reads(tree).flags.forEach(function (f) { seen[f] = 1; }); }
    (Array.isArray(q && q.stages) ? q.stages : []).forEach(function (st) { if (U.isObj(st) && st.exitWhen !== undefined && st.exitWhen !== null) add(st.exitWhen); });
    if (U.isObj(q && q.fail) && q.fail.cond !== undefined && q.fail.cond !== null) add(q.fail.cond);
    return Object.keys(seen).sort();
  };

  // ---------------------------------------------------------------- the scaffold
  // Makes what is missing and drops generated quests nothing asks for any more. Idempotent: a second run changes nothing and
  // does not touch the bundle. Binds the gates and the side quest flags first (STORY.flags.sync), and syncs again at the end
  // so every quest gets its save slot flag. Returns a report.
  Q.scaffold = function (b) {
    b = b || cur();
    var rep = { created: [], removed: [], flagsMade: [], flagsDropped: [], changed: false, skipped: null, sync: null };
    if (!b) { rep.skipped = 'No bundle is open.'; return rep; }
    var ready = STORY.readiness(b);
    if (ready !== true) { rep.skipped = ready; return rep; }
    STORY.ensure(b);
    F.sync(b);
    var s = b.story, R = s.records.qst_, FL = s.records.flg_, scaf = s.scaffold, W = Q.wanted(b), want = {}, wantFlag = {};
    W.forEach(function (w) {
      want[w.key] = w;
      if (!R[w.id]) { R[w.id] = STORY.envelope('qst_', w.key, w.name, w.body); rep.created.push(w.id); }
      if (scaf[w.key] !== w.id) { scaf[w.key] = w.id; rep.changed = true; }
      if (w.flag) {
        var f = completionFlag(w), fid = F.idFor(f.key);
        wantFlag[f.key] = 1;
        if (!FL[fid]) { FL[fid] = STORY.envelope('flg_', f.key, f.name, f.body); rep.flagsMade.push(fid); }
        if (scaf[f.key] !== fid) { scaf[f.key] = fid; rep.changed = true; }
      }
    });
    Object.keys(scaf).sort().forEach(function (k) {
      var id = scaf[k];
      if (k.indexOf('qst|') === 0 && !want[k]) {
        if (R[id] && R[id].origin === 'generated') { delete R[id]; rep.removed.push(id); }
        delete scaf[k]; rep.changed = true;
      } else if (k.indexOf(Q.DONE_FAMILY) === 0 && !wantFlag[k]) {
        if (FL[id] && FL[id].origin === 'generated') { delete FL[id]; rep.flagsDropped.push(id); }
        delete scaf[k]; rep.changed = true;
      }
    });
    if (rep.created.length || rep.removed.length || rep.flagsMade.length || rep.flagsDropped.length || rep.changed) {
      s.records.qst_ = sortedObj(R); s.records.flg_ = sortedObj(FL); s.scaffold = sortedObj(scaf);
      rep.changed = true;
      if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-quests'); }
    }
    rep.sync = F.sync(b);
    if (rep.sync.changed) rep.changed = true;
    return rep;
  };
  Q.reportText = function (rep) {
    if (rep.skipped) return 'Nothing to build: ' + rep.skipped;
    if (!rep.changed) return 'Every quest the world asks for is already built.';
    var bits = [];
    if (rep.created.length) bits.push(plural(rep.created.length, 'quest') + ' built');
    if (rep.removed.length) bits.push(plural(rep.removed.length, 'quest') + ' dropped');
    if (rep.flagsMade.length) bits.push(plural(rep.flagsMade.length, 'completion flag') + ' made');
    if (rep.sync && rep.sync.created.length) bits.push(plural(rep.sync.created.length, 'flag') + ' made for saves and side quests');
    return (bits.join(', ') || 'Quests brought up to date') + '.';
  };
  // What a scaffold run would build and what is already there, by kind.
  Q.expected = function (b) {
    b = b || cur();
    var s = b && b.story, W = Q.wanted(b), by = {};
    Q.KINDS.forEach(function (k) { by[k] = { want: 0, have: 0 }; });
    W.forEach(function (w) { by[w.kind].want++; if (s && s.records.qst_[w.id]) by[w.kind].have++; });
    var missing = W.filter(function (w) { return !(s && s.records.qst_[w.id]); }).length;
    return { by: by, total: W.length, missing: missing };
  };
  Q.setScaffold = function (key, on, b) {
    b = b || cur();
    if (!b || ['sideQuests', 'bStories'].indexOf(key) < 0) return { ok: false, message: 'That is not a scaffold setting.' };
    STORY.ensure(b);
    if (!U.isObj(b.story.settings.scaffold)) b.story.settings.scaffold = {};
    b.story.settings.scaffold[key] = !!on;
    if (b === cur()) Kit.bundle.touch('story-settings');
    return { ok: true };
  };

  // ---------------------------------------------------------------- checks
  function dupFree(list, key) { var seen = {}, dup = null; list.forEach(function (x) { if (U.isObj(x) && typeof x[key] === 'string') { if (seen[x[key]] && !dup) dup = x[key]; seen[x[key]] = 1; } }); return dup; }
  // Cross field mistakes the Codex field checks cannot see: [{level, code, path, message}]. idx is the engine's index
  // (STORY.engineIndex), which must hold the record being checked.
  Q.check = function (rec, b, idx) {
    b = b || cur(); idx = idx || STORY.engineIndex(b);
    var out = [], flags = b && b.story ? b.story.records.flg_ : {};
    function add(level, code, path, message) { out.push({ level: level, code: code, path: path, message: message }); }
    if (!U.isObj(rec)) { add('error', 'shape', '', 'A quest must be an object.'); return out; }
    if (typeof rec.name !== 'string' || !rec.name.trim()) add('error', 'name', 'name', 'A quest needs a name.');
    if (Q.KINDS.indexOf(rec.kind) < 0) add('error', 'kind', 'kind', 'Kind must be main, side, or bstory.');
    function setsCheck(list, path) {
      if (list === undefined) return;
      if (!Array.isArray(list)) { add('error', 'sets', path, 'Sets must be a list of flag changes.'); return; }
      list.forEach(function (x, i) {
        var p = path + '[' + i + ']';
        if (!U.isObj(x) || typeof x.flg !== 'string' || !x.flg) add('error', 'sets', p + '.flg', 'Each change needs a flag.');
        else if (!flags[x.flg]) add('error', 'ref', p + '.flg', x.flg + ' is not a flag in this story.');
        if (U.isObj(x) && x.value !== undefined && !isInt(x.value)) add('error', 'not-int', p + '.value', 'The value must be a whole number.');
      });
    }
    var keys = {};
    if (!Array.isArray(rec.stages) || !rec.stages.length) add('error', 'stages', 'stages', 'A quest needs at least one stage.');
    else {
      if (rec.stages.length > Q.MAX_STAGES) add('error', 'save-limit', 'stages', 'A quest can hold ' + Q.MAX_STAGES + ' stages in a save; this one has ' + rec.stages.length + '.');
      rec.stages.forEach(function (st, i) {
        var p = 'stages[' + i + ']';
        if (!U.isObj(st)) { add('error', 'stage', p, 'A stage must be an object.'); return; }
        if (typeof st.key !== 'string' || !Q.KEY_RE.test(st.key)) add('error', 'stage-key', p + '.key', 'A stage key uses lowercase letters, digits, and underscores, starts with a letter, and holds up to 32 characters.');
        else if (keys[st.key] !== undefined) add('error', 'stage-dup', p + '.key', 'Two stages use the key ' + st.key + '.');
        else keys[st.key] = i;
        if (typeof st.label !== 'string' || !st.label.trim()) add('error', 'stage-label', p + '.label', 'Each stage needs a label.');
        setsCheck(st.sets, p + '.sets');
        if (st.exitWhen !== undefined && st.exitWhen !== null) {
          ES.cond.lint(st.exitWhen, idx, p + '.exitWhen').forEach(function (x) { add(x.level, x.code, x.path, x.message); });
          if (i === rec.stages.length - 1) add('warning', 'last-exit', p + '.exitWhen', 'The last stage ends the quest, so its exit condition is never used.');
        }
      });
    }
    if (rec.branches !== undefined && !Array.isArray(rec.branches)) add('error', 'branches', 'branches', 'Branches must be a list of groups.');
    else if (Array.isArray(rec.branches)) {
      if (rec.branches.length > Q.MAX_GROUPS) add('error', 'save-limit', 'branches', 'A quest can hold ' + Q.MAX_GROUPS + ' branch groups in a save; this one has ' + rec.branches.length + '.');
      var gdup = dupFree(rec.branches, 'key');
      if (gdup) add('error', 'group-dup', 'branches', 'Two branch groups use the key ' + gdup + '.');
      rec.branches.forEach(function (g, i) {
        var p = 'branches[' + i + ']';
        if (!U.isObj(g)) { add('error', 'group', p, 'A branch group must be an object.'); return; }
        if (typeof g.key !== 'string' || !Q.KEY_RE.test(g.key)) add('error', 'group-key', p + '.key', 'A group key uses lowercase letters, digits, and underscores, and starts with a letter.');
        if (typeof g.label !== 'string' || !g.label.trim()) add('error', 'group-label', p + '.label', 'Each branch group needs a label.');
        if (g.at !== undefined && g.at !== '' && keys[g.at] === undefined) add('error', 'group-at', p + '.at', 'The group is decided at stage ' + g.at + ', which is not a stage of this quest.');
        var outs = Array.isArray(g.outcomes) ? g.outcomes : [];
        if (outs.length < 2) add('warning', 'one-outcome', p + '.outcomes', 'A group with fewer than two outcomes is not a choice.');
        var odup = dupFree(outs, 'key');
        if (odup) add('error', 'outcome-dup', p + '.outcomes', 'Two outcomes of this group use the key ' + odup + '.');
        outs.forEach(function (o, j) {
          var op = p + '.outcomes[' + j + ']';
          if (!U.isObj(o)) { add('error', 'outcome', op, 'An outcome must be an object.'); return; }
          if (typeof o.key !== 'string' || !Q.KEY_RE.test(o.key)) add('error', 'outcome-key', op + '.key', 'An outcome key uses lowercase letters, digits, and underscores, and starts with a letter.');
          if (typeof o.label !== 'string' || !o.label.trim()) add('error', 'outcome-label', op + '.label', 'Each outcome needs a label.');
          setsCheck(o.sets, op + '.sets');
        });
      });
    }
    if (rec.fail !== undefined && rec.fail !== null) {
      if (!U.isObj(rec.fail)) add('error', 'fail', 'fail', 'Failure must hold a condition and the flags it sets.');
      else {
        if (rec.fail.cond !== undefined && rec.fail.cond !== null) ES.cond.lint(rec.fail.cond, idx, 'fail.cond').forEach(function (x) { add(x.level, x.code, x.path, x.message); });
        setsCheck(rec.fail.sets, 'fail.sets');
      }
    }
    if (rec.completeFlag === undefined || rec.completeFlag === null || rec.completeFlag === '') add('warning', 'no-complete', 'completeFlag', 'This quest has no completion flag, so nothing can read that it is finished.');
    else if (typeof rec.completeFlag !== 'string' || Kit.ids.prefixOf(rec.completeFlag) !== 'flg_' || !flags[rec.completeFlag]) add('error', 'ref', 'completeFlag', 'The completion flag ' + rec.completeFlag + ' is not a flag in this story.');
    if (rec.giver !== undefined && rec.giver !== null && rec.giver !== '' && (Kit.ids.prefixOf(rec.giver) !== 'npc_' || !STORY.world.get(rec.giver, b))) add('error', 'ref', 'giver', 'The giver ' + rec.giver + ' is not a person in the world.');
    if (rec.chr !== undefined && rec.chr !== null && rec.chr !== '' && (Kit.ids.prefixOf(rec.chr) !== 'chr_' || !STORY.rules('chr_', b).some(function (c) { return c.id === rec.chr; }))) add('error', 'ref', 'chr', 'The character ' + rec.chr + ' is not in the party rules.');
    if (rec.chapter !== undefined && rec.chapter !== null && rec.chapter !== '' && !hasChapter(rec.chapter, b)) add('error', 'ref', 'chapter', 'The chapter ' + rec.chapter + ' is not in the Charter.');
    if (rec.rewards !== undefined) {
      if (!Array.isArray(rec.rewards)) add('error', 'rewards', 'rewards', 'Rewards must be a list.');
      else rec.rewards.forEach(function (r, i) {
        var p = 'rewards[' + i + ']', ok = U.isObj(r) && typeof r.item === 'string' && (STORY.rules('itm_', b).concat(STORY.rules('eqp_', b))).some(function (x) { return x.id === r.item; });
        if (!ok) add('error', 'ref', p + '.item', 'A reward needs an item or equipment from the Rules.');
        else if (r.qty !== undefined && (!isInt(r.qty) || r.qty < 1 || r.qty > 99)) add('error', 'qty', p + '.qty', 'The quantity must be a whole number from 1 to 99.');
      });
    }
    return out;
  };
  Kit.validate.register('story.quests', function (b, ctx) {
    var s = b.story;
    if (!s || !U.isObj(s.records) || !U.isObj(s.records.qst_)) return;
    var ids = Object.keys(s.records.qst_).sort();
    if (!ids.length) return;
    var idx = STORY.engineIndex(b), users = {};
    ids.forEach(function (id) {
      var rec = s.records.qst_[id];
      if (!U.isObj(rec)) return;
      Q.check(rec, b, idx).forEach(function (p) { if (p.code === 'no-complete') return; ctx.add({ recordId: id, fieldPath: p.path, message: p.message, level: p.level }); });
      if (typeof rec.completeFlag === 'string' && rec.completeFlag) (users[rec.completeFlag] = users[rec.completeFlag] || []).push(id);
    });
    Object.keys(users).sort().forEach(function (f) { if (users[f].length > 1) ctx.add({ recordId: users[f][0], fieldPath: 'completeFlag', message: 'Quests ' + users[f].join(' and ') + ' share one completion flag (' + f + '), so they finish together as far as the story can tell.', level: 'warning' }); });
  });

  // ---------------------------------------------------------------- editing
  function sameProblem(a, z) { return a.code === z.code && a.path === z.path && a.message === z.message; }
  function indexWith(rec, b) {
    var recs = {};
    Object.keys(b.story.records).forEach(function (p) { recs[p] = b.story.records[p]; });
    recs.qst_ = {};
    Object.keys(b.story.records.qst_).forEach(function (k) { recs.qst_[k] = b.story.records.qst_[k]; });
    recs.qst_[rec.id] = rec;
    return ES.index.build({ records: recs, bindings: b.story.bindings }, STORY.engineExt(b));
  }
  Q.indexWith = indexWith;
  // Applies fn to a copy of the quest. A result with an error string refuses the edit. The edit is refused too when it
  // would add an error the quest did not already have (problems it already had never block an unrelated change); nothing
  // is written then. Returns {ok, record} or {ok: false, problems}.
  Q.edit = function (id, fn, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.qst_, rec = R && R[id];
    if (!rec) return { ok: false, problems: [{ level: 'error', code: 'missing', path: 'id', message: 'That quest does not exist.' }] };
    var before = Q.check(rec, b, STORY.engineIndex(b)).filter(function (p) { return p.level === 'error'; });
    var next = U.clone(rec), r = fn(next);
    if (r && r.error) return { ok: false, problems: [{ level: 'error', code: 'edit', path: '', message: r.error }] };
    next.reads = Q.readsOf(next);
    var fresh = Q.check(next, b, indexWith(next, b)).filter(function (p) { return p.level === 'error' && !before.some(function (x) { return sameProblem(x, p); }); });
    if (fresh.length) return { ok: false, problems: fresh };
    R[id] = next;
    if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-quest'); }
    return { ok: true, record: next };
  };
  function findStage(q, key) { for (var i = 0; i < q.stages.length; i++) if (q.stages[i].key === key) return i; return -1; }
  function findGroup(q, key) { var l = q.branches || []; for (var i = 0; i < l.length; i++) if (l[i].key === key) return i; return -1; }
  function freeKey(list, base) { var n = 1, used = {}; list.forEach(function (x) { if (U.isObj(x)) used[x.key] = 1; }); while (used[base + n]) n++; return base + n; }
  function cleanSets(sets) {
    var out = [];
    (Array.isArray(sets) ? sets : []).forEach(function (x) { if (U.isObj(x) && typeof x.flg === 'string' && x.flg) out.push({ flg: x.flg, value: x.value === undefined || x.value === '' ? 1 : x.value }); });
    return out;
  }
  Q.freeStageKey = function (q) { return freeKey(q.stages || [], 'step'); };
  Q.freeGroupKey = function (q) { return freeKey(q.branches || [], 'choice'); };
  Q.freeOutcomeKey = function (g) { return freeKey(g.outcomes || [], 'outcome'); };

  // Quest level fields: name, notes, chapter, giver, chr, completeFlag, rewards. null clears an optional field.
  Q.update = function (id, patch, b) {
    patch = patch || {};
    return Q.edit(id, function (q) {
      if (patch.name !== undefined) q.name = trim(patch.name);
      if (patch.notes !== undefined) q.notes = String(patch.notes);
      ['chapter', 'giver', 'chr', 'completeFlag'].forEach(function (k) { if (patch[k] !== undefined) { if (patch[k] === null || patch[k] === '') delete q[k]; else q[k] = patch[k]; } });
      if (patch.rewards !== undefined) q.rewards = (Array.isArray(patch.rewards) ? patch.rewards : []).map(function (r) { return U.isObj(r) ? (isInt(r.qty) ? { item: r.item, qty: r.qty } : { item: r.item }) : r; });
    }, b);
  };
  // spec: {key, label, at (index; default just before the last stage, so the ending stays last)}.
  Q.addStage = function (id, spec, b) {
    spec = spec || {};
    return Q.edit(id, function (q) {
      var key = trim(spec.key) || freeKey(q.stages, 'step'), st = { key: key, label: trim(spec.label) || 'New stage', sets: [] };
      var at = typeof spec.at === 'number' ? spec.at : Math.max(0, q.stages.length - 1);
      q.stages.splice(Math.max(0, Math.min(at, q.stages.length)), 0, st);
    }, b);
  };
  // patch: label, sets (a list), exitWhen (a condition, or null to remove it), site, note.
  Q.updateStage = function (id, key, patch, b) {
    patch = patch || {};
    return Q.edit(id, function (q) {
      var i = findStage(q, key);
      if (i < 0) return { error: 'Stage ' + key + ' is not in this quest.' };
      var st = q.stages[i];
      if (patch.label !== undefined) st.label = trim(patch.label);
      if (patch.sets !== undefined) st.sets = cleanSets(patch.sets);
      if (patch.exitWhen !== undefined) { if (patch.exitWhen === null) delete st.exitWhen; else st.exitWhen = patch.exitWhen; }
      ['site', 'note'].forEach(function (k) { if (patch[k] !== undefined) { if (patch[k] === null || patch[k] === '') delete st[k]; else st[k] = String(patch[k]); } });
    }, b);
  };
  // Replaces a whole stage at once (label, sets, exitWhen, site, note), keeping its key unless spec.key renames it. The
  // editor holds a draft and commits it here, so a half built condition never reaches the record.
  Q.replaceStage = function (id, key, spec, b) {
    spec = spec || {};
    return Q.edit(id, function (q) {
      var i = findStage(q, key);
      if (i < 0) return { error: 'Stage ' + key + ' is not in this quest.' };
      var st = { key: trim(spec.key) || key, label: trim(spec.label), sets: cleanSets(spec.sets) };
      if (spec.exitWhen !== undefined && spec.exitWhen !== null) st.exitWhen = spec.exitWhen;
      if (trim(spec.site)) st.site = trim(spec.site);
      if (trim(spec.note)) st.note = trim(spec.note);
      q.stages[i] = st;
      if (st.key !== key) (q.branches || []).forEach(function (g) { if (g.at === key) g.at = st.key; });
    }, b);
  };
  // Replaces a whole branch group: {key, label, at, outcomes [{key, label, sets}]}.
  Q.replaceGroup = function (id, key, spec, b) {
    spec = spec || {};
    return Q.edit(id, function (q) {
      var i = findGroup(q, key);
      if (i < 0) return { error: 'Branch group ' + key + ' is not in this quest.' };
      var g = { key: trim(spec.key) || key, label: trim(spec.label), outcomes: (Array.isArray(spec.outcomes) ? spec.outcomes : []).map(function (o) { return { key: trim(o.key), label: trim(o.label), sets: cleanSets(o.sets) }; }) };
      if (spec.at) g.at = spec.at;
      q.branches[i] = g;
    }, b);
  };
  Q.moveStage = function (id, key, delta, b) {
    return Q.edit(id, function (q) {
      var i = findStage(q, key), j = i + delta;
      if (i < 0) return { error: 'Stage ' + key + ' is not in this quest.' };
      if (j < 0 || j >= q.stages.length) return { error: 'That stage cannot move further.' };
      var t = q.stages[i]; q.stages[i] = q.stages[j]; q.stages[j] = t;
    }, b);
  };
  Q.removeStage = function (id, key, b) {
    return Q.edit(id, function (q) {
      var i = findStage(q, key);
      if (i < 0) return { error: 'Stage ' + key + ' is not in this quest.' };
      if (q.stages.length <= 2) return { error: 'A quest keeps at least two stages: where it begins and where it ends.' };
      q.stages.splice(i, 1);
      (q.branches || []).forEach(function (g) { if (g.at === key) delete g.at; });
    }, b);
  };
  // spec: {key, label, at, outcomes [{key, label, sets}]}; a new group starts with two outcomes.
  Q.addGroup = function (id, spec, b) {
    spec = spec || {};
    return Q.edit(id, function (q) {
      if (!Array.isArray(q.branches)) q.branches = [];
      var g = { key: trim(spec.key) || freeKey(q.branches, 'choice'), label: trim(spec.label) || 'A choice', outcomes: [] };
      if (spec.at) g.at = spec.at;
      (Array.isArray(spec.outcomes) && spec.outcomes.length ? spec.outcomes : [{ label: 'First way' }, { label: 'Second way' }]).forEach(function (o) {
        g.outcomes.push({ key: trim(o.key) || freeKey(g.outcomes, 'outcome'), label: trim(o.label) || 'An outcome', sets: cleanSets(o.sets) });
      });
      q.branches.push(g);
    }, b);
  };
  Q.updateGroup = function (id, key, patch, b) {
    patch = patch || {};
    return Q.edit(id, function (q) {
      var i = findGroup(q, key);
      if (i < 0) return { error: 'Branch group ' + key + ' is not in this quest.' };
      if (patch.label !== undefined) q.branches[i].label = trim(patch.label);
      if (patch.at !== undefined) { if (patch.at === null || patch.at === '') delete q.branches[i].at; else q.branches[i].at = patch.at; }
    }, b);
  };
  Q.removeGroup = function (id, key, b) {
    return Q.edit(id, function (q) {
      var i = findGroup(q, key);
      if (i < 0) return { error: 'Branch group ' + key + ' is not in this quest.' };
      q.branches.splice(i, 1);
    }, b);
  };
  Q.addOutcome = function (id, group, spec, b) {
    spec = spec || {};
    return Q.edit(id, function (q) {
      var i = findGroup(q, group);
      if (i < 0) return { error: 'Branch group ' + group + ' is not in this quest.' };
      var g = q.branches[i];
      if (!Array.isArray(g.outcomes)) g.outcomes = [];
      g.outcomes.push({ key: trim(spec.key) || freeKey(g.outcomes, 'outcome'), label: trim(spec.label) || 'An outcome', sets: cleanSets(spec.sets) });
    }, b);
  };
  Q.updateOutcome = function (id, group, okey, patch, b) {
    patch = patch || {};
    return Q.edit(id, function (q) {
      var i = findGroup(q, group), o = i < 0 ? null : (q.branches[i].outcomes || []).filter(function (x) { return x.key === okey; })[0];
      if (!o) return { error: 'Outcome ' + okey + ' of ' + group + ' is not in this quest.' };
      if (patch.label !== undefined) o.label = trim(patch.label);
      if (patch.sets !== undefined) o.sets = cleanSets(patch.sets);
    }, b);
  };
  Q.removeOutcome = function (id, group, okey, b) {
    return Q.edit(id, function (q) {
      var i = findGroup(q, group);
      if (i < 0) return { error: 'Branch group ' + group + ' is not in this quest.' };
      var outs = q.branches[i].outcomes || [], j = -1;
      outs.forEach(function (o, n) { if (o.key === okey) j = n; });
      if (j < 0) return { error: 'Outcome ' + okey + ' of ' + group + ' is not in this quest.' };
      outs.splice(j, 1);
    }, b);
  };
  // fail: {cond, sets} or null to remove the failure rule.
  Q.setFail = function (id, fail, b) {
    return Q.edit(id, function (q) {
      if (fail === null || fail === undefined) { delete q.fail; return; }
      var f = { sets: cleanSets(fail.sets) };
      if (fail.cond !== undefined && fail.cond !== null) f.cond = fail.cond;
      q.fail = f;
    }, b);
  };

  // ---------------------------------------------------------------- making and removing
  // A quest an author makes by hand: spec {name, kind, chapter, giver}. It gets two stages (begin, done) and a new
  // completion flag of its own. Minted ID, origin user: the scaffold keeps it as it is.
  Q.add = function (spec, b) {
    b = b || cur();
    spec = spec || {};
    if (!b) return { ok: false, problems: [{ level: 'error', code: 'none', path: '', message: 'No bundle is open.' }] };
    STORY.ensure(b);
    var name = trim(spec.name);
    if (!name) return { ok: false, problems: [{ level: 'error', code: 'name', path: 'name', message: 'A quest needs a name.' }] };
    var fr = F.add({ name: name + ' completed', kind: 'quest', 'default': 0, range: [0, 1], notes: 'Set when the quest ' + name + ' is finished.' }, b);
    if (!fr.ok) return fr;
    var body = { kind: Q.KINDS.indexOf(spec.kind) >= 0 ? spec.kind : 'side', completeFlag: fr.record.id, stages: [{ key: 'begin', label: 'Begin', sets: [] }, { key: 'done', label: 'Complete', sets: [] }], branches: [], rewards: [], reads: [] };
    if (spec.chapter) body.chapter = spec.chapter;
    if (spec.giver) body.giver = spec.giver;
    var rec = STORY.authored('qst_', name, body);
    var probs = Q.check(rec, b, indexWith(rec, b)).filter(function (p) { return p.level === 'error'; });
    if (probs.length) { F.remove(fr.record.id, b); return { ok: false, problems: probs }; }
    b.story.records.qst_[rec.id] = rec;
    b.story.records.qst_ = sortedObj(b.story.records.qst_);
    if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-quest'); }
    F.sync(b);
    return { ok: true, record: rec };
  };
  // Everything else in the story that names this quest: [{id, name}], sorted, for the question "what breaks if it goes".
  Q.usedBy = function (id, b) {
    b = b || cur();
    var out = {}, s = b && b.story;
    if (!s) return [];
    function has(node, depth) {
      if (depth > 24 || node === null || node === undefined) return false;
      if (node === id) return true;
      if (typeof node !== 'object') return false;
      if (Array.isArray(node)) return node.some(function (x) { return has(x, depth + 1); });
      return Object.keys(node).some(function (k) { return k !== 'id' && has(node[k], depth + 1); });
    }
    STORY.PREFIXES.forEach(function (p) {
      Object.keys(s.records[p] || {}).forEach(function (rid) { var r = s.records[p][rid]; if (rid !== id && !(U.isObj(r) && r.derived) && has(r, 0)) out[rid] = r.name || rid; });
    });
    Object.keys(s.npcDialogue || {}).forEach(function (npc) { if (has(s.npcDialogue[npc], 0)) out[npc] = STORY.nameOf ? STORY.nameOf(npc, npc) : npc; });
    return Object.keys(out).sort().map(function (k) { return { id: k, name: out[k] }; });
  };
  // Removes a quest and the completion flag the scaffold made for it. A generated quest comes back with the next build.
  Q.remove = function (id, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.qst_, rec = R && R[id];
    if (!rec) return { ok: false, message: 'That quest does not exist.' };
    var users = Q.usedBy(id, b), scaf = b.story.scaffold, FL = b.story.records.flg_;
    delete R[id];
    Object.keys(scaf).forEach(function (k) {
      if (scaf[k] === id && k.indexOf('qst|') === 0) delete scaf[k];
      if (k === Q.DONE_FAMILY + id) { var fid = scaf[k]; if (FL[fid] && FL[fid].origin === 'generated') delete FL[fid]; delete scaf[k]; }
    });
    if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-quest'); }
    F.sync(b);
    return { ok: true, usedBy: users };
  };
  // Puts a generated quest back to what the world asks for. A hand made quest cannot be reset.
  Q.reset = function (id, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.qst_, rec = R && R[id];
    if (!rec) return { ok: false, message: 'That quest does not exist.' };
    if (rec.origin !== 'generated') return { ok: false, message: 'Only a generated quest can be set back to what the world asks for.' };
    var w = Q.wanted(b).filter(function (x) { return x.id === id; })[0];
    if (!w) return { ok: false, message: 'The world, the seeds, and the Charter no longer ask for this quest.' };
    R[id] = STORY.envelope('qst_', w.key, w.name, w.body);
    if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-quest'); }
    return { ok: true, record: R[id] };
  };

  // ---------------------------------------------------------------- reading
  Q.list = function (b) {
    b = b || cur();
    var order = {}, kind = { main: 0, side: 1, bstory: 2 };
    STORY.chapters(b).forEach(function (c, i) { order[c.id] = i; });
    return STORY.records.list('qst_', b).slice().sort(function (x, y) {
      var kx = kind[x.kind] === undefined ? 9 : kind[x.kind], ky = kind[y.kind] === undefined ? 9 : kind[y.kind];
      if (kx !== ky) return kx - ky;
      var ox = order[x.chapter] === undefined ? 99 : order[x.chapter], oy = order[y.chapter] === undefined ? 99 : order[y.chapter];
      return ox - oy || ((x.name || '') < (y.name || '') ? -1 : (x.name || '') > (y.name || '') ? 1 : 0);
    });
  };
  Q.summary = function (b) {
    b = b || cur();
    var recs = STORY.records.list('qst_', b), by = { main: 0, side: 0, bstory: 0 }, stages = 0, groups = 0, fails = 0, authored = 0, noGiver = 0;
    recs.forEach(function (q) {
      if (by[q.kind] !== undefined) by[q.kind]++;
      stages += Array.isArray(q.stages) ? q.stages.length : 0;
      groups += Array.isArray(q.branches) ? q.branches.length : 0;
      if (U.isObj(q.fail)) fails++;
      if (q.origin === 'user') authored++;
      if (q.kind !== 'bstory' && !q.giver) noGiver++;
    });
    var ex = Q.expected(b);
    return { total: recs.length, byKind: by, stages: stages, groups: groups, fails: fails, authored: authored, noGiver: noGiver, missing: ex.missing, expected: ex.total };
  };

  // ---------------------------------------------------------------- a condition in words
  var CMP_WORDS = { gte: 'at least', gt: 'more than', lte: 'at most', lt: 'fewer than', eq: 'exactly', ne: 'not' };
  Q.CMP_WORDS = CMP_WORDS;
  function flagName(id, b) { var r = b && b.story && b.story.records.flg_[id]; return r ? r.name : id; }
  // A sentence for a condition tree, for labels and messages. Reads, never evaluates.
  Q.condText = function (t, b, depth) {
    b = b || cur(); depth = depth || 0;
    if (t === null || t === undefined) return 'always';
    if (!U.isObj(t) || depth > 12) return 'a condition';
    function nm(id) { return STORY.nameOf ? STORY.nameOf(id, id) : id; }
    function group(list, word) {
      var parts = (Array.isArray(list) ? list : []).map(function (x) { var s = Q.condText(x, b, depth + 1); return U.isObj(x) && (x.op === 'all' || x.op === 'any') && depth >= 0 ? '(' + s + ')' : s; });
      return parts.length ? parts.join(' ' + word + ' ') : (word === 'and' ? 'always' : 'never');
    }
    switch (t.op) {
      case 'true': return 'always';
      case 'all': return group(t.of, 'and');
      case 'any': return group(t.of, 'or');
      case 'not': return 'not (' + Q.condText(t.of, b, depth + 1) + ')';
      case 'flag': {
        var v = t.value === undefined ? 1 : t.value, c = t.cmp || 'gte', n = flagName(t.flg, b);
        if (c === 'gte' && v === 1) return n + ' is set';
        if (c === 'eq' && v === 0) return n + ' is not set';
        return n + ' is ' + CMP_WORDS[c] + ' ' + v;
      }
      case 'item': return 'holding ' + CMP_WORDS[t.cmp || 'gte'] + ' ' + (t.value === undefined ? 1 : t.value) + ' of ' + nm(t.itm);
      case 'chapter': return 'chapter is ' + CMP_WORDS[t.cmp || 'gte'] + ' ' + chapterName(t.chp, b);
      case 'quest': {
        var qn = (b.story.records.qst_[t.qst] || {}).name || t.qst;
        if (t.is === 'at') return qn + ' is at ' + t.stage;
        if (t.is === 'reached') return qn + ' has reached ' + t.stage;
        if (t.is === 'failed') return qn + ' has failed';
        if (t.is === 'started') return qn + ' has started';
        if (t.is === 'done') return qn + ' is complete';
        return qn;
      }
      default: return 'a condition';
    }
  };
})();
// === STORY:QUESTS END ===
