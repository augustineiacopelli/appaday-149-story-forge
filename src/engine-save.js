  // ---------------------------------------------------------------- saves (Phase 1)
  // Day 146's save schema keeps story progress only as flags: [{flg, value}], whole numbers, beside party, inventory,
  // gil, location, and slotMeta.chapter. So everything a story state holds that is not a plain flag is packed into
  // flags too, under structural IDs the engine derives (Phase 2 scaffolds a flg_ record for each, so the save's flg
  // references resolve):
  //   one quest slot per quest, flg|quest|<qst>: (stage position + 1) in bits 0 to 7 (0 is not started), failed in bit 8,
  //     and the closed branch groups in bits 9 to 30, one bit per group in the quest's branch order;
  //   one once slot per event with once pages, flg|once|<evt>: one bit per page that has run (pages 0 to 30).
  // A save is never taken in the middle of a run (state.run is not saved). A flag at its default is left out.
  var QUEST_STAGE_MAX = 255, QUEST_GROUP_MAX = 22, ONCE_PAGE_MAX = 31;
  function questSlot(qst) { return structuralId('flg_', 'flg|quest|' + qst); }
  function onceSlot(evt) { return structuralId('flg_', 'flg|once|' + evt); }
  function hasOnce(e) { if (!isObj(e) || !Array.isArray(e.pages)) return false; for (var i = 0; i < e.pages.length; i++) if (isObj(e.pages[i]) && e.pages[i].once) return true; return false; }
  // Every derived slot the index needs, sorted by flag ID: [{flg, kind 'quest' or 'once', of}].
  function slots(idx) {
    var out = [];
    each(idx.quests, function (q, id) { out.push({ flg: questSlot(id), kind: 'quest', of: id }); });
    each(idx.events, function (e, id) { if (hasOnce(e)) out.push({ flg: onceSlot(id), kind: 'once', of: id }); });
    out.sort(function (a, b) { return a.flg < b.flg ? -1 : a.flg > b.flg ? 1 : 0; });
    return out;
  }
  // What cannot be packed: a quest with more than 255 stages or 22 branch groups, an event with once pages past 30.
  function limits(idx) {
    var out = [];
    each(idx.quests, function (q, id) {
      if (q.stages.length > QUEST_STAGE_MAX) problem(out, id + '.stages', 'error', 'save-limit', 'A quest can hold ' + QUEST_STAGE_MAX + ' stages in a save; ' + id + ' has ' + q.stages.length + '.');
      if (q.branchOrder.length > QUEST_GROUP_MAX) problem(out, id + '.branches', 'error', 'save-limit', 'A quest can hold ' + QUEST_GROUP_MAX + ' branch groups in a save; ' + id + ' has ' + q.branchOrder.length + '.');
    });
    each(idx.events, function (e, id) {
      for (var i = ONCE_PAGE_MAX; i < e.pages.length; i++) if (isObj(e.pages[i]) && e.pages[i].once) { problem(out, id + '.pages[' + i + ']', 'error', 'save-limit', 'Only pages 0 to ' + (ONCE_PAGE_MAX - 1) + ' can be once pages; ' + id + ' page ' + i + ' is one.'); break; }
    });
    return out;
  }
  function slotSet(idx) { var m = {}, s = slots(idx); for (var i = 0; i < s.length; i++) m[s[i].flg] = s[i]; return m; }
  function toFlags(state, idx) {
    var out = {}, derived = slotSet(idx);
    each(state.flags, function (v, flg) {
      if (derived[flg]) return;
      var d = idx.flags[flg] ? idx.flags[flg]['default'] : 0;
      if (intOr(v, d) !== d) out[flg] = intOr(v, d);
    });
    each(idx.quests, function (q, id) {
      var qs = state.quests && state.quests[id];
      if (!isObj(qs)) return;
      var at = qs.stage == null ? -1 : q.stageAt[qs.stage], v = 0;
      if (at !== undefined && at >= 0 && at < QUEST_STAGE_MAX) v = at + 1;
      if (qs.failed) v |= 256;
      for (var g = 0; g < q.branchOrder.length && g < QUEST_GROUP_MAX; g++) if (Array.isArray(qs.closed) && qs.closed.indexOf(q.branchOrder[g]) >= 0) v |= (1 << (9 + g));
      if (v) out[questSlot(id)] = v;
    });
    each(idx.events, function (e, id) {
      if (!hasOnce(e)) return;
      var v = 0;
      for (var p = 0; p < e.pages.length && p < ONCE_PAGE_MAX; p++) if (state.seen && state.seen[seenKey(id, p)]) v |= (1 << p);
      if (v) out[onceSlot(id)] = v;
    });
    var list = [];
    each(out, function (v, flg) { list.push({ flg: flg, value: v }); });
    return list;
  }
  function fromFlags(list, idx, rest) {
    var st = createState(idx, rest), vals = {}, derived = slotSet(idx);
    // A save names every flag away from its default, so start from the defaults, not from a new game's open gates.
    st.flags = {};
    each(idx.flags, function (f, id) { st.flags[id] = f['default']; });
    if (Array.isArray(list)) for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!isObj(e) || typeof e.flg !== 'string' || intOr(e.value, null) === null) continue;
      if (derived[e.flg]) vals[e.flg] = e.value; else writeFlag(st, idx, e.flg, e.value);
    }
    each(idx.quests, function (q, id) {
      var v = intOr(vals[questSlot(id)], 0), at = (v & 255) - 1, closed = [];
      for (var g = 0; g < q.branchOrder.length && g < QUEST_GROUP_MAX; g++) if (v & (1 << (9 + g))) closed.push(q.branchOrder[g]);
      closed.sort();
      st.quests[id] = { stage: at >= 0 && at < q.stages.length ? q.stages[at].key : null, failed: !!(v & 256), closed: closed };
    });
    each(idx.events, function (e, id) {
      var v = intOr(vals[onceSlot(id)], 0);
      for (var p = 0; p < ONCE_PAGE_MAX; p++) if (v & (1 << p)) st.seen[seenKey(id, p)] = 1;
    });
    st.chapter = chapterOf(st, idx);
    return copy(st);
  }
  // The story's share of a Day 146 save: {flags, gil, inventory [{item, qty}] sorted, party [chr], chapter}. Refused
  // with {error} while an event is running or after an ending.
  function toSave(state, idx) {
    if (state.run) return { error: 'An event is running; save between events.' };
    if (state.ending) return { error: 'The game has ended.' };
    var inv = [];
    each(state.items, function (q, itm) { if (intOr(q, 0) > 0) inv.push({ item: itm, qty: Math.min(999, q) }); });
    return { flags: toFlags(state, idx), gil: Math.max(0, intOr(state.gil, 0)), inventory: inv, party: copy(state.party || []), chapter: state.chapter };
  }
  function fromSave(save, idx) {
    save = isObj(save) ? save : {};
    var items = {}, party = [];
    if (Array.isArray(save.inventory)) for (var i = 0; i < save.inventory.length; i++) { var s = save.inventory[i]; if (isObj(s) && typeof s.item === 'string') items[s.item] = intOr(s.qty, 0); }
    if (Array.isArray(save.party)) for (var j = 0; j < save.party.length; j++) { var m = save.party[j], c = typeof m === 'string' ? m : isObj(m) ? m.chr : null; if (typeof c === 'string') party.push(c); }
    return fromFlags(save.flags, idx, { gil: save.gil, items: items, party: party });
  }
  S.save = { slots: slots, limits: limits, questSlot: questSlot, onceSlot: onceSlot, toFlags: toFlags, fromFlags: fromFlags, toSave: toSave, fromSave: fromSave, LIMITS: { stages: QUEST_STAGE_MAX, groups: QUEST_GROUP_MAX, oncePages: ONCE_PAGE_MAX } };
