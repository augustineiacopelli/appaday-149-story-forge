// === WS:DIALOGUE BEGIN ===
(function () {
  'use strict';
  // The Dialogue tab. Two views: Dialogues (every dlg_ record: a node list, a hand built SVG graph, a line editor, and a preview
  // runner that drives the real engine) and People (the page list that picks which dialogue each townsperson says, by condition).
  // Logic lives in STORY.dialogue (src/story-dialogue.js) and ENGINE_STORY.dlg; conditions use STORY.condUI (src/ws-cond.js).
  var U = Kit.util, el = U.el, esc = U.esc, D = STORY.dialogue, ES = ENGINE_STORY, SVGNS = 'http://www.w3.org/2000/svg';
  function cur() { return Kit.bundle.current(); }
  function UI() { return STORY.ui; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function nameOf(id, fb) { return STORY.nameOf ? STORY.nameOf(id, fb) : (fb || id || ''); }
  function chName(id) { var c = STORY.chapters().filter(function (x) { return x.id === id; })[0]; return c ? c.name || id : id; }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 3) + '...' : s; }
  var st = STORY.dialogueUi = { view: 'dialogues', filter: 'all', open: {}, node: {}, focus: null, people: '', pOpen: {}, pv: { chapter: '', quests: {}, from: 'start', log: [], run: null } };
  var FILTERS = [['all', 'All'], ['quest', 'Quests'], ['role', 'Greetings'], ['custom', 'Yours']];

  function redraw() {
    var host = document.getElementById('ws'), top = host ? host.scrollTop : 0, win = window.pageYOffset || 0;
    Kit.rerender();
    var h2 = document.getElementById('ws');
    if (h2) h2.scrollTop = top;
    if (win > 0) window.scrollTo(0, win);
  }
  function problemText(res) { return (res.problems || []).map(function (p) { return p.message; }).join(' ') || res.message || 'That change was not saved.'; }
  function done(res, ok) { if (!res.ok) { Kit.ui.toast(problemText(res), 'warn', 5000); return false; } if (ok) Kit.ui.toast(ok, 'ok'); return true; }
  function field(label, input, help) {
    var f = el('div', 'field'), l = el('label', 'field-label', esc(label));
    f.appendChild(l); f.appendChild(input);
    if (help) f.appendChild(el('div', 'field-help', esc(help)));
    return f;
  }
  function textInput(value, label, max) {
    var i = el('input', 'inp'); i.type = 'text'; i.value = value || ''; i.maxLength = max || 160; i.setAttribute('aria-label', label);
    return i;
  }
  function selectOf(options, value, label) {
    var s = el('select', 'inp'); s.setAttribute('aria-label', label);
    options.forEach(function (o) { var op = el('option', null, esc(o[1])); op.value = o[0]; s.appendChild(op); });
    s.value = value;
    return s;
  }
  function pickBtn(label, id, empty, prefix, title, onPick) {
    var b = el('button', 'btn dg-pick' + (id ? '' : ' dg-empty'), esc(id ? nameOf(id, id) : empty)); b.type = 'button';
    b.addEventListener('click', function () { Kit.ui.pickRef({ prefix: prefix, title: title, current: id }).then(function (v) { if (v) { onPick(v); b.textContent = nameOf(v, v); b.classList.remove('dg-empty'); } }); });
    b.setAttribute('aria-label', label);
    return b;
  }
  // Commits a text field when it loses focus or Enter is pressed, and only when the value changed.
  function onCommit(inp, was, fn) {
    var last = was;
    function go() { if (inp.value !== last) { last = inp.value; fn(inp.value); } }
    inp.addEventListener('change', go);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && inp.tagName !== 'TEXTAREA') { e.preventDefault(); go(); } });
  }

  // ---------------------------------------------------------------- the node graph
  function s(tag, attrs, text) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, String(attrs[k])); });
    if (text !== undefined) n.textContent = text;
    return n;
  }
  var NW = 150, NH = 54, GX = 40, GY = 34, PAD = 16;
  // Layers by breadth first distance from start; unreachable nodes go in a last row. Returns {pos {key: {x, y}}, w, h}.
  function layout(rec) {
    var keys = Object.keys(rec.nodes || {}).sort(), edges = ES.dlg.edges(rec), depth = {}, q = [], pos = {};
    if (rec.nodes && rec.nodes[rec.start]) { depth[rec.start] = 0; q.push(rec.start); }
    var from = {};
    edges.forEach(function (e) { (from[e.from] = from[e.from] || []).push(e.to); });
    while (q.length) { var k = q.shift(); (from[k] || []).forEach(function (t) { if (depth[t] === undefined && rec.nodes[t]) { depth[t] = depth[k] + 1; q.push(t); } }); }
    var maxD = 0; Object.keys(depth).forEach(function (k) { if (depth[k] > maxD) maxD = depth[k]; });
    keys.forEach(function (k) { if (depth[k] === undefined) depth[k] = maxD + 1; });
    var cols = {}; keys.forEach(function (k) { (cols[depth[k]] = cols[depth[k]] || []).push(k); });
    var w = PAD, h = PAD, tall = 0;
    Object.keys(cols).forEach(function (d) {
      cols[d].forEach(function (k, i) { pos[k] = { x: PAD + Number(d) * (NW + GX), y: PAD + i * (NH + GY) }; });
      tall = Math.max(tall, cols[d].length);
      w = Math.max(w, PAD + (Number(d) + 1) * (NW + GX));
    });
    h = PAD * 2 + tall * (NH + GY) - GY;
    return { pos: pos, w: Math.max(w, 200), h: Math.max(h, NH + PAD * 2) };
  }
  function graph(rec, selKey, onPick) {
    var L = layout(rec), svg = s('svg', { 'class': 'dg-svg', width: L.w, height: L.h, viewBox: '0 0 ' + L.w + ' ' + L.h, role: 'img', 'aria-label': 'Graph of ' + (rec.name || 'dialogue') + ' with ' + plural(Object.keys(rec.nodes || {}).length, 'node') });
    var defs = s('defs'), mk = s('marker', { id: 'dgA', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    mk.appendChild(s('path', { d: 'M0 0L10 5L0 10z', 'class': 'dg-arrow' })); defs.appendChild(mk); svg.appendChild(defs);
    var reach = ES.dlg.reach(rec), dead = {}; reach.unreachable.forEach(function (k) { dead[k] = 1; });
    ES.dlg.edges(rec).forEach(function (e) {
      var a = L.pos[e.from], z = L.pos[e.to];
      if (!a || !z) return;
      var x1 = a.x + NW, y1 = a.y + NH / 2, x2 = z.x, y2 = z.y + NH / 2, back = z.x <= a.x;
      var d;
      if (e.from === e.to) d = 'M' + (a.x + NW - 10) + ' ' + a.y + ' C' + (a.x + NW - 10) + ' ' + (a.y - 22) + ' ' + (a.x + 10) + ' ' + (a.y - 22) + ' ' + (a.x + 10) + ' ' + a.y;
      else if (back) { var my = Math.max(a.y, z.y) + NH + 14; d = 'M' + (a.x + NW / 2) + ' ' + (a.y + NH) + ' C' + (a.x + NW / 2) + ' ' + my + ' ' + (z.x + NW / 2) + ' ' + my + ' ' + (z.x + NW / 2) + ' ' + (z.y + NH); }
      else { var mx = (x1 + x2) / 2; d = 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2; }
      svg.appendChild(s('path', { d: d, 'class': 'dg-edge' + (e.kind === 'choice' ? ' dg-edge-choice' : ''), 'marker-end': 'url(#dgA)' }));
    });
    Object.keys(L.pos).forEach(function (k) {
      var p = L.pos[k], n = rec.nodes[k] || {}, g = s('g', { 'class': 'dg-node' + (k === selKey ? ' sel' : '') + (dead[k] ? ' dead' : ''), tabindex: 0, role: 'button', 'aria-label': 'Node ' + k + (k === rec.start ? ', start' : '') + (dead[k] ? ', unreachable' : '') });
      g.appendChild(s('rect', { x: p.x, y: p.y, width: NW, height: NH, rx: 8, 'class': 'dg-box' }));
      g.appendChild(s('text', { x: p.x + 10, y: p.y + 18, 'class': 'dg-key' }, (k === rec.start ? '> ' : '') + cut(k, 20)));
      g.appendChild(s('text', { x: p.x + 10, y: p.y + 34, 'class': 'dg-line' }, cut(Array.isArray(n.lines) && n.lines.length ? n.lines[0] : '(no lines)', 22)));
      var tail = Array.isArray(n.choices) && n.choices.length ? plural(n.choices.length, 'choice') : n.next ? 'next: ' + cut(n.next, 14) : 'ends';
      g.appendChild(s('text', { x: p.x + 10, y: p.y + 48, 'class': 'dg-tail' }, tail));
      function pick() { onPick(k); }
      g.addEventListener('click', pick);
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      svg.appendChild(g);
    });
    var sc = el('div', 'dg-scroll'); sc.appendChild(svg);
    return sc;
  }

  // ---------------------------------------------------------------- effects (the commands on a node or choice)
  var OPS = [['setFlag', 'Set a flag'], ['addFlag', 'Add to a flag'], ['giveItem', 'Give an item'], ['takeItem', 'Take an item'], ['gil', 'Gil'], ['questStage', 'Quest stage'], ['party', 'Party member']];
  var EDITABLE = {}; OPS.forEach(function (o) { EDITABLE[o[0]] = 1; });
  function cmdText(c) {
    if (!U.isObj(c)) return 'Unreadable command';
    switch (c.op) {
      case 'setFlag': return 'Set ' + nameOf(c.flg, c.flg || '?') + ' to ' + (c.value === undefined ? 1 : c.value);
      case 'addFlag': return 'Add ' + (c.by === undefined ? 1 : c.by) + ' to ' + nameOf(c.flg, c.flg || '?');
      case 'giveItem': return 'Give ' + (c.qty || 1) + ' ' + nameOf(c.itm, c.itm || '?');
      case 'takeItem': return 'Take ' + (c.qty || 1) + ' ' + nameOf(c.itm, c.itm || '?');
      case 'gil': return (c.by < 0 ? 'Take ' + (-c.by) : 'Give ' + c.by) + ' gil';
      case 'questStage': return c.fail ? 'Fail ' + nameOf(c.qst, c.qst || '?') : c.stage !== undefined ? nameOf(c.qst, c.qst || '?') + ' moves to stage ' + c.stage : nameOf(c.qst, c.qst || '?') + ' branch ' + c.branch;
      case 'party': return nameOf(c.chr, c.chr || '?') + (c.act === 'leave' ? ' leaves the party' : ' joins the party');
      default: return 'Command ' + c.op + ' (edit it in Events, Phase 5)';
    }
  }
  function newCmd(op, pick) {
    switch (op) {
      case 'setFlag': return { op: op, flg: pick.ref, value: Math.round(Number(pick.num)) || 1 };
      case 'addFlag': return { op: op, flg: pick.ref, by: Math.round(Number(pick.num)) || 1 };
      case 'giveItem': case 'takeItem': return { op: op, itm: pick.ref, qty: Math.max(1, Math.round(Number(pick.num)) || 1) };
      case 'gil': return { op: op, by: Math.round(Number(pick.num)) || 100 };
      case 'questStage': return { op: op, qst: pick.ref, stage: pick.stage };
      case 'party': return { op: op, chr: pick.ref, act: pick.act || 'join' };
    }
    return null;
  }
  var PFX = { setFlag: 'flg_', addFlag: 'flg_', giveItem: ['itm_', 'eqp_'], takeItem: ['itm_', 'eqp_'], questStage: 'qst_', party: 'chr_' };
  function addCmdForm(host, onAdd) {
    var op = selectOf(OPS, 'setFlag', 'Kind of effect'), box = el('div', 'dg-addrow'), pick = { ref: null, num: 1, stage: null, act: 'join' };
    function paint() {
      U.clear(box);
      var o = op.value;
      if (PFX[o]) {
        box.appendChild(pickBtn('Choose', pick.ref, 'Choose...', PFX[o], 'Choose', function (v) { pick.ref = v; pick.stage = null; if (o === 'questStage') paint(); }));
      }
      if (o === 'questStage' && pick.ref) {
        var def = STORY.records.get ? STORY.records.get(pick.ref) : null, stages = def && Array.isArray(def.stages) ? def.stages : [];
        var sel = selectOf(stages.map(function (x) { return [x.key, x.label || x.key]; }), pick.stage || (stages[0] && stages[0].key) || '', 'Stage');
        pick.stage = sel.value; sel.addEventListener('change', function () { pick.stage = sel.value; });
        box.appendChild(sel);
      }
      if (o === 'party') { var a = selectOf([['join', 'Joins'], ['leave', 'Leaves']], pick.act, 'Joins or leaves'); a.addEventListener('change', function () { pick.act = a.value; }); box.appendChild(a); }
      if (o === 'setFlag' || o === 'addFlag' || o === 'giveItem' || o === 'takeItem' || o === 'gil') {
        var n = el('input', 'inp dg-num'); n.type = 'number'; n.value = pick.num; n.setAttribute('aria-label', 'Amount'); n.addEventListener('input', function () { pick.num = n.value; });
        box.appendChild(n);
      }
      box.appendChild(UI().button('Add', 'plus', '', function () {
        if (PFX[o] && !pick.ref) { Kit.ui.toast('Choose what the effect applies to first.', 'warn'); return; }
        var c = newCmd(o, pick); if (c) onAdd(c);
      }));
    }
    op.addEventListener('change', function () { pick.ref = null; pick.stage = null; paint(); });
    host.appendChild(op); host.appendChild(box); paint();
  }
  // A list of commands: each shown as a sentence with remove and move. Commands the tab cannot edit stay as they are.
  function cmdList(cmds, onChange) {
    var wrap = el('div', 'dg-cmds'), list = Array.isArray(cmds) ? cmds : [];
    if (!list.length) wrap.appendChild(el('p', 'muted dg-none', 'No effects.'));
    list.forEach(function (c, i) {
      var row = el('div', 'dg-cmd'), t = el('span', 'dg-cmd-t' + (U.isObj(c) && EDITABLE[c.op] ? '' : ' muted'), esc(cmdText(c)));
      row.appendChild(t);
      var bar = el('span', 'dg-cmd-b');
      [['Up', -1], ['Down', 1]].forEach(function (m) {
        var b = el('button', 'btn btn-ghost dg-mini', esc(m[0])); b.type = 'button'; b.disabled = i + m[1] < 0 || i + m[1] >= list.length;
        b.setAttribute('aria-label', 'Move effect ' + m[0].toLowerCase());
        b.addEventListener('click', function () { var n = clone(list), t2 = n[i]; n[i] = n[i + m[1]]; n[i + m[1]] = t2; onChange(n); });
        bar.appendChild(b);
      });
      var rm = el('button', 'btn btn-ghost dg-mini', 'Remove'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove effect');
      rm.addEventListener('click', function () { var n = clone(list); n.splice(i, 1); onChange(n); });
      bar.appendChild(rm); row.appendChild(bar); wrap.appendChild(row);
    });
    var add = el('details', 'dg-add'); add.appendChild(el('summary', null, 'Add an effect'));
    var inner = el('div', 'dg-add-in'); add.appendChild(inner);
    addCmdForm(inner, function (c) { var n = clone(list); n.push(c); onChange(n); });
    wrap.appendChild(add);
    return wrap;
  }

  // ---------------------------------------------------------------- the node editor
  function nodeOptions(rec, withNone) {
    var o = withNone ? [['', 'Ends here']] : [];
    Object.keys(rec.nodes || {}).sort().forEach(function (k) { o.push([k, k]); });
    return o;
  }
  function speakerRow(rec, key, n) {
    var row = el('div', 'dg-pickrow');
    row.appendChild(pickBtn('Speaker of this node', n.speaker && /^[a-z]{3}_/.test(n.speaker) ? n.speaker : '', n.speaker && !/^[a-z]{3}_/.test(n.speaker) ? n.speaker : (rec.speaker ? 'Dialogue speaker' : 'The person talked to'), ['chr_', 'npc_'], 'Who speaks', function (v) { done(D.updateNode(rec.id, key, { speaker: v }), null); }));
    if (n.speaker) row.appendChild(UI().button('Use default', null, 'btn-ghost', function () { if (done(D.updateNode(rec.id, key, { speaker: null }))) redraw(); }));
    return row;
  }
  function nodeEditor(rec, key) {
    var n = rec.nodes[key], box = el('div', 'dg-edit');
    var head = el('div', 'dg-edit-h'); head.appendChild(el('h4', 'dg-edit-t', 'Node ' + esc(key) + (rec.start === key ? ' (start)' : '')));
    box.appendChild(head);
    var kb = el('div', 'btn-row');
    kb.appendChild(UI().button('Rename', 'edit', 'btn-ghost', function () {
      Kit.ui.prompt({ title: 'Rename node', label: 'Node key', value: key, okLabel: 'Rename', validate: function (v) { return D.KEY_RE.test(v.trim()) ? null : 'Lowercase letters, digits, and underscores, starting with a letter.'; } }).then(function (v) {
        if (v === null || v === undefined) return;
        var r = D.renameNode(rec.id, key, v.trim()); if (done(r)) { st.node[rec.id] = v.trim(); redraw(); }
      });
    }));
    if (rec.start !== key) kb.appendChild(UI().button('Make start', null, 'btn-ghost', function () { if (done(D.setStart(rec.id, key))) redraw(); }));
    if (rec.start !== key) kb.appendChild(UI().button('Delete node', 'trash', 'btn-danger', function () {
      Kit.ui.confirm({ title: 'Delete node ' + key + '?', okLabel: 'Delete node', message: 'Links that led here are cut.' }).then(function (ok) { if (!ok) return; var r = D.removeNode(rec.id, key); if (done(r)) { st.node[rec.id] = rec.start; redraw(); } });
    }));
    box.appendChild(kb);
    box.appendChild(field('Speaker', speakerRow(rec, key, n), 'Left alone, the node uses the dialogue speaker, or the person being talked to.'));
    var ta = el('textarea', 'inp dg-lines'); ta.rows = Math.max(3, (n.lines || []).length + 1); ta.value = (n.lines || []).join('\n'); ta.setAttribute('aria-label', 'Lines');
    onCommit(ta, ta.value, function (v) { var lines = v.split('\n').map(function (l) { return l.trim(); }).filter(Boolean); if (done(D.updateNode(rec.id, key, { lines: lines }))) redraw(); });
    var lf = field('Lines (one text box each)', ta, 'Keep a line under ' + D.LONG_LINE + ' characters so it fits the box.');
    var dr = UI().button('Draft with Claude', 'spark', 'btn-ghost', function () { D.draft(rec.id, key, { onAccept: redraw }); });
    if (!Kit.ai.hasKey()) { dr.disabled = true; dr.title = 'Add your Claude API key in Settings to draft lines.'; }
    lf.appendChild(dr);
    if (!Kit.ai.hasKey()) lf.appendChild(el('div', 'field-help', 'Drafting needs a Claude API key. Add one in Settings.'));
    box.appendChild(lf);
    var pr = textInput(n.prompt || '', 'Prompt shown above the choices', 160); onCommit(pr, pr.value, function (v) { if (done(D.updateNode(rec.id, key, { prompt: v.trim() || null }))) redraw(); });
    var hasCh = Array.isArray(n.choices) && n.choices.length;
    if (hasCh) box.appendChild(field('Question above the choices', pr));
    box.appendChild(el('h5', 'dg-sub', 'Effects when the node runs'));
    box.appendChild(cmdList(n.cmds, function (c) { if (done(D.updateNode(rec.id, key, { cmds: c }))) redraw(); }));
    box.appendChild(el('h5', 'dg-sub', 'What comes next'));
    var mode = selectOf([['end', 'Ends here'], ['next', 'Goes to another node'], ['choices', 'Offers choices']], hasCh ? 'choices' : n.next ? 'next' : 'end', 'What comes next');
    mode.addEventListener('change', function () {
      var r;
      if (mode.value === 'end') r = D.updateNode(rec.id, key, { next: null, choices: [] });
      else if (mode.value === 'next') { var o = nodeOptions(rec).filter(function (x) { return x[0] !== key; })[0]; r = o ? D.updateNode(rec.id, key, { next: o[0], choices: [] }) : { ok: false, message: 'Add another node first.' }; }
      else r = D.addChoice(rec.id, key, { text: 'Continue' });
      if (done(r)) redraw(); else mode.value = hasCh ? 'choices' : n.next ? 'next' : 'end';
    });
    box.appendChild(mode);
    if (n.next && !hasCh) {
      var ns = selectOf(nodeOptions(rec), n.next, 'Next node'); ns.addEventListener('change', function () { if (done(D.updateNode(rec.id, key, { next: ns.value }))) redraw(); });
      box.appendChild(field('Next node', ns));
    }
    if (hasCh) {
      n.choices.forEach(function (c, i) {
        var cb = el('div', 'dg-choice'), top = el('div', 'dg-choice-h', 'Choice ' + (i + 1));
        cb.appendChild(top);
        var tx = textInput(c.text || '', 'Choice text', 80); onCommit(tx, tx.value, function (v) { if (done(D.updateChoice(rec.id, key, i, { text: v.trim() || 'A choice' }))) redraw(); });
        cb.appendChild(field('Text', tx));
        var nx = selectOf(nodeOptions(rec, true), c.next || '', 'Where this choice leads'); nx.addEventListener('change', function () { if (done(D.updateChoice(rec.id, key, i, { next: nx.value || null }))) redraw(); });
        cb.appendChild(field('Leads to', nx));
        var ch = el('div', 'dg-cond'); cb.appendChild(field('Only shown when', ch, 'No condition means the choice always shows.'));
        STORY.condUI.mount(ch, c.cond === undefined ? null : c.cond, function (t) { var r = D.updateChoice(rec.id, key, i, { cond: t === null ? null : t }); if (!r.ok) done(r); }, { nullable: true, emptyText: 'Always shown.', addLabel: 'Add a condition' });
        cb.appendChild(el('h5', 'dg-sub', 'Effects when chosen'));
        cb.appendChild(cmdList(c.cmds, function (cm) { if (done(D.updateChoice(rec.id, key, i, { cmds: cm }))) redraw(); }));
        var rb = el('div', 'btn-row');
        rb.appendChild(UI().button('Move up', null, 'btn-ghost', function () { if (done(D.moveChoice(rec.id, key, i, -1))) redraw(); }));
        rb.appendChild(UI().button('Move down', null, 'btn-ghost', function () { if (done(D.moveChoice(rec.id, key, i, 1))) redraw(); }));
        rb.appendChild(UI().button('Remove choice', 'trash', 'btn-danger', function () { if (done(D.removeChoice(rec.id, key, i))) redraw(); }));
        cb.appendChild(rb);
        box.appendChild(cb);
      });
      box.appendChild(UI().button('Add a choice', 'plus', '', function () { if (done(D.addChoice(rec.id, key, { text: 'Another choice' }))) redraw(); }));
    }
    return box;
  }

  // ---------------------------------------------------------------- the preview runner
  function chapterOptions() { return [['', 'Start of the game']].concat(STORY.chapters().map(function (c) { return [c.id, c.name || c.id]; })); }
  function pvOpts() { var o = { chapter: st.pv.chapter || null, quests: {} }; Object.keys(st.pv.quests).forEach(function (q) { o.quests[q] = st.pv.quests[q]; }); return o; }
  function effectLine(e) {
    if (!e) return null;
    switch (e.kind) {
      case 'text': return { cls: 'say', who: e.speaker ? nameOf(e.speaker, e.speaker) : '', text: (e.lines || []).join(' ') };
      case 'questStage': return { cls: 'fx', text: e.fail ? 'Quest failed: ' + nameOf(e.qst, e.qst) : 'Quest ' + nameOf(e.qst, e.qst) + (e.label ? ' now at ' + e.label : '') + (e.changed ? '' : ' (no change)') };
      case 'gil': return { cls: 'fx', text: 'Gil ' + (e.by >= 0 ? '+' : '') + e.by };
      case 'party': return { cls: 'fx', text: nameOf(e.chr, e.chr) + (e.act === 'leave' ? ' left the party' : ' joined the party') };
      case 'item': case 'giveItem': case 'takeItem': return { cls: 'fx', text: (e.kind === 'takeItem' ? 'Lost ' : 'Got ') + (e.qty || 1) + ' ' + nameOf(e.itm, e.itm || 'an item') };
      case 'error': return { cls: 'err', text: 'Error: ' + (e.message || e.code) };
      case 'end': return { cls: 'fx', text: 'End of conversation.' + (Array.isArray(e.quests) && e.quests.length ? ' Quests settled: ' + e.quests.length : '') };
      case 'none': return { cls: 'fx', text: 'Nothing to say yet: no page passes for this person right now.' };
      case 'idle': return null;
      default: return { cls: 'fx', text: 'Effect: ' + e.kind };
    }
  }
  // Runs from a result r until it needs the reader (a choice), appending to the log.
  function advance(r, idx) {
    var pv = st.pv;
    for (var n = 0; n < 400; n++) {
      var ln = effectLine(r.effect); if (ln) pv.log.push(ln);
      pv.run = { state: r.state, cursor: r.cursor, idx: idx, waiting: r.waiting, options: r.waiting === 'choice' && r.effect ? r.effect.options : null, prompt: r.effect && r.effect.prompt, done: !!r.done };
      if (r.done) return;
      if (r.waiting === 'choice') return;
      if (r.waiting === 'battle') { pv.log.push({ cls: 'fx', text: 'A battle starts here (not played in the previewer).' }); pv.run.done = true; return; }
      r = ES.dlg.step(r.state, r.cursor, idx);
    }
    pv.log.push({ cls: 'err', text: 'Stopped after 400 steps.' }); pv.run.done = true;
  }
  function startPreview(dlgId, node) {
    var pv = st.pv, b = cur(), idx = D.playIndex(b), state = D.previewState(b, pvOpts());
    pv.log = []; pv.run = null;
    advance(ES.dlg.begin(state, dlgId, idx, node ? { node: node } : null), idx);
  }
  function talkPreview(npc) {
    var pv = st.pv, b = cur(), idx = D.playIndex(b), state = D.previewState(b, pvOpts());
    pv.log = []; pv.run = null;
    var r = ES.dlg.talk(state, npc, idx);
    if (r.page >= 0) pv.log.push({ cls: 'fx', text: 'Page ' + (r.page + 1) + ' was picked.' });
    advance(r, idx);
  }
  function previewPanel(host, subject) {
    var pv = st.pv, b = cur(), box = el('div', 'dg-pv');
    box.appendChild(el('h4', 'dg-edit-t', 'Preview'));
    var row = el('div', 'dg-pvrow');
    var ch = selectOf(chapterOptions(), pv.chapter, 'Chapter to preview in'); ch.addEventListener('change', function () { pv.chapter = ch.value; });
    row.appendChild(field('Chapter', ch));
    var qs = STORY.records.list('qst_', b).filter(function (q) { return Array.isArray(q.stages) && q.stages.length && (!subject.qst || q.id === subject.qst); });
    qs.forEach(function (q) {
      var opts = [['', 'Not started']].concat(q.stages.map(function (x) { return [x.key, x.label || x.key]; })).concat([['failed', 'Failed']]);
      var sel = selectOf(opts, pv.quests[q.id] || '', 'Stage of ' + q.name); sel.addEventListener('change', function () { pv.quests[q.id] = sel.value; });
      row.appendChild(field(q.name, sel));
    });
    box.appendChild(row);
    var bar = el('div', 'btn-row');
    subject.starts.forEach(function (s0) { bar.appendChild(UI().button(s0.label, 'play', s0.primary ? 'btn-primary' : '', function () { s0.go(); paintLog(); })); });
    box.appendChild(bar);
    var log = el('div', 'dg-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite');
    box.appendChild(log);
    function paintLog() {
      U.clear(log);
      if (!pv.log.length) { log.appendChild(el('p', 'muted dg-none', 'Press a button to run the conversation through the real engine.')); return; }
      pv.log.forEach(function (l) { log.appendChild(el('p', 'dg-l dg-l-' + l.cls, (l.who ? '<strong>' + esc(l.who) + ':</strong> ' : '') + esc(l.text))); });
      var run = pv.run;
      if (run && !run.done && run.waiting === 'choice' && run.options) {
        if (run.prompt) log.appendChild(el('p', 'dg-l dg-l-fx', esc(run.prompt)));
        var cb = el('div', 'dg-opts');
        run.options.forEach(function (o) {
          var b2 = el('button', 'btn dg-opt', esc(o.text)); b2.type = 'button';
          b2.addEventListener('click', function () { pv.log.push({ cls: 'pick', text: '> ' + o.text }); advance(ES.dlg.choose(run.state, run.cursor, o.index, run.idx), run.idx); paintLog(); });
          cb.appendChild(b2);
        });
        log.appendChild(cb);
      } else if (run && !run.done && run.waiting !== 'choice') {
        log.appendChild(UI().button('Continue', 'play', '', function () { advance(ES.dlg.step(run.state, run.cursor, run.idx), run.idx); paintLog(); }));
      }
    }
    paintLog();
    host.appendChild(box);
    return paintLog;
  }

  // ---------------------------------------------------------------- one dialogue
  function dialogueSettings(rec) {
    var body = el('div'), nm = textInput(rec.name, 'Name', 120), sp = el('div'), kb = el('div');
    var spv = rec.speaker || '';
    sp.appendChild(pickBtn('Default speaker', /^[a-z]{3}_/.test(spv) ? spv : '', spv && !/^[a-z]{3}_/.test(spv) ? spv : 'The person talked to', ['chr_', 'npc_'], 'Default speaker', function (v) { spv = v; }));
    var pv = rec.por || ''; kb.appendChild(pickBtn('Default portrait', pv, 'No portrait', 'por_', 'Default portrait', function (v) { pv = v; }));
    var chs = selectOf([['', 'Any chapter']].concat(STORY.chapters().map(function (c) { return [c.id, c.name || c.id]; })), rec.chapter || '', 'Chapter');
    body.appendChild(field('Name', nm)); body.appendChild(field('Default speaker', sp)); body.appendChild(field('Default portrait', kb)); body.appendChild(field('Chapter', chs));
    var msg = el('div', 'field-msg');
    body.appendChild(msg);
    Kit.ui.dialog({ title: 'Dialogue settings', body: body, actions: [
      { label: 'Cancel', kind: 'ghost', value: null },
      { label: 'Save', kind: 'primary', onClick: function () {
        var r = D.update(rec.id, { name: nm.value, speaker: spv, por: pv, chapter: chs.value || null });
        if (!r.ok) { msg.innerHTML = '<span class="msg msg-error">' + esc(problemText(r)) + '</span>'; return false; }
        Kit.ui.toast('Dialogue saved.', 'ok');
        redraw();
      } }] });
  }
  function fillDialogue(body, rec, b) {
    var users = D.usedBy(rec.id, b), sel = st.node[rec.id];
    if (!rec.nodes || !rec.nodes[sel]) sel = st.node[rec.id] = rec.start && rec.nodes && rec.nodes[rec.start] ? rec.start : Object.keys(rec.nodes || {}).sort()[0];
    var kvp = [['ID', '<code class="id">' + esc(rec.id) + '</code>']];
    if (rec.speaker) kvp.push(['Speaker', esc(nameOf(rec.speaker, rec.speaker))]);
    if (rec.qst) kvp.push(['Quest', esc(nameOf(rec.qst, rec.qst))]);
    kvp.push(['Said by', users.length ? esc(users.slice(0, 6).map(function (u) { return u.name; }).join(', ')) + (users.length > 6 ? esc(' and ' + (users.length - 6) + ' more') : '') : '<span class="muted">nobody yet</span>']);
    body.appendChild(el('div', null, UI().kv(kvp)));
    if (rec.notes) body.appendChild(el('p', 'muted dg-notes', esc(rec.notes)));
    var probs = D.check(rec, b).filter(function (p) { return p.level === 'error' || p.level === 'warning'; });
    if (probs.length) { var pl = el('ul', 'dg-probs'); probs.slice(0, 6).forEach(function (p) { pl.appendChild(el('li', p.level === 'error' ? 'dg-err' : 'dg-warn', esc(p.message))); }); body.appendChild(pl); }
    var nk = Object.keys(rec.nodes || {}).sort(), chips = el('div', 'fg-filter dg-nodes');
    nk.forEach(function (k) {
      var bt = el('button', 'btn', esc(k + (k === rec.start ? ' (start)' : ''))); bt.type = 'button'; bt.setAttribute('aria-pressed', k === sel ? 'true' : 'false');
      bt.addEventListener('click', function () { st.node[rec.id] = k; redraw(); });
      chips.appendChild(bt);
    });
    var addn = el('button', 'btn btn-ghost', '+ Node'); addn.type = 'button'; addn.setAttribute('aria-label', 'Add a node');
    addn.addEventListener('click', function () { var r = D.addNode(rec.id, {}); if (done(r)) { st.node[rec.id] = r.key; redraw(); } });
    chips.appendChild(addn);
    body.appendChild(chips);
    if (nk.length) body.appendChild(graph(rec, sel, function (k) { st.node[rec.id] = k; redraw(); }));
    if (sel) body.appendChild(nodeEditor(rec, sel));
    previewPanel(body, { qst: rec.qst, starts: [
      { label: 'Run from the start', primary: true, go: function () { startPreview(rec.id, null); } },
      { label: 'Run from node ' + (sel || ''), go: function () { startPreview(rec.id, sel); } }] });
    var acts = el('div', 'btn-row fg-bacts');
    acts.appendChild(UI().button('Settings', 'edit', '', function () { dialogueSettings(rec); }));
    if (rec.origin === 'generated') acts.appendChild(UI().button('Reset to generated', null, 'btn-ghost', function () {
      Kit.ui.confirm({ title: 'Reset this dialogue?', okLabel: 'Reset dialogue', message: 'Your edits to "' + rec.name + '" are replaced by what the world asks for.' }).then(function (ok) { if (!ok) return; var r = D.reset(rec.id); if (r.ok) { Kit.ui.toast('Dialogue reset.', 'ok'); redraw(); } else Kit.ui.toast(r.message, 'warn'); });
    }));
    acts.appendChild(UI().button('Delete', 'trash', 'btn-danger', function () {
      Kit.ui.confirm({ title: 'Delete ' + rec.name + '?', okLabel: 'Delete dialogue', message: users.length ? 'The ' + plural(users.length, 'page') + ' that open it are removed too.' : 'Nothing opens it.' }).then(function (ok) { if (!ok) return; if (D.remove(rec.id).ok) { Kit.ui.toast('Dialogue deleted.', 'ok'); redraw(); } });
    }));
    body.appendChild(acts);
  }
  function dialogueItem(rec, b) {
    var wrap = el('div', 'fg-item dg-item'), open = !!st.open[rec.id], stt = D.stats(rec);
    wrap.dataset.dlg = rec.id;
    var meta = UI().chip('chip-accent', D.KIND_LABEL[rec.kind] || 'Yours') + (rec.chapter ? ' ' + UI().chip('chip-muted', chName(rec.chapter)) : '') + ' ' + UI().chip('chip-muted', plural(stt.nodes, 'node')) + ' ' + UI().chip('chip-muted', plural(stt.lines, 'line')) + (rec.origin === 'user' ? ' ' + UI().chip('chip-muted', 'yours') : '');
    var head = el('button', 'btn fg-head', '<span class="fg-name">' + esc(rec.name) + '</span><span class="fg-meta">' + meta + '</span>');
    head.type = 'button'; head.setAttribute('aria-expanded', open ? 'true' : 'false');
    var body = el('div', 'fg-body'); body.hidden = !open;
    if (open) fillDialogue(body, rec, b);
    head.addEventListener('click', function () {
      st.open[rec.id] = body.hidden;
      if (body.hidden && !body.firstChild) fillDialogue(body, rec, b);
      body.hidden = !body.hidden; head.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
    });
    wrap.appendChild(head); wrap.appendChild(body);
    return wrap;
  }

  // ---------------------------------------------------------------- people
  function dlgOptions(b) { return [['', 'Choose a dialogue']].concat(D.list(b).map(function (d) { return [d.id, d.name]; })); }
  function pageEditor(npc, p, i, total, b) {
    var box = el('div', 'dg-page'), gen = U.isObj(p) && p.origin === 'generated';
    box.appendChild(el('div', 'dg-page-h', 'Page ' + (i + 1) + (gen ? ' ' + UI().chip('chip-muted', 'generated') : ' ' + UI().chip('chip-accent', 'yours')) + (i === total - 1 ? ' ' + UI().chip('chip-muted', 'wins when it passes') : '')));
    var ds = selectOf(dlgOptions(b), p.dlg || '', 'Dialogue for page ' + (i + 1));
    ds.addEventListener('change', function () { if (done(D.updatePage(npc, i, { dlg: ds.value || null, node: null }))) redraw(); });
    box.appendChild(field('Says', ds));
    var rec = b.story.records.dlg_[p.dlg], nodes = rec && rec.nodes ? Object.keys(rec.nodes).sort() : [];
    if (nodes.length) {
      var ns = selectOf([['', 'The start']].concat(nodes.map(function (k) { return [k, k]; })), p.node || '', 'Opens at');
      ns.addEventListener('change', function () { if (done(D.updatePage(npc, i, { node: ns.value || null }))) redraw(); });
      box.appendChild(field('Opens at', ns));
    }
    var ch = el('div', 'dg-cond'); box.appendChild(field('Shown when', ch, 'The rightmost page that passes is the one said. No condition always passes.'));
    STORY.condUI.mount(ch, p.cond === undefined ? null : p.cond, function (t) { var r = D.updatePage(npc, i, { cond: t === null ? null : t }); if (!r.ok) done(r); }, { nullable: true, emptyText: 'Always passes.', addLabel: 'Add a condition' });
    var bar = el('div', 'btn-row');
    bar.appendChild(UI().button('Up', null, 'btn-ghost', function () { if (done(D.movePage(npc, i, -1))) redraw(); }));
    bar.appendChild(UI().button('Down', null, 'btn-ghost', function () { if (done(D.movePage(npc, i, 1))) redraw(); }));
    bar.appendChild(UI().button('Remove page', 'trash', 'btn-danger', function () { if (done(D.removePage(npc, i))) redraw(); }));
    box.appendChild(bar);
    return box;
  }
  function personBody(body, row, b) {
    var pages = D.pagesOf(row.id, b);
    body.appendChild(el('div', null, UI().kv([['ID', '<code class="id">' + esc(row.id) + '</code>'], ['Role', esc(D.roleLabel(row.role))], ['Chapter', row.chapter ? esc(chName(row.chapter)) : '<span class="muted">none</span>'], ['Town', row.town ? esc(row.town) : '<span class="muted">none</span>']])));
    var probs = D.checkPages(row.id, pages, b).filter(function (p) { return p.level === 'error' || p.level === 'warning'; });
    if (probs.length) { var pl = el('ul', 'dg-probs'); probs.slice(0, 5).forEach(function (p) { pl.appendChild(el('li', p.level === 'error' ? 'dg-err' : 'dg-warn', esc(p.message))); }); body.appendChild(pl); }
    if (!pages.length) body.appendChild(el('p', 'muted dg-none', 'This person says nothing yet. Build dialogue, or add a page.'));
    pages.forEach(function (p, i) { body.appendChild(pageEditor(row.id, p, i, pages.length, b)); });
    var acts = el('div', 'btn-row fg-bacts');
    acts.appendChild(UI().button('Add page', 'plus', '', function () {
      var first = D.list(b)[0];
      if (!first) { Kit.ui.toast('There is no dialogue to open yet. Build dialogue first.', 'warn'); return; }
      if (done(D.addPage(row.id, { dlg: first.id }))) redraw();
    }));
    acts.appendChild(UI().button('Back to generated pages', null, 'btn-ghost', function () {
      Kit.ui.confirm({ title: 'Reset the pages for ' + row.name + '?', okLabel: 'Reset pages', message: 'Pages you made or edited for this person are replaced by the generated ones.' }).then(function (ok) { if (!ok) return; if (done(D.resetPages(row.id), 'Pages reset.')) redraw(); });
    }));
    body.appendChild(acts);
    previewPanel(body, { qst: null, starts: [{ label: 'Talk to ' + row.name, primary: true, go: function () { talkPreview(row.id); } }] });
  }
  function peoplePanel(host, b) {
    var list = el('section', 'panel fg-card'), rows = D.people(b);
    list.appendChild(el('h3', 'section-h', 'People'));
    var q = textInput(st.people, 'Search people', 60); q.placeholder = 'Search by name, role, or town'; q.type = 'search';
    list.appendChild(q);
    var count = el('p', 'muted fg-count'), items = el('div', 'fg-list');
    list.appendChild(count); list.appendChild(items);
    function paint() {
      U.clear(items);
      var t = st.people.trim().toLowerCase();
      var shown = rows.filter(function (r) { return !t || (r.name + ' ' + r.role + ' ' + r.town).toLowerCase().indexOf(t) >= 0; });
      count.textContent = shown.length === rows.length ? plural(rows.length, 'person', 'people') : shown.length + ' of ' + plural(rows.length, 'person', 'people');
      if (!shown.length) items.appendChild(el('div', 'empty-line', rows.length ? 'No one matches.' : 'The world has no people yet.'));
      shown.slice(0, 60).forEach(function (r) {
        var wrap = el('div', 'fg-item dg-item'), open = !!st.pOpen[r.id]; wrap.dataset.npc = r.id;
        var meta = UI().chip('chip-muted', D.roleLabel(r.role)) + ' ' + UI().chip(r.pages ? 'chip-accent' : 'chip-warning', plural(r.pages, 'page')) + (r.yours ? ' ' + UI().chip('chip-muted', r.yours + ' yours') : '');
        var head = el('button', 'btn fg-head', '<span class="fg-name">' + esc(r.name) + '</span><span class="fg-meta">' + meta + '</span>');
        head.type = 'button'; head.setAttribute('aria-expanded', open ? 'true' : 'false');
        var body = el('div', 'fg-body'); body.hidden = !open;
        if (open) personBody(body, r, b);
        head.addEventListener('click', function () {
          st.pOpen[r.id] = body.hidden;
          if (body.hidden && !body.firstChild) personBody(body, r, b);
          body.hidden = !body.hidden; head.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
        });
        wrap.appendChild(head); wrap.appendChild(body); items.appendChild(wrap);
      });
      if (shown.length > 60) items.appendChild(el('p', 'muted fg-count', 'Showing the first 60. Search to narrow the list.'));
    }
    q.addEventListener('input', function () { st.people = q.value; paint(); });
    paint();
    host.appendChild(list);
  }

  // ---------------------------------------------------------------- the tab
  function render(host) {
    var b = cur(), sum = D.summary(b);
    var head = el('section', 'panel');
    head.innerHTML = '<h2 class="panel-title">Dialogue</h2><p class="muted fg-lead">A dialogue is a small graph of nodes: each says its lines, runs its effects, then goes on or offers choices. Each person has a list of pages, and the rightmost page whose condition passes is the one they say, so the same townsperson speaks differently by chapter without the world changing. Build dialogue from the world, then edit any of it.</p>';
    head.appendChild(el('div', 'fg-stats', UI().chip('chip-accent', plural(sum.total, 'dialogue')) + ' ' + UI().chip('chip-muted', sum.byKind.quest + ' quest') + ' ' + UI().chip('chip-muted', sum.byKind.role + ' greeting') + ' ' + UI().chip('chip-muted', plural(sum.lines, 'line')) + ' ' + UI().chip('chip-muted', sum.covered + ' of ' + plural(sum.people, 'person', 'people') + ' with pages') +
      (sum.authored ? ' ' + UI().chip('chip-muted', sum.authored + ' made by hand') : '') + ((sum.missing || sum.pagesTodo) ? ' ' + UI().chip('chip-warning', 'not built yet', 'The world and the quests ask for dialogue or pages that do not exist yet.') : sum.total ? ' ' + UI().chip('chip-ok', 'up to date') : '')));
    var row = el('div', 'btn-row');
    row.appendChild(UI().button(sum.total ? 'Update dialogue' : 'Build dialogue from the world', 'check', sum.missing || sum.pagesTodo || !sum.total ? 'btn-primary' : '', function () {
      var rep = D.scaffold();
      if (!rep.skipped && STORY.flags && STORY.flags.sync) STORY.flags.sync();
      Kit.ui.toast(D.reportText(rep), rep.skipped ? 'warn' : 'ok', 5000);
      redraw();
    }));
    row.appendChild(UI().button('Add dialogue', 'plus', '', function () {
      Kit.ui.prompt({ title: 'New dialogue', label: 'Name', okLabel: 'Add', validate: function (v) { return v.trim() ? null : 'Enter a name.'; } }).then(function (v) {
        if (v === null || v === undefined) return;
        var r = D.add({ name: v }); if (done(r)) { st.open[r.record.id] = true; st.view = 'dialogues'; st.filter = 'all'; redraw(); }
      });
    }));
    head.appendChild(row);
    if (!Kit.ai.hasKey()) head.appendChild(el('p', 'muted dg-keynote', 'Drafting lines with Claude is off until you add a Claude API key in Settings. Everything else works without one.'));
    var tabs = el('div', 'fg-filter dg-views');
    [['dialogues', 'Dialogues'], ['people', 'People']].forEach(function (v) {
      var bt = el('button', 'btn', esc(v[1])); bt.type = 'button'; bt.setAttribute('aria-pressed', st.view === v[0] ? 'true' : 'false');
      bt.addEventListener('click', function () { st.view = v[0]; redraw(); });
      tabs.appendChild(bt);
    });
    head.appendChild(tabs);
    host.appendChild(head);
    if (st.view === 'people') { peoplePanel(host, b); } else {
      var list = el('section', 'panel fg-card'), recs = D.list(b);
      list.appendChild(el('h3', 'section-h', 'All dialogues'));
      var bar = el('div', 'fg-filter');
      FILTERS.forEach(function (f) {
        var bt = el('button', 'btn', esc(f[1])); bt.type = 'button'; bt.setAttribute('aria-pressed', st.filter === f[0] ? 'true' : 'false');
        bt.addEventListener('click', function () { st.filter = f[0]; Array.prototype.forEach.call(bar.children, function (c, i) { c.setAttribute('aria-pressed', FILTERS[i][0] === st.filter ? 'true' : 'false'); }); paint(); });
        bar.appendChild(bt);
      });
      list.appendChild(bar);
      var items = el('div', 'fg-list'), count = el('p', 'muted fg-count');
      list.appendChild(count); list.appendChild(items);
      var paint = function () {
        U.clear(items);
        var shown = recs.filter(function (d) { return st.filter === 'all' ? true : (d.kind || 'custom') === st.filter; });
        count.textContent = shown.length === recs.length ? plural(recs.length, 'dialogue') : shown.length + ' of ' + plural(recs.length, 'dialogue');
        if (!shown.length) items.appendChild(el('div', 'empty-line', recs.length ? 'No dialogue matches.' : 'No dialogue yet. Build dialogue from the world to give every person something to say.'));
        shown.forEach(function (d) { items.appendChild(dialogueItem(d, b)); });
      };
      paint();
      host.appendChild(list);
    }
    if (st.focus) {
      var id = st.focus, node = host.querySelector('[data-dlg="' + id + '"]');
      st.focus = null;
      if (node) { if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' }); var hb = node.querySelector('.fg-head'); if (hb) try { hb.focus({ preventScroll: true }); } catch (e) { /* no focus */ } }
    }
  }
  function focus(rid) {
    if (!rid) return;
    if (Kit.ids.prefixOf(rid) === 'npc_') { st.view = 'people'; st.pOpen[rid] = true; st.people = ''; } else { st.view = 'dialogues'; st.open[rid] = true; st.filter = 'all'; st.focus = rid; }
    Kit.rerender();
  }
  STORY.WS = STORY.WS || {};
  STORY.WS.dialogue = { render: render, focus: focus };
  Kit.jump.register({ test: function (rid) { return Kit.ids.prefixOf(rid) === 'dlg_'; }, name: function (rid) { return nameOf(rid, rid); }, go: function (rid) { if (!Kit.go('dialogue')) return false; focus(rid); return true; } });
})();
// === WS:DIALOGUE END ===
