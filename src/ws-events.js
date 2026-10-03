// === WS:EVENTS BEGIN ===
(function () {
  'use strict';
  // The Events tab: every evt_ record with its pages (a condition, once, and a nested command list), the empty boss slot
  // troops, a golden path preview, and a text playtester that drives the real engine one stop at a time, with a live flag
  // and quest inspector, Win, Lose, and Escape for battles, and Back through every recorded state.
  // Logic lives in STORY.events (src/story-events.js) and ENGINE_STORY; conditions use STORY.condUI (src/ws-cond.js).
  var U = Kit.util, el = U.el, esc = U.esc, E = STORY.events, ES = ENGINE_STORY;
  function cur() { return Kit.bundle.current(); }
  function UI() { return STORY.ui; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function nameOf(id, fb) { return STORY.nameOf ? STORY.nameOf(id, fb) : (fb || id || ''); }
  function chName(id) { var c = STORY.chapters().filter(function (x) { return x.id === id; })[0]; return c ? c.name || id : id; }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  var st = STORY.eventsUi = { filter: 'all', open: {}, page: {}, focus: null, golden: null, pt: { evt: '', page: '', chapter: '', quests: {}, carry: false, all: false, sess: null } };
  var FILTERS = [['all', 'All'], ['open', 'Openers'], ['talk', 'Talk'], ['prize', 'Seals'], ['boss', 'Bosses'], ['exit', 'Exits'], ['finale', 'Finale'], ['custom', 'Yours']];

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
  function textInput(value, label, max) { var i = el('input', 'inp'); i.type = 'text'; i.value = value || ''; i.maxLength = max || 160; i.setAttribute('aria-label', label); return i; }
  function numInput(value, label) { var i = el('input', 'inp ev-num'); i.type = 'number'; i.step = '1'; i.inputMode = 'numeric'; i.value = value === undefined || value === null ? '' : String(value); i.setAttribute('aria-label', label); return i; }
  function intOf(inp, d) { var v = Math.round(Number(inp.value)); return inp.value.trim() === '' || !isFinite(v) ? d : v; }
  function selectOf(options, value, label) {
    var s = el('select', 'inp'); s.setAttribute('aria-label', label);
    options.forEach(function (o) { var op = el('option', null, esc(o[1])); op.value = o[0]; s.appendChild(op); });
    s.value = value;
    return s;
  }
  // A button that opens the record picker; holder.v keeps the choice. Optional choices get a Clear button.
  function pickField(label, holder, key, prefix, empty, opts) {
    opts = opts || {};
    var row = el('div', 'ev-pickrow'), b = el('button', 'btn ev-pick' + (holder[key] ? '' : ' ev-empty')); b.type = 'button';
    function paint() { b.textContent = holder[key] ? nameOf(holder[key], holder[key]) : empty; b.classList.toggle('ev-empty', !holder[key]); b.setAttribute('aria-label', label + ': ' + (holder[key] ? nameOf(holder[key], holder[key]) : 'none chosen')); }
    b.addEventListener('click', function () { Kit.ui.pickRef({ prefix: prefix, title: label, current: holder[key] }).then(function (v) { if (v) { holder[key] = v; paint(); if (opts.onPick) opts.onPick(v); } }); });
    row.appendChild(b);
    if (opts.clear) { var c = el('button', 'btn btn-ghost', 'Clear'); c.type = 'button'; c.setAttribute('aria-label', 'Clear ' + label); c.addEventListener('click', function () { holder[key] = ''; paint(); if (opts.onPick) opts.onPick(''); }); row.appendChild(c); }
    paint();
    return field(label, row, opts.help);
  }
  function chapterOptions(blank) { return [['', blank || 'No chapter']].concat(STORY.chapters().map(function (c) { return [c.id, c.name || c.id]; })); }

  // ---------------------------------------------------------------- one command, in a dialog
  var DIRS = [['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right']];
  function whoField(holder) {
    var box = el('div'), mode = selectOf([['player', 'The player'], ['npc', 'A person']], holder.who && holder.who !== 'player' ? 'npc' : 'player', 'Who');
    var pick = el('div');
    function paint() { U.clear(pick); if (mode.value === 'npc') { if (holder.who === 'player') holder.who = ''; pick.appendChild(pickField('Person', holder, 'who', 'npc_', 'Choose a person')); } else holder.who = 'player'; }
    mode.addEventListener('change', paint);
    box.appendChild(field('Who', mode)); box.appendChild(pick); paint();
    return box;
  }
  // Fills body with the fields of command c (a working copy) and returns a function that reads them back into c.
  function cmdFields(body, c) {
    var reads = [];
    function add(f, read) { body.appendChild(f); if (read) reads.push(read); }
    switch (c.op) {
      case 'text': {
        var sp = { v: /^(chr|npc)_/.test(c.speaker || '') ? c.speaker : '' }, nm = textInput(sp.v ? '' : c.speaker || '', 'Speaker name', 60);
        add(pickField('Speaker (a character or person)', sp, 'v', ['chr_', 'npc_'], 'Narration, or the name below', { clear: true }));
        add(field('Or a plain speaker name', nm, 'Leave both empty for narration.'));
        var por = { v: c.por || '' }; add(pickField('Portrait', por, 'v', 'por_', 'No portrait', { clear: true }));
        var ta = el('textarea', 'inp ev-lines'); ta.value = (c.lines || []).join('\n'); ta.setAttribute('aria-label', 'Lines, one per line');
        add(field('Lines', ta, 'One line of text per line.'), function () {
          var sv = sp.v || nm.value.trim(); if (sv) c.speaker = sv; else delete c.speaker;
          if (por.v) c.por = por.v; else delete c.por;
          c.lines = ta.value.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return !!l; });
        });
        break;
      }
      case 'choice': {
        var pr = textInput(c.prompt || '', 'Prompt', 160);
        add(field('Prompt', pr, 'Optional words shown above the options.'));
        var opts = (c.options || []).map(function (o) { return { text: o.text || '', cond: o.cond === undefined ? null : clone(o.cond), cmds: Array.isArray(o.cmds) ? o.cmds : [] }; });
        var box = el('div', 'ev-opts');
        var cancel = { v: c.cancel === undefined ? '' : String(c.cancel) };
        function paint() {
          U.clear(box);
          opts.forEach(function (o, i) {
            var row = el('div', 'ev-opt'), t = textInput(o.text, 'Option ' + (i + 1), 120);
            t.addEventListener('input', function () { o.text = t.value; });
            row.appendChild(field('Option ' + (i + 1), t));
            var cb = el('div', 'ev-cond'); STORY.condUI.mount(cb, o.cond, function (tr) { o.cond = tr; }, { nullable: true, emptyText: 'Always shown.', addLabel: 'Show only when' });
            row.appendChild(cb);
            var bar = el('div', 'btn-row');
            [['Up', -1], ['Down', 1]].forEach(function (m) { var bb = el('button', 'btn btn-ghost', esc(m[0])); bb.type = 'button'; bb.disabled = i + m[1] < 0 || i + m[1] >= opts.length; bb.setAttribute('aria-label', 'Move option ' + (i + 1) + ' ' + m[0].toLowerCase()); bb.addEventListener('click', function () { var x = opts[i]; opts[i] = opts[i + m[1]]; opts[i + m[1]] = x; paint(); }); bar.appendChild(bb); });
            var rm = el('button', 'btn btn-ghost', 'Remove'); rm.type = 'button'; rm.disabled = opts.length < 2; rm.setAttribute('aria-label', 'Remove option ' + (i + 1));
            rm.addEventListener('click', function () { opts.splice(i, 1); paint(); }); bar.appendChild(rm);
            row.appendChild(bar);
            box.appendChild(row);
          });
          var ad = el('button', 'btn', '+ Option'); ad.type = 'button'; ad.setAttribute('aria-label', 'Add an option');
          ad.addEventListener('click', function () { opts.push({ text: 'Option ' + (opts.length + 1), cond: null, cmds: [] }); paint(); });
          box.appendChild(ad);
        }
        paint();
        add(field('Options', box, 'Each option runs its own commands, edited in the block under the choice. An option whose condition fails is hidden.'));
        var cs = selectOf([['', 'Cannot be cancelled']].concat(opts.map(function (o, i) { return [String(i), 'Cancel picks option ' + (i + 1)]; })), cancel.v, 'Cancel');
        add(field('Cancel', cs), function () {
          c.prompt = pr.value.trim(); if (!c.prompt) delete c.prompt;
          c.options = opts.map(function (o) { var x = { text: o.text.trim() || 'Option', cmds: o.cmds }; if (o.cond) x.cond = o.cond; return x; });
          if (cs.value !== '' && Number(cs.value) < c.options.length) c.cancel = Number(cs.value); else delete c.cancel;
        });
        break;
      }
      case 'if': {
        var holder = { t: c.cond === undefined ? null : clone(c.cond) }, cb = el('div', 'ev-cond');
        STORY.condUI.mount(cb, holder.t, function (tr) { holder.t = tr; }, { nullable: true, emptyText: 'No condition: then always runs.', addLabel: 'Add a condition' });
        add(field('Condition', cb, 'Then runs when it passes, Else when it does not. Both are edited in the blocks under the if.'), function () { if (holder.t) c.cond = holder.t; else delete c.cond; });
        break;
      }
      case 'setFlag': case 'addFlag': {
        var f = { v: c.flg || '' }, n = numInput(c.op === 'setFlag' ? (c.value === undefined ? 1 : c.value) : (c.by === undefined ? 1 : c.by), c.op === 'setFlag' ? 'Value' : 'Add');
        add(pickField('Flag', f, 'v', 'flg_', 'Choose a flag'));
        add(field(c.op === 'setFlag' ? 'Value' : 'Add (negative to subtract)', n), function () { c.flg = f.v; if (c.op === 'setFlag') c.value = intOf(n, 1); else c.by = intOf(n, 1); });
        break;
      }
      case 'giveItem': case 'takeItem': {
        var it = { v: c.itm || '' }, q = numInput(c.qty || 1, 'Quantity');
        add(pickField('Item or equipment', it, 'v', ['itm_', 'eqp_'], 'Choose an item'));
        add(field('Quantity', q), function () { c.itm = it.v; c.qty = Math.max(1, intOf(q, 1)); });
        break;
      }
      case 'gil': { var g = numInput(c.by || 0, 'Gil'); add(field('Gil (negative to take)', g), function () { c.by = intOf(g, 0); }); break; }
      case 'questStage': {
        var qs = { v: c.qst || '' }, mode = c.fail ? 'fail' : c.branch !== undefined ? 'branch' : 'stage', part = el('div');
        var mSel = selectOf([['stage', 'Move to a stage'], ['branch', 'Commit a branch'], ['fail', 'Fail the quest']], mode, 'What happens');
        var pick = { stage: c.stage || '', branch: c.branch || '', outcome: c.outcome || '' };
        function paintQ() {
          U.clear(part);
          var q0 = qs.v && cur().story.records.qst_[qs.v];
          if (!q0 || mSel.value === 'fail') return;
          if (mSel.value === 'stage') {
            var s1 = selectOf((q0.stages || []).map(function (s) { return [s.key, s.label || s.key]; }), pick.stage || ((q0.stages || [])[0] || {}).key || '', 'Stage');
            pick.stage = s1.value; s1.addEventListener('change', function () { pick.stage = s1.value; });
            part.appendChild(field('Stage', s1, 'Stages only move forward; skipped stages apply what they set.'));
          } else {
            var opts2 = []; (q0.branches || []).forEach(function (g0) { (g0.outcomes || []).forEach(function (o) { opts2.push([g0.key + '|' + o.key, (g0.label || g0.key) + ': ' + (o.label || o.key)]); }); });
            if (!opts2.length) { part.appendChild(el('p', 'muted', 'This quest has no branch groups. Add one in Quests.')); return; }
            var cur0 = pick.branch ? pick.branch + '|' + pick.outcome : opts2[0][0], s2 = selectOf(opts2, cur0, 'Outcome');
            var setB = function () { var p = s2.value.split('|'); pick.branch = p[0]; pick.outcome = p[1]; };
            setB(); s2.addEventListener('change', setB);
            part.appendChild(field('Outcome', s2, 'Committing one outcome closes the rest of its group for good.'));
          }
        }
        add(pickField('Quest', qs, 'v', 'qst_', 'Choose a quest', { onPick: function () { pick.stage = ''; pick.branch = ''; paintQ(); } }));
        mSel.addEventListener('change', paintQ);
        add(field('What happens', mSel)); add(part); paintQ();
        reads.push(function () {
          var o = { op: 'questStage', qst: qs.v };
          if (mSel.value === 'fail') o.fail = true; else if (mSel.value === 'branch') { o.branch = pick.branch; o.outcome = pick.outcome; } else o.stage = pick.stage;
          Object.keys(c).forEach(function (k) { delete c[k]; }); Object.keys(o).forEach(function (k) { c[k] = o[k]; });
        });
        break;
      }
      case 'party': {
        var ch = { v: c.chr || '' }, act = selectOf([['join', 'Joins the party'], ['leave', 'Leaves the party']], c.act || 'join', 'Joins or leaves');
        add(pickField('Character', ch, 'v', 'chr_', 'Choose a character'));
        add(field('Joins or leaves', act), function () { c.chr = ch.v; c.act = act.value; });
        break;
      }
      case 'startBattle': {
        var tp = { v: c.trp || '' }, lose = el('input'), esc0 = el('input');
        lose.type = 'checkbox'; lose.checked = Array.isArray(c.lose); esc0.type = 'checkbox'; esc0.checked = Array.isArray(c.escape);
        add(pickField('Troop', tp, 'v', 'trp_', 'Choose a troop'));
        var l1 = el('label', 'ev-check'); l1.appendChild(lose); l1.appendChild(el('span', null, 'A loss runs its own commands (otherwise a loss is game over)'));
        var l2 = el('label', 'ev-check'); l2.appendChild(esc0); l2.appendChild(el('span', null, 'The party may escape (and escaping runs its own commands)'));
        add(l1); add(l2, function () {
          c.trp = tp.v; if (!Array.isArray(c.win)) c.win = [];
          if (lose.checked) { if (!Array.isArray(c.lose)) c.lose = []; } else delete c.lose;
          if (esc0.checked) { if (!Array.isArray(c.escape)) c.escape = []; } else delete c.escape;
        });
        break;
      }
      case 'moveActor': case 'face': {
        var w = { who: c.who || 'player' }; add(whoField(w));
        if (c.op === 'face') { var d = selectOf(DIRS, c.dir || 'down', 'Direction'); add(field('Direction', d), function () { c.who = w.who; c.dir = d.value; }); }
        else { var pth = textInput((c.path || []).join(' '), 'Path', 200); add(field('Path', pth, 'Steps separated by spaces: up, down, left, right.'), function () { c.who = w.who; c.path = pth.value.toLowerCase().split(/[\s,]+/).filter(function (x) { return !!x; }); }); }
        break;
      }
      case 'wait': { var fr = numInput(c.frames || 30, 'Frames'); add(field('Frames (60 is about one second)', fr), function () { c.frames = intOf(fr, 30); }); break; }
      case 'fade': {
        var to = selectOf([['out', 'Fade out'], ['in', 'Fade in']], c.to || 'out', 'Fade'), ff = numInput(c.frames || 30, 'Frames');
        add(field('Fade', to)); add(field('Frames', ff), function () { c.to = to.value; c.frames = intOf(ff, 30); });
        break;
      }
      case 'music': {
        var md = selectOf([['role', 'A music role'], ['mus', 'A specific track'], ['stop', 'Stop the music']], c.stop ? 'stop' : c.mus ? 'mus' : 'role', 'Music'), mp = el('div');
        var mh = { mus: c.mus || '' }, roles = E.musicRoles(), rs = selectOf(roles.map(function (r) { return [r, r]; }).concat(c.role && roles.indexOf(c.role) < 0 ? [[c.role, c.role + ' (not a Day 147 role)']] : []), c.role || roles[0], 'Role');
        function paintM() { U.clear(mp); if (md.value === 'role') mp.appendChild(field('Role', rs, 'Day 147 scores music by role: town, dungeon, battle, boss, victory, field:<continent>, ending:<n>.')); else if (md.value === 'mus') mp.appendChild(pickField('Track', mh, 'mus', 'mus_', 'Choose a track')); }
        md.addEventListener('change', paintM);
        add(field('Music', md)); add(mp); paintM();
        reads.push(function () { delete c.role; delete c.mus; delete c.stop; if (md.value === 'stop') c.stop = true; else if (md.value === 'mus') c.mus = mh.mus; else c.role = rs.value; });
        break;
      }
      case 'sfx': { var sx = { v: c.sfx || '' }; add(pickField('Sound', sx, 'v', 'sfx_', 'Choose a sound'), function () { c.sfx = sx.v; }); break; }
      case 'changeMap': {
        var mm = { v: c.map || '' }, x = numInput((c.at || [0, 0])[0], 'X'), y = numInput((c.at || [0, 0])[1], 'Y'), dr = selectOf(DIRS, c.dir || 'down', 'Facing');
        add(pickField('Map', mm, 'v', 'map_', 'Choose a map'));
        var xy = el('div', 'ev-xy'); xy.appendChild(field('X', x)); xy.appendChild(field('Y', y)); xy.appendChild(field('Facing', dr));
        add(xy, function () { c.map = mm.v; c.at = [Math.max(0, intOf(x, 0)), Math.max(0, intOf(y, 0))]; c.dir = dr.value; });
        break;
      }
      case 'vehicle': {
        var vk = selectOf([['ship', 'Ship'], ['airship', 'Airship']], c.kind || 'ship', 'Vehicle'), va = selectOf([['board', 'Board'], ['leave', 'Leave']], c.act || 'board', 'Board or leave');
        add(field('Vehicle', vk)); add(field('Board or leave', va), function () { c.kind = vk.value; c.act = va.value; });
        break;
      }
      case 'callEvent': { var ev = { v: c.evt || '' }; add(pickField('Event to run', ev, 'v', 'evt_', 'Choose an event', { help: 'Runs that event\'s active page, then carries on here.' }), function () { c.evt = ev.v; }); break; }
      case 'ending': { var en = { v: c.end || '' }; add(pickField('Ending', en, 'v', 'end_', 'Choose an ending', { help: 'Endings arrive in Phase 6.' }), function () { c.end = en.v; }); break; }
      default: body.appendChild(el('p', 'muted', 'This command cannot be edited here.'));
    }
    return function () { reads.forEach(function (r) { r(); }); return c; };
  }
  // Opens the editor for command c; save(cmd) commits and returns a result {ok, problems}. The dialog stays open on a refusal.
  function cmdDialog(title, c, save) {
    var work = clone(c), body = el('div', 'ev-dlg'), read = cmdFields(body, work), msg = el('div', 'field-msg');
    body.appendChild(msg);
    Kit.ui.dialog({ title: title, body: body, actions: [
      { label: 'Cancel', kind: 'ghost', value: null },
      { label: 'Save', kind: 'primary', onClick: function () {
        var r = save(read());
        if (!r.ok) { msg.innerHTML = '<span class="msg msg-error">' + esc(problemText(r)) + '</span>'; return false; }
        redraw();
      } }] });
  }

  // ---------------------------------------------------------------- the command tree
  function opSelect() {
    var s = el('select', 'inp ev-opsel'); s.setAttribute('aria-label', 'Kind of command');
    E.OP_GROUPS.forEach(function (g) { var og = el('optgroup'); og.label = g[0]; g[1].forEach(function (op) { var o = el('option', null, esc(E.OP_LABEL[op])); o.value = op; og.appendChild(o); }); s.appendChild(og); });
    s.value = 'text';
    return s;
  }
  function adder(listPath, list, commit) {
    var row = el('div', 'ev-adder'), s = opSelect();
    row.appendChild(s);
    row.appendChild(UI().button('Add', 'plus', '', function () {
      cmdDialog('New: ' + E.OP_LABEL[s.value], E.blank(s.value), function (c) {
        var n = E.tree.insert(list, listPath, null, c);
        return n ? commit(n) : { ok: false, message: 'That list no longer exists.' };
      });
    }));
    return row;
  }
  // Draws list (the page's whole cmds is root) at listPath, recursively.
  function cmdList(root, listPath, commit, depth) {
    var list = E.tree.list(root, listPath) || [], wrap = el('div', 'ev-list' + (depth ? ' ev-nest' : ''));
    if (!list.length) wrap.appendChild(el('p', 'muted ev-none', depth ? 'Nothing here yet.' : 'No commands yet.'));
    list.forEach(function (c, i) {
      var path = listPath.concat([i]), blk = el('div', 'ev-cmd ev-op-' + (U.isObj(c) ? c.op : 'bad'));
      blk.dataset.path = JSON.stringify(path);
      var head = el('div', 'ev-cmd-h');
      head.appendChild(el('span', 'ev-cmd-t', '<b>' + esc(U.isObj(c) && E.OP_LABEL[c.op] ? E.OP_LABEL[c.op] : 'Command') + '</b> ' + esc(E.cmdText(c))));
      var bar = el('span', 'ev-cmd-b');
      var ed = el('button', 'btn btn-ghost ev-mini', 'Edit'); ed.type = 'button'; ed.setAttribute('aria-label', 'Edit command');
      ed.addEventListener('click', function () { cmdDialog('Edit: ' + (E.OP_LABEL[c.op] || c.op), c, function (nc) { var n = E.tree.put(root, path, nc); return n ? commit(n) : { ok: false, message: 'That command no longer exists.' }; }); });
      bar.appendChild(ed);
      [['Up', -1], ['Down', 1]].forEach(function (m) {
        var b = el('button', 'btn btn-ghost ev-mini', esc(m[0])); b.type = 'button'; b.disabled = i + m[1] < 0 || i + m[1] >= list.length;
        b.setAttribute('aria-label', 'Move command ' + m[0].toLowerCase());
        b.addEventListener('click', function () { var n = E.tree.move(root, path, m[1]); if (n) { if (done(commit(n))) redraw(); } });
        bar.appendChild(b);
      });
      var rm = el('button', 'btn btn-ghost ev-mini', 'Remove'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove command');
      rm.addEventListener('click', function () {
        var kids = E.tree.children(c).reduce(function (a, k) { return a + E.tree.count(k.list); }, 0);
        var go = function () { var n = E.tree.remove(root, path); if (n && done(commit(n))) redraw(); };
        if (!kids) { go(); return; }
        Kit.ui.confirm({ title: 'Remove this command?', okLabel: 'Remove', message: 'It holds ' + plural(kids, 'command') + ' that go with it.' }).then(function (ok) { if (ok) go(); });
      });
      bar.appendChild(rm);
      head.appendChild(bar);
      blk.appendChild(head);
      E.tree.children(c).forEach(function (k) {
        var kid = el('div', 'ev-kid');
        kid.appendChild(el('div', 'ev-kid-h', esc(k.label)));
        kid.appendChild(cmdList(root, path.concat(k.seg), commit, (depth || 0) + 1));
        blk.appendChild(kid);
      });
      wrap.appendChild(blk);
    });
    wrap.appendChild(adder(listPath, root, commit));
    return wrap;
  }

  // ---------------------------------------------------------------- one event
  var NEEDS = { mapEnter: ['map'], step: ['map', 'at'], autorun: ['map'], talk: ['npc'], battleEnd: ['trp'], chapterStart: [] };
  function siteFields(body, h) {
    var trig = selectOf(E.TRIGGERS.map(function (t) { return [t, E.TRIGGER_LABEL[t] || t]; }), h.trigger, 'Trigger'), box = el('div');
    var x = numInput(h.at ? h.at[0] : 0, 'X'), y = numInput(h.at ? h.at[1] : 0, 'Y');
    function paint() {
      U.clear(box); h.trigger = trig.value;
      var need = NEEDS[h.trigger] || [];
      if (need.indexOf('map') >= 0) box.appendChild(pickField('Map', h, 'map', 'map_', 'Choose a map'));
      if (need.indexOf('at') >= 0) { var xy = el('div', 'ev-xy'); xy.appendChild(field('X', x)); xy.appendChild(field('Y', y)); box.appendChild(xy); }
      if (need.indexOf('npc') >= 0) box.appendChild(pickField('Person', h, 'npc', 'npc_', 'Choose a person'));
      if (h.trigger === 'battleEnd') box.appendChild(pickField('Troop', h, 'trp', 'trp_', 'Any battle', { clear: true }));
    }
    trig.addEventListener('change', paint);
    body.appendChild(field('Trigger', trig)); body.appendChild(box); paint();
    return function () { var need = NEEDS[h.trigger] || []; h.at = need.indexOf('at') >= 0 ? [Math.max(0, intOf(x, 0)), Math.max(0, intOf(y, 0))] : null; };
  }
  function eventSettings(rec) {
    var body = el('div', 'ev-dlg'), nm = textInput(rec.name, 'Name', 120);
    var h = { trigger: rec.trigger || 'talk', map: rec.map || '', npc: rec.npc || '', trp: rec.trp || '', at: Array.isArray(rec.at) ? rec.at.slice() : null };
    body.appendChild(field('Name', nm));
    var readSite = siteFields(body, h);
    var chs = selectOf(chapterOptions(), rec.chapter || '', 'Chapter'), pr = numInput(rec.priority === undefined ? 0 : rec.priority, 'Priority');
    var notes = el('textarea', 'inp ev-lines'); notes.value = rec.notes || ''; notes.setAttribute('aria-label', 'Note');
    body.appendChild(field('Chapter', chs)); body.appendChild(field('Priority', pr, 'When two events fire on the same spot, the higher one runs first.')); body.appendChild(field('Note', notes));
    var msg = el('div', 'field-msg'); body.appendChild(msg);
    Kit.ui.dialog({ title: 'Event settings', body: body, actions: [
      { label: 'Cancel', kind: 'ghost', value: null },
      { label: 'Save', kind: 'primary', onClick: function () {
        readSite();
        var r = E.update(rec.id, { name: nm.value, trigger: h.trigger, map: h.map || null, npc: h.npc || null, trp: h.trp || null, at: h.at, chapter: chs.value || null, priority: intOf(pr, 0), notes: notes.value });
        if (!r.ok) { msg.innerHTML = '<span class="msg msg-error">' + esc(problemText(r)) + '</span>'; return false; }
        Kit.ui.toast('Event saved.', 'ok'); redraw();
      } }] });
  }
  function addEvent() {
    var body = el('div', 'ev-dlg'), nm = textInput('', 'Name', 120), h = { trigger: 'talk', map: '', npc: '', trp: '', at: null };
    body.appendChild(field('Name', nm));
    var readSite = siteFields(body, h), chs = selectOf(chapterOptions(), '', 'Chapter');
    body.appendChild(field('Chapter', chs));
    var msg = el('div', 'field-msg'); body.appendChild(msg);
    Kit.ui.dialog({ title: 'New event', body: body, actions: [
      { label: 'Cancel', kind: 'ghost', value: null },
      { label: 'Add', kind: 'primary', onClick: function () {
        readSite();
        var r = E.add({ name: nm.value, trigger: h.trigger, map: h.map, npc: h.npc, trp: h.trp, at: h.at, chapter: chs.value });
        if (!r.ok) { msg.innerHTML = '<span class="msg msg-error">' + esc(problemText(r)) + '</span>'; return false; }
        st.open[r.record.id] = true; st.filter = 'all'; st.focus = r.record.id;
        Kit.ui.toast('Event added.', 'ok'); redraw();
      } }] });
  }
  function pageEditor(rec, i) {
    var p = rec.pages[i], box = el('div', 'ev-page');
    box.appendChild(el('h4', 'ev-sub', 'Page ' + (i + 1) + (i === rec.pages.length - 1 && rec.pages.length > 1 ? ', checked first' : '')));
    var cb = el('div', 'ev-cond');
    STORY.condUI.mount(cb, U.isObj(p) && p.cond !== undefined ? p.cond : null, function (t) { if (done(E.updatePage(rec.id, i, { cond: t }))) redraw(); }, { nullable: true, emptyText: 'Always runs (when no later page passes).', addLabel: 'Run only when' });
    box.appendChild(field('Runs when', cb));
    box.appendChild(UI().toggle('Once: runs one time, then steps aside', U.isObj(p) && p.once === true, function (on) { if (done(E.updatePage(rec.id, i, { once: on }))) redraw(); }));
    box.appendChild(el('h4', 'ev-sub', 'Commands'));
    var root = U.isObj(p) && Array.isArray(p.cmds) ? p.cmds : [];
    box.appendChild(cmdList(root, [], function (n) { return E.setCmds(rec.id, i, n); }, 0));
    var bar = el('div', 'btn-row ev-pagebar');
    bar.appendChild(UI().button('Move left', null, 'btn-ghost', function () { if (done(E.movePage(rec.id, i, -1))) { st.page[rec.id] = i - 1; redraw(); } }));
    bar.appendChild(UI().button('Move right', null, 'btn-ghost', function () { if (done(E.movePage(rec.id, i, 1))) { st.page[rec.id] = i + 1; redraw(); } }));
    bar.appendChild(UI().button('Remove page', 'trash', 'btn-ghost', function () { if (done(E.removePage(rec.id, i))) { st.page[rec.id] = Math.max(0, i - 1); redraw(); } }));
    if (i === 0) bar.firstChild.disabled = true;
    if (i === rec.pages.length - 1) bar.children[1].disabled = true;
    if (rec.pages.length < 2) bar.children[2].disabled = true;
    box.appendChild(bar);
    return box;
  }
  function fillEvent(body, rec, b) {
    var idx = STORY.engineIndex(b), probs = E.check(rec, b, idx).filter(function (p) { return p.level === 'error' || p.level === 'warning'; });
    var kvp = [['ID', '<code class="id">' + esc(rec.id) + '</code>'], ['Fires', esc(E.whereText(rec))]];
    if (rec.chapter) kvp.push(['Chapter', esc(chName(rec.chapter))]);
    kvp.push(['Priority', esc(rec.priority === undefined ? 0 : rec.priority)]);
    if (rec.dgn) kvp.push(['Boss of', esc(nameOf(rec.dgn, rec.dgn)) + (rec.slot ? ' ' + UI().chip('chip-warning', 'empty slot filled by the story') : '')]);
    var users = E.usedBy(rec.id, b);
    if (users.length) kvp.push(['Run by', esc(users.map(function (u) { return u.name; }).join(', '))]);
    body.appendChild(el('div', null, UI().kv(kvp)));
    if (rec.notes) body.appendChild(el('p', 'muted ev-notes', esc(rec.notes)));
    if (probs.length) { var pl = el('ul', 'ev-probs'); probs.slice(0, 8).forEach(function (p) { pl.appendChild(el('li', p.level === 'error' ? 'ev-err' : 'ev-warn', esc(p.message))); }); body.appendChild(pl); }
    var pages = Array.isArray(rec.pages) ? rec.pages : [], sel = Math.min(st.page[rec.id] === undefined ? pages.length - 1 : st.page[rec.id], Math.max(0, pages.length - 1));
    var tabs = el('div', 'fg-filter ev-pages');
    pages.forEach(function (p, i) {
      var bt = el('button', 'btn', esc('Page ' + (i + 1) + (U.isObj(p) && p.once ? ' (once)' : ''))); bt.type = 'button'; bt.setAttribute('aria-pressed', i === sel ? 'true' : 'false');
      bt.addEventListener('click', function () { st.page[rec.id] = i; redraw(); });
      tabs.appendChild(bt);
    });
    var ap = el('button', 'btn btn-ghost', '+ Page'); ap.type = 'button'; ap.setAttribute('aria-label', 'Add a page');
    ap.addEventListener('click', function () { if (done(E.addPage(rec.id, { cmds: [] }))) { st.page[rec.id] = pages.length; redraw(); } });
    tabs.appendChild(ap);
    body.appendChild(tabs);
    if (pages.length) body.appendChild(pageEditor(rec, sel));
    var acts = el('div', 'btn-row fg-bacts');
    acts.appendChild(UI().button('Play', 'play', 'btn-primary', function () { st.pt.evt = rec.id; st.pt.page = ''; startPlay(); redraw(); var pv = document.getElementById('evPlay'); if (pv && typeof pv.scrollIntoView === 'function') pv.scrollIntoView({ block: 'start' }); }));
    acts.appendChild(UI().button('Settings', 'edit', '', function () { eventSettings(rec); }));
    if (rec.origin === 'generated' && E.isEdited(rec)) acts.appendChild(UI().button('Reset to generated', null, 'btn-ghost', function () {
      Kit.ui.confirm({ title: 'Reset this event?', okLabel: 'Reset event', message: 'Your edits to "' + rec.name + '" are replaced by what the world asks for.' }).then(function (ok) { if (!ok) return; var r = E.reset(rec.id); if (r.ok) { Kit.ui.toast('Event reset.', 'ok'); redraw(); } else Kit.ui.toast(r.message, 'warn'); });
    }));
    acts.appendChild(UI().button('Delete', 'trash', 'btn-danger', function () {
      Kit.ui.confirm({ title: 'Delete ' + rec.name + '?', okLabel: 'Delete event', message: users.length ? plural(users.length, 'event') + ' run it and will point at nothing.' : rec.origin === 'generated' ? 'The next build makes it again.' : 'Nothing runs it.' }).then(function (ok) { if (!ok) return; if (E.remove(rec.id).ok) { Kit.ui.toast('Event deleted.', 'ok'); redraw(); } });
    }));
    body.appendChild(acts);
  }
  function eventItem(rec, b, idx) {
    var wrap = el('div', 'fg-item ev-item'), open = !!st.open[rec.id], err = E.check(rec, b, idx).some(function (p) { return p.level === 'error'; });
    wrap.dataset.evt = rec.id;
    var meta = UI().chip('chip-accent', E.KIND_LABEL[rec.kind] || 'Event') + ' ' + UI().chip('chip-muted', E.TRIGGER_LABEL[rec.trigger] || String(rec.trigger)) + (rec.chapter ? ' ' + UI().chip('chip-muted', chName(rec.chapter)) : '') + ' ' + UI().chip('chip-muted', plural((rec.pages || []).length, 'page')) +
      (rec.origin === 'user' ? ' ' + UI().chip('chip-muted', 'yours') : E.isEdited(rec) ? ' ' + UI().chip('chip-muted', 'edited') : '') + (err ? ' ' + UI().chip('chip-error', 'error') : '');
    var head = el('button', 'btn fg-head', '<span class="fg-name">' + esc(rec.name) + '</span><span class="fg-meta">' + meta + '</span>');
    head.type = 'button'; head.setAttribute('aria-expanded', open ? 'true' : 'false');
    var body = el('div', 'fg-body'); body.hidden = !open;
    if (open) fillEvent(body, rec, b);
    head.addEventListener('click', function () {
      st.open[rec.id] = body.hidden;
      if (body.hidden && !body.firstChild) fillEvent(body, rec, b);
      body.hidden = !body.hidden; head.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
    });
    wrap.appendChild(head); wrap.appendChild(body);
    return wrap;
  }

  // ---------------------------------------------------------------- the playtester
  function startState() {
    var pt = st.pt, last = pt.sess && E.session.current(pt.sess);
    if (pt.carry && last && last.state && !last.state.run && !last.state.ending) return last.state;
    return E.playState(cur(), { chapter: pt.chapter || null, quests: pt.quests });
  }
  function startPlay() {
    var pt = st.pt;
    if (!pt.evt || !cur().story.records.evt_[pt.evt]) { Kit.ui.toast('Choose an event to play.', 'warn'); return; }
    pt.sess = E.session.begin(cur(), pt.evt, startState(), pt.page === '' ? null : { page: Number(pt.page) });
  }
  function inspector(state, idx) {
    var info = E.inspect(state, idx), box = el('div', 'ev-insp');
    box.appendChild(el('h4', 'ev-sub', 'Inspector'));
    box.appendChild(el('div', null, UI().kv([['Chapter', esc(info.chapterName || 'none')], ['Gil', esc(info.gil)], ['Party', esc(info.party.map(function (p) { return nameOf(p, p); }).join(', ') || 'nobody')],
      ['Items', esc(info.items.map(function (i) { return i.qty + ' ' + i.name; }).join(', ') || 'none')], ['Ending', esc(info.ending ? nameOf(info.ending, info.ending) : 'not yet')]])));
    var qs = info.quests.filter(function (q) { return st.pt.all || q.stage !== null || q.failed; });
    var qt = el('div', 'ev-insp-list');
    qt.appendChild(el('div', 'ev-insp-h', 'Quests' + (st.pt.all ? '' : ' (started)')));
    if (!qs.length) qt.appendChild(el('p', 'muted ev-none', 'No quest has started.'));
    qs.forEach(function (q) { qt.appendChild(el('div', 'ev-insp-row' + (q.done ? ' ev-ok' : q.failed ? ' ev-err' : ''), '<span>' + esc(q.name) + '</span><span>' + esc(q.failed ? 'failed' : q.label) + (q.closed.length ? esc(' (closed ' + q.closed.join(', ') + ')') : '') + '</span>')); });
    box.appendChild(qt);
    var fs = info.flags.filter(function (f) { return st.pt.all || f.changed; });
    var ft = el('div', 'ev-insp-list');
    ft.appendChild(el('div', 'ev-insp-h', 'Flags' + (st.pt.all ? '' : ' (not at their default)')));
    if (!fs.length) ft.appendChild(el('p', 'muted ev-none', 'Every flag is at its default.'));
    fs.forEach(function (f) { ft.appendChild(el('div', 'ev-insp-row' + (f.changed ? ' ev-chg' : ''), '<span>' + esc(f.name) + '</span><span>' + esc(f.value) + '</span>')); });
    box.appendChild(ft);
    box.appendChild(UI().toggle('Show every quest and flag', st.pt.all, function (on) { st.pt.all = on; redraw(); }));
    return box;
  }
  function playPanel(host, b) {
    var pt = st.pt, box = el('section', 'panel fg-card ev-play'); box.id = 'evPlay';
    box.appendChild(el('h3', 'section-h', 'Playtester'));
    box.appendChild(el('p', 'muted', 'Plays an event through the real engine, one stop at a time. Battles wait for you to say how they went; Back returns to the state before the last stop.'));
    var evs = E.list(b), row = el('div', 'ev-pvrow');
    var es = selectOf([['', 'Choose an event']].concat(evs.map(function (e) { return [e.id, e.name]; })), pt.evt, 'Event to play');
    es.addEventListener('change', function () { pt.evt = es.value; pt.page = ''; redraw(); });
    row.appendChild(field('Event', es));
    var rec = pt.evt && b.story.records.evt_[pt.evt];
    var ps = selectOf([['', 'The page the story picks']].concat((rec && rec.pages || []).map(function (p, i) { return [String(i), 'Force page ' + (i + 1)]; })), pt.page, 'Page');
    ps.addEventListener('change', function () { pt.page = ps.value; });
    row.appendChild(field('Page', ps));
    var cs = selectOf(chapterOptions('Start of the game'), pt.chapter, 'Chapter to start in');
    cs.addEventListener('change', function () { pt.chapter = cs.value; });
    row.appendChild(field('Start in chapter', cs));
    box.appendChild(row);
    var qd = el('details', 'ev-qd'); qd.appendChild(el('summary', null, 'Quest stages to start from'));
    var qrow = el('div', 'ev-pvrow');
    STORY.records.list('qst_', b).filter(function (q) { return Array.isArray(q.stages) && q.stages.length; }).forEach(function (q) {
      var s = selectOf([['', 'Not started']].concat(q.stages.map(function (x) { return [x.key, x.label || x.key]; })).concat([['failed', 'Failed']]), pt.quests[q.id] || '', 'Stage of ' + q.name);
      s.addEventListener('change', function () { pt.quests[q.id] = s.value; });
      qrow.appendChild(field(q.name, s));
    });
    qd.appendChild(qrow); box.appendChild(qd);
    box.appendChild(UI().toggle('Carry on from where the last run ended', pt.carry, function (on) { pt.carry = on; }));
    var bar = el('div', 'btn-row');
    bar.appendChild(UI().button('Play', 'play', 'btn-primary', function () { startPlay(); redraw(); }));
    if (pt.sess) bar.appendChild(UI().button('Clear', null, 'btn-ghost', function () { pt.sess = null; redraw(); }));
    box.appendChild(bar);
    if (pt.sess) {
      var r = E.session.current(pt.sess), log = el('div', 'ev-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite');
      E.session.log(pt.sess).forEach(function (l) { log.appendChild(el('p', 'ev-l ev-l-' + l.cls, (l.who ? '<strong>' + esc(l.who) + ':</strong> ' : '') + esc(l.text))); });
      var ctl = el('div', 'ev-ctl');
      if (r.waiting === 'choice' && r.effect && Array.isArray(r.effect.options)) {
        r.effect.options.forEach(function (o) { var b2 = el('button', 'btn ev-opt', esc(o.text)); b2.type = 'button'; b2.addEventListener('click', function () { E.session.choose(pt.sess, o.index); redraw(); }); ctl.appendChild(b2); });
      } else if (r.waiting === 'battle') {
        ctl.appendChild(UI().button('Win', null, 'btn-primary', function () { E.session.resolve(pt.sess, 'win'); redraw(); }));
        ctl.appendChild(UI().button('Lose', null, '', function () { E.session.resolve(pt.sess, 'lose'); redraw(); }));
        if (r.effect && Array.isArray(r.effect.escape)) ctl.appendChild(UI().button('Escape', null, '', function () { E.session.resolve(pt.sess, 'escape'); redraw(); }));
      } else if (!r.done) ctl.appendChild(UI().button('Continue', 'play', 'btn-primary', function () { E.session.next(pt.sess); redraw(); }));
      if (pt.sess.frames.length > 1) ctl.appendChild(UI().button('Back', null, 'btn-ghost', function () { E.session.back(pt.sess); redraw(); }));
      if (r.done) ctl.appendChild(el('span', 'muted ev-donemsg', 'The run is over. Turn on carry on and play the next event to keep going.'));
      var split = el('div', 'ev-split'), left = el('div', 'ev-left');
      left.appendChild(log); left.appendChild(ctl);
      split.appendChild(left); split.appendChild(inspector(r.state, pt.sess.idx));
      box.appendChild(split);
    }
    host.appendChild(box);
  }

  // ---------------------------------------------------------------- bosses and the golden path
  function bossPanel(host, b) {
    var slots = E.bosses(b).filter(function (x) { return x.slot; });
    if (!slots.length) return;
    var p = el('section', 'panel fg-card');
    p.appendChild(el('h3', 'section-h', 'Empty boss slots'));
    p.appendChild(el('p', 'muted', 'Day 148 left these boss dungeons without a troop. The story fills each one from its own side: choose the troop its boss event starts. The world is never edited.'));
    var trs = STORY.rules('trp_', b);
    slots.forEach(function (s) {
      var row = el('div', 'ev-slot');
      row.appendChild(el('div', 'ev-slot-n', '<strong>' + esc(chName(s.chapter)) + '</strong><span class="muted"> ' + esc(s.name) + (s.chosen ? '' : ' (default pick)') + '</span>'));
      var sel = selectOf(trs.map(function (t) { return [t.id, t.name || t.id]; }), s.troop || '', 'Troop for ' + s.name);
      sel.addEventListener('change', function () {
        var r = E.setBossTroop(s.dgn, sel.value);
        if (!r.ok) { Kit.ui.toast(r.message, 'warn'); return; }
        Kit.ui.toast(r.kept ? 'Troop chosen. The boss event was edited by you, so it was not changed; reset it to use the new troop.' : r.refreshed ? 'Troop chosen and the boss event updated.' : 'Troop chosen. Build events to make the boss event.', r.kept ? 'warn' : 'ok', 5000);
        redraw();
      });
      row.appendChild(sel);
      p.appendChild(row);
    });
    host.appendChild(p);
  }
  function goldenPanel(host) {
    var g = st.golden;
    if (!g) return;
    var p = el('section', 'panel fg-card ev-golden');
    p.appendChild(el('h3', 'section-h', 'Golden path'));
    p.appendChild(el('p', g.ended ? 'msg s9-ok' : 'msg msg-warning', esc(g.ended ? 'The story reaches ' + nameOf(g.ended, g.ended) + ' in ' + plural(g.steps.length, 'event') + '.' : 'The path stops after ' + plural(g.steps.length, 'event') + ' without an ending' + (g.mainDone !== undefined ? ' (' + g.mainDone + ' of ' + g.mains + ' main quests complete)' : '') + '.')));
    var ol = el('ol', 'ev-gsteps');
    g.steps.forEach(function (s) { var li = el('li'); var a = el('button', 'btn btn-ghost ev-glink', esc(s.name)); a.type = 'button'; a.addEventListener('click', function () { focus(s.evt); }); li.appendChild(a); li.appendChild(el('span', 'muted', ' ' + esc(s.effects.join(', ')))); ol.appendChild(li); });
    p.appendChild(ol);
    p.appendChild(el('p', 'muted', 'One path, by a player who does what the story asks: every choice takes its first option and every battle is won. Phase 7 proves every path.'));
    host.appendChild(p);
  }

  // ---------------------------------------------------------------- the tab
  function render(host) {
    var b = cur(), sum = E.summary(b), idx = STORY.engineIndex(b);
    var head = el('section', 'panel');
    head.innerHTML = '<h2 class="panel-title">Events</h2><p class="muted fg-lead">An event fires on a trigger: entering a map, stepping on a cell, talking to a person, at once, after a battle, or when a chapter starts. It holds pages, and the rightmost page whose condition passes runs its commands. Build the events the world asks for (chapter openers, seal chests, bosses, exits, the givers, and the finale), then edit any of them and play them here.</p>';
    head.appendChild(el('div', 'fg-stats', UI().chip('chip-accent', plural(sum.total, 'event')) + ' ' + UI().chip('chip-muted', plural(sum.pages, 'page')) + ' ' + UI().chip('chip-muted', plural(sum.cmds, 'command')) +
      (sum.authored ? ' ' + UI().chip('chip-muted', sum.authored + ' made by hand') : '') + (sum.edited ? ' ' + UI().chip('chip-muted', sum.edited + ' edited') : '') + (sum.errors ? ' ' + UI().chip('chip-error', plural(sum.errors, 'event') + ' with errors') : '') +
      (sum.missing || sum.stale ? ' ' + UI().chip('chip-warning', sum.missing ? 'not built yet' : 'out of date', 'The world, the quests, or the endings ask for events that are missing or have changed.') : sum.total ? ' ' + UI().chip('chip-ok', 'up to date') : '')));
    var row = el('div', 'btn-row');
    row.appendChild(UI().button(sum.total ? 'Update events' : 'Build events from the world', 'check', sum.missing || sum.stale || !sum.total ? 'btn-primary' : '', function () {
      var rep = E.scaffold();
      Kit.ui.toast(E.reportText(rep), rep.skipped ? 'warn' : 'ok', 6000);
      redraw();
    }));
    row.appendChild(UI().button('Add event', 'plus', '', addEvent));
    row.appendChild(UI().button('Play the golden path', 'play', '', function () {
      var g = E.golden(cur()), mains = STORY.records.list('qst_').filter(function (q) { return q.kind === 'main' && Array.isArray(q.stages) && q.stages.length; });
      g.mains = mains.length; g.mainDone = mains.filter(function (q) { var s0 = g.state.quests[q.id]; return s0 && !s0.failed && s0.stage === q.stages[q.stages.length - 1].key; }).length;
      st.golden = g; redraw();
    }));
    head.appendChild(row);
    host.appendChild(head);
    goldenPanel(host);
    bossPanel(host, b);
    playPanel(host, b);
    var list = el('section', 'panel fg-card'), recs = E.list(b);
    list.appendChild(el('h3', 'section-h', 'All events'));
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
      var shown = recs.filter(function (r) { return st.filter === 'all' ? true : st.filter === 'talk' ? (r.kind === 'talk' || r.kind === 'arrive') : st.filter === 'custom' ? (r.origin === 'user' || r.kind === 'custom') : r.kind === st.filter; });
      count.textContent = shown.length === recs.length ? plural(recs.length, 'event') : shown.length + ' of ' + plural(recs.length, 'event');
      if (!shown.length) items.appendChild(el('div', 'empty-line', recs.length ? 'No event matches.' : 'No events yet. Build events from the world to open chapters, hand out seals, start bosses, and close each chapter.'));
      shown.forEach(function (r) { items.appendChild(eventItem(r, b, idx)); });
    };
    paint();
    host.appendChild(list);
    if (st.focus) {
      var id = st.focus, node = host.querySelector('[data-evt="' + id + '"]');
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
  STORY.WS.events = { render: render, focus: focus };
  Kit.jump.register({ test: function (rid) { return Kit.ids.prefixOf(rid) === 'evt_'; }, name: function (rid) { return nameOf(rid, rid); }, go: function (rid) { if (!Kit.go('events')) return false; focus(rid); return true; } });
})();
// === WS:EVENTS END ===
