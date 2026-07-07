# remnote-vim

Modal, vim-style editing for the RemNote desktop app, as a RemNote plugin.

See **[DEVELOPMENT.md](./DEVELOPMENT.md)** for everything: the work log,
what works today (§0.5), platform blockers (§9), the architecture deep-dive,
how to add new commands, debug live issues, and run the full test suite.

## Layout

```
src/engine/     pure vim state machine (no RemNote) — the tested core
src/adapter/    engine ⇄ RemNote plugin API (key stealing, editor ops, model)
src/widgets/    plugin entry point (onActivate)
tests/          Vitest unit suite for the engine
e2e/            live end-to-end harness driving the real app over CDP
public/         manifest.json
```

## Develop

```bash
npm install
npm run dev          # webpack-dev-server on http://localhost:8080
```

Then in RemNote: **Settings → Plugins → Build → Develop from localhost**, enter
`http://localhost:8080/`, click **Develop**, and make sure the "Vim Mode" toggle
is on. A `-- NORMAL --` badge appears bottom-right when it's active.

Toggle the whole thing on/off from the command palette: **"Vim: Toggle vim mode"**.
Built-in cheat sheet for vim newcomers: type `;help` (vim's `:help`) or run
**"Vim: Help / cheat sheet"** from the command palette.

## Test

Two layers (see DEVELOPMENT.md §7 for why):

```bash
npm test             # engine unit tests (Vitest) — fast, deterministic, no RemNote
npm run e2e          # live end-to-end against a running RemNote (see below)
```

The live harness needs RemNote running with a debug port and today's Daily
Document open. `e2e/launch.sh` starts an instance with the flag:

```bash
REMNOTE_APPIMAGE=/path/to/RemNote.AppImage ./e2e/launch.sh   # or just ./e2e/launch.sh to auto-find
REMNOTE_CDP_PORT=9222 npm run e2e
```

It types real keystrokes into one scratch bullet and checks the resulting Rem
text via RemNote's own read-only data API, then cleans up after itself.

`e2e/ctl.mjs` is a small manual CDP remote (`node e2e/ctl.mjs shot out.png`,
`… eval '<js>'`, `… key 'j j x'`) handy for poking at the running app.
`e2e/sdk-repl.mjs` runs async JS inside the plugin sandbox with the live
adapter (`a`) and SDK (`p`) in scope — see DEVELOPMENT.md §7.

## Build a distributable zip

```bash
npm run build        # → PluginZip.zip
```
