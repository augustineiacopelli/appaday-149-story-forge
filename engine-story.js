/* Story Forge ENGINE:STORY, engine version 1.0.0
 * Forge 149 (AppADay 149). Declares one global, ENGINE_STORY. No dependencies; reads no host global. */
// === ENGINE:STORY BEGIN ===
// Story Forge interpreter (AppADay 149). Declares one global, ENGINE_STORY, and reads no host global: no window, no
// document, no Kit, and no other engine. Day 150 loads engine-story.js after engine-render.js, engine-audio.js, and
// engine-world.js, and hands it plain data. Determinism rules for everything in this fence, checked by the tests:
//   no Math.random and no Date or performance (a story never rolls dice; Day 150 owns battles and their seeds);
//   every object is walked through util.keys, which sorts (never for in, never an unsorted Object.keys);
//   conditions and commands are JSON trees, never strings, so nothing here ever calls eval or new Function.
// Later phases add sections (src/engine-<part>.js) that build.js splices in above the freeze line, in order: cond, cmd,
// run, pages, save (Phase 1), then the walk (Phase 7).
var ENGINE_STORY = (function () {
  'use strict';
  var S = { version: '1.0.0' };

  // ---------------------------------------------------------------- util
  function keys(o) { return o && typeof o === 'object' ? Object.keys(o).sort() : []; }
  function each(o, fn) { var k = keys(o); for (var i = 0; i < k.length; i++) fn(o[k[i]], k[i], i); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  // A deep copy of plain JSON data (objects, arrays, strings, numbers, booleans, null). Keys come out sorted, so two
  // copies of the same data are identical byte for byte however their keys were first written.
  function copy(v) {
    if (Array.isArray(v)) { var a = new Array(v.length); for (var i = 0; i < v.length; i++) a[i] = copy(v[i]); return a; }
    if (isObj(v)) { var o = {}; each(v, function (x, k) { if (x !== undefined) o[k] = copy(x); }); return o; }
    return v;
  }
  // Canonical JSON: sorted keys, undefined dropped. Two equal states give the same text; the walk hashes it.
  function canon(v) {
    if (Array.isArray(v)) { var p = []; for (var i = 0; i < v.length; i++) p.push(canon(v[i])); return '[' + p.join(',') + ']'; }
    if (isObj(v)) { var q = []; each(v, function (x, k) { if (x !== undefined) q.push(JSON.stringify(k) + ':' + canon(x)); }); return '{' + q.join(',') + '}'; }
    return JSON.stringify(v === undefined ? null : v);
  }
  // FNV-1a over a string or a list of strings and numbers, for comparing records and states cheaply.
  function digest(a) {
    a = typeof a === 'string' ? [a] : a || [];
    var h = 0x811c9dc5;
    for (var i = 0; i < a.length; i++) {
      var s = String(a[i]);
      for (var j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 0x01000193); }
      h ^= 44; h = Math.imul(h, 0x01000193);
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8) + ':' + a.length;
  }
  S.util = { keys: keys, each: each, clamp: clamp, isObj: isObj, copy: copy, canon: canon, digest: digest };

  // ---------------------------------------------------------------- hashing
  // xmur3, the same string hash ENGINE_WORLD uses, so story IDs are built exactly the way world IDs are.
  function xmur3(str) {
    str = String(str);
    for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return function () { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
  }
  function hashStr(s) { return xmur3(s)(); }
  S.hash = { xmur3: xmur3, str: hashStr };

  // ---------------------------------------------------------------- structural IDs
  // Gate binding flags and every scaffolded record take an ID derived from a structural key (for example
  // 'flg|gate|chapter:chp_far_shore_izf4' or 'qst|main|chp_lowlands_auem'), built the way Day 148 builds world IDs:
  // prefix + slug(key, 40) + '_' + four base 36 characters of xmur3(prefix + key). Regenerating the scaffold therefore
  // never renames anything. Records an author makes by hand use Kit.ids.mint in the page instead.
  var ID_PREFIXES = ['dlg_', 'end_', 'evt_', 'flg_', 'qst_'];
  function slugKey(key, max) {
    var s = String(key).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return s.slice(0, max || 40).replace(/_+$/, '');
  }
  function structuralId(prefix, key) {
    var p = String(prefix).toLowerCase();
    if (p.length === 3) p += '_';
    if (ID_PREFIXES.indexOf(p) < 0) throw new Error('Not a story prefix: ' + prefix);
    var suf = ('0000' + (hashStr(p + key) % 1679616).toString(36)).slice(-4), s = slugKey(key);
    return p + (s ? s + '_' : '') + suf;
  }
  S.ids = { PREFIXES: ID_PREFIXES, slug: slugKey, structural: structuralId };

  // ---------------------------------------------------------------- the gate keys Day 148 leaves to this forge
  // Day 148's progression graph names four kinds of world local gate key in its nodes' requires and grants lists:
  // chapter:<chp>, item:seal:<chp>, vehicle:ship, and vehicle:airship. parse reads one into {kind, chapter, key}; an
  // unknown key is kind 'other', which Phase 2 reports rather than guessing.
  function gateParse(k) {
    var s = String(k), m;
    if ((m = /^chapter:(chp_[a-z0-9_]*[a-z0-9])$/.exec(s))) return { key: s, kind: 'chapter', chapter: m[1] };
    if ((m = /^item:seal:(chp_[a-z0-9_]*[a-z0-9])$/.exec(s))) return { key: s, kind: 'seal', chapter: m[1] };
    if (s === 'vehicle:ship') return { key: s, kind: 'ship', chapter: null };
    if (s === 'vehicle:airship') return { key: s, kind: 'airship', chapter: null };
    return { key: s, kind: 'other', chapter: null };
  }
  // Every gate key a graph uses, sorted, from its nodes' requires and grants and its start list.
  function gateKeys(graph) {
    var seen = {};
    function add(list) { if (Array.isArray(list)) for (var i = 0; i < list.length; i++) if (typeof list[i] === 'string') seen[list[i]] = 1; }
    if (graph && Array.isArray(graph.nodes)) for (var i = 0; i < graph.nodes.length; i++) { add(graph.nodes[i].requires); add(graph.nodes[i].grants); }
    if (graph) add(graph.start);
    return keys(seen);
  }
  S.gates = { KINDS: ['chapter', 'seal', 'ship', 'airship'], parse: gateParse, keys: gateKeys };

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

  // ---------------------------------------------------------------- conditions (Phase 1)
  // A condition is a JSON tree, never a string, so nothing is ever parsed or evaluated as code. A missing condition
  // (null or undefined) is true. The closed vocabulary, by op:
  //   {op: 'true'}
  //   {op: 'all', of: [cond]}       every child passes (an empty list passes)
  //   {op: 'any', of: [cond]}       some child passes (an empty list fails)
  //   {op: 'not', of: cond}         the child fails
  //   {op: 'flag', flg, cmp, value} the flag's integer compared with value; cmp eq ne gt gte lt lte (default gte, value 1)
  //   {op: 'item', itm, cmp, value} the held count of an itm_ or eqp_ (default gte 1)
  //   {op: 'chapter', chp, cmp}     the current chapter's Charter position compared with chp's (default gte)
  //   {op: 'quest', qst, is, stage} is 'at' (current stage equals), 'reached' (current stage is stage or later, and the
  //                                 quest has not failed), 'failed', 'started', or 'done' (at the last stage, not failed)
  var CMP = { eq: 1, ne: 1, gt: 1, gte: 1, lt: 1, lte: 1 };
  var COND_OPS = ['all', 'any', 'chapter', 'flag', 'item', 'not', 'quest', 'true'];
  var QUEST_IS = { at: 1, done: 1, failed: 1, reached: 1, started: 1 };
  var MAX_DEPTH = 32;
  function compare(a, cmp, b) {
    switch (cmp || 'gte') {
      case 'eq': return a === b;
      case 'ne': return a !== b;
      case 'gt': return a > b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      default: return a >= b;
    }
  }
  function questInfo(state, qst) { var q = state && state.quests ? state.quests[qst] : null; return isObj(q) ? q : { stage: null, failed: false, closed: [] }; }
  function evalTree(t, state, idx, depth) {
    if (t === null || t === undefined) return true;
    if (!isObj(t) || (depth || 0) > MAX_DEPTH) return false;
    var d = (depth || 0) + 1, i;
    switch (t.op) {
      case 'true': return true;
      case 'all':
        if (!Array.isArray(t.of)) return false;
        for (i = 0; i < t.of.length; i++) if (!evalTree(t.of[i], state, idx, d)) return false;
        return true;
      case 'any':
        if (!Array.isArray(t.of)) return false;
        for (i = 0; i < t.of.length; i++) if (evalTree(t.of[i], state, idx, d)) return true;
        return false;
      case 'not': return isObj(t.of) ? !evalTree(t.of, state, idx, d) : false;
      case 'flag': return typeof t.flg === 'string' && compare(readFlag(state, idx, t.flg), t.cmp, intOr(t.value, 1));
      case 'item': return typeof t.itm === 'string' && compare(intOr(state && state.items ? state.items[t.itm] : 0, 0), t.cmp, intOr(t.value, 1));
      case 'chapter': {
        if (!idx || typeof t.chp !== 'string' || idx.chapterAt[t.chp] === undefined) return false;
        var c = state && state.chapter != null ? idx.chapterAt[state.chapter] : -1;
        return compare(c === undefined ? -1 : c, t.cmp, idx.chapterAt[t.chp]);
      }
      case 'quest': {
        if (typeof t.qst !== 'string') return false;
        var q = questInfo(state, t.qst), def = idx ? idx.quests[t.qst] : null;
        switch (t.is) {
          case 'failed': return !!q.failed;
          case 'started': return q.stage !== null && q.stage !== undefined;
          case 'done': return !!def && !q.failed && def.stages.length > 0 && q.stage === def.stages[def.stages.length - 1].key;
          case 'at': return q.stage === t.stage;
          case 'reached': {
            if (!def || q.failed || q.stage == null || def.stageAt[t.stage] === undefined || def.stageAt[q.stage] === undefined) return false;
            return def.stageAt[q.stage] >= def.stageAt[t.stage];
          }
          default: return false;
        }
      }
      default: return false;
    }
  }

  // Depth of a tree, stopping as soon as it passes the limit.
  function treeDepth(t, d) {
    if (d > MAX_DEPTH || !isObj(t)) return d;
    var m = d;
    if (Array.isArray(t.of)) { for (var i = 0; i < t.of.length && m <= MAX_DEPTH; i++) m = Math.max(m, treeDepth(t.of[i], d + 1)); }
    else if (isObj(t.of)) m = Math.max(m, treeDepth(t.of, d + 1));
    return m;
  }
  // A tree deeper than the limit fails as a whole (checked first, so a not cannot turn the cutoff into a pass).
  function evalCond(t, state, idx) { return treeDepth(t, 0) > MAX_DEPTH ? false : evalTree(t, state, idx, 0); }
  // Problems are {path, level 'error' or 'warning', code, message}. path is where in the tree, such as
  // 'pages[1].cond.of[0]', prefixed by the caller's path.
  function problem(out, path, level, code, message) { out.push({ path: path, level: level, code: code, message: message }); }
  function refOk(idx, prefix, id) { return typeof id === 'string' && !!idx && !!idx.known[prefix] && !!idx.known[prefix][id]; }
  function prefixOf(id) { return typeof id === 'string' && /^[a-z]{3}_/.test(id) ? id.slice(0, 4) : ''; }
  function noIdField(o, path, out) {
    if (isObj(o) && o.id !== undefined) problem(out, path + '.id', 'error', 'id-field', 'A field named id is not allowed inside a story record (every forge reads any object with an id as a record). Use flg, qst, evt, and the like.');
  }
  function lintInt(v, path, out, name) {
    if (v === undefined) return;
    if (intOr(v, null) === null) problem(out, path + '.' + name, 'error', 'not-int', name + ' must be a whole number.');
  }
  function lintCond(t, idx, path, out, depth) {
    out = out || [];
    path = path || 'cond';
    depth = depth || 0;
    if (t === null || t === undefined) return out;
    if (!isObj(t)) { problem(out, path, 'error', 'not-object', 'A condition must be an object with an op.'); return out; }
    if (depth > MAX_DEPTH) { problem(out, path, 'error', 'too-deep', 'Conditions nest more than ' + MAX_DEPTH + ' levels.'); return out; }
    noIdField(t, path, out);
    var i;
    switch (t.op) {
      case 'true': break;
      case 'all': case 'any':
        if (!Array.isArray(t.of)) { problem(out, path + '.of', 'error', 'missing', t.op + ' needs a list of conditions in of.'); break; }
        if (t.op === 'any' && !t.of.length) problem(out, path + '.of', 'warning', 'never', 'An empty any never passes.');
        for (i = 0; i < t.of.length; i++) lintCond(t.of[i], idx, path + '.of[' + i + ']', out, depth + 1);
        break;
      case 'not':
        if (!isObj(t.of)) problem(out, path + '.of', 'error', 'missing', 'not needs one condition in of.');
        else lintCond(t.of, idx, path + '.of', out, depth + 1);
        break;
      case 'flag': case 'item': {
        var key = t.op === 'flag' ? 'flg' : 'itm';
        if (typeof t[key] !== 'string' || !t[key]) problem(out, path + '.' + key, 'error', 'missing', t.op + ' needs ' + key + '.');
        else if (t.op === 'flag' ? !refOk(idx, 'flg_', t.flg) : !(refOk(idx, 'itm_', t.itm) || refOk(idx, 'eqp_', t.itm))) problem(out, path + '.' + key, 'error', 'ref', t[key] + ' does not resolve' + (t.op === 'item' ? ' to an item or equipment.' : ' to a flag.'));
        if (t.cmp !== undefined && !CMP[t.cmp]) problem(out, path + '.cmp', 'error', 'cmp', 'cmp must be eq, ne, gt, gte, lt, or lte.');
        lintInt(t.value, path, out, 'value');
        if (t.op === 'flag' && idx && idx.flags[t.flg] && idx.flags[t.flg].range && intOr(t.value, null) !== null) {
          var rg = idx.flags[t.flg].range, v = intOr(t.value, 1), can = false;
          for (var x = rg[0]; x <= rg[1] && x - rg[0] < 4096; x++) if (compare(x, t.cmp, v)) { can = true; break; }
          if (!can) problem(out, path, 'warning', 'never', 'No value in ' + t.flg + '\'s range ' + rg[0] + ' to ' + rg[1] + ' passes this test.');
        }
        break;
      }
      case 'chapter':
        if (!refOk(idx, 'chp_', t.chp)) problem(out, path + '.chp', 'error', 'ref', 'chapter needs chp, a chapter of this Charter.');
        if (t.cmp !== undefined && !CMP[t.cmp]) problem(out, path + '.cmp', 'error', 'cmp', 'cmp must be eq, ne, gt, gte, lt, or lte.');
        break;
      case 'quest': {
        if (!refOk(idx, 'qst_', t.qst)) { problem(out, path + '.qst', 'error', 'ref', 'quest needs qst, a quest in this story.'); break; }
        if (!QUEST_IS[t.is]) { problem(out, path + '.is', 'error', 'is', 'is must be at, reached, failed, started, or done.'); break; }
        if ((t.is === 'at' || t.is === 'reached') && (!idx.quests[t.qst] || idx.quests[t.qst].stageAt[t.stage] === undefined)) problem(out, path + '.stage', 'error', 'ref', 'Stage ' + t.stage + ' is not a stage of ' + t.qst + '.');
        break;
      }
      default:
        problem(out, path + '.op', 'error', 'op', 'Unknown condition op ' + JSON.stringify(t.op) + '. Use ' + COND_OPS.join(', ') + '.');
    }
    return out;
  }
  // Everything a condition reads, as sorted unique lists: {flags, items, chapters, quests}.
  function condReads(t, acc, depth) {
    acc = acc || { flags: {}, items: {}, chapters: {}, quests: {} };
    if (isObj(t) && (depth || 0) <= MAX_DEPTH) {
      if (t.op === 'flag' && typeof t.flg === 'string') acc.flags[t.flg] = 1;
      if (t.op === 'item' && typeof t.itm === 'string') acc.items[t.itm] = 1;
      if (t.op === 'chapter' && typeof t.chp === 'string') acc.chapters[t.chp] = 1;
      if (t.op === 'quest' && typeof t.qst === 'string') acc.quests[t.qst] = 1;
      if (Array.isArray(t.of)) for (var i = 0; i < t.of.length; i++) condReads(t.of[i], acc, (depth || 0) + 1);
      else if (isObj(t.of)) condReads(t.of, acc, (depth || 0) + 1);
    }
    return acc;
  }
  function sortedReads(acc) { return { flags: keys(acc.flags), items: keys(acc.items), chapters: keys(acc.chapters), quests: keys(acc.quests) }; }
  S.cond = {
    OPS: COND_OPS, CMP: keys(CMP), QUEST_IS: keys(QUEST_IS),
    eval: function (tree, state, idx) { return evalCond(tree, state, idx); },
    lint: function (tree, idx, path) { return lintCond(tree, idx, path || 'cond', [], 0); },
    reads: function (tree) { return sortedReads(condReads(tree)); },
    compare: compare
  };

  // ---------------------------------------------------------------- commands (Phase 1)
  // A command list is an array of {op, ...} objects. The vocabulary is closed and nested, with no goto: control flow is
  // only if, choice, and a battle's win, lose, and escape lists, so every list a run can reach is a fixed path in the
  // tree. That is what makes static checking and Phase 7's reachability walk tractable.
  //   text        {speaker, por, lines [string]}            speaker: chr_, npc_, or a plain name; por: a por_
  //   choice      {prompt, options [{text, cond, cmds}], cancel}  options whose cond fails are hidden
  //   if          {cond, then [cmd], else [cmd]}
  //   setFlag     {flg, value}                              value defaults to 1; clamped to the flag's range
  //   addFlag     {flg, by}                                 by defaults to 1; clamped to the flag's range
  //   giveItem    {itm, qty}                                an itm_ or eqp_; qty defaults to 1; a stack holds 999
  //   takeItem    {itm, qty}                                takes what is there, never below 0
  //   gil         {by}                                      never below 0
  //   questStage  {qst, stage} | {qst, branch, outcome} | {qst, fail: true}
  //   party       {chr, act 'join' or 'leave'}
  //   startBattle {trp, win [cmd], lose [cmd], escape [cmd]}  no lose list means a loss is game over
  //   moveActor   {who 'player' or npc_, path [dir]}        dir: up, down, left, right
  //   face        {who, dir}
  //   wait        {frames}                                  1 to 600
  //   fade        {to 'out' or 'in', frames}
  //   music       {role} | {mus} | {stop: true}             role: a Day 147 role key such as 'battle' or 'field:<slug>'
  //   sfx         {sfx}
  //   changeMap   {map, at [x, y], dir}
  //   vehicle     {kind 'ship' or 'airship', act 'board' or 'leave'}
  //   callEvent   {evt}                                     runs evt's active page, then returns here
  //   ending      {end}                                     ends the game on that ending
  var CMD_OPS = ['addFlag', 'callEvent', 'changeMap', 'choice', 'ending', 'face', 'fade', 'gil', 'giveItem', 'if', 'moveActor', 'music', 'party', 'questStage', 'setFlag', 'sfx', 'startBattle', 'takeItem', 'text', 'vehicle', 'wait'];
  var DIRS = { down: 1, left: 1, right: 1, up: 1 };
  var MAX_NEST = 16;
  // The child lists a command holds, as [path segments, list] pairs, in a fixed order.
  function childLists(c) {
    var out = [];
    if (!isObj(c)) return out;
    if (c.op === 'if') { if (Array.isArray(c.then)) out.push([['then'], c.then]); if (Array.isArray(c['else'])) out.push([['else'], c['else']]); }
    if (c.op === 'choice' && Array.isArray(c.options)) for (var i = 0; i < c.options.length; i++) if (isObj(c.options[i]) && Array.isArray(c.options[i].cmds)) out.push([['options', i, 'cmds'], c.options[i].cmds]);
    if (c.op === 'startBattle') { var o = ['win', 'lose', 'escape']; for (var j = 0; j < o.length; j++) if (Array.isArray(c[o[j]])) out.push([[o[j]], c[o[j]]]); }
    return out;
  }
  // Visits every command in a list and its nested lists, depth first in order: fn(cmd, path [segments], pathText, depth).
  function walkCmds(list, fn, base, text, depth) {
    base = base || []; text = text || 'cmds'; depth = depth || 0;
    if (!Array.isArray(list) || depth > MAX_NEST) return;
    for (var i = 0; i < list.length; i++) {
      var p = base.concat([i]), pt = text + '[' + i + ']';
      fn(list[i], p, pt, depth);
      var kids = childLists(list[i]);
      for (var k = 0; k < kids.length; k++) {
        var seg = kids[k][0], st = pt;
        for (var s = 0; s < seg.length; s++) st += typeof seg[s] === 'number' ? '[' + seg[s] + ']' : '.' + seg[s];
        walkCmds(kids[k][1], fn, p.concat(seg), st, depth + 1);
      }
    }
  }
  function needRef(c, field, prefixes, idx, pt, out, optional) {
    var v = c[field];
    if (v === undefined || v === null || v === '') { if (!optional) problem(out, pt + '.' + field, 'error', 'missing', c.op + ' needs ' + field + '.'); return false; }
    for (var i = 0; i < prefixes.length; i++) if (refOk(idx, prefixes[i], v)) return true;
    problem(out, pt + '.' + field, 'error', 'ref', String(v) + ' does not resolve to ' + prefixes.join(' or ') + '.');
    return false;
  }
  function lintList(list, idx, path, out, depth, ctx) {
    if (!Array.isArray(list)) { problem(out, path, 'error', 'not-list', 'Commands must be a list.'); return; }
    if (depth > MAX_NEST) { problem(out, path, 'error', 'too-deep', 'Commands nest more than ' + MAX_NEST + ' levels.'); return; }
    for (var i = 0; i < list.length; i++) lintOne(list[i], idx, path + '[' + i + ']', out, depth, ctx);
  }
  function lintOne(c, idx, pt, out, depth, ctx) {
    if (!isObj(c)) { problem(out, pt, 'error', 'not-object', 'A command must be an object with an op.'); return; }
    noIdField(c, pt, out);
    switch (c.op) {
      case 'text':
        if (!Array.isArray(c.lines) || !c.lines.length || !c.lines.every(function (l) { return typeof l === 'string'; })) problem(out, pt + '.lines', 'error', 'missing', 'text needs lines, a list of strings.');
        if (typeof c.speaker === 'string' && /^(chr|npc)_/.test(c.speaker)) needRef(c, 'speaker', ['chr_', 'npc_'], idx, pt, out, true);
        else if (c.speaker !== undefined && c.speaker !== null && typeof c.speaker !== 'string') problem(out, pt + '.speaker', 'error', 'type', 'speaker is a chr_, an npc_, or a name.');
        needRef(c, 'por', ['por_'], idx, pt, out, true);
        break;
      case 'choice':
        if (!Array.isArray(c.options) || !c.options.length) { problem(out, pt + '.options', 'error', 'missing', 'choice needs at least one option.'); break; }
        if (c.options.length < 2) problem(out, pt + '.options', 'warning', 'one-option', 'A choice with one option is not a choice.');
        for (var o = 0; o < c.options.length; o++) {
          var op = c.options[o], opt = pt + '.options[' + o + ']';
          if (!isObj(op)) { problem(out, opt, 'error', 'not-object', 'An option is {text, cond, cmds}.'); continue; }
          noIdField(op, opt, out);
          if (typeof op.text !== 'string' || !op.text) problem(out, opt + '.text', 'error', 'missing', 'Every option needs text.');
          lintCond(op.cond, idx, opt + '.cond', out, 0);
          if (op.cmds !== undefined) lintList(op.cmds, idx, opt + '.cmds', out, depth + 1, ctx);
        }
        if (c.cancel !== undefined && (intOr(c.cancel, -1) < 0 || c.cancel >= c.options.length)) problem(out, pt + '.cancel', 'error', 'range', 'cancel is the index of one of the options.');
        break;
      case 'if':
        if (c.cond === undefined || c.cond === null) problem(out, pt + '.cond', 'warning', 'always', 'An if without a condition always takes then.');
        lintCond(c.cond, idx, pt + '.cond', out, 0);
        if (c.then !== undefined) lintList(c.then, idx, pt + '.then', out, depth + 1, ctx);
        if (c['else'] !== undefined) lintList(c['else'], idx, pt + '.else', out, depth + 1, ctx);
        if (!Array.isArray(c.then) && !Array.isArray(c['else'])) problem(out, pt, 'warning', 'empty', 'An if with no then and no else does nothing.');
        break;
      case 'setFlag': case 'addFlag':
        needRef(c, 'flg', ['flg_'], idx, pt, out);
        lintInt(c.op === 'setFlag' ? c.value : c.by, pt, out, c.op === 'setFlag' ? 'value' : 'by');
        break;
      case 'giveItem': case 'takeItem':
        needRef(c, 'itm', ['itm_', 'eqp_'], idx, pt, out);
        lintInt(c.qty, pt, out, 'qty');
        if (c.qty !== undefined && intOr(c.qty, 0) < 1) problem(out, pt + '.qty', 'error', 'range', 'qty is 1 or more.');
        break;
      case 'gil':
        if (intOr(c.by, null) === null) problem(out, pt + '.by', 'error', 'missing', 'gil needs by, a whole number (negative to take).');
        break;
      case 'questStage': {
        if (!needRef(c, 'qst', ['qst_'], idx, pt, out)) break;
        var q = idx.quests[c.qst], modes = (c.stage !== undefined ? 1 : 0) + (c.branch !== undefined ? 1 : 0) + (c.fail === true ? 1 : 0);
        if (modes !== 1) { problem(out, pt, 'error', 'mode', 'questStage takes exactly one of stage, branch with outcome, or fail: true.'); break; }
        if (c.stage !== undefined && q.stageAt[c.stage] === undefined) problem(out, pt + '.stage', 'error', 'ref', 'Stage ' + c.stage + ' is not a stage of ' + c.qst + '.');
        if (c.branch !== undefined) {
          var g = q.branches[c.branch];
          if (!g) problem(out, pt + '.branch', 'error', 'ref', 'Branch group ' + c.branch + ' is not in ' + c.qst + '.');
          else if (!g.outcomes[c.outcome]) problem(out, pt + '.outcome', 'error', 'ref', 'Outcome ' + c.outcome + ' is not in branch group ' + c.branch + '.');
        }
        break;
      }
      case 'party':
        needRef(c, 'chr', ['chr_'], idx, pt, out);
        if (c.act !== 'join' && c.act !== 'leave') problem(out, pt + '.act', 'error', 'enum', 'act is join or leave.');
        break;
      case 'startBattle':
        needRef(c, 'trp', ['trp_'], idx, pt, out);
        ['win', 'lose', 'escape'].forEach(function (k) { if (c[k] !== undefined) lintList(c[k], idx, pt + '.' + k, out, depth + 1, ctx); });
        break;
      case 'moveActor': case 'face':
        if (c.who !== 'player') needRef(c, 'who', ['npc_'], idx, pt, out);
        if (c.op === 'face' && !DIRS[c.dir]) problem(out, pt + '.dir', 'error', 'enum', 'dir is up, down, left, or right.');
        if (c.op === 'moveActor' && (!Array.isArray(c.path) || !c.path.length || !c.path.every(function (d) { return !!DIRS[d]; }))) problem(out, pt + '.path', 'error', 'missing', 'moveActor needs path, a list of up, down, left, and right.');
        break;
      case 'wait':
        if (intOr(c.frames, 0) < 1 || c.frames > 600) problem(out, pt + '.frames', 'error', 'range', 'wait needs frames, 1 to 600.');
        break;
      case 'fade':
        if (c.to !== 'out' && c.to !== 'in') problem(out, pt + '.to', 'error', 'enum', 'fade to is out or in.');
        if (c.frames !== undefined && (intOr(c.frames, 0) < 1 || c.frames > 600)) problem(out, pt + '.frames', 'error', 'range', 'frames is 1 to 600.');
        break;
      case 'music':
        if (c.stop === true) break;
        if (c.mus !== undefined) needRef(c, 'mus', ['mus_'], idx, pt, out);
        else if (typeof c.role !== 'string' || !c.role) problem(out, pt + '.role', 'error', 'missing', 'music needs a role key, a mus_, or stop: true.');
        else if (!idx || !idx.roles[c.role.replace(/^music:/, '')]) problem(out, pt + '.role', 'warning', 'unscored', 'No music is scored for role ' + c.role + ' in Day 147, so it plays silence.');
        break;
      case 'sfx':
        needRef(c, 'sfx', ['sfx_'], idx, pt, out);
        break;
      case 'changeMap':
        needRef(c, 'map', ['map_'], idx, pt, out);
        if (c.at !== undefined && !(Array.isArray(c.at) && c.at.length === 2 && intOr(c.at[0], -1) >= 0 && intOr(c.at[1], -1) >= 0)) problem(out, pt + '.at', 'error', 'type', 'at is a cell [x, y].');
        if (c.dir !== undefined && !DIRS[c.dir]) problem(out, pt + '.dir', 'error', 'enum', 'dir is up, down, left, or right.');
        break;
      case 'vehicle':
        if (c.kind !== 'ship' && c.kind !== 'airship') problem(out, pt + '.kind', 'error', 'enum', 'kind is ship or airship.');
        if (c.act !== 'board' && c.act !== 'leave') problem(out, pt + '.act', 'error', 'enum', 'act is board or leave.');
        break;
      case 'callEvent':
        needRef(c, 'evt', ['evt_'], idx, pt, out);
        if (ctx && ctx.evt && c.evt === ctx.evt) problem(out, pt + '.evt', 'error', 'recursion', 'An event cannot call itself.');
        break;
      case 'ending':
        needRef(c, 'end', ['end_'], idx, pt, out);
        break;
      default:
        problem(out, pt + '.op', 'error', 'op', 'Unknown command op ' + JSON.stringify(c.op) + '. Use ' + CMD_OPS.join(', ') + '.');
    }
  }
  // Everything a command list reads, sets, and names, for the Flags tab's cross reference and Phase 7:
  //   {reads {flags items chapters quests}, sets {flags}, quests {qst: [stage or branch.outcome or 'fail']}, items {give,
  //    take}, refs {prefix: [ids]}, events [called], endings, battles [trp]} with every list sorted and unique.
  function cmdRefs(list) {
    var rd = { flags: {}, items: {}, chapters: {}, quests: {} }, sets = {}, qs = {}, give = {}, take = {}, refs = {}, calls = {}, ends = {}, trps = {};
    function ref(v) { var p = prefixOf(v); if (p) { refs[p] = refs[p] || {}; refs[p][v] = 1; } }
    walkCmds(list, function (c) {
      if (!isObj(c)) return;
      if (c.op === 'if') condReads(c.cond, rd);
      if (c.op === 'choice' && Array.isArray(c.options)) for (var i = 0; i < c.options.length; i++) if (isObj(c.options[i])) condReads(c.options[i].cond, rd);
      if ((c.op === 'setFlag' || c.op === 'addFlag') && typeof c.flg === 'string') sets[c.flg] = 1;
      if (c.op === 'giveItem' && typeof c.itm === 'string') give[c.itm] = 1;
      if (c.op === 'takeItem' && typeof c.itm === 'string') take[c.itm] = 1;
      if (c.op === 'questStage' && typeof c.qst === 'string') { qs[c.qst] = qs[c.qst] || {}; qs[c.qst][c.fail === true ? 'fail' : c.branch !== undefined ? c.branch + '.' + c.outcome : String(c.stage)] = 1; }
      if (c.op === 'callEvent' && typeof c.evt === 'string') calls[c.evt] = 1;
      if (c.op === 'ending' && typeof c.end === 'string') ends[c.end] = 1;
      if (c.op === 'startBattle' && typeof c.trp === 'string') trps[c.trp] = 1;
      ['speaker', 'por', 'flg', 'itm', 'qst', 'chr', 'trp', 'who', 'mus', 'sfx', 'map', 'evt', 'end'].forEach(function (f) { ref(c[f]); });
    });
    each(rd.flags, function (v, k) { ref(k); }); each(rd.items, function (v, k) { ref(k); }); each(rd.chapters, function (v, k) { ref(k); }); each(rd.quests, function (v, k) { ref(k); });
    var r = {}; each(refs, function (m, p) { r[p] = keys(m); });
    var q = {}; each(qs, function (m, k) { q[k] = keys(m); });
    return { reads: sortedReads(rd), sets: { flags: keys(sets) }, quests: q, items: { give: keys(give), take: keys(take) }, refs: r, events: keys(calls), endings: keys(ends), battles: keys(trps) };
  }
  S.cmd = {
    OPS: CMD_OPS, DIRS: keys(DIRS),
    // lint(list, idx, path, ctx): ctx {evt} names the event the list belongs to, so a call to itself is caught.
    lint: function (list, idx, path, ctx) { var out = []; lintList(list, idx, path || 'cmds', out, 0, ctx || null); return out; },
    walk: function (list, fn) { walkCmds(list, fn); },
    refs: cmdRefs
  };

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

  // ---------------------------------------------------------------- pages (Phase 1)
  // An event is {trigger, map, at, npc, trp, pages [{cond, cmds, once}], priority}. Its active page is the highest
  // numbered page whose condition passes, RPG Maker's rightmost rule, so a later page overrides an earlier one once
  // the story moves on. A once page that has already run is skipped, so the page below it shows through.
  //   trigger: mapEnter (map), talk (npc), step (map and at), autorun (map), battleEnd (trp), chapterStart (no site)
  var TRIGGERS = { autorun: 'map', battleEnd: 'trp', chapterStart: '', mapEnter: 'map', step: 'map', talk: 'npc' };
  function seenKey(evt, page) { return evt + '#' + page; }
  function eventOf(evt, idx) { return isObj(evt) ? evt : idx && typeof evt === 'string' ? idx.events[evt] || null : null; }
  function pickPage(evt, state, idx, evtId) {
    var e = eventOf(evt, idx), id = typeof evt === 'string' ? evt : evtId;
    if (!e || !Array.isArray(e.pages)) return -1;
    for (var i = e.pages.length - 1; i >= 0; i--) {
      var p = e.pages[i];
      if (!isObj(p)) continue;
      if (p.once && id && state && state.seen && state.seen[seenKey(id, i)]) continue;
      if (evalCond(p.cond, state, idx)) return i;
    }
    return -1;
  }
  function lintEvent(rec, idx, path, evtId) {
    var out = [];
    path = path || 'event';
    if (!isObj(rec)) { problem(out, path, 'error', 'not-object', 'An event is an object.'); return out; }
    var need = TRIGGERS[rec.trigger];
    if (need === undefined) problem(out, path + '.trigger', 'error', 'enum', 'trigger is one of ' + keys(TRIGGERS).join(', ') + '.');
    else if (need === 'map') {
      if (!refOk(idx, 'map_', rec.map)) problem(out, path + '.map', 'error', rec.map ? 'ref' : 'missing', 'A ' + rec.trigger + ' event needs map, a map of the world.');
      if (rec.trigger === 'step' && !(Array.isArray(rec.at) && rec.at.length === 2 && intOr(rec.at[0], -1) >= 0 && intOr(rec.at[1], -1) >= 0)) problem(out, path + '.at', 'error', 'missing', 'A step event needs at, a cell [x, y].');
    } else if (need === 'npc' && !refOk(idx, 'npc_', rec.npc)) problem(out, path + '.npc', 'error', rec.npc ? 'ref' : 'missing', 'A talk event needs npc, a person in the world.');
    else if (need === 'trp' && rec.trp !== undefined && rec.trp !== null && !refOk(idx, 'trp_', rec.trp)) problem(out, path + '.trp', 'error', 'ref', String(rec.trp) + ' is not a troop.');
    if (rec.priority !== undefined) lintInt(rec.priority, path, out, 'priority');
    if (!Array.isArray(rec.pages) || !rec.pages.length) { problem(out, path + '.pages', 'error', 'missing', 'An event needs at least one page.'); return out; }
    for (var i = 0; i < rec.pages.length; i++) {
      var p = rec.pages[i], pp = path + '.pages[' + i + ']';
      if (!isObj(p)) { problem(out, pp, 'error', 'not-object', 'A page is {cond, cmds, once}.'); continue; }
      noIdField(p, pp, out);
      lintCond(p.cond, idx, pp + '.cond', out, 0);
      if (!Array.isArray(p.cmds)) problem(out, pp + '.cmds', 'error', 'missing', 'A page needs cmds, a list (it may be empty).');
      else lintList(p.cmds, idx, pp + '.cmds', out, 0, { evt: evtId || null });
      if (p.once !== undefined && typeof p.once !== 'boolean') problem(out, pp + '.once', 'error', 'type', 'once is true or false.');
      if (rec.trigger === 'autorun' && !p.once && Array.isArray(p.cmds)) {
        // An autorun page that never turns itself off runs forever. It is fine only when it sets something its own
        // condition reads (Phase 7's walk proves it actually stops).
        var rd = condReads(p.cond).flags, st = cmdRefs(p.cmds).sets.flags, stops = false;
        for (var r = 0; r < st.length; r++) if (rd[st[r]]) stops = true;
        if (!stops) problem(out, pp, 'warning', 'autorun-loop', 'This autorun page is not once and sets nothing its condition reads, so it would run again at once.');
      }
    }
    return out;
  }
  S.pages = {
    TRIGGERS: keys(TRIGGERS),
    // pick(evt record or id, state, idx, evtId): the active page index, or -1. Pass evtId with a record so once pages
    // can be recognized.
    pick: pickPage,
    seenKey: seenKey,
    lint: lintEvent
  };

  // ---------------------------------------------------------------- saves (Phase 1)
  // Day 146's save schema keeps story progress only as flags: [{flg, value}], whole numbers, beside party, inventory,
  // gil, location, and slotMeta.chapter. So everything a story state holds that is not a plain flag is packed into
  // flags too, under structural IDs the engine derives (Phase 2 scaffolds a flg_ record for each, so the save's flg
  // references resolve):
  //   one quest slot per quest, flg|quest|<qst>: (stage position + 1) in bits 0 to 7 (0 is not started), failed in bit 8,
  //     and the closed branch groups in bits 9 to 30, one bit per group in the quest's branch order;
  //   one once slot per event with once pages, flg|once|<evt>: one bit per page that has run (pages 0 to 30).
  // A save is never taken in the middle of a run (state.run is not saved). A flag at its default is left out.
  var QUEST_STAGE_MAX = 255, QUEST_GROUP_MAX = 22, ONCE_PAGE_MAX = 31;
  function questSlot(qst) { return structuralId('flg_', 'flg|quest|' + qst); }
  function onceSlot(evt) { return structuralId('flg_', 'flg|once|' + evt); }
  function hasOnce(e) { if (!isObj(e) || !Array.isArray(e.pages)) return false; for (var i = 0; i < e.pages.length; i++) if (isObj(e.pages[i]) && e.pages[i].once) return true; return false; }
  // Every derived slot the index needs, sorted by flag ID: [{flg, kind 'quest' or 'once', of}].
  function slots(idx) {
    var out = [];
    each(idx.quests, function (q, id) { out.push({ flg: questSlot(id), kind: 'quest', of: id }); });
    each(idx.events, function (e, id) { if (hasOnce(e)) out.push({ flg: onceSlot(id), kind: 'once', of: id }); });
    out.sort(function (a, b) { return a.flg < b.flg ? -1 : a.flg > b.flg ? 1 : 0; });
    return out;
  }
  // What cannot be packed: a quest with more than 255 stages or 22 branch groups, an event with once pages past 30.
  function limits(idx) {
    var out = [];
    each(idx.quests, function (q, id) {
      if (q.stages.length > QUEST_STAGE_MAX) problem(out, id + '.stages', 'error', 'save-limit', 'A quest can hold ' + QUEST_STAGE_MAX + ' stages in a save; ' + id + ' has ' + q.stages.length + '.');
      if (q.branchOrder.length > QUEST_GROUP_MAX) problem(out, id + '.branches', 'error', 'save-limit', 'A quest can hold ' + QUEST_GROUP_MAX + ' branch groups in a save; ' + id + ' has ' + q.branchOrder.length + '.');
    });
    each(idx.events, function (e, id) {
      for (var i = ONCE_PAGE_MAX; i < e.pages.length; i++) if (isObj(e.pages[i]) && e.pages[i].once) { problem(out, id + '.pages[' + i + ']', 'error', 'save-limit', 'Only pages 0 to ' + (ONCE_PAGE_MAX - 1) + ' can be once pages; ' + id + ' page ' + i + ' is one.'); break; }
    });
    return out;
  }
  function slotSet(idx) { var m = {}, s = slots(idx); for (var i = 0; i < s.length; i++) m[s[i].flg] = s[i]; return m; }
  function toFlags(state, idx) {
    var out = {}, derived = slotSet(idx);
    each(state.flags, function (v, flg) {
      if (derived[flg]) return;
      var d = idx.flags[flg] ? idx.flags[flg]['default'] : 0;
      if (intOr(v, d) !== d) out[flg] = intOr(v, d);
    });
    each(idx.quests, function (q, id) {
      var qs = state.quests && state.quests[id];
      if (!isObj(qs)) return;
      var at = qs.stage == null ? -1 : q.stageAt[qs.stage], v = 0;
      if (at !== undefined && at >= 0 && at < QUEST_STAGE_MAX) v = at + 1;
      if (qs.failed) v |= 256;
      for (var g = 0; g < q.branchOrder.length && g < QUEST_GROUP_MAX; g++) if (Array.isArray(qs.closed) && qs.closed.indexOf(q.branchOrder[g]) >= 0) v |= (1 << (9 + g));
      if (v) out[questSlot(id)] = v;
    });
    each(idx.events, function (e, id) {
      if (!hasOnce(e)) return;
      var v = 0;
      for (var p = 0; p < e.pages.length && p < ONCE_PAGE_MAX; p++) if (state.seen && state.seen[seenKey(id, p)]) v |= (1 << p);
      if (v) out[onceSlot(id)] = v;
    });
    var list = [];
    each(out, function (v, flg) { list.push({ flg: flg, value: v }); });
    return list;
  }
  function fromFlags(list, idx, rest) {
    var st = createState(idx, rest), vals = {}, derived = slotSet(idx);
    // A save names every flag away from its default, so start from the defaults, not from a new game's open gates.
    st.flags = {};
    each(idx.flags, function (f, id) { st.flags[id] = f['default']; });
    if (Array.isArray(list)) for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!isObj(e) || typeof e.flg !== 'string' || intOr(e.value, null) === null) continue;
      if (derived[e.flg]) vals[e.flg] = e.value; else writeFlag(st, idx, e.flg, e.value);
    }
    each(idx.quests, function (q, id) {
      var v = intOr(vals[questSlot(id)], 0), at = (v & 255) - 1, closed = [];
      for (var g = 0; g < q.branchOrder.length && g < QUEST_GROUP_MAX; g++) if (v & (1 << (9 + g))) closed.push(q.branchOrder[g]);
      closed.sort();
      st.quests[id] = { stage: at >= 0 && at < q.stages.length ? q.stages[at].key : null, failed: !!(v & 256), closed: closed };
    });
    each(idx.events, function (e, id) {
      var v = intOr(vals[onceSlot(id)], 0);
      for (var p = 0; p < ONCE_PAGE_MAX; p++) if (v & (1 << p)) st.seen[seenKey(id, p)] = 1;
    });
    st.chapter = chapterOf(st, idx);
    return copy(st);
  }
  // The story's share of a Day 146 save: {flags, gil, inventory [{item, qty}] sorted, party [chr], chapter}. Refused
  // with {error} while an event is running or after an ending.
  function toSave(state, idx) {
    if (state.run) return { error: 'An event is running; save between events.' };
    if (state.ending) return { error: 'The game has ended.' };
    var inv = [];
    each(state.items, function (q, itm) { if (intOr(q, 0) > 0) inv.push({ item: itm, qty: Math.min(999, q) }); });
    return { flags: toFlags(state, idx), gil: Math.max(0, intOr(state.gil, 0)), inventory: inv, party: copy(state.party || []), chapter: state.chapter };
  }
  function fromSave(save, idx) {
    save = isObj(save) ? save : {};
    var items = {}, party = [];
    if (Array.isArray(save.inventory)) for (var i = 0; i < save.inventory.length; i++) { var s = save.inventory[i]; if (isObj(s) && typeof s.item === 'string') items[s.item] = intOr(s.qty, 0); }
    if (Array.isArray(save.party)) for (var j = 0; j < save.party.length; j++) { var m = save.party[j], c = typeof m === 'string' ? m : isObj(m) ? m.chr : null; if (typeof c === 'string') party.push(c); }
    return fromFlags(save.flags, idx, { gil: save.gil, items: items, party: party });
  }
  S.save = { slots: slots, limits: limits, questSlot: questSlot, onceSlot: onceSlot, toFlags: toFlags, fromFlags: fromFlags, toSave: toSave, fromSave: fromSave, LIMITS: { stages: QUEST_STAGE_MAX, groups: QUEST_GROUP_MAX, oncePages: ONCE_PAGE_MAX } };

  // ---------------------------------------------------------------- later phases insert sections above this line
  function freeze(o) { Object.freeze(o); keys(o).forEach(function (k) { var v = o[k]; if (v && (typeof v === 'object' || typeof v === 'function') && !Object.isFrozen(v)) freeze(v); }); return o; }
  return freeze(S);
})();
// === ENGINE:STORY END ===
