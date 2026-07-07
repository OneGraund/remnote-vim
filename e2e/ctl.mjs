#!/usr/bin/env node
// Small CDP remote control for the e2e RemNote instance.
//
//   node e2e/ctl.mjs pages
//   node e2e/ctl.mjs shot /path/out.png
//   node e2e/ctl.mjs eval 'document.title'
//   node e2e/ctl.mjs click 'selector'
//   node e2e/ctl.mjs type 'text'
//   node e2e/ctl.mjs key 'Enter Escape j j'
import { chromium } from 'playwright-core';

const [, , cmd, ...rest] = process.argv;
const arg = rest.join(' ');
const port = process.env.REMNOTE_CDP_PORT ?? '9223';

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page =
    pages.find((p) => !/^devtools|^chrome-extension/.test(p.url())) ?? pages[0];
  if (!page) throw new Error('no pages');

  switch (cmd) {
    case 'pages':
      console.log(pages.map((p) => `${p.url()}`).join('\n'));
      break;
    case 'shot': {
      const path = arg || 'shot.png';
      await page.screenshot({ path });
      console.log('saved', path);
      break;
    }
    case 'eval': {
      const result = await page.evaluate(arg);
      console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1));
      break;
    }
    case 'click':
      await page.click(arg, { timeout: 5000 });
      console.log('clicked');
      break;
    case 'type':
      await page.keyboard.type(arg, { delay: 30 });
      console.log('typed');
      break;
    case 'key':
      for (const k of arg.split(' ')) {
        await page.keyboard.press(k, { delay: 30 });
      }
      console.log('pressed');
      break;
    default:
      console.error('unknown command', cmd);
      process.exitCode = 1;
  }
} finally {
  await browser.close();
}
