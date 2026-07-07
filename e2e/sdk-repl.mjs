// REPL against the vim plugin's SDK instance inside the sandboxed iframe.
// Usage: node sdk-repl.mjs '<async JS body using `a` (adapter) and `p` (plugin)>'
import WebSocket from '../node_modules/ws/index.js';

const body = process.argv[2];
const port = process.env.REMNOTE_CDP_PORT ?? '9223';
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const t = list.find((x) => /localhost:8080/.test(x.url));
if (!t) {
  console.error('plugin iframe target not found');
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
    const a = globalThis.__vimAdapter;
    if (!a) return 'NO __vimAdapter';
    const p = a.plugin;
    ${body}
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log(
  r.result?.result?.value !== undefined
    ? typeof r.result.result.value === 'string'
      ? r.result.result.value
      : JSON.stringify(r.result.result.value, null, 1)
    : JSON.stringify(r.result ?? r, null, 1)
);
ws.close();
