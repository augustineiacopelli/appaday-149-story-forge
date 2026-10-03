  // ---------------------------------------------------------------- conditions (Phase 1)
  // A condition is a JSON tree, never a string, so nothing is ever parsed or evaluated as code. A missing condition
  // (null or undefined) is true. The closed vocabulary, by op:
  //   {op: 'true'}
  //   {op: 'all', of: [cond]}       every child passes (an empty list passes)
  //   {op: 'any', of: [cond]}       some child passes (an empty list fails)
  //   {op: 'not', of: cond}         the child fails
  //   {op: 'flag', flg, cmp, value} the flag's integer compared with value; cmp eq ne gt gte lt lte (default gte, value 1)
  //   {op: 'item', itm, cmp, value} the held count of an itm_ or eqp_ (default gte 1)
  //   {op: 'chapter', chp, cmp}     the current chapter's Charter position compared with chp's (default gte)
  //   {op: 'quest', qst, is, stage} is 'at' (current stage equals), 'reached' (current stage is stage or later, and the
  //                                 quest has not failed), 'failed', 'started', or 'done' (at the last stage, not failed)
  var CMP = { eq: 1, ne: 1, gt: 1, gte: 1, lt: 1, lte: 1 };
  var COND_OPS = ['all', 'any', 'chapter', 'flag', 'item', 'not', 'quest', 'true'];
  var QUEST_IS = { at: 1, done: 1, failed: 1, reached: 1, started: 1 };
  var MAX_DEPTH = 32;
  function compare(a, cmp, b) {
    switch (cmp || 'gte') {
      case 'eq': return a === b;
      case 'ne': return a !== b;
      case 'gt': return a > b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      default: return a >= b;
    }
  }
  function questInfo(state, qst) { var q = state && state.quests ? state.quests[qst] : null; return isObj(q) ? q : { stage: null, failed: false, closed: [] }; }
  function evalTree(t, state, idx, depth) {
    if (t === null || t === undefined) return true;
    if (!isObj(t) || (depth || 0) > MAX_DEPTH) return false;
    var d = (depth || 0) + 1, i;
    switch (t.op) {
      case 'true': return true;
      case 'all':
        if (!Array.isArray(t.of)) return false;
        for (i = 0; i < t.of.length; i++) if (!evalTree(t.of[i], state, idx, d)) return false;
        return true;
      case 'any':
        if (!Array.isArray(t.of)) return false;
        for (i = 0; i < t.of.length; i++) if (evalTree(t.of[i], state, idx, d)) return true;
        return false;
      case 'not': return isObj(t.of) ? !evalTree(t.of, state, idx, d) : false;
      case 'flag': return typeof t.flg === 'string' && compare(readFlag(state, idx, t.flg), t.cmp, intOr(t.value, 1));
      case 'item': return typeof t.itm === 'string' && compare(intOr(state && state.items ? state.items[t.itm] : 0, 0), t.cmp, intOr(t.value, 1));
      case 'chapter': {
        if (!idx || typeof t.chp !== 'string' || idx.chapterAt[t.chp] === undefined) return false;
        var c = state && state.chapter != null ? idx.chapterAt[state.chapter] : -1;
        return compare(c === undefined ? -1 : c, t.cmp, idx.chapterAt[t.chp]);
      }
      case 'quest': {
        if (typeof t.qst !== 'string') return false;
        var q = questInfo(state, t.qst), def = idx ? idx.quests[t.qst] : null;
        switch (t.is) {
          case 'failed': return !!q.failed;
          case 'started': return q.stage !== null && q.stage !== undefined;
          case 'done': return !!def && !q.failed && def.stages.length > 0 && q.stage === def.stages[def.stages.length - 1].key;
          case 'at': return q.stage === t.stage;
          case 'reached': {
            if (!def || q.failed || q.stage == null || def.stageAt[t.stage] === undefined || def.stageAt[q.stage] === undefined) return false;
            return def.stageAt[q.stage] >= def.stageAt[t.stage];
          }
          default: return false;
        }
      }
      default: return false;
    }
  }

  // Depth of a tree, stopping as soon as it passes the limit.
  function treeDepth(t, d) {
    if (d > MAX_DEPTH || !isObj(t)) return d;
    var m = d;
    if (Array.isArray(t.of)) { for (var i = 0; i < t.of.length && m <= MAX_DEPTH; i++) m = Math.max(m, treeDepth(t.of[i], d + 1)); }
    else if (isObj(t.of)) m = Math.max(m, treeDepth(t.of, d + 1));
    return m;
  }
  // A tree deeper than the limit fails as a whole (checked first, so a not cannot turn the cutoff into a pass).
  function evalCond(t, state, idx) { return treeDepth(t, 0) > MAX_DEPTH ? false : evalTree(t, state, idx, 0); }
  // Problems are {path, level 'error' or 'warning', code, message}. path is where in the tree, such as
  // 'pages[1].cond.of[0]', prefixed by the caller's path.
  function problem(out, path, level, code, message) { out.push({ path: path, level: level, code: code, message: message }); }
  function refOk(idx, prefix, id) { return typeof id === 'string' && !!idx && !!idx.known[prefix] && !!idx.known[prefix][id]; }
  function prefixOf(id) { return typeof id === 'string' && /^[a-z]{3}_/.test(id) ? id.slice(0, 4) : ''; }
  function noIdField(o, path, out) {
    if (isObj(o) && o.id !== undefined) problem(out, path + '.id', 'error', 'id-field', 'A field named id is not allowed inside a story record (every forge reads any object with an id as a record). Use flg, qst, evt, and the like.');
  }
  function lintInt(v, path, out, name) {
    if (v === undefined) return;
    if (intOr(v, null) === null) problem(out, path + '.' + name, 'error', 'not-int', name + ' must be a whole number.');
  }
  function lintCond(t, idx, path, out, depth) {
    out = out || [];
    path = path || 'cond';
    depth = depth || 0;
    if (t === null || t === undefined) return out;
    if (!isObj(t)) { problem(out, path, 'error', 'not-object', 'A condition must be an object with an op.'); return out; }
    if (depth > MAX_DEPTH) { problem(out, path, 'error', 'too-deep', 'Conditions nest more than ' + MAX_DEPTH + ' levels.'); return out; }
    noIdField(t, path, out);
    var i;
    switch (t.op) {
      case 'true': break;
      case 'all': case 'any':
        if (!Array.isArray(t.of)) { problem(out, path + '.of', 'error', 'missing', t.op + ' needs a list of conditions in of.'); break; }
        if (t.op === 'any' && !t.of.length) problem(out, path + '.of', 'warning', 'never', 'An empty any never passes.');
        for (i = 0; i < t.of.length; i++) lintCond(t.of[i], idx, path + '.of[' + i + ']', out, depth + 1);
        break;
      case 'not':
        if (!isObj(t.of)) problem(out, path + '.of', 'error', 'missing', 'not needs one condition in of.');
        else lintCond(t.of, idx, path + '.of', out, depth + 1);
        break;
      case 'flag': case 'item': {
        var key = t.op === 'flag' ? 'flg' : 'itm';
        if (typeof t[key] !== 'string' || !t[key]) problem(out, path + '.' + key, 'error', 'missing', t.op + ' needs ' + key + '.');
        else if (t.op === 'flag' ? !refOk(idx, 'flg_', t.flg) : !(refOk(idx, 'itm_', t.itm) || refOk(idx, 'eqp_', t.itm))) problem(out, path + '.' + key, 'error', 'ref', t[key] + ' does not resolve' + (t.op === 'item' ? ' to an item or equipment.' : ' to a flag.'));
        if (t.cmp !== undefined && !CMP[t.cmp]) problem(out, path + '.cmp', 'error', 'cmp', 'cmp must be eq, ne, gt, gte, lt, or lte.');
        lintInt(t.value, path, out, 'value');
        if (t.op === 'flag' && idx && idx.flags[t.flg] && idx.flags[t.flg].range && intOr(t.value, null) !== null) {
          var rg = idx.flags[t.flg].range, v = intOr(t.value, 1), can = false;
          for (var x = rg[0]; x <= rg[1] && x - rg[0] < 4096; x++) if (compare(x, t.cmp, v)) { can = true; break; }
          if (!can) problem(out, path, 'warning', 'never', 'No value in ' + t.flg + '\'s range ' + rg[0] + ' to ' + rg[1] + ' passes this test.');
        }
        break;
      }
      case 'chapter':
        if (!refOk(idx, 'chp_', t.chp)) problem(out, path + '.chp', 'error', 'ref', 'chapter needs chp, a chapter of this Charter.');
        if (t.cmp !== undefined && !CMP[t.cmp]) problem(out, path + '.cmp', 'error', 'cmp', 'cmp must be eq, ne, gt, gte, lt, or lte.');
        break;
      case 'quest': {
        if (!refOk(idx, 'qst_', t.qst)) { problem(out, path + '.qst', 'error', 'ref', 'quest needs qst, a quest in this story.'); break; }
        if (!QUEST_IS[t.is]) { problem(out, path + '.is', 'error', 'is', 'is must be at, reached, failed, started, or done.'); break; }
        if ((t.is === 'at' || t.is === 'reached') && (!idx.quests[t.qst] || idx.quests[t.qst].stageAt[t.stage] === undefined)) problem(out, path + '.stage', 'error', 'ref', 'Stage ' + t.stage + ' is not a stage of ' + t.qst + '.');
        break;
      }
      default:
        problem(out, path + '.op', 'error', 'op', 'Unknown condition op ' + JSON.stringify(t.op) + '. Use ' + COND_OPS.join(', ') + '.');
    }
    return out;
  }
  // Everything a condition reads, as sorted unique lists: {flags, items, chapters, quests}.
  function condReads(t, acc, depth) {
    acc = acc || { flags: {}, items: {}, chapters: {}, quests: {} };
    if (isObj(t) && (depth || 0) <= MAX_DEPTH) {
      if (t.op === 'flag' && typeof t.flg === 'string') acc.flags[t.flg] = 1;
      if (t.op === 'item' && typeof t.itm === 'string') acc.items[t.itm] = 1;
      if (t.op === 'chapter' && typeof t.chp === 'string') acc.chapters[t.chp] = 1;
      if (t.op === 'quest' && typeof t.qst === 'string') acc.quests[t.qst] = 1;
      if (Array.isArray(t.of)) for (var i = 0; i < t.of.length; i++) condReads(t.of[i], acc, (depth || 0) + 1);
      else if (isObj(t.of)) condReads(t.of, acc, (depth || 0) + 1);
    }
    return acc;
  }
  function sortedReads(acc) { return { flags: keys(acc.flags), items: keys(acc.items), chapters: keys(acc.chapters), quests: keys(acc.quests) }; }
  S.cond = {
    OPS: COND_OPS, CMP: keys(CMP), QUEST_IS: keys(QUEST_IS),
    eval: function (tree, state, idx) { return evalCond(tree, state, idx); },
    lint: function (tree, idx, path) { return lintCond(tree, idx, path || 'cond', [], 0); },
    reads: function (tree) { return sortedReads(condReads(tree)); },
    compare: compare
  };
