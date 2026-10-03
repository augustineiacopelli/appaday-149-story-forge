// === WS:STORY149 BEGIN ===
(function () {
  'use strict';
  var U = Kit.util, el = U.el, esc = U.esc;
  var DEV = /[?&]dev=1(&|$)/.test(location.search);
  function cur() { return Kit.bundle.current(); }
  function ready(b) { var r = STORY.readiness(b || cur()); return r === true ? true : r; }
  function kv(pairs) { return '<dl class="kv">' + pairs.map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>'; }
  function button(label, icon, cls, fn) {
    var b = el('button', 'btn' + (cls ? ' ' + cls : ''), (icon ? Kit.icon(icon) : '') + '<span>' + esc(label) + '</span>');
    b.type = 'button'; b.addEventListener('click', fn);
    return b;
  }
  function toggle(label, on, fn) {
    var l = el('label', 'switch'), c = el('input'); c.type = 'checkbox'; c.checked = !!on;
    l.appendChild(c); l.appendChild(el('span', 'track')); l.appendChild(el('span', 'switch-text', esc(label)));
    c.addEventListener('change', function () { fn(c.checked); });
    return l;
  }
  function chip(cls, text, title) { return '<span class="chip ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(text) + '</span>'; }
  function table(head, rows) {
    var t = el('table', 'tbl');
    t.innerHTML = '<thead><tr>' + head.map(function (h) { return '<th scope="col"' + (h.num ? ' class="num"' : '') + '>' + esc(h.label || h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody>';
    var w = el('div', 'tbl-wrap'); w.appendChild(t);
    return w;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  STORY.ui = { button: button, toggle: toggle, kv: kv, chip: chip, table: table };

  // Names for IDs from any namespace, through KIT:CORE's index (world, rules, and charter records all have names).
  function nameOf(id, fallback) { var e = id && Kit.index().byId[id]; return e ? e.name : (fallback || id || ''); }
  function chName(id) { var c = STORY.chapters().filter(function (x) { return x.id === id; })[0]; return c ? c.name || id : id; }
  STORY.nameOf = nameOf;

  // ---------------------------------------------------------------- size meter (header)
  function paintMeter() {
    var btn = document.getElementById('btnSize');
    if (!btn || !cur()) return;
    var s = STORY.size();
    var cls = s.level === 'red' ? 'chip-error' : s.level === 'amber' ? 'chip-warning' : 'chip-ok';
    btn.innerHTML = '<span class="chip ' + cls + '">' + esc(U.fmtSize(s.total)) + '</span>';
    btn.setAttribute('aria-label', 'Bundle size ' + U.fmtSize(s.total) + ', ' + (s.level === 'ok' ? 'within budget' : s.level === 'amber' ? 'getting large' : 'near the storage limit') + '. Open size details.');
    btn.title = 'Bundle size ' + U.fmtSize(s.total) + ' of about ' + U.fmtSize(s.room) + ' available';
  }
  var meterSoon = U.debounce(paintMeter, 250);
  function sizeBody(host) {
    var s = STORY.size();
    var pct = Math.min(100, Math.round(s.total / Math.max(1, s.room) * 100));
    host.appendChild(el('div', 's9-meter s9-' + s.level, '<i style="width:' + pct + '%"></i>'));
    host.appendChild(el('p', 'muted', esc(U.fmtSize(s.total) + ' of about ' + U.fmtSize(s.room) + ' available in this browser. ' +
      (s.where === 'idb' ? 'The draft is saved in IndexedDB because localStorage filled up; exports are still the safe copy.' : 'The draft is saved under this forge\'s own keys, so Days 146 to 148 in another tab never overwrite it.'))));
    host.appendChild(table([{ label: 'Namespace' }, { label: 'Size', num: true }], Object.keys(s.ns).map(function (k) { return '<tr><th scope="row">' + esc(k) + '</th><td class="num">' + esc(U.fmtSize(s.ns[k])) + '</td></tr>'; })));
  }
  STORY.openSize = function () { Kit.ui.drawer({ title: 'Bundle size', body: function (b) { sizeBody(b); } }); };
  STORY.paintMeter = paintMeter;

  // ---------------------------------------------------------------- the engine file
  // ENGINE:STORY read back from this page's own script and written out as engine-story.js under a header. The markers
  // are built from parts so this fence never finds itself.
  var ENG = STORY.engines = { FILE: 'engine-story.js', GLOBAL: 'ENGINE_STORY', LOAD_ORDER: ['engine-render.js', 'engine-audio.js', 'engine-world.js', 'engine-story.js'] };
  ENG.markers = function () { var f = '// === ENGINE:' + 'STORY '; return [f + 'BEGIN ===', f + 'END ===']; };
  ENG.cut = function (text) {
    var mk = ENG.markers(), a = text.indexOf(mk[0]), z = text.indexOf(mk[1]);
    if (a < 0 || z < a || text.indexOf(mk[0], a + 1) >= 0) return '';
    return text.slice(a, z + mk[1].length) + '\n';
  };
  var srcCache = '';
  ENG.source = function () {
    if (srcCache) return srcCache;
    var list = document.getElementsByTagName('script');
    for (var i = 0; i < list.length; i++) { var s = ENG.cut(list[i].textContent || ''); if (s) { srcCache = s; break; } }
    return srcCache;
  };
  ENG.available = function () { return !!ENG.source(); };
  ENG.header = function (hash) {
    return '/* Story Forge ENGINE:STORY, engine version ' + ENGINE_STORY.version + '\n' +
      ' * Forge 149 (AppADay 149). Declares one global, ENGINE_STORY. No dependencies; reads no host global. */\n' +
      (hash ? '/* Bundle hash ' + hash + ' */\n' : '');
  };
  ENG.file = function (hash) { return { key: 'engine-story', name: ENG.FILE, text: ENG.header(hash) + ENG.source(), mime: 'text/javascript' }; };

  // ---------------------------------------------------------------- manifest
  var ID_SCAN = /^[a-z]{3}_[a-z0-9_]*[a-z0-9]$/;
  function scanRefs(node, out, depth) {
    if (depth > 16 || node == null) return;
    if (typeof node === 'string') { if (ID_SCAN.test(node) && Kit.ids.isValid(node)) out[node] = 1; return; }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) scanRefs(node[i], out, depth + 1); return; }
    Object.keys(node).forEach(function (k) { if (k !== 'id') scanRefs(node[k], out, depth + 1); });
  }
  STORY.manifest = function (b, hash) {
    b = b || cur();
    STORY.ensure(b);
    var created = [], counts = {}, own = {}, refs = {}, idx = Kit.index(b), s = b.story;
    STORY.PREFIXES.forEach(function (p) { var ids = Object.keys(s.records[p] || {}).sort(); counts[p] = ids.length; ids.forEach(function (id) { created.push(id); own[id] = 1; }); });
    STORY.PREFIXES.forEach(function (p) { Object.keys(s.records[p] || {}).sort().forEach(function (id) { scanRefs(s.records[p][id], refs, 0); }); });
    ['bindings', 'scaffold', 'npcDialogue', 'overrides'].forEach(function (k) { scanRefs(s[k], refs, 0); });
    var fw = STORY.forwardRefs(b);
    fw.forEach(function (f) { refs[f.id] = 1; });
    var referenced = Object.keys(refs).filter(function (id) { return !own[id]; }).sort();
    var unresolved = referenced.filter(function (id) { return !idx.byId[id]; });
    fw.forEach(function (f) { if (!f.ok && unresolved.indexOf(f.id) < 0) unresolved.push(f.id); });
    var wc = STORY.worldCheck(b);
    return {
      forge: STORY.FORGE, bundleHash: hash || '', storyVersion: s.version, generator: U.clone(s.generator), engineVersion: ENGINE_STORY.version,
      charterVersion: b.charter.version || 0, world: { version: b.world && b.world.version || null, generatorVersion: b.world && b.world.generator && b.world.generator.version || null, seed: b.world ? b.world.seed : null },
      exportedAt: U.now(), created: created, referenced: referenced, unresolved: unresolved.sort(), forward: fw, storyOpened: Kit.codex.isOpened('story', b), counts: counts,
      validation: Kit.validate.summary(Kit.validate(b)), worldCheck: { clean: !wc.length, problems: wc.map(function (p) { return p.message; }) },
      // Phase 7 fills checks and walk; Phase 8 fills the Day 150 contract.
      checks: STORY.checks ? STORY.checks.summary(b) : null, walk: STORY.checks && STORY.checks.walkStats ? STORY.checks.walkStats(b) : null, day150: STORY.day150 ? STORY.day150(b) : null,
      engines: [{ key: 'story', global: ENG.GLOBAL, file: ENG.FILE, version: ENGINE_STORY.version }], loadOrder: ENG.LOAD_ORDER.slice()
    };
  };

  // ---------------------------------------------------------------- export (forge 149)
  // Overrides the Day 146 export dialog, which belongs to forge 146. KIT:CORE text is unchanged; these are reassignments.
  // Files, in order: bundle, manifest, engine-story.js. exportFile restamps kit.contentHash without a status, so
  // forges['146'], ['147'], and ['148'] are never touched; the manifest and the engine header carry the same hash.
  function finalBlock(b) {
    var res = Kit.refreshValidation(), n = res.errors.length + res.broken.length;
    if (n) return 'Final export is blocked by ' + n + ' error' + (n === 1 ? '' : 's') + ' or broken reference' + (n === 1 ? '' : 's') + '.';
    var r = ready(b);
    if (r !== true) return 'Final export is blocked: ' + r;
    if (!STORY.canOpen(b)) return 'Final export is blocked: a side quest\'s completion flag points at a story flag that does not exist.';
    // Phase 7 replaces this with the six checks: references, story smells, the walk, the proofs, no softlock, the floor.
    if (!STORY.checks) return 'Final export is blocked: the story has not been proven yet. The reachability proof arrives in Phase 7, and Final opens the story namespace once it passes.';
    return STORY.checks.finalBlock(b);
  }
  STORY.finalBlock = finalBlock;
  Kit.buildExport = function (status, opts) {
    opts = opts || {};
    var b = cur();
    if (!b) throw new Error('No project is open.');
    STORY.ensure(b);
    if (status === 'final') {
      var why = finalBlock(b);
      if (why) throw new Error(why);
      Kit.bundle.open('story');
    } else {
      Kit.refreshValidation();
      if (!STORY.canOpen(b)) Kit.bundle.close('story');
    }
    b.story.generator = { name: STORY.GENERATOR, version: ENGINE_STORY.version };
    b.kit.forges['149'] = { status: status, exportedAt: U.now(), storyVersion: b.story.version, engineVersion: ENGINE_STORY.version, charterVersion: b.charter.version || 0,
      worldGeneratorVersion: b.world && b.world.generator && b.world.generator.version || null };
    var out = Kit.bundle.exportFile({ download: false });
    var files = [
      { key: 'bundle', name: out.filename, text: out.text, mime: 'application/json' },
      { key: 'manifest', name: Kit.bundle.slug() + '-story-manifest.json', text: JSON.stringify(STORY.manifest(cur(), out.hash), null, 2), mime: 'application/json' }
    ];
    if (opts.engines !== false && ENG.available()) files.push(ENG.file(out.hash));
    return { hash: out.hash, files: files };
  };
  function download(files) { files.forEach(function (f, i) { setTimeout(function () { U.download(f.name, f.text, f.mime); }, i * 350); }); }
  STORY.exportNow = function (status, opts) {
    try {
      var out = Kit.buildExport(status, opts);
      download(out.files);
      Kit.ui.toast('Exported ' + out.files.length + ' files (' + status + '). Hash ' + out.hash.slice(0, 12) + '.', 'ok', 6000);
      Kit.rerender();
      return out;
    } catch (e) { Kit.ui.toast(e.message, 'error', 7000); return null; }
  };
  function exportForm(host, st, onChange) {
    var b = cur(), s = Kit.validate.summary(Kit.refreshValidation()), why = finalBlock(b);
    host.appendChild(el('div', null, kv([
      ['Project', esc(b.kit.title)], ['Story version', esc(b.story.version)], ['Engine', esc(STORY.GENERATOR + ' ' + ENGINE_STORY.version)],
      ['Story records', String(STORY.count(b))],
      ['Issues', s.errors + s.broken ? chip('chip-error', s.errors + ' err') + ' ' + chip('chip-broken', s.broken + ' broken') : '<span class="chip chip-ok">' + Kit.icon('check') + 'none</span>']
    ])));
    var rc = el('div', 'radio-cards');
    if (why && st.status === 'final') st.status = 'draft';
    rc.innerHTML = '<label class="radio-card"><input type="radio" name="s9Status" value="draft"' + (st.status === 'draft' ? ' checked' : '') + '><span><strong>Draft</strong><br><span class="muted">Always allowed. Story stays closed, so Days 146 to 148 keep reading story references as forward.</span></span></label>' +
      '<label class="radio-card' + (why ? ' disabled' : '') + '"><input type="radio" name="s9Status" value="final"' + (why ? ' disabled' : '') + (st.status === 'final' ? ' checked' : '') + '><span><strong>Final</strong><br><span class="muted">' + esc(why || 'Opens the story namespace and marks forge 149 final.') + '</span></span></label>';
    Array.prototype.forEach.call(rc.querySelectorAll('input'), function (r) { r.addEventListener('change', function () { st.status = r.value; if (onChange) onChange(); }); });
    host.appendChild(rc);
    var tg = el('div', 's9-opts');
    tg.appendChild(toggle('Include engine-story.js', st.engines, function (on) { st.engines = on; if (onChange) onChange(); }));
    host.appendChild(tg);
  }
  function exportState() { return { status: 'draft', engines: true }; }
  Kit.openExport = function () {
    var st = exportState();
    Kit.ui.dialog({
      title: 'Export forge 149',
      body: function (body) { exportForm(body, st); },
      actions: [
        { label: 'Close', kind: 'ghost', value: null },
        { label: 'Download', kind: 'primary', icon: 'export', onClick: function () { if (!STORY.exportNow(st.status, { engines: st.engines })) return false; } }
      ]
    });
  };

  // ---------------------------------------------------------------- loading
  function replaceDraft(title, fn) {
    var b = cur(), empty = STORY.isEmpty(b) && !(b.kit && b.kit.forges && b.kit.forges['148']);
    var go = empty ? Promise.resolve(true) : Kit.ui.confirm({ title: title, message: 'The current working draft will be replaced. Save it to a slot or export it first if you want to keep it.', okLabel: 'Replace draft' });
    return go.then(function (ok) { if (ok) fn(); return ok; });
  }
  STORY.loadFixture = function (key) {
    return replaceDraft('Load the ' + (key === 'demo' ? 'demo' : key + ' fixture') + '?', function () { Kit.bundle.load(STORY_DEMO.fixture(key)); Kit.ui.toast('Loaded ' + (key === 'demo' ? 'the demo bundle' : 'fixture ' + key) + '.', 'ok'); });
  };
  // Copies Day 148's working draft into this forge. Day 148's copy is never written or removed.
  STORY.openDay148Draft = function () {
    return STORY.storage.day148Draft().then(function (d) {
      if (!d) { Kit.ui.toast('Day 148 has no draft in this browser.', 'warn'); return false; }
      try { Kit.bundle.migrate(d); } catch (e) { Kit.ui.toast(e.message, 'warn', 9000); return false; }
      var ok = STORY.importable(d);
      if (ok !== true) { Kit.ui.toast(ok, 'warn', 9000); return false; }
      return replaceDraft('Open the Day 148 draft?', function () { Kit.bundle.load(d); Kit.ui.toast('Opened a copy of the Day 148 draft.', 'ok'); });
    });
  };

  // ---------------------------------------------------------------- Start
  function renderStart(host) {
    var b = cur(), C = b.charter || {}, ok = ready(b) === true;
    STORY.ensure(b);
    var head = el('section', 'panel s9-hero');
    head.innerHTML = '<h2 class="panel-title">Start</h2><p class="muted">Load a Day 148 Final export or the demo. Story Forge reads the Charter, the Rules, the art, and the finished world, writes only the story namespace (and later each side quest\'s completion flag), and exports a bundle Days 146, 147, and 148 still open.</p>';
    var row = el('div', 'btn-row');
    row.appendChild(button('Load a Day 148 bundle', 'import', 'btn-primary', function () { var f = document.getElementById('fileImport'); f.value = ''; f.click(); }));
    row.appendChild(button('Load the demo', 'spark', '', function () { STORY.loadFixture('demo'); }));
    if (STORY.storage.hasDay148Draft()) {
      var od = button('Open the Day 148 draft', 'book', '', STORY.openDay148Draft);
      od.title = 'Copy the draft World Forge left in this browser into this forge';
      row.appendChild(od);
    }
    row.appendChild(button('Settings', 'gear', 'btn-ghost', Kit.settings.open));
    head.appendChild(row);
    host.appendChild(head);

    var grid = el('div', 'grid-cards s9-grid');
    host.appendChild(grid);
    var forges = b.kit.forges || {};
    var proj = el('section', 'card');
    proj.innerHTML = '<h3 class="section-h">Project</h3>' + (ok ? '' : '<p class="msg msg-warning">' + esc(ready(b)) + '</p>') + kv([
      ['Title', esc(b.kit.title)],
      ['Charter', C.locked ? chip('chip-ok', 'Locked v' + C.version) : chip('chip-muted', 'Not locked')],
      ['Forges', esc(Object.keys(forges).sort().map(function (f) { return f + ' ' + ((forges[f] || {}).status || ''); }).join(', ') || 'none')],
      ['Opened', esc((b.kit.opened || []).join(', ') || 'none')]
    ]);
    grid.appendChild(proj);

    var wc = STORY.worldCheck(b), wcard = el('section', 'card');
    wcard.appendChild(el('h3', 'section-h', 'World check'));
    if (!b.kit.forges || !b.kit.forges['148']) wcard.appendChild(el('p', 'muted', 'No Day 148 world yet. Load a World Forge Final export to begin.'));
    else {
      wcard.appendChild(el('p', null, wc.length ? chip('chip-broken', plural(wc.length, 'problem')) : chip('chip-ok', 'Clean') + ' <span class="muted">' + esc('World Forge engine ' + ENGINE_WORLD.version + ', seed ' + b.world.seed + '.') + '</span>'));
      wc.slice(0, 6).forEach(function (p) { wcard.appendChild(el('p', 'msg msg-error', esc(p.message))); });
      var W = STORY.world;
      wcard.appendChild(el('div', 's9-chips', ['reg_', 'twn_', 'dgn_', 'npc_', 'map_'].map(function (p) { return chip('chip-accent', p + ' ' + W.list(p, b).length); }).join('')));
    }
    grid.appendChild(wcard);

    var sr = b.story.records, sc = el('section', 'card');
    sc.innerHTML = '<h3 class="section-h">Story namespace</h3>' + kv([
      ['Version', esc(b.story.version)], ['Engine', esc((b.story.generator && b.story.generator.name || STORY.GENERATOR) + ' ' + ENGINE_STORY.version)],
      ['Records', String(STORY.count(b))], ['Gate bindings', String(Object.keys(b.story.bindings || {}).length)],
      ['Story opened', Kit.codex.isOpened('story') ? chip('chip-ok', 'yes') : chip('chip-muted', 'no, until a Final export')]
    ]) + '<div class="s9-chips">' + STORY.PREFIXES.map(function (p) { var n = Object.keys(sr[p] || {}).length; return chip(n ? 'chip-accent' : 'chip-muted', p + ' ' + n, STORY.TYPES[p].label); }).join('') + '</div>';
    grid.appendChild(sc);

    if (!ok && !(b.kit.forges && b.kit.forges['148'])) return;
    host.appendChild(chaptersCard(b));
    var g2 = el('div', 'grid-cards s9-grid');
    g2.appendChild(gatesCard(b));
    g2.appendChild(sideQuestsCard(b));
    g2.appendChild(endingsCard(b));
    host.appendChild(g2);
  }

  function chaptersCard(b) {
    var card = el('section', 'card s9-wide'), chs = STORY.chapters(b), floor = Number(b.story.settings.floorMinutes) || 720, total = STORY.minutes(b);
    card.appendChild(el('h3', 'section-h', 'Chapters on the golden path'));
    var regs = STORY.world.list('reg_', b), dgn = STORY.world.list('dgn_', b), twn = STORY.world.list('twn_', b);
    card.appendChild(table([{ label: 'Chapter' }, { label: 'Continent' }, { label: 'Minutes', num: true }, { label: 'Sites', num: true }, { label: 'Boss' }], chs.map(function (c) {
      var reg = regs.filter(function (r) { return r.chapter === c.id; })[0];
      var sites = dgn.concat(twn).filter(function (s) { return s.chapter === c.id; });
      var boss = dgn.filter(function (d) { return d.chapter === c.id && d.role === 'boss'; })[0];
      var bossCell = !boss ? chip('chip-muted', 'no boss dungeon') : boss.troop ? esc(nameOf(boss.troop)) + (boss.finale ? ' ' + chip('chip-accent', 'finale') : '') : chip('chip-warning', 'empty slot', 'Day 148 left this boss slot empty; the story fills it with a boss event (Phase 5).');
      return '<tr><th scope="row">' + esc(c.name || c.id) + (reg ? '<small class="s9-sub">' + esc(reg.name) + '</small>' : '') + '</th><td>' + esc(c.continentLabel || 'Default') + '</td><td class="num">' + esc(c.targetMinutes || 0) + '</td><td class="num">' + sites.length + '</td><td>' + bossCell + '</td></tr>';
    })));
    var okFloor = total >= floor;
    card.appendChild(el('p', null, chip(okFloor ? 'chip-ok' : 'chip-warning', (total / 60).toFixed(1) + ' hours of main story') + ' <span class="muted">' + esc(okFloor
      ? 'The chapters reach the ' + (floor / 60) + ' hour floor. Side and B story quests are counted separately and never toward it.'
      : 'Short of the ' + (floor / 60) + ' hour floor by ' + (floor - total) + ' minutes. Raise chapter target minutes in Saga Forge (Day 146); Phase 6 makes this an error that blocks a Final.') + '</span>'));
    return card;
  }
  var GATE_LABEL = { chapter: 'Chapter keys', seal: 'Seals', ship: 'Ship', airship: 'Airship', other: 'Other' };
  function gatesCard(b) {
    var card = el('section', 'card'), keys = STORY.world.gateKeys(b), by = {}, order = {};
    STORY.chapters(b).forEach(function (c, i) { order[c.id] = i; });
    card.appendChild(el('h3', 'section-h', 'Gate keys to bind'));
    keys.forEach(function (k) { var g = ENGINE_STORY.gates.parse(k); (by[g.kind] = by[g.kind] || []).push(g); });
    Object.keys(by).forEach(function (k) { by[k].sort(function (x, y) { return (order[x.chapter] || 0) - (order[y.chapter] || 0); }); });
    card.appendChild(el('p', 'muted', esc('Day 148\'s progression names ' + plural(keys.length, 'world local gate key') + '. Phase 2 binds each one to a story flag, so every gate in Day 150 reads the story\'s state.')));
    card.appendChild(el('div', null, kv(['chapter', 'seal', 'ship', 'airship', 'other'].filter(function (k) { return by[k]; }).map(function (k) {
      return [GATE_LABEL[k], by[k].map(function (g) { return chip(k === 'other' ? 'chip-warning' : 'chip-muted', g.chapter ? chName(g.chapter) : g.key, g.key); }).join(' ')];
    }))));
    var empty = STORY.world.emptyBossSlots(b);
    if (empty.length) card.appendChild(el('p', 'msg msg-warning', esc(plural(empty.length, 'boss dungeon') + ' with an empty troop slot: ' + empty.map(function (d) { return chName(d.chapter); }).join(', ') + '. The story fills them from its side, never by editing the world.')));
    return card;
  }
  function sideQuestsCard(b) {
    var card = el('section', 'card'), qs = STORY.rules('sdq_', b);
    card.appendChild(el('h3', 'section-h', 'Side quests'));
    if (!qs.length) { card.appendChild(el('div', 'empty-line', 'No side quest seeds in the Rules.')); return card; }
    card.appendChild(table([{ label: 'Quest' }, { label: 'Giver' }, { label: 'Completion flag' }], qs.map(function (q) {
      var fl = q.flag ? (STORY.records.get(q.flag, b) ? esc(nameOf(q.flag)) : chip('chip-broken', q.flag)) : chip('chip-muted', 'Phase 2 fills');
      return '<tr><th scope="row">' + esc(q.name || q.id) + '<small class="s9-sub">' + esc(chName(q.chapter)) + '</small></th><td>' + esc(nameOf(q.giver, 'none')) + '</td><td>' + fl + '</td></tr>';
    })));
    return card;
  }
  function endingsCard(b) {
    var card = el('section', 'card'), es = STORY.endings(b);
    card.appendChild(el('h3', 'section-h', 'Endings'));
    if (!es.length) { card.appendChild(el('p', 'msg msg-warning', 'The Charter lists no endings. Phase 6 needs at least one, with exactly one fallback.')); return card; }
    card.appendChild(el('ol', 's9-endings', es.map(function (e) { return '<li><strong>' + esc(e.name || 'Untitled') + '</strong> <span class="muted">' + esc(e.concept || '') + '</span></li>'; }).join('')));
    card.appendChild(el('p', 'muted', esc('Phase 6 gives each Charter ending an end_ record in list order, a condition, and a priority; exactly one is the fallback.')));
    return card;
  }

  // ---------------------------------------------------------------- Validation and Export
  function validationPanel(host) {
    var b = cur(), res = Kit.refreshValidation(), s = Kit.validate.summary(res), why = finalBlock(b), wc = STORY.worldCheck(b);
    var p = el('section', 'panel s9-val');
    p.appendChild(el('h3', 'section-h', 'Validation'));
    p.appendChild(el('p', null, chip(s.errors ? 'chip-error' : 'chip-ok', plural(s.errors, 'error')) + ' ' + chip(s.broken ? 'chip-broken' : 'chip-ok', s.broken + ' broken') + ' ' +
      chip(s.forward ? 'chip-forward' : 'chip-muted', s.forward + ' forward') + ' ' + chip(s.warnings ? 'chip-warning' : 'chip-muted', plural(s.warnings, 'warning')) + ' ' + chip(wc.length ? 'chip-broken' : 'chip-ok', wc.length ? 'World: ' + plural(wc.length, 'problem') : 'World clean')));
    p.appendChild(el('p', 's9-final ' + (why ? 'msg msg-warning' : 'msg s9-ok'), esc(why || 'Ready for a Final export.')));
    var items = res.errors.concat(res.broken, res.warnings).slice(0, 8);
    if (items.length) {
      var list = el('div', 's9-issues');
      items.forEach(function (it) {
        var row = el('div', 's9-issue');
        row.appendChild(el('div', 's9-issue-text', chip(it.level === 'broken' ? 'chip-broken' : it.level === 'warning' ? 'chip-warning' : 'chip-error', it.level) + ' <span>' + esc(nameOf(it.recordId, it.recordId) + ': ' + it.message) + '</span>'));
        if (Kit.jump.can && Kit.jump.can(it.recordId)) row.appendChild(button('Jump', 'jump', 'btn-ghost', function () { Kit.jump(it.recordId, it.fieldPath); }));
        list.appendChild(row);
      });
      p.appendChild(list);
    }
    p.appendChild(el('p', 'muted', 'Phase 7 adds the story checks here as pass or fail cards: references, story smells, the reachability walk, the proofs, no softlock, and the 12 hour floor.'));
    var r = el('div', 'btn-row');
    r.appendChild(button('Check again', 'check', '', function () { Kit.refreshValidation(); Kit.rerender(); }));
    r.appendChild(button('Open the validation panel', 'warn', 'btn-ghost', Kit.openValidation));
    p.appendChild(r);
    host.appendChild(p);
  }
  function renderExport(host) {
    var head = el('section', 'panel');
    head.innerHTML = '<h2 class="panel-title">Validation and Export</h2><p class="muted">Export the bundle, its forge 149 manifest, and engine-story.js. Days 146, 147, and 148 open the bundle unchanged. A Final export opens the story namespace for Day 150.</p>';
    host.appendChild(head);
    validationPanel(host);
    var st = STORY.exportUi = STORY.exportUi || exportState();
    var p = el('section', 'panel');
    p.appendChild(el('h3', 'section-h', 'Export the bundle'));
    exportForm(p, st, function () { Kit.rerender(); });
    p.appendChild(button('Download', 'export', 'btn-primary', function () { STORY.exportNow(st.status, { engines: st.engines }); }));
    host.appendChild(p);
    var m = el('section', 'panel'), man = STORY.manifest(cur(), '');
    m.appendChild(el('h3', 'section-h', 'Manifest preview'));
    m.appendChild(el('div', null, kv([['Created', man.created.length + ' story IDs'], ['Referenced', man.referenced.length + ' IDs'],
      ['Unresolved', man.unresolved.length ? chip('chip-broken', String(man.unresolved.length)) : chip('chip-ok', '0')],
      ['Engine', esc(ENG.FILE + ' ' + ENGINE_STORY.version)], ['Day 150 loads', esc(ENG.LOAD_ORDER.join(', '))]])));
    host.appendChild(m);
    var z = el('section', 'panel');
    z.appendChild(el('h3', 'section-h', 'Size'));
    sizeBody(z);
    host.appendChild(z);
  }
  STORY.jumpStory = function () { return Kit.go('export'); };

  function renderDev(host) {
    var p = el('section', 'panel');
    p.innerHTML = '<h2 class="panel-title">Developer</h2><p class="muted">Fixtures are real Day 148 Final exports. Loading one replaces the working draft.</p>';
    var list = el('div', 's9-fixtures');
    STORY_DEMO.FIXTURES.forEach(function (fx) {
      var row = el('div', 'slot-row');
      row.appendChild(el('div', 'slot-info', '<strong>' + esc(fx.label) + '</strong><small>' + esc(fx.purpose) + '</small>'));
      row.appendChild(button('Load', null, '', function () { STORY.loadFixture(fx.key); }));
      list.appendChild(row);
    });
    p.appendChild(list);
    host.appendChild(p);
  }

  // ---------------------------------------------------------------- tabs that arrive in later phases
  var LATER = [
    ['flags', 'Flags', 'key', 'Every story flag with who reads and who sets it, and the table binding each Day 148 gate key to a flag, unbound keys first.', 'Phase 2'],
    ['quests', 'Quests', 'scroll', 'Main, side, and B story quests as state machines: stages left to right, exclusive branches fanning out, failure in red, and a stage editor.', 'Phase 3'],
    ['dialogue', 'Dialogue', 'book', 'Dialogue graphs per speaker with a node list, a graph, a line editor, a preview runner, and optional drafting with Claude.', 'Phase 4'],
    ['events', 'Events', 'spark', 'Events and cutscenes as nested command lists, with a text playtester, a live flag and quest inspector, and Win and Lose for battles.', 'Phase 5']
  ];

  // ---------------------------------------------------------------- mount
  Kit.mount('start', { title: 'Start', icon: 'scroll', canEnter: function () { return true; }, render: renderStart });
  LATER.forEach(function (t) {
    var real = STORY.WS && STORY.WS[t[0]];
    Kit.mount(t[0], { title: t[1], icon: t[2], canEnter: ready, focus: real && real.focus, onLeave: real && real.onLeave,
      render: real ? real.render : function (h) { h.appendChild(Kit.ui.stub({ title: t[1], lead: t[3], status: 'Arrives in ' + t[4] + '.', icon: t[2] })); } });
  });
  Kit.mount('export', { title: 'Validation and Export', icon: 'check', canEnter: ready, render: renderExport });
  if (DEV) Kit.mount('dev', { title: 'Dev', icon: 'gear', canEnter: function () { return true; }, render: renderDev });
  Kit.on('change', meterSoon);
  Kit.on('load', function () { paintMeter(); });
})();
// === WS:STORY149 END ===
