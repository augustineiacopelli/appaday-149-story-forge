// === WS:FLAGS BEGIN ===
(function () {
  'use strict';
  // The Flags tab: the binding table (every Day 148 gate key and the flag that stands for it, unbound keys first), the
  // completion flag of each side quest seed, and every flag with who reads it and who sets it. Logic lives in
  // STORY.flags (src/story-scaffold.js); this file only draws it and calls it.
  var U = Kit.util, el = U.el, esc = U.esc, F = STORY.flags;
  function cur() { return Kit.bundle.current(); }
  function UI() { return STORY.ui; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  var st = STORY.flagsUi = { filter: 'all', q: '', open: {}, focus: null };
  var FILTERS = [['all', 'All'], ['gate', 'Gates'], ['quest', 'Quest'], ['story', 'Story'], ['counter', 'Counters'], ['slots', 'Save slots'], ['yours', 'Yours']];
  var SRC_KIND = { world: 'World', quest: 'Quest', dialogue: 'Dialogue', event: 'Event', npc: 'Person', ending: 'Ending', engine: 'Engine' };

  function nameOf(id, fb) { return STORY.nameOf ? STORY.nameOf(id, fb) : (fb || id); }
  function chName(id) { var c = STORY.chapters().filter(function (x) { return x.id === id; })[0]; return c ? c.name || id : id; }
  function note(host, cls, text) { host.appendChild(el('p', cls, esc(text))); }

  // ---------------------------------------------------------------- dialogs
  function field(label, input, help, id) {
    var f = el('div', 'field'), l = el('label', 'field-label', esc(label));
    if (id) { input.id = id; l.htmlFor = id; }
    f.appendChild(l); f.appendChild(input);
    if (help) f.appendChild(el('div', 'field-help', esc(help)));
    return f;
  }
  function numInput(value, label) {
    var i = el('input', 'inp'); i.type = 'number'; i.step = '1'; i.inputMode = 'numeric'; i.value = value === undefined || value === null ? '' : String(value); i.setAttribute('aria-label', label);
    return i;
  }
  function editFlag(rec) {
    var isNew = !rec, derived = !!(rec && rec.derived), lockKind = !!(rec && rec.origin === 'generated');
    var name, kind, def, lim, min, max, notes, msg;
    Kit.ui.dialog({
      title: isNew ? 'Add a flag' : 'Edit flag',
      body: function (body) {
        name = el('input', 'inp'); name.type = 'text'; name.value = rec ? rec.name : ''; name.maxLength = 80; name.placeholder = 'The ring was returned';
        body.appendChild(field('Name', name, 'What a person reading a condition sees.', 'fgName'));
        kind = el('select', 'inp');
        F.KINDS.forEach(function (k) { var o = el('option', null, esc(k)); o.value = k; kind.appendChild(o); });
        kind.value = rec ? rec.kind : 'story';
        kind.disabled = lockKind || derived;
        body.appendChild(field('Kind', kind, 'gate: a Day 148 gate. quest: quest progress. story: a fact the story remembers. counter: a number the story counts with.', 'fgKind'));
        def = numInput(rec ? rec['default'] : 0, 'Default value');
        def.disabled = derived;
        body.appendChild(field('Default', def, 'The value a new game starts with. Whole numbers only.', 'fgDef'));
        var hasRange = !!(rec && Array.isArray(rec.range));
        lim = UI().toggle('Limit the range', hasRange, function (on) { min.disabled = max.disabled = !on || derived; });
        lim.querySelector('input').disabled = derived;
        min = numInput(hasRange ? rec.range[0] : 0, 'Lowest value'); max = numInput(hasRange ? rec.range[1] : 1, 'Highest value');
        min.disabled = max.disabled = !hasRange || derived;
        var pair = el('div', 'fg-pair'); pair.appendChild(min); pair.appendChild(max);
        var rf = el('div', 'field'); rf.appendChild(lim); rf.appendChild(pair);
        rf.appendChild(el('div', 'field-help', 'Lowest, then highest. A write outside the range is clamped to it.'));
        body.appendChild(rf);
        notes = el('textarea', 'inp'); notes.value = rec && rec.notes || ''; notes.maxLength = 600;
        body.appendChild(field('Note', notes, 'Optional. Why this flag exists and who should set it.', 'fgNotes'));
        if (derived) body.appendChild(el('p', 'muted', 'The engine packs quest progress into this flag for Day 146 saves, so only its name and note can change.'));
        msg = el('div', 'field-msg'); body.appendChild(msg);
      },
      actions: [
        { label: 'Cancel', kind: 'ghost', value: null },
        { label: isNew ? 'Add flag' : 'Save', kind: 'primary', onClick: function () {
          var d = def.value.trim() === '' ? 0 : Number(def.value), r;
          if (lim.querySelector('input').checked && !derived) r = [min.value.trim() === '' ? NaN : Number(min.value), max.value.trim() === '' ? NaN : Number(max.value)];
          var res;
          if (isNew) res = F.add({ name: name.value, kind: kind.value, 'default': d, range: r, notes: notes.value.trim() });
          else {
            var patch = { name: name.value, notes: notes.value.trim() };
            if (!derived) { patch.kind = kind.value; patch['default'] = d; patch.range = r === undefined ? null : r; }
            res = F.update(rec.id, patch);
          }
          if (!res.ok) { msg.innerHTML = '<span class="msg msg-error">' + esc(res.problems.map(function (p) { return p.message; }).join(' ')) + '</span>'; return false; }
          if (isNew) st.open[res.record.id] = true;
          Kit.ui.toast(isNew ? 'Flag added.' : 'Flag saved.', 'ok');
          Kit.rerender();
        } }
      ]
    });
  }
  function deleteFlag(rec, x) {
    var uses = x.reads.length + x.sets.length, extra = rec.origin === 'generated' ? ' The next regeneration makes it again.' : '';
    Kit.ui.confirm({ title: 'Delete this flag?', okLabel: 'Delete flag', message: '"' + rec.name + '" ' + (uses ? 'is used in ' + plural(uses, 'place') + ', and each would show a missing flag.' : 'is not used anywhere.') + extra }).then(function (ok) {
      if (!ok) return;
      var r = F.remove(rec.id);
      if (!r.ok) { Kit.ui.toast(r.message, 'warn'); return; }
      var left = r.gates.length ? ' ' + plural(r.gates.length, 'gate key') + ' now unbound.' : '';
      Kit.ui.toast('Flag deleted.' + left, r.gates.length ? 'warn' : 'ok');
      Kit.rerender();
    });
  }

  // ---------------------------------------------------------------- the binding table
  function bindRow(r, b) {
    var row = el('div', 'fg-row' + (r.bound ? '' : ' unbound'));
    var info = el('div', 'fg-info');
    info.appendChild(el('strong', null, esc(F.label(r, b))));
    info.appendChild(el('small', null, '<code class="id">' + esc(r.key) + '</code>'));
    var line = el('div', 'fg-line');
    if (r.bound) {
      var open = el('button', 'btn btn-ghost fg-link', '<span>' + esc(r.flagName) + '</span>'); open.type = 'button'; open.title = 'Open this flag';
      open.addEventListener('click', function () { STORY.WS.flags.focus(r.flg); });
      line.appendChild(open);
      line.insertAdjacentHTML('beforeend', UI().chip(r.generated ? 'chip-muted' : 'chip-accent', r.generated ? 'Generated' : 'Chosen'));
      if (r.shared.length) line.insertAdjacentHTML('beforeend', ' ' + UI().chip('chip-warning', 'Shared with ' + r.shared.length, 'Gate keys on one flag always open together: ' + r.shared.join(', ')));
    } else line.insertAdjacentHTML('beforeend', UI().chip('chip-warning', 'Unbound', 'No flag stands for this gate key, so Day 150 could never tell when it opens.'));
    info.appendChild(line);
    if (r.kind === 'seal') {
      var it = el('div', 'fg-line');
      it.innerHTML = r.itm ? '<span class="muted">Shows as</span> ' + esc(nameOf(r.itm, r.itm)) + (r.itmOk ? '' : ' ' + UI().chip('chip-broken', 'Not in the Rules')) : '<span class="muted">No display item</span>';
      info.appendChild(it);
    }
    row.appendChild(info);
    var acts = el('div', 'fg-acts');
    acts.appendChild(UI().button(r.bound ? 'Change flag' : 'Choose flag', null, '', function () {
      Kit.ui.pickRef({ prefix: 'flg_', title: 'Flag for ' + F.label(r, b), current: r.flg }).then(function (v) {
        if (!v) return;
        var res = F.bind(r.key, v);
        if (!res.ok) Kit.ui.toast(res.message, 'warn'); else Kit.rerender();
      });
    }));
    if (!r.generated) acts.appendChild(UI().button('Use generated', null, 'btn-ghost', function () {
      var res = F.resetBinding(r.key);
      if (!res.ok) Kit.ui.toast(res.message, 'warn'); else Kit.rerender();
    }));
    if (r.kind === 'seal' && r.bound) {
      acts.appendChild(UI().button(r.itm ? 'Change item' : 'Show an item', null, 'btn-ghost', function () {
        Kit.ui.pickRef({ prefix: 'itm_', title: 'Item for ' + F.label(r, b), current: r.itm }).then(function (v) {
          if (v === undefined) return;
          var res = F.setItem(r.key, v);
          if (!res.ok) Kit.ui.toast(res.message, 'warn'); else Kit.rerender();
        });
      }));
    }
    row.appendChild(acts);
    return row;
  }
  function bindingsPanel(b, sum) {
    var p = el('section', 'panel fg-card'), rows = F.bindingRows(b);
    p.appendChild(el('h3', 'section-h', 'Gate bindings'));
    if (!rows.length) { p.appendChild(el('div', 'empty-line', 'The world names no gate keys yet.')); return p; }
    note(p, 'muted', 'Day 148\'s progression names ' + plural(rows.length, 'world local gate key') + '. Each one stands for a story flag, so every gate in Day 150 reads the story\'s state. A seal can also show an item from the Rules. Unbound keys are listed first.');
    if (sum.unbound) p.appendChild(el('p', 'msg msg-warning', esc(plural(sum.unbound, 'gate key') + ' without a flag. Regenerate the bindings, or choose a flag for each.')));
    rows.forEach(function (r) { p.appendChild(bindRow(r, b)); });
    return p;
  }

  // ---------------------------------------------------------------- side quest completion flags
  function sdqPanel(b) {
    var rows = F.sdqRows(b), p = el('section', 'panel fg-card');
    p.appendChild(el('h3', 'section-h', 'Side quest completion flags'));
    if (!rows.length) { p.appendChild(el('div', 'empty-line', 'No side quest seeds in the Rules.')); return p; }
    note(p, 'muted', 'Each side quest seed gets the completion flag of the quest generated for it. A flag you choose that still exists is kept the next time the bindings are regenerated.');
    rows.forEach(function (r) {
      var row = el('div', 'fg-row');
      var info = el('div', 'fg-info');
      info.appendChild(el('strong', null, esc(r.name)));
      info.appendChild(el('small', null, esc(chName(r.chapter) + (r.giver ? ', given by ' + nameOf(r.giver, r.giver) : ''))));
      var line = el('div', 'fg-line');
      if (r.exists) {
        var open = el('button', 'btn btn-ghost fg-link', '<span>' + esc(r.flagName) + '</span>'); open.type = 'button'; open.title = 'Open this flag';
        open.addEventListener('click', function () { STORY.WS.flags.focus(r.flg); });
        line.appendChild(open);
        line.insertAdjacentHTML('beforeend', UI().chip(r.generated ? 'chip-muted' : 'chip-accent', r.generated ? 'Generated' : 'Chosen'));
      } else line.insertAdjacentHTML('beforeend', UI().chip('chip-warning', r.flg ? 'Missing flag' : 'No flag yet'));
      info.appendChild(line);
      row.appendChild(info);
      var acts = el('div', 'fg-acts');
      acts.appendChild(UI().button('Choose flag', null, '', function () {
        Kit.ui.pickRef({ prefix: 'flg_', title: 'Completion flag for ' + r.name, current: r.flg }).then(function (v) {
          if (!v) return;
          var res = F.setSdqFlag(r.sdq, v);
          if (!res.ok) Kit.ui.toast(res.message, 'warn'); else Kit.rerender();
        });
      }));
      if (!r.generated) acts.appendChild(UI().button('Use generated', null, 'btn-ghost', function () { F.resetSdqFlag(r.sdq); Kit.rerender(); }));
      row.appendChild(acts);
      p.appendChild(row);
    });
    return p;
  }

  // ---------------------------------------------------------------- the flag list
  function srcList(title, list) {
    var d = el('div', 'fg-src');
    d.appendChild(el('h4', 'fg-src-h', esc(title) + ' (' + list.length + ')'));
    if (!list.length) { d.appendChild(el('p', 'muted fg-none', 'Nothing yet.')); return d; }
    var ul = el('ul', 'fg-srclist');
    list.slice(0, 8).forEach(function (s) {
      ul.appendChild(el('li', null, UI().chip('chip-muted', SRC_KIND[s.kind] || s.kind) + ' <span>' + esc(s.label) + '</span> <small>' + esc(s.where) + '</small>'));
    });
    if (list.length > 8) ul.appendChild(el('li', 'muted', 'and ' + (list.length - 8) + ' more'));
    d.appendChild(ul);
    return d;
  }
  function flagItem(r, xr, b) {
    var x = xr[r.id] || { reads: [], sets: [] }, wrap = el('div', 'fg-item'), open = !!st.open[r.id];
    wrap.dataset.flg = r.id;
    var meta = UI().chip('chip-accent', r.derived ? 'save slot' : r.kind) + (r.origin === 'user' ? ' ' + UI().chip('chip-muted', 'yours') : '') + ' ' + UI().chip('chip-muted', 'default ' + (r['default'] === undefined ? 0 : r['default'])) +
      (Array.isArray(r.range) ? ' ' + UI().chip('chip-muted', r.range[0] + ' to ' + r.range[1]) : '') + ' ' + UI().chip(x.reads.length ? 'chip-muted' : 'chip-warning', 'read ' + x.reads.length) + ' ' + UI().chip(x.sets.length ? 'chip-muted' : 'chip-warning', 'set ' + x.sets.length);
    var head = el('button', 'btn fg-head', '<span class="fg-name">' + esc(r.name) + '</span><span class="fg-meta">' + meta + '</span>');
    head.type = 'button'; head.setAttribute('aria-expanded', open ? 'true' : 'false');
    var body = el('div', 'fg-body'); body.hidden = !open;
    var kvp = [['ID', '<code class="id">' + esc(r.id) + '</code>'], ['Kind', esc(r.derived ? 'save slot of ' + r.derived : r.kind)], ['Default', esc(String(r['default'] === undefined ? 0 : r['default']))],
      ['Range', Array.isArray(r.range) ? esc(r.range[0] + ' to ' + r.range[1]) : '<span class="muted">none</span>']];
    if (r.gate) kvp.push(['Gate key', '<code class="id">' + esc(r.gate) + '</code>']);
    if (r.of) kvp.push(['Slot of', esc(nameOf(r.of, r.of))]);
    if (r.chapter) kvp.push(['Chapter', esc(chName(r.chapter))]);
    kvp.push(['Origin', esc(r.origin === 'user' ? 'Made by hand' : 'Generated')]);
    body.appendChild(el('div', null, UI().kv(kvp)));
    if (r.notes) body.appendChild(el('p', 'muted', esc(r.notes)));
    body.appendChild(srcList('Who reads it', x.reads));
    body.appendChild(srcList('Who sets it', x.sets));
    var acts = el('div', 'btn-row fg-bacts');
    acts.appendChild(UI().button('Edit', 'edit', '', function () { editFlag(r); }));
    if (r.derived) acts.appendChild(el('span', 'muted fg-none', 'The engine makes and drops this slot.'));
    else acts.appendChild(UI().button('Delete', 'trash', 'btn-danger', function () { deleteFlag(r, x); }));
    body.appendChild(acts);
    head.addEventListener('click', function () { st.open[r.id] = body.hidden; body.hidden = !body.hidden; head.setAttribute('aria-expanded', body.hidden ? 'false' : 'true'); });
    wrap.appendChild(head); wrap.appendChild(body);
    return wrap;
  }
  function visible(r) {
    var f = st.filter, q = st.q.trim().toLowerCase();
    if (f === 'slots' ? !r.derived : f === 'yours' ? r.origin !== 'user' : f !== 'all' && (r.kind !== f || r.derived)) return false;
    if (!q) return true;
    return [r.name, r.id, r.gate || '', r.notes || ''].join(' ').toLowerCase().indexOf(q) >= 0;
  }
  function listPanel(b, sum, xr) {
    var p = el('section', 'panel fg-card'), recs = STORY.records.list('flg_', b);
    p.appendChild(el('h3', 'section-h', 'All flags'));
    note(p, 'muted', 'Every flag is a whole number. Open one to see who reads it and who sets it, built from the conditions and commands of every quest, dialogue, event, and ending, and from Day 148\'s progression. Save slots belong to the engine: it packs quest progress and once pages into them so Day 146 saves resolve.');
    var search = el('input', 'inp fg-search'); search.type = 'search'; search.placeholder = 'Search flags'; search.value = st.q; search.setAttribute('aria-label', 'Search flags');
    p.appendChild(search);
    var bar = el('div', 'fg-filter');
    FILTERS.forEach(function (f) {
      var bt = el('button', 'btn', esc(f[1])); bt.type = 'button'; bt.setAttribute('aria-pressed', st.filter === f[0] ? 'true' : 'false');
      bt.addEventListener('click', function () { st.filter = f[0]; Array.prototype.forEach.call(bar.children, function (c, i) { c.setAttribute('aria-pressed', FILTERS[i][0] === st.filter ? 'true' : 'false'); }); paint(); });
      bar.appendChild(bt);
    });
    p.appendChild(bar);
    var list = el('div', 'fg-list'), count = el('p', 'muted fg-count');
    p.appendChild(count); p.appendChild(list);
    function paint() {
      U.clear(list);
      var shown = recs.filter(visible);
      count.textContent = shown.length === recs.length ? plural(recs.length, 'flag') : shown.length + ' of ' + plural(recs.length, 'flag');
      if (!shown.length) list.appendChild(el('div', 'empty-line', recs.length ? 'No flag matches.' : 'No flags yet. Opening a finished world makes one for every gate key.'));
      shown.forEach(function (r) { list.appendChild(flagItem(r, xr, b)); });
    }
    search.addEventListener('input', function () { st.q = search.value; paint(); });
    paint();
    return p;
  }

  // ---------------------------------------------------------------- the tab
  function render(host) {
    var b = cur(), sum = F.summary(b), xr = F.xref(b);
    var head = el('section', 'panel');
    head.innerHTML = '<h2 class="panel-title">Flags</h2><p class="muted fg-lead">Flags are whole numbers the story keeps: which gates are open, how far each quest has come, and the facts and counters a conversation can test. Each Day 148 gate key is bound to one flag here, so the world and the story agree on what is open.</p>';
    head.appendChild(el('div', 'fg-stats', UI().chip('chip-accent', plural(sum.total, 'flag')) + ' ' +
      UI().chip(sum.unbound ? 'chip-warning' : 'chip-ok', sum.bound + ' of ' + sum.gateKeys + ' gate keys bound') + ' ' +
      UI().chip('chip-muted', plural(sum.derived, 'save slot')) + (sum.authored ? ' ' + UI().chip('chip-muted', sum.authored + ' made by hand') : '') +
      (sum.neverRead.length ? ' ' + UI().chip('chip-warning', sum.neverRead.length + ' never read', 'Set but nothing reads them yet. Quests, dialogue, and events arrive in later phases.') : '') +
      (sum.neverSet.length ? ' ' + UI().chip('chip-warning', sum.neverSet.length + ' never set', 'Read but nothing sets them yet.') : '')));
    var row = el('div', 'btn-row');
    row.appendChild(UI().button('Add flag', 'plus', 'btn-primary', function () { editFlag(null); }));
    row.appendChild(UI().button('Regenerate bindings', 'check', '', function () {
      var rep = F.sync();
      Kit.ui.toast(F.reportText(rep), rep.skipped ? 'warn' : 'ok', 5000);
      Kit.rerender();
    }));
    head.appendChild(row);
    host.appendChild(head);
    host.appendChild(bindingsPanel(b, sum));
    host.appendChild(sdqPanel(b));
    host.appendChild(listPanel(b, sum, xr));
    if (st.focus) {
      var id = st.focus, node = host.querySelector('[data-flg="' + id + '"]');
      st.focus = null;
      if (node) { if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' }); var hb = node.querySelector('.fg-head'); if (hb) try { hb.focus({ preventScroll: true }); } catch (e) {} }
    }
  }
  function focus(rid) {
    if (!rid) return;
    st.open[rid] = true; st.filter = 'all'; st.q = ''; st.focus = rid;
    Kit.rerender();
  }
  STORY.WS = STORY.WS || {};
  STORY.WS.flags = { render: render, focus: focus };
  // A flag ID in a validation card (or anywhere else) opens the Flags tab on that flag.
  Kit.jump.register({ test: function (rid) { return Kit.ids.prefixOf(rid) === 'flg_'; }, name: function (rid) { return nameOf(rid, rid); }, go: function (rid) { if (!Kit.go('flags')) return false; focus(rid); return true; } });
})();
// === WS:FLAGS END ===
