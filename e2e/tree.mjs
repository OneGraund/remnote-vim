#!/usr/bin/env node
// PRECISION nested-hierarchy e2e for the RemNote vim plugin.
//
// Replicates the reported cross-parent selection bug exactly, on a real
// nested tree, verifying THREE channels after every step:
//   1. TINT  — which bullets are visibly highlighted (computed background
//              of each row's [data-rem-id] container)
//   2. DATA  — Rem texts + parent links via RemNote's data API
//   3. FOCUS — the keyboard must be alive (focused rem / editable element)
// A screenshot is archived per phase for human audit.
//
// Prereqs: RemNote with --remote-debugging-port, dev plugin enabled, today's
// Daily Document open.
import { chromium } from 'playwright-core';
import { resolveDailyDocId, dailyPaneScope } from './docid.mjs';
import { mkdirSync } from 'node:fs';

const PORT = process.env.REMNOTE_CDP_PORT ?? '9222';
const SETTLE = Number(process.env.VIM_E2E_SETTLE ?? 900);
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
let page = null;
for (let i = 0; i < 20 && !page; i++) {
  for (const p of browser.contexts().flatMap((c) => c.pages())) {
    if (await p.evaluate(() => typeof window.currentFocusedRem !== 'undefined').catch(() => false)) { page = p; break; }
  }
  if (!page) await new Promise((r) => setTimeout(r, 500));
}
if (!page) { console.error('✗ RemNote app page not found.'); process.exit(2); }

// A freshly launched window swallows synthetic clicks (activeElement stays
// BODY, no rem ever focuses) until the page is brought to the foreground.
await page.bringToFront();

const wait = (ms) => page.waitForTimeout(ms);
const dbg = () => page.evaluate(() => getComputedStyle(document.body, '::before').content.replace(/\\?"/g, ''));
const badge = () => page.evaluate(() => getComputedStyle(document.body, '::after').content.replace(/\\?"/g, ''));
async function counters() {
  const m = (await dbg()).match(/rx=(\d+) done=(\d+)/);
  return m ? { rx: +m[1], done: +m[2] } : { rx: 0, done: 0 };
}
async function waitIdle(timeout = 8000) {
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
  const m = (await badge()).match(/NORMAL|INSERT|V-LINE|VISUAL|:/);
  return m ? (m[0] === ':' ? 'COMMAND' : m[0]) : '?';
}
async function waitMode(t, timeout = 4000) {
  const s = Date.now();
  while (Date.now() - s < timeout) { if ((await mode()) === t) return true; await wait(60); }
  return false;
}
const press = (k) => page.keyboard.press(k, { delay: 10 });
async function keys(seq) {
  const map = { esc: 'Escape', cr: 'Enter', bs: 'Backspace', space: 'Space', tab: 'Tab' };
  let i = 0;
  while (i < seq.length) {
    if (seq[i] === '<') { const j = seq.indexOf('>', i); await press(map[seq.slice(i + 1, j).toLowerCase()]); i = j + 1; }
    else { await press(seq[i] === ' ' ? 'Space' : seq[i]); i++; }
    await wait(45);
  }
  await waitIdle();
  await wait(320);
}
const DOC_ID = await resolveDailyDocId(page);
if (!DOC_ID) { console.error("✗ open today's Daily Document first"); process.exit(2); }
const paneScope = () => dailyPaneScope(page, DOC_ID); // see run.mjs — split-pane duplicate guard
console.log('· tree e2e scoped to daily doc', DOC_ID, '— shots in e2e/shots/');

// ---- channel readers ------------------------------------------------------
// rows: [{id, text, depth, tinted}] in visual order, scoped to the daily doc
async function rows() {
  return page.evaluate(({ docId, pane }) => {
    const TINT = '217, 119, 6';
    const out = [];
    for (const c of document.querySelectorAll(pane + '.EditorContainer')) {
      const wrap = c.closest('[data-rem-id]');
      const id = wrap?.getAttribute('data-rem-id');
      if (!id) continue;
      let cur = window.Rem(window.CURRENT_KNOWLEDGE_BASE).findOne(id);
      let depth = -1, inDoc = false;
      for (let hop = 0; cur && hop < 15; hop++) {
        depth++;
        if (cur.parent === docId) { inDoc = true; break; }
        cur = window.Rem(window.CURRENT_KNOWLEDGE_BASE).findOne(cur.parent);
      }
      if (!inDoc) continue;
      // the row's OWN line: first linear-editor-item inside this container
      // (children render after the parent's own line in DOM order)
      const line = c.querySelector('.linear-editor-item') ?? c;
      const r = line.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // visually tinted if own wrapper OR any ancestor wrapper carries the tint
      let tinted = false;
      for (let w = wrap; w; w = w.parentElement?.closest('[data-rem-id]') ?? null) {
        if (getComputedStyle(w).backgroundColor.includes(TINT)) { tinted = true; break; }
      }
      // own text only: strip descendant container text
      const clone = c.cloneNode(true);
      clone.querySelectorAll('[data-rem-id]').forEach((n) => n.remove());
      out.push({
        id,
        text: clone.textContent.replace(/ |​/g, ' ').trim(),
        depth,
        tinted,
        x: r.x + Math.min(20, Math.max(6, r.width / 2)),
        y: r.y + r.height / 2,
      });
    }
    return out;
  }, { docId: DOC_ID, pane: await paneScope() });
}
const parentText = async (t) => {
  const all = await rows();
  const me = all.find((r) => r.text === t);
  if (!me) return '(missing)';
  return page.evaluate(({ id, docId }) => {
    const r = window.Rem(window.CURRENT_KNOWLEDGE_BASE).findOne(id);
    if (!r || r.parent === docId) return '(top)';
    const p = window.Rem(window.CURRENT_KNOWLEDGE_BASE).findOne(r.parent);
    return p ? (p.key ?? []).map((x) => (typeof x === 'string' ? x : '')).join('') : '(none)';
  }, { id: me.id, docId: DOC_ID });
};
// Focus a row by TEXT using pure keyboard navigation (gg, then j×index),
// then VERIFY the focused rem id — deterministic where mouse clicks are not.
async function clickRow(t) {
  const all = await rows();
  const idx = all.findIndex((x) => x.text === t);
  if (idx < 0) throw new Error(`row "${t}" not found`);
  // bootstrap: the caret walk needs *some* focused editor
  const focusedNow = await page.evaluate(() => !!(window.currentFocusedRem && window.currentFocusedRem()));
  if (!focusedNow) {
    await page.mouse.click(all[0].x, all[0].y);
    await wait(380);
  }
  if ((await mode()) !== 'NORMAL') { await press('Escape'); await waitIdle(); }
  await keys('gg');
  for (let i = 0; i < idx; i++) await keys('j');
  const fid = await page.evaluate(() => window.currentFocusedRem && window.currentFocusedRem()?._id);
  if (fid !== all[idx].id) {
    // one fallback attempt: click the row's own line rect
    await page.mouse.click(all[idx].x, all[idx].y);
    await wait(380);
    if ((await mode()) !== 'NORMAL') { await press('Escape'); await waitIdle(); }
    const fid2 = await page.evaluate(() => window.currentFocusedRem && window.currentFocusedRem()?._id);
    if (fid2 !== all[idx].id) throw new Error(`could not focus row "${t}" (got ${fid2})`);
  }
}
async function insertType(text) {
  await waitMode('INSERT');
  await waitIdle();
  await wait(SETTLE);
  await page.keyboard.type(text, { delay: 110 });
  await wait(140);
  await press('Escape');
  await waitMode('NORMAL');
  await waitIdle();
}

// ---- assertions -----------------------------------------------------------
let steps = 0;
const violations = [];
function check(name, got, want) {
  steps++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`  ✓ ${name}`);
  else { violations.push({ name, got, want }); console.log(`  ✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`); }
}
async function checkFocusAlive(name) {
  steps++;
  const alive = await page.evaluate(() => {
    const ae = document.activeElement;
    return !!(window.currentFocusedRem && window.currentFocusedRem()) ||
      !!(ae && (ae.isContentEditable || ae.closest?.('.EditorContainer')));
  });
  if (alive) console.log(`  ✓ ${name}: focus alive`);
  else { violations.push({ name, focus: 'dead' }); console.log(`  ✗ ${name}: FOCUS DEAD`); }
}
const tinted = async () => (await rows()).filter((r) => r.tinted).map((r) => r.text);
const texts = async () => (await rows()).map((r) => r.text);
const shot = (n) => page.screenshot({ path: `${SHOTS}${n}.png` });

async function resetEmpty() {
  for (let i = 0; i < 25; i++) {
    const all = await rows();
    const dirty = all.find((b) => b.text !== '');
    if (!dirty) break;
    await page.mouse.click(dirty.x, dirty.y);
    await wait(350);
    if ((await mode()) !== 'NORMAL') { await press('Escape'); await waitIdle(); }
    if (all.length <= 1) { await keys('cc'); await press('Escape'); await waitIdle(); }
    else await keys('dd');
  }
  const first = (await rows())[0];
  if (first) { await page.mouse.click(first.x, first.y); await wait(350); }
  if ((await mode()) !== 'NORMAL') { await press('Escape'); await waitIdle(); }
}

// ---- build the bug-report tree --------------------------------------------
// asdf / Empty Bullet ( asdf-child, E:asdf ( g1, g2 ) ) / tail
// Indentation via RemNote's native Tab while in insert mode.
console.log('· phase 1: build the nested tree from the bug report');
await resetEmpty();
await press('i'); await insertType('asdf');
await keys('o'); await insertType('Empty Bullet');
await keys('o'); await waitMode('INSERT'); await waitIdle(); await wait(SETTLE);
await press('Tab'); await wait(300); // child of Empty Bullet
await page.keyboard.type('asdf-child', { delay: 110 }); await wait(140);
await press('Escape'); await waitMode('NORMAL'); await waitIdle();
await keys('o'); await insertType('E:asdf');
await keys('o'); await waitMode('INSERT'); await waitIdle(); await wait(SETTLE);
await press('Tab'); await wait(300); // child of E:asdf
await page.keyboard.type('g1', { delay: 110 }); await wait(140);
await press('Escape'); await waitMode('NORMAL'); await waitIdle();
await keys('o'); await insertType('g2');
// tail at top level: outdent twice from g2's level
await keys('o'); await waitMode('INSERT'); await waitIdle(); await wait(SETTLE);
await press('Shift+Tab'); await wait(300);
await press('Shift+Tab'); await wait(300);
await page.keyboard.type('tail', { delay: 110 }); await wait(140);
await press('Escape'); await waitMode('NORMAL'); await waitIdle();

check('tree texts', await texts(), ['asdf', 'Empty Bullet', 'asdf-child', 'E:asdf', 'g1', 'g2', 'tail']);
check('tree depths', (await rows()).map((r) => r.depth), [0, 0, 1, 1, 2, 2, 0]);
await shot('t1-tree-built');

// ---- THE BUG: select upward from a grandchild ------------------------------
console.log('· phase 2: THE BUG — upward selection crosses the parent boundary');
await clickRow('g1');
await keys('v');
check('anchor tint', await tinted(), ['g1']);
await keys('k'); // onto E:asdf — the parent! (this is what used to be impossible)
check('tint after k crosses into parent (subtree tinted)', await tinted(), ['E:asdf', 'g1', 'g2']);
await checkFocusAlive('after crossing parent');
await shot('t2-selected-into-parent');
await keys('k'); // onto asdf-child
check('tint grows to sibling of parent', await tinted(), ['asdf-child', 'E:asdf', 'g1', 'g2']);
await keys('k'); // onto Empty Bullet — grandparent covers all
check('tint = grandparent subtree', await tinted(), ['Empty Bullet', 'asdf-child', 'E:asdf', 'g1', 'g2']);
await shot('t3-selected-grandparent');
await keys('j'); // shrink back down
check('shrink restores previous tint', await tinted(), ['asdf-child', 'E:asdf', 'g1', 'g2']);
await keys('<esc>');
check('escape clears tint', await tinted(), []);
check('escape leaves tree intact', await texts(), ['asdf', 'Empty Bullet', 'asdf-child', 'E:asdf', 'g1', 'g2', 'tail']);
await checkFocusAlive('after escape');

// ---- cut across the boundary and paste -------------------------------------
console.log('· phase 3: cut parent+grandchildren selection, paste back');
await clickRow('g1');
await keys('vkd'); // select g1 + parent E:asdf (normalizes to E:asdf subtree), cut
check('cut removed the E:asdf subtree', await texts(), ['asdf', 'Empty Bullet', 'asdf-child', 'tail']);
await checkFocusAlive('after cross-parent cut');
await keys('p'); // paste back at the cut site
const after = await texts();
check('paste restored all three rows', after.filter((t) => ['E:asdf', 'g1', 'g2'].includes(t)).length, 3);
check('g1 still under E:asdf after paste', await parentText('g1'), 'E:asdf');
await shot('t4-after-cut-paste');

// ---- indent/outdent across depths ------------------------------------------
console.log('· phase 4: indent & outdent a cross-depth selection');
await clickRow('asdf-child');
await keys('v.'); // select asdf-child, indent → child of previous sibling? asdf-child has no prev sibling...
// asdf-child is first child of Empty Bullet → indent is a no-op (vim >> at leftmost has no prev sibling)
check('indent with no previous sibling is a safe no-op', await parentText('asdf-child'), 'Empty Bullet');
await checkFocusAlive('after no-op indent');
await clickRow('tail');
await keys('v,'); // outdent tail — already top-level → safe no-op
check('outdent at top level is a safe no-op', await parentText('tail'), '(top)');
await clickRow('E:asdf');
await keys('v,'); // outdent E:asdf from Empty Bullet to top level
check('outdent moved E:asdf to top', await parentText('E:asdf'), '(top)');
check('children traveled with it', await parentText('g1'), 'E:asdf');
await keys('v.'); // indent it back under previous sibling (Empty Bullet)
check('indent tucked it back under Empty Bullet', await parentText('E:asdf'), 'Empty Bullet');
await checkFocusAlive('after indent round-trip');
await shot('t5-after-indent-roundtrip');

// ---- y (yank) across boundary ----------------------------------------------
console.log('· phase 5: yank across boundary duplicates subtree');
await clickRow('g1');
await keys('vky'); // yank E:asdf subtree
check('yank leaves doc unchanged', (await texts()).length, 7);
await clickRow('tail');
await keys('p');
const t6 = await texts();
check('paste after yank adds the subtree', t6.filter((t) => t === 'E:asdf').length, 2);
await checkFocusAlive('after yank-paste');
// clean the duplicate: it was pasted below tail
const dup = (await rows()).filter((r) => r.text === 'E:asdf')[1];
if (dup) {
  await page.mouse.click(dup.x, dup.y);
  await wait(350);
  await press('Escape'); await waitIdle();
  await keys('dd');
}

// ---- teardown ---------------------------------------------------------------
console.log('· teardown');
await resetEmpty();
check('daily note left clean', (await texts()).filter(Boolean), []);

console.log(`\nTREE RESULT: ${steps - violations.length}/${steps} checks passed, ${violations.length} violations`);
for (const v of violations) console.log('  ' + JSON.stringify(v));
await browser.close().catch(() => {});
process.exit(violations.length ? 1 : 0);
