// Targeted live probes for the find/word-end cursor-landing fixes:
// f/t land ON a char (x deletes it, a appends after), dt keeps its exclusive
// operator end, `e` lands on the word-end char and `ea` appends right after
// the word, `,` reverse-repeat moves. Text-diff assertions against a typed
// fixture, same harness conventions as run.mjs.
//
//   REMNOTE_CDP_PORT=9223 node e2e/motionfix.mjs
import { chromium } from 'playwright-core';
import { resolveDailyDocId, dailyPaneScope } from './docid.mjs';

const PORT = process.env.REMNOTE_CDP_PORT ?? '9222';
const SETTLE = Number(process.env.VIM_E2E_SETTLE ?? 1600);
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

await page.evaluate(() =>
  document.querySelector('.rn-editor-container')?.classList.remove('pointer-events-none'));
await page.bringToFront();

const wait = (ms) => page.waitForTimeout(ms);
const dbg = () => page.evaluate(() => getComputedStyle(document.body, '::before').content.replace(/\\?"/g, ''));
const badge = () => page.evaluate(() => getComputedStyle(document.body, '::after').content.replace(/\\?"/g, ''));
if (!/NORMAL|INSERT|VISUAL/.test(await badge())) {
  console.error('✗ Vim plugin not active (no mode badge).');
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
  const map = { esc: 'Escape', cr: 'Enter', bs: 'Backspace', space: 'Space' };
  let i = 0;
  while (i < seq.length) {
    if (seq[i] === '<') { const j = seq.indexOf('>', i); await press(map[seq.slice(i + 1, j).toLowerCase()]); i = j + 1; }
    else { await press(seq[i] === ' ' ? 'Space' : seq[i]); i++; }
    await wait(45);
  }
  await waitIdle();
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

const DOC_ID = await resolveDailyDocId(page);
if (!DOC_ID) { console.error('✗ daily doc id not found'); process.exit(2); }
const paneScope = () => dailyPaneScope(page, DOC_ID);
console.log('· scoped to daily doc', DOC_ID);

async function scopedBullets() {
  return page.evaluate(({ docId, pane }) => {
    const out = [];
    for (const c of document.querySelectorAll(pane + '.EditorContainer')) {
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
  }, { docId: DOC_ID, pane: await paneScope() });
}

// Dismiss the daily-template banner if its backdrop is up (it swallows all
// synthetic clicks — see reallife.mjs).
async function dismissBanner() {
  await page.evaluate(() => {
    const x = [...document.querySelectorAll('[role="dialog"] button, .rn-modal button')]
      .find((b) => /close|not now|×/i.test(b.textContent + (b.getAttribute('aria-label') ?? '')));
    x?.click();
  }).catch(() => {});
}

async function focusScratch() {
  const bullets = await scopedBullets();
  const target = bullets[0] ?? { x: 200, y: 167 };
  await page.mouse.click(target.x, target.y);
  await wait(400);
  if ((await mode()) !== 'NORMAL') { await press('Escape'); await waitIdle(); }
}
async function resetEmpty() {
  for (let i = 0; i < 15; i++) {
    await dismissBanner();
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

let pass = 0;
const failures = [];
async function expect(label, want) {
  const got = await readOwn();
  if (got === want) { pass++; console.log(`  ✓ ${label} → ${JSON.stringify(got)}`); }
  else { failures.push({ label, got, want }); console.log(`  ✗ ${label} → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`); }
}

// Each probe: fresh fixture line, key sequence, expected text after.
async function probe(label, fixture, seq, want) {
  await resetEmpty();
  await press('i');
  await insertType(fixture);
  await keys('0');
  await keys(seq);
  await expect(label, want);
}

console.log('· motion-landing fix probes');

await probe('fz then x deletes the z (committed fix holds)', 'the lazy dog', 'fzx', 'the lay dog');
await probe('tx then x deletes the char BEFORE x', 'abcx', 'txx', 'abx');
await probe('dtx deletes up to but not including x', 'abcx', 'dtx', 'x');
await probe('e then x deletes the word-end char', 'one two', 'ex', 'on two');
await probe('e from a word end advances to the NEXT word end', 'one two', 'eex', 'one tw');
await probe(', after f reverse-repeats onto the char', 'a.b.c', 'f.f.,x', 'ab.c');
await probe('2tx lands before the 2nd x (adjacent pair)', 'axxb', '2txx', 'axb');

// ea: append right after the word, not at the next word's start
await resetEmpty();
await press('i');
await insertType('one two');
await keys('0e');
await keys('a');
await insertType('s');
await expect('ea appends right after the word', 'ones two');

// leave the doc clean
await resetEmpty();

console.log(`\n${pass} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
