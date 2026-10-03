// === STORY:ENDINGS BEGIN ===
(function () {
  'use strict';
  // Phase 6: endings and the playtime floor. An end_ record is read by the finale event (STORY.events.endingOrder):
  //   name, concept (the Charter's words), order (1 based, the Charter's list position; none on one made by hand)
  //   cond (a condition tree; {op: 'true'} or none makes it the fallback)   priority (higher is tested first)
  //   music (a Day 147 role key such as ending:2, or a mus_)   epilogue (lines the finale shows before the end)   notes
  // The scaffold makes one end_ per Charter ending in list order, with a structural ID from the ending's position and name
  // (key end|<n>|<slug>), so a rerun renames nothing. DECISION: the first Charter ending is the fallback (cond true,
  // priority 0). Every later ending is earned and tested first: priority 10 times its index, and a condition built from the
  // optional quests (side and B story), shared out round robin so each earned ending gets its own group; an ending left
  // without a group reads a flag of its own (family flg|ending|<n>, kind story), which the generated finale sets from a choice. A generated
  // record carries gen, the digest of what the scaffold made; a rebuild refreshes it only while it is unedited.
  // The playtime floor: the chapters' summed targetMinutes must reach settings.floorMinutes (720), an error here where
  // Day 146 only warns. Side and B story minutes are reported on their own and never count toward the floor.
  var U = Kit.util, ES = ENGINE_STORY, F = STORY.flags, Q = STORY.quests, E = STORY.events;
  function cur() { return Kit.bundle.current(); }
  var X = STORY.ends = {};
  X.FALLBACK_PRIORITY = 0;
  X.STEP = 10;
  X.SIDE_MINUTES = 15;
  X.BSTORY_MINUTES = 10;
  X.MAX_MINUTES = 600;
  X.MAX_EPILOGUE = 12;
  X.FLAG_PREFIX = 'flg|ending|';
  var isInt = F.isInt;
  function trim(s) { return String(s === undefined || s === null ? '' : s).trim(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  function sortedObj(o) { var r = {}; Object.keys(o || {}).sort().forEach(function (k) { r[k] = o[k]; }); return r; }
  function slug(s) { return U.slug ? U.slug(s) : trim(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  function nameOf(id, fb) { return STORY.nameOf ? STORY.nameOf(id, fb) : (fb || id || ''); }
  function cut(s, n) { s = trim(s); if (s.length <= n) return s; return s.slice(0, n - 3).replace(/\s+\S*$/, '') + '...'; }
  function alwaysTrue(c) { return c === undefined || c === null || (U.isObj(c) && c.op === 'true'); }
  X.alwaysTrue = alwaysTrue;

  // ---------------------------------------------------------------- the Codex type
  var END_FIELDS = [
    { key: 'order', label: 'Charter position', type: 'int', min: 1, max: 99, help: 'Which Charter ending this is, counting from 1. An ending made by hand has none.' },
    { key: 'concept', label: 'Concept', type: 'longtext', max: 600, help: 'The Charter\'s words for this ending.' },
    { key: 'cond', label: 'Earned when', type: 'object', help: 'A condition tree. Always true (or missing) makes this the fallback, and exactly one ending must be.' },
    { key: 'priority', label: 'Priority', type: 'int', min: -999, max: 999, help: 'The finale tests the highest priority first, so the fallback is the lowest.' },
    { key: 'music', label: 'Credits music', type: 'text', max: 80, help: 'A Day 147 role key such as ending:2, or a mus_.' },
    { key: 'epilogue', label: 'Epilogue', type: 'list', of: { type: 'text', max: 300 }, itemLabel: 'Line', help: 'Lines the finale shows before the end.' },
    { key: 'gen', label: 'Generated digest', type: 'text', max: 40, derived: true, help: 'The digest of what the scaffold made. While the record still matches it, a rebuild may refresh it.' },
    { key: 'notes', label: 'Note', type: 'longtext', max: 1200 }
  ];
  Kit.codex.register({ name: STORY.TYPES['end_'].name, prefix: 'end_', label: STORY.TYPES['end_'].label, ns: 'story', forge: STORY.FORGE, group: 'story', dependsOn: [], fields: U.clone(STORY.ENVELOPE_FIELDS).concat(END_FIELDS) });

  // ---------------------------------------------------------------- ids
  X.idFor = function (key) { return ES.ids.structural('end_', key); };
  X.keyFor = function (n, name) { return 'end|' + n + '|' + (slug(name) || 'ending'); };
  X.flagKey = function (n) { return X.FLAG_PREFIX + n; };
  X.flagId = function (n) { return F.idFor(X.flagKey(n)); };
  X.roleFor = function (n) { return 'ending:' + n; };
  function ordinalName(e, i) { return trim(e && e.name) || 'Ending ' + (i + 1); }

  // ---------------------------------------------------------------- what the Charter and the quests ask for
  // Side and B story quests in the Quests tab's order. These are what earned endings are built from.
  X.optional = function (b) { b = b || cur(); return Q.list(b).filter(function (q) { return q.kind === 'side' || q.kind === 'bstory'; }); };
  function allOf(list) { return list.length === 1 ? list[0] : { op: 'all', of: list }; }
  // The condition an earned ending at Charter index i (1 or more) of total endings gets, and the flag it reads when it has
  // no quests to read: {cond, quests [qst_], flag {key, id, name, body} or null}.
  X.earned = function (i, total, b) {
    b = b || cur();
    var opt = X.optional(b), m = Math.max(1, total - 1), group = opt.filter(function (q, k) { return k % m === i - 1; });
    if (group.length) return { cond: allOf(group.map(function (q) { return { op: 'quest', qst: q.id, is: 'done' }; })), quests: group.map(function (q) { return q.id; }), flag: null };
    var e = STORY.endings(b)[i], nm = ordinalName(e, i), id = X.flagId(i + 1);
    return { cond: { op: 'flag', flg: id, cmp: 'gte', value: 1 }, quests: [], flag: { key: X.flagKey(i + 1), id: id, name: 'Earned: ' + nm,
      body: { kind: 'story', 'default': 0, range: [0, 1], notes: 'Set when the player earns ' + nm + '. With no quests to earn it, the finale asks the player and the answer sets this flag.' } } };
  };
  // The endings no quest earns: an end_ whose whole condition is one managed flag (family flg|ending|<n>) at 1 or more. The
  // generated finale offers them as a choice that sets the flag. {fallback, options [{end, text, flg}]}, or null when there
  // is no fallback or nothing to choose.
  X.flagChoices = function (b) {
    b = b || cur();
    var scaf = b && b.story && b.story.scaffold || {}, managed = {}, list = X.list(b), fb = list.filter(X.isFallback)[0], opts = [];
    Object.keys(scaf).forEach(function (k) { if (k.indexOf(X.FLAG_PREFIX) === 0) managed[scaf[k]] = 1; });
    list.forEach(function (r) {
      var c = r.cond;
      if (U.isObj(c) && c.op === 'flag' && c.cmp === 'gte' && c.value === 1 && managed[c.flg]) opts.push({ end: r.id, text: r.name || r.id, flg: c.flg });
    });
    return fb && opts.length ? { fallback: fb, options: opts } : null;
  };
  // [{key, id, name, order, body}] one per Charter ending, and the managed flags they read.
  X.wanted = function (b) {
    b = b || cur();
    var es = STORY.endings(b), out = { endings: [], flags: [] };
    es.forEach(function (e, i) {
      var name = ordinalName(e, i), key = X.keyFor(i + 1, name), concept = trim(e && e.concept);
      var body = { order: i + 1, concept: concept, priority: i === 0 ? X.FALLBACK_PRIORITY : X.STEP * i, music: X.roleFor(i + 1), epilogue: concept ? [cut(concept, 300)] : [] };
      if (i === 0) { body.cond = { op: 'true' }; body.notes = 'The fallback: the ending a player gets when no other ending is earned.'; }
      else {
        var er = X.earned(i, es.length, b);
        body.cond = er.cond;
        if (er.flag) out.flags.push(er.flag);
        body.notes = er.quests.length ? 'Earned by finishing ' + er.quests.map(function (q) { return nameOf(q, q); }).join(', ') + '.' : 'No quest earns it, so the finale asks the player and the answer sets its flag.';
      }
      out.endings.push({ key: key, id: X.idFor(key), name: name, order: i + 1, body: body });
    });
    return out;
  };
  function generated(w) { var rec = STORY.envelope('end_', w.key, w.name, w.body); rec.gen = E.genOf(rec); return rec; }

  // ---------------------------------------------------------------- the scaffold
  function referenced(id, b) {
    var s = b.story, hit = false;
    ['end_', 'evt_', 'qst_', 'dlg_'].forEach(function (p) { Object.keys(s.records[p] || {}).forEach(function (k) { if (!hit && JSON.stringify(s.records[p][k]).indexOf('"' + id + '"') >= 0) hit = true; }); });
    Object.keys(s.npcDialogue || {}).forEach(function (k) { if (!hit && JSON.stringify(s.npcDialogue[k]).indexOf('"' + id + '"') >= 0) hit = true; });
    return hit;
  }
  // True when an ending's own condition reads the flag: a swapped fallback keeps reading its managed flag.
  function readByEnding(id, b) {
    var R = b.story.records.end_, hit = false;
    Object.keys(R).forEach(function (k) { if (!hit && JSON.stringify(R[k].cond === undefined ? null : R[k].cond).indexOf('"' + id + '"') >= 0) hit = true; });
    return hit;
  }
  function touch(b) { if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-endings'); } }
  // Idempotent. Builds what is missing, refreshes unedited generated endings whose inputs moved (the quests the condition
  // reads), keeps edited ones, hands an edited ending the Charter no longer asks for to the author, drops an unedited one,
  // and refreshes the finale event when it is unedited, so the finale picks the endings up. Returns a report.
  X.scaffold = function (b) {
    b = b || cur();
    var rep = { created: [], refreshed: [], kept: [], removed: [], orphaned: [], flagsMade: [], flagsDropped: [], flagsKept: [], hints: [], changed: false, skipped: null, sync: null, finale: null };
    if (!b) { rep.skipped = 'No bundle is open.'; return rep; }
    var ready = STORY.readiness(b);
    if (ready !== true) { rep.skipped = ready; return rep; }
    STORY.ensure(b);
    F.sync(b);
    var s = b.story, R = s.records.end_, FL = s.records.flg_, scaf = s.scaffold, W = X.wanted(b), want = {}, wantFlag = {};
    if (!W.endings.length) rep.hints.push('The Charter lists no endings. Add one in Saga Forge (Day 146), or add an ending here by hand.');
    if (W.endings.length && !X.optional(b).length && W.endings.length > 1) rep.hints.push('There are no side or B story quests yet, so the finale asks the player to choose the earned endings. Build the quests, then update the endings to earn them instead.');
    W.flags.forEach(function (f) {
      wantFlag[f.key] = 1;
      if (!FL[f.id]) { FL[f.id] = STORY.envelope('flg_', f.key, f.name, f.body); rep.flagsMade.push(f.id); }
      if (scaf[f.key] !== f.id) { scaf[f.key] = f.id; rep.changed = true; }
    });
    W.endings.forEach(function (w) {
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
      if (k.indexOf('end|') === 0 && !want[k]) {
        var r = R[id];
        if (r && r.origin === 'generated') { if (E.isEdited(r)) { r.origin = 'user'; delete r.gen; rep.orphaned.push(id); } else { delete R[id]; rep.removed.push(id); } }
        delete scaf[k]; rep.changed = true;
      }
    });
    // The finale is refreshed before any flag is dropped, so a flag only the old finale set can go with it.
    if (b === cur()) Kit.index.invalidate();
    if (E.refreshFinale) { rep.finale = E.refreshFinale(b); if (rep.finale === 'refreshed') rep.changed = true; }
    Object.keys(scaf).sort().forEach(function (k) {
      var id = scaf[k];
      if (k.indexOf(X.FLAG_PREFIX) === 0 && !wantFlag[k]) {
        var f = FL[id];
        if (f && f.origin === 'generated') {
          if (readByEnding(id, b)) return;
          if (referenced(id, b)) { f.origin = 'user'; rep.flagsKept.push(id); } else { delete FL[id]; rep.flagsDropped.push(id); }
        }
        delete scaf[k]; rep.changed = true;
      }
    });
    if (rep.created.length || rep.refreshed.length || rep.removed.length || rep.orphaned.length || rep.flagsMade.length || rep.flagsDropped.length || rep.flagsKept.length || rep.changed) {
      s.records.end_ = sortedObj(R); s.records.flg_ = sortedObj(FL); s.scaffold = sortedObj(scaf);
      rep.changed = true;
      if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-endings'); }
    }
    rep.sync = F.sync(b);
    if (rep.sync.changed) rep.changed = true;
    if (rep.finale === 'kept') rep.hints.push('The finale is edited, so it was left as you made it. Check that it reaches every ending.');
    if (rep.finale === 'missing') rep.hints.push('Build the events so the finale can reach these endings.');
    return rep;
  };
  X.reportText = function (rep) {
    if (rep.skipped) return rep.skipped;
    var parts = [];
    if (rep.created.length) parts.push(plural(rep.created.length, 'ending') + ' built');
    if (rep.refreshed.length) parts.push(plural(rep.refreshed.length, 'ending') + ' updated');
    if (rep.kept.length) parts.push(plural(rep.kept.length, 'edited ending') + ' kept as you left ' + (rep.kept.length === 1 ? 'it' : 'them'));
    if (rep.removed.length) parts.push(plural(rep.removed.length, 'ending') + ' no longer needed');
    if (rep.orphaned.length) parts.push(plural(rep.orphaned.length, 'edited ending') + ' kept as yours');
    if (rep.finale === 'refreshed') parts.push('the finale now reaches them');
    var t = parts.length ? parts.join(', ') + '.' : 'Endings are up to date.';
    return rep.hints.length ? t + ' ' + rep.hints.join(' ') : t;
  };
  // What a scaffold run would build and what is there: {want, have, missing, stale}.
  X.expected = function (b) {
    b = b || cur();
    var W = X.wanted(b).endings, s = b && b.story, have = 0, missing = 0, stale = 0;
    W.forEach(function (w) {
      var r = s && s.records.end_[w.id];
      if (r) { have++; if (r.origin === 'generated' && !E.isEdited(r) && generated(w).gen !== r.gen) stale++; } else missing++;
    });
    return { want: W.length, have: have, missing: missing, stale: stale };
  };

  // ---------------------------------------------------------------- reading
  X.list = function (b) { return E.endingOrder(b || cur()); };
  X.isFallback = function (rec) { return !!rec && alwaysTrue(rec.cond); };
  X.fallbacks = function (b) { return X.list(b).filter(X.isFallback); };
  // The ending a state earns: the highest priority whose condition passes, or null.
  X.pick = function (state, b) {
    b = b || cur();
    var idx = STORY.engineIndex(b), list = X.list(b);
    for (var i = 0; i < list.length; i++) if (ES.cond.eval(list[i].cond === undefined ? null : list[i].cond, state, idx)) return list[i];
    return null;
  };
  // Where each end_ is used: the events that reach it. auto marks a generated, unedited event (the finale), which a rebuild
  // rewrites and so never keeps an ending alive.
  X.usedBy = function (id, b) {
    b = b || cur();
    var out = [];
    STORY.records.list('evt_', b).forEach(function (ev) {
      var hit = false;
      (Array.isArray(ev.pages) ? ev.pages : []).forEach(function (p) { if (U.isObj(p)) ES.cmd.walk(p.cmds, function (c) { if (U.isObj(c) && c.op === 'ending' && c.end === id) hit = true; }); });
      if (hit) out.push({ id: ev.id, name: ev.name || ev.id, auto: ev.origin === 'generated' && !E.isEdited(ev) });
    });
    return out;
  };

  // ---------------------------------------------------------------- playtime
  // Cheap enough to run on every validation: a Day 148 Final is loaded. (STORY.readiness re-proves the whole world, which
  // the scaffold buttons do once; the floor check must not.)
  function hasWorld(b) { var f = b && U.isObj(b.kit) && U.isObj(b.kit.forges) ? b.kit.forges['148'] : null; return !!(f && f.status === 'final') && U.isObj(b.world); }
  X.hasWorld = hasWorld;
  X.questMinutes = function (b) { b = b || cur(); var m = b && b.story && b.story.settings && b.story.settings.questMinutes; return U.isObj(m) ? m : {}; };
  X.playtime = function (b) {
    b = b || cur();
    var floor = Number(b.story.settings.floorMinutes) || 720, main = STORY.minutes(b), over = X.questMinutes(b), rows = [], side = { count: 0, minutes: 0 }, bs = { count: 0, minutes: 0 };
    X.optional(b).forEach(function (q) {
      var set = isInt(over[q.id]) && over[q.id] >= 0 ? over[q.id] : null, mins = set === null ? (q.kind === 'side' ? X.SIDE_MINUTES : X.BSTORY_MINUTES) : set, bucket = q.kind === 'side' ? side : bs;
      bucket.count++; bucket.minutes += mins;
      rows.push({ id: q.id, name: q.name || q.id, kind: q.kind, chapter: q.chapter || null, minutes: mins, estimated: set === null });
    });
    var chapters = STORY.chapters(b).map(function (c) { return { id: c.id, name: c.name || c.id, minutes: typeof c.targetMinutes === 'number' && c.targetMinutes > 0 ? c.targetMinutes : 0 }; });
    return { floor: floor, main: main, chapters: chapters, side: side, bstory: bs, optional: side.minutes + bs.minutes, total: main + side.minutes + bs.minutes, meets: main >= floor, short: Math.max(0, floor - main), rows: rows };
  };
  // Sets (or with null clears) the minutes an optional quest takes. Reported on their own, never toward the floor.
  X.setQuestMinutes = function (qst, minutes, b) {
    b = b || cur();
    STORY.ensure(b);
    var q = STORY.records.get(qst, b);
    if (!q || (q.kind !== 'side' && q.kind !== 'bstory')) return { ok: false, message: 'Only side and B story quests carry minutes of their own; the chapters carry the main story\'s.' };
    var m = U.isObj(b.story.settings.questMinutes) ? b.story.settings.questMinutes : {};
    if (minutes === null || minutes === undefined || minutes === '') delete m[qst];
    else {
      if (!isInt(minutes) || minutes < 0 || minutes > X.MAX_MINUTES) return { ok: false, message: 'Minutes are a whole number from 0 to ' + X.MAX_MINUTES + '.' };
      m[qst] = minutes;
    }
    b.story.settings.questMinutes = sortedObj(m);
    if (!Object.keys(m).length) delete b.story.settings.questMinutes;
    touch(b);
    return { ok: true };
  };
  Kit.validate.register('story.playtime', function (b, ctx) {
    if (!b || !U.isObj(b.story) || !hasWorld(b)) return;
    var p = X.playtime(b), chs = STORY.chapters(b);
    if (!p.meets && chs.length) ctx.add({ recordId: chs[chs.length - 1].id, fieldPath: 'targetMinutes', level: 'error',
      message: 'The chapters add up to ' + p.main + ' minutes, short of the ' + p.floor + ' minute floor (' + (p.floor / 60) + ' hours) by ' + p.short + '. Raise chapter target minutes in Saga Forge (Day 146). Side and B story minutes never count toward the floor.' });
  });

  // ---------------------------------------------------------------- checks
  // [{level, code, path, message}] for one ending. idx must hold the record (STORY.engineIndex, or indexWith for a candidate).
  X.check = function (rec, b, idx) {
    b = b || cur();
    var out = [];
    function add(level, code, path, message) { out.push({ level: level, code: code, path: path, message: message }); }
    if (!U.isObj(rec)) { add('error', 'shape', '', 'An ending must be an object.'); return out; }
    if (typeof rec.name !== 'string' || !rec.name.trim()) add('error', 'name', 'name', 'An ending needs a name.');
    if (rec.order !== undefined && (!isInt(rec.order) || rec.order < 1 || rec.order > 99)) add('error', 'order', 'order', 'The Charter position is a whole number from 1 to 99.');
    if (rec.priority !== undefined && (!isInt(rec.priority) || rec.priority < -999 || rec.priority > 999)) add('error', 'priority', 'priority', 'Priority is a whole number from -999 to 999.');
    if (rec.cond !== undefined && rec.cond !== null) {
      if (!U.isObj(rec.cond)) add('error', 'cond', 'cond', 'A condition is a tree: all, any, not, flag, item, chapter, quest, or true.');
      else ES.cond.lint(rec.cond, idx, 'cond').forEach(function (x) { add(x.level, x.code, x.path, x.message); });
    }
    if (rec.music !== undefined && rec.music !== null && rec.music !== '') {
      if (typeof rec.music !== 'string') add('error', 'music', 'music', 'Music is a role key or a mus_.');
      else if (/^mus_/.test(rec.music)) { if (idx && idx.known && idx.known.mus_ && !idx.known.mus_[rec.music]) add('error', 'ref', 'music', rec.music + ' is not a track of Day 147.'); }
      else if (idx && idx.roles && !idx.roles[rec.music.replace(/^music:/, '')]) add('warning', 'unscored', 'music', 'No music is scored for role ' + rec.music + ' in Day 147, so the credits play silence.');
    }
    if (rec.epilogue !== undefined) {
      if (!Array.isArray(rec.epilogue)) add('error', 'epilogue', 'epilogue', 'The epilogue is a list of lines.');
      else {
        if (rec.epilogue.length > X.MAX_EPILOGUE) add('error', 'epilogue', 'epilogue', 'An epilogue holds up to ' + X.MAX_EPILOGUE + ' lines.');
        rec.epilogue.forEach(function (l, i) { if (typeof l !== 'string' || !l.trim() || l.length > 300) add('error', 'epilogue', 'epilogue[' + i + ']', 'Each epilogue line is text of 1 to 300 characters.'); });
      }
    }
    return out;
  };
  // Problems across the whole set: [{level, code, recordId, message}]. Reads the end_ records, never writes. Empty list means
  // the finale can always show something.
  X.setProblems = function (b) {
    b = b || cur();
    var out = [], list = X.list(b), fb = list.filter(X.isFallback), charter = STORY.endings(b);
    function add(level, code, recordId, message) { out.push({ level: level, code: code, recordId: recordId, message: message }); }
    if (!list.length) return out;
    var first = list[0].id;
    if (!fb.length) add('error', 'no-fallback', first, 'No ending is a fallback, so a player could reach the finale with nothing to show. Make one ending always true.');
    if (fb.length > 1) add('error', 'two-fallbacks', fb[0].id, plural(fb.length, 'ending') + ' are always true (' + fb.map(function (r) { return r.name || r.id; }).join(', ') + '), so only the highest priority can ever win. Exactly one ending is the fallback.');
    var fbp = fb.length ? (isInt(fb[0].priority) ? fb[0].priority : 0) : null, seen = {}, orders = {};
    list.forEach(function (r) {
      var p = isInt(r.priority) ? r.priority : 0;
      if (!X.isFallback(r)) {
        if (fbp !== null && fb.length === 1 && p < fbp) add('error', 'shadowed', r.id, (r.name || r.id) + ' has a lower priority than the fallback, so the fallback always wins and this ending can never be reached.');
        else if (fbp !== null && fb.length === 1 && p === fbp) add('warning', 'tie-fallback', r.id, (r.name || r.id) + ' has the same priority as the fallback; the finale breaks the tie by key. Give it a higher priority.');
        (seen[p] = seen[p] || []).push(r);
      }
      if (isInt(r.order)) (orders[r.order] = orders[r.order] || []).push(r);
    });
    Object.keys(seen).sort(function (a, z) { return Number(a) - Number(z); }).forEach(function (p) { if (seen[p].length > 1) add('warning', 'tie', seen[p][0].id, seen[p].map(function (r) { return r.name || r.id; }).join(' and ') + ' share priority ' + p + '; if both are earned, the finale breaks the tie by key.'); });
    Object.keys(orders).sort(function (a, z) { return Number(a) - Number(z); }).forEach(function (o) { if (orders[o].length > 1) add('warning', 'duplicate-order', orders[o][0].id, orders[o].length + ' endings claim Charter position ' + o + '.'); });
    list.forEach(function (r) { if (isInt(r.order) && r.order > charter.length) add('warning', 'stale-order', r.id, (r.name || r.id) + ' stands for Charter ending ' + r.order + ', but the Charter lists ' + plural(charter.length, 'ending') + '.'); });
    var have = {};
    list.forEach(function (r) { if (isInt(r.order)) have[r.order] = 1; });
    charter.forEach(function (e, i) { if (!have[i + 1]) add('warning', 'unbuilt', first, 'Charter ending ' + (i + 1) + ' (' + ordinalName(e, i) + ') has no end_ record yet. Build the endings.'); });
    return out;
  };
  // Everything a Final needs from this phase, in one list: [{level, code, recordId, message}]. Phase 7 reads it.
  X.problems = function (b) {
    b = b || cur();
    var out = [], list = X.list(b), idx = STORY.engineIndex(b), charter = STORY.endings(b);
    if (!list.length) out.push({ level: 'error', code: charter.length ? 'none-built' : 'no-endings', recordId: null, message: charter.length ? 'No endings are built yet. Build the endings from the Charter.' : 'The Charter lists no endings. Add one in Saga Forge (Day 146), or add an ending here by hand.' });
    list.forEach(function (r) { X.check(r, b, idx).forEach(function (p) { out.push({ level: p.level, code: p.code, recordId: r.id, message: p.message }); }); });
    X.setProblems(b).forEach(function (p) { out.push(p); });
    if (hasWorld(b)) { var pt = X.playtime(b); if (!pt.meets) out.push({ level: 'error', code: 'floor', recordId: null, message: 'The main story is ' + pt.main + ' minutes, short of the ' + pt.floor + ' minute floor by ' + pt.short + '.' }); }
    return out;
  };
  X.summary = function (b) {
    b = b || cur();
    var list = X.list(b), p = X.problems(b), ex = X.expected(b), pt = X.playtime(b);
    return { total: list.length, fallbacks: X.fallbacks(b).length, earned: list.filter(function (r) { return !X.isFallback(r); }).length, authored: list.filter(function (r) { return r.origin === 'user'; }).length,
      missing: ex.missing, stale: ex.stale, errors: p.filter(function (x) { return x.level === 'error'; }).length, warnings: p.filter(function (x) { return x.level === 'warning'; }).length, meets: pt.meets, main: pt.main, floor: pt.floor };
  };
  function indexWith(rec, b) {
    var recs = {};
    Object.keys(b.story.records).forEach(function (p) { recs[p] = b.story.records[p]; });
    recs.end_ = {};
    Object.keys(b.story.records.end_).forEach(function (k) { recs.end_[k] = b.story.records.end_[k]; });
    recs.end_[rec.id] = rec;
    return ES.index.build({ records: recs, bindings: b.story.bindings, npcDialogue: b.story.npcDialogue }, STORY.engineExt(b));
  }
  X.indexWith = indexWith;
  Kit.validate.register('story.endings', function (b, ctx) {
    var s = b.story;
    if (!s || !U.isObj(s.records) || !U.isObj(s.records.end_)) return;
    var ids = Object.keys(s.records.end_).sort();
    if (!ids.length) return;
    var idx = STORY.engineIndex(b);
    ids.forEach(function (id) { X.check(s.records.end_[id], b, idx).forEach(function (p) { ctx.add({ recordId: id, fieldPath: p.path, message: p.message, level: p.level }); }); });
    X.setProblems(b).forEach(function (p) { ctx.add({ recordId: p.recordId, fieldPath: '', message: p.message, level: p.level }); });
  });

  // ---------------------------------------------------------------- editing
  function sameProblem(a, z) { return a.code === z.code && a.path === z.path && a.message === z.message; }
  // Applies fn to a copy of the ending. A result with an error string refuses the edit, and so does an edit that would add an
  // error the ending did not already have. Nothing is written then. Returns {ok, record} or {ok: false, problems}.
  X.edit = function (id, fn, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.end_, rec = R && R[id];
    if (!rec) return { ok: false, problems: [{ level: 'error', code: 'missing', path: 'id', message: 'That ending does not exist.' }] };
    var before = X.check(rec, b, STORY.engineIndex(b)).filter(function (p) { return p.level === 'error'; });
    var next = clone(rec), r = fn(next);
    if (r && r.error) return { ok: false, problems: [{ level: 'error', code: 'edit', path: '', message: r.error }] };
    var fresh = X.check(next, b, indexWith(next, b)).filter(function (p) { return p.level === 'error' && !before.some(function (x) { return sameProblem(x, p); }); });
    if (fresh.length) return { ok: false, problems: fresh };
    R[id] = next;
    touch(b);
    return { ok: true, record: next };
  };
  function epilogueOf(v) { return (Array.isArray(v) ? v : String(v === undefined || v === null ? '' : v).split(/\r?\n/)).map(trim).filter(function (l) { return !!l; }); }
  X.epilogueOf = epilogueOf;
  // Fields: name, notes, concept, priority, music ('' or null clears), epilogue (a list, or text with a line per line).
  X.update = function (id, patch, b) {
    patch = patch || {};
    return X.edit(id, function (e) {
      if (patch.name !== undefined) e.name = trim(patch.name);
      if (patch.notes !== undefined) e.notes = String(patch.notes);
      if (patch.concept !== undefined) e.concept = trim(patch.concept);
      if (patch.priority !== undefined) { if (!isInt(patch.priority)) return { error: 'Priority is a whole number.' }; e.priority = patch.priority; }
      if (patch.music !== undefined) { if (patch.music === null || patch.music === '') delete e.music; else e.music = trim(patch.music); }
      if (patch.epilogue !== undefined) e.epilogue = epilogueOf(patch.epilogue);
    }, b);
  };
  // A missing or null condition means always true, which is the fallback.
  X.setCond = function (id, cond, b) {
    return X.edit(id, function (e) { e.cond = cond === null || cond === undefined ? { op: 'true' } : clone(cond); }, b);
  };
  // The flag an ending reads once it stops being the fallback: the managed flag for a generated ending with a Charter
  // position, a flag made by hand for any other.
  function flagFor(rec, b) {
    var s = b.story, FL = s.records.flg_, nm = 'Earned: ' + (rec.name || rec.id), note = 'Set it from a choice or an event when the player earns ' + (rec.name || rec.id) + '.', id, f;
    if (isInt(rec.order) && rec.origin === 'generated') {
      id = X.flagId(rec.order);
      if (!FL[id]) FL[id] = STORY.envelope('flg_', X.flagKey(rec.order), nm, { kind: 'story', 'default': 0, range: [0, 1], notes: note });
      s.scaffold[X.flagKey(rec.order)] = id;
      return id;
    }
    f = STORY.authored('flg_', nm, { kind: 'story', 'default': 0, range: [0, 1], notes: note });
    FL[f.id] = f;
    return f.id;
  }
  // Makes one ending the fallback (always true, the lowest priority). Any other always true ending is given a flag of its own
  // to read, so exactly one is the fallback afterward. Returns {ok, changed [end_]}.
  X.makeFallback = function (id, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.end_;
    if (!R || !R[id]) return { ok: false, message: 'That ending does not exist.' };
    var others = X.list(b).filter(function (r) { return r.id !== id; }), lo = null, changed = [];
    others.forEach(function (r) { var p = isInt(r.priority) ? r.priority : 0; if (lo === null || p < lo) lo = p; });
    var pri = lo === null ? X.FALLBACK_PRIORITY : Math.max(-999, lo - X.STEP);
    var demote = others.filter(X.isFallback), flags = {};
    demote.forEach(function (r) { flags[r.id] = flagFor(r, b); });
    var res = X.edit(id, function (e) { e.cond = { op: 'true' }; e.priority = pri; }, b);
    if (!res.ok) return res;
    changed.push(id);
    demote.forEach(function (r) { var r2 = X.edit(r.id, function (e) { e.cond = { op: 'flag', flg: flags[r.id], cmp: 'gte', value: 1 }; }, b); if (r2.ok) changed.push(r.id); });
    F.sync(b);
    touch(b);
    return { ok: true, changed: changed };
  };
  // An ending made by hand: a minted ID, origin user, earned by a flag of its own (so it is never a second fallback), tested
  // before every ending there is. spec: {name, concept}.
  X.add = function (spec, b) {
    b = b || cur();
    STORY.ensure(b);
    spec = spec || {};
    var name = trim(spec.name) || 'New ending', top = null;
    X.list(b).forEach(function (r) { var p = isInt(r.priority) ? r.priority : 0; if (top === null || p > top) top = p; });
    var rec = STORY.authored('end_', name, { concept: trim(spec.concept), priority: Math.min(999, (top === null ? 0 : top) + X.STEP), music: 'ending', epilogue: [], notes: '' });
    var f = STORY.authored('flg_', 'Earned: ' + name, { kind: 'story', 'default': 0, range: [0, 1], notes: 'Set it from a choice or an event when the player earns ' + name + '.' });
    rec.cond = { op: 'flag', flg: f.id, cmp: 'gte', value: 1 };
    b.story.records.flg_[f.id] = f;
    b.story.records.end_[rec.id] = rec;
    b.story.records.flg_ = sortedObj(b.story.records.flg_);
    b.story.records.end_ = sortedObj(b.story.records.end_);
    touch(b);
    return { ok: true, record: rec, flag: f.id };
  };
  // Removes an ending made by hand. A generated ending is edited instead (a rebuild would bring it back), and an ending an
  // event reaches is refused until that event stops using it.
  X.remove = function (id, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.end_, rec = R && R[id];
    if (!rec) return { ok: false, message: 'That ending does not exist.' };
    if (rec.origin === 'generated') return { ok: false, message: 'The Charter asks for this ending, so a rebuild would bring it back. Edit it instead.' };
    var used = X.usedBy(id, b).filter(function (u) { return !u.auto; });
    if (used.length) return { ok: false, message: 'Used by ' + used.map(function (u) { return u.name; }).join(', ') + '. Change those events first.' };
    delete R[id];
    if (E.refreshFinale) E.refreshFinale(b);
    touch(b);
    return { ok: true };
  };
  // Puts a generated ending back to what the scaffold makes.
  X.reset = function (id, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.end_, rec = R && R[id];
    if (!rec) return { ok: false, message: 'That ending does not exist.' };
    var w = X.wanted(b).endings.filter(function (x) { return x.id === id; })[0];
    if (!w) return { ok: false, message: 'The Charter no longer asks for this ending, so there is nothing to reset it to.' };
    R[id] = generated(w);
    X.wanted(b).flags.forEach(function (f) {
      if (!b.story.records.flg_[f.id]) b.story.records.flg_[f.id] = STORY.envelope('flg_', f.key, f.name, f.body);
      b.story.scaffold[f.key] = f.id;
    });
    b.story.records.flg_ = sortedObj(b.story.records.flg_);
    b.story.scaffold = sortedObj(b.story.scaffold);
    touch(b);
    return { ok: true, record: R[id] };
  };
  // Where the first ending a state earns is said in words: "Delivered (the fallback)" or the ending and its priority.
  X.describe = function (rec, b) {
    if (!rec) return 'no ending';
    return (rec.name || rec.id) + (X.isFallback(rec) ? ' (the fallback)' : ' (priority ' + (isInt(rec.priority) ? rec.priority : 0) + ')');
  };
})();
// === STORY:ENDINGS END ===
