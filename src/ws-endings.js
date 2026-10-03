// === WS:ENDINGS BEGIN ===
(function () {
  'use strict';
  // The Endings and Playtime cards on the Start tab. Endings: one end_ per Charter ending in finale order (highest priority
  // first), each with a condition tree, a priority, credits music, and an epilogue, exactly one of them the fallback.
  // Playtime: the main story's minutes against the floor, and the side and B story minutes reported on their own.
  // Logic lives in STORY.ends (src/story-endings.js); conditions use STORY.condUI (src/ws-cond.js).
  var U = Kit.util, el = U.el, esc = U.esc, X = STORY.ends, E = STORY.events, Q = STORY.quests;
  function cur() { return Kit.bundle.current(); }
  function UI() { return STORY.ui; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function nameOf(id, fb) { return STORY.nameOf ? STORY.nameOf(id, fb) : (fb || id || ''); }
  var st = STORY.endingsUi = { open: {}, report: '' };

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
  function numInput(value, label) { var i = el('input', 'inp en-num'); i.type = 'number'; i.step = '1'; i.inputMode = 'numeric'; i.value = value === undefined || value === null ? '' : String(value); i.setAttribute('aria-label', label); return i; }
  function areaInput(value, label, rows) { var t = el('textarea', 'inp en-lines'); t.rows = rows || 3; t.value = value || ''; t.setAttribute('aria-label', label); return t; }

  // ---------------------------------------------------------------- endings
  function finaleEvent(b) { var id = E.idFor(E.keys.finale()); return b.story.records.evt_[id] ? id : null; }
  function condWords(rec, b) { return X.isFallback(rec) ? 'always (the fallback)' : Q.condText(rec.cond, b); }
  function fillEnding(body, rec, b) {
    var idx = STORY.engineIndex(b), probs = X.check(rec, b, idx).concat(X.setProblems(b).filter(function (p) { return p.recordId === rec.id; }));
    if (probs.length) body.appendChild(el('ul', 'ev-probs', probs.map(function (p) { return '<li class="' + (p.level === 'error' ? 'ev-err' : 'ev-warn') + '">' + esc(p.message) + '</li>'; }).join('')));
    if (rec.notes) body.appendChild(el('p', 'ev-notes muted', esc(rec.notes)));
    var used = X.usedBy(rec.id, b);
    body.appendChild(el('div', null, UI().kv([['Earned when', esc(condWords(rec, b))], ['Reached by', used.length ? esc(used.map(function (u) { return u.name; }).join(', ')) : UI().chip('chip-warning', 'no event yet')]])));

    var name = textInput(rec.name, 'Name', 80), concept = areaInput(rec.concept, 'Concept', 2), pri = numInput(rec.priority === undefined ? 0 : rec.priority, 'Priority'), epi = areaInput((rec.epilogue || []).join('\n'), 'Epilogue', 4);
    var roles = E.musicRoles(b), opts = [['', 'No music change']].concat(roles.map(function (r) { return [r, r]; }));
    if (rec.music && roles.indexOf(rec.music) < 0) opts.push([rec.music, rec.music + (/^mus_/.test(rec.music) ? '' : ' (not a Day 147 role)')]);
    var music = el('select', 'inp'); music.setAttribute('aria-label', 'Credits music');
    opts.forEach(function (o) { var op = el('option', null, esc(o[1])); op.value = o[0]; music.appendChild(op); });
    music.value = rec.music || '';
    name.addEventListener('change', function () { var r = X.update(rec.id, { name: name.value }); done(r); redraw(); });
    concept.addEventListener('change', function () { var r = X.update(rec.id, { concept: concept.value }); done(r); redraw(); });
    pri.addEventListener('change', function () { var v = Math.round(Number(pri.value)); var r = pri.value.trim() === '' || !isFinite(v) ? { ok: false, message: 'Priority is a whole number.' } : X.update(rec.id, { priority: v }); done(r); redraw(); });
    music.addEventListener('change', function () { var r = X.update(rec.id, { music: music.value }); done(r); redraw(); });
    epi.addEventListener('change', function () { var r = X.update(rec.id, { epilogue: epi.value }); done(r); redraw(); });
    var row = el('div', 'en-row');
    row.appendChild(field('Name', name)); row.appendChild(field('Priority', pri, 'The finale tests the highest first. The fallback is the lowest.'));
    body.appendChild(row);
    body.appendChild(field('Concept', concept, 'The Charter\'s words for this ending.'));
    body.appendChild(field('Credits music', music, 'A Day 147 role. Ending n has ending:n.'));
    body.appendChild(field('Epilogue', epi, 'One line per line. The finale shows them before the end.'));

    body.appendChild(el('h4', 'ev-sub', 'Earned when'));
    var host = el('div', 'ev-cond');
    STORY.condUI.mount(host, rec.cond === undefined ? { op: 'true' } : rec.cond, function (c) { var r = X.setCond(rec.id, c); done(r); redraw(); }, {});
    body.appendChild(host);

    var acts = el('div', 'ev-ctl en-acts');
    if (!X.isFallback(rec)) acts.appendChild(UI().button('Make this the fallback', 'check', '', function () {
      Kit.ui.confirm({ title: 'Make ' + rec.name + ' the fallback?', okLabel: 'Make fallback', message: 'It becomes always true and the lowest priority. ' + (X.fallbacks(b).length ? 'The current fallback is given a flag of its own to read instead, so exactly one stays the fallback.' : '') }).then(function (ok) {
        if (!ok) return;
        var r = X.makeFallback(rec.id); if (done(r, 'Fallback changed.')) redraw();
      });
    }));
    if (rec.origin === 'generated' && E.isEdited(rec)) acts.appendChild(UI().button('Reset to generated', 'undo', 'btn-ghost', function () { var r = X.reset(rec.id); if (done(r, 'Ending reset.')) redraw(); }));
    if (rec.origin === 'user') acts.appendChild(UI().button('Delete', 'trash', 'btn-ghost', function () {
      Kit.ui.confirm({ title: 'Delete ' + rec.name + '?', okLabel: 'Delete ending', message: used.filter(function (u) { return !u.auto; }).length ? plural(used.filter(function (u) { return !u.auto; }).length, 'event') + ' reach it and would point at nothing.' : 'The finale stops offering it.' }).then(function (ok) {
        if (!ok) return;
        var r = X.remove(rec.id); if (done(r, 'Ending deleted.')) redraw();
      });
    }));
    body.appendChild(acts);
  }
  function endingItem(rec, b, idx) {
    var wrap = el('div', 'fg-item en-item'), open = !!st.open[rec.id], errs = X.check(rec, b, idx).concat(X.setProblems(b).filter(function (p) { return p.recordId === rec.id; })), err = errs.some(function (p) { return p.level === 'error'; });
    wrap.dataset.end = rec.id;
    var meta = (X.isFallback(rec) ? UI().chip('chip-accent', 'Fallback') : UI().chip('chip-muted', 'Priority ' + (rec.priority === undefined ? 0 : rec.priority))) + ' ' + UI().chip('chip-muted', rec.music || 'no music') +
      (rec.origin === 'user' ? ' ' + UI().chip('chip-muted', 'yours') : E.isEdited(rec) ? ' ' + UI().chip('chip-muted', 'edited') : '') + (err ? ' ' + UI().chip('chip-error', 'error') : errs.length ? ' ' + UI().chip('chip-warning', 'warning') : '');
    var head = el('button', 'btn fg-head', '<span class="fg-name">' + esc(rec.name) + '</span><span class="fg-meta">' + meta + '</span>');
    head.type = 'button'; head.setAttribute('aria-expanded', open ? 'true' : 'false');
    var body = el('div', 'fg-body'); body.hidden = !open;
    if (open) fillEnding(body, rec, b);
    head.addEventListener('click', function () {
      st.open[rec.id] = body.hidden;
      if (body.hidden && !body.firstChild) fillEnding(body, rec, b);
      body.hidden = !body.hidden; head.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
    });
    wrap.appendChild(head); wrap.appendChild(body);
    return wrap;
  }
  function endingsCard(b) {
    var card = el('section', 'card s9-wide en-card'), list = X.list(b), sum = X.summary(b), charter = STORY.endings(b);
    card.dataset.panel = 'endings';
    card.appendChild(el('h3', 'section-h', 'Endings'));
    var chips = UI().chip(sum.total ? 'chip-accent' : 'chip-muted', plural(sum.total, 'ending')) + ' ' + UI().chip(sum.fallbacks === 1 ? 'chip-ok' : 'chip-error', sum.fallbacks === 1 ? 'one fallback' : sum.fallbacks === 0 ? 'no fallback' : plural(sum.fallbacks, 'fallback')) +
      (sum.missing ? ' ' + UI().chip('chip-warning', sum.missing + ' not built') : sum.stale ? ' ' + UI().chip('chip-warning', 'out of date') : sum.total ? ' ' + UI().chip('chip-ok', 'up to date') : '') + (sum.errors ? ' ' + UI().chip('chip-error', plural(sum.errors, 'error')) : '');
    card.appendChild(el('p', null, chips));
    if (!charter.length && !list.length) card.appendChild(el('p', 'msg msg-warning', 'The Charter lists no endings. Add one in Saga Forge (Day 146), or add one here by hand; the game needs at least one, and exactly one is the fallback.'));
    else card.appendChild(el('p', 'muted', esc('The finale tests endings from the highest priority down and plays the first whose condition passes. The first Charter ending is the fallback; each later one is earned by finishing optional quests, or by a flag you set from an event.')));
    var bar = el('div', 'ev-ctl en-acts');
    var label = sum.total ? 'Update endings' : 'Build endings';
    bar.appendChild(UI().button(label, 'wand', '', function () {
      var rep = X.scaffold(); st.report = X.reportText(rep);
      Kit.ui.toast(st.report, rep.skipped ? 'warn' : 'ok', 5000); redraw();
    }));
    bar.appendChild(UI().button('Add ending', 'plus', 'btn-ghost', function () {
      var r = X.add({ name: 'New ending' });
      if (done(r, 'Ending added.')) { st.open[r.record.id] = true; redraw(); }
    }));
    var fin = finaleEvent(b);
    if (fin) bar.appendChild(UI().button('Open the finale', 'play', 'btn-ghost', function () { if (STORY.eventsUi) { STORY.eventsUi.open[fin] = true; STORY.eventsUi.filter = 'all'; STORY.eventsUi.focus = fin; STORY.eventsUi.pt.evt = fin; } Kit.go('events'); }));
    card.appendChild(bar);
    if (st.report) card.appendChild(el('p', 'msg s9-ok', esc(st.report)));
    if (!list.length) { if (charter.length) card.appendChild(el('ol', 's9-endings', charter.map(function (e, i) { return '<li><strong>' + esc(e.name || 'Ending ' + (i + 1)) + '</strong> <span class="muted">' + esc(e.concept || '') + '</span></li>'; }).join(''))); return card; }
    var idx = STORY.engineIndex(b), wrapList = el('div', 'en-list');
    list.forEach(function (r) { wrapList.appendChild(endingItem(r, b, idx)); });
    card.appendChild(wrapList);
    X.setProblems(b).filter(function (p) { return !list.some(function (r) { return r.id === p.recordId; }); }).forEach(function (p) { card.appendChild(el('p', 'msg ' + (p.level === 'error' ? 'msg-error' : 'msg-warning'), esc(p.message))); });
    return card;
  }

  // ---------------------------------------------------------------- playtime
  function playtimeCard(b) {
    var card = el('section', 'card en-card'), p = X.playtime(b);
    card.dataset.panel = 'playtime';
    card.appendChild(el('h3', 'section-h', 'Playtime'));
    card.appendChild(el('p', null, UI().chip(p.meets ? 'chip-ok' : 'chip-error', (p.main / 60).toFixed(1) + ' of ' + (p.floor / 60) + ' hours') + ' <span class="muted">' + esc(p.meets
      ? 'The chapters reach the floor. Optional quests are counted below and never toward it.'
      : 'The main story is ' + p.short + ' minutes short of the floor. This is an error, and a Final export waits for it. Raise chapter target minutes in Saga Forge (Day 146).') + '</span>'));
    card.appendChild(UI().table([{ label: 'Chapter' }, { label: 'Minutes', num: true }], p.chapters.map(function (c) { return '<tr><th scope="row">' + esc(c.name) + '</th><td class="num">' + c.minutes + '</td></tr>'; }).concat(['<tr><th scope="row">Main story</th><td class="num"><strong>' + p.main + '</strong></td></tr>'])));
    card.appendChild(el('h4', 'ev-sub', 'Optional, reported on its own'));
    card.appendChild(el('p', null, UI().chip('chip-muted', plural(p.side.count, 'side quest') + ': ' + p.side.minutes + ' min') + ' ' + UI().chip('chip-muted', plural(p.bstory.count, 'B story', 'B stories') + ': ' + p.bstory.minutes + ' min') + ' ' + UI().chip('chip-accent', 'With everything: ' + (p.total / 60).toFixed(1) + ' hours')));
    if (!p.rows.length) { card.appendChild(el('p', 'muted', 'No side or B story quests yet. Build them on the Quests tab.')); return card; }
    card.appendChild(el('p', 'muted', esc('Each quest has an estimate until you set its minutes (' + X.SIDE_MINUTES + ' for a side quest, ' + X.BSTORY_MINUTES + ' for a B story).')));
    var list = el('div', 'en-qlist');
    p.rows.forEach(function (r) {
      var row = el('div', 'en-qrow'), inp = numInput(r.minutes, 'Minutes for ' + r.name);
      row.appendChild(el('span', 'en-qname', esc(r.name) + ' ' + UI().chip('chip-muted', r.kind === 'side' ? 'side' : 'B story') + (r.estimated ? ' ' + UI().chip('chip-muted', 'estimate') : '')));
      inp.addEventListener('change', function () { var v = Math.round(Number(inp.value)); var res = inp.value.trim() === '' || !isFinite(v) ? X.setQuestMinutes(r.id, null) : X.setQuestMinutes(r.id, v); done(res); redraw(); });
      row.appendChild(inp);
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  STORY.endingsUi.card = endingsCard;
  STORY.endingsUi.playtimeCard = playtimeCard;
})();
// === WS:ENDINGS END ===
