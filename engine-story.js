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
  // Bound once here: inside a vm context (how jsdom, Node tests, and a headless Day 150 load this file) every lookup of a
  // global such as Math goes through the context's global object, which is slow enough in a hashing loop to matter.
  var imul = Math.imul, isArray = Array.isArray, stringify = JSON.stringify;

  // ---------------------------------------------------------------- util
  function keys(o) { return o && typeof o === 'object' ? Object.keys(o).sort() : []; }
  function each(o, fn) { var k = keys(o); for (var i = 0; i < k.length; i++) fn(o[k[i]], k[i], i); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function isObj(v) { return !!v && typeof v === 'object' && !isArray(v); }
  // A deep copy of plain JSON data (objects, arrays, strings, numbers, booleans, null). Keys come out sorted, so two
  // copies of the same data are identical byte for byte however their keys were first written.
  function copy(v) {
    if (isArray(v)) { var a = new Array(v.length); for (var i = 0; i < v.length; i++) a[i] = copy(v[i]); return a; }
    if (isObj(v)) { var o = {}; each(v, function (x, k) { if (x !== undefined) o[k] = copy(x); }); return o; }
    return v;
  }
  // Canonical JSON: sorted keys, undefined dropped. Two equal states give the same text; the walk hashes it.
  function canon(v) {
    if (isArray(v)) { var p = []; for (var i = 0; i < v.length; i++) p.push(canon(v[i])); return '[' + p.join(',') + ']'; }
    if (isObj(v)) { var q = []; each(v, function (x, k) { if (x !== undefined) q.push(stringify(k) + ':' + canon(x)); }); return '{' + q.join(',') + '}'; }
    return stringify(v === undefined ? null : v);
  }
  // FNV-1a over a string or a list of strings and numbers, for comparing records and states cheaply.
  function digest(a) {
    a = typeof a === 'string' ? [a] : a || [];
    var h = 0x811c9dc5;
    for (var i = 0; i < a.length; i++) {
      var s = String(a[i]);
      for (var j = 0; j < s.length; j++) { h ^= s.charCodeAt(j); h = imul(h, 0x01000193); }
      h ^= 44; h = imul(h, 0x01000193);
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8) + ':' + a.length;
  }
  S.util = { keys: keys, each: each, clamp: clamp, isObj: isObj, copy: copy, canon: canon, digest: digest };

  // ---------------------------------------------------------------- hashing
  // xmur3, the same string hash ENGINE_WORLD uses, so story IDs are built exactly the way world IDs are.
  function xmur3(str) {
    str = String(str);
    for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++) { h = imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return function () { h = imul(h ^ (h >>> 16), 2246822507); h = imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
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
  //     story: {records {flg_ qst_ dlg_ evt_ end_}, bindings {gateKey: {flg, itm}}, npcDialogue {npc_: [{cond, dlg}]}}
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
    var I = { flags: {}, quests: {}, dialogues: {}, npcDialogue: {}, events: {}, endings: {}, known: {}, roles: {}, chapters: [], chapterAt: {}, chapterFlags: {}, gates: {}, start: [] };
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
    // Phase 4: story.npcDialogue maps a person to pages [{cond, dlg}]; the highest passing page decides what they say.
    each(story.npcDialogue, function (list, npc) { if (Array.isArray(list)) I.npcDialogue[npc] = copy(list); });
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
    // npcDialogue joins the digest only when a person has pages, so a story without any keeps the digest it always had.
    var dig = { records: recs, bindings: story.bindings || {} };
    if (keys(I.npcDialogue).length) dig.npcDialogue = I.npcDialogue;
    I.digest = digest(canon({ story: dig, ext: ext }));
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

  // ---------------------------------------------------------------- later phases insert sections above this line
  function freeze(o) { Object.freeze(o); keys(o).forEach(function (k) { var v = o[k]; if (v && (typeof v === 'object' || typeof v === 'function') && !Object.isFrozen(v)) freeze(v); }); return o; }
  return freeze(S);
})();
// === ENGINE:STORY END ===
