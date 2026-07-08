// REAL-input key-delivery test.
//
// The CDP suites synthesize input inside the renderer, which BYPASSES the
// Electron/main-process layer — a chord the desktop app eats up there (real
// Ctrl+W!) still looks green over CDP. This script sends kernel-level uinput
// events via ydotool (identical path to a physical keyboard: kernel →
// compositor → app) and asserts on what actually arrives at the plugin's key
// steal, read through the debug badge.
//
// Requirements:
//   - ydotoold running (`systemctl --user start ydotool`) and $YDOTOOL_SOCKET
//     (defaults to /run/user/1000/.ydotool_socket)
//   - the e2e RemNote window FOCUSED in the compositor (real keys go to the
//     focused window) — the script verifies via document.hasFocus() and aborts
//     rather than typing into whatever else is focused
//   - dev plugin loaded, normal mode (same as the other suites)
//
//   REMNOTE_CDP_PORT=9223 node e2e/real-input.mjs
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const port = process.env.REMNOTE_CDP_PORT ?? '9223';
const sock =
  process.env.YDOTOOL_SOCKET ?? `/run/user/${process.getuid()}/.ydotool_socket`;

// Linux input event codes (see input-event-codes.h).
const KEY = { ctrl: 29, w: 17, h: 35, l: 38, escape: 1 };

function realKey(codes) {
  // codes: array like [[29,1],[35,1],[35,0],[29,0]]
  execFileSync('ydotool', ['key', ...codes.map(([c, v]) => `${c}:${v}`)], {
    env: { ...process.env, YDOTOOL_SOCKET: sock },
  });
}
const chord = (mod, key) => [
  [mod, 1],
  [key, 1],
  [key, 0],
  [mod, 0],
];
const tap = (key) => [
  [key, 1],
  [key, 0],
];

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => !/^devtools|^chrome-extension/.test(p.url()));
if (!page) throw new Error('no RemNote page on CDP port ' + port);

const badge = async () => {
  const raw = await page.evaluate(
    () => getComputedStyle(document.body, '::before').content
  );
  const m = /rx=(\d+) done=(\d+) k=(\S+)/.exec(raw);
  if (!m) throw new Error('vim badge not found — is the plugin loaded? ' + raw);
  return { rx: Number(m[1]), done: Number(m[2]), k: m[3] };
};

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// -- preconditions ---------------------------------------------------------
if (!(await page.evaluate(() => document.hasFocus()))) {
  console.error(
    'ABORT: the RemNote window is not focused in the compositor.\n' +
      'Real keys would land in another app. Focus the e2e RemNote window and rerun.'
  );
  await browser.close();
  process.exit(2);
}
await badge(); // throws early if the plugin is missing

// Make sure we are in normal mode (a real Escape is fine: we steal it, and
// even if insert mode was active it exits to normal).
realKey(tap(KEY.escape));
await page.waitForTimeout(400);

// -- 1. plain key delivery ---------------------------------------------------
let b0 = await badge();
realKey(tap(KEY.h));
await page.waitForTimeout(500);
let b1 = await badge();
check('real `h` reaches the key steal', b1.rx === b0.rx + 1, `k=${b1.k}`);

// -- 2. ctrl-chord delivery (the class CDP tests are blind to) ---------------
b0 = await badge();
realKey(chord(KEY.ctrl, KEY.h));
await page.waitForTimeout(500);
b1 = await badge();
check('real Ctrl+H reaches the key steal', b1.rx === b0.rx + 1, `k=${b1.k}`);

b0 = await badge();
realKey(chord(KEY.ctrl, KEY.l));
await page.waitForTimeout(500);
b1 = await badge();
check('real Ctrl+L reaches the key steal', b1.rx === b0.rx + 1, `k=${b1.k}`);

// -- 3. document the Ctrl+W platform hole ------------------------------------
b0 = await badge();
realKey(chord(KEY.ctrl, KEY.w));
await page.waitForTimeout(500);
b1 = await badge();
if (b1.rx === b0.rx) {
  console.log(
    '  · real Ctrl+W did NOT arrive (known desktop-Electron behavior; C-h/C-l are the reachable pane keys)'
  );
} else {
  console.log(
    `  ! real Ctrl+W ARRIVED (k=${b1.k}) — platform changed, C-w chord is usable here; update DEVELOPMENT.md §9`
  );
  // swallow the pending pane-chord state it created
  realKey(tap(KEY.escape));
  await page.waitForTimeout(300);
}

// -- 4. handler completeness: nothing wedged ---------------------------------
const bEnd = await badge();
check('rx == done (no stuck handler)', bEnd.rx === bEnd.done, `rx=${bEnd.rx} done=${bEnd.done}`);

await browser.close();
console.log(`\nREAL-INPUT RESULT: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
