// Day 146, Day 147, and Day 148 compatibility probes. Each call boots a fresh page of that forge, imports a bundle, and
// reports what the forge makes of it. Day 148 loads engine-render.js and engine-audio.js by script tag, which jsdom does
// not fetch, so they are evaluated from the Day 148 clone before its page parses.
'use strict';
const path = require('path');
const { boot } = require('./boot');

const APP146 = require('../day146');
const DIR147 = require('../day147'), DIR148 = require('../day148');
const APP147 = path.join(DIR147, 'index.html');
const APP148 = path.join(DIR148, 'index.html');
const ENGINES148 = [path.join(DIR148, 'engine-render.js'), path.join(DIR148, 'engine-audio.js')];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(file, url, engines) {
  const r = boot(file, { url, engines });
  await wait(50);
  if (r.win.ART && r.win.ART.booted) await r.win.ART.booted;
  if (r.win.WORLD && r.win.WORLD.booted) await r.win.WORLD.booted;
  return r;
}
async function inForge(file, url, engines, bundleText, fn) {
  const { win, errors } = await page(file, url, engines);
  const Kit = win.Kit;
  let r;
  try { r = Kit.bundle.importText(bundleText); } catch (e) { return { rejected: e.message }; }
  await wait(10);
  const res = Kit.refreshValidation();
  const out = { matches: r.matches, summary: Kit.validate.summary(res), errors: res.errors.map((x) => x.recordId + ' ' + x.fieldPath + ': ' + x.message), broken: res.broken.map((x) => x.id), forward: res.forward.map((x) => x.id), pageErrors: errors.slice(0, 3) };
  if (fn) Object.assign(out, await fn(win, Kit, res));
  return out;
}
const URL146 = 'https://augustineiacopelli.github.io/appaday-146-saga-forge/';
const URL147 = 'https://augustineiacopelli.github.io/appaday-147-art-and-audio-forge/';
const URL148 = 'https://augustineiacopelli.github.io/appaday-148-world-forge/';
const in146 = (text, fn) => inForge(APP146, URL146, [], text, fn);
const in147 = (text, fn) => inForge(APP147, URL147, [], text, fn);
const in148 = (text, fn) => inForge(APP148, URL148, ENGINES148, text, fn);
const page148 = (opts) => page(APP148, URL148 + ((opts && opts.dev) ? '?dev=1' : ''), ENGINES148);

// Restamps the content hash with Day 146's own algorithm (KIT:CORE is verbatim in every forge).
async function stamp(bundle) {
  const { win } = boot(APP146);
  await wait(30);
  bundle.kit.contentHash = win.Kit.bundle.hash(bundle);
  return JSON.stringify(bundle, null, 2);
}

module.exports = { in146, in147, in148, page148, stamp, APP146, APP147, APP148, DIR147, DIR148, ENGINES148 };
