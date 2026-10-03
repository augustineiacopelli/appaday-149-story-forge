// === WS:VALIDATION BEGIN ===
(function () {
  'use strict';
  // The six story checks as cards on the Validation and Export tab, failing cards first. Each finding links to the place
  // that fixes it: a record and field, a person's dialogue pages, or a tab. Paths into a softlock, an unreached ending, or
  // a runtime error open as a numbered list of the moves that lead there. The walk can take a few seconds on a large
  // story, so the tab draws a waiting card and works it out right after, once per change.
  var U = Kit.util, el = U.el, esc = U.esc, C = STORY.checks;
  function cur() { return Kit.bundle.current(); }
  function UI() { return STORY.ui; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  var st = STORY.validationUi = { more: {}, scheduled: null };
  var STATUS = { fail: ['chip-error', 'Fails'], warn: ['chip-warning', 'Passes with warnings'], pass: ['chip-ok', 'Passes'] };
  var RANK = { fail: 0, warn: 1, pass: 2 };
  var SHOW = 6;

  function listBlock(title, lines, ordered) {
    var d = el('details', 'vc-path');
    d.appendChild(el('summary', null, esc(title)));
    var l = el(ordered ? 'ol' : 'ul');
    lines.forEach(function (t) { l.appendChild(el('li', null, esc(t))); });
    d.appendChild(l);
    return d;
  }
  function itemRow(it) {
    var row = el('div', 'vc-item'), text = el('div', 'vc-item-text');
    var who = it.recordId && it.recordId !== 'story' ? STORY.nameOf(it.recordId, it.recordId) : it.npc ? STORY.nameOf(it.npc, it.npc) : '';
    text.innerHTML = UI().chip(it.level === 'error' ? 'chip-error' : 'chip-warning', it.level) + ' <span>' + esc(it.message) + '</span>' + (who && it.message.indexOf(who) < 0 ? '<small>' + esc(who + (it.fieldPath ? ', ' + it.fieldPath : '')) + '</small>' : '');
    if (Array.isArray(it.path) && it.path.length) text.appendChild(listBlock('The path (' + plural(it.path.length, 'move') + ')', it.path, true));
    if (Array.isArray(it.quests) && it.quests.length) text.appendChild(listBlock('Quests at that point', it.quests, false));
    row.appendChild(text);
    if (it.action === 'stamp') row.appendChild(UI().button('Confirm this world', 'check', '', confirmWorld));
    else if (C.canJump(it)) row.appendChild(UI().button('Jump', 'jump', 'btn-ghost', function () { C.jump(it); }));
    return row;
  }
  function confirmWorld() {
    Kit.ui.confirm({ title: 'Confirm this world?', message: 'The story will be recorded as built on the world now loaded. Do this only after checking that its events, people, and sites still fit this world, or after rebuilding them.', okLabel: 'Confirm the world' }).then(function (ok) {
      if (!ok) return;
      C.stamp(cur());
      Kit.ui.toast('The story is now recorded as built on this world.', 'ok');
      Kit.rerender();
    });
  }
  function gatesTable(cd) {
    var rows = (cd.gates || []).map(function (g) {
      var by = g.setter ? STORY.nameOf(g.setter.evt || g.setter.npc, g.setter.evt || g.setter.npc) : '';
      return '<tr><th scope="row">' + esc(g.key) + '</th><td>' + (by ? esc(by) : UI().chip('chip-error', 'never')) + '</td><td>' + esc(g.site || '') + '</td><td>' + esc(g.reader || '') + '</td></tr>';
    });
    var d = el('details', 'vc-path vc-gates');
    d.appendChild(el('summary', null, esc('Gates in golden order (' + rows.length + ')')));
    d.appendChild(UI().table([{ label: 'Gate' }, { label: 'Opened by' }, { label: 'Standing at' }, { label: 'First needed at' }], rows));
    return d;
  }
  function cardEl(cd) {
    var s = STATUS[cd.status], box = el('section', 'vc-card vc-' + cd.status);
    box.setAttribute('data-check', cd.key);
    box.appendChild(el('h4', 'vc-title', UI().chip(s[0], s[1]) + ' <span>' + esc(cd.title) + '</span>' + (cd.errors ? ' ' + UI().chip('chip-error', plural(cd.errors, 'error')) : '') + (cd.warnings ? ' ' + UI().chip('chip-warning', plural(cd.warnings, 'warning')) : '')));
    box.appendChild(el('p', 'vc-lead', esc(cd.lead)));
    if (cd.facts.length) box.appendChild(el('div', 'vc-facts', UI().kv(cd.facts.map(function (f) { return [f[0], esc(f[1])]; }))));
    if (cd.key === 'proofs' && cd.gates && cd.gates.length) box.appendChild(gatesTable(cd));
    if (cd.items.length) {
      var list = el('div', 'vc-items'), all = !!st.more[cd.key], shown = all ? cd.items : cd.items.slice(0, SHOW);
      shown.forEach(function (it) { list.appendChild(itemRow(it)); });
      box.appendChild(list);
      if (cd.items.length > SHOW) {
        var rest = cd.items.length - SHOW, mb = UI().button(all ? 'Show fewer' : 'Show ' + rest + ' more', null, 'btn-ghost vc-more', function () { st.more[cd.key] = !all; Kit.rerender(); });
        box.appendChild(mb);
      }
    }
    return box;
  }
  function waitingCard() {
    var box = el('section', 'vc-card vc-wait');
    box.setAttribute('data-check', 'waiting');
    box.appendChild(el('h4', 'vc-title', '<span>' + esc('Checking the story') + '</span>'));
    box.appendChild(el('p', 'vc-wait-line', esc('Walking every playthrough the story allows. This takes a moment on a large story.')));
    return box;
  }
  // Works the checks out after this frame, then draws again. Once per bundle state.
  function schedule() {
    var b = cur(), key = b ? Kit.index(b) : null;
    if (!key || st.scheduled === key) return;
    st.scheduled = key;
    setTimeout(function () { if (cur() !== b || Kit.index(b) !== key) return; C.run(b); Kit.rerender(); }, 30);
  }
  // The checks part of the Validation panel: a status line and the six cards. Returns the element.
  st.cards = function () {
    var b = cur(), wrap = el('div', 'vc-wrap');
    var head = el('div', 'vc-head');
    if (!C.ready(b)) {
      head.appendChild(el('h3', 'section-h', 'Story checks'));
      wrap.appendChild(head);
      var w = el('div', 'vc-cards'); w.appendChild(waitingCard()); wrap.appendChild(w);
      schedule();
      return wrap;
    }
    var r = C.run(b), cards = r.cards.slice().sort(function (x, z) { return RANK[x.status] - RANK[z.status] || C.CARDS.map(function (c) { return c.key; }).indexOf(x.key) - C.CARDS.map(function (c) { return c.key; }).indexOf(z.key); });
    var fails = cards.filter(function (c) { return c.status === 'fail'; }).length;
    head.appendChild(el('h3', 'section-h', 'Story checks'));
    head.appendChild(el('div', null, UI().chip(fails ? 'chip-error' : 'chip-ok', fails ? plural(fails, 'check') + ' failing' : 'Proven') + ' ' + UI().chip(r.warnings ? 'chip-warning' : 'chip-muted', plural(r.warnings, 'warning'))));
    head.appendChild(UI().button('Walk again', 'check', 'btn-ghost', function () { C.invalidate(); st.scheduled = null; Kit.rerender(); }));
    wrap.appendChild(head);
    var list = el('div', 'vc-cards');
    cards.forEach(function (cd) { list.appendChild(cardEl(cd)); });
    wrap.appendChild(list);
    return wrap;
  };
  // An ending lives on the Start tab's Endings card.
  Kit.jump.register({ test: function (rid) { return Kit.ids.prefixOf(rid) === 'end_'; }, name: function (rid) { return STORY.nameOf(rid, rid); }, go: function (rid) { if (STORY.endingsUi) STORY.endingsUi.open[rid] = true; return Kit.go('start'); } });
})();
// === WS:VALIDATION END ===
