# Story Forge (AppADay 149)

Story Forge takes a finished world from World Forge (Day 148) and writes its story: flags bound to every gate, quests as state machines, dialogue graphs, events and cutscenes, and endings, then proves the story can always be finished. It writes only the story namespace (plus each side quest's completion flag) and exports a bundle Days 146, 147, and 148 still open, with a manifest and `engine-story.js` for Day 150.

Live: https://augustineiacopelli.github.io/appaday-149-story-forge/ (add `?dev=1` for the fixture loaders).

Part of [AppADay](https://augustineiacopelli.github.io/appaday/), and the last of four forges (146 rules, 147 art and audio, 148 world, 149 story) that feed the Day 150 RPG.

## Using it (Phase 0)

1. **Start.** Load a Day 148 Final export, open the Day 148 draft left in this browser, or load the demo. The import gate refuses a bundle without a Day 148 Final, without the world namespace opened, or with a world that does not validate cleanly, and says why. Start shows the world check, the chapters against the 12 hour floor, the gate keys to bind, empty boss slots, side quests, and endings.
2. **Flags, Quests, Dialogue, Events** arrive in Phases 2 to 5.
3. **Validation and Export.** Draft is always allowed. Final opens the story namespace and arrives with the Phase 7 proof.

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
| 1 | ENGINE:STORY core: conditions, commands, the runner, pages, save flags | Next |
| 2 | Flags and gate bindings | |
| 3 | Quests as state machines | |
| 4 | Dialogue graphs | |
| 5 | Events and cutscenes, the playtester | |
| 6 | Endings and the playtime floor | |
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
```

`test/layout.js` audits every view at 390 and 1280 wide in headless Chromium. Playwright is not in package.json: install it in a scratch folder and run with `NODE_PATH` pointing at its node_modules.
