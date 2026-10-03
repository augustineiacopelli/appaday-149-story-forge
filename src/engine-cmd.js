  // ---------------------------------------------------------------- commands (Phase 1)
  // A command list is an array of {op, ...} objects. The vocabulary is closed and nested, with no goto: control flow is
  // only if, choice, and a battle's win, lose, and escape lists, so every list a run can reach is a fixed path in the
  // tree. That is what makes static checking and Phase 7's reachability walk tractable.
  //   text        {speaker, por, lines [string]}            speaker: chr_, npc_, or a plain name; por: a por_
  //   choice      {prompt, options [{text, cond, cmds}], cancel}  options whose cond fails are hidden
  //   if          {cond, then [cmd], else [cmd]}
  //   setFlag     {flg, value}                              value defaults to 1; clamped to the flag's range
  //   addFlag     {flg, by}                                 by defaults to 1; clamped to the flag's range
  //   giveItem    {itm, qty}                                an itm_ or eqp_; qty defaults to 1; a stack holds 999
  //   takeItem    {itm, qty}                                takes what is there, never below 0
  //   gil         {by}                                      never below 0
  //   questStage  {qst, stage} | {qst, branch, outcome} | {qst, fail: true}
  //   party       {chr, act 'join' or 'leave'}
  //   startBattle {trp, win [cmd], lose [cmd], escape [cmd]}  no lose list means a loss is game over
  //   moveActor   {who 'player' or npc_, path [dir]}        dir: up, down, left, right
  //   face        {who, dir}
  //   wait        {frames}                                  1 to 600
  //   fade        {to 'out' or 'in', frames}
  //   music       {role} | {mus} | {stop: true}             role: a Day 147 role key such as 'battle' or 'field:<slug>'
  //   sfx         {sfx}
  //   changeMap   {map, at [x, y], dir}
  //   vehicle     {kind 'ship' or 'airship', act 'board' or 'leave'}
  //   callEvent   {evt}                                     runs evt's active page, then returns here
  //   ending      {end}                                     ends the game on that ending
  var CMD_OPS = ['addFlag', 'callEvent', 'changeMap', 'choice', 'ending', 'face', 'fade', 'gil', 'giveItem', 'if', 'moveActor', 'music', 'party', 'questStage', 'setFlag', 'sfx', 'startBattle', 'takeItem', 'text', 'vehicle', 'wait'];
  var DIRS = { down: 1, left: 1, right: 1, up: 1 };
  var MAX_NEST = 16;
  // The child lists a command holds, as [path segments, list] pairs, in a fixed order.
  function childLists(c) {
    var out = [];
    if (!isObj(c)) return out;
    if (c.op === 'if') { if (Array.isArray(c.then)) out.push([['then'], c.then]); if (Array.isArray(c['else'])) out.push([['else'], c['else']]); }
    if (c.op === 'choice' && Array.isArray(c.options)) for (var i = 0; i < c.options.length; i++) if (isObj(c.options[i]) && Array.isArray(c.options[i].cmds)) out.push([['options', i, 'cmds'], c.options[i].cmds]);
    if (c.op === 'startBattle') { var o = ['win', 'lose', 'escape']; for (var j = 0; j < o.length; j++) if (Array.isArray(c[o[j]])) out.push([[o[j]], c[o[j]]]); }
    return out;
  }
  // Visits every command in a list and its nested lists, depth first in order: fn(cmd, path [segments], pathText, depth).
  function walkCmds(list, fn, base, text, depth) {
    base = base || []; text = text || 'cmds'; depth = depth || 0;
    if (!Array.isArray(list) || depth > MAX_NEST) return;
    for (var i = 0; i < list.length; i++) {
      var p = base.concat([i]), pt = text + '[' + i + ']';
      fn(list[i], p, pt, depth);
      var kids = childLists(list[i]);
      for (var k = 0; k < kids.length; k++) {
        var seg = kids[k][0], st = pt;
        for (var s = 0; s < seg.length; s++) st += typeof seg[s] === 'number' ? '[' + seg[s] + ']' : '.' + seg[s];
        walkCmds(kids[k][1], fn, p.concat(seg), st, depth + 1);
      }
    }
  }
  function needRef(c, field, prefixes, idx, pt, out, optional) {
    var v = c[field];
    if (v === undefined || v === null || v === '') { if (!optional) problem(out, pt + '.' + field, 'error', 'missing', c.op + ' needs ' + field + '.'); return false; }
    for (var i = 0; i < prefixes.length; i++) if (refOk(idx, prefixes[i], v)) return true;
    problem(out, pt + '.' + field, 'error', 'ref', String(v) + ' does not resolve to ' + prefixes.join(' or ') + '.');
    return false;
  }
  function lintList(list, idx, path, out, depth, ctx) {
    if (!Array.isArray(list)) { problem(out, path, 'error', 'not-list', 'Commands must be a list.'); return; }
    if (depth > MAX_NEST) { problem(out, path, 'error', 'too-deep', 'Commands nest more than ' + MAX_NEST + ' levels.'); return; }
    for (var i = 0; i < list.length; i++) lintOne(list[i], idx, path + '[' + i + ']', out, depth, ctx);
  }
  function lintOne(c, idx, pt, out, depth, ctx) {
    if (!isObj(c)) { problem(out, pt, 'error', 'not-object', 'A command must be an object with an op.'); return; }
    noIdField(c, pt, out);
    switch (c.op) {
      case 'text':
        if (!Array.isArray(c.lines) || !c.lines.length || !c.lines.every(function (l) { return typeof l === 'string'; })) problem(out, pt + '.lines', 'error', 'missing', 'text needs lines, a list of strings.');
        if (typeof c.speaker === 'string' && /^(chr|npc)_/.test(c.speaker)) needRef(c, 'speaker', ['chr_', 'npc_'], idx, pt, out, true);
        else if (c.speaker !== undefined && c.speaker !== null && typeof c.speaker !== 'string') problem(out, pt + '.speaker', 'error', 'type', 'speaker is a chr_, an npc_, or a name.');
        needRef(c, 'por', ['por_'], idx, pt, out, true);
        break;
      case 'choice':
        if (!Array.isArray(c.options) || !c.options.length) { problem(out, pt + '.options', 'error', 'missing', 'choice needs at least one option.'); break; }
        if (c.options.length < 2) problem(out, pt + '.options', 'warning', 'one-option', 'A choice with one option is not a choice.');
        for (var o = 0; o < c.options.length; o++) {
          var op = c.options[o], opt = pt + '.options[' + o + ']';
          if (!isObj(op)) { problem(out, opt, 'error', 'not-object', 'An option is {text, cond, cmds}.'); continue; }
          noIdField(op, opt, out);
          if (typeof op.text !== 'string' || !op.text) problem(out, opt + '.text', 'error', 'missing', 'Every option needs text.');
          lintCond(op.cond, idx, opt + '.cond', out, 0);
          if (op.cmds !== undefined) lintList(op.cmds, idx, opt + '.cmds', out, depth + 1, ctx);
        }
        if (c.cancel !== undefined && (intOr(c.cancel, -1) < 0 || c.cancel >= c.options.length)) problem(out, pt + '.cancel', 'error', 'range', 'cancel is the index of one of the options.');
        break;
      case 'if':
        if (c.cond === undefined || c.cond === null) problem(out, pt + '.cond', 'warning', 'always', 'An if without a condition always takes then.');
        lintCond(c.cond, idx, pt + '.cond', out, 0);
        if (c.then !== undefined) lintList(c.then, idx, pt + '.then', out, depth + 1, ctx);
        if (c['else'] !== undefined) lintList(c['else'], idx, pt + '.else', out, depth + 1, ctx);
        if (!Array.isArray(c.then) && !Array.isArray(c['else'])) problem(out, pt, 'warning', 'empty', 'An if with no then and no else does nothing.');
        break;
      case 'setFlag': case 'addFlag':
        needRef(c, 'flg', ['flg_'], idx, pt, out);
        lintInt(c.op === 'setFlag' ? c.value : c.by, pt, out, c.op === 'setFlag' ? 'value' : 'by');
        break;
      case 'giveItem': case 'takeItem':
        needRef(c, 'itm', ['itm_', 'eqp_'], idx, pt, out);
        lintInt(c.qty, pt, out, 'qty');
        if (c.qty !== undefined && intOr(c.qty, 0) < 1) problem(out, pt + '.qty', 'error', 'range', 'qty is 1 or more.');
        break;
      case 'gil':
        if (intOr(c.by, null) === null) problem(out, pt + '.by', 'error', 'missing', 'gil needs by, a whole number (negative to take).');
        break;
      case 'questStage': {
        if (!needRef(c, 'qst', ['qst_'], idx, pt, out)) break;
        var q = idx.quests[c.qst], modes = (c.stage !== undefined ? 1 : 0) + (c.branch !== undefined ? 1 : 0) + (c.fail === true ? 1 : 0);
        if (modes !== 1) { problem(out, pt, 'error', 'mode', 'questStage takes exactly one of stage, branch with outcome, or fail: true.'); break; }
        if (c.stage !== undefined && q.stageAt[c.stage] === undefined) problem(out, pt + '.stage', 'error', 'ref', 'Stage ' + c.stage + ' is not a stage of ' + c.qst + '.');
        if (c.branch !== undefined) {
          var g = q.branches[c.branch];
          if (!g) problem(out, pt + '.branch', 'error', 'ref', 'Branch group ' + c.branch + ' is not in ' + c.qst + '.');
          else if (!g.outcomes[c.outcome]) problem(out, pt + '.outcome', 'error', 'ref', 'Outcome ' + c.outcome + ' is not in branch group ' + c.branch + '.');
        }
        break;
      }
      case 'party':
        needRef(c, 'chr', ['chr_'], idx, pt, out);
        if (c.act !== 'join' && c.act !== 'leave') problem(out, pt + '.act', 'error', 'enum', 'act is join or leave.');
        break;
      case 'startBattle':
        needRef(c, 'trp', ['trp_'], idx, pt, out);
        ['win', 'lose', 'escape'].forEach(function (k) { if (c[k] !== undefined) lintList(c[k], idx, pt + '.' + k, out, depth + 1, ctx); });
        break;
      case 'moveActor': case 'face':
        if (c.who !== 'player') needRef(c, 'who', ['npc_'], idx, pt, out);
        if (c.op === 'face' && !DIRS[c.dir]) problem(out, pt + '.dir', 'error', 'enum', 'dir is up, down, left, or right.');
        if (c.op === 'moveActor' && (!Array.isArray(c.path) || !c.path.length || !c.path.every(function (d) { return !!DIRS[d]; }))) problem(out, pt + '.path', 'error', 'missing', 'moveActor needs path, a list of up, down, left, and right.');
        break;
      case 'wait':
        if (intOr(c.frames, 0) < 1 || c.frames > 600) problem(out, pt + '.frames', 'error', 'range', 'wait needs frames, 1 to 600.');
        break;
      case 'fade':
        if (c.to !== 'out' && c.to !== 'in') problem(out, pt + '.to', 'error', 'enum', 'fade to is out or in.');
        if (c.frames !== undefined && (intOr(c.frames, 0) < 1 || c.frames > 600)) problem(out, pt + '.frames', 'error', 'range', 'frames is 1 to 600.');
        break;
      case 'music':
        if (c.stop === true) break;
        if (c.mus !== undefined) needRef(c, 'mus', ['mus_'], idx, pt, out);
        else if (typeof c.role !== 'string' || !c.role) problem(out, pt + '.role', 'error', 'missing', 'music needs a role key, a mus_, or stop: true.');
        else if (!idx || !idx.roles[c.role.replace(/^music:/, '')]) problem(out, pt + '.role', 'warning', 'unscored', 'No music is scored for role ' + c.role + ' in Day 147, so it plays silence.');
        break;
      case 'sfx':
        needRef(c, 'sfx', ['sfx_'], idx, pt, out);
        break;
      case 'changeMap':
        needRef(c, 'map', ['map_'], idx, pt, out);
        if (c.at !== undefined && !(Array.isArray(c.at) && c.at.length === 2 && intOr(c.at[0], -1) >= 0 && intOr(c.at[1], -1) >= 0)) problem(out, pt + '.at', 'error', 'type', 'at is a cell [x, y].');
        if (c.dir !== undefined && !DIRS[c.dir]) problem(out, pt + '.dir', 'error', 'enum', 'dir is up, down, left, or right.');
        break;
      case 'vehicle':
        if (c.kind !== 'ship' && c.kind !== 'airship') problem(out, pt + '.kind', 'error', 'enum', 'kind is ship or airship.');
        if (c.act !== 'board' && c.act !== 'leave') problem(out, pt + '.act', 'error', 'enum', 'act is board or leave.');
        break;
      case 'callEvent':
        needRef(c, 'evt', ['evt_'], idx, pt, out);
        if (ctx && ctx.evt && c.evt === ctx.evt) problem(out, pt + '.evt', 'error', 'recursion', 'An event cannot call itself.');
        break;
      case 'ending':
        needRef(c, 'end', ['end_'], idx, pt, out);
        break;
      default:
        problem(out, pt + '.op', 'error', 'op', 'Unknown command op ' + JSON.stringify(c.op) + '. Use ' + CMD_OPS.join(', ') + '.');
    }
  }
  // Everything a command list reads, sets, and names, for the Flags tab's cross reference and Phase 7:
  //   {reads {flags items chapters quests}, sets {flags}, quests {qst: [stage or branch.outcome or 'fail']}, items {give,
  //    take}, refs {prefix: [ids]}, events [called], endings, battles [trp]} with every list sorted and unique.
  function cmdRefs(list) {
    var rd = { flags: {}, items: {}, chapters: {}, quests: {} }, sets = {}, qs = {}, give = {}, take = {}, refs = {}, calls = {}, ends = {}, trps = {};
    function ref(v) { var p = prefixOf(v); if (p) { refs[p] = refs[p] || {}; refs[p][v] = 1; } }
    walkCmds(list, function (c) {
      if (!isObj(c)) return;
      if (c.op === 'if') condReads(c.cond, rd);
      if (c.op === 'choice' && Array.isArray(c.options)) for (var i = 0; i < c.options.length; i++) if (isObj(c.options[i])) condReads(c.options[i].cond, rd);
      if ((c.op === 'setFlag' || c.op === 'addFlag') && typeof c.flg === 'string') sets[c.flg] = 1;
      if (c.op === 'giveItem' && typeof c.itm === 'string') give[c.itm] = 1;
      if (c.op === 'takeItem' && typeof c.itm === 'string') take[c.itm] = 1;
      if (c.op === 'questStage' && typeof c.qst === 'string') { qs[c.qst] = qs[c.qst] || {}; qs[c.qst][c.fail === true ? 'fail' : c.branch !== undefined ? c.branch + '.' + c.outcome : String(c.stage)] = 1; }
      if (c.op === 'callEvent' && typeof c.evt === 'string') calls[c.evt] = 1;
      if (c.op === 'ending' && typeof c.end === 'string') ends[c.end] = 1;
      if (c.op === 'startBattle' && typeof c.trp === 'string') trps[c.trp] = 1;
      ['speaker', 'por', 'flg', 'itm', 'qst', 'chr', 'trp', 'who', 'mus', 'sfx', 'map', 'evt', 'end'].forEach(function (f) { ref(c[f]); });
    });
    each(rd.flags, function (v, k) { ref(k); }); each(rd.items, function (v, k) { ref(k); }); each(rd.chapters, function (v, k) { ref(k); }); each(rd.quests, function (v, k) { ref(k); });
    var r = {}; each(refs, function (m, p) { r[p] = keys(m); });
    var q = {}; each(qs, function (m, k) { q[k] = keys(m); });
    return { reads: sortedReads(rd), sets: { flags: keys(sets) }, quests: q, items: { give: keys(give), take: keys(take) }, refs: r, events: keys(calls), endings: keys(ends), battles: keys(trps) };
  }
  S.cmd = {
    OPS: CMD_OPS, DIRS: keys(DIRS),
    // lint(list, idx, path, ctx): ctx {evt} names the event the list belongs to, so a call to itself is caught.
    lint: function (list, idx, path, ctx) { var out = []; lintList(list, idx, path || 'cmds', out, 0, ctx || null); return out; },
    walk: function (list, fn) { walkCmds(list, fn); },
    refs: cmdRefs
  };
