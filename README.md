# remnote-vim

Modal, vim-style editing for the RemNote desktop app, as a RemNote plugin.

See **[VIM_STATUS.md](./VIM_STATUS.md)** for exactly what works today, what's
blocked, and what's planned. See **[DEVELOPMENT.md](./DEVELOPMENT.md)** for
the architecture deep-dive: how to add new commands, debug live issues, and
run the full test suite.

## Layout

```
src/engine/     pure vim state machine (no RemNote) — the tested core
src/adapter/    engine ⇄ RemNote plugin API (key stealing, editor ops, model)
src/widgets/    plugin entry point (onActivate)
tests/          Vitest unit suite for the engine (84 tests)
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

Two layers (see VIM_STATUS.md §5 for why):

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

## Build a distributable zip

```bash
npm run build        # → PluginZip.zip
```
