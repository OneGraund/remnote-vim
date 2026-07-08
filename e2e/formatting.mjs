#!/usr/bin/env node
// Live verification of the 2026-07-08 stability fixes on FORMATTED lines:
// unit-space flatten (references/atomics = 2 units), stop-based caret deltas,
// code-point edits (emoji), and the insert-exit settle read.
//
// Builds its own fixtures in today's Daily Document (a reference chip line,
// an emoji line, a plain line), drives real CDP keystrokes, asserts on the
// data layer, and removes the fixtures afterwards. Requires the launch.sh
// instance on CDP 9223 with the dev plugin loaded (same prereqs as run.mjs).
//
//   REMNOTE_CDP_PORT=9223 node e2e/formatting.mjs   # expect 5/5 ✓
import { chromium } from 'playwright-core';
import WebSocket from '../node_modules/ws/index.js';

const PORT = process.env.REMNOTE_CDP_PORT ?? '9223';
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((x) => /localhost:8080/.test(x.url));
if (!t) { console.error('plugin iframe target not found'); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
const send = (method, params) => new Promise((res) => {
  const id = Math.floor(Math.random() * 1e6);
  const h = (d) => { const m = JSON.parse(d); if (m.id === id) { ws.off('message', h); res(m); } };
  ws.on('message', h);
  ws.send(JSON.stringify({ id, method, params }));
});
async function sdk(body) {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { const a = globalThis.__vimAdapter; const p = a.plugin; ${body} })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

const pages = browser.contexts().flatMap((c) => c.pages()).filter((p) => !/^devtools|^chrome-extension/.test(p.url()));
let page = null;
for (let i = 0; i < 30 && !page; i++) {
  for (const p of pages) {
    if (await p.evaluate(() => typeof window.currentFocusedRem !== 'undefined').catch(() => false)) { page = p; break; }
  }
  if (!page) await new Promise((r) => setTimeout(r, 1000));
}
if (!page) { console.error('no app page'); process.exit(1); }
await page.evaluate(() => document.querySelector('.rn-editor-container')?.classList.remove('pointer-events-none'));
await page.bringToFront();
try { await page.getByText('Not Now', { exact: true }).click({ timeout: 1500 }); } catch {}

const wait = (ms) => page.waitForTimeout(ms);
const dbg = () => page.evaluate(() => getComputedStyle(document.body, '::before').content.replace(/\\?"/g, ''));
const badge = () => page.evaluate(() => getComputedStyle(document.body, '::after').content.replace(/\\?"/g, ''));
async function waitIdle(timeout = 6000) {
  const start = Date.now();
  let stable = 0, last = -1;
  while (Date.now() - start < timeout) {
    const m = (await dbg()).match(/rx=(\d+) done=(\d+)/);
    const rx = m ? +m[1] : 0, done = m ? +m[2] : -1;
    if (rx === done && done === last) { if (++stable >= 2) return; } else stable = 0;
    last = done;
    await wait(60);
  }
}
async function waitMode(target, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await badge()).includes(target)) return;
    await wait(60);
  }
}
async function keys(seq, delay = 60) {
  for (const k of seq) {
    await page.keyboard.press(k === ' ' ? 'Space' : k, { delay: 10 });
    await wait(delay);
  }
  await waitIdle();
  await wait(300);
}

async function clickRem(id) {
  for (let i = 0; i < 20; i++) {
    const rect = await page.evaluate((remId) => {
      for (const c of document.querySelectorAll('.EditorContainer')) {
        const rid = c.closest('[data-rem-id]')?.getAttribute('data-rem-id');
        if (rid !== remId) continue;
        const r = c.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        return { x: r.x + Math.min(25, r.width / 2 + 5), y: r.y + r.height / 2 };
      }
      return null;
    }, id);
    if (rect) {
      await page.mouse.click(rect.x, rect.y);
      await wait(500);
      const focused = await sdk(`return (await p.focus.getFocusedRem())?._id;`);
      if (focused === id) return;
    }
    await wait(400);
  }
  throw new Error(`could not focus rem ${id}`);
}

const flat = (rich) => (rich ?? []).map((x) => (typeof x === 'string' ? x : x.i === 'm' ? (x.text ?? '') : '¤')).join('');
const readRem = async (id) => flat(await sdk(`const r = await p.rem.findOne("${id}"); return r?.text;`));

const results = [];
const check = (name, got, want) => {
  const ok = got === want;
  results.push(`${ok ? '✓' : '✗'} ${name}: got ${JSON.stringify(got)}${ok ? '' : ` want ${JSON.stringify(want)}`}`);
  return ok;
};

let ids = null;
try {
  ids = await sdk(`
    const target = await p.rem.createRem();
    await target.setText(["referenced-name"]);
    const daily = await p.date.getTodaysDoc();
    const mk = async (rich) => {
      const r = await p.rem.createRem();
      await r.setText(rich);
      await r.setParent(daily, 0);
      return r._id;
    };
    const plain = await mk(["abc"]);
    const emojiLine = await mk(["x\\u{1F600}y"]);
    const refLine2 = await mk(["pre ", {i:"q", _id: target._id}, " tail more"]);
    const refLine = await mk(["see ", {i:"q", _id: target._id}, " end"]);
    return { target: target._id, refLine, refLine2, emojiLine, plain };
  `);
  await wait(1500);

  // ---- 1. append at EOL on a chip line (ga + type + Esc) ----
  await clickRem(ids.refLine);
  await keys(['0']);
  await keys(['g', 'a']);
  await waitMode('INSERT');
  await wait(700); // key release settle before native typing
  await page.keyboard.type('Z', { delay: 40 });
  await wait(200);
  await page.keyboard.press('Escape');
  await waitIdle();
  await wait(600);
  check('ga appends at the TRUE end of a chip line', await readRem(ids.refLine), 'see ¤ endZ');

  // ---- 2. w lands on the chip; x deletes the WHOLE chip ----
  await keys(['0', 'w', 'x']);
  await wait(500);
  check('0 w x deletes exactly the chip', await readRem(ids.refLine), 'see  endZ');

  // ---- 3. offsets far right of a chip stay exact (f + dw) ----
  await clickRem(ids.refLine2);
  await keys(['0']);
  await keys(['f', 'm']);
  await keys(['d', 'w']);
  await wait(500);
  check('fm dw after a chip hits the right chars', await readRem(ids.refLine2), 'pre ¤ tail m');

  // ---- 4. emoji: l is one step, x deletes the whole pair ----
  await clickRem(ids.emojiLine);
  await keys(['0', 'l', 'x']);
  await wait(500);
  check('0 l x deletes the whole emoji', await readRem(ids.emojiLine), 'xy');

  // ---- 5. fast type + immediate Escape: model must not truncate ----
  await clickRem(ids.plain);
  await keys(['0']);
  await keys(['g', 'a']);
  await waitMode('INSERT');
  await wait(700);
  await page.keyboard.type('hello', { delay: 15 });
  await page.keyboard.press('Escape'); // immediately — no settle
  await waitIdle();
  await wait(400);
  await keys(['h', 'x']);
  await wait(500);
  check('fast type + instant Esc + h x lands on the right char', await readRem(ids.plain), 'abchell');
} catch (e) {
  results.push(`✗ ERROR: ${String(e)}`);
} finally {
  if (ids) {
    try {
      await sdk(`
        for (const id of ${JSON.stringify(Object.values(ids))}) {
          const r = await p.rem.findOne(id);
          if (r) await r.remove();
        }
        return "cleaned";
      `);
    } catch {}
  }
  console.log(results.join('\n'));
  ws.close();
  await browser.close();
}
