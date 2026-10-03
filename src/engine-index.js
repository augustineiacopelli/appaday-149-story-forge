  // ---------------------------------------------------------------- index (Phase 1)
  // Every interpreter function reads the story through an index: plain lookup tables built once from the story namespace
  // and the few facts it needs from the rest of the bundle. The engine never reaches into a bundle itself, so Day 150 and
  // the page build the same index from the same data and get the same answers.
  //   build(story, ext)
  //     story: {records {flg_ qst_ dlg_ evt_ end_}, bindings {gateKey: {flg, itm}}}
  //     ext:   {chapters [chp ids in Charter order], start [gate keys open at a new game, Day 148's graph.start],
  //             ids {prefix: [ids]} for the other namespaces a story may name (npc_ map_ trp_ itm_ eqp_ chr_ mus_ sfx_
  //             por_ chp_), roles [Day 147 music role keys without the 'music:' prefix, such as 'battle' or
  //             'field:westland']}
  //   The result is a fresh object the caller owns. Records are copied in, so editing the bundle afterward never changes
  //   an index already built; rebuild it instead.
  var REF_PREFIXES = ['chp_', 'chr_', 'dlg_', 'end_', 'eqp_', 'evt_', 'flg_', 'itm_', 'map_', 'mus_', 'npc_', 'por_', 'qst_', 'sfx_', 'trp_'];
  function intOr(v, d) { return typeof v === 'number' && v === Math.floor(v) && v >= -2147483648 && v <= 2147483647 ? v : d; }
  function setsList(list) {
    var out = [];
    if (Array.isArray(list)) for (var i = 0; i < list.length; i++) if (isObj(list[i]) && typeof list[i].flg === 'string') out.push({ flg: list[i].flg, value: intOr(list[i].value, 1) });
    return out;
  }
  function questShape(q) {
    var stages = Array.isArray(q.stages) ? q.stages.filter(isObj) : [], st = [], at = {};
    for (var i = 0; i < stages.length; i++) {
      var k = typeof stages[i].key === 'string' ? stages[i].key : 's' + i;
      if (at[k] !== undefined) continue;
      at[k] = st.length;
      st.push({ key: k, label: String(stages[i].label || k), sets: setsList(stages[i].sets), exitWhen: stages[i].exitWhen === undefined ? null : copy(stages[i].exitWhen) });
    }
    var groups = Array.isArray(q.branches) ? q.branches.filter(isObj) : [], br = {}, order = [];
    for (var g = 0; g < groups.length; g++) {
      var gk = typeof groups[g].key === 'string' ? groups[g].key : 'b' + g;
      if (br[gk]) continue;
      var outs = {}, oo = [], list = Array.isArray(groups[g].outcomes) ? groups[g].outcomes.filter(isObj) : [];
      for (var o = 0; o < list.length; o++) {
        var ok = typeof list[o].key === 'string' ? list[o].key : 'o' + o;
        if (outs[ok]) continue;
        outs[ok] = { key: ok, label: String(list[o].label || ok), sets: setsList(list[o].sets) };
        oo.push(ok);
      }
      br[gk] = { key: gk, label: String(groups[g].label || gk), outcomes: outs, order: oo };
      order.push(gk);
    }
    var fail = isObj(q.fail) ? { cond: q.fail.cond === undefined ? null : copy(q.fail.cond), sets: setsList(q.fail.sets) } : null;
    return { stages: st, stageAt: at, branches: br, branchOrder: order, fail: fail, completeFlag: typeof q.completeFlag === 'string' ? q.completeFlag : null };
  }
  function buildIndex(story, ext) {
    story = isObj(story) ? story : {};
    ext = isObj(ext) ? ext : {};
    var recs = isObj(story.records) ? story.records : {};
    var I = { flags: {}, quests: {}, dialogues: {}, events: {}, endings: {}, known: {}, roles: {}, chapters: [], chapterAt: {}, chapterFlags: {}, gates: {}, start: [] };
    for (var p = 0; p < REF_PREFIXES.length; p++) I.known[REF_PREFIXES[p]] = {};
    var ids = isObj(ext.ids) ? ext.ids : {};
    each(ids, function (list, prefix) {
      if (!I.known[prefix] || !Array.isArray(list)) return;
      for (var i = 0; i < list.length; i++) if (typeof list[i] === 'string') I.known[prefix][list[i]] = 1;
    });
    each(recs.flg_, function (r, id) {
      if (!isObj(r)) return;
      var range = Array.isArray(r.range) && r.range.length === 2 && intOr(r.range[0], null) !== null && intOr(r.range[1], null) !== null && r.range[0] <= r.range[1] ? [r.range[0], r.range[1]] : null;
      var d = intOr(r['default'], 0);
      if (range) d = clamp(d, range[0], range[1]);
      I.flags[id] = { kind: typeof r.kind === 'string' ? r.kind : 'story', 'default': d, range: range };
      I.known.flg_[id] = 1;
    });
    each(recs.qst_, function (r, id) { if (isObj(r)) { I.quests[id] = questShape(r); I.known.qst_[id] = 1; } });
    each(recs.dlg_, function (r, id) { if (isObj(r)) { I.dialogues[id] = copy(r); I.known.dlg_[id] = 1; } });
    each(recs.evt_, function (r, id) {
      if (!isObj(r)) return;
      var e = copy(r);
      if (!Array.isArray(e.pages)) e.pages = [];
      I.events[id] = e;
      I.known.evt_[id] = 1;
    });
    each(recs.end_, function (r, id) { if (isObj(r)) { I.endings[id] = copy(r); I.known.end_[id] = 1; } });
    var ch = Array.isArray(ext.chapters) ? ext.chapters : [];
    for (var c = 0; c < ch.length; c++) if (typeof ch[c] === 'string' && I.chapterAt[ch[c]] === undefined) { I.chapterAt[ch[c]] = I.chapters.length; I.chapters.push(ch[c]); I.known.chp_[ch[c]] = 1; }
    var roles = Array.isArray(ext.roles) ? ext.roles : [];
    for (var r0 = 0; r0 < roles.length; r0++) if (typeof roles[r0] === 'string') I.roles[roles[r0].replace(/^music:/, '')] = 1;
    // Gate bindings: one flag per Day 148 gate key. A chapter:<chp> binding is also how the engine knows the current
    // chapter (see state.chapterOf), so the command vocabulary needs no chapter command.
    each(story.bindings, function (bd, key) {
      if (!isObj(bd) || typeof bd.flg !== 'string') return;
      I.gates[key] = { flg: bd.flg, itm: typeof bd.itm === 'string' ? bd.itm : null };
      var g = gateParse(key);
      if (g.kind === 'chapter' && g.chapter) I.chapterFlags[g.chapter] = bd.flg;
    });
    var st = Array.isArray(ext.start) ? ext.start : [];
    for (var s = 0; s < st.length; s++) if (I.gates[st[s]] && I.start.indexOf(I.gates[st[s]].flg) < 0) I.start.push(I.gates[st[s]].flg);
    I.start.sort();
    I.digest = digest(canon({ story: { records: recs, bindings: story.bindings || {} }, ext: ext }));
    return I;
  }

  // ---------------------------------------------------------------- state (Phase 1)
  // A story state is plain JSON, so it can be copied, hashed, saved, and compared byte for byte:
  //   {flags {flg: int}, items {itm or eqp: int}, gil int, party [chr], quests {qst: {stage key or null, failed,
  //    closed [branch group keys, sorted]}}, chapter chp or null, seen {'evt#page': 1} (once pages that have run),
  //    ending end or null, run null or the runner's frame stack}
  // Flags hold every flag in the index (its default until something sets it). Every function that changes a state works
  // on a copy and returns it; the state passed in is never touched.
  function readFlag(state, idx, flg) {
    var v = state && state.flags ? state.flags[flg] : undefined;
    if (typeof v === 'number') return v;
    return idx && idx.flags[flg] ? idx.flags[flg]['default'] : 0;
  }
  function writeFlag(state, idx, flg, v) {
    v = intOr(Math.round(Number(v)), 0);
    var f = idx && idx.flags[flg];
    if (f && f.range) v = clamp(v, f.range[0], f.range[1]);
    state.flags[flg] = v;
    return v;
  }
  // The current chapter: the last chapter, in Charter order, whose bound chapter gate flag is set (1 or more), else the
  // first chapter. Recomputed whenever a flag changes.
  function chapterOf(state, idx) {
    var cur = idx.chapters.length ? idx.chapters[0] : null;
    for (var i = 0; i < idx.chapters.length; i++) {
      var f = idx.chapterFlags[idx.chapters[i]];
      if (f && readFlag(state, idx, f) >= 1) cur = idx.chapters[i];
    }
    return cur;
  }
  // A new game: every flag at its default, the gates open at the start set to 1, no items, no quests started.
  // opts: {gil, party [chr], items {itm: qty}}.
  function createState(idx, opts) {
    opts = isObj(opts) ? opts : {};
    var st = { flags: {}, items: {}, gil: Math.max(0, intOr(opts.gil, 0)), party: [], quests: {}, chapter: null, seen: {}, ending: null, run: null };
    each(idx.flags, function (f, id) { st.flags[id] = f['default']; });
    for (var i = 0; i < idx.start.length; i++) writeFlag(st, idx, idx.start[i], 1);
    each(opts.items, function (q, k) { var n = intOr(q, 0); if (n > 0) st.items[k] = Math.min(999, n); });
    if (Array.isArray(opts.party)) for (var j = 0; j < opts.party.length; j++) if (typeof opts.party[j] === 'string' && st.party.indexOf(opts.party[j]) < 0) st.party.push(opts.party[j]);
    each(idx.quests, function (q, id) { st.quests[id] = { stage: null, failed: false, closed: [] }; });
    st.chapter = chapterOf(st, idx);
    return copy(st);
  }
  function stateHash(state) { return digest(canon(state)); }
  S.index = { build: buildIndex, REF_PREFIXES: REF_PREFIXES };
  S.state = { create: createState, hash: stateHash, flag: readFlag, chapterOf: chapterOf };
