// === STORY:SCAFFOLD BEGIN ===
(function () {
  'use strict';
  // Phase 2: flags and gate bindings. This fence builds the flg_ records the rest of the story stands on and never edits a
  // world record. Three families of flag are generated, each from a structural key (ENGINE_STORY.ids.structural, the way
  // Day 148 builds world IDs), so running the sync again never renames anything:
  //   flg|gate|<gate key>     one per Day 148 gate key: chapter:<chp>, item:seal:<chp>, vehicle:ship, vehicle:airship
  //   flg|quest|<qst>         the save slot that packs a quest's stage, failed state, and closed branches (engine derived)
  //   flg|once|<evt>          the save slot that packs which once pages of an event have run (engine derived)
  //   flg|done|<sdq>          the completion flag of the quest generated for a side quest seed
  // story.bindings maps every gate key to {flg, itm}: the flag that stands for the gate and, for a seal, an optional
  // display item from the Rules. story.scaffold records what the sync made, by structural key, so a rerun keeps edits and
  // drops what the world or the quests no longer ask for. Later phases add their own families to the same map; this fence
  // only ever touches the four families above. Filling sdq_.flag is the one write outside the story namespace.
  var U = Kit.util, ES = ENGINE_STORY;
  function cur() { return Kit.bundle.current(); }
  var F = STORY.flags = {};
  F.KINDS = ['gate', 'quest', 'story', 'counter'];
  F.INT_MIN = -2147483648;
  F.INT_MAX = 2147483647;
  F.FAMILIES = ['flg|gate|', 'flg|quest|', 'flg|once|', 'flg|done|'];
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= F.INT_MIN && v <= F.INT_MAX; }
  F.isInt = isInt;
  function extend(a, b) { Object.keys(b || {}).forEach(function (k) { a[k] = b[k]; }); return a; }
  function sortedObj(o) { var r = {}; Object.keys(o || {}).sort().forEach(function (k) { r[k] = o[k]; }); return r; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // ---------------------------------------------------------------- the Codex type
  // Phase 0 registered StoryFlag with the envelope alone. Phase 2 gives it its own fields, so the record validates and any
  // Codex view of it shows them. Days 146 to 148 never read these fields; they only index the record.
  var FLAG_FIELDS = [
    { key: 'kind', label: 'Kind', type: 'enum', values: F.KINDS, required: true, help: 'gate: a Day 148 gate. quest: quest progress. story: a story fact. counter: a number the story counts with.' },
    { key: 'default', label: 'Default', type: 'int', min: F.INT_MIN, max: F.INT_MAX, help: 'The value a new game starts with.' },
    { key: 'range', label: 'Range', type: 'list', of: { type: 'int', min: F.INT_MIN, max: F.INT_MAX }, min: 2, max: 2, itemLabel: 'Bound', help: 'Lowest, then highest. A write outside the range is clamped to it.' },
    { key: 'gate', label: 'Gate key', type: 'text', max: 160, help: 'The Day 148 gate key this flag stands for.' },
    { key: 'derived', label: 'Save slot', type: 'enum', values: ['quest', 'once'], help: 'The engine packs quest progress or once pages into this flag for Day 146 saves.' },
    { key: 'of', label: 'Slot of', type: 'text', max: 160, help: 'The quest or event this save slot belongs to.' },
    { key: 'notes', label: 'Note', type: 'longtext', max: 600 }
  ];
  Kit.codex.register({ name: STORY.TYPES['flg_'].name, prefix: 'flg_', label: STORY.TYPES['flg_'].label, ns: 'story', forge: STORY.FORGE, group: 'story', dependsOn: [], fields: U.clone(STORY.ENVELOPE_FIELDS).concat(FLAG_FIELDS) });

  // ---------------------------------------------------------------- what the sync wants
  F.idFor = function (key) { return ES.ids.structural('flg_', key); };
  F.gateId = function (gateKey) { return F.idFor('flg|gate|' + gateKey); };
  F.doneId = function (sdq) { return F.idFor('flg|done|' + sdq); };
  function chapterName(id, b) { var c = STORY.chapters(b).filter(function (x) { return x.id === id; })[0]; return c ? (c.name || id) : id; }
  function hasChapter(id, b) { return STORY.chapters(b).some(function (x) { return x.id === id; }); }
  function gateWant(k, b) {
    var p = ES.gates.parse(k), body = { kind: 'gate', 'default': 0, range: [0, 1], gate: k, notes: 'Stands for the Day 148 gate key ' + k + '. One means the gate is open.' }, name;
    if (p.kind === 'chapter') name = 'Chapter gate: ' + chapterName(p.chapter, b);
    else if (p.kind === 'seal') name = 'Seal: ' + chapterName(p.chapter, b);
    else if (p.kind === 'ship') name = 'Vehicle gate: Ship';
    else if (p.kind === 'airship') name = 'Vehicle gate: Airship';
    else name = 'Gate: ' + k;
    if (p.chapter && hasChapter(p.chapter, b)) body.chapter = p.chapter;
    return { key: 'flg|gate|' + k, family: 'gate', name: name, body: body };
  }
  // Every flag the sync generates for this bundle, in a stable order: [{key, family, name, body}].
  F.wanted = function (b) {
    b = b || cur();
    var out = [], g = STORY.world.graph(b);
    if (g) ES.gates.keys(g).forEach(function (k) { out.push(gateWant(k, b)); });
    ES.save.slots(STORY.engineIndex(b)).forEach(function (sl) {
      var rec = STORY.records.get(sl.of, b), nm = rec && rec.name || sl.of, body = { 'default': 0, range: [0, F.INT_MAX], of: sl.of };
      if (rec && typeof rec.chapter === 'string' && hasChapter(rec.chapter, b)) body.chapter = rec.chapter;
      if (sl.kind === 'quest') {
        body.kind = 'quest'; body.derived = 'quest';
        body.notes = 'Packs the stage, the failed state, and the closed branches of this quest into one whole number for the save. The engine writes it; do not set it by hand.';
        out.push({ key: 'flg|quest|' + sl.of, family: 'quest', name: 'Save slot: ' + nm, body: body });
      } else {
        body.kind = 'story'; body.derived = 'once';
        body.notes = 'One bit for each once page of this event that has run. The engine writes it; do not set it by hand.';
        out.push({ key: 'flg|once|' + sl.of, family: 'once', name: 'Save slot: once pages of ' + nm, body: body });
      }
    });
    STORY.rules('sdq_', b).forEach(function (q) {
      var body = { kind: 'quest', 'default': 0, range: [0, 1], notes: 'Set when the quest for the side quest seed ' + (q.name || q.id) + ' is finished. The seed\'s completion flag points here.' };
      if (typeof q.chapter === 'string' && hasChapter(q.chapter, b)) body.chapter = q.chapter;
      out.push({ key: 'flg|done|' + q.id, family: 'done', name: (q.name || q.id) + ' completed', body: body });
    });
    return out;
  };

  // ---------------------------------------------------------------- the sync
  // Makes what is missing and drops what the world and the quests no longer ask for, binds every gate key, and fills each
  // side quest seed's completion flag. Idempotent: a second run changes nothing and does not touch the bundle. Never edits
  // a flag that exists (a name, default, range, or note an author changed stays), never removes an authored flag, and
  // keeps a binding or a completion flag someone chose that still resolves. Returns a report.
  F.sync = function (b) {
    b = b || cur();
    var rep = { created: [], removed: [], bound: [], rebound: [], dropped: [], sdq: { filled: [], kept: [] }, changed: false, skipped: null };
    if (!b) { rep.skipped = 'no bundle'; return rep; }
    STORY.ensure(b);
    var g = STORY.world.graph(b);
    if (!g) { rep.skipped = 'The world has no progression graph.'; return rep; }
    var s = b.story, R = s.records.flg_, scaf = s.scaffold, want = {}, W = F.wanted(b);
    W.forEach(function (w) { want[w.key] = w; });
    W.forEach(function (w) {
      var id = F.idFor(w.key);
      if (!R[id]) { R[id] = STORY.envelope('flg_', w.key, w.name, w.body); rep.created.push(id); }
      if (scaf[w.key] !== id) { scaf[w.key] = id; rep.changed = true; }
    });
    Object.keys(scaf).sort().forEach(function (k) {
      if (!F.FAMILIES.some(function (f) { return k.indexOf(f) === 0; }) || want[k]) return;
      var id = scaf[k];
      if (R[id] && R[id].origin === 'generated') { delete R[id]; rep.removed.push(id); }
      delete scaf[k]; rep.changed = true;
    });
    var keys = ES.gates.keys(g), live = {};
    keys.forEach(function (k) {
      live[k] = 1;
      var id = F.gateId(k), bd = s.bindings[k];
      if (U.isObj(bd) && typeof bd.flg === 'string' && R[bd.flg]) { rep.bound.push(k); return; }
      var nb = { flg: id };
      if (U.isObj(bd) && typeof bd.itm === 'string') nb.itm = bd.itm;
      s.bindings[k] = nb; rep.rebound.push(k);
    });
    Object.keys(s.bindings).sort().forEach(function (k) { if (!live[k]) { delete s.bindings[k]; rep.dropped.push(k); } });
    STORY.rules('sdq_', b).forEach(function (q) {
      var id = F.doneId(q.id), have = q.flag, mine = typeof have === 'string' && Kit.ids.prefixOf(have) === 'flg_' && !!R[have];
      if (mine && have !== id) { rep.sdq.kept.push(q.id); return; }
      if (have !== id) { q.flag = id; rep.sdq.filled.push(q.id); }
    });
    var edited = rep.created.length || rep.removed.length || rep.rebound.length || rep.dropped.length || rep.sdq.filled.length || rep.changed;
    if (edited) {
      s.records.flg_ = sortedObj(R); s.bindings = sortedObj(s.bindings); s.scaffold = sortedObj(scaf);
      rep.changed = true;
      if (b === cur()) Kit.bundle.touch('story-flags');
    }
    return rep;
  };
  F.reportText = function (rep) {
    if (rep.skipped) return 'Nothing to bind: ' + rep.skipped;
    if (!rep.changed) return 'Every gate key is bound and every flag is in place.';
    var bits = [];
    if (rep.created.length) bits.push(plural(rep.created.length, 'flag') + ' made');
    if (rep.rebound.length) bits.push(plural(rep.rebound.length, 'gate key') + ' bound');
    if (rep.removed.length) bits.push(plural(rep.removed.length, 'flag') + ' dropped');
    if (rep.dropped.length) bits.push(plural(rep.dropped.length, 'binding') + ' dropped');
    if (rep.sdq.filled.length) bits.push(plural(rep.sdq.filled.length, 'side quest') + ' given a completion flag');
    return bits.join(', ') + '.';
  };

  // ---------------------------------------------------------------- the binding table
  var KIND_ORDER = { chapter: 0, seal: 1, ship: 2, airship: 3, other: 4 };
  // One row per gate key the world names, unbound ones first: {key, kind, chapter, flg, flagName, bound, itm, itmOk,
  // shared (other keys on the same flag), generated (the structural flag)}.
  F.bindingRows = function (b) {
    b = b || cur();
    var g = STORY.world.graph(b), s = b && b.story;
    if (!g || !s) return [];
    var order = {}, users = {};
    STORY.chapters(b).forEach(function (c, i) { order[c.id] = i; });
    var keys = ES.gates.keys(g);
    keys.forEach(function (k) { var bd = s.bindings[k]; if (U.isObj(bd) && bd.flg) (users[bd.flg] = users[bd.flg] || []).push(k); });
    var rows = keys.map(function (k) {
      var p = ES.gates.parse(k), bd = U.isObj(s.bindings[k]) ? s.bindings[k] : null, rec = bd && bd.flg ? s.records.flg_[bd.flg] : null;
      return { key: k, kind: p.kind, chapter: p.chapter, flg: bd && bd.flg || null, flagName: rec ? rec.name : null, bound: !!rec, itm: bd && bd.itm || null,
        itmOk: !(bd && bd.itm) || !!STORY.rules('itm_', b).filter(function (x) { return x.id === bd.itm; })[0],
        shared: bd && bd.flg ? users[bd.flg].filter(function (x) { return x !== k; }) : [], generated: !!(bd && bd.flg === F.gateId(k)) };
    });
    rows.sort(function (x, y) {
      if (x.bound !== y.bound) return x.bound ? 1 : -1;
      if (KIND_ORDER[x.kind] !== KIND_ORDER[y.kind]) return KIND_ORDER[x.kind] - KIND_ORDER[y.kind];
      var ox = order[x.chapter] === undefined ? 99 : order[x.chapter], oy = order[y.chapter] === undefined ? 99 : order[y.chapter];
      return ox - oy || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
    });
    return rows;
  };
  F.label = function (row, b) {
    if (row.kind === 'chapter') return 'Chapter gate: ' + chapterName(row.chapter, b);
    if (row.kind === 'seal') return 'Seal: ' + chapterName(row.chapter, b);
    if (row.kind === 'ship') return 'Vehicle gate: Ship';
    if (row.kind === 'airship') return 'Vehicle gate: Airship';
    return 'Gate: ' + row.key;
  };
  // Points a gate key at another flag (one that exists), keeping its display item.
  F.bind = function (key, flg, b) {
    b = b || cur();
    if (!b || !b.story || !STORY.world.graph(b) || ES.gates.keys(STORY.world.graph(b)).indexOf(key) < 0) return { ok: false, message: key + ' is not a gate key of this world.' };
    if (Kit.ids.prefixOf(flg) !== 'flg_' || !b.story.records.flg_[flg]) return { ok: false, message: 'Choose a flag that exists.' };
    var old = b.story.bindings[key], nb = { flg: flg };
    if (U.isObj(old) && old.itm) nb.itm = old.itm;
    b.story.bindings[key] = nb; b.story.bindings = sortedObj(b.story.bindings);
    if (b === cur()) Kit.bundle.touch('story-binding');
    return { ok: true };
  };
  // Goes back to the generated flag for the gate key, making it when it is missing.
  F.resetBinding = function (key, b) {
    b = b || cur();
    if (!b || !b.story) return { ok: false, message: 'No story is open.' };
    var id = F.gateId(key);
    if (!b.story.records.flg_[id]) F.sync(b);
    return F.bind(key, id, b);
  };
  // A seal's display item: an itm_ from the Rules, or null to clear it.
  F.setItem = function (key, itm, b) {
    b = b || cur();
    var bd = b && b.story && b.story.bindings[key];
    if (!U.isObj(bd) || !bd.flg) return { ok: false, message: 'Bind the gate key to a flag first.' };
    if (itm) {
      if (Kit.ids.prefixOf(itm) !== 'itm_' || !STORY.rules('itm_', b).some(function (x) { return x.id === itm; })) return { ok: false, message: 'Choose an item from the Rules.' };
      bd.itm = itm;
    } else delete bd.itm;
    if (b === cur()) Kit.bundle.touch('story-binding');
    return { ok: true };
  };

  // ---------------------------------------------------------------- side quest completion flags
  F.sdqRows = function (b) {
    b = b || cur();
    var R = b && b.story ? b.story.records.flg_ : {};
    return STORY.rules('sdq_', b).map(function (q) {
      var id = F.doneId(q.id), have = q.flag || null;
      return { sdq: q.id, name: q.name || q.id, chapter: q.chapter || null, flg: have, flagName: have && R[have] ? R[have].name : null, exists: !!(have && R[have]), generated: have === id, custom: !!have && have !== id, giver: q.giver || null };
    });
  };
  F.setSdqFlag = function (sdq, flg, b) {
    b = b || cur();
    var q = b && b.rules && b.rules.sdq_ && b.rules.sdq_[sdq];
    if (!q) return { ok: false, message: 'That side quest seed does not exist.' };
    if (Kit.ids.prefixOf(flg) !== 'flg_' || !b.story.records.flg_[flg]) return { ok: false, message: 'Choose a flag that exists.' };
    q.flag = flg;
    if (b === cur()) Kit.bundle.touch('story-sdq-flag');
    return { ok: true };
  };
  F.resetSdqFlag = function (sdq, b) {
    b = b || cur();
    var q = b && b.rules && b.rules.sdq_ && b.rules.sdq_[sdq];
    if (!q) return { ok: false, message: 'That side quest seed does not exist.' };
    q.flag = F.doneId(sdq);
    var rep = F.sync(b);
    if (!rep.changed && b === cur()) Kit.bundle.touch('story-sdq-flag');
    return { ok: true };
  };

  // ---------------------------------------------------------------- records
  F.check = function (rec) {
    var out = [];
    if (!U.isObj(rec) || typeof rec.name !== 'string' || !rec.name.trim()) out.push({ code: 'name', path: 'name', message: 'A flag needs a name.' });
    if (!U.isObj(rec) || F.KINDS.indexOf(rec.kind) < 0) out.push({ code: 'kind', path: 'kind', message: 'Kind must be gate, quest, story, or counter.' });
    if (!U.isObj(rec)) return out;
    if (rec['default'] !== undefined && !isInt(rec['default'])) out.push({ code: 'default', path: 'default', message: 'The default must be a whole number.' });
    if (rec.range !== undefined) {
      var r = rec.range;
      if (!Array.isArray(r) || r.length !== 2 || !isInt(r[0]) || !isInt(r[1])) out.push({ code: 'range', path: 'range', message: 'The range must be two whole numbers, lowest first.' });
      else if (r[0] > r[1]) out.push({ code: 'range-order', path: 'range', message: 'The range minimum ' + r[0] + ' is above its maximum ' + r[1] + '.' });
      else if (isInt(rec['default']) && (rec['default'] < r[0] || rec['default'] > r[1])) out.push({ code: 'default-range', path: 'default', message: 'The default ' + rec['default'] + ' is outside the range ' + r[0] + ' to ' + r[1] + '.' });
    }
    return out;
  };
  // Edits a flag: patch holds name, kind, default, range (a pair, or null to remove it), and notes. Refused with the
  // problems when the result would not pass F.check; nothing is written then.
  F.update = function (id, patch, b) {
    b = b || cur();
    var rec = b && b.story && b.story.records.flg_[id];
    if (!rec) return { ok: false, problems: [{ code: 'missing', path: 'id', message: 'That flag does not exist.' }] };
    var next = U.clone(rec);
    ['name', 'kind', 'default', 'notes'].forEach(function (k) { if (patch[k] !== undefined) next[k] = patch[k]; });
    if (patch.name !== undefined) next.name = String(patch.name).trim();
    if (patch.range !== undefined) { if (patch.range === null) delete next.range; else next.range = patch.range; }
    var probs = F.check(next);
    if (probs.length) return { ok: false, problems: probs };
    b.story.records.flg_[id] = next;
    if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-flag'); }
    return { ok: true, record: next };
  };
  // A flag an author makes by hand: minted ID, origin 'user', which the sync keeps as it is.
  F.add = function (spec, b) {
    b = b || cur();
    STORY.ensure(b);
    spec = spec || {};
    var body = { kind: spec.kind || 'story', 'default': spec['default'] === undefined ? 0 : spec['default'] };
    if (spec.range) body.range = spec.range;
    if (spec.notes) body.notes = spec.notes;
    var probe = extend({ name: spec.name }, body), probs = F.check(probe);
    if (probs.length) return { ok: false, problems: probs };
    var rec = STORY.authored('flg_', String(spec.name).trim(), body);
    b.story.records.flg_[rec.id] = rec; b.story.records.flg_ = sortedObj(b.story.records.flg_);
    if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-flag'); }
    return { ok: true, record: rec };
  };
  // Removes a flag. A generated flag is made again by the next sync (a gate flag, a save slot, a completion flag), so only
  // the record goes; the gate keys and side quests that pointed at it are returned so the caller can say so.
  F.remove = function (id, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.flg_;
    if (!R || !R[id]) return { ok: false, message: 'That flag does not exist.' };
    var gates = Object.keys(b.story.bindings).sort().filter(function (k) { return U.isObj(b.story.bindings[k]) && b.story.bindings[k].flg === id; });
    var sdq = STORY.rules('sdq_', b).filter(function (q) { return q.flag === id; }).map(function (q) { return q.id; });
    delete R[id];
    if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-flag'); }
    return { ok: true, gates: gates, sdq: sdq };
  };

  // ---------------------------------------------------------------- who reads, who sets
  // Built from the condition and command trees of everything that can read or set a flag, and from Day 148's progression
  // (a node requires a gate flag and grants another). {flg: {reads: [src], sets: [src]}} where src is {kind, id, label,
  // where, tab}. Derived save slots list the engine as their one user. Lists are sorted and hold no duplicates.
  F.xref = function (b) {
    b = b || cur();
    var out = {}, s = b && b.story;
    if (!s) return out;
    function bucket(flg) { return out[flg] || (out[flg] = { reads: [], sets: [], seen: {} }); }
    function add(flg, side, src) {
      if (typeof flg !== 'string') return;
      var bk = bucket(flg), key = side + '|' + src.kind + '|' + src.id + '|' + src.where;
      if (bk.seen[key]) return;
      bk.seen[key] = 1; bk[side].push(src);
    }
    function reads(tree, src) { ES.cond.reads(tree).flags.forEach(function (f) { add(f, 'reads', src); }); }
    function cmds(list, src) {
      if (!Array.isArray(list)) return;
      var r = ES.cmd.refs(list);
      r.reads.flags.forEach(function (f) { add(f, 'reads', src); });
      r.sets.flags.forEach(function (f) { add(f, 'sets', src); });
    }
    function setsOf(list, src) { if (Array.isArray(list)) list.forEach(function (x) { if (U.isObj(x)) add(x.flg, 'sets', src); }); }
    var g = STORY.world.graph(b);
    if (g) {
      var byGate = {};
      Object.keys(s.bindings).sort().forEach(function (k) { if (U.isObj(s.bindings[k]) && s.bindings[k].flg) byGate[k] = s.bindings[k].flg; });
      g.nodes.forEach(function (n) {
        var label = n.record && STORY.nameOf(n.record, '') || n.key, mk = function (where) { return { kind: 'world', id: n.key, label: label, where: where, tab: 'start' }; };
        (n.requires || []).forEach(function (k) { if (byGate[k]) add(byGate[k], 'reads', mk('requires')); });
        (n.grants || []).forEach(function (k) { if (byGate[k]) add(byGate[k], 'sets', mk('grants')); });
      });
      (g.start || []).forEach(function (k) { if (byGate[k]) add(byGate[k], 'sets', { kind: 'world', id: 'start', label: 'A new game', where: 'opens at the start', tab: 'start' }); });
    }
    STORY.records.list('qst_', b).forEach(function (q) {
      var base = { kind: 'quest', id: q.id, label: q.name || q.id, tab: 'quests' };
      function src(where) { return { kind: base.kind, id: base.id, label: base.label, tab: base.tab, where: where }; }
      (q.stages || []).forEach(function (st, i) {
        if (!U.isObj(st)) return;
        var nm = 'stage ' + (st.key || i);
        if (st.exitWhen !== undefined) reads(st.exitWhen, src(nm + ' exitWhen'));
        setsOf(st.sets, src(nm + ' sets'));
      });
      (q.branches || []).forEach(function (br) { if (U.isObj(br)) (br.outcomes || []).forEach(function (o) { if (U.isObj(o)) setsOf(o.sets, src('branch ' + (br.key || '') + '.' + (o.key || ''))); }); });
      if (U.isObj(q.fail)) { if (q.fail.cond !== undefined) reads(q.fail.cond, src('fail when')); setsOf(q.fail.sets, src('fail sets')); }
      if (typeof q.completeFlag === 'string') add(q.completeFlag, 'sets', src('completes'));
    });
    STORY.records.list('dlg_', b).forEach(function (d) {
      var nodes = U.isObj(d.nodes) ? d.nodes : {};
      Object.keys(nodes).sort().forEach(function (nk) {
        var n = nodes[nk];
        if (!U.isObj(n)) return;
        var src = { kind: 'dialogue', id: d.id, label: d.name || d.id, tab: 'dialogue', where: 'node ' + nk };
        cmds(n.cmds, src);
        (n.choices || []).forEach(function (c) { if (!U.isObj(c)) return; if (c.cond !== undefined) reads(c.cond, src); cmds(c.cmds, src); });
      });
    });
    STORY.records.list('evt_', b).forEach(function (e) {
      (e.pages || []).forEach(function (p, i) {
        if (!U.isObj(p)) return;
        var src = { kind: 'event', id: e.id, label: e.name || e.id, tab: 'events', where: 'page ' + (i + 1) };
        if (p.cond !== undefined) reads(p.cond, src);
        cmds(p.cmds, src);
      });
    });
    Object.keys(s.npcDialogue || {}).sort().forEach(function (npc) {
      (Array.isArray(s.npcDialogue[npc]) ? s.npcDialogue[npc] : []).forEach(function (p, i) {
        if (U.isObj(p) && p.cond !== undefined) reads(p.cond, { kind: 'npc', id: npc, label: STORY.nameOf(npc, npc), tab: 'dialogue', where: 'page ' + (i + 1) });
      });
    });
    STORY.records.list('end_', b).forEach(function (e) { if (e.cond !== undefined) reads(e.cond, { kind: 'ending', id: e.id, label: e.name || e.id, tab: 'start', where: 'condition' }); });
    STORY.records.list('flg_', b).forEach(function (f) {
      if (f.derived) { var src = { kind: 'engine', id: 'engine', label: 'The story engine', tab: 'flags', where: 'save slot' }; add(f.id, 'reads', src); add(f.id, 'sets', src); }
    });
    var res = {};
    Object.keys(out).sort().forEach(function (k) {
      function order(a, z) { return a.kind < z.kind ? -1 : a.kind > z.kind ? 1 : a.label < z.label ? -1 : a.label > z.label ? 1 : a.where < z.where ? -1 : a.where > z.where ? 1 : 0; }
      res[k] = { reads: out[k].reads.sort(order), sets: out[k].sets.sort(order) };
    });
    return res;
  };

  F.summary = function (b) {
    b = b || cur();
    var recs = STORY.records.list('flg_', b), rows = F.bindingRows(b), xr = F.xref(b), by = {}, derived = 0, authored = 0, neverRead = [], neverSet = [];
    F.KINDS.forEach(function (k) { by[k] = 0; });
    recs.forEach(function (r) {
      if (by[r.kind] !== undefined) by[r.kind]++;
      if (r.derived) derived++;
      if (r.origin === 'user') authored++;
      var x = xr[r.id] || { reads: [], sets: [] };
      if (!r.derived && !x.reads.length) neverRead.push(r.id);
      if (!r.derived && !x.sets.length) neverSet.push(r.id);
    });
    return { total: recs.length, byKind: by, derived: derived, authored: authored, gateKeys: rows.length, bound: rows.filter(function (r) { return r.bound; }).length,
      unbound: rows.filter(function (r) { return !r.bound; }).length, shared: rows.filter(function (r) { return r.shared.length; }).length, neverRead: neverRead, neverSet: neverSet };
  };

  // ---------------------------------------------------------------- validation
  // Cross field mistakes the Codex field checks cannot see, and the bindings. An unbound gate key is an error: Day 150
  // would never know when that gate opens.
  Kit.validate.register('story.flags', function (b, ctx) {
    var s = b.story;
    if (!s || !U.isObj(s.records)) return;
    Object.keys(s.records.flg_ || {}).sort().forEach(function (id) {
      F.check(s.records.flg_[id]).forEach(function (p) {
        if (p.code === 'range-order' || p.code === 'default-range' || p.code === 'name') ctx.add({ recordId: id, fieldPath: p.path, message: p.message, level: 'error' });
      });
    });
    var g = STORY.world.graph(b);
    if (!g) return;
    var keys = ES.gates.keys(g), users = {}, items = {};
    STORY.rules('itm_', b).forEach(function (x) { items[x.id] = 1; });
    keys.forEach(function (k) {
      var bd = s.bindings && s.bindings[k];
      if (!U.isObj(bd) || typeof bd.flg !== 'string' || !bd.flg) { ctx.add({ recordId: 'story', fieldPath: 'bindings.' + k, message: 'Gate key ' + k + ' is not bound to a story flag.', level: 'error' }); return; }
      if (!s.records.flg_[bd.flg]) { ctx.add({ recordId: 'story', fieldPath: 'bindings.' + k, message: 'Gate key ' + k + ' is bound to ' + bd.flg + ', which does not exist.', level: 'error' }); return; }
      (users[bd.flg] = users[bd.flg] || []).push(k);
      if (bd.itm && !items[bd.itm]) ctx.add({ recordId: 'story', fieldPath: 'bindings.' + k + '.itm', message: 'The display item ' + bd.itm + ' for gate key ' + k + ' is not an item in the Rules.', level: 'error' });
    });
    Object.keys(users).sort().forEach(function (f) { if (users[f].length > 1) ctx.add({ recordId: 'story', fieldPath: 'bindings.' + users[f][0], message: 'Gate keys ' + users[f].join(' and ') + ' share one flag (' + f + '), so they always open together.', level: 'warning' }); });
    Object.keys(s.bindings || {}).sort().forEach(function (k) { if (keys.indexOf(k) < 0) ctx.add({ recordId: 'story', fieldPath: 'bindings.' + k, message: 'A binding for ' + k + ', a gate key the world no longer names.', level: 'warning' }); });
  });

  // ---------------------------------------------------------------- when the story opens
  // Opening a finished world binds it: every gate key gets its flag, the save slots get theirs, and each side quest seed
  // gets its completion flag. Idempotent, so a bundle that is already bound is left alone.
  Kit.on('load', function (b) {
    if (STORY.readiness(b) !== true) return;
    F.sync(b);
  });
})();
// === STORY:SCAFFOLD END ===
