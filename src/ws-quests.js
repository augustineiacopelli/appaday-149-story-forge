// === WS:QUESTS BEGIN ===
(function () {
  'use strict';
  // The Quests tab. Each quest is drawn as a state machine in hand built inline SVG: stages left to right, exclusive branch
  // groups fanning out underneath, the failure rule in red above the line. Click a stage (or its button below the picture)
  // to edit it. Logic lives in STORY.quests (src/story-quests.js); conditions and flag changes use src/ws-cond.js.
  var U = Kit.util, el = U.el, esc = U.esc, Q = STORY.quests, SVGNS = 'http://www.w3.org/2000/svg';
  function cur() { return Kit.bundle.current(); }
  function UI() { return STORY.ui; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function nameOf(id, fb) { return STORY.nameOf ? STORY.nameOf(id, fb) : (fb || id || ''); }
  function chName(id) { var c = STORY.chapters().filter(function (x) { return x.id === id; })[0]; return c ? c.name || id : id; }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  var st = STORY.questsUi = { filter: 'all', open: {}, sel: {}, focus: null };
  var FILTERS = [['all', 'All'], ['main', 'Main'], ['side', 'Side'], ['bstory', 'B story'], ['yours', 'Yours']];

  // Redraws the tab and keeps the reader where they were (Kit.rerender rebuilds the whole panel).
  function redraw() {
    var host = document.getElementById('ws'), top = host ? host.scrollTop : 0, win = window.pageYOffset || 0;
    Kit.rerender();
    var h2 = document.getElementById('ws');
    if (h2) h2.scrollTop = top;
    if (win > 0) window.scrollTo(0, win);
  }
  function problemText(res) { return (res.problems || []).map(function (p) { return p.message; }).join(' ') || res.message || 'That change was not saved.'; }
  function showMsg(host, res) { host.innerHTML = '<span class="msg msg-error">' + esc(problemText(res)) + '</span>'; }
  function field(label, input, help) {
    var f = el('div', 'field'), l = el('label', 'field-label', esc(label));
    f.appendChild(l); f.appendChild(input);
    if (help) f.appendChild(el('div', 'field-help', esc(help)));
    return f;
  }
  function textInput(value, label, max) {
    var i = el('input', 'inp'); i.type = 'text'; i.value = value || ''; i.maxLength = max || 120; i.setAttribute('aria-label', label);
    return i;
  }
  function selectOf(options, value, label) {
    var s = el('select', 'inp'); s.setAttribute('aria-label', label);
    options.forEach(function (o) { var op = el('option', null, esc(o[1])); op.value = o[0]; s.appendChild(op); });
    s.value = value;
    return s;
  }
  function pickBtn(label, id, empty, prefix, title, onPick) {
    var b = el('button', 'btn qs-pick' + (id ? '' : ' qs-empty'), esc(id ? nameOf(id, id) : empty)); b.type = 'button';
    b.addEventListener('click', function () { Kit.ui.pickRef({ prefix: prefix, title: title, current: id }).then(function (v) { if (v) { onPick(v); b.textContent = nameOf(v, v); b.classList.remove('qs-empty'); } }); });
    b.setAttribute('aria-label', label);
    return b;
  }

  // ---------------------------------------------------------------- the state machine picture
  var NW = 148, NH = 60, GAP = 46, PAD = 20, PILLW = 124, PILLH = 30, ROWH = 112, seq = 0;
  function s(tag, attrs, text) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, String(attrs[k])); });
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function wrap(text, per, lines) {
    var words = String(text || '').split(/\s+/).filter(Boolean), out = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i], next = line ? line + ' ' + w : w;
      if (next.length <= per) { line = next; continue; }
      if (line) out.push(line);
      line = w.length > per ? w.slice(0, per - 1) + '~' : w;
      if (out.length === lines) break;
    }
    if (line && out.length < lines) out.push(line);
    if (out.length === lines && words.join(' ').length > out.join(' ').length) out[lines - 1] = out[lines - 1].replace(/.{0,2}$/, '') + '...';
    return out.length ? out : [''];
  }
  function lines(parent, cx, y, textLines, cls) {
    var t = s('text', { x: cx, y: y, 'text-anchor': 'middle', 'class': cls });
    textLines.forEach(function (ln, i) { var sp = s('tspan', { x: cx, dy: i ? 14 : 0 }, ln); t.appendChild(sp); });
    parent.appendChild(t);
  }
  function drawMachine(q, selKey, onPick) {
    var stages = Array.isArray(q.stages) ? q.stages : [], n = stages.length, groups = Array.isArray(q.branches) ? q.branches : [];
    var fail = U.isObj(q.fail) ? q.fail : null, lineY = PAD + (fail ? 78 : 0), bTop = lineY + NH + 40;
    function cx(i) { return PAD + i * (NW + GAP) + NW / 2; }
    function idxOf(key) { for (var i = 0; i < n; i++) if (stages[i].key === key) return i; return -1; }
    var width = PAD * 2 + Math.max(1, n) * NW + Math.max(0, n - 1) * GAP;
    var laid = groups.map(function (g, gi) {
      var at = idxOf(g.at); if (at < 0) at = Math.max(0, n - 2);
      var outs = Array.isArray(g.outcomes) ? g.outcomes : [], total = outs.length * PILLW + Math.max(0, outs.length - 1) * 10;
      var left = Math.max(PAD, cx(at) - total / 2);
      width = Math.max(width, left + total + PAD);
      return { g: g, gi: gi, at: at, outs: outs, left: left, total: total };
    });
    var height = laid.length ? bTop + laid.length * ROWH : lineY + NH + 40;
    var id = 'qa' + (++seq);
    var svg = s('svg', { width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'group', 'class': 'qs-svg', focusable: 'false' });
    svg.setAttribute('aria-label', 'Map of the quest ' + (q.name || '') + ': ' + plural(n, 'stage') + (groups.length ? ', ' + plural(groups.length, 'branch group') : '') + (fail ? ', with a failure rule' : '') + '.');
    var defs = s('defs');
    [['', 'qs-arrow'], ['f', 'qs-arrow qs-arrow-fail']].forEach(function (m) {
      var mk = s('marker', { id: id + m[0], viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
      mk.appendChild(s('path', { d: 'M0,0 L10,5 L0,10 z', 'class': m[1] }));
      defs.appendChild(mk);
    });
    svg.appendChild(defs);
    // the line between stages
    for (var i = 0; i < n - 1; i++) svg.appendChild(s('path', { d: 'M' + (cx(i) + NW / 2) + ',' + (lineY + NH / 2) + ' L' + (cx(i + 1) - NW / 2 - 2) + ',' + (lineY + NH / 2), 'class': 'qs-edge', 'marker-end': 'url(#' + id + ')' }));
    // failure, above the line
    if (fail && n) {
      var fx = PAD + (n - 1) * (NW + GAP), fy = PAD, busY = fy + 22;
      svg.appendChild(s('path', { d: 'M' + cx(0) + ',' + busY + ' L' + (fx - 2) + ',' + busY, 'class': 'qs-edge qs-edge-fail', 'marker-end': 'url(#' + id + 'f)' }));
      for (var k = 0; k < n - 1; k++) svg.appendChild(s('path', { d: 'M' + cx(k) + ',' + busY + ' L' + cx(k) + ',' + (lineY - 2), 'class': 'qs-edge qs-edge-fail' }));
      var fg = s('g', { 'class': 'qs-fail' });
      fg.appendChild(s('title', {}, 'Failure: ' + (fail.cond ? Q.condText(fail.cond) : 'only an event fails this quest') + (Array.isArray(fail.sets) && fail.sets.length ? '. Sets ' + plural(fail.sets.length, 'flag') + '.' : '')));
      fg.appendChild(s('rect', { x: fx, y: fy, width: NW, height: 44, rx: 8 }));
      lines(fg, fx + NW / 2, fy + 19, ['Failed'], 'qs-fail-t');
      lines(fg, fx + NW / 2, fy + 34, [fail.cond ? 'by a condition' : 'by an event'], 'qs-hint');
      svg.appendChild(fg);
    }
    // stages
    stages.forEach(function (stg, i) {
      var x = PAD + i * (NW + GAP), last = i === n - 1, sel = stg.key === selKey;
      var g = s('g', { 'class': 'qs-node' + (sel ? ' sel' : '') + (last ? ' end' : ''), role: 'button', tabindex: 0, 'data-stage': stg.key });
      g.setAttribute('aria-label', 'Stage ' + (i + 1) + ' of ' + n + ': ' + stg.label + (last ? ', the ending' : '') + '. Edit this stage.');
      g.setAttribute('aria-pressed', sel ? 'true' : 'false');
      g.appendChild(s('title', {}, stg.label + (stg.exitWhen ? '. Moves on when ' + Q.condText(stg.exitWhen) : last ? '' : '. Moved on by an event.')));
      g.appendChild(s('rect', { x: x, y: lineY, width: NW, height: NH, rx: 10, 'class': 'qs-box' }));
      if (last) g.appendChild(s('rect', { x: x + 4, y: lineY + 4, width: NW - 8, height: NH - 8, rx: 7, 'class': 'qs-box-in' }));
      g.appendChild(s('text', { x: x + 10, y: lineY + 16, 'class': 'qs-num' }, String(i + 1)));
      lines(g, x + NW / 2, lineY + 29, wrap(stg.label, 20, 2), 'qs-label');
      svg.appendChild(g);
      var hint = last ? 'ends the quest' : stg.exitWhen ? 'by a condition' : 'by an event';
      if (Array.isArray(stg.sets) && stg.sets.length) hint += ', sets ' + stg.sets.length;
      lines(svg, x + NW / 2, lineY + NH + 15, [hint], 'qs-hint');
      g.addEventListener('click', function () { onPick(stg.key); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(stg.key); } });
    });
    // branch groups
    laid.forEach(function (L) {
      var y = bTop + L.gi * ROWH, dx = cx(L.at), nodeBottom = lineY + NH;
      var d = L.gi === 0 ? 'M' + dx + ',' + (nodeBottom + 21) + ' L' + dx + ',' + (y - 10) : 'M' + dx + ',' + (nodeBottom + 21) + ' L' + dx + ',' + (nodeBottom + 26) + ' L6,' + (nodeBottom + 26) + ' L6,' + y + ' L' + (dx - 10) + ',' + y;
      svg.appendChild(s('path', { d: d, 'class': 'qs-edge qs-edge-branch' }));
      var gg = s('g', { 'class': 'qs-group' });
      gg.appendChild(s('title', {}, 'Branch group: ' + L.g.label + '. Choosing one outcome closes the others.'));
      gg.appendChild(s('polygon', { points: dx + ',' + (y - 10) + ' ' + (dx + 10) + ',' + y + ' ' + dx + ',' + (y + 10) + ' ' + (dx - 10) + ',' + y }));
      svg.appendChild(gg);
      var lab = s('text', { x: dx + 16, y: y + 4, 'class': 'qs-glabel' }, L.g.label.length > 30 ? L.g.label.slice(0, 27) + '...' : L.g.label);
      svg.appendChild(lab);
      L.outs.forEach(function (o, j) {
        var px = L.left + j * (PILLW + 10), pcx = px + PILLW / 2, py = y + 34;
        svg.appendChild(s('path', { d: 'M' + dx + ',' + (y + 10) + ' L' + dx + ',' + (y + 22) + ' L' + pcx + ',' + (y + 22) + ' L' + pcx + ',' + (py - 1), 'class': 'qs-edge qs-edge-branch', 'marker-end': 'url(#' + id + ')' }));
        var pg = s('g', { 'class': 'qs-pill' });
        pg.appendChild(s('title', {}, o.label + (Array.isArray(o.sets) && o.sets.length ? '. Sets ' + plural(o.sets.length, 'flag') + '.' : '')));
        pg.appendChild(s('rect', { x: px, y: py, width: PILLW, height: PILLH, rx: 15 }));
        lines(pg, pcx, py + 19, [wrap(o.label, 18, 1)[0]], 'qs-pill-t');
        svg.appendChild(pg);
      });
    });
    return svg;
  }

  // ---------------------------------------------------------------- editors under the picture
  function stageEditor(q, stage, idx, b) {
    var draft = clone(stage), last = idx === q.stages.length - 1, box = el('div', 'qs-edit'), msg = el('div', 'field-msg');
    box.appendChild(el('h4', 'qs-edit-h', 'Stage ' + (idx + 1) + ' of ' + q.stages.length + (last ? ', the ending' : '')));
    var label = textInput(draft.label, 'Stage label', 120);
    label.addEventListener('input', function () { draft.label = label.value; });
    box.appendChild(field('Label', label, 'What the quest log says while the quest is at this stage.'));
    if (last) box.appendChild(el('p', 'muted', 'The last stage ends the quest, and the engine sets the completion flag when it is entered.'));
    else {
      var cond = el('div', 'qs-cond');
      STORY.condUI.mount(cond, draft.exitWhen === undefined ? null : draft.exitWhen, function (t) { if (t === null) delete draft.exitWhen; else draft.exitWhen = t; }, { nullable: true, emptyText: 'No condition: a person talking or an event moves the quest on (see Events).', addLabel: 'Move on when a condition passes' });
      box.appendChild(field('Moves on', cond, 'The engine checks this after every event. Stages only move forward.'));
    }
    var sets = el('div', 'qs-sets');
    STORY.setsUI.mount(sets, draft.sets, function (l) { draft.sets = l; }, { emptyText: 'Sets no flags.', addLabel: 'Add a flag change' });
    box.appendChild(field('Sets when entered', sets, 'Entering this stage, or skipping past it, applies these changes.'));
    var site = textInput(draft.site, 'Site', 160); site.placeholder = 'dgn|chp_.../key';
    site.addEventListener('input', function () { draft.site = site.value; });
    box.appendChild(field('Site', site, 'The Day 148 progression site this stage happens at. Optional.'));
    var note = textInput(draft.note, 'Note', 300);
    note.addEventListener('input', function () { draft.note = note.value; });
    box.appendChild(field('Note', note));
    box.appendChild(msg);
    var acts = el('div', 'btn-row');
    acts.appendChild(UI().button('Save stage', 'check', 'btn-primary', function () {
      var res = Q.replaceStage(q.id, stage.key, draft);
      if (!res.ok) { showMsg(msg, res); return; }
      Kit.ui.toast('Stage saved.', 'ok'); redraw();
    }));
    var left = UI().button('Earlier', null, 'btn-ghost', function () { var r = Q.moveStage(q.id, stage.key, -1); if (!r.ok) Kit.ui.toast(problemText(r), 'warn'); else redraw(); });
    var right = UI().button('Later', null, 'btn-ghost', function () { var r = Q.moveStage(q.id, stage.key, 1); if (!r.ok) Kit.ui.toast(problemText(r), 'warn'); else redraw(); });
    left.disabled = idx === 0; right.disabled = last;
    acts.appendChild(left); acts.appendChild(right);
    acts.appendChild(UI().button('Add stage after', 'plus', 'btn-ghost', function () {
      var key = Q.freeStageKey(q), res = Q.addStage(q.id, { key: key, at: Math.min(idx + 1, q.stages.length - 1) });
      if (!res.ok) { showMsg(msg, res); return; }
      st.sel[q.id] = key; redraw();
    }));
    acts.appendChild(UI().button('Delete stage', 'trash', 'btn-danger', function () {
      var res = Q.removeStage(q.id, stage.key);
      if (!res.ok) { showMsg(msg, res); return; }
      st.sel[q.id] = null; redraw();
    }));
    box.appendChild(acts);
    return box;
  }
  function groupEditor(q, g) {
    var draft = clone(g), box = el('div', 'qs-edit qs-group-edit'), msg = el('div', 'field-msg');
    box.appendChild(el('h4', 'qs-edit-h', 'Branch group'));
    var label = textInput(draft.label, 'Group label', 120); label.addEventListener('input', function () { draft.label = label.value; });
    box.appendChild(field('Label', label, 'The choice, as the player would put it.'));
    var at = selectOf([['', 'Between the last two stages']].concat(q.stages.map(function (x) { return [x.key, x.label]; })), draft.at || '', 'Decided at stage');
    at.addEventListener('change', function () { if (at.value) draft.at = at.value; else delete draft.at; });
    box.appendChild(field('Drawn at', at, 'Only places the group in the picture. The engine closes the group when one outcome is chosen.'));
    var outHost = el('div', 'qs-outs');
    function paintOuts() {
      U.clear(outHost);
      (draft.outcomes || []).forEach(function (o, i) {
        var row = el('div', 'qs-out');
        var ol = textInput(o.label, 'Outcome label', 120); ol.addEventListener('input', function () { o.label = ol.value; });
        row.appendChild(field('Outcome ' + (i + 1), ol));
        var sh = el('div', 'qs-sets');
        STORY.setsUI.mount(sh, o.sets, function (l) { o.sets = l; }, { emptyText: 'Sets no flags.', addLabel: 'Add a flag change' });
        row.appendChild(sh);
        row.appendChild(UI().button('Remove outcome', 'trash', 'btn-ghost', function () { draft.outcomes.splice(i, 1); paintOuts(); }));
        outHost.appendChild(row);
      });
      outHost.appendChild(UI().button('Add outcome', 'plus', 'btn-ghost', function () {
        var n = (draft.outcomes || []).length + 1, key = 'outcome' + n, used = {};
        (draft.outcomes || []).forEach(function (x) { used[x.key] = 1; });
        while (used[key]) { n++; key = 'outcome' + n; }
        draft.outcomes = (draft.outcomes || []).concat([{ key: key, label: 'Another way', sets: [] }]); paintOuts();
      }));
    }
    paintOuts();
    box.appendChild(outHost);
    box.appendChild(msg);
    var acts = el('div', 'btn-row');
    acts.appendChild(UI().button('Save group', 'check', 'btn-primary', function () {
      var res = Q.replaceGroup(q.id, g.key, draft);
      if (!res.ok) { showMsg(msg, res); return; }
      Kit.ui.toast('Group saved.', 'ok'); redraw();
    }));
    acts.appendChild(UI().button('Delete group', 'trash', 'btn-danger', function () {
      var res = Q.removeGroup(q.id, g.key);
      if (!res.ok) { showMsg(msg, res); return; }
      redraw();
    }));
    box.appendChild(acts);
    return box;
  }
  function failEditor(q) {
    var box = el('div', 'qs-edit qs-fail-edit'), msg = el('div', 'field-msg');
    box.appendChild(el('h4', 'qs-edit-h', 'Failure'));
    if (!U.isObj(q.fail)) {
      box.appendChild(el('p', 'muted', 'No failure rule. A quest with one can be lost: when its condition passes, or when an event fails it, the engine marks it failed and sets the flags below.'));
      box.appendChild(UI().button('Add a failure rule', 'plus', '', function () { var r = Q.setFail(q.id, { sets: [] }); if (!r.ok) showMsg(msg, r); else redraw(); }));
      box.appendChild(msg);
      return box;
    }
    var draft = clone(q.fail), cond = el('div', 'qs-cond');
    STORY.condUI.mount(cond, draft.cond === undefined ? null : draft.cond, function (t) { if (t === null) delete draft.cond; else draft.cond = t; }, { nullable: true, emptyText: 'No condition: only an event fails this quest.', addLabel: 'Fail when a condition passes' });
    box.appendChild(field('Fails when', cond, 'Checked after every event, while the quest is still open.'));
    var sets = el('div', 'qs-sets');
    STORY.setsUI.mount(sets, draft.sets, function (l) { draft.sets = l; }, { emptyText: 'Sets no flags.', addLabel: 'Add a flag change' });
    box.appendChild(field('Sets when failed', sets));
    box.appendChild(msg);
    var acts = el('div', 'btn-row');
    acts.appendChild(UI().button('Save failure', 'check', 'btn-primary', function () { var r = Q.setFail(q.id, draft); if (!r.ok) showMsg(msg, r); else { Kit.ui.toast('Failure saved.', 'ok'); redraw(); } }));
    acts.appendChild(UI().button('Remove failure', 'trash', 'btn-danger', function () { var r = Q.setFail(q.id, null); if (!r.ok) showMsg(msg, r); else redraw(); }));
    box.appendChild(acts);
    return box;
  }

  // ---------------------------------------------------------------- dialogs
  function chapterOptions(blank) { return [['', blank]].concat(STORY.chapters().map(function (c) { return [c.id, c.name || c.id]; })); }
  function settingsDialog(rec) {
    var isNew = !rec, v = { giver: rec && rec.giver || '', flag: rec && rec.completeFlag || '' }, rewards = clone(rec && rec.rewards || []);
    var name, kind, chapter, notes, msg, rwHost;
    Kit.ui.dialog({
      title: isNew ? 'Add a quest' : 'Quest settings',
      body: function (body) {
        name = textInput(rec ? rec.name : '', 'Quest name', 80); name.placeholder = 'The lost bell';
        body.appendChild(field('Name', name));
        kind = selectOf(Q.KINDS.map(function (k) { return [k, Q.KIND_LABEL[k]]; }), rec ? rec.kind : 'side', 'Kind'); kind.disabled = !isNew;
        body.appendChild(field('Kind', kind, isNew ? 'Main and B story quests are normally built from the world; a quest made by hand is kept as it is.' : 'A quest keeps its kind.'));
        chapter = selectOf(chapterOptions('No chapter'), rec && rec.chapter || '', 'Chapter');
        body.appendChild(field('Chapter', chapter));
        var gv = el('div', 'qs-pickrow');
        gv.appendChild(pickBtn('Giver', v.giver, 'Choose a giver', 'npc_', 'Person who offers the quest', function (x) { v.giver = x; }));
        gv.appendChild(UI().button('Clear', null, 'btn-ghost', function () { v.giver = ''; var b0 = gv.querySelector('.qs-pick'); b0.textContent = 'Choose a giver'; b0.classList.add('qs-empty'); }));
        body.appendChild(field('Giver', gv, 'The person who offers the quest.'));
        if (!isNew) {
          var fl = el('div', 'qs-pickrow');
          fl.appendChild(pickBtn('Completion flag', v.flag, 'Choose a flag', 'flg_', 'Completion flag', function (x) { v.flag = x; }));
          body.appendChild(field('Completion flag', fl, 'The engine sets it to 1 when the last stage is entered.'));
          rwHost = el('div', 'qs-rewards');
          var paint = function () {
            U.clear(rwHost);
            rewards.forEach(function (r, i) {
              var row = el('div', 'cu-leaf');
              row.appendChild(el('span', 'cu-word', esc(nameOf(r.item, r.item))));
              var q2 = el('input', 'inp cu-num'); q2.type = 'number'; q2.step = '1'; q2.min = '1'; q2.max = '99'; q2.value = r.qty === undefined ? 1 : r.qty; q2.setAttribute('aria-label', 'Quantity');
              q2.addEventListener('change', function () { r.qty = Number(q2.value); });
              row.appendChild(q2);
              row.appendChild(UI().button('Remove', 'trash', 'btn-ghost', function () { rewards.splice(i, 1); paint(); }));
              rwHost.appendChild(row);
            });
            if (!rewards.length) rwHost.appendChild(el('p', 'muted', 'No rewards.'));
            [['itm_', 'Add item'], ['eqp_', 'Add equipment']].forEach(function (p) {
              rwHost.appendChild(UI().button(p[1], 'plus', 'btn-ghost', function () { Kit.ui.pickRef({ prefix: p[0], title: p[1] }).then(function (x) { if (x) { rewards.push({ item: x, qty: 1 }); paint(); } }); }));
            });
          };
          paint();
          body.appendChild(field('Rewards', rwHost));
          notes = el('textarea', 'inp'); notes.value = rec.notes || ''; notes.maxLength = 1200; notes.setAttribute('aria-label', 'Note');
          body.appendChild(field('Note', notes));
        }
        msg = el('div', 'field-msg'); body.appendChild(msg);
      },
      actions: [
        { label: 'Cancel', kind: 'ghost', value: null },
        { label: isNew ? 'Add quest' : 'Save', kind: 'primary', onClick: function () {
          var res;
          if (isNew) res = Q.add({ name: name.value, kind: kind.value, chapter: chapter.value || undefined, giver: v.giver || undefined });
          else res = Q.update(rec.id, { name: name.value, chapter: chapter.value || null, giver: v.giver || null, completeFlag: v.flag || null, rewards: rewards, notes: notes.value });
          if (!res.ok) { showMsg(msg, res); return false; }
          if (isNew) { st.open[res.record.id] = true; st.filter = 'all'; }
          Kit.ui.toast(isNew ? 'Quest added.' : 'Quest saved.', 'ok');
          redraw();
        } }
      ]
    });
  }
  function deleteQuest(rec) {
    var users = Q.usedBy(rec.id), extra = rec.origin === 'generated' ? ' Build quests from the world makes it again.' : '';
    Kit.ui.confirm({ title: 'Delete this quest?', okLabel: 'Delete quest', message: '"' + rec.name + '" ' + (users.length ? 'is named by ' + plural(users.length, 'other record') + ' (' + users.slice(0, 3).map(function (u) { return u.name; }).join(', ') + (users.length > 3 ? ', and more' : '') + '), and each would show a missing quest.' : 'is not named anywhere else.') + extra }).then(function (ok) {
      if (!ok) return;
      var r = Q.remove(rec.id);
      if (!r.ok) { Kit.ui.toast(r.message, 'warn'); return; }
      Kit.ui.toast('Quest deleted.', 'ok'); redraw();
    });
  }

  // ---------------------------------------------------------------- the cards
  function questItem(q, b) {
    var wrap = el('div', 'fg-item qs-item'), open = !!st.open[q.id], stages = Array.isArray(q.stages) ? q.stages : [], groups = Array.isArray(q.branches) ? q.branches : [];
    wrap.dataset.qst = q.id;
    var meta = UI().chip('chip-accent', Q.KIND_LABEL[q.kind] || q.kind) + (q.chapter ? ' ' + UI().chip('chip-muted', chName(q.chapter)) : '') + ' ' + UI().chip('chip-muted', plural(stages.length, 'stage')) +
      (groups.length ? ' ' + UI().chip('chip-muted', plural(groups.length, 'branch group')) : '') + (U.isObj(q.fail) ? ' ' + UI().chip('chip-error', 'can fail') : '') + (q.origin === 'user' ? ' ' + UI().chip('chip-muted', 'yours') : '');
    var head = el('button', 'btn fg-head', '<span class="fg-name">' + esc(q.name) + '</span><span class="fg-meta">' + meta + '</span>');
    head.type = 'button'; head.setAttribute('aria-expanded', open ? 'true' : 'false');
    var body = el('div', 'fg-body'); body.hidden = !open;
    if (open) fillBody(body, q, b);
    head.addEventListener('click', function () {
      st.open[q.id] = body.hidden;
      if (body.hidden && !body.firstChild) fillBody(body, q, b);
      body.hidden = !body.hidden; head.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
    });
    wrap.appendChild(head); wrap.appendChild(body);
    return wrap;
  }
  function fillBody(body, q, b) {
    var stages = Array.isArray(q.stages) ? q.stages : [];
    var kvp = [['ID', '<code class="id">' + esc(q.id) + '</code>']];
    if (q.giver) kvp.push(['Giver', esc(nameOf(q.giver, q.giver))]); else if (q.kind !== 'bstory') kvp.push(['Giver', '<span class="muted">none</span>']);
    if (q.chr) kvp.push(['Character', esc(nameOf(q.chr, q.chr))]);
    if (q.chapter) kvp.push(['Chapter', esc(chName(q.chapter))]);
    kvp.push(['Completion flag', q.completeFlag ? esc(nameOf(q.completeFlag, q.completeFlag)) : '<span class="muted">none</span>']);
    if (Array.isArray(q.rewards) && q.rewards.length) kvp.push(['Rewards', esc(q.rewards.map(function (r) { return (r.qty > 1 ? r.qty + ' x ' : '') + nameOf(r.item, r.item); }).join(', '))]);
    var reads = Array.isArray(q.reads) ? q.reads : [];
    kvp.push(['Reads', reads.length ? esc(reads.map(function (f) { return nameOf(f, f); }).join(', ')) : '<span class="muted">no flags</span>']);
    kvp.push(['Origin', esc(q.origin === 'user' ? 'Made by hand' : 'Generated')]);
    body.appendChild(el('div', null, UI().kv(kvp)));
    if (q.notes) body.appendChild(el('p', 'muted qs-notes', esc(q.notes)));
    var selKey = st.sel[q.id];
    if (!stages.some(function (x) { return x.key === selKey; })) selKey = stages.length ? stages[0].key : null;
    var scroller = el('div', 'qs-scroll'); scroller.tabIndex = 0; scroller.setAttribute('role', 'region'); scroller.setAttribute('aria-label', 'Picture of ' + q.name + ', scrolls sideways');
    scroller.appendChild(drawMachine(q, selKey, function (key) { st.sel[q.id] = key; st.open[q.id] = true; redraw(); }));
    body.appendChild(scroller);
    if (U.isObj(q.fail) && q.fail.cond) body.appendChild(el('p', 'qs-failline', esc('Fails when ' + Q.condText(q.fail.cond) + '.')));
    var chips = el('div', 'fg-filter qs-stagebar');
    stages.forEach(function (x, i) {
      var bt = el('button', 'btn', esc((i + 1) + '. ' + x.label)); bt.type = 'button'; bt.setAttribute('aria-pressed', x.key === selKey ? 'true' : 'false');
      bt.addEventListener('click', function () { st.sel[q.id] = x.key; redraw(); });
      chips.appendChild(bt);
    });
    body.appendChild(chips);
    var idx = -1; stages.forEach(function (x, i) { if (x.key === selKey) idx = i; });
    if (idx >= 0) body.appendChild(stageEditor(q, stages[idx], idx, b));
    (Array.isArray(q.branches) ? q.branches : []).forEach(function (g) { body.appendChild(groupEditor(q, g)); });
    var more = el('div', 'btn-row');
    more.appendChild(UI().button('Add branch group', 'plus', 'btn-ghost', function () {
      var r = Q.addGroup(q.id, { key: Q.freeGroupKey(q), at: selKey || undefined });
      if (!r.ok) Kit.ui.toast(problemText(r), 'warn'); else redraw();
    }));
    body.appendChild(more);
    body.appendChild(failEditor(q));
    var acts = el('div', 'btn-row fg-bacts');
    acts.appendChild(UI().button('Settings', 'edit', '', function () { settingsDialog(q); }));
    if (q.origin === 'generated') acts.appendChild(UI().button('Reset to generated', null, 'btn-ghost', function () {
      Kit.ui.confirm({ title: 'Reset this quest?', okLabel: 'Reset quest', message: 'Your edits to "' + q.name + '" are replaced by what the world asks for.' }).then(function (ok) {
        if (!ok) return;
        var r = Q.reset(q.id);
        if (!r.ok) Kit.ui.toast(r.message, 'warn'); else { Kit.ui.toast('Quest reset.', 'ok'); redraw(); }
      });
    }));
    acts.appendChild(UI().button('Delete', 'trash', 'btn-danger', function () { deleteQuest(q); }));
    body.appendChild(acts);
  }

  // ---------------------------------------------------------------- the tab
  function render(host) {
    var b = cur(), sum = Q.summary(b), ex = Q.expected(b), settings = b.story.settings && b.story.settings.scaffold || {};
    var head = el('section', 'panel');
    head.innerHTML = '<h2 class="panel-title">Quests</h2><p class="muted fg-lead">A quest is a small state machine. It moves through its stages in order, an exclusive branch group closes the outcomes not chosen, and a failure rule can end it early. The engine reads each stage\'s exit condition after every event, so a quest can follow the world without a script. Build quests from the world, then edit any of them.</p>';
    head.appendChild(el('div', 'fg-stats', UI().chip('chip-accent', plural(sum.total, 'quest')) + ' ' + UI().chip('chip-muted', sum.byKind.main + ' main') + ' ' + UI().chip('chip-muted', sum.byKind.side + ' side') + ' ' + UI().chip('chip-muted', sum.byKind.bstory + ' B story') +
      ' ' + UI().chip('chip-muted', plural(sum.stages, 'stage')) + (sum.groups ? ' ' + UI().chip('chip-muted', plural(sum.groups, 'branch group')) : '') + (sum.authored ? ' ' + UI().chip('chip-muted', sum.authored + ' made by hand') : '') +
      (ex.missing ? ' ' + UI().chip('chip-warning', ex.missing + ' not built yet', 'The world, the seeds, and the Charter ask for quests that do not exist yet.') : sum.total ? ' ' + UI().chip('chip-ok', 'up to date') : '')));
    var row = el('div', 'btn-row');
    row.appendChild(UI().button(sum.total ? 'Update quests' : 'Build quests from the world', 'check', ex.missing || !sum.total ? 'btn-primary' : '', function () {
      var rep = Q.scaffold();
      Kit.ui.toast(Q.reportText(rep), rep.skipped ? 'warn' : 'ok', 5000);
      redraw();
    }));
    row.appendChild(UI().button('Add quest', 'plus', '', function () { settingsDialog(null); }));
    head.appendChild(row);
    var tg = el('div', 'qs-toggles');
    tg.appendChild(UI().toggle('Build a side quest for each seed', settings.sideQuests !== false, function (on) { Q.setScaffold('sideQuests', on); redraw(); }));
    tg.appendChild(UI().toggle('Build a B story for each character with one', settings.bStories !== false, function (on) { Q.setScaffold('bStories', on); redraw(); }));
    head.appendChild(tg);
    host.appendChild(head);

    var list = el('section', 'panel fg-card'), recs = Q.list(b);
    list.appendChild(el('h3', 'section-h', 'All quests'));
    var bar = el('div', 'fg-filter');
    FILTERS.forEach(function (f) {
      var bt = el('button', 'btn', esc(f[1])); bt.type = 'button'; bt.setAttribute('aria-pressed', st.filter === f[0] ? 'true' : 'false');
      bt.addEventListener('click', function () { st.filter = f[0]; Array.prototype.forEach.call(bar.children, function (c, i) { c.setAttribute('aria-pressed', FILTERS[i][0] === st.filter ? 'true' : 'false'); }); paint(); });
      bar.appendChild(bt);
    });
    list.appendChild(bar);
    var items = el('div', 'fg-list'), count = el('p', 'muted fg-count');
    list.appendChild(count); list.appendChild(items);
    function paint() {
      U.clear(items);
      var shown = recs.filter(function (q) { return st.filter === 'all' ? true : st.filter === 'yours' ? q.origin === 'user' : q.kind === st.filter; });
      count.textContent = shown.length === recs.length ? plural(recs.length, 'quest') : shown.length + ' of ' + plural(recs.length, 'quest');
      if (!shown.length) items.appendChild(el('div', 'empty-line', recs.length ? 'No quest matches.' : 'No quests yet. Build quests from the world to get one main quest for each chapter.'));
      shown.forEach(function (q) { items.appendChild(questItem(q, b)); });
    }
    paint();
    host.appendChild(list);
    if (st.focus) {
      var id = st.focus, node = host.querySelector('[data-qst="' + id + '"]');
      st.focus = null;
      if (node) { if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' }); var hb = node.querySelector('.fg-head'); if (hb) try { hb.focus({ preventScroll: true }); } catch (e) { /* no focus */ } }
    }
  }
  function focus(rid) {
    if (!rid) return;
    st.open[rid] = true; st.filter = 'all'; st.focus = rid;
    Kit.rerender();
  }
  STORY.WS = STORY.WS || {};
  STORY.WS.quests = { render: render, focus: focus };
  Kit.jump.register({ test: function (rid) { return Kit.ids.prefixOf(rid) === 'qst_'; }, name: function (rid) { return nameOf(rid, rid); }, go: function (rid) { if (!Kit.go('quests')) return false; focus(rid); return true; } });
})();
// === WS:QUESTS END ===
