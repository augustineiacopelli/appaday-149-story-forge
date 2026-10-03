# Story Forge (AppADay 149)

Story Forge takes a finished world from World Forge (Day 148) and writes its story: flags bound to every gate, quests as state machines, dialogue graphs, events and cutscenes, and endings, then proves the story can always be finished. It writes only the story namespace (plus each side quest's completion flag) and exports a bundle Days 146, 147, and 148 still open, with a manifest and `engine-story.js` for Day 150.

Live: https://augustineiacopelli.github.io/appaday-149-story-forge/ (add `?dev=1` for the fixture loaders).

Part of [AppADay](https://augustineiacopelli.github.io/appaday/), and the last of four forges (146 rules, 147 art and audio, 148 world, 149 story) that feed the Day 150 RPG.

## Using it (Phases 0 to 5)

1. **Start.** Load a Day 148 Final export, open the Day 148 draft left in this browser, or load the demo. The import gate refuses a bundle without a Day 148 Final, without the world namespace opened, or with a world that does not validate cleanly, and says why. Start shows the world check, the chapters against the 12 hour floor, the gate keys to bind, empty boss slots, side quests, and endings.
2. **Flags.** Opening the forge binds every gate key to a structural flag, fills each side quest seed's completion flag, and makes the save slot flags. The tab shows the binding table (unbound keys first), every flag with who reads and who sets it, and lets you add, edit, or rebind.
3. **Quests.** One button builds a main quest for every chapter from the golden path (arrive, clear the key dungeon, defeat the boss, take the exit), a side quest for each side quest seed, and a B story for each character with a storyline. Each quest is drawn as a state machine: stages left to right, exclusive branch groups fanning out underneath, the failure rule in red above. Click a stage to edit its label, its exit condition (a condition tree editor), the flags it sets, and its site; add branch groups and a failure rule; add quests by hand. Rebuilding keeps your edits and your own quests.
4. **Dialogue.** One button builds a greeting for every role in every chapter its people live in (shared by everyone of that role, so a later chapter changes what the same townsperson says) and a quest dialogue for every quest with a giver: offer, accept, progress, and turn in, with choices that move the quest. Each person gets a page list; the rightmost page whose condition passes is the one they say. The tab has a node list, an SVG graph, a line editor with effects and choice conditions, a People view for the page lists, and a preview runner that plays the real engine in a chosen chapter and quest stage. Drafting a node's lines with Claude is optional and is off without an API key. Rebuilding keeps your edits and your own pages.
5. **Events.** One button builds the events the world asks for: a chapter opener for every chapter, a talk event on every main quest giver that sets the quest moving, the seal chest in each key dungeon, every boss on the tile Day 148 placed it (an empty boss slot gets a troop you choose, never by editing the world), the overworld exit to the next region, and the finale. Each event has pages; the rightmost page whose condition passes runs its commands, which you edit as nested blocks (a battle's win list, an if's then and else, a choice's options) with a dialog for each of the 21 commands. Play any event in the text playtester: it stops at each line, choice, and battle, takes Win, Lose, or Escape, steps Back exactly, can carry on from the last run, and shows every flag and quest as it changes. Play the golden path runs the whole story through the events alone. Rebuilding keeps your edits and your own events.
6. **Validation and Export.** Draft is always allowed. Final opens the story namespace and arrives with the Phase 7 proof.

## What an export holds

| File | What it is |
| --- | --- |
| `<slug>-bundle.json` | The Saga Bundle with the story namespace: `records` (`flg_` `qst_` `dlg_` `evt_` `end_`), `bindings`, `scaffold`, `npcDialogue`, `settings`, `overrides`. Every other namespace is byte for byte what came in, except the side quest completion flags this forge fills. |
| `<slug>-story-manifest.json` | Forge 149, the bundle hash, engine version, created and referenced IDs, unresolved IDs, counts, validation, the world check, and the Day 150 load order (render, audio, world, story). |
| `engine-story.js` | The story interpreter as one global, `ENGINE_STORY`, under a header carrying the bundle hash. It reads no host global. |

## Status

| Phase | What | State |
| --- | --- | --- |
| 0 | Scaffold, story namespace, import gate, export, storage, fixtures, Day 146 to 148 round trip | Done |
| 1 | ENGINE:STORY core: the index, conditions, commands, the runner, pages, quest settling, save flags | Done |
| 2 | Flags and gate bindings | Done |
| 3 | Quests as state machines | Done |
| 4 | Dialogue graphs | Done |
| 5 | Events and cutscenes, the playtester | Done |
| 6 | Endings and the playtime floor | Next |
| 7 | Validation and the reachability proof | |
| 8 | Export, the Day 150 contract, ship | |

`src/build-log.txt` records every decision; it is also the comment at the top of `index.html`.

## Working on it

Clone this repo next to `appaday-146-saga-forge`, `appaday-147-art-and-audio-forge`, and `appaday-148-world-forge`, then:

```
node build.js
cd test && npm install
node make-demo.js   # only when the fixtures need rebuilding from Day 148
node phase0.js
node phase1.js
node phase2.js
node phase3.js
node phase4.js
node phase5.js
node layout.js   # needs Playwright with Chromium
```

`test/phase1.js` exercises `ENGINE_STORY` alone in bare vm contexts, as Day 150 will load it, over a small hand authored story (`test/storyfx.js`) on both fixtures: every condition op and comparison, lint for every command, pages, the runner with choices, battles, calls, endings, branch exclusivity, quest settling, and the save flag round trip, with whole playthroughs replayed byte for byte in two contexts and in the page.

`test/phase5.js` builds the events on both fixtures and plays the golden path through them alone, then replays it from a Draft in two bare vm contexts holding only `engine-story.js` and checks they reach the page's exact state; it also drives the Events tab and the playtester under jsdom.

`test/layout.js` audits every view at 390 and 1280 wide in headless Chromium. Playwright is not in package.json: install it in a scratch folder and run with `NODE_PATH` pointing at its node_modules.
