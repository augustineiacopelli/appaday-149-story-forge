// Layout audit in headless Chromium at 390 (at 3x pixels, like a phone) and 1280 wide: no horizontal scroll and no tap
// target under 44 px on every tab, the export dialog, and the size drawer. Needs Playwright with Chromium (not in
// package.json; install it on its own, for example npm install playwright in a scratch folder and run with NODE_PATH
// pointing at it). The page loads its three engines by relative script tags, so it runs from file:// as is. A resource
// that fails to load (Google Fonts without a network) is not counted; script errors are.
const { chromium } = require('playwright');
const ROOT = require('path').join(__dirname, '..');
(async () => {
  const br = await chromium.launch();
  const report = [];
  for (const w of [390, 1280]) {
    const pg = await br.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: w === 390 ? 3 : 1 });
    const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await pg.goto('file://' + ROOT + '/index.html?dev=1');
    await pg.waitForFunction(() => window.STORY && window.Kit && window.Kit.bundle.current());
    await pg.evaluate(() => window.STORY.booted);
    const audit = async (label) => pg.evaluate((label) => {
      const de = document.documentElement, small = [];
      document.querySelectorAll('button, a, input, select, label.switch, [role=tab]').forEach((e) => {
        const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        if (!r.width || !r.height || cs.visibility === 'hidden' || e.closest('[hidden]')) return;
        if (e.tagName === 'INPUT' && (e.type === 'checkbox' || e.type === 'radio' || e.type === 'file')) return;
        if (e.tagName === 'A' && e.closest('p, td, dd, small')) return;
        if (r.height < 44 || r.width < 44) small.push((e.id || e.className || e.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + (e.textContent || '').trim().slice(0, 20));
      });
      return { label, hscroll: de.scrollWidth > de.clientWidth, sw: de.scrollWidth, cw: de.clientWidth, small: small.slice(0, 8) };
    }, label);
    await pg.evaluate(() => window.Kit.go('start')); await pg.waitForTimeout(120);
    report.push(Object.assign({ w }, await audit('start (no world)')));
    await pg.evaluate(() => window.STORY.loadFixture('four'));
    await pg.waitForTimeout(250);
    for (const t of ['start', 'flags', 'quests', 'dialogue', 'events', 'export', 'dev']) {
      await pg.evaluate((t) => window.Kit.go(t), t); await pg.waitForTimeout(150);
      report.push(Object.assign({ w }, await audit(t)));
      if (t === 'start' || t === 'export') await pg.screenshot({ path: ROOT + '/test/out/phase0-' + t + '-' + w + '.png', fullPage: true });
    }
    const click = (re, scope) => pg.evaluate(([src, scope]) => { const r = new RegExp(src); const e = Array.from(document.querySelectorAll((scope || '#ws') + ' button')).find((x) => r.test(x.textContent)); if (e) e.click(); return !!e; }, [re.source, scope]);
    await pg.evaluate(() => window.Kit.go('quests')); await pg.waitForTimeout(100);
    await click(/Build quests from the world/); await pg.waitForTimeout(250);
    report.push(Object.assign({ w }, await audit('quests built')));
    await pg.evaluate(() => { const h = document.querySelector('.qs-item .fg-head'); if (h) h.click(); }); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('quest expanded, state machine drawn')));
    await pg.screenshot({ path: ROOT + '/test/out/phase3-quest-' + w + '.png', fullPage: true });
    await pg.evaluate(() => { const n = document.querySelectorAll('.qs-node')[1]; if (n) n.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await pg.waitForTimeout(150);
    await click(/Add branch group/); await pg.waitForTimeout(150);
    await click(/Add a failure rule/); await pg.waitForTimeout(150);
    await click(/Move on when a condition passes/); await pg.waitForTimeout(150);
    await click(/Add condition/); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('quest with a branch group, failure rule and condition editor')));
    await pg.screenshot({ path: ROOT + '/test/out/phase3-quest-editors-' + w + '.png', fullPage: true });
    await click(/^Settings$/); await pg.waitForTimeout(200);
    report.push(Object.assign({ w }, await audit('quest settings dialog')));
    await pg.evaluate(() => window.Kit.ui.closeTop()); await pg.waitForTimeout(100);
    const wide = await pg.evaluate(() => { const sc = document.querySelector('.qs-scroll'); return sc ? { client: sc.clientWidth, scroll: sc.scrollWidth, page: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth } : null; });
    report.push(Object.assign({ w }, { label: 'quest picture scrolls inside its own box ' + JSON.stringify(wide), hscroll: !wide || wide.page > wide.vw, sw: 0, cw: 0, small: [] }));
    await pg.evaluate(() => window.Kit.go('dialogue')); await pg.waitForTimeout(100);
    await click(/Build dialogue from the world/); await pg.waitForTimeout(300);
    report.push(Object.assign({ w }, await audit('dialogue built')));
    await pg.evaluate(() => { const h = document.querySelector('.dg-item .fg-head'); if (h) h.click(); }); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('dialogue expanded: graph, line editor, preview')));
    await pg.screenshot({ path: ROOT + '/test/out/phase4-dialogue-' + w + '.png', fullPage: true });
    await click(/Run from the start/); await pg.waitForTimeout(150);
    await click(/Add a choice/); await pg.waitForTimeout(150);
    await click(/Add an effect/); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('dialogue after a preview run and an added choice')));
    await pg.evaluate(() => { const n = document.querySelectorAll('.dg-node')[0]; if (n) n.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await pg.waitForTimeout(150);
    const dwide = await pg.evaluate(() => { const sc = document.querySelector('.dg-scroll'); return sc ? { page: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth } : null; });
    report.push(Object.assign({ w }, { label: 'dialogue graph scrolls inside its own box ' + JSON.stringify(dwide), hscroll: !dwide || dwide.page > dwide.vw, sw: 0, cw: 0, small: [] }));
    await click(/^People$/); await pg.waitForTimeout(150);
    await pg.evaluate(() => { const h = document.querySelector('.dg-item .fg-head'); if (h) h.click(); }); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('dialogue people view with a person expanded')));
    await pg.screenshot({ path: ROOT + '/test/out/phase4-people-' + w + '.png', fullPage: true });
    await pg.evaluate(() => window.Kit.go('events')); await pg.waitForTimeout(100);
    await click(/Build events from the world/); await pg.waitForTimeout(300);
    report.push(Object.assign({ w }, await audit('events built, with the empty boss slot card and the playtester')));
    await pg.evaluate(() => { const h = Array.from(document.querySelectorAll('.ev-item')).find((x) => /Boss: The Marches/.test(x.textContent)); if (h) h.querySelector('.fg-head').click(); }); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('event expanded: page tabs, condition, nested command blocks')));
    await pg.screenshot({ path: ROOT + '/test/out/phase5-event-' + w + '.png', fullPage: true });
    await pg.evaluate(() => { const b = Array.from(document.querySelectorAll('.ev-page .ev-cmd')).find((x) => /Battle/.test(x.textContent)); const e = b && Array.from(b.querySelectorAll('button')).find((x) => x.textContent === 'Edit'); if (e) e.click(); }); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('command dialog (a battle)')));
    await pg.evaluate(() => window.Kit.ui.closeTop()); await pg.waitForTimeout(100);
    await pg.evaluate(() => { const it = Array.from(document.querySelectorAll('.ev-item')).find((x) => /Boss: The Marches/.test(x.textContent)); const p = it && Array.from(it.querySelectorAll('button')).find((x) => /^Play$/.test(x.textContent)); if (p) p.click(); }); await pg.waitForTimeout(150);
    for (let k = 0; k < 6; k++) { const more = await click(/^Continue$/, '#evPlay'); if (!more) break; await pg.waitForTimeout(80); }
    report.push(Object.assign({ w }, await audit('playtester stopped at a battle, with the inspector')));
    await pg.screenshot({ path: ROOT + '/test/out/phase5-play-' + w + '.png', fullPage: true });
    await click(/Play the golden path/); await pg.waitForTimeout(250);
    report.push(Object.assign({ w }, await audit('golden path panel')));
    await click(/^Add event$/); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('add event dialog')));
    await pg.evaluate(() => window.Kit.ui.closeTop()); await pg.waitForTimeout(100);
    await pg.evaluate(() => window.Kit.go('start')); await pg.waitForTimeout(100);
    await click(/Build endings|Update endings/); await pg.waitForTimeout(300);
    report.push(Object.assign({ w }, await audit('start with the endings and playtime cards')));
    await pg.evaluate(() => { const h = document.querySelector('[data-panel="endings"] .en-item .fg-head'); if (h) h.click(); }); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('ending expanded: fields, condition editor, epilogue')));
    await pg.screenshot({ path: ROOT + '/test/out/phase6-ending-' + w + '.png', fullPage: true });
    await click(/^Add ending$/); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('add ending dialog')));
    await pg.evaluate(() => window.Kit.ui.closeTop()); await pg.waitForTimeout(100);
    await pg.evaluate(() => { const e = document.querySelector('[data-panel="playtime"]'); if (e) e.scrollIntoView(); }); await pg.waitForTimeout(100);
    report.push(Object.assign({ w }, await audit('playtime card: chapters and optional quest minutes')));
    await pg.screenshot({ path: ROOT + '/test/out/phase6-playtime-' + w + '.png', fullPage: true });
    // Phase 7: the Validation tab's story checks on the whole four continent story.
    await pg.evaluate(() => { window.Kit.bundle.touch('layout'); window.Kit.go('export'); });
    report.push(Object.assign({ w }, await audit('validation: the waiting card while the walk runs')));
    await pg.waitForFunction(() => document.querySelectorAll('#ws .vc-card').length === 6, null, { timeout: 60000 });
    report.push(Object.assign({ w }, await audit('validation: six story check cards')));
    await pg.screenshot({ path: ROOT + '/test/out/phase7-validation-' + w + '.png', fullPage: true });
    await click(/^Show \d+ more$/); await pg.waitForTimeout(150);
    await pg.evaluate(() => { document.querySelectorAll('#ws .vc-card details').forEach((d) => { d.open = true; }); }); await pg.waitForTimeout(100);
    report.push(Object.assign({ w }, await audit('validation: every finding shown, paths and the gate table open')));
    await pg.evaluate(() => { window.STORY.validationUi.more = {}; const b = window.Kit.bundle.current(); b.story.settings.walkCap = 40; window.Kit.bundle.touch('layout'); window.Kit.rerender(); });
    await pg.waitForFunction(() => document.querySelectorAll('#ws .vc-card.vc-fail').length > 0, null, { timeout: 60000 });
    await pg.evaluate(() => { document.querySelectorAll('#ws .vc-card details').forEach((d) => { d.open = true; }); }); await pg.waitForTimeout(100);
    report.push(Object.assign({ w }, await audit('validation: a failing story (walk capped), failing cards first, Final disabled')));
    await pg.screenshot({ path: ROOT + '/test/out/phase7-failing-' + w + '.png', fullPage: true });
    await pg.evaluate(() => { const b = window.Kit.bundle.current(); b.story.settings.walkCap = 50000; window.Kit.bundle.touch('layout'); });
    await pg.evaluate(() => window.Kit.go('flags')); await pg.waitForTimeout(100);
    await pg.evaluate(() => { const h = document.querySelector('.fg-item .fg-head'); if (h) h.click(); }); await pg.waitForTimeout(100);
    report.push(Object.assign({ w }, await audit('flags expanded')));
    await pg.evaluate(() => { const e = Array.from(document.querySelectorAll('#ws button')).find((x) => /^Edit/.test(x.textContent)); if (e) e.click(); }); await pg.waitForTimeout(150);
    report.push(Object.assign({ w }, await audit('flag dialog')));
    await pg.evaluate(() => window.Kit.ui.closeTop()); await pg.waitForTimeout(100);
    await pg.evaluate(() => window.Kit.openExport()); await pg.waitForTimeout(200);
    report.push(Object.assign({ w }, await audit('export dialog')));
    await pg.evaluate(() => window.Kit.ui.closeTop()); await pg.waitForTimeout(100);
    await pg.evaluate(() => window.STORY.openSize()); await pg.waitForTimeout(200);
    report.push(Object.assign({ w }, await audit('size drawer')));
    await pg.evaluate(() => window.Kit.ui.closeTop()); await pg.waitForTimeout(100);
    report.forEach((r) => { if (r.w === w && !r.errs) r.errs = errs.slice(); });
    await pg.close();
  }
  await br.close();
  let bad = 0;
  report.forEach((r) => { const ok = !r.hscroll && !r.small.length && !r.errs.length; if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + r.w + ' ' + r.label + (ok ? '' : ' ' + JSON.stringify({ hscroll: r.hscroll, sw: r.sw, cw: r.cw, small: r.small, errs: r.errs.slice(0, 3) }))); });
  console.log('\n' + (report.length - bad) + ' of ' + report.length + ' views pass');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
