// REPL against the MAIN RemNote window (the host page, not the plugin
// sandbox — for that see sdk-repl.mjs). Async JS body; `pm` is the live
// plugin manager when available.
// Usage: REMNOTE_CDP_PORT=9223 node e2e/main-repl.mjs '<async JS body>'
import WebSocket from '../node_modules/ws/index.js';

const body = process.argv[2];
const port = process.env.REMNOTE_CDP_PORT ?? '9223';
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const t = list.find(
  (x) => x.type === 'page' && !/^devtools|^chrome-extension/.test(x.url) && !/localhost:8080/.test(x.url)
);
if (!t) {
  console.error('main window target not found');
  process.exit(1);
}
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
const send = (method, params) =>
  new Promise((res) => {
    const id = Math.floor(Math.random() * 1e6);
    const h = (d) => {
      const m = JSON.parse(d);
      if (m.id === id) {
        ws.off('message', h);
        res(m);
      }
    };
    ws.on('message', h);
    ws.send(JSON.stringify({ id, method, params }));
  });

const r = await send('Runtime.evaluate', {
  expression: `(async () => {
    const pm = window.getPluginManager ? window.getPluginManager() : undefined;
    ${body}
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
if (r.result?.exceptionDetails) {
  console.error(JSON.stringify(r.result.exceptionDetails, null, 2));
} else {
  console.log(JSON.stringify(r.result?.result?.value, null, 2));
}
ws.close();
