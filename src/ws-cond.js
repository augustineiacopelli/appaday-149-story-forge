// === WS:COND BEGIN ===
(function () {
  'use strict';
  // Two small editors shared by the Quests tab now and by Dialogue and Events later:
  //   STORY.condUI.mount(host, tree, onChange, opts)   a condition tree: all, any, not, and the leaves flag, item, chapter,
  //                                                     quest, true. opts: {nullable, emptyText, addLabel}. onChange(tree|null).
  //   STORY.setsUI.mount(host, sets, onChange)          a list of {flg, value} flag changes. onChange(list).
  // Both draw into host, redraw themselves on every change, and hand the new value to onChange; the caller commits it.
  var U = Kit.util, el = U.el, esc = U.esc, ES = ENGINE_STORY;
  function UI() { return STORY.ui; }
  function cur() { return Kit.bundle.current(); }
  function nameOf(id, fb) { return STORY.nameOf ? STORY.nameOf(id, fb) : (fb || id || ''); }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  var CMP_ORDER = ['gte', 'gt', 'eq', 'ne', 'lte', 'lt'];
  var CMP_LABEL = { gte: 'at least', gt: 'more than', eq: 'exactly', ne: 'not equal to', lte: 'at most', lt: 'fewer than' };
  var IS_LABEL = { at: 'is at stage', reached: 'has reached stage', failed: 'has failed', started: 'has started', done: 'is complete' };
  var LEAF_LABEL = { flag: 'A flag', item: 'An item', chapter: 'The chapter', quest: 'A quest', 'true': 'Always' };
  var TYPE_ORDER = ['all', 'any', 'not', 'flag', 'item', 'chapter', 'quest', 'true'];
  var TYPE_LABEL = { all: 'All of these', any: 'Any of these', not: 'None of this', flag: 'A flag', item: 'An item', chapter: 'The chapter', quest: 'A quest', 'true': 'Always' };

  function select(options, value, label, onChange) {
    var s = el('select', 'inp cu-sel'); s.setAttribute('aria-label', label);
    options.forEach(function (o) { var op = el('option', null, esc(o[1])); op.value = o[0]; s.appendChild(op); });
    s.value = value;
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }
  function numInput(value, label, onChange) {
    var i = el('input', 'inp cu-num'); i.type = 'number'; i.step = '1'; i.inputMode = 'numeric'; i.value = value === undefined || value === null ? '' : String(value); i.setAttribute('aria-label', label);
    i.addEventListener('change', function () { onChange(i.value.trim() === '' ? undefined : Number(i.value)); });
    return i;
  }
  function pickButton(label, id, fallback, onPick, prefix, title) {
    var b = el('button', 'btn cu-pick' + (id ? '' : ' cu-empty'), esc(id ? nameOf(id, id) : fallback)); b.type = 'button';
    b.setAttribute('aria-label', label + (id ? ': ' + nameOf(id, id) : ': none chosen'));
    b.addEventListener('click', function () {
      Kit.ui.pickRef({ prefix: prefix, title: title || label, current: id }).then(function (v) { if (v) onPick(v); });
    });
    return b;
  }
  function typeOf(n) { return n && n.op; }
  function fresh(op, from) {
    switch (op) {
      case 'all': case 'any': return { op: op, of: from && Array.isArray(from.of) ? from.of : (from && from.op === 'not' ? [from.of] : []) };
      case 'not': return { op: 'not', of: from && Array.isArray(from.of) && from.of.length ? from.of[0] : { op: 'true' } };
      case 'flag': return { op: 'flag', flg: '', cmp: 'gte', value: 1 };
      case 'item': return { op: 'item', itm: '', cmp: 'gte', value: 1 };
      case 'chapter': { var c = STORY.chapters()[0]; return { op: 'chapter', chp: c ? c.id : '', cmp: 'gte' }; }
      case 'quest': return { op: 'quest', qst: '', is: 'done' };
      default: return { op: 'true' };
    }
  }

  // ---------------------------------------------------------------- the condition tree
  function leafBody(n, set) {
    var row = el('div', 'cu-leaf');
    if (n.op === 'flag') {
      row.appendChild(pickButton('Flag', n.flg, 'Choose a flag', function (v) { n.flg = v; set(n); }, 'flg_', 'Flag to test'));
      row.appendChild(select(CMP_ORDER.map(function (k) { return [k, CMP_LABEL[k]]; }), n.cmp || 'gte', 'Comparison', function (v) { n.cmp = v; set(n); }));
      row.appendChild(numInput(n.value === undefined ? 1 : n.value, 'Value', function (v) { if (v === undefined) delete n.value; else n.value = v; set(n); }));
    } else if (n.op === 'item') {
      var pre = Kit.ids.prefixOf(n.itm) === 'eqp_' ? 'eqp_' : 'itm_';
      var kind = select([['itm_', 'Item'], ['eqp_', 'Equipment']], pre, 'Item or equipment', function (v) { n.itm = ''; pre = v; set(n); });
      row.appendChild(kind);
      row.appendChild(pickButton('Item', n.itm, 'Choose one', function (v) { n.itm = v; set(n); }, pre, pre === 'eqp_' ? 'Equipment to test' : 'Item to test'));
      row.appendChild(select(CMP_ORDER.map(function (k) { return [k, CMP_LABEL[k]]; }), n.cmp || 'gte', 'Comparison', function (v) { n.cmp = v; set(n); }));
      row.appendChild(numInput(n.value === undefined ? 1 : n.value, 'Count', function (v) { if (v === undefined) delete n.value; else n.value = v; set(n); }));
    } else if (n.op === 'chapter') {
      row.appendChild(el('span', 'cu-word', 'chapter is'));
      row.appendChild(select(CMP_ORDER.map(function (k) { return [k, CMP_LABEL[k]]; }), n.cmp || 'gte', 'Comparison', function (v) { n.cmp = v; set(n); }));
      row.appendChild(select(STORY.chapters().map(function (c) { return [c.id, c.name || c.id]; }).concat(n.chp && !STORY.chapters().some(function (c) { return c.id === n.chp; }) ? [[n.chp, n.chp + ' (missing)']] : []), n.chp || '', 'Chapter', function (v) { n.chp = v; set(n); }));
    } else if (n.op === 'quest') {
      row.appendChild(pickButton('Quest', n.qst, 'Choose a quest', function (v) { n.qst = v; if (n.is !== 'at' && n.is !== 'reached') delete n.stage; set(n); }, 'qst_', 'Quest to test'));
      row.appendChild(select(ES.cond.QUEST_IS.map(function (k) { return [k, IS_LABEL[k] || k]; }), n.is || 'done', 'Quest state', function (v) { n.is = v; if (v === 'at' || v === 'reached') { if (!n.stage) n.stage = firstStage(n.qst); } else delete n.stage; set(n); }));
      if (n.is === 'at' || n.is === 'reached') {
        var q = cur() && cur().story.records.qst_[n.qst], stages = q && Array.isArray(q.stages) ? q.stages : [];
        row.appendChild(select(stages.map(function (s) { return [s.key, s.label || s.key]; }).concat(n.stage && !stages.some(function (s) { return s.key === n.stage; }) ? [[n.stage, n.stage + ' (missing)']] : []), n.stage || '', 'Stage', function (v) { n.stage = v; set(n); }));
      }
    } else row.appendChild(el('span', 'cu-word', 'Always true'));
    return row;
  }
  function firstStage(qid) { var q = cur() && cur().story.records.qst_[qid]; return q && q.stages && q.stages[0] ? q.stages[0].key : ''; }

  function node(n, set, remove, depth) {
    var box = el('div', 'cu-node cu-' + (typeOf(n) === 'all' || typeOf(n) === 'any' || typeOf(n) === 'not' ? 'group' : 'leafbox')), head = el('div', 'cu-head');
    head.appendChild(select(TYPE_ORDER.map(function (k) { return [k, TYPE_LABEL[k]]; }), typeOf(n) || 'true', 'Kind of condition', function (v) { set(fresh(v, n)); }));
    if (remove) {
      var rm = UI().button('Remove', 'trash', 'btn-ghost cu-rm', remove); rm.setAttribute('aria-label', 'Remove this condition');
      head.appendChild(rm);
    }
    box.appendChild(head);
    if (n.op === 'all' || n.op === 'any') {
      var list = el('div', 'cu-kids');
      (Array.isArray(n.of) ? n.of : []).forEach(function (kid, i) {
        list.appendChild(node(kid, function (nv) { n.of[i] = nv; set(n); }, function () { n.of.splice(i, 1); set(n); }, depth + 1));
      });
      if (!(Array.isArray(n.of) && n.of.length)) list.appendChild(el('p', 'muted cu-none', n.op === 'all' ? 'No conditions yet, so this is always true.' : 'No conditions yet, so this is never true.'));
      box.appendChild(list);
      var add = UI().button('Add condition', 'plus', 'btn-ghost', function () {
        if (!Array.isArray(n.of)) n.of = [];
        n.of.push({ op: 'true' }); set(n);
      });
      box.appendChild(add);
    } else if (n.op === 'not') {
      var kids = el('div', 'cu-kids');
      kids.appendChild(node(n.of || { op: 'true' }, function (nv) { n.of = nv; set(n); }, null, depth + 1));
      box.appendChild(kids);
    } else box.appendChild(leafBody(n, set));
    return box;
  }

  STORY.condUI = {
    mount: function (host, tree, onChange, opts) {
      opts = opts || {};
      var state = tree === undefined ? null : clone(tree);
      function commit(next) { state = next; paint(); onChange(state === null ? null : clone(state)); }
      function paint() {
        U.clear(host);
        host.classList.add('cu');
        if (state === null) {
          host.appendChild(el('p', 'muted cu-none', esc(opts.emptyText || 'No condition.')));
          host.appendChild(UI().button(opts.addLabel || 'Add a condition', 'plus', '', function () { commit({ op: 'all', of: [{ op: 'true' }] }); }));
          return;
        }
        host.appendChild(node(state, function (nv) { commit(nv); }, opts.nullable ? function () { commit(null); } : null, 0));
      }
      paint();
      return { get: function () { return state === null ? null : clone(state); } };
    }
  };

  // ---------------------------------------------------------------- a list of flag changes
  STORY.setsUI = {
    mount: function (host, sets, onChange, opts) {
      opts = opts || {};
      var list = Array.isArray(sets) ? clone(sets) : [];
      function commit(next) { list = next; paint(); onChange(clone(list)); }
      function paint() {
        U.clear(host);
        host.classList.add('cu-sets');
        if (!list.length) host.appendChild(el('p', 'muted cu-none', esc(opts.emptyText || 'Sets no flags.')));
        list.forEach(function (s, i) {
          var row = el('div', 'cu-leaf cu-setrow');
          row.appendChild(pickButton('Flag', s.flg, 'Choose a flag', function (v) { list[i].flg = v; commit(list); }, 'flg_', 'Flag to set'));
          row.appendChild(el('span', 'cu-word', 'to'));
          row.appendChild(numInput(s.value === undefined ? 1 : s.value, 'Value', function (v) { list[i].value = v === undefined ? 1 : v; commit(list); }));
          var rm = UI().button('Remove', 'trash', 'btn-ghost cu-rm', function () { list.splice(i, 1); commit(list); }); rm.setAttribute('aria-label', 'Remove this flag change');
          row.appendChild(rm);
          host.appendChild(row);
        });
        host.appendChild(UI().button(opts.addLabel || 'Add a flag change', 'plus', 'btn-ghost', function () {
          Kit.ui.pickRef({ prefix: 'flg_', title: 'Flag to set' }).then(function (v) { if (v) { list.push({ flg: v, value: 1 }); commit(list); } });
        }));
      }
      paint();
      return { get: function () { return clone(list); } };
    }
  };
})();
// === WS:COND END ===
