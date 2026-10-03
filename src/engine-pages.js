  // ---------------------------------------------------------------- pages (Phase 1)
  // An event is {trigger, map, at, npc, trp, pages [{cond, cmds, once}], priority}. Its active page is the highest
  // numbered page whose condition passes, RPG Maker's rightmost rule, so a later page overrides an earlier one once
  // the story moves on. A once page that has already run is skipped, so the page below it shows through.
  //   trigger: mapEnter (map), talk (npc), step (map and at), autorun (map), battleEnd (trp), chapterStart (no site)
  var TRIGGERS = { autorun: 'map', battleEnd: 'trp', chapterStart: '', mapEnter: 'map', step: 'map', talk: 'npc' };
  function seenKey(evt, page) { return evt + '#' + page; }
  function eventOf(evt, idx) { return isObj(evt) ? evt : idx && typeof evt === 'string' ? idx.events[evt] || null : null; }
  function pickPage(evt, state, idx, evtId) {
    var e = eventOf(evt, idx), id = typeof evt === 'string' ? evt : evtId;
    if (!e || !Array.isArray(e.pages)) return -1;
    for (var i = e.pages.length - 1; i >= 0; i--) {
      var p = e.pages[i];
      if (!isObj(p)) continue;
      if (p.once && id && state && state.seen && state.seen[seenKey(id, i)]) continue;
      if (evalCond(p.cond, state, idx)) return i;
    }
    return -1;
  }
  function lintEvent(rec, idx, path, evtId) {
    var out = [];
    path = path || 'event';
    if (!isObj(rec)) { problem(out, path, 'error', 'not-object', 'An event is an object.'); return out; }
    var need = TRIGGERS[rec.trigger];
    if (need === undefined) problem(out, path + '.trigger', 'error', 'enum', 'trigger is one of ' + keys(TRIGGERS).join(', ') + '.');
    else if (need === 'map') {
      if (!refOk(idx, 'map_', rec.map)) problem(out, path + '.map', 'error', rec.map ? 'ref' : 'missing', 'A ' + rec.trigger + ' event needs map, a map of the world.');
      if (rec.trigger === 'step' && !(Array.isArray(rec.at) && rec.at.length === 2 && intOr(rec.at[0], -1) >= 0 && intOr(rec.at[1], -1) >= 0)) problem(out, path + '.at', 'error', 'missing', 'A step event needs at, a cell [x, y].');
    } else if (need === 'npc' && !refOk(idx, 'npc_', rec.npc)) problem(out, path + '.npc', 'error', rec.npc ? 'ref' : 'missing', 'A talk event needs npc, a person in the world.');
    else if (need === 'trp' && rec.trp !== undefined && rec.trp !== null && !refOk(idx, 'trp_', rec.trp)) problem(out, path + '.trp', 'error', 'ref', String(rec.trp) + ' is not a troop.');
    if (rec.priority !== undefined) lintInt(rec.priority, path, out, 'priority');
    if (!Array.isArray(rec.pages) || !rec.pages.length) { problem(out, path + '.pages', 'error', 'missing', 'An event needs at least one page.'); return out; }
    for (var i = 0; i < rec.pages.length; i++) {
      var p = rec.pages[i], pp = path + '.pages[' + i + ']';
      if (!isObj(p)) { problem(out, pp, 'error', 'not-object', 'A page is {cond, cmds, once}.'); continue; }
      noIdField(p, pp, out);
      lintCond(p.cond, idx, pp + '.cond', out, 0);
      if (!Array.isArray(p.cmds)) problem(out, pp + '.cmds', 'error', 'missing', 'A page needs cmds, a list (it may be empty).');
      else lintList(p.cmds, idx, pp + '.cmds', out, 0, { evt: evtId || null });
      if (p.once !== undefined && typeof p.once !== 'boolean') problem(out, pp + '.once', 'error', 'type', 'once is true or false.');
      if (rec.trigger === 'autorun' && !p.once && Array.isArray(p.cmds)) {
        // An autorun page that never turns itself off runs forever. It is fine only when it sets something its own
        // condition reads (Phase 7's walk proves it actually stops).
        var rd = condReads(p.cond).flags, st = cmdRefs(p.cmds).sets.flags, stops = false;
        for (var r = 0; r < st.length; r++) if (rd[st[r]]) stops = true;
        if (!stops) problem(out, pp, 'warning', 'autorun-loop', 'This autorun page is not once and sets nothing its condition reads, so it would run again at once.');
      }
    }
    return out;
  }
  S.pages = {
    TRIGGERS: keys(TRIGGERS),
    // pick(evt record or id, state, idx, evtId): the active page index, or -1. Pass evtId with a record so once pages
    // can be recognized.
    pick: pickPage,
    seenKey: seenKey,
    lint: lintEvent
  };
