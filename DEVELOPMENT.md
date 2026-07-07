# Developer Guide

This is the deep-dive companion to [README.md](./README.md) (quick start) and
[VIM_STATUS.md](./VIM_STATUS.md) (feature/blocker tracking). Read this when
you're about to write code: it explains *how the pieces fit together* and
gives concrete recipes for extending or debugging the plugin. Written for
both human contributors and future Claude Code instances picking this repo
back up cold.

## 1. Mental model

The whole plugin is built around one idea: **keep the part that has to be
correct (vim semantics) completely separate from the part that has to talk to
RemNote (which is slow, async, and full of platform quirks).**

```
keystroke → adapter (RemNote-facing) → engine (pure) → Action[] → adapter executes them
            src/adapter/adapter.ts     src/engine/       against RemNote's plugin API
```

- **`src/engine/`** is a synchronous, pure function: `(VimState, key, {text,
  caret}) → (VimState, Action[])`. It has never heard of RemNote. It doesn't
  know what a "Rem" is, doesn't await anything, doesn't touch the DOM. This is
  what makes it exhaustively unit-testable and safe to reason about in
  isolation — `tests/engine.test.ts` drives it directly.
- **`src/adapter/adapter.ts`** (`VimAdapter`) is the only thing that touches
  the RemNote plugin SDK. It receives raw stolen keys, translates them to
  engine symbols, feeds them to `handleKey`, and executes the returned
  `Action`s one at a time against the RemNote API (`editor.moveCaret`,
  `rem.createRem`, etc). It also owns a **local model** of the focused line's
  text/caret, because RemNote's own read APIs lag a keystroke behind
  programmatic edits (see §6).
- **`src/widgets/`** is the RemNote plugin entry point (`index.tsx`,
  `onActivate`) plus the `:help` floating-widget UI (`vim_help.tsx`).

If you're adding a new vim *behavior* (a motion, an operator, a new mode
transition), it almost always belongs in `src/engine/`, tested with the
`Harness` fake editor, with zero RemNote involvement. If you're adding a new
way to talk to RemNote (a new `Action` case, a new SDK call), that's
`src/adapter/adapter.ts`. Keep that boundary — it's the whole reason this
codebase is testable.

## 2. Repository map

| Path | What it is |
|---|---|
| `src/engine/types.ts` | `VimState`, `Action` (the full vocabulary of things the adapter can be asked to do), `Mode`, `Pending`, `Register` |
| `src/engine/engine.ts` | `handleKey()` — the state machine. One `handleX` function per mode (`handleNormal`, `handleInsert`, `handleVisual`, `handleVisualLine`, `handleCommand`) |
| `src/engine/motions.ts` | Pure text math: `nextWordStart`, `wordEnd`, `findChar`, `wordObject`, etc. No engine state, just `(string, offset) → offset` |
| `src/adapter/adapter.ts` | `VimAdapter` — key stealing, the local line model, `exec()` (Action → SDK calls), visual-line selection trail, Ex commands, the debug/mode badge |
| `src/adapter/keymap.ts` | Which key specs to steal from RemNote per mode, and the spec→engine-symbol table (`SPEC_TO_SYM`) |
| `src/adapter/domCaret.ts` | Direct DOM caret read/write — only reachable when `requestNative: true` actually works (currently doesn't, see §9) |
| `src/widgets/index.tsx` | Plugin `onActivate`: registers commands/settings, constructs `VimAdapter`, exposes `window.__vim` for e2e |
| `src/widgets/vim_help.tsx` | The `:help` cheat-sheet floating widget |
| `tests/harness.ts` | `Harness` — a fake multi-line/multi-indent "editor" that executes `Action`s the same way the real adapter does, for unit tests |
| `tests/engine.test.ts` | Vitest suite driving `Harness` with key sequences |
| `e2e/run.mjs` | Live smoke test over CDP against a real running RemNote — narrative style, asserts on Rem text |
| `e2e/stress.mjs` | Live stress test — long key sequences with a **focus-alive invariant checked after every keystroke** |
| `e2e/tree.mjs` | Live precision test for nested-hierarchy visual-line selection (tint + data + focus, screenshots archived) |
| `e2e/ctl.mjs` | Manual CDP remote for poking at a running instance (`shot`, `eval`, `click`, `type`, `key`) |
| `e2e/launch.sh` | Launches an isolated RemNote AppImage instance (scratch `$HOME`, its own CDP port) for e2e |
| `public/manifest.json` | RemNote plugin manifest (id, permissions, `requestNative`) |
| `webpack.config.js` | Builds every `src/widgets/**/*.tsx` twice (module + sandboxed-iframe variant); see comments for why |

## 3. Running the plugin locally

```bash
npm install
npm run dev          # webpack-dev-server on http://localhost:8080, no HMR (see below)
```

In the RemNote desktop app: **Settings → Plugins → Build → Develop from
localhost**, enter `http://localhost:8080/`, click **Develop**. Confirm the
"Vim Mode" toggle is on in plugin settings. A `-- NORMAL --` badge should
appear bottom-right — that's your signal the plugin loaded and is active.

There is **no hot reload** (`hot`/`liveReload` are explicitly off in
`webpack.config.js` — RemNote's sandboxed-iframe loading doesn't play well
with webpack's dev-server client). After changing code you must reload the
plugin from RemNote's UI (or reload the whole RemNote window) to pick up new
JS. `npm run dev` just serves the freshly-built files; it doesn't push
updates.

Toggle the plugin on/off at runtime with the command palette action **"Vim:
Toggle vim mode"** (`vim-toggle` in `src/widgets/index.tsx`), and open the
cheat sheet with **"Vim: Help / cheat sheet"** or by typing `;help` inside the
app.

## 4. Reading the debug badge

`VimAdapter.render()` (`src/adapter/adapter.ts:988`) draws two fixed-position
overlays via injected CSS — no devtools needed to see plugin state:

- **Bottom-right** (`body::after`): the mode badge, e.g. `-- NORMAL --`, or
  the live `:command` text while typing an Ex command.
- **Bottom-left** (`body::before`): `vim <mode> rx=<n> done=<n> k=<spec>
  <vTrail debug>` — `rx` is keys received from RemNote's steal event, `done`
  is keys the adapter has fully finished processing (including all resulting
  `exec()` calls). **If `rx !== done` and stays that way, a key handler is
  stuck** — check for an unresolved promise in `exec()`. The e2e scripts poll
  this exact string (`waitIdle()` in `run.mjs`/`stress.mjs`) to know when it's
  safe to read state.

Since it's just CSS `content`, you can read it from a real DevTools console
attached to the page (`getComputedStyle(document.body, '::before').content`)
or via `e2e/ctl.mjs eval '...'` against a CDP-attached instance.

## 5. Working in the engine (`src/engine/`)

### The dispatch shape

`handleKey(state, key, snap)` switches on `state.mode` to one handler per
mode. Each handler returns `{ state, actions }`. Keys are **engine symbols**,
not raw browser events: single characters (`'a'`, `'$'`, `' '`), or named
tokens (`'Escape'`, `'Enter'`, `'Backspace'`, `'C-r'`, `'C-d'`, ...) — see
`src/adapter/keymap.ts` for the full symbol table the adapter produces.

Useful helpers already in `engine.ts` — reuse these instead of hand-rolling:
- `reset(state, actions)` — clear count/op/pending, return unchanged mode
- `toMode(state, mode, actions)` — same, but also switches `mode` and emits
  an `{ t: 'mode', mode }` action (the adapter reacts to mode changes: key
  re-stealing, insert-mode caret sync, etc — always go through `toMode`
  rather than hand-setting `state.mode`)
- `countOf(state)` — combines a pending count with an operator's count
  (`2d3w` → 6)
- `motionFor(state, key, snap, head)` — tries to interpret `key` as a motion
  in the current context; returns `null` if it isn't one. Both `handleNormal`
  and `handleVisual` call this so motions behave consistently across modes.

### Recipe: add a new normal-mode motion

1. Implement the pure text math in `motions.ts` if it's non-trivial (pattern:
   `(text: string, caret: number, ...) => number` or `MotionResult`).
2. Add a `case` to `motionFor()` in `engine.ts` returning `simple(target)` (or
   `{ result: { target, landsOn } }` directly for inclusive motions like `e`
   or `f`). `landsOn: true` means the motion conceptually lands *on* a
   character (used by visual mode to include that character in the
   selection) — see the doc comment on `MotionResult` in `motions.ts`.
3. That's it — because `motionFor` is shared, the new motion automatically
   works standalone (`{key}`), as an operator target (`d{key}`), and inside
   visual mode. Add a unit test in `tests/engine.test.ts` covering all three.

### Recipe: add a new simple normal-mode command (no motion)

Add a `case` to the big `switch (key)` at the bottom of `handleNormal()`
(engine.ts:270+). Look at neighboring cases for the pattern: mutate via
`withCharRegister`/`reset`/`toMode`, return the `Action[]` to emit. If it's a
Rem-structural operation (new register kind, new bullet, indent, etc.), you
likely need a **new `Action` variant** first — see below.

### Recipe: add a new `Action` (new capability the adapter must execute)

1. Add the variant to the `Action` union in `types.ts`, with a doc comment
   explaining semantics — this type is the contract between engine and
   adapter, and both `VimAdapter.exec()` and `Harness.exec()` must implement
   every case (TypeScript's exhaustiveness won't catch a missing `case` in a
   `switch` without a `default`, so grep for `a.t` usages after adding one).
2. Implement the real behavior in `VimAdapter.exec()` (`adapter.ts`).
3. Implement the fake-editor behavior in `Harness.exec()` (`tests/harness.ts`)
   — this is what makes it unit-testable. Keep it a faithful *model*, not
   copy of the real implementation (e.g. `Harness` models Rems as
   `lines`/`indents` arrays, not real tree objects).
4. If the action mutates the document, add its `t` to the `MUTATING` set in
   `harness.ts` so undo/redo snapshots correctly in tests.
5. If the action changes the focused line's text/caret in a way `updateModel`
   in `adapter.ts` needs to track (or invalidates it entirely), add a case
   there too (see §6).

### Recipe: add a new Ex command (`:foo`)

Add a case to the `switch (verb)` in `VimAdapter.runEx()` (adapter.ts:658).
Verbs are matched **case-insensitively** — capitals are unreachable live (see
§9), so `:Ex` arrives as `ex`. No engine changes needed; `runEx` is a leaf
action (`{ t: 'runEx', cmd }`) the engine just passes through verbatim from
`state.commandLine`.

### Multi-key sequences (pending state)

Commands spanning multiple keystrokes (`f<char>`, `r<char>`, `g`-chords,
text objects `di`/`da`) go through `state.pending` (`types.ts`'s `Pending`
union). Pattern: first key sets `pending`, and the top of `handleNormal`
special-cases each `pending.p` value before falling through to counts/motions
/single-key dispatch. If you add a new two-key prefix, add both the "waiting"
branch (top of `handleNormal`) and, if it should work under an operator too,
a case in `handleOperatorKey`.

## 6. Working in the adapter (`src/adapter/adapter.ts`)

### The local model and why it exists

RemNote's `getFocusedEditorText()` lags a keystroke or two behind
programmatic edits. If the adapter re-read RemNote on every key, rapid
sequences (`dwA!`) would compute offsets against stale text. Instead
`VimAdapter` keeps `this.model: { remId, text, caret } | null`:

- `snapshot()` returns the model if present; only calls into RemNote when
  `this.model === null`.
- `updateModel(action)` mutates the model **deterministically** to mirror
  what each `Action` should have done, run right after `exec(action)` for
  every action in the batch — this is the exact same logic `Harness.exec()`
  encodes for tests, just against `this.model` instead of `this.lines[row]`.
- Anything that changes the focused Rem, its structure, or triggers native
  typing must call `this.invalidateModel()` (sets `model = null`) so the next
  `snapshot()` re-syncs from RemNote. The `switch` in `updateModel` is the
  single source of truth for which actions do this — **when you add a new
  `Action`, you must add a case here** (mutate the model, invalidate it, or
  explicitly no-op with a comment, matching one of the three existing
  groups).

If you're chasing a bug where commands compute against the wrong text/caret,
this is the first place to look — either an action forgot to update the model
correctly, or forgot to invalidate it when it should have.

### Why caret moves are relative deltas

RemNote's sandboxed plugin API cannot set an absolute collapsed caret
position (`selectText` with a collapsed range, `collapseSelection`, and
`moveCaret(_, MoveUnit.LINE)` are all no-ops in this sandbox — see blocker #1
in VIM_STATUS.md). The one primitive that *does* move the real, visible
cursor is `editor.moveCaret(delta, MoveUnit.CHARACTER)` — a relative
character offset from wherever the caret currently is. So every "set caret to
X" in `exec()` (the `setCaret` case, `insertAt`, `setCaretAbs`) computes `to -
from` using `this.model.caret` as `from` (captured **before** the action
runs — `exec` sees the pre-action model, `updateModel` runs after) and issues
a relative move. If you add a new action that needs to position the caret,
follow this exact pattern; don't reach for an absolute-set API — none exists.

### Key stealing and the shift-blindness workaround

`applyMode(mode)` diffs the wanted key set (`bindingsForMode(mode)` in
`keymap.ts`) against `this.stolenSpecs` and calls
`app.stealKeys`/`releaseKeys` incrementally. RemNote's steal matcher cannot
distinguish Shift — see `keymap.ts`'s top comment and VIM_STATUS.md §3
blocker #0 for the full empirical writeup. Practical consequence for anyone
adding a keybinding: **you cannot bind a capital letter or a shifted symbol
to a different command than its lowercase key** — RemNote reports both as the
same spec. The existing pattern is unshifted synonyms via `g`-chords (`ge` =
`G`, `gl` = `$`, `gh` = `^`, `go` = `O`) or reused punctuation (`` ` `` = `~`,
`;` = `:`, `.`/`,` = `>`/`<` in visual-line). Follow this pattern for new
capital-only vim commands rather than trying to bind the real key.

### Visual-line selection trail

Visual-line mode doesn't use RemNote's real Rem-selection (`editor.selectRem`
kills the text caret irrecoverably — blocker #4). Instead `vTrail: string[]`
records the sequence of Rem ids the caret has visually walked through
(`vStart`/`vExtend` in `exec()`), `normalizedTrail()` collapses it to
top-level selected units (dropping ids covered by an ancestor already in the
trail), and `expandWithDescendants()` turns that into the full set of ids to
CSS-tint (since RemNote's DOM doesn't nest child rows inside the parent's
container, every row needs its own selector). `tests/harness.ts` mirrors this
exact algorithm using row indices + an `indents` array instead of a real
tree — if you touch the trail logic in the adapter, update
`Harness`'s `vExtend`/`deleteRemSelection`/etc in lockstep or the unit tests
will silently test a different algorithm than production runs.

## 7. Testing

Two independent layers with different jobs — see VIM_STATUS.md §5 for the
original rationale. Prefer the unit suite for anything that's pure vim
semantics; reach for e2e only when the bug is specifically about RemNote
integration (caret visibility, focus survival, tree structure).

### Unit tests — `npm test` / `npm run test:watch`

Vitest, `tests/engine.test.ts` against `tests/harness.ts`'s `Harness`. No
RemNote involved — this is the fast, deterministic feedback loop; run it
constantly while working in `src/engine/`.

```ts
const h = new Harness(['hello world'], /* row */ 0, /* caret */ 0);
h.keys('dw');
expect(h.lines[0]).toBe('world');
```

`Harness.keys(seq)` tokenizes a string (`<esc>`, `<cr>`, `<bs>`, `<space>`,
`<c-r>`, `<c-d>`, `<c-u>`, `<c-e>`, `<c-y>` for named keys; everything else
char-by-char) and feeds each through `handleKey` exactly like the adapter
does, except insert-mode plain characters are typed directly into `lines`
(mirroring that insert mode releases stolen keys live). Use a 4th constructor
arg (`indents: number[]`) to build a nested-tree fixture for visual-line
tests.

**Known state as of this writing:** `npm test` reports 11 failing tests, all
in the "visual-line across hierarchy (nested trees)" describe block (e.g. `G`
in v-line not extending to the true document end on a nested fixture). This
is a regression not reflected in VIM_STATUS.md's "84/84" figure (the suite
has since grown to 99 tests). Check current `npm test` output before trusting
that number, and see §6's note on `vTrail`/`normalizedTrail` if you're
investigating it.

### Live e2e — `e2e/run.mjs`, `e2e/stress.mjs`, `e2e/tree.mjs`

All three connect to a **running RemNote instance** over the Chrome DevTools
Protocol via `playwright-core`'s `connectOverCDP`, find the app page, and
require the dev plugin already loaded and enabled with today's Daily
Document open. They read state through RemNote's own **read-only** data API
(`window.Rem(...).findOne(...)`, `getText()`), never by parsing rendered DOM
text for assertions (DOM is only used to locate bullets to click).

Start an isolated instance first:

```bash
REMNOTE_APPIMAGE=/path/to/RemNote.AppImage ./e2e/launch.sh   # or auto-finds one under ~/Applications
```

This uses a scratch `$HOME` (`/tmp/remnote-vim-e2e-home` by default) so it
won't collide with your real RemNote profile, and defaults its CDP port to
**9223**. Then load+enable the dev plugin in that instance (Settings →
Plugins → Build → Develop from localhost, same as §3) and open today's Daily
Document.

**Port caveat:** `launch.sh`/`ctl.mjs` default to port `9223`;
`run.mjs`/`stress.mjs`/`tree.mjs` default to `9222`. These do **not** agree —
always pass `REMNOTE_CDP_PORT` explicitly to whichever script you run so it
matches the port `launch.sh` actually started on, e.g.:

```bash
REMNOTE_CDP_PORT=9223 npm run e2e                 # run.mjs narrative smoke test
REMNOTE_CDP_PORT=9223 node e2e/stress.mjs          # long sequences + focus-alive invariant
REMNOTE_CDP_PORT=9223 node e2e/tree.mjs            # nested-hierarchy visual-line precision test
```

(README's example instead runs `launch.sh` with defaults and `npm run e2e`
with `REMNOTE_CDP_PORT=9222` explicitly — that only works if something else
is already listening on 9222, e.g. your everyday RemNote launched with
`--remote-debugging-port=9222`. Pick one instance and use its real port
consistently.)

All three scripts scope every DOM query to bullets whose Rem-ancestor chain
reaches the open Daily Document (matched by the URL slug's trailing id), so
they can't touch your other real documents even if other panes are open —
and they clean up after themselves (`resetEmpty()` sweeps the daily note back
to one empty bullet).

- **`run.mjs`** — a single continuous narrative (each command builds on the
  previous result) asserting exact resulting text after each step. Good
  first check after any adapter change.
- **`stress.mjs`** — long, more chaotic sequences with a **focus-alive
  invariant** checked after *every* keystroke (a focused Rem or editable
  element must exist, unless deliberately in visual-line mode). This is what
  originally caught "dead cursor after cut" class bugs — run it after
  touching `removeRems`/`walkCaretOut`/`walkCaretTo` or anything else that
  moves focus across Rems.
- **`tree.mjs`** — precision test for the visual-line trail on a real nested
  tree, checking three channels per step (CSS tint, data/parent links, focus
  alive) and archiving a screenshot per phase to `e2e/shots/`. Run this after
  touching `vTrail`/`normalizedTrail`/`expandWithDescendants`.

### Manual poking — `e2e/ctl.mjs`

A tiny CDP remote for one-off inspection against a running (launch.sh'd)
instance, port defaults to 9223:

```bash
node e2e/ctl.mjs shot out.png                 # screenshot the app
node e2e/ctl.mjs eval 'document.title'        # run arbitrary JS in the page
node e2e/ctl.mjs key 'j j x'                  # press a key sequence (space-separated)
node e2e/ctl.mjs type 'hello'                 # type text
node e2e/ctl.mjs click '.EditorContainer'     # click a selector
```

Handy for reproducing a live bug interactively before writing it into
`stress.mjs`/`tree.mjs` as a regression check, or for reading the debug badge
live (`eval "getComputedStyle(document.body,'::before').content"`).

## 8. Debugging checklist

- **Key does nothing live, but the unit test passes:** check `keymap.ts` —
  is the spec actually in `NORMAL_BINDINGS`/`INSERT_BINDINGS` and being
  stolen for the current mode (`bindingsForMode`)? Check the badge's `k=`
  field to see what spec RemNote actually reported for your keypress (it may
  not be what you expect — shift-blindness, punctuation remapping).
- **Commands compute against stale text/caret:** almost always a missing or
  wrong case in `VimAdapter.updateModel()` (§6) — either an action didn't
  update the model to match what it just did, or should have invalidated it
  and didn't.
- **Caret disappears / keyboard "dies" after a command:** you're missing a
  `walkCaretOut`-style escape before removing/reparenting the focused Rem's
  editor. `moveCaretVertical` only works while some text editor is focused;
  once that Rem is gone, the caret is unrecoverable — always move focus to a
  survivor *before* the structural change, not after. `stress.mjs`'s
  focus-alive invariant exists specifically to catch this.
- **`rx`/`done` in the badge diverge and stay diverged:** a key handler in
  `handleSym`/`exec` is stuck on an unresolved promise — check the newest
  `exec()` case you added for a missing `await` or an SDK call that can hang.
- **Rich text / register content looks wrong:** `registerToText` and
  `captureSubtree`/`pasteSubtree` (adapter.ts) are the serialize/deserialize
  pair for the line register — a Rem's `RichTextInterface` is an array of
  strings or `{text}` objects, not a plain string; don't assume `.text` is a
  flat string.

## 9. Platform constraints (read before fighting the SDK)

Full empirical writeup lives in VIM_STATUS.md §3 — summary of what's actually
enforced in code you'll touch:

- **Shift is unobservable** (`keymap.ts` top comment) → no real capital-key
  bindings, ever. Use the synonym pattern (§6).
- **The collapsed caret can't be read**, only moved relatively (§6) → don't
  add code that assumes you can query "where is the caret right now" from
  RemNote directly; track it in the model instead.
- **`requestNative: true` currently does nothing** (manifest.json has it set
  to `false`; `domCaret.ts` exists for if/when RemNote unblocks it, but
  `hostDocument()` will keep returning `null` in the sandbox until then).
- **`editor.selectRem` is a one-way door** — it blurs the caret with no way
  back. Never call it from new code; use the CSS-tint trail approach instead.

## 10. Build & release

```bash
npm run check-types   # tsc --noEmit, run before committing
npm run build          # rm -rf dist && webpack (production) && zip dist/ → PluginZip.zip
```

`PluginZip.zip` is the distributable uploaded via RemNote's plugin store flow
(or side-loaded). `public/manifest.json` is copied into `dist/` verbatim by
`CopyPlugin` in `webpack.config.js` — bump `version` there for a release.
