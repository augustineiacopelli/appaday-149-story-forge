// Shared loader for the Story Forge page under jsdom: supplies the three vendored engines the page loads by script tag.
'use strict';
const path = require('path');
const { boot } = require('./boot');
const ROOT = path.join(__dirname, '..');
const APP149 = path.join(ROOT, 'index.html');
const ENGINES = ['engine-render.js', 'engine-audio.js', 'engine-world.js'].map((f) => path.join(ROOT, f));
const URL149 = 'https://augustineiacopelli.github.io/appaday-149-story-forge/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function boot149(opts) {
  opts = Object.assign({ url: URL149 + (opts && opts.dev === false ? '' : '?dev=1') }, opts || {});
  const r = boot(APP149, Object.assign({}, opts, { engines: ENGINES }));
  await wait(60);
  if (r.win.STORY && r.win.STORY.booted) await r.win.STORY.booted;
  return r;
}
module.exports = { boot149, ROOT, APP149, ENGINES, URL149, wait };
