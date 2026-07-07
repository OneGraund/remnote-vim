# Companion-service design notes (thinking only — nothing here is implemented)

The plugin has hit four hard walls that no amount of in-sandbox cleverness
removes (DEVELOPMENT.md §9): shift-blind key stealing, an unreadable
collapsed caret, no view-scroll API, and second-class clipboard access from
an unfocused sandbox iframe. This document thinks through whether a local
background service could lift them, what it would look like, and whether it
is worth the cost. **Requested as design-only; do not implement from this
document without an explicit decision.**

## The one-line pitch

The e2e harness already proves the approach: a process attached to RemNote
over the Chrome DevTools Protocol (CDP) has full host-page access — real DOM
selections, real key events with modifier state, real scrolling, native
clipboard. A small always-on daemon doing exactly what `e2e/ctl.mjs` does,
plus a WebSocket bridge to the plugin, turns every "impossible" item into a
feature.

## What it would unlock, concretely

| Sandbox limitation | With a CDP companion |
|---|---|
| Shift-blindness → synonym table (`gl`=`$`, `ge`=`G`, `vv`=`V`) | A capture-phase `keydown` listener in the host page sees `key`, `shiftKey`, `ctrlKey` exactly. Real `$ ^ V G A O ~ : > <` become bindable; the synonym table becomes an optional fallback. |
| Collapsed caret unreadable → column desync after mouse clicks | Host-page `getSelection()` reads the caret directly; push `{caret}` events to the plugin on every selectionchange. The model never desyncs again. |
| No view scrolling → Ctrl-E/Ctrl-Y removed | `scroller.scrollBy(0, dy)` on the editor scroll container. True vim scroll (view moves, cursor stays). |
| Clipboard writes may be blocked in the unfocused iframe | The service process writes the OS clipboard itself (`wl-copy` on this machine, or CDP `Browser.setPermission` + host-page `navigator.clipboard`). Deterministic, no fallback tiers. *Update 2026-07-07: mostly solved in-sandbox — whole-rem yanks now ride `selectRem`+`editor.copy()` with pane-refocus caret recovery (DEVELOPMENT.md §9), so the daemon's clipboard value shrinks to exotic cases (yank without any native op, custom formats).* |
| `/` opens RemNote's own slash menu only for the focused bullet | The service can synthesize real key events (`Input.dispatchKeyEvent`) — or the plugin keeps its own `:`-command palette and the service just supplies real keys. |

## Architecture sketch (option A — recommended shape *if* this is ever built)

```
┌─────────────────────────── RemNote (Electron) ───────────────────────────┐
│  host page  ←— injected observer script (keys, caret, scroll targets)    │
│  plugin sandbox iframe (this repo) —— ws://127.0.0.1:PORT ——┐            │
└──────────────────────────────△──────────────────────────────│────────────┘
                               │ CDP (127.0.0.1:9222)          │ WebSocket
                        ┌──────┴──────────────────────────────▽─────┐
                        │   companion daemon (systemd --user unit)  │
                        └────────────────────────────────────────────┘
```

- **Attach**: RemNote must be launched with `--remote-debugging-port=9222`
  (a `.desktop` file edit — same flag the e2e harness uses). The daemon
  attaches with `playwright-core` (already a devDependency here) or plain
  `chrome-remote-interface`. Python (`websockets` + `pychrome`) works
  equally well; the language matters less than the protocol. Reusing
  playwright-core keeps one stack and lets the daemon share helpers with
  `e2e/*.mjs`.
- **Host-side observer**: one injected script (via `Runtime.evaluate` /
  `Page.addScriptToEvaluateOnNewDocument`) that (a) listens to `keydown` in
  the capture phase, (b) mirrors `selectionchange` caret offsets, and (c)
  exposes `scrollBy`/clipboard verbs. When the vim plugin asks for a key to
  be "really stolen", the observer calls `preventDefault()+stopPropagation()`
  — this out-steals RemNote's own stealer, with full shift fidelity.
- **Plugin bridge**: the sandbox iframe opens `ws://127.0.0.1:PORT` (needs a
  one-time live check that RemNote's iframe CSP allows localhost WebSockets;
  nothing in the SDK forbids it). Protocol sketch:
  - service → plugin: `{t:'key', key:'$', shift:true, ctrl:false}`,
    `{t:'caret', offset:14}`
  - plugin → service: `{t:'steal', keys:[...]}`, `{t:'scroll', lines:±n}`,
    `{t:'copy', text}`, `{t:'ping'}`
- **Graceful degradation is non-negotiable**: the plugin must feature-detect
  the daemon (ping at startup, retry lazily) and run exactly as today when
  it is absent. The service is an enhancer, never a dependency — otherwise
  the plugin becomes uninstallable for anyone but this machine.

## Alternatives considered (and why they lose)

- **B. keyd/evdev remapping layer** (this machine already runs keyd): remap
  shifted keys to unshifted chords system-wide or per keyd profile. Fixes
  *only* the shift problem, has no idea which app or vim-mode is focused
  (would need a niri-IPC watcher feeding keyd application rules), and
  corrupts typing everywhere else the moment the focus heuristic is wrong.
  High blast radius, tiny win compared to A.
- **C. `requestNative: true`**: the clean, intended path — but RemNote
  hard-disables native plugins in current builds (`isNative: !O && …`,
  "REJECT IF TRUE FOR NOW"). Worth re-testing on each RemNote release; if it
  ever ships, `src/adapter/domCaret.ts` already contains the caret half and
  most of this document becomes unnecessary.
- **D. Patching app.asar** (inject a preload bridging host ↔ plugin):
  maximal power, zero extra processes at runtime — but it modifies the
  installed app, breaks on every update, and is the kind of thing that gets
  accounts flagged. Not worth it for an editor nicety.

## Costs and risks of option A (the honest part)

1. **Security**: an open CDP port is remote-code-execution-as-you on the
   whole RemNote app (notes, session, cookies) for *any* local process, not
   just our daemon. Localhost-only softens but does not remove this (any
   userspace malware is local). This must be an explicit opt-in with the
   trade-off documented, never a default.
2. **Fragility**: the observer script depends on RemNote's DOM (scroll
   container selector, editor classes). Every RemNote update can break it —
   the plugin API is versioned, the DOM is not. The e2e suite would need a
   "companion contract" test layer to catch this.
3. **Operational surface**: a daemon (systemd user unit), a launch flag, a
   port — three more things to install, document, and debug ("vim keys act
   weird" now has two suspects). For dotfiles integration that's manageable
   *for this machine*, but it forks the plugin into "plain" and "companion"
   behavior matrices to test.
4. **Latency**: key → CDP event → daemon → WebSocket → plugin → SDK call is
   two extra IPC hops (~1–5 ms each). Fine for commands; would need care if
   the daemon ever sat in the hot path of *every* keystroke (it shouldn't —
   keep RemNote's stealKeys as the transport for keys it can see correctly,
   and use the daemon only for the shift-sensitive ones and caret events).

## If it ever goes ahead: staged plan (smallest useful slice first)

1. **Caret mirror only** (read-only, no key handling): daemon pushes caret
   offsets; plugin drops the click-desync limitation. Lowest risk, validates
   the bridge end-to-end.
2. **Clipboard verb**: replaces the three-tier fallback with one native call.
3. **Scroll verb**: restore Ctrl-E/Ctrl-Y as true scrolling.
4. **Shift-faithful key layer**: real `$`, `V`, `:` … retire the synonym
   table by default, keep it as the no-daemon fallback.

Each stage independently useful, independently revertible, and the plugin
stays fully functional at every stage with the daemon off.

## Verdict

Technically sound and already 80 % proven by the e2e infrastructure, but it
buys polish, not capability the current plugin lacks entirely — every
blocked item now has a workable synonym or fallback. Recommendation: park
this until either (a) the click-desync/caret issue becomes a daily
irritation, or (b) RemNote ships native plugins (option C), which would
obsolete most of the daemon. Re-evaluate after filing the upstream issues
about shift-blind `stealKeys` and native-plugin availability — a fix on
their side is strictly better than any of this.
