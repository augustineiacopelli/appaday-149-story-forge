// === STORY:DAY150 BEGIN ===
// Phase 8: the Day 150 contract, the manifest's day150 block. It says exactly what a shipped game needs and promises that
// nothing else is needed: the five engine files in load order (each with its sha256) and the Final bundle. No forge
// page, no Kit, no STORY, no storage of the forge's, no network, and no API key. test/phase8.js proves it by playing the
// golden path and every ending in a bare vm holding only those five files and the bundle.
// Everything here is read through ENGINE_STORY.host from the bundle itself, never from page state, so the contract
// describes what a game will see.
(function () {
  'use strict';
  var U = Kit.util, ES = ENGINE_STORY, H = ES.host;
  var D = STORY.day150c = {};
  D.CONTRACT = 1;
  // ENGINE_BATTLE reports win, lose, flee, or timeout; the story asks for win, lose, or escape. A timeout (the battle hit
  // its tick cap) counts as a loss. flee may only be offered when the story's question says canEscape.
  D.OUTCOMES = { win: 'win', lose: 'lose', flee: 'escape', timeout: 'lose' };
  // What the shell (Day 150's page) must provide itself, and what it must never need.
  D.SHELL = {
    provides: [
      'input: offer the moves ENGINE_STORY.host.moves(game, state) returns for the map the player stands on, and play the one chosen with ENGINE_STORY.host.play',
      'render: draw each effect the effect hook receives (text, choice, fade, face, moveActor, changeMap, vehicle, wait) with ENGINE_RENDER on a canvas the shell owns',
      'audio: play music (a role key or a mus_) and sfx effects with ENGINE_AUDIO, starting audio only after a user gesture',
      'battle: answer each battle question by running ENGINE_BATTLE on its trp with a party built from state.party, and report the outcome through OUTCOMES',
      'saves: keep ENGINE_STORY.save.toSave(state, game.idx) in storage the shell owns (slot count and keys are the shell\'s), and restore with ENGINE_STORY.save.fromSave'
    ],
    never: ['the forge pages (Days 146 to 149)', 'Kit or STORY', 'a forge\'s storage keys', 'network access', 'an API key']
  };
  // When the shell offers each trigger. chapterStart, battleEnd, and the forced autoruns are the host's own; play runs
  // them after every move.
  D.TRIGGERS = {
    mapEnter: 'offered when the player enters the move\'s map',
    step: 'offered when the player stands on the event\'s at cell on the move\'s map',
    autorun: 'offered when the player is on the move\'s map; ENGINE_STORY.host.play also runs autoruns on the moved to map by itself',
    talk: 'offered when the player talks to the move\'s npc',
    dialogue: 'the same, for a person with only dialogue pages',
    chapterStart: 'never offered; run by the host at a new game and whenever the chapter changes',
    battleEnd: 'never offered; run by the host after the battles of a run'
  };

  function pathSteps(path) { return (path || []).filter(function (s) { return U.isObj(s) && s.by !== 'newGame'; }).map(function (s) { return U.clone(s); }); }
  function bosses(b) {
    var evs = STORY.records.list('evt_', b).filter(function (e) { return e.kind === 'boss' && typeof e.dgn === 'string'; });
    return STORY.events.bosses(b).map(function (x) {
      var bt = STORY.events.bossTroop(x.dgn, b), ev = evs.filter(function (e) { return e.dgn === x.dgn; })[0] || null;
      return { chapter: x.chapter, dgn: x.dgn, troop: bt.trp, source: bt.slot ? 'story' : 'world', chosen: !!bt.chosen, evt: ev ? ev.id : null, finale: !!x.finale };
    });
  }

  // The block, or null until the story checks prove the story. lazy: also null while the checks for this state have not
  // run yet, so drawing a tab never walks.
  STORY.day150 = function (b, lazy) {
    b = b || Kit.bundle.current();
    if (!b || !STORY.checks || typeof STORY.checks.walk !== 'function' || STORY.readiness(b) !== true) return null;
    if (lazy && !STORY.checks.ready(b)) return null;
    // A contract promises a game that can be finished, so there is none until the story checks prove that.
    var sum = STORY.checks.summary ? STORY.checks.summary(b) : null;
    if (!sum || sum.proven !== true) return null;
    STORY.ensure(b);
    var game = H.load(b), R = STORY.checks.walk(b).result, files = (STORY.engines.FILES || []).map(function (f) { return U.clone(f); });
    // A new game: the state before anything runs, then the forced opening (decided the way the golden path decides it).
    var fresh = ES.state.create(game.idx, {}), golden = R.golden ? pathSteps(R.golden.path) : [];
    var openSteps = [], at = 0, active = null, ci = 0, bi = 0;
    var boot = H.newGame(game, {}, {
      begin: function (ctx) { active = golden[at] && golden[at].by === ctx.by && golden[at].evt === ctx.evt ? golden[at] : null; at++; ci = 0; bi = 0; openSteps.push(ctx); },
      decide: function (q) {
        if (q.kind === 'choice') { var want = active && active.choices ? active.choices[ci++] : null, k = q.options.map(function (o) { return o.text; }).indexOf(want); return k < 0 ? 0 : k; }
        var bb = active && active.battles ? active.battles[bi++] : null;
        return bb ? bb.outcome : 'win';
      }
    });
    var ow = STORY.world.overworld(b), g = STORY.world.graph(b), idx = game.idx;
    var endings = U.isObj(R.endings) ? Object.keys(R.endings).sort().map(function (e) { return { end: e, hash: R.endings[e].hash, steps: pathSteps(R.endings[e].path) }; }) : [];
    return {
      contract: D.CONTRACT,
      summary: 'A game is the five engine files below, loaded in this order, plus this Final bundle. Nothing else from any forge is needed.',
      engines: files,
      loadOrder: files.map(function (f) { return f.file; }),
      hashRule: 'sha256 of the file with any one line of the form /* Bundle hash <hex> */ removed',
      api: {
        load: 'var game = ENGINE_STORY.host.load(bundle)',
        newGame: 'var r = ENGINE_STORY.host.newGame(game, {gil, items, party}, hooks); r.state is the first quiet state',
        loop: 'ENGINE_STORY.host.moves(game, state) lists what the player may do; ENGINE_STORY.host.play(game, state, move, hooks) runs one and every forced event after it',
        hooks: '{begin(ctx), decide(question, ctx), effect(effect, ctx)}; decide answers {kind choice, options} with a position and {kind battle, trp, canLose, canEscape, state} with win, lose, or escape',
        save: 'ENGINE_STORY.save.toSave(state, game.idx) between moves; ENGINE_STORY.save.fromSave(save, game.idx) to restore',
        replay: 'ENGINE_STORY.host.replay(game, steps) plays golden.steps or any endings[].steps and checks each one'
      },
      newGame: { chapter: fresh.chapter, openFlags: idx.start.slice(), startGates: g && Array.isArray(g.start) ? g.start.slice() : [], gil: 0, party: [], items: {} },
      opening: { steps: boot.steps, chapter: boot.state.chapter, hash: H.hash(boot.state), firstMoves: H.moves(game, boot.state), faults: boot.faults.length },
      start: { overworld: ow ? ow.id : null, chapter: boot.state.chapter },
      triggers: U.clone(D.TRIGGERS),
      saves: {
        schema: 'Day 146 save: the story keeps flags [{flg, value}], gil, inventory [{item, qty}], party [chr_], and chapter; quest stages and once pages pack into derived flags',
        derived: ES.save.slots(idx), limits: U.clone(ES.save.LIMITS),
        rules: ['never save while an event is running (toSave refuses)', 'never save after an ending', 'a flag at its default is left out']
      },
      bosses: bosses(b),
      bossRule: 'A boss is the world troop when Day 148 set one (its boss zone, else dgn_.troop); otherwise the startBattle troop of the story\'s boss event whose dgn names that dungeon. The scaffolded boss events already carry the resolved troop.',
      battle: {
        engine: 'ENGINE_BATTLE',
        call: 'ENGINE_BATTLE.init({ruleset: bundle.charter.ruleset, records: bundle.rules, party: members, troopId: question.trp, weatherId: null}, seed, opts) then advance, or run for an automatic battle',
        member: '{chr, level, equipment [eqp_], materia [{eqp, slot, mat, ap}], abilities [abl_], row, job, jobLevel, cls}',
        party: 'question.state.party lists the chr_ ids in the party; levels and gear come from the chapter\'s eps_ record (targetLevel, gearTier) in bundle.rules',
        outcomes: U.clone(D.OUTCOMES)
      },
      effects: { commands: ES.cmd.OPS.slice(), host: ['end', 'none', 'idle', 'gameover', 'error'], silent: ['if', 'setFlag', 'addFlag', 'callEvent'] },
      musicRoles: game.ext.roles.slice(),
      golden: R.golden ? { ending: R.golden.ending, hash: R.golden.hash, full: !!R.goldenFull, steps: golden } : null,
      endings: endings,
      shell: U.clone(D.SHELL),
      proof: 'test/phase8.js plays golden.steps and every endings[].steps in a bare vm holding only these five files and this bundle, and gets these hashes'
    };
  };
})();
// === STORY:DAY150 END ===
