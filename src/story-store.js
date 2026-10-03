// === STORY:STORE BEGIN ===
(function () {
  'use strict';
  // Story namespace storage, the record envelope, Codex types, the import gate, the open policy, storage keys, and the
  // size model. Everything here sits on top of the verbatim KIT:CORE fence and changes nothing inside it. Day 146 reserved
  // flg_ qst_ dlg_ evt_ end_ for forge 149 in namespace 'story', and Kit.index already walks bundle.story, so story
  // records live at bundle.story.records[prefix][id], the same keyed shape rules, art, and world use.
  var U = Kit.util;
  var STORY = window.STORY = {};
  STORY.VERSION = '1.0.0';
  STORY.FORGE = 149;
  STORY.GENERATOR = 'appaday-149-story';

  // ---------------------------------------------------------------- prefixes and Codex types
  STORY.PREFIXES = ['flg_', 'qst_', 'dlg_', 'evt_', 'end_'];
  STORY.TYPES = {
    'flg_': { name: 'StoryFlag', label: 'Flag' }, 'qst_': { name: 'StoryQuest', label: 'Quest' },
    'dlg_': { name: 'StoryDialogue', label: 'Dialogue' }, 'evt_': { name: 'StoryEvent', label: 'Event' },
    'end_': { name: 'StoryEnding', label: 'Ending' }
  };
  // Every story record carries a structural key (scaffolded records derive their ID from it; hand made records keep the
  // key they were given and their minted ID), a chapter where it belongs to one, and where it came from.
  var ENVELOPE_FIELDS = [
    { key: 'key', label: 'Structural key', type: 'text', max: 160, help: 'The key a scaffolded ID is derived from, such as flg|gate|vehicle:ship. Regenerating the scaffold never renames it.' },
    { key: 'chapter', label: 'Chapter', type: 'ref', refPrefix: 'chp_' },
    { key: 'origin', label: 'Origin', type: 'enum', values: ['generated', 'user'] },
    { key: 'tags', label: 'Tags', type: 'list', of: { type: 'text', max: 40 }, itemLabel: 'Tag' }
  ];
  STORY.PREFIXES.forEach(function (p) {
    var info = Kit.codex.PREFIXES[p];
    if (!info || info.ns !== 'story' || info.forge !== STORY.FORGE) throw new Error('KIT:CORE no longer reserves ' + p + ' for forge 149 in namespace story.');
    var t = STORY.TYPES[p];
    Kit.codex.register({ name: t.name, prefix: p, label: t.label, ns: 'story', forge: STORY.FORGE, group: 'story', dependsOn: [], fields: U.clone(ENVELOPE_FIELDS) });
  });

  // ---------------------------------------------------------------- the namespace
  STORY.DEFAULT_SETTINGS = {
    // Phase 6: the main story's summed chapter targetMinutes must reach this (an error, not Day 146's warning).
    floorMinutes: 720,
    // Phase 7: the reachability walk stops here and says so (a warning naming the cap, never a silent pass).
    walkCap: 50000,
    // Phase 4: the tier Kit.claude drafts dialogue lines with.
    draftTier: 'sonnet',
    // Phase 3: what the scaffold builds besides one main quest per chapter.
    scaffold: { sideQuests: true, bStories: true }
  };
  function skeleton() {
    return {
      version: STORY.VERSION,
      generator: { name: STORY.GENERATOR, version: (typeof ENGINE_STORY !== 'undefined' && ENGINE_STORY.version) || null },
      records: { 'flg_': {}, 'qst_': {}, 'dlg_': {}, 'evt_': {}, 'end_': {} },
      // Phase 2: every Day 148 gate key to one flg_ (and an optional display itm_), plus empty boss slot troops.
      bindings: {},
      // What the last scaffold run made, by structural key, so a rerun keeps user edits and drops what it no longer makes.
      scaffold: {},
      // Phase 4: npc_ -> [{cond, dlg}] pages, so one townsperson says different things by chapter without editing world.
      npcDialogue: {},
      settings: U.clone(STORY.DEFAULT_SETTINGS),
      overrides: {}
    };
  }
  // Fills a missing story namespace without ever overwriting what is there. Returns true when it changed the bundle.
  STORY.ensure = function (b) {
    b = b || Kit.bundle.current();
    if (!b) return false;
    var changed = false;
    if (!U.isObj(b.story)) { b.story = {}; changed = true; }
    var s = b.story, sk = skeleton();
    Object.keys(sk).forEach(function (k) { if (s[k] === undefined) { s[k] = sk[k]; changed = true; } });
    if (!U.isObj(s.records)) { s.records = {}; changed = true; }
    STORY.PREFIXES.forEach(function (p) { if (!U.isObj(s.records[p])) { s.records[p] = {}; changed = true; } });
    ['bindings', 'scaffold', 'npcDialogue', 'overrides'].forEach(function (k) { if (!U.isObj(s[k])) { s[k] = {}; changed = true; } });
    if (!U.isObj(s.settings)) { s.settings = {}; changed = true; }
    Object.keys(STORY.DEFAULT_SETTINGS).forEach(function (k) { if (s.settings[k] === undefined) { s.settings[k] = U.clone(STORY.DEFAULT_SETTINGS[k]); changed = true; } });
    return changed;
  };
  STORY.count = function (b) {
    b = b || Kit.bundle.current();
    var r = b && b.story && U.isObj(b.story.records) ? b.story.records : {};
    return STORY.PREFIXES.reduce(function (n, p) { return n + (U.isObj(r[p]) ? Object.keys(r[p]).length : 0); }, 0);
  };
  STORY.isEmpty = function (b) { return STORY.count(b) === 0; };

  // ---------------------------------------------------------------- records
  function store(b) { STORY.ensure(b); return b.story.records; }
  STORY.records = {
    list: function (prefix, b) {
      b = b || Kit.bundle.current();
      var m = store(b)[Kit.codex.normPrefix(prefix)];
      return U.isObj(m) ? Object.keys(m).sort().map(function (k) { return m[k]; }).filter(U.isObj) : [];
    },
    get: function (id, b) {
      b = b || Kit.bundle.current();
      var m = store(b)[Kit.ids.prefixOf(id)];
      return U.isObj(m) && U.isObj(m[id]) ? m[id] : null;
    },
    put: function (rec, b) {
      b = b || Kit.bundle.current();
      var p = Kit.ids.prefixOf(rec && rec.id);
      if (!p || STORY.PREFIXES.indexOf(p) < 0) throw new Error('STORY.records.put stores story records only (' + STORY.PREFIXES.join(' ') + ').');
      if (!Kit.ids.isValid(rec.id)) throw new Error('Invalid story ID ' + rec.id + '.');
      store(b)[p][rec.id] = rec;
      if (b === Kit.bundle.current() && !STORY.batching) Kit.index.invalidate();
      return rec;
    },
    del: function (id, b) {
      b = b || Kit.bundle.current();
      var p = Kit.ids.prefixOf(id), r = store(b);
      if (!r[p] || !r[p][id]) return false;
      delete r[p][id];
      if (b === Kit.bundle.current()) Kit.index.invalidate();
      return true;
    }
  };
  // The envelope of a scaffolded record. The ID comes from the structural key through ENGINE_STORY (the way Day 148
  // derives world IDs), never from Kit.ids.mint and never from Claude. DECISION (Day 148's, kept): nothing inside a story
  // record, a condition tree, or a command list uses a field named id (use flg, qst, dlg, evt, end, npc, map, trp, itm,
  // chr), because Kit.index files any object with an id field as a record.
  STORY.envelope = function (prefix, key, name, body) {
    var p = Kit.codex.normPrefix(prefix);
    if (STORY.PREFIXES.indexOf(p) < 0) throw new Error('Not a story prefix: ' + prefix);
    var rec = { id: ENGINE_STORY.ids.structural(p, key), name: String(name || key), key: String(key), origin: 'generated', notes: '', tags: [] };
    if (U.isObj(body)) Object.keys(body).forEach(function (k) { if (k !== 'id' && k !== 'key') rec[k] = body[k]; });
    return rec;
  };
  // A record an author makes by hand: a minted ID (random suffix, unique in the bundle) and origin 'user', which every
  // scaffold rerun keeps as it is.
  STORY.authored = function (prefix, name, body) {
    var p = Kit.codex.normPrefix(prefix);
    if (STORY.PREFIXES.indexOf(p) < 0) throw new Error('Not a story prefix: ' + prefix);
    var id = Kit.ids.mint(p, name || p);
    var rec = { id: id, name: String(name || id), key: 'user|' + id, origin: 'user', notes: '', tags: [] };
    if (U.isObj(body)) Object.keys(body).forEach(function (k) { if (k !== 'id' && k !== 'key') rec[k] = body[k]; });
    return rec;
  };

  // ---------------------------------------------------------------- what this forge reads
  STORY.chapters = function (b) {
    b = b || Kit.bundle.current();
    var S = b && b.charter && b.charter.sections;
    return S && Array.isArray(S.chapters) ? S.chapters.filter(U.isObj) : [];
  };
  // Charter endings are a plain list of {name, concept} with no IDs; Phase 6 gives each one an end_ by index and name.
  STORY.endings = function (b) {
    b = b || Kit.bundle.current();
    var e = b && b.charter && b.charter.sections && b.charter.sections.endings;
    var list = U.isObj(e) && Array.isArray(e.endings) ? e.endings : Array.isArray(e) ? e : [];
    return list.filter(U.isObj);
  };
  STORY.minutes = function (b) {
    return STORY.chapters(b).reduce(function (n, c) { return n + (typeof c.targetMinutes === 'number' && c.targetMinutes > 0 ? c.targetMinutes : 0); }, 0);
  };
  function nsList(b, ns, prefix) {
    var m = b && b[ns] && (ns === 'rules' ? b.rules[prefix] : U.isObj(b[ns].records) ? b[ns].records[prefix] : null);
    return U.isObj(m) ? Object.keys(m).sort().map(function (k) { return m[k]; }).filter(U.isObj) : [];
  }
  STORY.rules = function (prefix, b) { return nsList(b || Kit.bundle.current(), 'rules', prefix); };
  // World records by prefix, the progression graph, and the gate keys it leaves to this forge. Read only: this forge
  // never writes a world record.
  STORY.world = {
    list: function (prefix, b) { return nsList(b || Kit.bundle.current(), 'world', prefix); },
    get: function (id, b) { b = b || Kit.bundle.current(); var m = b && b.world && b.world.records && b.world.records[Kit.ids.prefixOf(id)]; return U.isObj(m) && U.isObj(m[id]) ? m[id] : null; },
    graph: function (b) { b = b || Kit.bundle.current(); var g = b && b.world && b.world.progression; return U.isObj(g) && Array.isArray(g.nodes) && g.nodes.length ? g : null; },
    gateKeys: function (b) { return ENGINE_STORY.gates.keys(STORY.world.graph(b)); },
    overworld: function (b) { return STORY.world.list('map_', b).filter(function (m) { return m.kind === 'overworld'; })[0] || null; },
    // Boss dungeons whose troop slot is empty (a chapter with no isBoss troop); Day 149 fills them from the story side.
    emptyBossSlots: function (b) { return STORY.world.list('dgn_', b).filter(function (d) { return d.role === 'boss' && !d.troop; }); }
  };

  // ---------------------------------------------------------------- the engine's view of a bundle (Phase 1)
  // ENGINE_STORY never reads a bundle; it reads an index built from the story namespace and the IDs it may name. This is
  // the one place the page gathers them, so every tab, the playtester, and the walk read the same index Day 150 builds.
  // Memoized per bundle on KIT:CORE's index identity (a new identity after any change), so it is rebuilt only when the
  // bundle moves.
  STORY.engineExt = function (b) {
    b = b || Kit.bundle.current();
    var ids = {};
    function add(prefix, list) { ids[prefix] = (ids[prefix] || []).concat(list.map(function (r) { return r.id; })).sort(); }
    ['npc_', 'map_'].forEach(function (p) { add(p, STORY.world.list(p, b)); });
    ['trp_', 'itm_', 'eqp_', 'chr_'].forEach(function (p) { add(p, STORY.rules(p, b)); });
    ['mus_', 'sfx_', 'por_'].forEach(function (p) { add(p, nsList(b, 'art', p)); });
    var chapters = STORY.chapters(b).map(function (c) { return c.id; }).filter(function (x) { return typeof x === 'string'; });
    ids.chp_ = chapters.slice().sort();
    var roles = nsList(b, 'art', 'mus_').filter(function (m) { return m.subject && m.subject.kind === 'role' && typeof m.subject.ref === 'string'; })
      .map(function (m) { return m.subject.ref.replace(/^music:/, ''); }).sort();
    var g = STORY.world.graph(b);
    return { chapters: chapters, start: g && Array.isArray(g.start) ? g.start.slice() : [], ids: ids, roles: roles };
  };
  var engIdx = { key: null, idx: null };
  STORY.engineIndex = function (b) {
    b = b || Kit.bundle.current();
    STORY.ensure(b);
    var key = b === Kit.bundle.current() ? Kit.index(b) : null;
    if (key && engIdx.key === key) return engIdx.idx;
    var idx = ENGINE_STORY.index.build({ records: b.story.records, bindings: b.story.bindings }, STORY.engineExt(b));
    if (key) { engIdx.key = key; engIdx.idx = idx; }
    return idx;
  };

  // ---------------------------------------------------------------- the world check behind the import gate
  // Day 148 refuses its own Final until every check passes, so a Final stamp says the world was clean when it was
  // exported. A bundle can still be edited afterward (a Day 146 re-export restamps the hash), and Day 148's page checks
  // are not in this page, so this forge re-proves what a story stands on, with the vendored ENGINE_WORLD:
  //   the world was made by the generator version this page carries;
  //   KIT:CORE validation outside the story namespace has no errors and no broken references;
  //   every world record is filed under its prefix and a generated one's structural key still derives its ID;
  //   the progression graph exists, ENGINE_WORLD.progression.check finds nothing, and every site and region it names
  //   is a record;
  //   the overworld map_ exists, and every side quest giver resolves to an npc_.
  // Returns a list of problems [{code, message}]; empty means clean. Memoized per bundle on KIT:CORE's index identity.
  var wcCache = { b: null, idx: null, out: null };
  STORY.worldCheck = function (b) {
    b = b || Kit.bundle.current();
    if (!b) return [{ code: 'none', message: 'No bundle is open.' }];
    var idx = b === Kit.bundle.current() ? Kit.index(b) : null;
    if (idx && wcCache.b === b && wcCache.idx === idx) return wcCache.out;
    var out = [], w = b.world;
    function add(code, message) { out.push({ code: code, message: message }); }
    if (!U.isObj(w) || !U.isObj(w.records)) { add('no-world', 'The bundle has no world namespace.'); return remember(); }
    var gv = w.generator && w.generator.version;
    if (gv !== ENGINE_WORLD.version) add('generator', 'The world was made by World Forge engine ' + (gv || 'unknown') + ', and this forge carries engine ' + ENGINE_WORLD.version + '.');
    var res = Kit.validate(b);
    var bad = res.errors.concat(res.broken).filter(function (x) {
      return x.recordId !== 'story' && STORY.PREFIXES.indexOf(Kit.ids.prefixOf(x.recordId)) < 0;
    });
    bad.slice(0, 3).forEach(function (x) { add('validation', (x.level === 'broken' ? 'Broken reference' : 'Error') + ' on ' + x.recordId + (x.fieldPath ? ' (' + x.fieldPath + ')' : '') + ': ' + x.message); });
    if (bad.length > 3) add('validation', (bad.length - 3) + ' more errors or broken references outside the story.');
    var WP = ['map_', 'reg_', 'npc_', 'twn_', 'dgn_'];
    Object.keys(w.records).sort().forEach(function (p) {
      if (WP.indexOf(p) < 0) { add('records', 'Unknown world prefix ' + p + '.'); return; }
      Object.keys(w.records[p] || {}).sort().forEach(function (id) {
        var r = w.records[p][id];
        if (!U.isObj(r) || r.id !== id || Kit.ids.prefixOf(id) !== p) add('records', 'World record ' + id + ' is not filed under its own ID and prefix.');
        else if (typeof r.key === 'string' && r.origin !== 'user' && ENGINE_WORLD.ids.structural(p, r.key) !== id) add('records', 'World record ' + id + ' no longer matches the ID its structural key derives.');
      });
    });
    var g = STORY.world.graph(b);
    if (!g) add('progression', 'The world has no progression graph.');
    else {
      var probs = [];
      try { probs = ENGINE_WORLD.progression.check(g); } catch (e) { probs = [{ message: 'The progression graph could not be read: ' + e.message }]; }
      probs.slice(0, 3).forEach(function (p) { add('progression', p.message); });
      g.nodes.forEach(function (n) { if (n.kind !== 'gate' && (!n.record || !STORY.world.get(n.record, b))) add('progression', 'Site ' + n.key + ' has no world record.'); });
      (g.regions || []).forEach(function (r) { if (!r.record || !STORY.world.get(r.record, b)) add('progression', 'Region ' + r.key + ' has no world record.'); });
    }
    if (!STORY.world.overworld(b)) add('overworld', 'The world has no overworld map.');
    STORY.rules('sdq_', b).forEach(function (q) {
      if (!q.giver) add('giver', 'Side quest ' + (q.name || q.id) + ' has no giver.');
      else if (Kit.ids.prefixOf(q.giver) !== 'npc_' || !STORY.world.get(q.giver, b)) add('giver', 'Side quest ' + (q.name || q.id) + ' names giver ' + q.giver + ', which is not a person in the world.');
    });
    return remember();
    function remember() { if (idx) wcCache = { b: b, idx: idx, out: out }; return out; }
  };

  // ---------------------------------------------------------------- the import gate
  // Story Forge stands on a finished world, so it refuses, with a reason a person can act on: anything that is not a
  // bundle, a bundle without a Day 148 Final, one whose world namespace is not opened, and one whose world does not
  // validate cleanly. Returns true or the reason.
  STORY.importable = function (b) {
    if (!U.isObj(b) || !U.isObj(b.kit) || b.kit.format !== 'saga-bundle') return 'This file is not a Saga Forge bundle.';
    var f = U.isObj(b.kit.forges) ? b.kit.forges['148'] : null;
    if (!U.isObj(f) || f.status !== 'final') return 'This bundle has no Day 148 Final export. Open it in World Forge (Day 148), generate the world, and export a Final; Story Forge writes its story onto a finished world.';
    if (!Array.isArray(b.kit.opened) || b.kit.opened.indexOf('world') < 0) return 'This bundle\'s world namespace is not opened. Export a Final from World Forge (Day 148), which opens it once every world check passes.';
    var probs = STORY.worldCheck(b);
    if (probs.length) return 'This bundle\'s world does not validate cleanly: ' + probs[0].message + (probs.length > 1 ? ' (and ' + (probs.length - 1) + ' more)' : '') + ' Fix it in World Forge (Day 148) and export a Final again.';
    return true;
  };
  STORY.readiness = function (b) { b = b || Kit.bundle.current(); return STORY.importable(b); };
  var rawImport = Kit.bundle.importText;
  Kit.bundle.importText = function (text) {
    var b;
    try { b = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
    var probe = U.clone(b);
    Kit.bundle.migrate(probe);
    var ok = STORY.importable(probe);
    if (ok !== true) throw new Error(ok);
    return rawImport.call(Kit.bundle, text);
  };

  // ---------------------------------------------------------------- the forward fields and the open policy
  // Day 146 owes this forge two fields: sdq_.flag (the completion flag of each side quest, a flg_) and the save schema's
  // flags list ({flg, value}), which lives in the schema, not in a record, so there is nothing to fill. Filling
  // sdq_.flag (Phase 2) is the only write this forge makes outside story, mirroring Day 148 writing only sdq_.giver.
  // Day 146 reads a story ID as FORWARD while story is absent from kit.opened and as BROKEN once it is opened and the
  // record is missing, so story opens only on a Final export, after every check.
  STORY.FORWARD_FIELDS = [{ prefix: 'sdq_', field: 'flag', target: 'flg_' }];
  STORY.forwardRefs = function (b) {
    b = b || Kit.bundle.current();
    var out = [];
    STORY.FORWARD_FIELDS.forEach(function (f) {
      STORY.rules(f.prefix, b).forEach(function (r) {
        var v = r[f.field];
        if (!v) return;
        out.push({ recordId: r.id, field: f.field, id: v, ok: !!STORY.records.get(v, b) && Kit.ids.prefixOf(v) === f.target });
      });
    });
    return out;
  };
  STORY.canOpen = function (b) { return STORY.forwardRefs(b).every(function (r) { return r.ok; }); };

  // ---------------------------------------------------------------- size meter model
  STORY.LIMIT = 4.5e6;
  STORY.AMBER = 1.5e6;
  STORY.size = function (b) {
    b = b || Kit.bundle.current();
    if (!b) return { total: 0, ns: {}, level: 'ok', room: STORY.LIMIT };
    var ns = {};
    Object.keys(b).forEach(function (k) { ns[k] = JSON.stringify(b[k] === undefined ? null : b[k]).length; });
    var total = JSON.stringify(b).length, draft = 0, where = STORY.storage.where('kit:draft');
    try { draft = (localStorage.getItem('story149:draft') || '').length; } catch (e) {}
    var other = where === 'idb' ? 0 : Math.max(0, Kit.store.usage() - draft);
    var room = Math.max(0, STORY.LIMIT - other);
    var level = total >= room * 0.9 ? 'red' : total >= STORY.AMBER ? 'amber' : 'ok';
    return { total: total, ns: ns, other: other, room: room, level: level, where: where };
  };

  // ---------------------------------------------------------------- storage
  // Every AppADay app shares one origin and one localStorage quota, and Days 146 to 148 use the same KIT:CORE keys. This
  // forge keeps its draft, slots, suspend record, and UI state under its own story149: keys (Day 147's pattern, kept by
  // Day 148), so another forge's tab never overwrites a Day 149 draft. kit:settings, which holds the API key, stays
  // shared on purpose. A story draft carries a whole Day 148 world (about 0.5 to 0.8 MB), so a refused localStorage write
  // moves the value to IndexedDB (database appaday-149) with a tiny marker and an in-memory mirror that keeps
  // Kit.store.get synchronous. APP:BOOT awaits STORY.storage.ready() first.
  var KEYMAP = { 'kit:draft': 'story149:draft', 'kit:slots': 'story149:slots', 'kit:suspend': 'story149:suspend', 'kit:ui': 'story149:ui' };
  var WHERE = 'story149:where:', IDB_NAME = 'appaday-149', IDB_STORE = 'kv';
  var raw = { get: Kit.store.get, set: Kit.store.set, del: Kit.store.del };
  var mem = {}, idbKeys = {}, dbp = null;
  function hasIdb() { try { return typeof indexedDB !== 'undefined' && !!indexedDB; } catch (e) { return false; } }
  function openDb(name) {
    return new Promise(function (resolve, reject) {
      var rq = indexedDB.open(name, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(IDB_STORE); };
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
  }
  function db() {
    if (dbp) return dbp;
    dbp = openDb(IDB_NAME);
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function idbOn(dbPromise, mode, fn) {
    return dbPromise.then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(IDB_STORE, mode), st = tx.objectStore(IDB_STORE), out;
        var rq = fn(st);
        if (rq) rq.onsuccess = function () { out = rq.result; };
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = tx.onabort = function () { reject(tx.error); };
      });
    });
  }
  function idb(mode, fn) { return idbOn(db(), mode, fn); }
  function lsSet(k, s) { try { localStorage.setItem(k, s); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  STORY.storage = {
    KEYMAP: KEYMAP,
    where: function (key) { var k = KEYMAP[key] || key; if (idbKeys[k]) return 'idb'; return lsGet(k) != null ? 'local' : 'none'; },
    hasIdb: hasIdb,
    ready: function () {
      var ks = [];
      try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(WHERE) === 0) ks.push(k.slice(WHERE.length)); } } catch (e) {}
      if (!ks.length) return Promise.resolve();
      if (!hasIdb()) { ks.forEach(function (k) { lsDel(WHERE + k); }); return Promise.resolve(); }
      return Promise.all(ks.map(function (k) {
        return idb('readonly', function (st) { return st.get(k); }).then(function (v) {
          if (typeof v === 'string') { mem[k] = v; idbKeys[k] = 1; } else lsDel(WHERE + k);
        }, function () {});
      })).then(function () {});
    },
    // The draft Day 148 left in this browser, if any (read only; this forge never writes Day 148's keys). Day 148 keeps
    // it under world148:draft, or in its own IndexedDB database when localStorage was full. Resolves to a bundle or null.
    day148Draft: function () {
      var s = lsGet('world148:draft');
      if (s) { try { return Promise.resolve(JSON.parse(s)); } catch (e) { return Promise.resolve(null); } }
      if (lsGet('world148:where:world148:draft') == null || !hasIdb()) return Promise.resolve(null);
      return idbOn(openDb('appaday-148'), 'readonly', function (st) { return st.get('world148:draft'); }).then(function (v) {
        try { return typeof v === 'string' ? JSON.parse(v) : null; } catch (e) { return null; }
      }, function () { return null; });
    },
    hasDay148Draft: function () { return lsGet('world148:draft') != null || lsGet('world148:where:world148:draft') != null; }
  };
  Kit.store.get = function (key, fallback) {
    var k = KEYMAP[key];
    if (!k) return raw.get.apply(Kit.store, arguments);
    if (idbKeys[k]) { try { return JSON.parse(mem[k]); } catch (e) { return fallback; } }
    return raw.get.call(Kit.store, k, fallback);
  };
  Kit.store.del = function (key) {
    var k = KEYMAP[key];
    if (!k) return raw.del.apply(Kit.store, arguments);
    if (idbKeys[k]) { delete idbKeys[k]; delete mem[k]; lsDel(WHERE + k); idb('readwrite', function (st) { return st.delete(k); }).catch(function () {}); }
    return raw.del.call(Kit.store, k);
  };
  Kit.store.set = function (key, value) {
    var k = KEYMAP[key];
    if (!k) return raw.set.apply(Kit.store, arguments);
    var s;
    try { s = JSON.stringify(value); } catch (e) { return false; }
    if (lsSet(k, s)) {
      if (idbKeys[k]) { delete idbKeys[k]; delete mem[k]; lsDel(WHERE + k); idb('readwrite', function (st) { return st.delete(k); }).catch(function () {}); }
      if (key === 'kit:draft') STORY.storageFailed(false);
      return true;
    }
    lsDel(k);
    if (!hasIdb() || !lsSet(WHERE + k, '1')) {
      if (key === 'kit:draft') STORY.storageFailed(true);
      if (Kit.ui && Kit.ui.toast) Kit.ui.toast('Could not save to browser storage. Export your bundle now to keep your work.', 'error', 8000);
      return false;
    }
    var first = !idbKeys[k];
    mem[k] = s; idbKeys[k] = 1;
    idb('readwrite', function (st) { return st.put(s, k); }).then(function () {
      if (key === 'kit:draft') STORY.storageFailed(false);
      if (first && Kit.ui && Kit.ui.toast && key === 'kit:draft') Kit.ui.toast('This draft is now saved in IndexedDB, the browser\'s larger store, because localStorage is full.', 'warn', 7000);
    }, function () {
      delete idbKeys[k]; delete mem[k]; lsDel(WHERE + k);
      if (key === 'kit:draft') STORY.storageFailed(true);
    });
    return true;
  };
  STORY.storageFailed = function (failed) {
    var el = typeof document !== 'undefined' && document.getElementById('storeBanner');
    if (el) el.hidden = !failed;
  };

  // ---------------------------------------------------------------- validation
  Kit.validate.register('story.envelope', function (b, ctx) {
    var s = b.story, r = s && U.isObj(s.records) ? s.records : {};
    Object.keys(r).sort().forEach(function (p) {
      if (STORY.PREFIXES.indexOf(p) < 0) { ctx.add({ recordId: 'story', fieldPath: 'records.' + p, message: 'Unknown story prefix ' + p + '. Records here are invisible to every forge.', level: 'error' }); return; }
      Object.keys(r[p] || {}).sort().forEach(function (id) {
        var rec = r[p][id];
        if (!U.isObj(rec) || rec.id !== id) ctx.add({ recordId: id, fieldPath: 'id', message: 'Story record key and id do not match.', level: 'error' });
        else if (Kit.ids.prefixOf(id) !== p) ctx.add({ recordId: id, fieldPath: 'id', message: 'Story record ' + id + ' is filed under ' + p + '.', level: 'error' });
        else if (typeof rec.key === 'string' && rec.origin !== 'user' && ENGINE_STORY.ids.structural(p, rec.key) !== id) ctx.add({ recordId: id, fieldPath: 'key', message: 'Story record ' + id + ' does not match the ID its structural key derives.', level: 'warning' });
      });
    });
  });
  Kit.jump.register({ test: function (rid) { return rid === 'story'; }, name: function () { return 'Story namespace'; }, go: function (rid, fieldPath) { return STORY.jumpStory ? STORY.jumpStory(fieldPath) : Kit.go('start'); } });

  // Keep every loaded bundle shaped for this forge (an empty story gets its skeleton; nothing else is touched).
  Kit.on('load', function (b) { if (STORY.ensure(b)) Kit.bundle.touch('story-ensure'); });
})();
// === STORY:STORE END ===
