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
// 1b. engine-battle.js: Day 146 ships ENGINE:BATTLE inside its page, between two marker lines, and writes it out as a file
// at export. Day 149 vendors that same text under Day 146's export header (without a bundle hash line), so the game kit
// holds all five engines. The text between the markers must equal Day 146's byte for byte.
const BATTLE_OPEN = '// === ENGINE:BATTLE BEGIN ===', BATTLE_CLOSE = '// === ENGINE:BATTLE END ===';
function battleInner(text) {
  let a = text.indexOf(BATTLE_OPEN), z = text.indexOf(BATTLE_CLOSE, a + 1);
  if (a < 0 || z < 0) throw new Error('ENGINE:BATTLE fence not found in Day 146.');
  a = text.indexOf('\n', a); z = text.lastIndexOf('\n', z);
  return text.slice(a + 1, z + 1);
}
const battleSrc = battleInner(src146);
const battleVer = /var VERSION = '([^']+)'/.exec(battleSrc);
if (!battleVer) throw new Error('No version in ENGINE:BATTLE.');
const battleFile = '/* Saga Forge ENGINE:BATTLE, engine version ' + battleVer[1] + '\n * Forge 146 export. Declares one global, ENGINE_BATTLE. No dependencies. */\n' + battleSrc;
if (REVENDOR || !exists('engine-battle.js')) fs.writeFileSync(path.join(__dirname, 'engine-battle.js'), battleFile);
{
  const ours = R('engine-battle.js'), body = ours.slice(ours.indexOf('*/\n') + 3);
  if (body !== battleSrc) { console.error('engine-battle.js differs from Day 146\'s ENGINE:BATTLE fence. Run node build.js --revendor to take Day 146\'s copy.'); process.exit(1); }
  console.log('engine-battle.js', ours.length, 'chars, fence byte equal to Day 146, version', battleVer[1], 'sha256', sha(ours).slice(0, 16));
}

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
const ENGINE_SECTIONS = ['src/engine-index.js', 'src/engine-cond.js', 'src/engine-cmd.js', 'src/engine-run.js', 'src/engine-pages.js', 'src/engine-dlg.js', 'src/engine-save.js', 'src/engine-walk.js', 'src/engine-host.js'].filter(exists);
const FREEZE = '  // ---------------------------------------------------------------- later phases insert sections above this line';
const engineBase = R('src/engine-story.js');
if (engineBase.split(FREEZE).length !== 2) throw new Error('ENGINE:STORY freeze marker not found exactly once.');
const engineStory = engineBase.replace(FREEZE, () => ENGINE_SECTIONS.map((f) => R(f).replace(/\s+$/, '') + '\n\n').join('') + FREEZE).trim();
// engine-story.js is the fence under a header (STORY.engines adds the same header at run time, plus a bundle hash line
// when a bundle is exported). Worked out here, before the page, so the page can carry every engine file's hash.
const storyVer = /var S = \{ version: '([^']+)' \}/.exec(engineStory);
if (!storyVer) throw new Error('No version in ENGINE:STORY.');
const storyFile = '/* Story Forge ENGINE:STORY, engine version ' + storyVer[1] + '\n' +
  ' * Forge 149 (AppADay 149). Declares one global, ENGINE_STORY. No dependencies; reads no host global. */\n' + engineStory + '\n';
// The game kit: every engine a game loads, in load order, as the repository holds them. sha256 is over the file with any
// one '/* Bundle hash <hex> */' line removed, so an exported copy (which carries that line) checks against the same value.
const ENGINE_FILES = [
  { key: 'render', file: 'engine-render.js', global: 'ENGINE_RENDER', owner: 147, text: R('engine-render.js') },
  { key: 'audio', file: 'engine-audio.js', global: 'ENGINE_AUDIO', owner: 147, text: R('engine-audio.js') },
  { key: 'world', file: 'engine-world.js', global: 'ENGINE_WORLD', owner: 148, text: R('engine-world.js') },
  { key: 'battle', file: 'engine-battle.js', global: 'ENGINE_BATTLE', owner: 146, text: R('engine-battle.js') },
  { key: 'story', file: 'engine-story.js', global: 'ENGINE_STORY', owner: 149, text: storyFile }
].map((f) => ({ key: f.key, file: f.file, global: f.global, owner: f.owner, version: (/engine version ([0-9.]+)/.exec(f.text.slice(0, 400)) || /version: '([0-9.]+)'/.exec(f.text) || [0, 'unknown'])[1], bytes: Buffer.byteLength(noHashLine(f.text)), sha256: sha(noHashLine(f.text)) }));
const engineTable = JSON.stringify(ENGINE_FILES);
// Workspace fences arrive with later phases; each is optional until its phase.
const CSS_FENCES = ['src/story-flags.css', 'src/story-quests.css', 'src/story-dialogue.css', 'src/story-events.css', 'src/story-endings.css', 'src/story-validation.css'].filter(exists);
const JS_FENCES = ['src/story-scaffold.js', 'src/story-quests.js', 'src/story-dialogue.js', 'src/story-events.js', 'src/story-endings.js', 'src/story-checks.js', 'src/story-day150.js', 'src/ws-flags.js', 'src/ws-cond.js', 'src/ws-quests.js', 'src/ws-dialogue.js', 'src/ws-events.js', 'src/ws-endings.js', 'src/ws-validation.js'].filter(exists);

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
${R('src/ws-story149.js').trim().replace('/*ENGINE_FILES*/null', () => engineTable)}
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

// 3. engine-story.js: the ENGINE:STORY fence under a header, checked against the page's own fence. This repository copy
// carries no bundle hash.
const open = '// === ENGINE:STORY BEGIN ===', close = '// === ENGINE:STORY END ===';
const a = out.indexOf(open), z = out.indexOf(close);
if (a < 0 || z < a || out.indexOf(open, a + 1) >= 0) throw new Error('ENGINE:STORY fence not found exactly once.');
if (out.slice(a, z + close.length) !== engineStory) throw new Error('The page\'s ENGINE:STORY fence differs from the one built.');
fs.writeFileSync(path.join(__dirname, 'engine-story.js'), storyFile);
console.log('engine-story.js', storyFile.length, 'chars, version', storyVer[1]);
ENGINE_FILES.forEach((f) => { if (sha(noHashLine(R(f.file))) !== f.sha256) { console.error(f.file + ' does not match the table the page carries.'); process.exit(1); } });
console.log('game kit:', ENGINE_FILES.map((f) => f.file + ' ' + f.version + ' ' + f.sha256.slice(0, 12)).join(', '));
