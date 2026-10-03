/* Saga Forge ENGINE:BATTLE, engine version 1.0.0
 * Forge 146 export. Declares one global, ENGINE_BATTLE. No dependencies. */
var ENGINE_BATTLE = (function () {
  'use strict';
  // Pure battle engine. This fence must stay self contained: no host globals and no outer variables. Pass 4a added the
  // safe expression evaluator (a duplicate of the shared expression core); Pass 5 adds the templates, the seeded rng,
  // the scheduler and progression registries, the resolver, gambits, counters, Limits, and init / advance / run / replay.
  var expr = (function () {
    var FUNCS = { min: [1, 99], max: [1, 99], floor: [1, 1], ceil: [1, 1], round: [1, 1], clamp: [3, 3], pow: [2, 2], sqrt: [1, 1] };
    var FUNC_NAMES = ['min', 'max', 'floor', 'ceil', 'round', 'clamp', 'pow', 'sqrt'];
    var MAX_LEN = 2000;
    var VAR_HELP = 'Use a.<stat>, a.level, t.<stat>, t.level, power, or p.<param>.';
    var PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };

    function fail(msg, pos) { var e = new Error(msg); if (pos != null) e.pos = pos; throw e; }
    function has(o, k) { return o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
    function isDigit(c) { return c >= '0' && c <= '9'; }
    function isIdStart(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
    function isIdPart(c) { return isIdStart(c) || isDigit(c); }

    function tokenize(src) {
      if (typeof src !== 'string') fail('The expression must be text.');
      if (src.length > MAX_LEN) fail('The expression is longer than ' + MAX_LEN + ' characters.');
      var out = [], i = 0, n = src.length, c, j, k, d, seenDot, nx;
      while (i < n) {
        c = src.charAt(i);
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
        if (isDigit(c) || (c === '.' && i + 1 < n && isDigit(src.charAt(i + 1)))) {
          j = i; seenDot = false;
          while (j < n) {
            d = src.charAt(j);
            if (isDigit(d)) j++;
            else if (d === '.' && !seenDot) { seenDot = true; j++; }
            else break;
          }
          nx = src.charAt(j);
          if (nx === '.') fail("Unexpected '.' at position " + (j + 1) + '.', j);
          if (nx !== '' && isIdStart(nx)) fail("Unexpected '" + nx + "' after a number at position " + (j + 1) + '.', j);
          out.push({ t: 'num', v: parseFloat(src.slice(i, j)), pos: i });
          i = j;
          continue;
        }
        if (isIdStart(c)) {
          k = i + 1;
          while (k < n && isIdPart(src.charAt(k))) k++;
          if (src.charAt(k) === '.' && k + 1 < n && isIdStart(src.charAt(k + 1))) {
            k++;
            while (k < n && isIdPart(src.charAt(k))) k++;
          }
          out.push({ t: 'id', v: src.slice(i, k), pos: i });
          i = k;
          continue;
        }
        if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') { out.push({ t: 'op', v: c, pos: i }); i++; continue; }
        if (c === '(') { out.push({ t: 'lp', pos: i }); i++; continue; }
        if (c === ')') { out.push({ t: 'rp', pos: i }); i++; continue; }
        if (c === ',') { out.push({ t: 'comma', pos: i }); i++; continue; }
        fail("Illegal character '" + c + "' at position " + (i + 1) + '.', i);
      }
      return out;
    }

    function checkVar(name, pos, opts) {
      var m, who, key, i, ok;
      if (name === 'power') return;
      m = /^([atp])\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(name);
      if (!m) fail("Unknown variable '" + name + "'. " + VAR_HELP, pos);
      who = m[1]; key = m[2];
      if (who === 'p') {
        if (opts && opts.params) {
          ok = false;
          for (i = 0; i < opts.params.length; i++) { if (opts.params[i] === key) ok = true; }
          if (!ok) fail("Unknown parameter 'p." + key + "'. Declared parameters: " + (opts.params.length ? opts.params.join(', ') : 'none') + '.', pos);
        }
        return;
      }
      if (key === 'level') return;
      if (!/^[a-z][a-z0-9]*$/.test(key)) fail("Unknown variable '" + name + "'. " + VAR_HELP, pos);
      if (opts && opts.stats) {
        ok = false;
        for (i = 0; i < opts.stats.length; i++) { if (opts.stats[i] === key) ok = true; }
        if (!ok) fail("Unknown stat '" + key + "' in " + name + '. Declared stats: ' + (opts.stats.length ? opts.stats.join(', ') : 'none') + '.', pos);
      }
    }

    // Tokenizer plus shunting yard parser. Returns an AST of {type:'num'|'var'|'un'|'bin'|'call'}.
    function parse(src, opts) {
      var toks = tokenize(src), out = [], ops = [], prev = 'start', i, t, top, nxt, prec, right, ar, argc, args, v;
      if (!toks.length) fail('The expression is empty.');
      function popApply() {
        var op = ops.pop(), r, l;
        if (op.k === 'un') {
          if (out.length < 1) fail("Missing operand after '" + op.v + "' at position " + (op.pos + 1) + '.', op.pos);
          out.push({ type: 'un', op: op.v, arg: out.pop() });
        } else {
          if (out.length < 2) fail("Missing operand for '" + op.v + "' at position " + (op.pos + 1) + '.', op.pos);
          r = out.pop(); l = out.pop();
          out.push({ type: 'bin', op: op.v, left: l, right: r });
        }
      }
      function unwindToMarker() {
        while (ops.length && ops[ops.length - 1].k !== 'lp' && ops[ops.length - 1].k !== 'fn') popApply();
      }
      for (i = 0; i < toks.length; i++) {
        t = toks[i];
        if (t.t === 'num') {
          if (prev === 'operand') fail("Missing operator before '" + t.v + "' at position " + (t.pos + 1) + '.', t.pos);
          out.push({ type: 'num', value: t.v });
          prev = 'operand';
        } else if (t.t === 'id') {
          if (prev === 'operand') fail("Missing operator before '" + t.v + "' at position " + (t.pos + 1) + '.', t.pos);
          nxt = toks[i + 1];
          if (nxt && nxt.t === 'lp') {
            if (!has(FUNCS, t.v)) fail("Unknown function '" + t.v + "'. Allowed functions: " + FUNC_NAMES.join(', ') + '.', t.pos);
            ops.push({ k: 'fn', v: t.v, argc: 0, pos: t.pos });
            i++;
            prev = 'open';
          } else {
            checkVar(t.v, t.pos, opts);
            out.push({ type: 'var', name: t.v });
            prev = 'operand';
          }
        } else if (t.t === 'lp') {
          if (prev === 'operand') fail("Missing operator before '(' at position " + (t.pos + 1) + '.', t.pos);
          ops.push({ k: 'lp', pos: t.pos });
          prev = 'open';
        } else if (t.t === 'rp') {
          if (prev === 'op' || prev === 'comma') fail("Missing operand before ')' at position " + (t.pos + 1) + '.', t.pos);
          unwindToMarker();
          if (!ops.length) fail("Unmatched ')' at position " + (t.pos + 1) + '.', t.pos);
          top = ops.pop();
          if (top.k === 'lp') {
            if (prev === 'open') fail("Empty parentheses at position " + (t.pos + 1) + '.', t.pos);
          } else {
            argc = prev === 'open' ? 0 : top.argc + 1;
            ar = FUNCS[top.v];
            if (argc < ar[0] || argc > ar[1]) {
              fail(top.v + ' takes ' + (ar[0] === ar[1] ? 'exactly ' + ar[0] : 'at least ' + ar[0]) + ' argument' + (ar[0] === 1 ? '' : 's') + ' but got ' + argc + '.', top.pos);
            }
            args = out.splice(out.length - argc, argc);
            out.push({ type: 'call', name: top.v, args: args });
          }
          prev = 'operand';
        } else if (t.t === 'comma') {
          if (prev !== 'operand') fail("Missing argument before ',' at position " + (t.pos + 1) + '.', t.pos);
          unwindToMarker();
          if (!ops.length || ops[ops.length - 1].k !== 'fn') fail("Unexpected ',' at position " + (t.pos + 1) + '. Commas only separate function arguments.', t.pos);
          ops[ops.length - 1].argc++;
          prev = 'comma';
        } else {
          v = t.v;
          if (prev === 'operand') {
            prec = PREC[v]; right = v === '^';
            while (ops.length) {
              top = ops[ops.length - 1];
              if (top.k !== 'bin' && top.k !== 'un') break;
              if (top.prec > prec || (top.prec === prec && !right)) popApply(); else break;
            }
            ops.push({ k: 'bin', v: v, prec: prec, pos: t.pos });
            prev = 'op';
          } else {
            if (v !== '-' && v !== '+') fail("Unexpected operator '" + v + "' at position " + (t.pos + 1) + '.', t.pos);
            ops.push({ k: 'un', v: v, prec: 3, pos: t.pos });
            prev = 'op';
          }
        }
      }
      if (prev !== 'operand') fail(prev === 'start' ? 'The expression is empty.' : 'The expression ends unexpectedly.');
      while (ops.length) {
        top = ops[ops.length - 1];
        if (top.k === 'lp' || top.k === 'fn') fail("Unmatched '(' at position " + (top.pos + 1) + '.', top.pos);
        popApply();
      }
      if (out.length !== 1) fail('The expression is not well formed.');
      return out[0];
    }

    function finite(v, what) {
      if (typeof v !== 'number' || !isFinite(v)) fail('The result of ' + what + ' is not a finite number.');
      return v;
    }
    function lookup(scope, name) {
      var dot, who, key, bag, v;
      if (name === 'power') v = scope ? scope.power : undefined;
      else {
        dot = name.indexOf('.'); who = name.slice(0, dot); key = name.slice(dot + 1);
        bag = scope ? (who === 'a' ? scope.a : who === 't' ? scope.t : scope.p) : undefined;
        v = has(bag, key) ? bag[key] : undefined;
      }
      if (typeof v !== 'number' || !isFinite(v)) fail('No value was supplied for ' + name + '.');
      return v;
    }
    function ev(node, scope) {
      var l, r, v, args, k;
      switch (node.type) {
        case 'num': return node.value;
        case 'var': return lookup(scope, node.name);
        case 'un': v = ev(node.arg, scope); return node.op === '-' ? -v : v;
        case 'bin':
          l = ev(node.left, scope); r = ev(node.right, scope);
          if (node.op === '+') v = l + r;
          else if (node.op === '-') v = l - r;
          else if (node.op === '*') v = l * r;
          else if (node.op === '/') { if (r === 0) fail('Division by zero.'); v = l / r; }
          else v = Math.pow(l, r);
          return finite(v, "'" + node.op + "'");
        case 'call':
          args = [];
          for (k = 0; k < node.args.length; k++) args.push(ev(node.args[k], scope));
          switch (node.name) {
            case 'min': v = Math.min.apply(null, args); break;
            case 'max': v = Math.max.apply(null, args); break;
            case 'floor': v = Math.floor(args[0]); break;
            case 'ceil': v = Math.ceil(args[0]); break;
            case 'round': v = Math.round(args[0]); break;
            case 'sqrt': if (args[0] < 0) fail('sqrt needs a value that is not negative.'); v = Math.sqrt(args[0]); break;
            case 'pow': v = Math.pow(args[0], args[1]); break;
            default:
              if (args[1] > args[2]) fail('clamp needs its low bound to be at most its high bound.');
              v = Math.min(Math.max(args[0], args[1]), args[2]);
          }
          return finite(v, node.name + '()');
        default:
          return fail('The expression is not well formed.');
      }
    }
    // scope = {a:{level, <stat>...}, t:{level, <stat>...}, power, p:{<param>...}}
    function evaluate(astOrSrc, scope, opts) {
      var ast = typeof astOrSrc === 'string' ? parse(astOrSrc, opts) : astOrSrc;
      return finite(ev(ast, scope || {}), 'the expression');
    }
    // Names of every variable an AST uses, sorted and unique.
    function variables(ast) {
      var seen = {}, list = [];
      (function walk(n) {
        var i;
        if (!n) return;
        if (n.type === 'var') { if (!seen[n.name]) { seen[n.name] = 1; list.push(n.name); } }
        else if (n.type === 'un') walk(n.arg);
        else if (n.type === 'bin') { walk(n.left); walk(n.right); }
        else if (n.type === 'call') { for (i = 0; i < n.args.length; i++) walk(n.args[i]); }
      })(ast);
      return list.sort();
    }
  return { parse: parse, evaluate: evaluate, variables: variables };
  })();
  // ------------------------------------------------------------------ Pass 5: templates, rng, battle loop
  var VERSION = '1.0.0';
  var GAUGE_MAX = 65536;
  // Template registry. Parameter names, defaults and expressions mirror WS.rules.FORMULA_LIB exactly (the harness checks).
  var TEMPLATES = {
    'phys.ff6': { id: 'phys.ff6', role: 'phys', kind: 'damage', expr: 'max(p.floor, floor((power + a.level * a.level * a.str / p.levelDiv) * (p.defBase - min(t.def, p.defBase - 1)) / p.defBase * p.mult))', params: { levelDiv: 256, defBase: 256, mult: 1, floor: 1 } },
    'mag.ff6': { id: 'mag.ff6', role: 'mag', kind: 'damage', expr: 'max(p.floor, floor((power * p.powerMult + a.level * a.mag * power / p.levelDiv) * (p.defBase - min(t.mdef, p.defBase - 1)) / p.defBase))', params: { powerMult: 4, levelDiv: 32, defBase: 256, floor: 1 } },
    'phys.sub': { id: 'phys.sub', role: 'phys', kind: 'damage', expr: 'max(p.floor, floor(a.str * p.atkMult + power - t.def * p.defMult))', params: { atkMult: 1, defMult: 0.5, floor: 1 } },
    'mag.flat': { id: 'mag.flat', role: 'mag', kind: 'damage', expr: 'max(p.floor, floor(power + a.mag * p.magMult - t.mdef * p.mdefMult))', params: { magMult: 1, mdefMult: 0.5, floor: 1 } },
    'heal.std': { id: 'heal.std', role: 'heal', kind: 'heal', expr: 'max(p.floor, floor((power + a.mag * p.magMult) * p.mult))', params: { magMult: 2, mult: 1, floor: 1 } },
    'var.std': { id: 'var.std', role: 'var', kind: 'variance', expr: '1 + p.spread * (2 * p.roll - 1)', params: { spread: 0.1, roll: 0.5 } },
    'exp.curve': { id: 'exp.curve', role: 'exp', kind: 'curve', expr: 'floor(p.base * pow(max(a.level - 1, 0), p.exponent))', params: { base: 40, exponent: 2.1 } },
    'ap.curve': { id: 'ap.curve', role: 'ap', kind: 'curve', expr: 'floor(p.base * pow(p.growth, max(a.level - 1, 0)))', params: { base: 100, growth: 2 } },
    'atb.fill': { id: 'atb.fill', role: 'atb', kind: 'rate', expr: 'floor((a.spd + p.spdOffset) * p.rate)', params: { spdOffset: 20, rate: 8 } }
  };
  var ABL_ROLE = { attack: 'phys', magic: 'mag', heal: 'heal', summon: 'mag', enemy: 'phys', limit: 'phys', command: 'phys' };
  var PHYS_KINDS = { attack: 1, enemy: 1, limit: 1, command: 1 };
  var AFF_MULT = { weak: 2, normal: 1, resist: 0.5, immune: 0, absorb: -1 };
  var SCHEDULERS = { atb: 1, rounds: 1, conditional: 1 };
  var PROGRESSIONS = { materia: 1, jobs: 1, classes: 1 };
  var EV = null; // event sink for the call in progress (single threaded)

  function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : (d === undefined ? 0 : d); }
  function clampN(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function prefixOf(id) { var m = /^([a-z]{3}_)/.exec(typeof id === 'string' ? id : ''); return m ? m[1] : null; }
  function numParams(o) { var out = {}; if (isObj(o)) Object.keys(o).forEach(function (k) { if (typeof o[k] === 'number' && isFinite(o[k])) out[k] = o[k]; }); return out; }

  // mulberry32 seeded by an integer. The state and the call count live in the battle state.
  function mkRng(seed) { return { a: (Math.floor(num(seed, 1)) | 0), calls: 0 }; }
  function rnd(S) {
    var a = (S.rng.a + 0x6D2B79F5) | 0, t;
    S.rng.a = a; S.rng.calls++;
    t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function emit(S, type, o) {
    if (!EV) return;
    o = o || {};
    var e = { type: type, t: S.t, actor: o.actor == null ? null : o.actor, target: o.target == null ? null : o.target, value: o.value === undefined ? null : o.value, element: o.element || null, crit: !!o.crit };
    if (o.abl) e.abl = o.abl;
    if (o.name) e.name = o.name;
    if (o.targets) e.targets = o.targets;
    EV.push(e);
  }

  // ------------------------------------------------------------------ formulas
  function fxFrom(db, id, R) {
    if (!id) return null;
    if (db.fx[id]) return id;
    var src = null, t, rec;
    if (TEMPLATES[id]) { t = TEMPLATES[id]; src = { expr: t.expr, params: clone(t.params) }; }
    else if (prefixOf(id) === 'frm_') {
      rec = R.frm_ && R.frm_[id];
      if (isObj(rec)) {
        if (rec.template && TEMPLATES[rec.template]) { t = TEMPLATES[rec.template]; src = { expr: t.expr, params: Object.assign(clone(t.params), numParams(rec.params)) }; }
        else if (typeof rec.expr === 'string' && rec.expr.trim()) src = { expr: rec.expr, params: numParams(rec.params) };
      }
    }
    if (!src) return null;
    try { db.fx[id] = { ast: expr.parse(src.expr), params: src.params }; }
    catch (e) { db.warnings.push('Formula ' + id + ' does not parse: ' + e.message); return null; }
    return id;
  }
  function scopeOf(u) {
    var o = { level: u ? u.level : 1 }, k;
    if (u) for (k in u.stats) o[k] = u.stats[k];
    return o;
  }
  function evalF(S, fid, a, t, power, extra, fallback) {
    var f = fid && S.db.fx[fid], p, k;
    if (!f) return fallback;
    p = {};
    for (k in f.params) p[k] = f.params[k];
    if (extra) for (k in extra) p[k] = extra[k];
    try { return expr.evaluate(f.ast, { a: a, t: t, power: num(power), p: p }); }
    catch (e) {
      if (S.db.warnings.length < 20) S.db.warnings.push('Formula ' + fid + ': ' + e.message);
      return fallback;
    }
  }
  function roleFx(S, role) { return S.db.roles[role] || null; }

  // ------------------------------------------------------------------ compile the data into a compact db
  function compile(data, opts) {
    var rs = isObj(data.ruleset) ? data.ruleset : {}, R = isObj(data.records) ? data.records : {};
    var battle = isObj(rs.battle) ? rs.battle : {}, db, tax = isObj(rs.taxonomy) ? rs.taxonomy : {};
    db = {
      abl: {}, sta: {}, gmb: {}, fx: {}, roles: {}, warnings: [],
      stats: arr(rs.stats).filter(isObj).map(function (s) { return { key: String(s.key), min: num(s.min, 0), max: num(s.max, 999999) }; }).filter(function (s) { return s.key; }),
      elements: arr(rs.elements).map(function (e) { return isObj(e) ? String(e.key) : String(e); }).filter(Boolean),
      relations: arr(rs.elementRelations).filter(function (r) { return isObj(r) && (!r.kind || r.kind === 'opposed'); }).map(function (r) { return [String(r.a), String(r.b)]; }),
      inverts: arr(tax.inverts).map(String),
      weather: {},
      attackPower: num(opts.attackPower, num(battle.attackPower, 12)),
      damageCap: num(opts.damageCap, num(battle.damageCap, 9999)),
      limitRate: Math.max(0, num(opts.limitRate, num(battle.limitRate, 1)))
    };
    var fs = isObj(rs.formulaSet) ? rs.formulaSet : {};
    ['phys', 'mag', 'heal', 'var', 'atb', 'exp', 'ap'].forEach(function (role) { var id = fxFrom(db, fs[role], R); if (id) db.roles[role] = id; });
    var w = data.weatherId && R.wth_ && R.wth_[data.weatherId];
    if (isObj(w) && isObj(w.elementMultipliers)) Object.keys(w.elementMultipliers).forEach(function (k) { var v = w.elementMultipliers[k]; if (typeof v === 'number' && isFinite(v)) db.weather[k] = v; });
    db.weatherId = isObj(w) ? data.weatherId : null;
    db.attack = { id: '_attack', name: 'Attack', kind: 'attack', power: db.attackPower, targeting: { side: 'foe', scope: 'single' }, cost: {}, statusEffects: [], chargeTicks: 0 };
    return db;
  }
  function rec(R, id) { var p = prefixOf(id); return p && isObj(R[p]) && isObj(R[p][id]) ? R[p][id] : null; }
  function addAbl(db, R, id) {
    if (!id) return null;
    if (id === '_attack') return db.attack;
    if (db.abl[id]) return db.abl[id];
    var r = rec(R, id), a;
    if (!r || prefixOf(id) !== 'abl_') return null;
    a = {
      id: id, name: String(r.name || id), kind: String(r.kind || 'attack'), element: r.element || null, power: num(r.power),
      cost: { mp: num(r.cost && r.cost.mp) }, chargeTicks: Math.max(0, Math.floor(num(r.chargeTicks))),
      targeting: { side: (r.targeting && r.targeting.side) || 'foe', scope: (r.targeting && r.targeting.scope) || 'single' },
      statusEffects: arr(r.statusEffects).filter(function (s) { return isObj(s) && s.sta; }).map(function (s) { return { sta: s.sta, chance: num(s.chance, 1) }; }),
      fx: fxFrom(db, r.formula, R), revive: !!r.revive
    };
    a.statusEffects.forEach(function (s) { addSta(db, R, s.sta); });
    db.abl[id] = a;
    return a;
  }
  function addSta(db, R, id) {
    if (db.sta[id]) return db.sta[id];
    var r = rec(R, id);
    if (!r) return null;
    db.sta[id] = {
      id: id, name: String(r.name || id), gauge: r.gauge || 'normal',
      tick: { kind: (r.tickEffect && r.tickEffect.kind) || 'none', percent: num(r.tickEffect && r.tickEffect.percent) },
      duration: Math.max(0, Math.floor(num(r.duration))), onHit: !!(r.cure && r.cure.onHit)
    };
    return db.sta[id];
  }
  function addRules(db, R, id, rules, counters) {
    var g = { rules: [], counters: [] };
    arr(rules).forEach(function (x) {
      if (!isObj(x)) return;
      var abl = x.action && x.action.abl;
      if (!addAbl(db, R, abl)) return;
      var c = isObj(x.condition) ? x.condition : { kind: 'always' };
      if ((c.kind === 'targetHasStatus' || c.kind === 'targetLacksStatus') && c.param) addSta(db, R, String(c.param).trim());
      g.rules.push({ condition: { kind: c.kind || 'always', param: c.param == null ? '' : String(c.param) }, target: { selector: (x.target && x.target.selector) || 'randomFoe' }, action: { abl: abl } });
    });
    arr(counters).forEach(function (x) {
      if (!isObj(x) || !x.trigger) return;
      var abl = x.action && x.action.abl;
      if (!addAbl(db, R, abl)) return;
      g.counters.push({ trigger: x.trigger, abl: abl });
    });
    db.gmb[id] = g;
    return id;
  }

  // ------------------------------------------------------------------ units
  function statsFor(db, base, growth, level) {
    var out = {};
    db.stats.forEach(function (s) {
      var v = Math.round(num(base && base[s.key]) + num(growth && growth[s.key]) * (level - 1));
      out[s.key] = clampN(v, s.min, s.max);
    });
    return out;
  }
  function groupFor(kind) {
    if (kind === 'magic' || kind === 'heal' || kind === 'status') return 'magic';
    if (kind === 'summon') return 'summon';
    if (kind === 'limit' || kind === 'passive') return null;
    return 'skill';
  }
  function matLevel(m, ap) {
    var lv = 1;
    arr(m.apThresholds).forEach(function (th) { if (typeof th === 'number' && ap >= th) lv++; });
    return lv;
  }
  var PROGRESSION = {
    // Slotted materia and linked pairs produce commands, abilities and stat mods. Support materia modifies its linked neighbor.
    materia: function (db, R, m, u, grant, mods) {
      var slots = arr(m.materia).filter(function (x) { return isObj(x) && rec(R, x.mat); });
      var info = slots.map(function (x) {
        var mr = rec(R, x.mat), lv = matLevel(mr, num(x.ap)), abls = [];
        arr(mr.grants).forEach(function (g) {
          if (!isObj(g) || num(g.level, 1) > lv) return;
          if (g.abl && addAbl(db, R, g.abl)) abls.push(g.abl);
          if (isObj(g.statMods)) Object.keys(g.statMods).forEach(function (k) { mods[k] = num(mods[k]) + num(g.statMods[k]); });
        });
        return { x: x, rec: mr, level: lv, abls: abls };
      });
      info.forEach(function (it) {
        var kind = it.rec.kind;
        if (kind === 'support') return;
        it.abls.forEach(function (id) {
          var a = db.abl[id];
          if (kind === 'command') grant('cmd:' + id, a.name, id);
          else if (kind === 'summon') grant('summon', 'Summon', id);
          else if (kind === 'magic') grant('magic', 'Magic', id);
          else { var gr = groupFor(a.kind); if (gr) grant(gr, gr === 'magic' ? 'Magic' : gr === 'summon' ? 'Summon' : 'Skill', id); }
        });
      });
      // linked support materia
      info.forEach(function (it) {
        if (it.rec.kind !== 'support') return;
        var eq = rec(R, it.x.eqp), links = eq && isObj(eq.slotLayout) ? arr(eq.slotLayout.links) : [], n = null, cnt = eq && isObj(eq.slotLayout) ? num(eq.slotLayout.count) : 0;
        links.forEach(function (l) {
          if (n || !Array.isArray(l) || l.length !== 2) return;
          var other = l[0] === it.x.slot ? l[1] : l[1] === it.x.slot ? l[0] : null;
          if (other === null || other >= cnt || it.x.slot >= cnt) return;
          info.forEach(function (o) { if (!n && o !== it && o.x.eqp === it.x.eqp && o.x.slot === other) n = o; });
        });
        if (!n) return;
        var eff = it.rec.supportEffect;
        u.supports.push({ mat: it.x.mat, effect: eff, neighbor: n.x.mat });
        if (eff === 'all' || eff === 'hpAbsorb' || eff === 'mpAbsorb') {
          n.abls.forEach(function (id) { var md = u.mods[id] || (u.mods[id] = {}); md[eff === 'all' ? 'all' : eff] = true; });
        } else if (eff === 'element') {
          if (n.rec.element) u.attackElement = n.rec.element;
        } else if (eff === 'addedEffect') {
          n.abls.forEach(function (id) { db.abl[id].statusEffects.forEach(function (s) { u.addedEffects.push({ sta: s.sta, chance: s.chance }); }); });
        } else if (eff === 'counter') {
          u.counter = n.abls[0] || '_attack';
        }
      });
    },
    jobs: function (db, R, m, u, grant, mods) {
      var j = rec(R, m.job), jl = num(m.jobLevel, u.level);
      if (!j) return;
      arr(j.abilities).forEach(function (x) { if (isObj(x) && num(x.level, 1) <= jl && addAbl(db, R, x.abl)) { var a = db.abl[x.abl], g = groupFor(a.kind); if (g) grant(g, g === 'magic' ? 'Magic' : g === 'summon' ? 'Summon' : 'Skill', x.abl); } });
      if (isObj(j.statMods)) Object.keys(j.statMods).forEach(function (k) { mods[k] = num(mods[k]) + num(j.statMods[k]); });
    },
    classes: function (db, R, m, u, grant, mods) {
      var c = rec(R, m.cls);
      if (!c) return;
      arr(c.skillTree).forEach(function (x) { if (isObj(x) && num(x.level, 1) <= u.level && addAbl(db, R, x.abl)) { var a = db.abl[x.abl], g = groupFor(a.kind); if (g) grant(g, g === 'magic' ? 'Magic' : g === 'summon' ? 'Summon' : 'Skill', x.abl); } });
      if (isObj(c.statMods)) Object.keys(c.statMods).forEach(function (k) { mods[k] = num(mods[k]) + num(c.statMods[k]); });
    }
  };

  function partyUnit(db, R, m, i, prog) {
    var c = rec(R, m.chr);
    if (!c) { db.warnings.push('Party member ' + (i + 1) + ' has no character record.'); return null; }
    var L = clampN(Math.floor(num(m.level, 1)), 1, 99), mods = {}, cmds = [], byKey = {};
    var u = {
      uid: 'p' + i, side: 'party', ref: m.chr, name: String(c.name || m.chr), level: L, row: m.row === 'back' ? 'back' : 'front',
      weaponClass: c.weaponClass || '', stats: statsFor(db, c.baseStats, c.growth, L), mods: {}, supports: [], addedEffects: [],
      attackElement: null, counter: null, affinity: {}, tax: null, gambit: null
    };
    arr(m.equipment).forEach(function (eid) {
      var e = rec(R, eid);
      if (!e || !isObj(e.stats)) return;
      Object.keys(e.stats).forEach(function (k) { if (u.stats[k] !== undefined) u.stats[k] += Math.round(num(e.stats[k])); });
    });
    function grant(key, label, id) {
      if (!byKey[key]) { byKey[key] = { key: key, label: label, abls: [] }; cmds.push(byKey[key]); }
      if (byKey[key].abls.indexOf(id) < 0) byKey[key].abls.push(id);
    }
    if (PROGRESSION[prog]) PROGRESSION[prog](db, R, m, u, grant, mods);
    arr(m.abilities).forEach(function (id) { var a = addAbl(db, R, id), g; if (a) { g = groupFor(a.kind); if (g) grant(g, g === 'magic' ? 'Magic' : g === 'summon' ? 'Summon' : 'Skill', id); } });
    db.stats.forEach(function (s) { if (mods[s.key]) u.stats[s.key] = clampN(Math.round(u.stats[s.key] * (1 + mods[s.key] / 100)), s.min, s.max); });
    u.statMods = mods;
    u.commands = cmds.sort(function (a, b) { var o = { magic: 1, summon: 2 }; return (o[a.key] || 3) - (o[b.key] || 3); });
    u.maxHp = Math.max(1, num(u.stats.hp, 100));
    u.maxMp = Math.max(0, num(u.stats.mp, 0));
    u.hp = m.hp != null ? clampN(Math.floor(num(m.hp)), 0, u.maxHp) : u.maxHp;
    u.mp = m.mp != null ? clampN(Math.floor(num(m.mp)), 0, u.maxMp) : u.maxMp;
    u.limits = arr(c.limitTree).map(function (lid) { return rec(R, lid) ? { id: lid, r: rec(R, lid) } : null; }).filter(Boolean)
      .filter(function (x) { return addAbl(db, R, x.r.action); })
      .map(function (x) { return { id: x.id, level: clampN(Math.floor(num(x.r.level, 1)), 1, 4), abl: x.r.action, uses: num(x.r.unlock && x.r.unlock.uses), kills: num(x.r.unlock && x.r.unlock.kills) }; })
      .sort(function (a, b) { return a.level - b.level; });
    u.limit = { gauge: clampN(num(m.limitGauge), 0, 1), level: clampN(Math.floor(num(m.limitLevel, 1)), 1, 4), uses: num(m.limitUses), usesAtLevel: 0, kills: num(m.kills) };
    if (u.counter) addAbl(db, R, u.counter);
    return u;
  }

  function affinityFor(db, famType, absorbOwn, overrides) {
    var out = {}, opp = [];
    db.relations.forEach(function (p) { if (p[0] === famType) opp.push(p[1]); if (p[1] === famType) opp.push(p[0]); });
    db.elements.forEach(function (k) {
      if (famType && k === famType) out[k] = absorbOwn ? 'absorb' : 'resist';
      else if (opp.indexOf(k) >= 0) out[k] = 'weak';
      else out[k] = 'normal';
    });
    if (isObj(overrides)) Object.keys(overrides).forEach(function (k) { if (AFF_MULT[overrides[k]] !== undefined) out[k] = overrides[k]; });
    return out;
  }

  function foeUnits(db, R, troopId) {
    var t = rec(R, troopId), out = [], names = {};
    if (!t) { db.warnings.push('Troop ' + troopId + ' was not found.'); return out; }
    db.troop = { id: troopId, name: String(t.name || troopId), noEscape: !!(t.flags && t.flags.noEscape), preemptive: num(t.flags && t.flags.preemptiveChance) };
    var bst = {};
    Object.keys(isObj(R.bst_) ? R.bst_ : {}).forEach(function (id) { var b = R.bst_[id]; if (isObj(b) && b.boss && !bst[b.boss]) bst[b.boss] = id; });
    arr(t.members).forEach(function (mb, i) {
      if (!isObj(mb)) return;
      var e = rec(R, mb.enm);
      if (!e) { db.warnings.push('Troop member ' + (i + 1) + ' references a missing enemy.'); return; }
      var fam = rec(R, e.family) || {}, st = {}, gid = null;
      db.stats.forEach(function (s) { st[s.key] = clampN(Math.round(num(e.stats && e.stats[s.key])), s.min, s.max); });
      if (bst[mb.enm]) gid = addRules(db, R, bst[mb.enm], R.bst_[bst[mb.enm]].rules, R.bst_[bst[mb.enm]].counters);
      else if (e.gambits && rec(R, e.gambits)) gid = addRules(db, R, e.gambits, rec(R, e.gambits).rules, rec(R, e.gambits).counters);
      var nm = String(e.name || mb.enm);
      names[nm] = (names[nm] || 0) + 1;
      out.push({
        uid: 'e' + i, side: 'foe', ref: mb.enm, name: nm, level: clampN(Math.floor(num(e.level, 1)), 1, 99), row: mb.row === 'back' ? 'back' : 'front',
        fam: e.family || null, tier: Math.max(1, Math.floor(num(e.tier, 1))), palette: isObj(fam.palette) ? { base: fam.palette.base || null, accent: fam.palette.accent || null } : { base: null, accent: null },
        tax: fam.type || null, affinity: affinityFor(db, fam.type || null, !!fam.absorbsOwnType, e.affinityOverrides),
        stats: st, maxHp: Math.max(1, num(st.hp, 1)), maxMp: Math.max(0, num(st.mp)), gambit: gid, isBoss: !!e.isBoss,
        gil: num(e.gil), exp: num(e.exp), ap: num(e.ap), mods: {}, addedEffects: [], attackElement: null, counter: null, commands: [], limits: [], limit: null
      });
    });
    out.forEach(function (u) { u.hp = u.maxHp; u.mp = u.maxMp; });
    // Letter suffixes for repeated names
    var seen = {};
    out.forEach(function (u) { if (names[u.name] > 1) { seen[u.name] = (seen[u.name] || 0) + 1; u.name = u.name + ' ' + String.fromCharCode(64 + seen[u.name]); } });
    return out;
  }

  function fillOf(S, u) {
    var f = evalF(S, roleFx(S, 'atb'), scopeOf(u), {}, 0, null, null);
    if (f == null) f = Math.floor((num(u.stats.spd, 10) + 20) * 8);
    return Math.max(1, Math.floor(f));
  }
  function delayOf(S, u) { return Math.ceil(GAUGE_MAX / u.fill); }

  // ------------------------------------------------------------------ init
  function init(data, seed, opts) {
    data = isObj(data) ? data : {};
    opts = isObj(opts) ? opts : {};
    var rs = isObj(data.ruleset) ? data.ruleset : {}, R = isObj(data.records) ? data.records : {};
    var db = compile(data, opts);
    var sched = SCHEDULERS[opts.scheduler] ? opts.scheduler : SCHEDULERS[rs.scheduler] ? rs.scheduler : 'atb';
    var prog = PROGRESSIONS[rs.progression] ? rs.progression : null;
    var battle = isObj(rs.battle) ? rs.battle : {};
    var S = {
      v: VERSION, seed: Math.floor(num(seed, 1)) | 0, rng: mkRng(seed), t: 0, turns: 0, sched: sched, progression: prog,
      waitMode: opts.waitMode != null ? !!opts.waitMode : battle.waitMode != null ? !!battle.waitMode : true,
      tickCap: Math.max(10, Math.floor(num(opts.tickCap, 20000))), gaugeMax: GAUGE_MAX,
      db: db, units: [], readyQueue: [], awaiting: null, round: null, preemptive: false, result: null,
      res: { mpSpent: 0, hpStart: 0, hpMax: 0, mpMax: 0, itemsUsed: 0 }, damageLog: [], lastAttacker: {}, noLog: !!opts.noDamageLog
    };
    arr(data.party).forEach(function (m, i) { if (isObj(m)) { var u = partyUnit(db, R, m, i, prog); if (u) S.units.push(u); } });
    foeUnits(db, R, data.troopId).forEach(function (u) { S.units.push(u); });
    S.units.forEach(function (u) {
      u.gauge = 0; u.ready = false; u.charging = null; u.statuses = []; u.ko = u.hp <= 0; u.turns = 0; u.kills = u.limit ? u.limit.kills : 0;
      u.fill = fillOf(S, u); u.nextAt = 0; u.frozenTicks = 0; u.limitFlag = false;
    });
    S.units.forEach(function (u) { if (u.side === 'party') { S.res.hpStart += u.hp; S.res.hpMax += u.maxHp; S.res.mpMax += u.maxMp; } });
    S.preemptive = !!(db.troop && db.troop.preemptive > 0 && rnd(S) < db.troop.preemptive);
    S.units.forEach(function (u) {
      if (u.ko) return;
      if (sched === 'atb') u.gauge = S.preemptive && u.side === 'party' ? GAUGE_MAX - 1 : Math.floor(rnd(S) * GAUGE_MAX * 0.5);
      else if (sched === 'conditional') u.nextAt = S.preemptive && u.side === 'party' ? 0 : Math.floor(delayOf(S, u) * (0.25 + rnd(S) * 0.5));
    });
    if (!partyOf(S).length || !foesOf(S).length) S.result = finish(S, partyOf(S).length ? 'win' : 'lose', true);
    return S;
  }

  // ------------------------------------------------------------------ helpers over units
  function unit(S, uid) { for (var i = 0; i < S.units.length; i++) if (S.units[i].uid === uid) return S.units[i]; return null; }
  function sideOf(S, side, alive) { return S.units.filter(function (u) { return u.side === side && (!alive || !u.ko); }); }
  function partyOf(S) { return sideOf(S, 'party', false); }
  function foesOf(S) { return sideOf(S, 'foe', false); }
  function other(side) { return side === 'party' ? 'foe' : 'party'; }
  function frac(u) { return u.maxHp ? u.hp / u.maxHp : 0; }
  function hasSta(u, id) { for (var i = 0; i < u.statuses.length; i++) if (u.statuses[i].sta === id) return true; return false; }
  function blockedBy(S, u) {
    for (var i = 0; i < u.statuses.length; i++) { var d = S.db.sta[u.statuses[i].sta]; if (d && (d.gauge === 'freeze' || d.gauge === 'empty')) return d.gauge; }
    return null;
  }
  function ablOf(S, id) { return id === '_attack' ? S.db.attack : S.db.abl[id] || null; }
  function affordable(u, a) { return !!a && u.mp >= num(a.cost && a.cost.mp); }

  // ------------------------------------------------------------------ statuses
  function applyStatus(S, actor, u, staId) {
    var d = S.db.sta[staId];
    if (!d || u.ko) return;
    var had = false;
    u.statuses.forEach(function (s) { if (s.sta === staId) { s.left = d.duration || -1; had = true; } });
    if (!had) u.statuses.push({ sta: staId, left: d.duration || -1 });
    if (d.gauge === 'empty' && S.sched === 'atb') u.gauge = 0;
    if (d.gauge !== 'normal') { u.ready = false; u.charging = null; dropReady(S, u); }
    emit(S, 'status', { actor: actor ? actor.uid : null, target: u.uid, value: staId, name: d.name });
    counters(S, u, actor, 'onStatus', null);
  }
  function removeStatus(S, u, staId, why) {
    var before = u.statuses.length;
    u.statuses = u.statuses.filter(function (s) { return s.sta !== staId; });
    if (u.statuses.length !== before) emit(S, 'status', { target: u.uid, value: '-' + staId, name: why || 'cured' });
  }
  // Runs at the start of a unit's own turn (or once per skipped turn): tick effects, then durations.
  function statusTurn(S, u) {
    u.statuses.slice().forEach(function (s) {
      var d = S.db.sta[s.sta], v;
      if (!d || u.ko) return;
      if (d.tick.kind === 'damage' && d.tick.percent > 0) {
        v = Math.max(1, Math.floor(u.maxHp * d.tick.percent / 100));
        dealDamage(S, null, u, v, null, false, null);
      } else if (d.tick.kind === 'heal' && d.tick.percent > 0) {
        v = Math.max(1, Math.floor(u.maxHp * d.tick.percent / 100));
        u.hp = Math.min(u.maxHp, u.hp + v);
        emit(S, 'heal', { target: u.uid, value: v });
      } else if (d.tick.kind === 'mpDrain' && d.tick.percent > 0) {
        u.mp = Math.max(0, u.mp - Math.max(1, Math.floor(u.maxMp * d.tick.percent / 100)));
      }
      if (s.left > 0) { s.left--; if (s.left === 0) removeStatus(S, u, s.sta, 'wore off'); }
    });
  }

  // ------------------------------------------------------------------ damage, KO, limits, counters
  function dropReady(S, u) {
    S.readyQueue = S.readyQueue.filter(function (x) { return x !== u.uid; });
    if (S.awaiting && S.awaiting.actor === u.uid) { S.awaiting = null; nextAwaiting(S); }
  }
  function ko(S, u, killer) {
    u.ko = true; u.hp = 0; u.gauge = 0; u.ready = false; u.charging = null; u.statuses = [];
    if (u.limit) u.limit.gauge = 0;
    dropReady(S, u);
    emit(S, 'ko', { actor: killer ? killer.uid : null, target: u.uid });
    if (killer && killer.side !== u.side) {
      killer.kills++;
      if (killer.limit) { killer.limit.kills++; unlockLimits(S, killer); }
    }
    sideOf(S, u.side, true).forEach(function (a) { counters(S, a, killer, 'onAllyKo', null); });
  }
  function unlockLimits(S, u) {
    if (!u.limit || !u.limits.length) return;
    var next = null;
    u.limits.forEach(function (l) { if (!next && l.level === u.limit.level + 1) next = l; });
    if (!next) return;
    if ((next.uses > 0 && u.limit.usesAtLevel >= next.uses) || (next.kills > 0 && u.limit.kills >= next.kills)) {
      u.limit.level = next.level; u.limit.usesAtLevel = 0;
      emit(S, 'limitReady', { target: u.uid, value: 'level' + next.level, name: 'Limit level ' + next.level });
    }
  }
  function currentLimit(u) {
    var best = null;
    if (!u.limit) return null;
    u.limits.forEach(function (l) { if (l.level <= u.limit.level && (!best || l.level >= best.level)) best = l; });
    return best;
  }
  function dealDamage(S, actor, u, v, element, crit, abl) {
    var lowBefore = frac(u) >= 0.25;
    v = Math.max(0, Math.min(S.db.damageCap, Math.round(v)));
    u.hp = Math.max(0, u.hp - v);
    emit(S, 'damage', { actor: actor ? actor.uid : null, target: u.uid, value: v, element: element, crit: crit, abl: abl ? abl.id : null });
    if (!S.noLog) S.damageLog.push({ t: S.t, actor: actor ? actor.uid : null, target: u.uid, side: u.side, value: v, element: element || null, crit: !!crit, abl: abl ? abl.id : null });
    if (v > 0) {
      u.statuses.slice().forEach(function (s) { var d = S.db.sta[s.sta]; if (d && d.onHit) removeStatus(S, u, s.sta, 'woke'); });
      if (u.limit && u.limits.length && !u.ko && u.hp > 0) {
        var was = u.limit.gauge;
        u.limit.gauge = Math.min(1, u.limit.gauge + v / u.maxHp * S.db.limitRate);
        if (was < 1 && u.limit.gauge >= 1) emit(S, 'limitReady', { target: u.uid, value: 'full', name: 'Limit ready' });
      }
    }
    if (actor) S.lastAttacker[u.uid] = actor.uid;
    if (u.hp <= 0 && !u.ko) { ko(S, u, actor); return v; }
    if (actor && abl && v > 0) {
      counters(S, u, actor, PHYS_KINDS[abl.kind] ? 'onPhysical' : 'onMagic', abl);
      counters(S, u, actor, 'onDamaged', abl);
      if (lowBefore && frac(u) < 0.25) counters(S, u, actor, 'onLowHp', abl);
    }
    return v;
  }
  function healUnit(S, actor, u, v, abl) {
    v = Math.max(0, Math.min(S.db.damageCap, Math.round(v)));
    var before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + v);
    emit(S, 'heal', { actor: actor ? actor.uid : null, target: u.uid, value: u.hp - before, abl: abl ? abl.id : null });
  }
  // A counter fires at most once per hit and never answers another counter.
  function counters(S, u, attacker, trigger, abl) {
    if (!u || u.ko || S.inCounter || !attacker || attacker.side === u.side && trigger !== 'onAllyKo') return;
    if (trigger === 'onAllyKo' && (!attacker || attacker.side === u.side)) return;
    var pick = null, a;
    if (u.gambit && S.db.gmb[u.gambit]) {
      S.db.gmb[u.gambit].counters.forEach(function (c) { if (!pick && c.trigger === trigger) pick = c.abl; });
    }
    if (!pick && u.counter && trigger === 'onPhysical' && rnd(S) < 0.5) pick = u.counter;
    a = ablOf(S, pick);
    if (!a || !affordable(u, a) || attacker.ko) return;
    var targets = a.targeting.side === 'ally' || a.targeting.side === 'self' ? [u.uid] : [attacker.uid];
    if (a.targeting.scope === 'all' || (u.mods[a.id] && u.mods[a.id].all)) targets = sideOf(S, a.targeting.side === 'ally' || a.targeting.side === 'self' ? u.side : attacker.side, true).map(function (x) { return x.uid; });
    S.inCounter = true;
    try { perform(S, u, a.id, targets, true); } finally { S.inCounter = false; }
  }

  // ------------------------------------------------------------------ the resolver
  function elementMult(S, u, element) {
    if (!element) return 1;
    var aff = u.affinity && u.affinity[element] ? AFF_MULT[u.affinity[element]] : 1;
    var w = S.db.weather[element];
    return (aff === undefined ? 1 : aff) * (typeof w === 'number' ? w : 1);
  }
  function resolveOne(S, actor, u, a) {
    var md = actor.mods[a.id] || {}, role = ABL_ROLE[a.kind] || null, phys = !!PHYS_KINDS[a.kind];
    var element = a.id === '_attack' ? actor.attackElement : a.element;
    if (u.ko) {
      if (a.revive && a.kind === 'heal') {
        u.ko = false; u.hp = 1;
        emit(S, 'revive', { actor: actor.uid, target: u.uid, abl: a.id });
        healUnit(S, actor, u, evalF(S, a.fx || roleFx(S, 'heal'), scopeOf(actor), scopeOf(u), a.power, null, a.power), a);
      }
      return;
    }
    if (phys) {
      var hit = clampN(0.9 + (num(actor.stats.luck) - num(u.stats.luck)) / 256, 0.5, 0.99);
      if (rnd(S) >= hit) { emit(S, 'miss', { actor: actor.uid, target: u.uid, abl: a.id }); return; }
    }
    if (role) {
      var fid = a.fx || roleFx(S, role);
      var base = evalF(S, fid, scopeOf(actor), scopeOf(u), a.power, null, a.power);
      var variance = roleFx(S, 'var') ? evalF(S, roleFx(S, 'var'), scopeOf(actor), scopeOf(u), a.power, { roll: rnd(S) }, 1) : 1;
      var crit = false;
      if (phys && a.kind !== 'limit') crit = rnd(S) < clampN(0.03 + num(actor.stats.luck) / 512, 0, 0.5);
      var v = base * variance * (crit ? 2 : 1);
      if (phys && actor.row === 'back') v *= 0.5;
      if (phys && u.row === 'back') v *= 0.5;
      if (a.kind === 'heal') {
        if (u.tax && S.db.inverts.indexOf(u.tax) >= 0) dealDamage(S, actor, u, v, element || null, false, a);
        else healUnit(S, actor, u, v, a);
      } else {
        var mult = elementMult(S, u, element);
        if (mult < 0) healUnit(S, actor, u, v * -mult, a);
        else {
          var dealt = dealDamage(S, actor, u, v * mult, element, crit, a);
          if (md.hpAbsorb && !actor.ko) { actor.hp = Math.min(actor.maxHp, actor.hp + dealt); emit(S, 'heal', { actor: actor.uid, target: actor.uid, value: dealt, abl: a.id }); }
          if (md.mpAbsorb && !actor.ko) actor.mp = Math.min(actor.maxMp, actor.mp + Math.floor(dealt / 10));
        }
      }
    }
    if (u.ko) return;
    var effects = a.statusEffects.slice();
    if (a.id === '_attack') effects = effects.concat(actor.addedEffects || []);
    effects.forEach(function (s) { if (!u.ko && rnd(S) < num(s.chance, 1)) applyStatus(S, actor, u, s.sta); else if (a.kind === 'status' && !u.ko) emit(S, 'miss', { actor: actor.uid, target: u.uid, abl: a.id, value: s.sta }); });
  }
  function perform(S, actor, ablId, targetUids, isCounter) {
    var a = ablOf(S, ablId);
    if (!a || actor.ko) return;
    var mp = num(a.cost && a.cost.mp);
    if (actor.mp < mp) { emit(S, 'miss', { actor: actor.uid, abl: a.id, value: 'mp', name: 'Not enough MP' }); return; }
    actor.mp -= mp;
    if (actor.side === 'party') S.res.mpSpent += mp;
    var list = targetUids.map(function (id) { return unit(S, id); }).filter(Boolean);
    // single target that fell: retarget to a living unit on the same side
    if (list.length === 1 && list[0].ko && !a.revive) {
      var alive = sideOf(S, list[0].side, true);
      list = alive.length ? [alive[Math.floor(rnd(S) * alive.length)]] : [];
    }
    emit(S, 'action', { actor: actor.uid, abl: a.id, name: a.name, element: a.id === '_attack' ? actor.attackElement : a.element, targets: list.map(function (x) { return x.uid; }), value: isCounter ? 'counter' : null });
    list.forEach(function (u) { resolveOne(S, actor, u, a); });
    if (a.kind === 'limit' && actor.limit && !isCounter) {
      actor.limit.gauge = 0; actor.limit.uses++; actor.limit.usesAtLevel++;
      unlockLimits(S, actor);
    }
    checkEnd(S);
  }

  // ------------------------------------------------------------------ gambits and the party policy
  function candidates(S, u, sel) {
    if (sel === 'self') return [u];
    if (sel === 'attacker') {
      var at = S.lastAttacker[u.uid] && unit(S, S.lastAttacker[u.uid]);
      return at && !at.ko ? [at] : sideOf(S, other(u.side), true);
    }
    if (/Ally$|Allies$/.test(sel || '')) return sideOf(S, u.side, true);
    return sideOf(S, other(u.side), true);
  }
  function pickFrom(S, sel, pool) {
    if (!pool.length) return [];
    if (sel === 'allFoes' || sel === 'allAllies') return pool.slice();
    if (sel === 'lowestHpFoe' || sel === 'lowestHpAlly') return [pool.slice().sort(function (a, b) { return a.hp - b.hp || (a.uid < b.uid ? -1 : 1); })[0]];
    if (sel === 'highestHpFoe') return [pool.slice().sort(function (a, b) { return b.hp - a.hp || (a.uid < b.uid ? -1 : 1); })[0]];
    if (sel === 'self' || sel === 'attacker') return [pool[0]];
    return [pool[Math.floor(rnd(S) * pool.length)]];
  }
  function expand(S, u, a, targets) {
    if (!targets.length) return targets;
    if (a.targeting.scope === 'all' || (u.mods[a.id] && u.mods[a.id].all)) return sideOf(S, targets[0].side, true);
    if (a.targeting.scope === 'row') { var r = targets[0].row, s = targets[0].side; return sideOf(S, s, true).filter(function (x) { return x.row === r; }); }
    if (a.targeting.scope === 'random') { var pool = sideOf(S, targets[0].side, true); return [pool[Math.floor(rnd(S) * pool.length)]]; }
    return targets;
  }
  function chooseByRules(S, u, g) {
    var rules = g && g.rules ? g.rules : [], i, x, a, c, p, pool, ok, sel, t;
    for (i = 0; i < rules.length; i++) {
      x = rules[i]; a = ablOf(S, x.action.abl);
      if (!affordable(u, a)) continue;
      c = x.condition; p = parseFloat(c.param); sel = x.target.selector;
      pool = candidates(S, u, sel);
      ok = true;
      switch (c.kind) {
        case 'always': break;
        case 'selfHpBelow': ok = frac(u) < p; break;
        case 'selfHpAbove': ok = frac(u) > p; break;
        case 'allyHpBelow':
          ok = sideOf(S, u.side, true).some(function (y) { return frac(y) < p; });
          if (/Ally$|Allies$/.test(sel)) pool = pool.filter(function (y) { return frac(y) < p; });
          break;
        case 'targetHpBelow': pool = pool.filter(function (y) { return frac(y) < p; }); break;
        case 'targetHasStatus': pool = pool.filter(function (y) { return hasSta(y, String(c.param).trim()); }); break;
        case 'targetLacksStatus': pool = pool.filter(function (y) { return !hasSta(y, String(c.param).trim()); }); break;
        case 'turnEvery': ok = ((u.turns + 1) % Math.max(1, Math.round(num(p, 1)))) === 0; break;
        case 'enemyCountBelow': ok = sideOf(S, other(u.side), true).length < p; break;
        case 'allyCountBelow': ok = sideOf(S, u.side, true).length < p; break;
        case 'chance': ok = rnd(S) < num(p, 0); break;
        default: ok = false;
      }
      if (!ok || !pool.length) continue;
      t = expand(S, u, a, pickFrom(S, sel, pool));
      if (t.length) return { abl: a.id, targets: t.map(function (y) { return y.uid; }) };
    }
    return null;
  }
  function basicAttack(S, u) {
    var pool = sideOf(S, other(u.side), true);
    return pool.length ? { abl: '_attack', targets: [pool[Math.floor(rnd(S) * pool.length)].uid] } : null;
  }
  function estimate(S, u, a, t) {
    var role = ABL_ROLE[a.kind];
    if (!role || a.kind === 'heal') return 0;
    var v = num(evalF(S, a.fx || roleFx(S, role), scopeOf(u), scopeOf(t), a.power, null, a.power));
    var m = elementMult(S, t, a.id === '_attack' ? u.attackElement : a.element);
    var n = (a.targeting.scope === 'all' || (u.mods[a.id] && u.mods[a.id].all)) ? sideOf(S, t.side, true).length : 1;
    return v * Math.max(0, m) * n;
  }
  // Default party policy: heal below 35 percent, then a ready Limit, otherwise the strongest affordable attack.
  function defaultPolicy(S, u) {
    var aw = S.awaiting, allies = sideOf(S, 'party', true), foes = sideOf(S, 'foe', true), heals = [], hurt, best = null, bestV = -1, target;
    if (!foes.length) return null;
    aw.commands.forEach(function (c) { c.abls.forEach(function (x) { var a = ablOf(S, x.id); if (x.ok && a && a.kind === 'heal' && a.targeting.side !== 'foe') heals.push(a); }); });
    hurt = allies.filter(function (y) { return frac(y) < 0.35; }).sort(function (a, b) { return frac(a) - frac(b); });
    if (hurt.length && heals.length) {
      heals.sort(function (a, b) { return b.power - a.power; });
      return { type: 'command', actor: u.uid, cmd: 'heal', abl: heals[0].id, target: hurt[0].uid };
    }
    target = foes.slice().sort(function (a, b) { return a.hp - b.hp || (a.uid < b.uid ? -1 : 1); })[0];
    aw.commands.forEach(function (c) {
      if (c.key === 'flee') return;
      c.abls.forEach(function (x) {
        var a = ablOf(S, x.id), v;
        if (!x.ok || !a || a.kind === 'heal' || a.kind === 'status' || a.targeting.side === 'ally' || a.targeting.side === 'self') return;
        v = estimate(S, u, a, target) * (c.key === 'limit' ? 1.5 : 1);
        if (v > bestV) { bestV = v; best = { type: 'command', actor: u.uid, cmd: c.key, abl: a.id, target: target.uid }; }
      });
    });
    return best || { type: 'command', actor: u.uid, cmd: 'attack', abl: '_attack', target: target.uid };
  }
  function policyInput(S, policy) {
    var u = unit(S, S.awaiting.actor), ch;
    if (isObj(policy) && Array.isArray(policy.rules) && policy.rules.length) {
      if (!policy._compiled) {
        var g = { rules: [], counters: [] };
        policy.rules.forEach(function (x) { if (isObj(x) && x.action && ablOf(S, x.action.abl)) g.rules.push({ condition: isObj(x.condition) ? { kind: x.condition.kind || 'always', param: String(x.condition.param == null ? '' : x.condition.param) } : { kind: 'always', param: '' }, target: { selector: (x.target && x.target.selector) || 'lowestHpFoe' }, action: { abl: x.action.abl } }); });
        policy._compiled = g;
      }
      ch = chooseByRules(S, u, policy._compiled);
      if (ch) return { type: 'command', actor: u.uid, cmd: 'policy', abl: ch.abl, target: ch.targets[0], targets: ch.targets };
    }
    return defaultPolicy(S, u);
  }

  // ------------------------------------------------------------------ turns
  function commandsFor(S, u) {
    var out = [], lim = u.limit && u.limit.gauge >= 1 ? currentLimit(u) : null;
    function row(id) { var a = ablOf(S, id); return { id: id, name: a.name, mp: num(a.cost.mp), ok: affordable(u, a), side: a.targeting.side, scope: (u.mods[id] && u.mods[id].all) ? 'all' : a.targeting.scope, element: id === '_attack' ? u.attackElement : a.element, kind: a.kind }; }
    if (lim) out.push({ key: 'limit', label: 'Limit', abls: [row(lim.abl)] });
    else out.push({ key: 'attack', label: 'Attack', abls: [row('_attack')] });
    u.commands.forEach(function (c) { out.push({ key: c.key, label: c.label, abls: c.abls.filter(function (id) { return ablOf(S, id); }).map(row) }); });
    if (!(S.db.troop && S.db.troop.noEscape)) out.push({ key: 'flee', label: 'Flee', abls: [] });
    return out;
  }
  function nextAwaiting(S) {
    if (S.awaiting || S.result) return;
    while (S.readyQueue.length) {
      var u = unit(S, S.readyQueue[0]);
      if (u && !u.ko && u.ready) {
        S.awaiting = { actor: u.uid, commands: commandsFor(S, u), targets: { foe: sideOf(S, 'foe', true).map(function (x) { return x.uid; }), party: sideOf(S, 'party', true).map(function (x) { return x.uid; }) } };
        return;
      }
      S.readyQueue.shift();
    }
  }
  function refreshAwaiting(S) {
    if (!S.awaiting) return;
    var u = unit(S, S.awaiting.actor);
    if (!u || u.ko) { S.awaiting = null; S.readyQueue.shift(); nextAwaiting(S); return; }
    S.awaiting.commands = commandsFor(S, u);
    S.awaiting.targets = { foe: sideOf(S, 'foe', true).map(function (x) { return x.uid; }), party: sideOf(S, 'party', true).map(function (x) { return x.uid; }) };
  }
  // A unit's turn begins: statuses tick, then party members wait for input and foes act.
  function beginTurn(S, u) {
    statusTurn(S, u);
    if (u.ko || S.result) return;
    u.ready = true;
    emit(S, 'ready', { actor: u.uid });
    if (u.side === 'party') { S.readyQueue.push(u.uid); nextAwaiting(S); return; }
    var ch = (u.gambit && chooseByRules(S, u, S.db.gmb[u.gambit])) || basicAttack(S, u);
    u.ready = false;
    if (!ch) return;
    commit(S, u, ch.abl, ch.targets);
  }
  function commit(S, u, ablId, targets) {
    var a = ablOf(S, ablId);
    u.turns++; S.turns++;
    emit(S, 'command', { actor: u.uid, abl: ablId, name: a ? a.name : '', targets: targets });
    if (S.sched === 'atb' && a && a.chargeTicks > 0) { u.charging = { abl: ablId, targets: targets, left: a.chargeTicks }; u.gauge = 0; return; }
    u.gauge = 0;
    if (S.sched === 'conditional' && a && a.chargeTicks > 0) u.nextAt += a.chargeTicks;
    perform(S, u, ablId, targets, false);
  }
  function checkEnd(S) {
    if (S.result) return;
    if (!sideOf(S, 'foe', true).length) S.result = finish(S, 'win');
    else if (!sideOf(S, 'party', true).length) S.result = finish(S, 'lose');
  }
  function finish(S, outcome, quiet) {
    var party = partyOf(S), hpEnd = 0, rewards = { gil: 0, exp: 0, ap: 0 };
    party.forEach(function (u) { hpEnd += u.hp; });
    if (outcome === 'win') foesOf(S).forEach(function (u) { rewards.gil += u.gil; rewards.exp += u.exp; rewards.ap += u.ap; });
    S.awaiting = null; S.readyQueue = [];
    var r = {
      outcome: outcome, ticks: S.t, turns: S.turns, preemptive: S.preemptive, rngCalls: S.rng.calls, rewards: rewards,
      partyEnd: party.map(function (u) { return { uid: u.uid, chr: u.ref, name: u.name, hp: u.hp, maxHp: u.maxHp, mp: u.mp, maxMp: u.maxMp, ko: u.ko, limitLevel: u.limit ? u.limit.level : 1, limitUses: u.limit ? u.limit.uses : 0, kills: u.kills }; }),
      resourcesUsed: {
        hpLost: Math.max(0, S.res.hpStart - hpEnd), mpSpent: S.res.mpSpent, items: S.res.itemsUsed,
        hpPct: S.res.hpMax ? Math.round(Math.max(0, S.res.hpStart - hpEnd) / S.res.hpMax * 1000) / 10 : 0,
        mpPct: S.res.mpMax ? Math.round(S.res.mpSpent / S.res.mpMax * 1000) / 10 : 0
      },
      damageLog: S.damageLog, warnings: S.db.warnings.slice(0, 20)
    };
    if (!quiet) emit(S, 'end', { value: outcome });
    return r;
  }

  // One unit of time for each scheduler.
  var SCHED = {
    atb: function (S) {
      S.units.forEach(function (u) {
        if (u.ko || S.result) return;
        var b = blockedBy(S, u);
        if (b) {
          if (b === 'empty') u.gauge = 0;
          if (++u.frozenTicks >= delayOf(S, u)) { u.frozenTicks = 0; statusTurn(S, u); }
          return;
        }
        if (u.charging) {
          if (--u.charging.left <= 0) { var c = u.charging; u.charging = null; perform(S, u, c.abl, c.targets, false); }
          return;
        }
        if (u.ready) return;
        u.gauge = Math.min(GAUGE_MAX, u.gauge + u.fill);
        if (u.gauge >= GAUGE_MAX) beginTurn(S, u);
      });
      S.t++;
    },
    rounds: function (S) {
      if (!S.round || S.round.i >= S.round.q.length) {
        var keyed = sideOf(S, 'party', true).concat(sideOf(S, 'foe', true)).map(function (u) { return { uid: u.uid, spd: num(u.stats.spd), k: rnd(S) }; });
        keyed.sort(function (a, b) { return b.spd - a.spd || b.k - a.k; });
        S.round = { n: S.round ? S.round.n + 1 : 1, q: keyed.map(function (x) { return x.uid; }), i: 0 };
      }
      var u = unit(S, S.round.q[S.round.i++]);
      S.t++;
      if (!u || u.ko) return;
      if (blockedBy(S, u)) { statusTurn(S, u); return; }
      beginTurn(S, u);
    },
    conditional: function (S) {
      var live = S.units.filter(function (u) { return !u.ko; }), u = null;
      live.forEach(function (x) { if (!u || x.nextAt < u.nextAt) u = x; });
      if (!u) return;
      S.t = Math.max(S.t + 1, u.nextAt);
      u.nextAt = S.t + delayOf(S, u);
      if (blockedBy(S, u)) { statusTurn(S, u); return; }
      beginTurn(S, u);
    }
  };
  function step(S, maxTicks) {
    var had = !!S.awaiting, n = 0, t0 = S.t;
    while (!S.result && n < maxTicks) {
      if (S.awaiting && (S.waitMode || S.sched !== 'atb')) break;
      if (S.awaiting && !had) break;
      SCHED[S.sched](S);
      n++;
      if (!S.result && S.t >= S.tickCap) S.result = finish(S, 'timeout');
    }
    if (S.t > t0) emit(S, 'tick', { value: S.t - t0 });
    return n;
  }
  function apply(S, input) {
    var aw = S.awaiting, u, a, tg, list, r;
    if (!aw || !input || input.actor !== aw.actor) { emit(S, 'miss', { actor: input && input.actor, value: 'rejected', name: 'No unit is waiting for that input.' }); return false; }
    u = unit(S, aw.actor);
    if (input.type === 'flee') {
      if (S.db.troop && S.db.troop.noEscape) { emit(S, 'miss', { actor: u.uid, value: 'flee', name: 'Cannot escape' }); return false; }
      var ps = sideOf(S, 'party', true), fs = sideOf(S, 'foe', true);
      var avg = function (l) { return l.reduce(function (s, x) { return s + num(x.stats.spd); }, 0) / Math.max(1, l.length); };
      var chance = clampN(0.5 + (avg(ps) - avg(fs)) / 100, 0.1, 0.9);
      u.ready = false; u.gauge = 0; S.readyQueue.shift(); S.awaiting = null; u.turns++; S.turns++;
      emit(S, 'command', { actor: u.uid, value: 'flee', name: 'Flee' });
      if (rnd(S) < chance) { S.result = finish(S, 'flee'); return true; }
      emit(S, 'miss', { actor: u.uid, value: 'flee', name: 'Could not escape' });
      nextAwaiting(S);
      return true;
    }
    a = ablOf(S, input.abl);
    var allowed = false;
    aw.commands.forEach(function (c) { c.abls.forEach(function (x) { if (x.id === input.abl && x.ok) allowed = true; }); });
    if (!a || !allowed) { emit(S, 'miss', { actor: u.uid, value: 'rejected', name: 'That ability is not available.' }); return false; }
    if (Array.isArray(input.targets) && input.targets.length) list = input.targets.map(function (id) { return unit(S, id); }).filter(function (x) { return x && !x.ko; });
    else {
      tg = input.target ? unit(S, input.target) : null;
      if (!tg || tg.ko) {
        var side = a.targeting.side === 'foe' ? 'foe' : 'party';
        if (a.targeting.side === 'self') tg = u;
        else { var pool = sideOf(S, side, true); tg = pool[0] || null; }
      }
      list = tg ? expand(S, u, a, [tg]) : [];
    }
    if (a.targeting.side === 'self') list = [u];
    if (!list.length) { emit(S, 'miss', { actor: u.uid, value: 'rejected', name: 'No target.' }); return false; }
    u.ready = false; S.readyQueue.shift(); S.awaiting = null;
    commit(S, u, a.id, list.map(function (x) { return x.uid; }));
    nextAwaiting(S);
    refreshAwaiting(S);
    r = true;
    return r;
  }

  function skipAwaiting(S) {
    var u = S.awaiting && unit(S, S.awaiting.actor);
    if (u) { u.ready = false; u.gauge = 0; u.turns++; }
    S.readyQueue.shift(); S.awaiting = null;
    nextAwaiting(S);
  }

  // ------------------------------------------------------------------ public API
  function out(S) {
    var e = EV; EV = null;
    return { state: S, events: e, awaiting: S.awaiting ? clone(S.awaiting) : null };
  }
  // advance never mutates its input. input: null (run to the next decision), {type:'step', ticks},
  // {type:'command', actor, abl, target | targets}, or {type:'flee', actor}.
  function advance(state, input) {
    var S = clone(state);
    EV = [];
    if (S.result) return out(S);
    if (input && (input.type === 'command' || input.type === 'flee')) apply(S, input);
    else step(S, input && input.type === 'step' ? Math.max(0, Math.floor(num(input.ticks, 1))) : S.tickCap);
    refreshAwaiting(S);
    return out(S);
  }
  // Drives advance with gambits for foes and the party policy until the battle ends.
  function run(data, seed, policy, opts) {
    opts = isObj(opts) ? opts : {};
    var S = init(data, seed, opts), all = [], keep = opts.events !== false, guard = 0, pol = isObj(policy) ? clone(policy) : null;
    EV = [];
    while (!S.result && guard++ < 200000) {
      if (S.awaiting) { if (!apply(S, policyInput(S, pol))) skipAwaiting(S); }
      else step(S, S.tickCap);
      if (keep) { Array.prototype.push.apply(all, EV); }
      EV = [];
    }
    if (!S.result) S.result = finish(S, 'timeout');
    if (keep) Array.prototype.push.apply(all, EV || []);
    EV = null;
    return { events: keep ? all : [], result: S.result };
  }
  // Rebuilds a battle from recorded inputs [{t, input}]. Inputs apply at the exact tick they were given.
  function replay(data, seed, opts, inputs) {
    var S = init(data, seed, opts), all = [], k, rec, guard, n;
    EV = [];
    for (k = 0; k < arr(inputs).length && !S.result; k++) {
      rec = inputs[k]; guard = 0;
      while (!S.result && S.t < num(rec.t) && guard++ < 1000000) {
        n = step(S, num(rec.t) - S.t);
        if (!n) break;
      }
      if (S.result) break;
      apply(S, rec.input);
      refreshAwaiting(S);
    }
    Array.prototype.push.apply(all, EV); EV = null;
    return { state: S, events: all, awaiting: S.awaiting ? clone(S.awaiting) : null };
  }
  // The input the party policy would give for the unit awaiting a command (default policy when none is supplied).
  function suggest(state, policy) {
    if (!state || !state.awaiting || state.result) return null;
    var S = clone(state), e = EV, r;
    EV = null;
    r = policyInput(S, isObj(policy) ? clone(policy) : null);
    EV = e;
    return r;
  }
  // Turn order forecast for the conditional scheduler (and an estimate for the others).
  function forecast(state, n) {
    var sim = state.units.filter(function (u) { return !u.ko; }).map(function (u) { return { uid: u.uid, at: state.sched === 'conditional' ? u.nextAt : Math.ceil((GAUGE_MAX - u.gauge) / u.fill), d: Math.ceil(GAUGE_MAX / u.fill) }; });
    var list = [], i, best;
    for (i = 0; i < (n || 6) && sim.length; i++) {
      best = sim[0];
      sim.forEach(function (x) { if (x.at < best.at) best = x; });
      list.push(best.uid); best.at += best.d;
    }
    return list;
  }

  return {
    version: VERSION, templates: TEMPLATES, evalExpr: expr, gaugeMax: GAUGE_MAX,
    schedulers: Object.keys(SCHEDULERS), progressions: Object.keys(PROGRESSIONS),
    init: init, advance: advance, run: run, replay: replay, forecast: forecast, suggest: suggest
  };
})();
