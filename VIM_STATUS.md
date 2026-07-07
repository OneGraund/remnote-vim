# RemNote Vim Mode — Implementation Status

A modal, vim-style editing layer for the RemNote desktop app, built as a
RemNote plugin. This document tracks what works, what is blocked by platform
limits, and what is planned — measured against the "vim keys" bar people know
from **Obsidian's vim mode** (which is really CodeMirror's vim, running on a
plain text buffer).

**The honest one-line summary:** the vim *engine* is complete and fully
unit-tested (84/84), and the live suite passes **16/16** — including *visible*
caret movement (`h`/`l`/`0`/`w`/`e`/`f` really move the cursor; the fix was
discovering that `moveCaret(n, MoveUnit.CHARACTER)` works while every other
caret primitive is a no-op). Working live in the real app: motions, insert-mode
typing, range operators (`dw`, `de`, `df<c>`, `daw`, `x`, `dd`), `r`/backtick
in-place edits, undo, **`o`/`go` new bullets**, **multi-bullet visual-line
(`v` + `j/k` + `d`/`y`/`p`/`.`/`,`)** — cut/paste/indent/outdent across
bullets — plus `Ctrl-D/U/E/Y` scrolling and a `:` command line. One hard
platform constraint shapes the key map: **RemNote's key-stealing is
shift-blind** (see blocker #0), so capital commands use unshifted synonyms
(`v` = `V`, `ge` = `G`, `gl` = `$`, …). A stress suite (`e2e/stress.mjs`,
59 steps, focus invariant per keystroke) passes clean.

---

## How it's built (so the status below makes sense)

Three layers, deliberately separated so the hard-to-test part (RemNote) is thin:

- **`src/engine/`** — a pure, synchronous vim state machine. Input: a key + a
  snapshot `{ lineText, caret }`. Output: a new mode/state + a list of abstract
  `Action`s (`deleteRange`, `insertText`, `setCaret`, `deleteRem`, …). It never
  touches RemNote, so it is exhaustively unit-testable.
- **`src/adapter/`** — translates engine `Action`s into RemNote plugin-API
  calls, owns key-stealing per mode, and keeps a **local model** of the focused
  line (because RemNote's `getFocusedEditorText()` lags a keystroke behind).
- **`tests/` + `e2e/`** — two test layers, described in
  [How I test this](#5-how-i-test-this-the-self-verification-the-task-asked-for).

---

## 1. Implemented & verified working live (in the real app)

Confirmed by driving real keystrokes into a running RemNote over the Chrome
DevTools Protocol and reading the resulting Rem text back.

| Area | Commands | Notes |
|---|---|---|
| **Modes** | `i`→insert, `Esc`→normal, **`v`→visual-LINE** (outliner-first; `vv`→charwise, `vvv`→normal), `;`→command line; on-screen mode badge | Key-stealing is per-mode; insert releases keys so you type normally. |
| **Visible caret motions** | `h` `l` `0` `gl`(=$) `gh`(=^) `w` `b` `e` `f<c>` `t<c>` `;`/`,` (find repeat), counts | The cursor really moves on screen — implemented as relative `moveCaret(n, CHARACTER)` deltas from the tracked model position. |
| **Insert typing** | typing text in insert mode, `Esc` back to normal | |
| **In-place edits** | `r<c>` replace char, `` ` `` (=`~`) toggle case, char-register `p` | Positioned via the same relative caret moves. |
| **Char delete** | `x`, counts (`3x`) | |
| **Operators + word/find motions** | `dw`, `de`, `db`, `dd`, `df<c>`, `dt<c>` | Delete/change by explicit offset ranges — the reliable path. |
| **Text objects** | `diw`, `daw` (delete variants) | |
| **New bullets** | `o` (below), `go` (above, = `O`) + insert mode | Creates a real sibling Rem, walks the caret in via `moveCaretVertical`; child-aware (expanded parents get a first child). |
| **Visual-line, multi-bullet** | `v` (or `V`) then `j`/`k`/counts to extend — both directions; `d`/`x` cut, `y` yank, `p` paste, `.`/`,` indent/outdent; `Esc` cancels | Selection is rendered by the plugin (amber tint); registers capture **whole subtrees**, so cutting a parent keeps its children on paste. The caret stays alive through cut/paste/indent — it walks to a surviving neighbor before deletions. `dd` on the only bullet keeps an emptied line (vim-style). |
| **Paste** | `p`/`P` after `dd`/`yy`/visual-line cut — pastes whole bullets below/above | Register holds full rich text. |
| **Scrolling** | `Ctrl-D`/`Ctrl-U` (half page), `Ctrl-E`/`Ctrl-Y` (one Rem), `gd`/`gu` synonyms | Caret-moves; the view follows. Ctrl specs verified matched live. |
| **Command line** | `;` (when no find pending) or `:` opens it; **`:help`** → beginner cheat-sheet window (also in the command palette as "Vim: Help"), `:w`(`q`) → toast (RemNote autosaves), `:e <name>`/`:find <name>` → search + open best match, `:Ex` → points at Ctrl/Cmd-P | Typed into the badge bottom-right; `Enter` runs, `Esc` cancels. Help closes on Esc, ✕, or click-outside. |
| **Undo / redo** | `u`, `Ctrl-r` | Delegates to RemNote's own history. |
| **Doc navigation** | `gg`, `ge` (= `G`), `j`/`k` across Rems | Vertical moves via `moveCaretVertical`. |

## 2. Remaining live limitations

- **Caret desync after an intra-line mouse click.** The collapsed caret is
  still *unreadable* from the sandbox (`getSelection()` returns undefined for
  a plain caret), so when you click into the middle of a line the plugin can't
  learn the new column. The model re-syncs on the next insert-mode exit or
  cross-Rem focus change; until then the first motion after a click may start
  from a stale column. Workaround habit: after clicking, orient with `0`,
  `gl`, or just type (insert-exit re-syncs exactly).
- **Capitals act as their lowercase key** (blocker #0): pressing `A`, `X`, `D`,
  `C`, `Y`, `P`, `S` triggers `a x d c y p s`. Use the synonym table.
- **Insert-entry `a`/`A`-at-end nuances:** `a` works via the caret model; a
  desynced caret (see click note) shifts where typing lands, exactly as it
  shifts motions.

## 3. Known blockers (platform limits)

### Blocker #0 — RemNote's key stealing is SHIFT-BLIND (verified empirically)
The steal matcher reports the bare key regardless of Shift and `shift+…` specs
never match at all (probed live: with only `shift+v` stolen, neither `v` nor
`V` is captured; with `v` stolen, both are captured and reported as `v`;
`$` reports as `4`, `Q` as `q`). **Shift state is unobservable**, so capital
vim commands cannot be bound to their real keys. Ctrl combinations DO match
correctly. The keymap therefore provides unshifted synonyms:

| vim key (unreachable) | live synonym |
|---|---|
| `V` (visual-line) | plain `v` enters line-mode directly (`vv` = charwise) |
| `G` (doc end) | `ge` |
| `$` (end of line) | `gl` |
| `^` (first non-blank) | `gh` |
| `O` (open bullet above) | `go` |
| `~` (toggle case) | `` ` `` (backtick) |
| `:` (command line) | `;` (when no `f`/`t` find is pending) |
| `>` / `<` (indent/outdent, visual-line) | `.` / `,` (or RemNote's native Tab / Shift-Tab) |
| `Ctrl-D`/`Ctrl-U` alternates | `gd` / `gu` |
| Other capitals (`A I X D C Y P S`) | currently act as their lowercase key |

### Blocker #1 — collapsed caret: MOVABLE (solved), still not READABLE
RemNote runs third-party plugins in a **cross-origin sandbox iframe**. Range
select+delete works (why `dw`/`x` always worked). For the collapsed caret:
`selectText({p,p})`, `collapseSelection`, and `moveCaret(…, MoveUnit.LINE)`
are all no-ops — but **`moveCaret(n, MoveUnit.CHARACTER)` DOES move the real
cursor**. All caret positioning is now implemented as relative CHARACTER
deltas from the adapter's tracked model position, which is what makes
`h`/`l`/`w`/`0`/`f` visibly move and `r`/`a` insert at the right column.
Still true: the collapsed caret cannot be *read* (`getSelection()` is
undefined for a plain caret) — see §2 for the click-desync consequence.
Native DOM access remains hard-disabled in the app (`isNative: !O && …`,
"REJECT IF TRUE FOR NOW"), so `requestNative: true` does nothing on 1.26.30.

### Blocker #2 — leading-whitespace divergence — **FIXED**
RemNote's *data layer* trims leading whitespace from a Rem immediately, while
the *editor content* keeps it until some later normalization — so an edit that
leaves a leading space (e.g. `de` on "world foo" → " foo") makes data, editor
and model disagree. Fixed twice over: the model mirrors the trim
(`normalizeModel()`), and any deletion starting at column 0 is extended to
swallow the whitespace run that would become the new line start, so the editor
never holds a leading space in the first place.

### ~~Blocker #1a — positioned inserts~~ **RESOLVED**
Positioned inserts (`r`, backtick, char-register `p`, insert-entry) now work:
they walk the caret with relative `MoveUnit.CHARACTER` deltas (see #1) before
inserting. The earlier one-off errors were a compound of (a) only ever testing
the broken `LINE` unit and (b) the leading-space divergence fixed below.

### Blocker #4 — `editor.selectRem` blurs the caret irrecoverably
A real Rem-selection kills the text caret and no sandbox API can bring it
back (discovered via the stress suite's focus invariant). Visual-line mode
therefore never creates a Rem-selection: the highlight is plugin CSS, the
operations go through the data API, and the caret physically stays in a
bullet editor the whole time — walked onto a survivor before any deletion.

### ~~Blocker #3 — shifted punctuation~~ (superseded by blocker #0)
Early findings about shifted punctuation were the first sighting of the
shift-blindness now fully characterized as blocker #0 and worked around with
the synonym table above.

### Genuinely impossible right now (as opposed to just hard)
- **Native/DOM-level caret control** — blocked in the app build (see #1).
  Nothing the plugin can do changes this until RemNote ships native plugins.
- **True multi-line `j`/`k` within one Rem** — a RemNote bullet is conceptually
  one line; "lines" are Rems. `j`/`k` are mapped to moving between Rems, which
  is the sensible RemNote analogue, not a bug to fix.

## 4. Planned / next steps

Ordered by value:

1. **Caret re-sync after intra-line clicks** (the last §2 limitation). Idea:
   `getCaretPosition()` returns a DOMRect — calibrate the column by comparing
   rects while binary-searching with relative CHARACTER moves, or accept a
   one-time `0` orientation.
2. **`ci(`/`ci"` bracket/quote text objects; `J` join** (merge next Rem's text).
3. **`.` repeat, named registers (`"ayy`), `/` search, marks.**
   The engine's action model already supports recording; these are additive.
4. **A settings panel** for: start mode, which keys to steal, custom synonyms
   for the shift-blind capitals (some users may prefer `;`→`:` always).
5. **Upstream ask:** file a RemNote issue about shift-blind `stealKeys` and
   native-plugin availability — both small fixes on their side that would
   unlock the remaining vim surface (real capitals, caret reads).

*(Done since last revision: visible caret motions via relative
`MoveUnit.CHARACTER` deltas — h/l/w/e/0/f really move the cursor; positioned
inserts (`r`, backtick, char-register `p`); leading-space divergence fix;
multi-bullet visual-line cut/paste/indent — the `vv j d p . ,` workflow;
`o`/`go` bullet creation; `Ctrl-D/U/E/Y`; `:` command line; shift-blind
synonym layer. Live suite: 16/16.)*

## 5. How I test this (the self-verification the task asked for)

Two independent layers, because the failure modes are different:

- **Engine unit tests — `npm test` (Vitest, 84 tests, all passing).**
  `tests/harness.ts` is a fake editor implementing the same `Action`s RemNote
  does; `tests/engine.test.ts` drives vim key sequences through it and asserts
  the resulting text/mode/registers. This pins down *vim semantics* fast and
  deterministically, with no RemNote needed.

- **Live stress test — `node e2e/stress.mjs`.** Long realistic sequences
  (motions at boundaries, upward/downward visual cuts, subtree cut/paste,
  indent/outdent, dd chains, command line, scroll, rapid mixed input) with a
  **focus invariant checked after every keystroke**: the keyboard must still
  be alive. This is what caught the dead-cursor-after-cut class of bug.

- **Live end-to-end — `node e2e/run.mjs`.** Launches / attaches to the real
  RemNote AppImage over the DevTools Protocol (`e2e/launch.sh` starts it with
  `--remote-debugging-port`), loads the dev plugin, types real keystrokes into a
  scratch bullet in today's Daily Note, and asserts the Rem text via RemNote's
  own read-only data API. This is what surfaced blockers #1 and #2 — things the
  unit tests can't see. It is deliberately non-destructive (one scratch bullet,
  cleaned up after) and synchronizes on a plugin-exposed `rx/done` counter so it
  never reads mid-edit.

Current live score: **the range-operation core passes; the caret-dependent
commands fail pending §4.1.** The engine suite is the source of truth for
semantics; the e2e suite is the source of truth for integration.

---

*Environment: RemNote 1.26.30 desktop (AppImage, Electron 36), plugin SDK
`@remnote/plugin-sdk` 0.0.46, loaded via Settings → Plugins → Build → "Develop
from localhost".*
