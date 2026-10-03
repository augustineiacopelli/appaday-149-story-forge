// Assembles index.html: KIT:CORE CSS and JS copied byte for byte from Day 146, the vendored Day 147 engines checked byte
// for byte against the Day 147 repository, the vendored Day 148 engine checked against Day 148's root file (its bundle
// hash header line aside), then the Day 149 fences. Also writes engine-story.js from the ENGINE:STORY fence.
// node build.js             build (fails if a vendored engine differs from its owner's copy)
// node build.js --revendor  copy the owners' engine-render.js, engine-audio.js, and engine-world.js over the vendored
//                           copies first
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(__dirname, p));
const src146 = fs.readFileSync(require('./day146'), 'utf8');
const dir147 = require('./day147');
const dir148 = require('./day148');
const REVENDOR = process.argv.includes('--revendor');

function fence(text, open, close) {
  const a = text.indexOf(open), z = text.indexOf(close);
  if (a < 0 || z < 0) throw new Error('Fence not found: ' + open);
  return text.slice(a, z + close.length);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
// An exported engine-world.js carries one '/* Bundle hash <hex> */' line under its header; Day 148's repository copy
// does not. The comparison ignores that line on both sides, so either copy may be vendored.
const noHashLine = (s) => s.replace(/^\/\* Bundle hash [0-9a-f]+ \*\/\n/m, '');

// 1. Vendored engines. They are never edited here: Day 147 owns render and audio, Day 148 owns world.
const VENDORED = [
  { file: 'engine-render.js', dir: dir147, owner: 'Day 147', norm: (s) => s },
  { file: 'engine-audio.js', dir: dir147, owner: 'Day 147', norm: (s) => s },
  { file: 'engine-world.js', dir: dir148, owner: 'Day 148', norm: noHashLine }
];
VENDORED.forEach((v) => {
  const theirs = fs.readFileSync(path.join(v.dir, v.file), 'utf8');
  if (REVENDOR || !exists(v.file)) fs.writeFileSync(path.join(__dirname, v.file), v.norm(theirs));
  const ours = R(v.file);
  if (v.norm(ours) !== v.norm(theirs)) { console.error(v.file + ' differs from ' + v.owner + ' (' + sha(ours).slice(0, 12) + ' here, ' + sha(theirs).slice(0, 12) + ' in ' + v.owner + '). Run node build.js --revendor to take ' + v.owner + '\'s copy.'); process.exit(1); }
  console.log(v.file, ours.length, 'chars, byte equal to ' + v.owner + (v.norm === noHashLine ? ' (hash line aside)' : '') + ', sha256', sha(ours).slice(0, 16));
});
// Day 148 vendors render and audio from Day 147 too; all three copies must agree, or Day 150 would load two versions.
['engine-render.js', 'engine-audio.js'].forEach((f) => {
  if (fs.readFileSync(path.join(dir148, f), 'utf8') !== R(f)) { console.error(f + ' in Day 148 differs from Day 147\'s. Revendor Day 148 first.'); process.exit(1); }
});

// 2. Fences.
const kitCss = fence(src146, '/* === KIT:CORE CSS BEGIN === */', '/* === KIT:CORE CSS END === */');
const kitJs = fence(src146, '// === KIT:CORE BEGIN ===', '// === KIT:CORE END ===');
// Embedded JSON: '</' is escaped so no string can close the script element; anything outside ASCII becomes \uXXXX.
const embed = (file) => JSON.stringify(JSON.parse(R(file))).replace(/<\//g, '<\\/').replace(/[\u007f-￿]/g, (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4));
const demoSrc = R('src/story-demo.js').replace('/*DEMO_JSON*/null', () => embed('test/out/demo148-bundle.json')).replace('/*FOUR_JSON*/null', () => embed('test/out/four148-bundle.json'));
const buildLog = R('src/build-log.txt');
// ENGINE:STORY is one fence in the output. Later phases keep their engine sections in their own source files, spliced in
// order above the freeze line, so each phase's engine code stays readable on its own.
const ENGINE_SECTIONS = ['src/engine-index.js', 'src/engine-cond.js', 'src/engine-cmd.js', 'src/engine-run.js', 'src/engine-pages.js', 'src/engine-dlg.js', 'src/engine-save.js', 'src/engine-walk.js'].filter(exists);
const FREEZE = '  // ---------------------------------------------------------------- later phases insert sections above this line';
const engineBase = R('src/engine-story.js');
if (engineBase.split(FREEZE).length !== 2) throw new Error('ENGINE:STORY freeze marker not found exactly once.');
const engineStory = engineBase.replace(FREEZE, () => ENGINE_SECTIONS.map((f) => R(f).replace(/\s+$/, '') + '\n\n').join('') + FREEZE).trim();
// Workspace fences arrive with later phases; each is optional until its phase.
const CSS_FENCES = ['src/story-flags.css', 'src/story-quests.css', 'src/story-dialogue.css', 'src/story-events.css', 'src/story-endings.css', 'src/story-validation.css'].filter(exists);
const JS_FENCES = ['src/story-scaffold.js', 'src/story-quests.js', 'src/story-dialogue.js', 'src/story-events.js', 'src/story-endings.js', 'src/story-checks.js', 'src/ws-flags.js', 'src/ws-cond.js', 'src/ws-quests.js', 'src/ws-dialogue.js', 'src/ws-events.js', 'src/ws-endings.js', 'src/ws-validation.js'].filter(exists);

const html = `<!--
${buildLog.trim()}
-->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Story Forge | AppADay 149</title>
<meta name="description" content="Story Forge: bind a finished World Forge world to flags, quests, dialogue, events, and endings, and prove the story can always be finished. AppADay 149.">
<meta name="theme-color" content="#10121a">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;0,800;1,400&family=Cinzel:wght@500;700&display=swap" rel="stylesheet">
<style>
${kitCss}
${R('src/story-shell.css').trim()}
${CSS_FENCES.map((f) => R(f).trim()).join('\n')}
</style>
</head>
<body>
<div class="app" id="app">
  <header class="app-head">
    <div class="brand">
      <h1 class="brand-title">Story Forge</h1>
      <span class="brand-num">App 149</span>
    </div>
    <a class="backlink" href="https://augustineiacopelli.github.io/appaday/" title="Back to the AppADay portfolio">&larr; AppADay</a>
    <button class="btn btn-ghost btn-icon" id="btnTheme" type="button" aria-label="Toggle night and parchment theme" title="Toggle theme"></button>
    <button class="btn btn-ghost btn-icon" id="btnSettings" type="button" aria-label="Settings" title="Settings"></button>
  </header>
  <div class="topbar" role="toolbar" aria-label="Project">
    <button class="btn btn-ghost proj-title" id="btnTitle" type="button" title="Rename project"><span class="t">Untitled Saga</span></button>
    <button class="btn size-btn" id="btnSize" type="button" aria-label="Bundle size"></button>
    <button class="btn vbadge" id="btnValidation" type="button" title="Open validation panel" aria-label="Validation status"></button>
    <div class="top-actions">
      <button class="btn" id="btnSave" type="button" title="Save draft (Ctrl+S)"></button>
      <button class="btn" id="btnSlots" type="button" title="Project slots"></button>
      <button class="btn" id="btnImport" type="button" title="Import a bundle"></button>
      <button class="btn" id="btnExport" type="button" title="Export the bundle"></button>
    </div>
    <input type="file" id="fileImport" accept=".json,application/json" hidden>
  </div>
  <div class="store-banner" id="storeBanner" role="alert" hidden><span>This browser refused to save the draft because storage is full. Export the bundle now so no work is lost.</span><button class="btn btn-primary" id="btnBannerExport" type="button">Export now</button></div>
  <nav class="tabs" id="tabs" role="tablist" aria-label="Workspaces"></nav>
  <main class="ws" id="ws" tabindex="-1"></main>
  <footer class="app-foot">
    <span>Story Forge &middot; AppADay 149</span>
    <a class="backlink" href="https://augustineiacopelli.github.io/appaday/">augustineiacopelli.github.io/appaday</a>
  </footer>
</div>
<div id="overlays"></div>
<div class="toast-root" id="toasts" aria-live="polite" role="status"></div>
<script src="engine-render.js"></script>
<script src="engine-audio.js"></script>
<script src="engine-world.js"></script>
<script>
${kitJs}
${engineStory}
${R('src/story-store.js').trim()}
${demoSrc.trim()}
${JS_FENCES.map((f) => R(f).trim()).join('\n')}
${R('src/ws-story149.js').trim()}
${R('src/app-boot.js').trim()}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
const out = R('index.html');
const same = fence(out, '// === KIT:CORE BEGIN ===', '// === KIT:CORE END ===') === kitJs && fence(out, '/* === KIT:CORE CSS BEGIN === */', '/* === KIT:CORE CSS END === */') === kitCss;
console.log('index.html', out.length, 'chars,', out.split('\n').length, 'lines; KIT:CORE verbatim:', same);
if (!same) process.exit(1);

// 3. engine-story.js: the ENGINE:STORY fence under a header. STORY.engines cuts the same fence out of the page at run
// time and adds the same header, with the bundle hash line when a bundle is exported. This repository copy carries no hash.
const open = '// === ENGINE:STORY BEGIN ===', close = '// === ENGINE:STORY END ===';
const a = out.indexOf(open), z = out.indexOf(close);
if (a < 0 || z < a || out.indexOf(open, a + 1) >= 0) throw new Error('ENGINE:STORY fence not found exactly once.');
const engSrc = out.slice(a, z + close.length) + '\n';
const ver = /var S = \{ version: '([^']+)' \}/.exec(engSrc);
if (!ver) throw new Error('No version in ENGINE:STORY.');
const header = '/* Story Forge ENGINE:STORY, engine version ' + ver[1] + '\n' +
  ' * Forge 149 (AppADay 149). Declares one global, ENGINE_STORY. No dependencies; reads no host global. */\n';
fs.writeFileSync(path.join(__dirname, 'engine-story.js'), header + engSrc);
console.log('engine-story.js', (header + engSrc).length, 'chars, version', ver[1]);
