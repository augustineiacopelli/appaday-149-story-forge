// === STORY:DIALOGUE BEGIN ===
(function () {
  'use strict';
  // Phase 4: dialogue graphs. A dlg_ record is the shape ENGINE_STORY.dlg reads (src/engine-dlg.js):
  //   kind role | quest | custom, role (a Day 148 npc role), qst (a quest), chapter, speaker (chr_, npc_, or a name), por (por_)
  //   start (a node key)   nodes {key: {speaker, por, prompt, lines [string], cmds [cmd], next | choices [{text, cond, cmds, next}]}}
  // story.npcDialogue maps each npc_ to pages [{cond, dlg, node, key, origin}]: the highest page whose condition passes wins, so
  // the same townsperson says different things by chapter without a world record changing. node (optional) is where in the
  // dialogue the page opens, which lets one quest dialogue serve every stage of the quest.
  // The scaffold builds, from the world and the quests that exist, with structural IDs (so a rerun renames nothing):
  //   one dialogue per (role, chapter) the world's people need, a default greeting keyed by role and chapter, shared by every
  //     person of that role; each person's pages run from their own chapter onward, a later chapter overriding an earlier one
  //   one dialogue per quest that has a giver: offer, progress, and turn in tied to the quest's stages, and a page for each
  //     stage on the giver
  // It never edits a world record, never overwrites a dialogue that exists, keeps an author's pages (origin user) in place
  // and after the generated ones (the rightmost page wins), and drops a generated dialogue only when nothing asks for it.
  var U = Kit.util, ES = ENGINE_STORY, F = STORY.flags, Q = STORY.quests;
  function cur() { return Kit.bundle.current(); }
  var D = STORY.dialogue = {};
  D.KINDS = ['role', 'quest', 'custom'];
  D.KIND_LABEL = { role: 'Greeting', quest: 'Quest', custom: 'Yours' };
  D.KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
  D.MAX_NODES = ES.dlg.MAX_NODES;
  D.LONG_LINE = ES.dlg.LONG_LINE;
  D.ROLE_LABEL = { innkeeper: 'Innkeeper', 'shop:item': 'Item shop', 'shop:weapon': 'Weapon shop', 'shop:armor': 'Armor shop', priest: 'Priest', guard: 'Guard', resident: 'Resident' };
  function trim(s) { return String(s === undefined || s === null ? '' : s).trim(); }
  function cut(s, n) { s = trim(s); if (s.length <= n) return s; return s.slice(0, n - 3).replace(/\s+\S*$/, '') + '...'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function sortedObj(o) { var r = {}; Object.keys(o || {}).sort().forEach(function (k) { r[k] = o[k]; }); return r; }
  function nameOf(id, fb) { return STORY.nameOf ? STORY.nameOf(id, fb) : (fb || id || ''); }
  function chapterName(id, b) { var c = STORY.chapters(b).filter(function (x) { return x.id === id; })[0]; return c ? (c.name || id) : id; }
  function canon(v) { return U.canonical(v); }
  D.roleLabel = function (role) {
    if (D.ROLE_LABEL[role]) return D.ROLE_LABEL[role];
    var t = String(role || 'person').replace(/[:_]+/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  // ---------------------------------------------------------------- the Codex type
  var DIALOGUE_FIELDS = [
    { key: 'kind', label: 'Kind', type: 'enum', values: D.KINDS, help: 'role: a greeting shared by every person of one role in one chapter. quest: what a quest giver says as the quest moves. custom: yours.' },
    { key: 'role', label: 'Role', type: 'text', max: 40, help: 'The Day 148 person role a greeting is for.' },
    { key: 'qst', label: 'Quest', type: 'ref', refPrefix: 'qst_', help: 'The quest a quest dialogue belongs to.' },
    { key: 'speaker', label: 'Default speaker', type: 'text', max: 160, help: 'A chr_, an npc_, or a plain name. Left empty, the host shows the person being talked to.' },
    { key: 'por', label: 'Default portrait', type: 'ref', refPrefix: 'por_' },
    { key: 'start', label: 'Start node', type: 'text', max: 32 },
    { key: 'nodes', label: 'Nodes', type: 'object', help: 'Each node: lines, commands, then next or choices. Edited in the Dialogue tab.' },
    { key: 'notes', label: 'Note', type: 'longtext', max: 1200 }
  ];
  Kit.codex.register({ name: STORY.TYPES['dlg_'].name, prefix: 'dlg_', label: STORY.TYPES['dlg_'].label, ns: 'story', forge: STORY.FORGE, group: 'story', dependsOn: [], fields: U.clone(STORY.ENVELOPE_FIELDS).concat(DIALOGUE_FIELDS) });

  // ---------------------------------------------------------------- ids
  D.idFor = function (key) { return ES.ids.structural('dlg_', key); };
  D.roleKey = function (role, chp) { return 'dlg|role|' + role + '|' + chp; };
  D.questKey = function (qst) { return 'dlg|quest|' + qst; };
  D.pageKey = {
    role: function (chp) { return 'role|' + chp; },
    quest: function (qst, node) { return 'quest|' + qst + '|' + node; }
  };

  // ---------------------------------------------------------------- the words the scaffold uses
  var GREETINGS = {
    resident: ['Welcome, traveler. Folk in {c} keep to themselves, but we look after our own.', 'The roads around {c} have been strange lately. Keep your wits about you.', 'I have lived near {c} all my life, and I have never known a season like this one.'],
    innkeeper: ['Rest your feet, traveler. A bed in {c} is never turned away.', 'You look worn from the road. Stay a while and be warm.', 'Every traveler through {c} stops here sooner or later. What can I do for you?'],
    'shop:item': ['Potions and remedies, fresh for the road through {c}.', 'Stock up before you go. {c} is no place to run short.', 'Everything an honest traveler needs, and a little more.'],
    'shop:weapon': ['Good steel for hard roads. Take a look.', 'Blades and bows from the best smiths in {c}.', 'You will want something sharper for what lies ahead.'],
    'shop:armor': ['A good coat of mail has saved more lives than any sword.', 'Armor fitted for the roads of {c}. Try something on.', 'Keep your guard up out there, and your plate sound.'],
    priest: ['May the light keep you on the road through {c}.', 'The faithful of {c} will pray for your journey.', 'Troubled times test us all. Be steady, traveler.'],
    guard: ['Halt. State your business in {c}. Ah, carry on, traveler.', 'Keep to the road and you will come to no harm in {c}.', 'We have our eyes open. Trouble will not catch {c} sleeping.']
  };
  D.greeting = function (role, chpName, chapterIndex) {
    var list = GREETINGS[role] || GREETINGS.resident, i = Math.max(0, chapterIndex | 0) % list.length;
    return list[i].replace(/\{c\}/g, chpName || 'these lands');
  };
  function roleBody(role, chp, i, b) {
    var cn = chapterName(chp, b);
    return { kind: 'role', role: role, chapter: chp, start: 'hello', nodes: { hello: { lines: [D.greeting(role, cn, i)] } }, notes: 'What every ' + D.roleLabel(role).toLowerCase() + ' says in ' + cn + ' unless a page of their own says otherwise.' };
  }
  function giveCmds(q) {
    var out = [];
    (Array.isArray(q.rewards) ? q.rewards : []).forEach(function (r) { if (U.isObj(r) && typeof r.item === 'string') out.push({ op: 'giveItem', itm: r.item, qty: Q.KEY_RE && r.qty > 0 ? r.qty : 1 }); });
    return out;
  }
  function uniqueNodeKey(base, used) {
    var k = base, n = 2;
    while (used[k]) { k = base.slice(0, 29) + '_' + n; n++; }
    used[k] = 1;
    return k;
  }
  // Nodes and pages for one quest with a giver. Returns {nodes, start, pages [{cond, node}]}.
  function questParts(q, b) {
    var st = (Array.isArray(q.stages) ? q.stages : []).filter(function (x) { return U.isObj(x) && typeof x.key === 'string'; });
    var n = st.length, nodes = {}, pages = [], used = {}, last = st[n - 1], big = q.kind === 'side' && n >= 3;
    function at(stage) { return { op: 'quest', qst: q.id, is: 'at', stage: stage }; }
    function lab(s) { return trim(s && s.label) || (s && s.key) || 'the task'; }
    if (!n) return { nodes: {}, start: null, pages: [] };
    if (big) {
      var s1 = st[1], notes = trim(q.notes);
      var offerLines = ['I need a favor, traveler.'];
      if (notes) offerLines.push(cut(notes, 140));
      nodes.offer = { lines: offerLines, choices: [
        { text: 'I will help.', cmds: [{ op: 'questStage', qst: q.id, stage: s1.key }], next: 'accept' },
        { text: 'Not right now.', next: 'later' }] };
      nodes.accept = { lines: ['Thank you. Come back when it is done.'] };
      nodes.later = { lines: ['I understand. Come back if you change your mind.'] };
      nodes.progress = { lines: ['Any word on ' + lab(s1) + '?'], choices: [
        { text: 'It is done.', next: 'turnin' },
        { text: 'Not yet.', next: 'wait' }] };
      nodes.wait = { lines: ['Take your time. I will be here.'] };
      nodes.turnin = { lines: ['You have my thanks, traveler. I will not forget this.'], cmds: giveCmds(q).concat([{ op: 'questStage', qst: q.id, stage: last.key }]) };
      nodes.after = { lines: ['Thank you again for all your help.'] };
      ['offer', 'accept', 'later', 'progress', 'wait', 'turnin', 'after'].forEach(function (k) { used[k] = 1; });
      pages.push({ node: 'offer', cond: { op: 'not', of: { op: 'quest', qst: q.id, is: 'started' } } });
      pages.push({ node: 'progress', cond: at(s1.key) });
      for (var m = 2; m < n - 1; m++) {
        var mk = uniqueNodeKey('progress_' + st[m].key.slice(0, 23), used);
        nodes[mk] = { lines: ['Your task is not over yet: ' + lab(st[m]) + '.'] };
        pages.push({ node: mk, cond: at(st[m].key) });
      }
      pages.push({ node: 'after', cond: { op: 'quest', qst: q.id, is: 'done' } });
      return { nodes: nodes, start: 'offer', pages: pages };
    }
    // A main quest's first stage belongs to the giver's talk event (Phase 5) whenever the stage has no exit condition, so
    // its offer node would never be seen; and the last chapter's quest completes in the finale, which ends the game, so its
    // turn in node would never be seen either. Neither is built (Phase 7 found both through the walk).
    var chs = STORY.chapters(b), lastChapter = chs.length ? chs[chs.length - 1].id : null;
    var skipFirst = q.kind === 'main' && n > 2 && !st[0].exitWhen && !!q.giver, skipLast = q.kind === 'main' && n > 2 && q.chapter === lastChapter;
    var firstKey = null;
    for (var i = 0; i < n; i++) {
      if ((i === 0 && skipFirst) || (i === n - 1 && skipLast)) continue;
      var s = st[i], key = i === 0 ? 'offer' : (i === n - 1 ? 'turnin' : uniqueNodeKey('progress_' + s.key.slice(0, 23), used));
      if (!firstKey) firstKey = key;
      if (i === 0) used.offer = 1;
      if (i === n - 1 && n > 1) used.turnin = 1;
      var last0 = i === n - 1 && n > 1, finale = last0 && /finale|won/i.test(lab(s));
      nodes[key] = { lines: last0 ? [finale ? 'It is done. The land will remember what you did.' : 'Well done, traveler. Your work here is finished, and the road onward is open.'] : (i === 0 ? ['Welcome, traveler. Your next task: ' + lab(s) + '.'] : ['Remember your purpose. Your next task: ' + lab(s) + '.']) };
      pages.push({ node: key, cond: at(s.key) });
    }
    return { nodes: nodes, start: firstKey || 'offer', pages: pages };
  }
  // Where a quest page sits in its giver's list (higher wins): see D.wanted.
  function pageRank(q, node) {
    if (q.kind === 'side') return node === 'after' ? 2 : node === 'offer' ? 4 : 5;
    return node === 'turnin' ? 1 : 3;
  }
  function questBody(q, b) {
    var p = questParts(q, b), body = { kind: 'quest', qst: q.id, speaker: q.giver, start: p.start || 'offer', nodes: p.nodes, notes: 'What ' + nameOf(q.giver, 'the giver') + ' says as ' + (q.name || 'the quest') + ' moves. ' + (q.kind === 'side' ? 'The turn in choice does not check that the task is done; give it a condition, for example an item the task hands over.' : 'Each page opens the node for the stage the quest is at.') };
    if (typeof q.chapter === 'string' && q.chapter) body.chapter = q.chapter;
    return body;
  }

  // ---------------------------------------------------------------- what the world and the quests ask for
  function ownIndex(npc, chapters) {
    var i = -1;
    chapters.forEach(function (c, k) { if (c.id === npc.chapter) i = k; });
    return i < 0 ? 0 : i;
  }
  // {dialogues [{key, id, name, kind, body}], pages {npc: [page]}}: every dialogue and every generated page, in a stable order.
  D.wanted = function (b) {
    b = b || cur();
    var out = { dialogues: [], pages: {} }, s = b && b.story;
    if (!b || !s) return out;
    var chapters = STORY.chapters(b).filter(function (c) { return typeof c.id === 'string'; }), npcs = STORY.world.list('npc_', b), want = {};
    function addDlg(w) { if (!want[w.key]) { want[w.key] = 1; out.dialogues.push(w); } }
    npcs.forEach(function (n) {
      var role = typeof n.role === 'string' && n.role ? n.role : 'resident', own = ownIndex(n, chapters), pages = [];
      for (var j = own; j < chapters.length; j++) {
        var chp = chapters[j].id, key = D.roleKey(role, chp);
        addDlg({ key: key, id: D.idFor(key), name: D.roleLabel(role) + ' in ' + (chapters[j].name || chp), kind: 'role', body: roleBody(role, chp, j, b) });
        var pg = { key: D.pageKey.role(chp), origin: 'generated', dlg: D.idFor(key) };
        if (j > own) pg.cond = { op: 'chapter', chp: chp, cmp: 'gte' };
        pages.push(pg);
      }
      out.pages[n.id] = pages;
    });
    var known = {};
    npcs.forEach(function (n) { known[n.id] = 1; });
    STORY.records.list('qst_', b).forEach(function (q) {
      if (!q.giver || !known[q.giver] || (q.kind !== 'main' && q.kind !== 'side') || !Array.isArray(q.stages) || !q.stages.length) return;
      var key = D.questKey(q.id), id = D.idFor(key), parts = questParts(q, b);
      addDlg({ key: key, id: id, name: 'Quest: ' + (q.name || q.id), kind: 'quest', body: questBody(q, b) });
      parts.pages.forEach(function (p) { out.pages[q.giver].push({ key: D.pageKey.quest(q.id, p.node), origin: 'generated', cond: p.cond, dlg: id, node: p.node, rank: pageRank(q, p.node) }); });
    });
    // DECISION (Phase 7), one person giving several quests: the rightmost passing page wins, so the order decides who speaks.
    // Greetings, then a main quest's turn in (it lasts forever once done), then a side quest's thanks (also forever), then
    // the main quest's stage hints, then the side quest's offer and progress, which the player must be able to act on.
    Object.keys(out.pages).forEach(function (npc) {
      var list = out.pages[npc].map(function (p, i) { return { p: p, i: i }; });
      list.sort(function (x, y) { return (x.p.rank || 0) - (y.p.rank || 0) || x.i - y.i; });
      out.pages[npc] = list.map(function (x) { delete x.p.rank; return x.p; });
    });
    return out;
  };
  // Generated pages in canonical order, an author's page standing in for the generated page with its key, then the pages the
  // author made by hand.
  function mergePages(existing, gen) {
    var ex = Array.isArray(existing) ? existing.filter(U.isObj) : [], byKey = {}, used = [];
    ex.forEach(function (p) { if (p.origin !== 'generated' && typeof p.key === 'string') byKey[p.key] = p; });
    var out = gen.map(function (g) { if (byKey[g.key]) { used.push(byKey[g.key]); return byKey[g.key]; } return g; });
    ex.forEach(function (p) { if (p.origin !== 'generated' && used.indexOf(p) < 0) out.push(p); });
    return out;
  }
  D.mergePages = mergePages;

  // ---------------------------------------------------------------- the scaffold
  // Idempotent: a second run changes nothing and does not touch the bundle. Returns a report.
  D.scaffold = function (b) {
    b = b || cur();
    var rep = { created: [], removed: [], kept: [], pages: 0, people: 0, changed: false, skipped: null };
    if (!b) { rep.skipped = 'No bundle is open.'; return rep; }
    var ready = STORY.readiness(b);
    if (ready !== true) { rep.skipped = ready; return rep; }
    STORY.ensure(b);
    var s = b.story, R = s.records.dlg_, scaf = s.scaffold, ND = s.npcDialogue, W = D.wanted(b), want = {};
    W.dialogues.forEach(function (w) {
      want[w.key] = w;
      if (!R[w.id]) { R[w.id] = STORY.envelope('dlg_', w.key, w.name, w.body); rep.created.push(w.id); }
      if (scaf[w.key] !== w.id) { scaf[w.key] = w.id; rep.changed = true; }
    });
    var npcs = STORY.world.list('npc_', b), seen = {};
    npcs.forEach(function (n) {
      seen[n.id] = 1;
      var next = mergePages(ND[n.id], W.pages[n.id] || []);
      if (canon(next) !== canon(Array.isArray(ND[n.id]) ? ND[n.id] : [])) {
        if (next.length) ND[n.id] = next; else delete ND[n.id];
        rep.pages++; rep.changed = true;
      }
    });
    Object.keys(ND).sort().forEach(function (npc) {
      if (seen[npc]) return;
      var keep = (Array.isArray(ND[npc]) ? ND[npc] : []).filter(function (p) { return U.isObj(p) && p.origin !== 'generated'; });
      if (keep.length !== (Array.isArray(ND[npc]) ? ND[npc].length : 0)) { if (keep.length) ND[npc] = keep; else delete ND[npc]; rep.changed = true; }
    });
    var byUser = {};
    Object.keys(ND).forEach(function (npc) { ND[npc].forEach(function (p) { if (U.isObj(p) && p.origin !== 'generated' && typeof p.dlg === 'string') byUser[p.dlg] = 1; }); });
    Object.keys(scaf).sort().forEach(function (k) {
      if (k.indexOf('dlg|') !== 0 || want[k]) return;
      var id = scaf[k], r = R[id];
      if (r && r.origin === 'generated') {
        if (byUser[id]) { r.origin = 'user'; rep.kept.push(id); } else { delete R[id]; rep.removed.push(id); }
      }
      delete scaf[k]; rep.changed = true;
    });
    rep.people = Object.keys(ND).length;
    if (rep.created.length || rep.removed.length || rep.kept.length || rep.pages || rep.changed) {
      s.records.dlg_ = sortedObj(R); s.npcDialogue = sortedObj(ND); s.scaffold = sortedObj(scaf);
      rep.changed = true;
      if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch('story-dialogue'); }
    }
    return rep;
  };
  D.reportText = function (rep) {
    if (rep.skipped) return 'Nothing to build: ' + rep.skipped;
    if (!rep.changed) return 'Every dialogue the world and the quests ask for is already built.';
    var bits = [];
    if (rep.created.length) bits.push(plural(rep.created.length, 'dialogue') + ' built');
    if (rep.removed.length) bits.push(plural(rep.removed.length, 'dialogue') + ' dropped');
    if (rep.kept.length) bits.push(plural(rep.kept.length, 'dialogue') + ' kept for your own pages');
    if (rep.pages) bits.push(plural(rep.pages, 'person', 'people') + ' brought up to date');
    return (bits.join(', ') || 'Dialogue brought up to date') + '.';
  };
  D.expected = function (b) {
    b = b || cur();
    var s = b && b.story, W = D.wanted(b), by = { role: { want: 0, have: 0 }, quest: { want: 0, have: 0 } }, pagesTodo = 0;
    W.dialogues.forEach(function (w) { by[w.kind].want++; if (s && s.records.dlg_[w.id]) by[w.kind].have++; });
    if (s) STORY.world.list('npc_', b).forEach(function (n) { if (canon(mergePages(s.npcDialogue[n.id], W.pages[n.id] || [])) !== canon(Array.isArray(s.npcDialogue[n.id]) ? s.npcDialogue[n.id] : [])) pagesTodo++; });
    var missing = W.dialogues.filter(function (w) { return !(s && s.records.dlg_[w.id]); }).length;
    return { by: by, total: W.dialogues.length, missing: missing, pagesTodo: pagesTodo };
  };

  // ---------------------------------------------------------------- checks
  // Cross field mistakes and everything ENGINE_STORY.dlg.lint finds: [{level, code, path, message}]. idx holds the record.
  D.check = function (rec, b, idx) {
    b = b || cur(); idx = idx || STORY.engineIndex(b);
    var out = [];
    function add(level, code, path, message) { out.push({ level: level, code: code, path: path, message: message }); }
    if (!U.isObj(rec)) { add('error', 'shape', '', 'A dialogue must be an object.'); return out; }
    if (typeof rec.name !== 'string' || !rec.name.trim()) add('error', 'name', 'name', 'A dialogue needs a name.');
    if (rec.kind !== undefined && D.KINDS.indexOf(rec.kind) < 0) add('error', 'kind', 'kind', 'Kind must be role, quest, or custom.');
    if (rec.qst !== undefined && rec.qst !== null && rec.qst !== '' && !(b.story.records.qst_ && b.story.records.qst_[rec.qst])) add('error', 'ref', 'qst', 'The quest ' + rec.qst + ' is not a quest in this story.');
    if (rec.chapter !== undefined && rec.chapter !== null && rec.chapter !== '' && !STORY.chapters(b).some(function (c) { return c.id === rec.chapter; })) add('error', 'ref', 'chapter', 'The chapter ' + rec.chapter + ' is not in the Charter.');
    var entry = {};
    Object.keys(b.story.npcDialogue || {}).forEach(function (npc) { (Array.isArray(b.story.npcDialogue[npc]) ? b.story.npcDialogue[npc] : []).forEach(function (p) { if (U.isObj(p) && p.dlg === rec.id && typeof p.node === 'string') entry[p.node] = 1; }); });
    Object.keys(entry).forEach(function (k) {
      if (!U.isObj(rec.nodes) || !rec.nodes[k]) return;
      var cp = U.clone(rec); cp.start = k;
      ES.dlg.reach(cp).order.forEach(function (r) { entry[r] = 1; });
    });
    ES.dlg.lint(rec, idx, '').forEach(function (p) {
      var m = /^(?:dialogue)?\.?nodes\.([a-z0-9_]+)$/.exec(String(p.path));
      if (p.code === 'unreachable' && m && entry[m[1]]) return;
      add(p.level, p.code, String(p.path).replace(/^\./, ''), p.message);
    });
    return out;
  };
  D.checkPages = function (npc, pages, b, idx) {
    b = b || cur(); idx = idx || STORY.engineIndex(b);
    return ES.dlg.lintPages(pages, idx, 'npcDialogue.' + npc);
  };
  Kit.validate.register('story.dialogue', function (b, ctx) {
    var s = b.story;
    if (!s || !U.isObj(s.records)) return;
    var ids = Object.keys(s.records.dlg_ || {}).sort(), pages = Object.keys(s.npcDialogue || {}).sort();
    if (!ids.length && !pages.length) return;
    var idx = STORY.engineIndex(b);
    ids.forEach(function (id) {
      var rec = s.records.dlg_[id];
      if (!U.isObj(rec)) return;
      D.check(rec, b, idx).forEach(function (p) { ctx.add({ recordId: id, fieldPath: p.path, message: p.message, level: p.level }); });
    });
    pages.forEach(function (npc) {
      if (!STORY.world.get(npc, b)) { ctx.add({ recordId: 'story', fieldPath: 'npcDialogue.' + npc, message: 'Pages for ' + npc + ', a person the world does not have.', level: 'error' }); return; }
      D.checkPages(npc, s.npcDialogue[npc], b, idx).forEach(function (p) { ctx.add({ recordId: 'story', fieldPath: p.path, message: p.message, level: p.level }); });
    });
  });

  // ---------------------------------------------------------------- editing
  function sameProblem(a, z) { return a.code === z.code && a.path === z.path && a.message === z.message; }
  function indexWith(rec, b) {
    var recs = {};
    Object.keys(b.story.records).forEach(function (p) { recs[p] = b.story.records[p]; });
    recs.dlg_ = {};
    Object.keys(b.story.records.dlg_).forEach(function (k) { recs.dlg_[k] = b.story.records.dlg_[k]; });
    recs.dlg_[rec.id] = rec;
    return ES.index.build({ records: recs, bindings: b.story.bindings, npcDialogue: b.story.npcDialogue }, STORY.engineExt(b));
  }
  D.indexWith = indexWith;
  function touch(why, b) { if (b === cur()) { Kit.index.invalidate(); Kit.bundle.touch(why); } }
  // Applies fn to a copy of the dialogue. A result with an error string refuses the edit, and so does an edit that would add
  // an error the dialogue did not already have. Nothing is written then. Returns {ok, record} or {ok: false, problems}.
  D.edit = function (id, fn, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.dlg_, rec = R && R[id];
    if (!rec) return { ok: false, problems: [{ level: 'error', code: 'missing', path: 'id', message: 'That dialogue does not exist.' }] };
    var before = D.check(rec, b, STORY.engineIndex(b)).filter(function (p) { return p.level === 'error'; });
    var next = U.clone(rec), r = fn(next);
    if (r && r.error) return { ok: false, problems: [{ level: 'error', code: 'edit', path: '', message: r.error }] };
    var fresh = D.check(next, b, indexWith(next, b)).filter(function (p) { return p.level === 'error' && !before.some(function (x) { return sameProblem(x, p); }); });
    if (fresh.length) return { ok: false, problems: fresh };
    R[id] = next;
    touch('story-dialogue', b);
    return { ok: true, record: next };
  };
  D.update = function (id, patch, b) {
    patch = patch || {};
    return D.edit(id, function (rec) {
      ['name', 'speaker', 'por', 'chapter', 'notes'].forEach(function (k) {
        if (patch[k] === undefined) return;
        var v = typeof patch[k] === 'string' ? patch[k].trim() : patch[k];
        if (v === '' || v === null) { if (k !== 'name') delete rec[k]; else return; } else rec[k] = v;
      });
    }, b);
  };
  D.freeNodeKey = function (rec, base) {
    var used = U.isObj(rec && rec.nodes) ? rec.nodes : {}, n = 1;
    base = base || 'node';
    while (used[base + n]) n++;
    return base + n;
  };
  function cleanNode(n) {
    var o = {};
    ['speaker', 'por', 'prompt'].forEach(function (k) { if (typeof n[k] === 'string' && n[k].trim()) o[k] = n[k].trim(); });
    if (Array.isArray(n.lines)) o.lines = n.lines.map(function (l) { return String(l); });
    if (Array.isArray(n.cmds) && n.cmds.length) o.cmds = n.cmds;
    if (Array.isArray(n.choices) && n.choices.length) o.choices = n.choices;
    else if (typeof n.next === 'string' && n.next) o.next = n.next;
    return o;
  }
  D.addNode = function (id, spec, b) {
    spec = spec || {};
    var made = null;
    var res = D.edit(id, function (rec) {
      if (!U.isObj(rec.nodes)) rec.nodes = {};
      if (Object.keys(rec.nodes).length >= D.MAX_NODES) return { error: 'A dialogue holds up to ' + D.MAX_NODES + ' nodes.' };
      var key = spec.key ? String(spec.key).trim() : D.freeNodeKey(rec);
      if (!D.KEY_RE.test(key)) return { error: 'A node key uses lowercase letters, digits, and underscores, starts with a letter, and holds up to 32 characters.' };
      if (rec.nodes[key]) return { error: 'This dialogue already has a node ' + key + '.' };
      rec.nodes[key] = { lines: Array.isArray(spec.lines) && spec.lines.length ? spec.lines.slice() : ['Say something here.'] };
      rec.nodes = sortedObj(rec.nodes);
      if (!rec.start) rec.start = key;
      made = key;
    }, b);
    if (res.ok) res.key = made;
    return res;
  };
  // patch: any of speaker, por, prompt, lines, cmds, next, choices; null or '' removes a field. Setting next removes choices
  // unless the patch gives them, and giving choices removes next.
  D.updateNode = function (id, key, patch, b) {
    patch = patch || {};
    return D.edit(id, function (rec) {
      var n = U.isObj(rec.nodes) && rec.nodes[key];
      if (!n) return { error: 'That node does not exist.' };
      ['speaker', 'por', 'prompt', 'lines', 'cmds', 'next', 'choices'].forEach(function (k) {
        if (patch[k] === undefined) return;
        if (patch[k] === null || patch[k] === '' || (Array.isArray(patch[k]) && !patch[k].length && k !== 'lines')) delete n[k]; else n[k] = patch[k];
      });
      if (patch.next && patch.choices === undefined) delete n.choices;
      if (Array.isArray(patch.choices) && patch.choices.length) delete n.next;
      rec.nodes[key] = cleanNode(n);
    }, b);
  };
  D.replaceNode = function (id, key, node, b) {
    return D.edit(id, function (rec) {
      if (!U.isObj(rec.nodes) || !rec.nodes[key]) return { error: 'That node does not exist.' };
      rec.nodes[key] = cleanNode(U.isObj(node) ? node : {});
    }, b);
  };
  D.setStart = function (id, key, b) {
    return D.edit(id, function (rec) { if (!U.isObj(rec.nodes) || !rec.nodes[key]) return { error: 'That node does not exist.' }; rec.start = key; }, b);
  };
  function pagesOnDialogue(id, b, fn) {
    var ND = b.story.npcDialogue, n = 0;
    Object.keys(ND).sort().forEach(function (npc) { (Array.isArray(ND[npc]) ? ND[npc] : []).forEach(function (p) { if (U.isObj(p) && p.dlg === id && fn(p, npc)) n++; }); });
    return n;
  }
  D.renameNode = function (id, from, to, b) {
    b = b || cur();
    to = String(to || '').trim();
    if (!D.KEY_RE.test(to)) return { ok: false, problems: [{ level: 'error', code: 'node-key', path: '', message: 'A node key uses lowercase letters, digits, and underscores, starts with a letter, and holds up to 32 characters.' }] };
    var res = D.edit(id, function (rec) {
      if (!U.isObj(rec.nodes) || !rec.nodes[from]) return { error: 'That node does not exist.' };
      if (from === to) return;
      if (rec.nodes[to]) return { error: 'This dialogue already has a node ' + to + '.' };
      rec.nodes[to] = rec.nodes[from]; delete rec.nodes[from]; rec.nodes = sortedObj(rec.nodes);
      if (rec.start === from) rec.start = to;
      Object.keys(rec.nodes).forEach(function (k) {
        var n = rec.nodes[k];
        if (n.next === from) n.next = to;
        (Array.isArray(n.choices) ? n.choices : []).forEach(function (c) { if (U.isObj(c) && c.next === from) c.next = to; });
      });
    }, b);
    if (res.ok && from !== to && pagesOnDialogue(id, b, function (p) { if (p.node === from) { p.node = to; return true; } return false; })) touch('story-dialogue', b);
    return res;
  };
  // Removes a node and every link to it (a next or a choice that led there leads nowhere afterward). The start node, and the
  // last node, stay. A page that opened at the node opens at the start instead.
  D.removeNode = function (id, key, b) {
    b = b || cur();
    var unlinked = 0;
    var res = D.edit(id, function (rec) {
      if (!U.isObj(rec.nodes) || !rec.nodes[key]) return { error: 'That node does not exist.' };
      if (rec.start === key) return { error: 'That is the start node. Make another node the start first.' };
      delete rec.nodes[key];
      Object.keys(rec.nodes).forEach(function (k) {
        var n = rec.nodes[k];
        if (n.next === key) { delete n.next; unlinked++; }
        (Array.isArray(n.choices) ? n.choices : []).forEach(function (c) { if (U.isObj(c) && c.next === key) { delete c.next; unlinked++; } });
      });
    }, b);
    if (!res.ok) return res;
    res.unlinked = unlinked;
    res.pages = pagesOnDialogue(id, b, function (p) { if (p.node === key) { delete p.node; return true; } return false; });
    if (res.pages) touch('story-dialogue', b);
    return res;
  };
  D.addChoice = function (id, key, spec, b) {
    spec = spec || {};
    return D.edit(id, function (rec) {
      var n = U.isObj(rec.nodes) && rec.nodes[key];
      if (!n) return { error: 'That node does not exist.' };
      var list = Array.isArray(n.choices) ? n.choices.slice() : [];
      if (!list.length && n.next) list.push({ text: 'Continue', next: n.next });
      var c = { text: trim(spec.text) || 'A choice' };
      if (spec.next) c.next = spec.next;
      list.push(c);
      n.choices = list; delete n.next;
    }, b);
  };
  D.updateChoice = function (id, key, i, patch, b) {
    patch = patch || {};
    return D.edit(id, function (rec) {
      var n = U.isObj(rec.nodes) && rec.nodes[key], c = n && Array.isArray(n.choices) && n.choices[i];
      if (!c) return { error: 'That choice does not exist.' };
      ['text', 'cond', 'cmds', 'next'].forEach(function (k) {
        if (patch[k] === undefined) return;
        if (patch[k] === null || patch[k] === '' || (k === 'cmds' && Array.isArray(patch[k]) && !patch[k].length)) delete c[k]; else c[k] = patch[k];
      });
    }, b);
  };
  D.removeChoice = function (id, key, i, b) {
    return D.edit(id, function (rec) {
      var n = U.isObj(rec.nodes) && rec.nodes[key];
      if (!n || !Array.isArray(n.choices) || !n.choices[i]) return { error: 'That choice does not exist.' };
      n.choices.splice(i, 1);
      if (!n.choices.length) delete n.choices;
    }, b);
  };
  D.moveChoice = function (id, key, i, delta, b) {
    return D.edit(id, function (rec) {
      var n = U.isObj(rec.nodes) && rec.nodes[key], list = n && n.choices, j = i + delta;
      if (!Array.isArray(list) || !list[i] || j < 0 || j >= list.length) return { error: 'That choice cannot move there.' };
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }, b);
  };
  // A dialogue an author makes by hand: spec {name, speaker, chapter}. One node, a minted ID, origin user.
  D.add = function (spec, b) {
    b = b || cur();
    spec = spec || {};
    if (!b) return { ok: false, problems: [{ level: 'error', code: 'none', path: '', message: 'No bundle is open.' }] };
    STORY.ensure(b);
    var name = trim(spec.name);
    if (!name) return { ok: false, problems: [{ level: 'error', code: 'name', path: 'name', message: 'A dialogue needs a name.' }] };
    var body = { kind: 'custom', start: 'hello', nodes: { hello: { lines: ['Say something here.'] } } };
    if (trim(spec.speaker)) body.speaker = trim(spec.speaker);
    if (spec.chapter) body.chapter = spec.chapter;
    var rec = STORY.authored('dlg_', name, body);
    var probs = D.check(rec, b, indexWith(rec, b)).filter(function (p) { return p.level === 'error'; });
    if (probs.length) return { ok: false, problems: probs };
    b.story.records.dlg_[rec.id] = rec;
    b.story.records.dlg_ = sortedObj(b.story.records.dlg_);
    touch('story-dialogue', b);
    return { ok: true, record: rec };
  };
  // Who opens this dialogue: [{npc, name, page}] (page is 1 based), sorted.
  D.usedBy = function (id, b) {
    b = b || cur();
    var out = [];
    if (!b || !b.story) return out;
    Object.keys(b.story.npcDialogue || {}).sort().forEach(function (npc) {
      (Array.isArray(b.story.npcDialogue[npc]) ? b.story.npcDialogue[npc] : []).forEach(function (p, i) { if (U.isObj(p) && p.dlg === id) out.push({ npc: npc, name: nameOf(npc, npc), page: i + 1 }); });
    });
    return out;
  };
  // Removes a dialogue, and the pages that opened it (a page without its dialogue is meaningless). A generated dialogue
  // comes back with the next build.
  D.remove = function (id, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.dlg_, rec = R && R[id];
    if (!rec) return { ok: false, message: 'That dialogue does not exist.' };
    var users = D.usedBy(id, b), scaf = b.story.scaffold, ND = b.story.npcDialogue;
    delete R[id];
    Object.keys(scaf).forEach(function (k) { if (scaf[k] === id && k.indexOf('dlg|') === 0) delete scaf[k]; });
    Object.keys(ND).forEach(function (npc) {
      var keep = (Array.isArray(ND[npc]) ? ND[npc] : []).filter(function (p) { return !(U.isObj(p) && p.dlg === id); });
      if (keep.length) ND[npc] = keep; else delete ND[npc];
    });
    touch('story-dialogue', b);
    return { ok: true, usedBy: users };
  };
  D.reset = function (id, b) {
    b = b || cur();
    var R = b && b.story && b.story.records.dlg_, rec = R && R[id];
    if (!rec) return { ok: false, message: 'That dialogue does not exist.' };
    if (rec.origin !== 'generated') return { ok: false, message: 'Only a generated dialogue can be set back to what the world asks for.' };
    var w = D.wanted(b).dialogues.filter(function (x) { return x.id === id; })[0];
    if (!w) return { ok: false, message: 'The world and the quests no longer ask for this dialogue.' };
    R[id] = STORY.envelope('dlg_', w.key, w.name, w.body);
    touch('story-dialogue', b);
    return { ok: true, record: R[id] };
  };

  // ---------------------------------------------------------------- a person's pages
  D.pagesOf = function (npc, b) { b = b || cur(); var l = b && b.story && b.story.npcDialogue[npc]; return Array.isArray(l) ? l : []; };
  // Replaces a person's page list. Refused when it adds an error the list did not have.
  D.setPages = function (npc, pages, b) {
    b = b || cur();
    if (!b) return { ok: false, problems: [{ level: 'error', code: 'none', path: '', message: 'No bundle is open.' }] };
    if (!STORY.world.get(npc, b)) return { ok: false, problems: [{ level: 'error', code: 'ref', path: 'npc', message: 'That person is not in the world.' }] };
    var idx = STORY.engineIndex(b), errs = function (list) { return D.checkPages(npc, list, b, idx).filter(function (p) { return p.level === 'error'; }); };
    var before = errs(D.pagesOf(npc, b)), fresh = errs(pages).filter(function (p) { return !before.some(function (x) { return sameProblem(x, p); }); });
    if (fresh.length) return { ok: false, problems: fresh };
    if (pages.length) b.story.npcDialogue[npc] = pages; else delete b.story.npcDialogue[npc];
    b.story.npcDialogue = sortedObj(b.story.npcDialogue);
    touch('story-dialogue', b);
    return { ok: true, pages: pages };
  };
  D.addPage = function (npc, spec, b) {
    spec = spec || {};
    var p = { origin: 'user', dlg: spec.dlg };
    if (spec.node) p.node = spec.node;
    if (spec.cond !== undefined && spec.cond !== null) p.cond = spec.cond;
    return D.setPages(npc, D.pagesOf(npc, b).concat([p]), b);
  };
  // patch: any of dlg, node, cond (null removes). Editing a generated page makes it the author's (the key stays, so a rebuild
  // leaves it where it is).
  D.updatePage = function (npc, i, patch, b) {
    patch = patch || {};
    var list = U.clone(D.pagesOf(npc, b)), p = list[i];
    if (!U.isObj(p)) return { ok: false, problems: [{ level: 'error', code: 'missing', path: '', message: 'That page does not exist.' }] };
    ['dlg', 'node', 'cond'].forEach(function (k) {
      if (patch[k] === undefined) return;
      if (patch[k] === null || patch[k] === '') delete p[k]; else p[k] = patch[k];
    });
    p.origin = 'user';
    return D.setPages(npc, list, b);
  };
  D.removePage = function (npc, i, b) {
    var list = U.clone(D.pagesOf(npc, b));
    if (!list[i]) return { ok: false, problems: [{ level: 'error', code: 'missing', path: '', message: 'That page does not exist.' }] };
    list.splice(i, 1);
    return D.setPages(npc, list, b);
  };
  D.movePage = function (npc, i, delta, b) {
    var list = U.clone(D.pagesOf(npc, b)), j = i + delta;
    if (!list[i] || j < 0 || j >= list.length) return { ok: false, problems: [{ level: 'error', code: 'range', path: '', message: 'That page cannot move there.' }] };
    var t = list[i]; list[i] = list[j]; list[j] = t;
    return D.setPages(npc, list, b);
  };
  // Back to the generated pages only: the author's pages for this person go.
  D.resetPages = function (npc, b) {
    b = b || cur();
    var gen = D.wanted(b).pages[npc];
    if (!gen) return { ok: false, problems: [{ level: 'error', code: 'ref', path: 'npc', message: 'That person is not in the world.' }] };
    var res = D.setPages(npc, U.clone(gen), b);
    return res;
  };

  // ---------------------------------------------------------------- reading
  D.list = function (b) {
    b = b || cur();
    var order = {}, kind = { quest: 0, role: 1, custom: 2 };
    STORY.chapters(b).forEach(function (c, i) { order[c.id] = i; });
    return STORY.records.list('dlg_', b).slice().sort(function (x, y) {
      var kx = kind[x.kind] === undefined ? 3 : kind[x.kind], ky = kind[y.kind] === undefined ? 3 : kind[y.kind];
      if (kx !== ky) return kx - ky;
      var ox = order[x.chapter] === undefined ? 99 : order[x.chapter], oy = order[y.chapter] === undefined ? 99 : order[y.chapter];
      return ox - oy || ((x.name || '') < (y.name || '') ? -1 : (x.name || '') > (y.name || '') ? 1 : 0);
    });
  };
  D.stats = function (rec) {
    var nodes = U.isObj(rec && rec.nodes) ? Object.keys(rec.nodes) : [], lines = 0, choices = 0;
    nodes.forEach(function (k) { var n = rec.nodes[k]; if (U.isObj(n)) { lines += Array.isArray(n.lines) ? n.lines.length : 0; choices += Array.isArray(n.choices) ? n.choices.length : 0; } });
    return { nodes: nodes.length, lines: lines, choices: choices };
  };
  // Every person of the world with their page counts: [{id, name, role, chapter, town, pages, generated, yours, dialogues}].
  D.people = function (b) {
    b = b || cur();
    var rows = [], towns = {};
    STORY.world.list('twn_', b).forEach(function (t) { (Array.isArray(t.people) ? t.people : []).forEach(function (p) { towns[p] = t.name || t.id; }); });
    var order = {};
    STORY.chapters(b).forEach(function (c, i) { order[c.id] = i; });
    STORY.world.list('npc_', b).forEach(function (n) {
      var pages = D.pagesOf(n.id, b), seen = {};
      pages.forEach(function (p) { if (U.isObj(p) && p.dlg) seen[p.dlg] = 1; });
      rows.push({ id: n.id, name: n.name || n.id, role: n.role || 'resident', chapter: n.chapter || null, town: towns[n.id] || '', pages: pages.length,
        generated: pages.filter(function (p) { return U.isObj(p) && p.origin === 'generated'; }).length, yours: pages.filter(function (p) { return U.isObj(p) && p.origin !== 'generated'; }).length, dialogues: Object.keys(seen).sort() });
    });
    rows.sort(function (x, y) { var ox = order[x.chapter] === undefined ? 99 : order[x.chapter], oy = order[y.chapter] === undefined ? 99 : order[y.chapter]; return ox - oy || (x.town < y.town ? -1 : x.town > y.town ? 1 : 0) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0); });
    return rows;
  };
  D.summary = function (b) {
    b = b || cur();
    var recs = STORY.records.list('dlg_', b), by = { role: 0, quest: 0, custom: 0 }, nodes = 0, lines = 0, choices = 0, authored = 0, used = {}, unused = 0;
    var ND = b && b.story ? b.story.npcDialogue : {};
    Object.keys(ND).forEach(function (npc) { (Array.isArray(ND[npc]) ? ND[npc] : []).forEach(function (p) { if (U.isObj(p) && p.dlg) used[p.dlg] = 1; }); });
    recs.forEach(function (d) {
      if (by[d.kind] !== undefined) by[d.kind]++;
      var st = D.stats(d); nodes += st.nodes; lines += st.lines; choices += st.choices;
      if (d.origin === 'user') authored++;
      if (!used[d.id]) unused++;
    });
    var people = STORY.world.list('npc_', b), covered = people.filter(function (n) { return Array.isArray(ND[n.id]) && ND[n.id].length; }).length;
    var givers = {}, quests = STORY.records.list('qst_', b).filter(function (q) { return q.giver && (q.kind === 'main' || q.kind === 'side'); });
    quests.forEach(function (q) { givers[q.id] = !!(b.story.records.dlg_[D.idFor(D.questKey(q.id))] || recs.some(function (d) { return d.qst === q.id; })); });
    var ex = D.expected(b);
    return { total: recs.length, byKind: by, nodes: nodes, lines: lines, choices: choices, authored: authored, unused: unused, people: people.length, covered: covered,
      questsWithGiver: quests.length, questsCovered: Object.keys(givers).filter(function (k) { return givers[k]; }).length, missing: ex.missing, pagesTodo: ex.pagesTodo, expected: ex.total };
  };

  // ---------------------------------------------------------------- the preview runner's index and state
  // A copy of the engine's index that also holds one synthetic event per dialogue node, memoized on KIT:CORE's index identity.
  var pvIdx = { key: null, idx: null };
  D.playIndex = function (b) {
    b = b || cur();
    var key = b === cur() ? Kit.index(b) : null;
    if (key && pvIdx.key === key) return pvIdx.idx;
    var idx = ES.dlg.playIndex(STORY.engineIndex(b));
    if (key) { pvIdx.key = key; pvIdx.idx = idx; }
    return idx;
  };
  // A story state for the previewer: a new game, then the chapter (its gate flag and every earlier one set), and quest stages.
  // opts {chapter: chp, quests: {qst: stage key or ''}, flags: {flg: int}}.
  D.previewState = function (b, opts) {
    b = b || cur();
    opts = opts || {};
    var idx = D.playIndex(b), st = ES.state.create(idx, {});
    var ci = opts.chapter ? idx.chapters.indexOf(opts.chapter) : -1;
    for (var i = 0; i <= ci; i++) { var f = idx.chapterFlags[idx.chapters[i]]; if (f) st.flags[f] = 1; }
    Object.keys(opts.flags || {}).sort().forEach(function (f) { if (idx.flags[f]) st.flags[f] = Math.round(Number(opts.flags[f]) || 0); });
    Object.keys(opts.quests || {}).sort().forEach(function (q) {
      var def = idx.quests[q], stage = opts.quests[q];
      if (!def) return;
      if (stage === 'failed') st.quests[q] = { stage: st.quests[q].stage, failed: true, closed: [] };
      else if (stage && def.stageAt[stage] !== undefined) st.quests[q] = { stage: stage, failed: false, closed: [] };
      else st.quests[q] = { stage: null, failed: false, closed: [] };
    });
    st.chapter = ES.state.chapterOf(st, idx);
    return st;
  };

  // ---------------------------------------------------------------- drafting lines with Claude
  // The prompt is built here so a test can read it; D.draft sends it. Needs a Claude key (Settings); without one the Dialogue
  // tab disables the button and says so, the Day 147 pattern.
  D.cleanLine = function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/\s*[\u2013\u2014]\s*/g, ', ').replace(/\s+-\s+/g, ', ').replace(/\s+/g, ' ').trim();
  };
  D.draftContext = function (rec, nodeKey, b) {
    b = b || cur();
    var n = U.isObj(rec.nodes) && rec.nodes[nodeKey] || {}, sp = n.speaker || rec.speaker || '', ed = ES.dlg.edges(rec);
    var q = rec.qst && b.story.records.qst_[rec.qst];
    var npcs = D.usedBy(rec.id, b).map(function (u) { return u.name; }).slice(0, 6);
    var ctx = {
      charter: Kit.ai.charterSummary(b),
      dialogue: { name: rec.name, kind: rec.kind || 'custom', role: rec.role || null, chapter: rec.chapter ? chapterName(rec.chapter, b) : null, speaker: sp ? nameOf(sp, sp) : null, peopleWhoSayIt: npcs },
      node: { key: nodeKey, lines: Array.isArray(n.lines) ? n.lines : [], choices: (Array.isArray(n.choices) ? n.choices : []).map(function (c) { return c && c.text; }), leadsHereFrom: ed.filter(function (e) { return e.to === nodeKey; }).map(function (e) { return e.from + (e.text ? ' (choice: ' + e.text + ')' : ''); }) }
    };
    if (q) ctx.quest = { name: q.name, kind: q.kind, notes: q.notes || '', stages: (q.stages || []).map(function (s) { return s.label; }) };
    return ctx;
  };
  D.draftPrompt = function (rec, nodeKey, b, wish) {
    var system = [
      'You write dialogue for a classic 16 bit style JRPG, in a tool called Story Forge.',
      'Stay consistent with the Charter summary: its canon, glossary, tone, and names. Never contradict canon.',
      'Write what the character says, in their voice, in short lines a text box can show. Each line is one or two sentences, under ' + D.LONG_LINE + ' characters.',
      'Give each option 1 to 4 lines. Do not use dashes or hyphens as punctuation. Use plain ASCII punctuation.',
      'Do not change the choices or the story. Only write the lines the character says at this node.',
      'Return ONLY JSON of the form {"drafts":[{"name":"a short label","lines":["..."]}]} with exactly 3 drafts that differ in tone or content.'
    ].join(' ');
    var user = 'Context:\n' + JSON.stringify(D.draftContext(rec, nodeKey, b)) + '\n\nRequest: ' + (trim(wish) || 'Write fresh lines for this node.');
    return { system: system, user: user };
  };
  // Asks Claude for three versions of a node's lines and opens them in Kit.review. Accepting one replaces the node's lines.
  // Returns the drafts, or null when no key is saved or nothing usable came back.
  D.draft = async function (id, nodeKey, opts) {
    opts = opts || {};
    var b = opts.bundle || cur(), rec = b && b.story.records.dlg_[id];
    if (!rec || !U.isObj(rec.nodes) || !rec.nodes[nodeKey]) return null;
    if (!Kit.ai.hasKey()) { Kit.ui.toast(Kit.claude.NO_KEY_MSG, 'warn'); return null; }
    var p = D.draftPrompt(rec, nodeKey, b, opts.wish);
    Kit.ui.busy.show('Drafting lines with Claude...');
    var out;
    try {
      out = await Kit.claude({ tier: (b.story.settings && b.story.settings.draftTier) || 'sonnet', system: p.system, messages: [{ role: 'user', content: p.user }], maxTokens: 1500, expectJson: true });
    } finally { Kit.ui.busy.hide(); }
    var j = out && out.json, list = Array.isArray(j) ? j : j && Array.isArray(j.drafts) ? j.drafts : [];
    var drafts = list.filter(U.isObj).map(function (d, i) {
      var lines = (Array.isArray(d.lines) ? d.lines : []).filter(function (l) { return typeof l === 'string'; }).map(D.cleanLine).filter(Boolean).slice(0, 4);
      if (!lines.length) return null;
      var o = { name: D.cleanLine(d.name) || ('Version ' + (i + 1)), kind: 'custom', nodes: {} };
      o.nodes[nodeKey] = { lines: lines };
      return o;
    }).filter(Boolean).slice(0, 3);
    if (!drafts.length) { Kit.ui.toast('Claude returned no usable lines.', 'warn'); return null; }
    Kit.review.open(drafts, STORY.TYPES['dlg_'].name, function (rec2) {
      var lines = rec2 && rec2.nodes && rec2.nodes[nodeKey] && rec2.nodes[nodeKey].lines;
      var r = Array.isArray(lines) ? D.updateNode(id, nodeKey, { lines: lines }, b) : { ok: false };
      if (r.ok && typeof opts.onAccept === 'function') opts.onAccept(r);
      return r.ok;
    }, { note: 'Accepting a version replaces the lines of this node. Nothing else changes.' });
    return drafts;
  };
})();
// === STORY:DIALOGUE END ===
