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

  // ---------------------------------------------------------------- later phases insert sections above this line
  function freeze(o) { Object.freeze(o); keys(o).forEach(function (k) { var v = o[k]; if (v && (typeof v === 'object' || typeof v === 'function') && !Object.isFrozen(v)) freeze(v); }); return o; }
  return freeze(S);
})();
// === ENGINE:STORY END ===
