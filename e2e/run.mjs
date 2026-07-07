#!/usr/bin/env node
// Live end-to-end smoke test for the RemNote vim plugin.
//
// Drives real keystrokes into RemNote over CDP and asserts on the focused
// bullet's OWN text (read-only, via RemNote's in-page data API). Everything
// happens in ONE scratch bullet of today's Daily Document, as a single
// continuous narrative: each command builds on the previous result, so no
// per-command line-clearing is needed (RemNote's programmatic range-delete is
// caret-state sensitive and unreliable for a blind "clear the line").
//
// Timing facts baked in:
//   * Entering insert mode releases stolen letter keys asynchronously — wait
//     for the INSERT badge AND a settle before typing, else a typed
//     'o'/space is still stolen and fires a vim command.
//   * Stolen keys are processed via async round-trips to the sandboxed plugin
//     iframe; the debug badge exposes rx/done counters, we wait for rx===done.
//
// Prereqs: RemNote running with --remote-debugging-port (default 9222), the
// dev plugin loaded+enabled, and today's Daily Document open.
import { chromium } from 'playwright-core';

const PORT = process.env.REMNOTE_CDP_PORT ?? '9222';
const SETTLE = Number(process.env.VIM_E2E_SETTLE ?? 900);
const TYPE_DELAY = Number(process.env.VIM_E2E_TYPE ?? 130);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);

async function findPage() {
  const pages = browser.contexts().flatMap((c) => c.pages()).filter((p) => !/^devtools|^chrome-extension/.test(p.url()));
  for (let i = 0; i < 20; i++) {
    for (const p of pages) {
      const ok = await p.evaluate(() => typeof window.currentFocusedRem !== 'undefined').catch(() => false);
      if (ok) return p;
    }
    await pages[0]?.waitForTimeout(500);
  }
  return null;
}
const page = await findPage();
if (!page) { console.error('✗ RemNote app page not found.'); process.exit(2); }

// RemNote can boot with a stuck `pointer-events-none` on the editor (its
// suppress-mouse-while-typing state never clears if no real pointer ever
// enters the window) — every mouse.click would then fall through to <html>
// and silently focus nothing. Strip it once up front.
await page.evaluate(() =>
  document.querySelector('.rn-editor-container')?.classList.remove('pointer-events-none'));

const wait = (ms) => page.waitForTimeout(ms);
const dbg = () => page.evaluate(() => getComputedStyle(document.body, '::before').content.replace(/\\?"/g, ''));
const badge = () => page.evaluate(() => getComputedStyle(document.body, '::after').content.replace(/\\?"/g, ''));
if (!/NORMAL|INSERT|VISUAL/.test(await badge())) {
  console.error('✗ Vim plugin not active (no mode badge). Load & enable the dev plugin.');
  process.exit(2);
}

async function counters() {
  const m = (await dbg()).match(/rx=(\d+) done=(\d+)/);
  return m ? { rx: +m[1], done: +m[2] } : { rx: 0, done: 0 };
}
async function waitIdle(timeout = 6000) {
  const start = Date.now();
  let stable = 0, last = -1;
  while (Date.now() - start < timeout) {
    const { rx, done } = await counters();
    if (rx === done && done === last) { if (++stable >= 2) return; } else stable = 0;
    last = done;
    await wait(60);
  }
}
async function mode() {
  const m = (await badge()).match(/NORMAL|INSERT|V-LINE|VISUAL/);
  return m ? m[0] : '?';
}
async function waitMode(target, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if ((await mode()) === target) return; await wait(60); }
}
async function press(key) { await page.keyboard.press(key, { delay: 10 }); }
async function keys(seq) {
  const map = { esc: 'Escape', cr: 'Enter', bs: 'Backspace', space: 'Space', 'c-r': 'Control+r' };
  let i = 0;
  while (i < seq.length) {
    if (seq[i] === '<') { const j = seq.indexOf('>', i); await press(map[seq.slice(i + 1, j).toLowerCase()]); i = j + 1; }
    else { await press(seq[i] === ' ' ? 'Space' : seq[i]); i++; }
    await wait(45);
  }
  await waitIdle();
  // let the adapter's idle reconcile (250ms after the last key) run too
  await wait(420);
}
async function readOwn() {
  return page.evaluate(async () => {
    const r = window.currentFocusedRem && window.currentFocusedRem();
    if (!r) return null;
    try { return ((await r.getText()) ?? []).map((x) => (typeof x === 'string' ? x : '')).join(''); }
    catch { return null; }
  });
}

// ---- daily-note scoping ---------------------------------------------------
// Other panes (the user's real documents!) can be open simultaneously. Every
// DOM query is scoped to bullets whose Rem-ancestor chain reaches the daily
// document (its id is the URL slug suffix), so we can never touch anything
// outside today's note.
// Rem ids are alphanumeric; the URL slug is <Title-words>-<id>, so take the
// text after the LAST hyphen.
const DOC_ID = await page.evaluate(() => location.href.match(/-([A-Za-z0-9]+)$/)?.[1] ?? null);
if (!DOC_ID) {
  console.error("✗ Could not determine the daily document id from the URL. Open today's Daily Document.");
  process.exit(2);
}
console.log('· scoped to daily doc', DOC_ID);

// Returns [{text, x, y}] for every bullet inside the daily doc, in DOM order.
async function scopedBullets() {
  return page.evaluate((docId) => {
    const out = [];
    for (const c of document.querySelectorAll('.EditorContainer')) {
      const id = c.closest('[data-rem-id]')?.getAttribute('data-rem-id');
      if (!id) continue;
      let cur = window.Rem(window.CURRENT_KNOWLEDGE_BASE).findOne(id);
      let inDoc = false;
      for (let hop = 0; cur && hop < 12; hop++) {
        if (cur._id === docId || cur.parent === docId) { inDoc = true; break; }
        cur = window.Rem(window.CURRENT_KNOWLEDGE_BASE).findOne(cur.parent);
      }
      if (!inDoc) continue;
      const r = c.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      out.push({ text: c.textContent.replace(/ |​/g, ' ').trim(), x: r.x + Math.min(25, r.width / 2 + 5), y: r.y + r.height / 2 });
    }
    return out;
  }, DOC_ID);
}

async function focusScratch() {
  const bullets = await scopedBullets();
  const target = bullets[0] ?? { x: 200, y: 167 };
  await page.mouse.click(target.x, target.y);
  await wait(400);
  if ((await mode()) !== 'NORMAL') { await press('Escape'); await waitIdle(); }
}

// Sweep the daily note down to a single empty bullet using `dd` (delete-rem
// is reliable where blind range-clear is not).
async function resetEmpty() {
  for (let i = 0; i < 15; i++) {
    const bullets = await scopedBullets();
    const dirty = bullets.find((b) => b.text !== '');
    if (!dirty) break;
    await page.mouse.click(dirty.x, dirty.y);
    await wait(400);
    if ((await mode()) !== 'NORMAL') { await press('Escape'); await waitIdle(); }
    await keys('dd');
  }
  await focusScratch();
}
// type into insert mode safely (wait for the release before typing)
async function insertType(text) {
  await waitMode('INSERT');
  await waitIdle();
  await wait(SETTLE);
  await page.keyboard.type(text, { delay: TYPE_DELAY });
  await wait(150);
  await press('Escape');
  await waitMode('NORMAL');
  await waitIdle();
}
// Run an insert-entering command (i/a/A/I/o/cw/s/…) then type text with the
// release settle, then leave normal mode. Avoids racing the key release.
async function cmdType(cmd, text) {
  await keys(cmd);
  await insertType(text);
}

// ---- narrative ----------------------------------------------------------
let pass = 0;
let knownFail = 0;
const failures = [];
async function expect(label, want, known = false) {
  const got = await readOwn();
  if (got === want) { pass++; console.log(`  ✓ ${label} → ${JSON.stringify(got)}`); }
  else if (known) { knownFail++; console.log(`  ⚠ ${label} → ${JSON.stringify(got)} (want ${JSON.stringify(want)}) [known issue: positioned insert]`); }
  else { failures.push({ label, got, want }); console.log(`  ✗ ${label} → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`); }
}

console.log('· plugin active; running live narrative smoke test');

// Establish a clean, known starting line (reset via dd, then type once).
await resetEmpty();
await press('i');
await insertType('hello world foo');
await expect('insert-mode typing', 'hello world foo');

// The single most important check: h/l must move the VISIBLE caret, proven by
// typing at the new position (not just by operator math).
await keys('hh'); // caret was at end (15) after typing; now 13
await cmdType('i', 'Z'); // insert at 13
await expect('h moves the visible caret (type lands there)', 'hello world fZoo');
await keys('x'); // caret after insert-exit = 14, delete 'o' → tests l-sync too
await expect('x at tracked caret', 'hello world fZo');
await keys('0lx'); // to start, right one, delete 'e'
await expect('0 and l move the visible caret', 'hllo world fZo');

// reset the line for the operator narrative
await resetEmpty();
await press('i');
await insertType('hello world foo');

// A continuous narrative of edits — each builds on the previous result, so
// no fragile per-command line-clearing is needed.
await keys('0x'); // delete char under cursor
await expect('0 x deletes first char', 'ello world foo');

await keys('dw'); // operator + word motion
await expect('dw deletes a word', 'world foo');

// vim would leave " foo"; RemNote normalizes the leading space away, and the
// adapter mirrors that so the model stays aligned.
await keys('de'); // operator + word-end motion
await expect('de deletes to word end (RemNote trims lead space)', 'foo');

await keys('rz'); // replace char under cursor (caret 0: 'f' → 'z')
await expect('r replaces a char', 'zoo');

await keys('`'); // backtick = ~ (toggles the 'z' to 'Z')
await expect('backtick toggles case', 'Zoo');

await keys('daw'); // delete a word (whole line here) → empty
await expect('daw deletes the word', '');

await keys('u'); // undo the daw
await expect('u undoes the delete', 'Zoo');

await keys('dd'); // delete the whole Rem
await resetEmpty();

// ---- part 2: bullets & visual-line (multi-bullet) ------------------------

const allBullets = async () => (await scopedBullets()).map((b) => b.text);
const remIdByText = (t) =>
  page.evaluate(({ txt, docId }) => {
    for (const c of document.querySelectorAll('.EditorContainer')) {
      if (c.textContent.trim() !== txt) continue;
      const id = c.closest('[data-rem-id]')?.getAttribute('data-rem-id');
      if (!id) continue;
      let cur = window.Rem(window.CURRENT_KNOWLEDGE_BASE).findOne(id);
      for (let hop = 0; cur && hop < 12; hop++) {
        if (cur._id === docId || cur.parent === docId) return id;
        cur = window.Rem(window.CURRENT_KNOWLEDGE_BASE).findOne(cur.parent);
      }
    }
    return null;
  }, { txt: t, docId: DOC_ID });
const parentOfText = async (t) => {
  const id = await remIdByText(t);
  if (!id) return null;
  return page.evaluate((rid) => window.Rem(window.CURRENT_KNOWLEDGE_BASE).findOne(rid)?.parent ?? null, id);
};
async function clickBullet(t) {
  const b = (await scopedBullets()).find((x) => x.text === t);
  if (!b) throw new Error(`bullet "${t}" not found in the daily doc`);
  await page.mouse.click(b.x, b.y);
  await wait(400);
  if ((await mode()) !== 'NORMAL') { await press('Escape'); await waitIdle(); }
}
async function checkList(label, want) {
  const got = await allBullets();
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${label} → ${JSON.stringify(got)}`); }
  else { failures.push({ label, got, want }); console.log(`  ✗ ${label} → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`); }
}

console.log('· part 2: o/O, visual-line cut/paste, indent');

// build three bullets with o
await focusScratch();
await press('i');
await insertType('alpha');
await keys('o'); await insertType('beta');
await keys('o'); await insertType('gamma');
await wait(400);
await checkList('o builds three bullets', ['alpha', 'beta', 'gamma']);

// vv j d — visual-line: cut the top two bullets (vv = V, shift-blind steal)
await clickBullet('alpha');
await keys('vjd');
await wait(500);
await checkList('v j d cuts two bullets', ['gamma']);

// p — paste them back below gamma
await clickBullet('gamma');
await keys('p');
await wait(500);
await checkList('p pastes the cut bullets', ['gamma', 'alpha', 'beta']);

// vv j . — indent alpha+beta under gamma ('.' = '>' live)
await clickBullet('alpha');
await keys('vj.');
await wait(600);
{
  const gammaId = await remIdByText('gamma');
  const pAlpha = await parentOfText('alpha');
  const pBeta = await parentOfText('beta');
  const ok = gammaId && pAlpha === gammaId && pBeta === gammaId;
  if (ok) { pass++; console.log('  ✓ v j . indents both under gamma'); }
  else { failures.push({ label: 'indentSelection', gammaId, pAlpha, pBeta }); console.log(`  ✗ v j . indent: parents ${pAlpha},${pBeta} ≠ ${gammaId}`); }
}

// vv j , — outdent them back to top level (',' = '<' live)
await clickBullet('alpha');
await keys('vj,');
await wait(600);
{
  const gammaId = await remIdByText('gamma');
  const pAlpha = await parentOfText('alpha');
  const ok = pAlpha !== gammaId && pAlpha != null;
  if (ok) { pass++; console.log('  ✓ v j , outdents back'); }
  else { failures.push({ label: 'outdentSelection', pAlpha, gammaId }); console.log(`  ✗ v j , outdent: alpha parent still ${pAlpha}`); }
}

// cleanup part 2 bullets
for (const t of ['alpha', 'beta', 'gamma']) {
  try {
    await clickBullet(t);
    await keys('dd');
    await wait(300);
  } catch {
    /* already gone */
  }
}

// ---- cleanup: leave the scratch bullet empty ----------------------------
await resetEmpty();

const total = pass + failures.length + knownFail;
console.log(`\nRESULT: ${pass}/${total} live checks passed` + (knownFail ? ` (${knownFail} known-issue)` : ''));
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log('  ' + JSON.stringify(f)); }
await browser.close().catch(() => {});
process.exit(failures.length ? 1 : 0);
