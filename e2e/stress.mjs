#!/usr/bin/env node
// Exhaustive live stress test for the RemNote vim plugin.
//
// Runs long, realistic command sequences and checks an INVARIANT after every
// single step: the keyboard must still be alive — i.e. there is a focused Rem
// (or an editable activeElement), or we are deliberately in visual-line mode
// (rem-selection). This is the class of bug that "text looks right" tests
// miss: a command that works but strands the user with a dead cursor.
//
// All work is scoped to today's Daily Document (Rem-ancestor checks), exactly
// like run.mjs. Prereqs identical to run.mjs.
import { chromium } from 'playwright-core';

const PORT = process.env.REMNOTE_CDP_PORT ?? '9222';
const SETTLE = Number(process.env.VIM_E2E_SETTLE ?? 900);
const TYPE_DELAY = Number(process.env.VIM_E2E_TYPE ?? 120);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const pages = browser.contexts().flatMap((c) => c.pages()).filter((p) => !/^devtools/.test(p.url()));
let page = null;
for (let i = 0; i < 20 && !page; i++) {
  for (const p of pages) {
    if (await p.evaluate(() => typeof window.currentFocusedRem !== 'undefined').catch(() => false)) { page = p; break; }
  }
  if (!page) await pages[0]?.waitForTimeout(500);
}
if (!page) { console.error('✗ RemNote app page not found.'); process.exit(2); }

const wait = (ms) => page.waitForTimeout(ms);
const dbg = () => page.evaluate(() => getComputedStyle(document.body, '::before').content.replace(/\\?"/g, ''));
const badge = () => page.evaluate(() => getComputedStyle(document.body, '::after').content.replace(/\\?"/g, ''));
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
  const m = (await badge()).match(/NORMAL|INSERT|V-LINE|VISUAL|COMMAND|:/);
  if (!m) return '?';
  return m[0] === ':' ? 'COMMAND' : m[0];
}
async function waitMode(t, timeout = 4000) {
  const s = Date.now();
  while (Date.now() - s < timeout) { if ((await mode()) === t) return true; await wait(60); }
  return false;
}
const press = (k) => page.keyboard.press(k, { delay: 10 });
async function keys(seq) {
  const map = { esc: 'Escape', cr: 'Enter', bs: 'Backspace', space: 'Space', 'c-r': 'Control+r', 'c-d': 'Control+d', 'c-u': 'Control+u', 'c-e': 'Control+e', 'c-y': 'Control+y' };
  let i = 0;
  while (i < seq.length) {
    if (seq[i] === '<') { const j = seq.indexOf('>', i); await press(map[seq.slice(i + 1, j).toLowerCase()]); i = j + 1; }
    else { await press(seq[i] === ' ' ? 'Space' : seq[i]); i++; }
    await wait(45);
  }
  await waitIdle();
  await wait(380);
}
const DOC_ID = await page.evaluate(() => location.href.match(/-([A-Za-z0-9]+)$/)?.[1] ?? null);
if (!DOC_ID) { console.error("✗ open today's Daily Document first"); process.exit(2); }
console.log('· stress test scoped to daily doc', DOC_ID);

// Strip RemNote's stuck `pointer-events-none` typing-suppression state — see
// the matching note in run.mjs; without this every mouse.click can no-op.
await page.evaluate(() =>
  document.querySelector('.rn-editor-container')?.classList.remove('pointer-events-none'));

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
      out.push({ id, text: c.textContent.replace(/ |​/g, ' ').trim(), x: r.x + Math.min(25, r.width / 2 + 5), y: r.y + r.height / 2 });
    }
    return out;
  }, DOC_ID);
}
const texts = async () => (await scopedBullets()).map((b) => b.text);
async function clickBullet(t) {
  const b = (await scopedBullets()).find((x) => x.text === t);
  if (!b) {
    violations.push({ name: `clickBullet(${t})`, error: 'not found' });
    console.log(`  ✗ clickBullet: "${t}" not found — recovering`);
    const first = (await scopedBullets())[0];
    if (first) { await page.mouse.click(first.x, first.y); await wait(350); }
    return;
  }
  await page.mouse.click(b.x, b.y);
  await wait(380);
  if (!['NORMAL'].includes(await mode())) { await press('Escape'); await waitIdle(); }
}
async function parentOf(t) {
  const b = (await scopedBullets()).find((x) => x.text === t);
  if (!b) return null;
  return page.evaluate((id) => window.Rem(window.CURRENT_KNOWLEDGE_BASE).findOne(id)?.parent ?? null, b.id);
}
async function idOf(t) {
  return (await scopedBullets()).find((x) => x.text === t)?.id ?? null;
}
async function insertType(text) {
  await waitMode('INSERT');
  await waitIdle();
  await wait(SETTLE);
  await page.keyboard.type(text, { delay: TYPE_DELAY });
  await wait(140);
  await press('Escape');
  await waitMode('NORMAL');
  await waitIdle();
}
async function resetEmpty() {
  for (let i = 0; i < 20; i++) {
    const all = await scopedBullets();
    const dirty = all.find((b) => b.text !== '');
    if (!dirty) break;
    await page.mouse.click(dirty.x, dirty.y);
    await wait(350);
    if ((await mode()) !== 'NORMAL') { await press('Escape'); await waitIdle(); }
    if (all.length <= 1) { await keys('cc'); await press('Escape'); await waitIdle(); }
    else await keys('dd');
  }
  const first = (await scopedBullets())[0];
  if (first) { await page.mouse.click(first.x, first.y); await wait(350); }
  if ((await mode()) !== 'NORMAL') { await press('Escape'); await waitIdle(); }
}

// ---------------------------------------------------------------- invariant
let steps = 0;
let pass = 0;
const violations = [];
async function focusAlive() {
  return page.evaluate(() => {
    const ae = document.activeElement;
    const editable = !!(ae && (ae.isContentEditable || ae.closest?.('.EditorContainer')));
    const focused = !!(window.currentFocusedRem && window.currentFocusedRem());
    return { editable, focused };
  });
}
async function step(name, seq) {
  steps++;
  await keys(seq);
  const m = await mode();
  const f = await focusAlive();
  const alive = f.editable || f.focused || m === 'V-LINE' || m === 'VISUAL';
  if (alive) { pass++; }
  else {
    violations.push({ name, seq, mode: m, ...f });
    console.log(`  ✗ FOCUS DEAD after "${name}" (${seq}) mode=${m}`);
    // recover so the rest of the run can continue
    const first = (await scopedBullets())[0];
    if (first) { await page.mouse.click(first.x, first.y); await wait(350); }
    if ((await mode()) !== 'NORMAL') { await press('Escape'); await waitIdle(); }
  }
}
function checkEq(name, got, want) {
  steps++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { violations.push({ name, got, want }); console.log(`  ✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`); }
}

// ---------------------------------------------------------------- scenario
console.log('· phase 1: build 5 bullets');
await resetEmpty();
await press('i'); await insertType('n1');
for (const t of ['n2', 'n3', 'n4', 'n5']) { await keys('o'); await insertType(t); }
checkEq('five bullets built', await texts(), ['n1', 'n2', 'n3', 'n4', 'n5']);

console.log('· phase 2: in-line motion torture on n3');
await clickBullet('n3');
for (const [name, seq] of [
  ['line start + delete', '0x'], ['undo the delete', 'u'],
  ['line start', '0'], ['right once', 'l'],
  ['word fwd', 'w'], ['line end', 'gl'], ['line home', 'gh'],
  ['back word', 'b'], ['end word', 'e'], ['find char', 'f3'],
]) await step(name, seq);
checkEq('whole doc intact after motion torture', await texts(), ['n1', 'n2', 'n3', 'n4', 'n5']);

console.log('· phase 3: upward cut (v k k d) then immediate p — the reported bug');
await clickBullet('n4');
for (const [n, sq] of [['enter v-line','v'],['extend up','k'],['extend up again','k'],['cut upward selection','d']]) {
  await step(n, sq);
  console.log(`    after ${sq}: texts=${JSON.stringify(await texts())} :: ${(await dbg()).replace(/rx=\d+ done=\d+ /,'')}`);
}
checkEq('n2..n4 cut', await texts(), ['n1', 'n5']);
await step('paste immediately, no click', 'p');
checkEq('cut bullets restored', (await texts()).length, 5);

console.log('· phase 4: indent / outdent selections');
await resetEmpty();
await press('i'); await insertType('m1');
for (const t of ['m2', 'm3', 'm4']) { await keys('o'); await insertType(t); }
await clickBullet('m2');
await step('select two', 'vj');
await step('indent selection', '.');
{
  const m1 = await idOf('m1');
  checkEq('m2 under m1', await parentOf('m2'), m1);
  checkEq('m3 under m1', await parentOf('m3'), m1);
}
await step('post-indent motion works', 'j');
await clickBullet('m2');
await step('select two again', 'vj');
await step('outdent selection', ',');
checkEq('m2 back at top', (await parentOf('m2')) === (await idOf('m1')), false);

console.log('· phase 5: subtree cut/paste (parent with child)');
await clickBullet('m2');
await step('select m2 (vv = V-line)', 'vv');
await step('indent m2 under m1', '.');
await clickBullet('m1');
await step('cut m1 with its child', 'vvd');
checkEq('m1+child gone', (await texts()).includes('m2'), false);
await step('paste subtree back', 'p');
checkEq('m1 restored', (await texts()).includes('m1'), true);
checkEq('child m2 restored under m1', await parentOf('m2'), await idOf('m1'));

console.log('· phase 6: boundary deletes');
await resetEmpty();
await press('i'); await insertType('q1');
for (const t of ['q2', 'q3', 'q4']) { await keys('o'); await insertType(t); }
await clickBullet('q2');
await step('dd middle', 'dd');
await clickBullet('q1');
await step('dd first bullet', 'dd');
const t7 = (await texts()).filter(Boolean);
await clickBullet(t7[t7.length - 1]);
await step('dd last bullet', 'dd');
for (let i = 0; i < 4; i++) {
  const t = (await texts()).filter(Boolean);
  if (!t.length) break;
  await clickBullet(t[0]);
  await step('dd remaining (incl. only-bullet clear)', 'dd');
}

console.log('· phase 7: empty-line safety + o/esc');
await resetEmpty();
for (const [name, seq] of [
  ['x on empty', 'x'], ['dw on empty', 'dw'], ['daw on empty', 'daw'],
  ['gl on empty', 'gl'], ['v-line on empty', 'v'], ['escape', '<esc>'],
]) await step(name, seq);
await step('o on empty', 'o');
await insertType('solo');
await step('cut solo', 'dd');

console.log('· phase 8: command line + scroll');
await resetEmpty();
await step('open cmdline', ';');
await step('type w', 'w');
await step('run :w', '<cr>');
await step('open cmdline again', ';');
await step('cancel', '<esc>');
await step('half page down', '<c-d>');
await step('half page up', '<c-u>');
await step('line down', '<c-e>');
await step('line up', '<c-y>');

console.log('· phase 9: rapid mixed sequence (no assertions, must not wedge)');
await resetEmpty();
await press('i'); await insertType('the quick brown fox jumps');
await step('rapid torture', '0wwxbxellxhhx3lxu');
await step('rapid ops', 'dwdeuu');
await step('final undo storm', 'uuu');
await step('cleanup', 'dd');
await resetEmpty();

// ---------------------------------------------------------------- report
console.log(`\nSTRESS RESULT: ${pass}/${steps} steps OK, ${violations.length} violations`);
if (violations.length) {
  for (const v of violations) console.log('  ' + JSON.stringify(v));
}
await browser.close().catch(() => {});
process.exit(violations.length ? 1 : 0);
