# Developer Guide

This is the deep-dive companion to [README.md](./README.md) (quick start).
Read this when you're about to write code: it explains *how the pieces fit
together* and gives concrete recipes for extending or debugging the plugin.
Written for both human contributors and future Claude Code instances picking
this repo back up cold. It also carries the **work log (§0)**, the **feature
status (§0.5)** and the **platform blockers (§9)** — the former VIM_STATUS.md
was retired into those sections (its full text is in git history,
commit 122d18e).

> **Convention:** all in-flight plans and progress live in §0 (work log)
> below — update it as you work so parallel contributors can see state at a
> glance.

## 0. Work log / current state

### 2026-07-08 — open-source readiness pass (docs/metadata only; no engine changes)

Prepped the repo to be published publicly and submitted to the RemNote Plugin
Store. **No source touched** — engine/adapter untouched, unit 153/153, `tsc`
clean. Added: `LICENSE` (MIT, © onegraund — user chose the handle over their
legal name), `CONTRIBUTING.md`, `.github/workflows/ci.yml` (check-types + unit
tests + prod build; e2e stays local-only), issue/PR templates, and
`e2e/.env.example`. Rewrote `README.md` to be user-first (install, Shift-blind
synonym table, full keybinding + Ex cheat sheet, Known limitations, a Privacy
note stating no data leaves the app — RemNote asks for this disclosure).
Enriched `package.json` metadata (author/description/repository/bugs/keywords;
kept `private:true`). manifest.json already had the required `repoUrl`/author.
**Not done (user's call, needs their hands):** create+push the GitHub repo,
`npm run build`, upload the zip via Settings→Plugins→Build→Upload. Privacy
caveat surfaced to user: commit author email in `.gitconfig` is the student
address (`e12133647@student.tuwien.ac.at`) — it will be public on push and
partly defeats the handle-only choice; suggested GitHub noreply email.

### 2026-07-08 night — handoff closed: gj/:g/:marks/:help all live-verified; every suite green; stress c-e wedge fixed

Picked up the evening handoff below; **all five open items are resolved**.
Suite state at end of session: unit **153/153**, `tsc` clean, smoke
**16/16**, stress **57/57** (was 59 — see below), real-input **8/8**
(now proves real Ctrl+A/Ctrl+X delivery, the handoff's open question).
App relaunched on CDP 9223 with the current bundle; daily doc left as a
single empty bullet (suites swept it).

- ☑ **`gj` re-verified on the fixed bundle** — fixture
  `jtest > [one>[kid1], two>[kid2], three, four]`, focus `one`: `gj` →
  `"one two"` (NO self-join — the positionAmongstSiblings race fix holds),
  then `.` (dot-repeat, full-speed replay of exactly the racy path) →
  `"one two three"`. Children adopted in order `[kid1, kid2]`, `four`
  untouched, UI clean (no zombie rows). Data layer + screenshot verified.
- ☑ **`:g/tmp/d` live-verified** typed through the real command line
  (`;g/tmp/d<cr>`): fixture `tmp solo`, `tmp parent>[inner keep,
  tmp covered]`, `survivor`. Both units deleted, the matching parent took
  its whole subtree, the covered child was NOT double-deleted (ancestor
  dedup works), `survivor` intact, toast "2 bullets deleted", OS clipboard
  got both units with the subtree nested (`clip:native`).
- ☑ **`:marks` toast verified** — "Marks: a → gamma | b → zeta" after
  `ma`/`mb` on two bullets.
- ☑ **`:help` sheet eyeballed** (3 screenshots in e2e/shots/help-*.png):
  ga row, full Marks section (`m·`/`'·`/`''`/`:marks`), dib/gj/Ctrl-a/
  Ctrl-x/`.` rows, expanded Command line section (`:s`, `:vs`/`:sp`,
  `:q`/`:only`, `:sort`, `:t`/`:d`/`:y`, `:g/x/d`, `:e`, `:w`), and the
  RemNote-differences footer all render correctly.
- ☑ **FIX (user-reported): stress.mjs pressed `<c-e>`/`<c-y>`**, which the
  plugin deliberately does not steal (engine.ts: no view-scroll API) — the
  presses leaked to RemNote where **Ctrl+E opens the audio-embed widget**
  on the empty scratch bullet and wedged later cases. Steps removed (same
  treatment as the c-o/c-i drop in 81134a8); stress is now **57 steps**.
  §9 gained a bullet.
- ☑ **New harness gotcha found + fixed in all suites**: a freshly launched
  window **swallows synthetic CDP clicks until `page.bringToFront()`** —
  activeElement stays BODY, no rem focuses, keys still reach the steal, so
  everything silently no-ops. run/stress/tree.mjs now call it after
  connect; §9 gained a bullet. (This is why the first gj probe "failed".)
- Flake note: first smoke run after cold boot came in 15/16 — the
  `v j .` indent check hit the known §9 positionAmongstSiblings race
  (alpha reparented, beta missed); clean 16/16 on the next two runs.
  Not a regression; indentSelection may deserve the same by-id fix as
  joinRem if it recurs.
- Remaining optional follow-ups (unchanged from the evening entry):
  `:sort u` semantics, visual-mode dot-repeat, `d'a` delete-to-mark.

### 2026-07-08 evening — HANDOFF: new feature batch (marks, text objects, gj/ga, C-a/C-x, dot-repeat, 6 new Ex verbs)

Read this first. A large feature batch is **committed, 153/153 unit-green,
tsc clean, and MOSTLY live-verified** — the table below says exactly what
remains. The e2e app on CDP 9223 is running a bundle from BEFORE the last
`joinRem` fix (see open item 1); webpack dev on 8080 has the current build.
Daily doc state at handoff: `list` (children `2 two`/`9 nine`/`10 ten`),
`gamma`, `zeta`.

**What shipped** (all documented in the `:help` sheet — vim_help.tsx — and
§0.5; keys chosen to be typeable under shift-blind stealing):

| Feature | Impl | Unit | Live-verified? |
|---|---|---|---|
| Text objects `ib`/`ab` (=`i(`), `i[`/`a[`, `i'`/`a'`, `` i` ``/`` a` `` for d/c/y and charwise visual (`vi[`) | engine `textObjectFor` + motions `pairObject`/`quoteObject` | ✅ | ✅ `di[`, `dib` (first try hit a FIXTURE race, see gotchas) |
| Marks: `m<c>` set, `'<c>` jump (a jumplist entry), `''` auto-mark | actions `setMark`/`gotoMark`; adapter `marks` map; `recordJump` sets `'` | ✅ | ✅ `ma`/`ge`/`'a`/`''` toggle |
| `gj` = vim `J` (join with next sibling; adopts its children; counts) | action `joinRem` | ✅ | ⚠ **works, but see open item 1** |
| `ga` = vim `A` (append at end of line) | g-chord | ✅ | ✅ |
| `C-a`/`C-x` number increment/decrement with counts | motions `numberAt`; emits deleteRange+insertText | ✅ | ✅ via CDP (41→42, `5<C-x>`→37). **Delivery class: CDP-visible** (like C-d, unlike C-o). Real-keyboard delivery NOT yet probed — real-input.mjs has the checks, not yet run |
| Dot-repeat `.` (normal-mode changes only: d/x/r/p/`~`/gj/C-a…; c-family and o are NOT recorded — insert text never reaches the engine) | `keyLog`/`lastChange` in VimState, `recordDotRepeat` wrapper in `handleKey`, action `replayKeys`, adapter `applyKey` extraction | ✅ | ✅ `dw` then `.` |
| `:sort [n] [rev]` — selection siblings, else focused bullet's children | `sortBullets` | n/a | ✅ all three forms + visual selection |
| `:t` / `:co[py]` — duplicate bullets below selection | `duplicateBullets` | n/a | ✅ |
| `:d` / `:y` — delete/yank selection or focused bullet (register + OS clipboard, like dd/yy) | `deleteBullets`/`yankBullets` | n/a | ✅ (`- gamma` and 2-bullet clip:native) |
| `:g/pat/d` — delete every matching bullet in the doc (subtree incl.) | `globalDelete` | n/a | ❌ **not verified** (open item 2) |
| `:marks` — list marks in a toast | `listMarks` | n/a | ❌ not verified |
| Wildmenu catalog + `:help` sheet updated with all of the above (help also gained the previously-missing `:s`/`:vs`/`:sp`/`:q`/`:only` rows) | | | ❌ help rendering not eyeballed |
| keymap: normal mode now steals `'` `[` `]` (marks/objects/f-args) and `ctrl+a`/`ctrl+x` | | ✅ | ✅ (`[` and `'` proven by di[/ma) |

**Next account's job (in priority order):**

1. **Relaunch the app** (`pkill -f 'remote-debugging-por[t]=9223'` +
   `./e2e/launch.sh`; the running bundle predates the fix) and **re-verify
   `gj`**, including `gj` then `.`. Background: the first live `gj` self-joined
   ("alpha alpha") — `positionAmongstSiblings()` raced the data layer right
   after an edit and handed back the focused rem as its own next sibling (the
   same race that bit indentSelection, see 2026-07-07 evening). Fixed by
   finding the sibling **by id in `getChildrenRem()`** (`findIndex` + guard)
   instead of the position re-query; fix is committed but NOT live-verified.
   Dot-repeated `gj .` replays at full speed, so it exercises exactly this race.
2. **Live-verify `:g/pat/d`**: create two `tmp …` bullets in the daily doc,
   `;g/tmp/d<cr>` → both deleted (clipboard gets them via cutRems); also check
   a matching parent takes its whole subtree and covered children are not
   double-deleted (the `units` ancestor-dedup in `globalDelete`).
3. **Eyeball `:marks`** (toast) **and the `:help` sheet** (`;help` — new rows:
   ga, Marks section, dib/gj/C-a/C-x/`.`, expanded Command line section).
4. **Run the suites** against the relaunched bundle:
   `REMNOTE_CDP_PORT=9223 VIM_E2E_SETTLE=1600 npm run e2e` (expect 16/16),
   `… node e2e/stress.mjs` (59/59), and `… node e2e/real-input.mjs` —
   now **8 checks** (added C-a/C-x; needs the window focused in the
   compositor — machine runs niri, check `niri msg windows`, ydotool user
   service must be active).
5. Optional follow-ups noted while building: `:sort u` (unique) was skipped
   deliberately (deletes rems — decide semantics first); visual-mode dot
   repeat not planned; `d'a` (delete to mark) unsupported.

**Harness gotchas (re)confirmed this session — cost real time:**

- **SDK `setText` → immediate click → keystroke = stale local model.** The
  editor read API lags the data layer (§6), so the adapter caches the OLD
  text and motions "fail" (a `dib` looked broken this way — it wasn't). After
  fixture `setText`, press `j k` (or wait ~1 s before clicking) to force a
  model resync before driving keys. Real typing never hits this.
- `positionAmongstSiblings()` right after an edit is unreliable (race above);
  promoted to a §9 bullet since it has now bitten twice.

### 2026-07-08 later — handoff closed: :s / panes / wildmenu all live-verified; pane-focus fix; cmdline shift-blindness mapped

Picked up the handoff below; every open item is resolved. Suites at the end
of this session: unit **119/119**, `tsc` clean, smoke **16/16**, stress
**59/59**, real-input **6/6** (now includes C-o/C-i).

- ☑ **`:s` live-verified end-to-end** (typed through the real command line):
  plain (`;s/alpha/one/` on the focused bullet), `g` (all matches per
  bullet), default first-match-only, `i`/`gi` on a case-mixed fixture, `a`
  (whole doc, proven focus-independent), and a `v j` visual-line selection as
  the implicit range — in-range bullets substituted, out-of-range untouched,
  `'<,'>` marker shown in the badge. Replacement `$`-expansion (`$$`→literal,
  `$&`, `$1`) and vim `\1..\9` backrefs verified against real rich text via
  direct `substitute()` calls from sdk-repl — they are **untypeable from the
  keyboard** (see the new §9 entry), so keystroke tests can't reach them.
- ☑ **Pane Ex commands live-verified**: `;vs` (side-by-side duplicate), `;sp`
  (stacked), `;vs gamma` (search + open beside), `;q` (close focused), `;only`.
  Layout + docs asserted via `getOpenPaneIds`/`getOpenPaneRemId`, screenshots
  eyeballed.
- ☑ **BUG FOUND+FIXED while verifying panes: every `setRemWindowTree` call
  regenerates all pane ids and drops the pane focus entirely** — after any
  `:vs/:sp/:q/:only` the caret was dead until a real click. New `setPaneTree()`
  wrapper re-fetches the ids after the rebuild and `setFocusedPaneId`s the
  right leaf: the NEW pane for splits (vim focuses the new window), the
  survivor at the closed index for `:q`, the kept pane for `:only`. Verified
  live: `;vs gamma` lands focus in the gamma pane, then `;q` typed with NO
  intervening click closes it and restores the caret to the exact pre-split
  rem (alpha). Also confirms `getOpenPaneIds()` order matches the leaf order.
- ☑ **Wildmenu live-verified**: catalog renders stacked above the badge;
  verb filtering (`;s` → `:s/`+`:sp`); Tab cycles with the `▸` marker, applies
  `complete` (trailing space for rem-arg verbs), wraps; `;e gam` runs the live
  doc search; Tab+Enter opens the hit with the caret ON the target bullet.
  Stale-async guard proven live by bursting `handleSym` calls (`;e gam` then
  immediate rewrite to `q` before the search resolved — no clobber).
- ☑ **Wildmenu fix: suggestions dedupe** by completed line (same-named rems
  and search residue rendered as five identical `gamma` rows — useless).
- ☑ **Badge fix: `clearVTrail` now clears `dbgV`** — after leaving
  visual-line the badge kept showing `trail:N units:N tint:N`, which reads as
  a live selection and cost this session a phantom-bug detour.
- ☑ **stress.mjs C-o/C-i decision**: they were already dropped in 81134a8
  (no such presses exist in the file). `real-input.mjs` instead gained real
  `Ctrl+O`/`Ctrl+I` delivery checks (the only suite that can see them) — 6/6.
- **New platform findings** (all in §9): the command line is shift-blind like
  every other stolen key, so `:s` patterns can only use the unshifted regex
  subset; SDK `rem.remove()` of currently-rendered rems leaves zombie rows the
  UI still shows (clicks focus detached rems — e2e hazard, refresh via an
  `openRem` round-trip).

### 2026-07-08 — HANDOFF to next account: command-line rework shipped (needs live verify) + bughunt results

Read this first. A batch of command-line/Ex work is **committed and
unit-green (119/119, tsc clean)** but several pieces are **NOT yet
live-verified** — that's the main open work. Plus a live bughunt cleared the
user's reported issues (most already fixed; the one "bug" that remained is a
test-harness artifact, not a real defect). Live e2e RemNote is running on CDP
9223 with three clean scratch bullets (`alpha`/`beta`/`gamma`) in the daily
doc; `ydotool` daemon is up (`systemctl --user start ydotool`).

**Commit `81134a8`** — "Pane nav via C-h/C-l; release '/'; drop todo verbs;
add :s/:vsplit/:split/:q/:only; wildmenu". What it contains and its
verification state:

| Feature | Code | Unit | Live-verified? |
|---|---|---|---|
| `/` released → RemNote's own slash menu opens; `;` is the only vim cmdline key | ✅ | ✅ | ✅ (slash menu screenshot) |
| `:todo`/`:done`/`:untodo` removed (slash menu covers them) | ✅ | ✅ | n/a (removal) |
| `Ctrl-H`/`Ctrl-L` pane nav (C-w kept for other hosts) | ✅ | ✅ | ✅ (real ydotool click + split) |
| Escape from charwise visual COLLAPSES the native selection (`collapseSelection` action) | ✅ | ✅ | ✅ (this session) |
| visual `e` advances past current word end | ✅ | ✅ | ✅ (earlier session) |
| **`:s/pat/repl/[gia]`** substitute over rich text | ✅ | ⚠ engine-only | ❌ **needs live verify** |
| **`:vsplit`/`:split`/`:q`/`:only`** via `window.setRemWindowTree` host RPC | ✅ | n/a | ❌ **needs live verify** (RPC shape probed live, Ex verbs not driven end-to-end) |
| **Wildmenu** (Tab-cycled suggestions; `:e`/`:vs`/`:sp` live doc search) | ✅ | ⚠ `/`-typeable only | ❌ **needs live verify** |

**Next account's job (in priority order):**

1. **Live-verify `:s`** — `;s/alpha/ALPHA/<cr>` on a focused bullet; then
   flags: `g` (all matches in a bullet), `i` (case), `a` (whole document,
   vim's untypeable `%`), and a visual-line selection as the implicit range
   (`v j` then `;s/e/E/g`). The `'<,'>` marker should show in the badge while
   a selection is live. Impl: `substitute()` in `adapter.ts`; only PLAIN
   string rich-text segments are touched (references left intact). Watch for
   `$`-expansion bugs in the replacement (manual `$1`/`$&` handling, NUL
   sentinel for `$$`).
2. **Live-verify panes** — `;vs<cr>` (duplicate focused pane side by side),
   `;sp<cr>` (stacked), `;vs some-doc<cr>` (search + open beside), `;q<cr>`
   (close focused pane), `;only<cr>`. Impl: `splitPane`/`closePane`/`onlyPane`
   in `adapter.ts` build a react-mosaic tree and call `winCall`. Caveat
   documented in code: no layout GETTER exists, so a hand-arranged 3+ pane
   layout is rebuilt flat.
3. **Live-verify the wildmenu** — type `;` then `e ` and a partial doc name;
   suggestions render stacked above the mode badge (they're CSS `content` on
   `body::after`, `\A`-separated, `white-space:pre`); Tab cycles/applies them.
   `EX_COMMANDS` is the static verb catalog; arg-position search is async with
   a seq-guard. Verify stale async results don't clobber a newer keystroke.
4. Decide whether `stress.mjs` should drop its `c-o`/`c-i` presses (they are
   CDP no-ops — see finding below) or gain a real-input variant.

**Bughunt results (live, this session — against the user's VIM-doc report):**

- ✅ **Multiline visual-line yank → OS clipboard WORKS** (user said it didn't).
  `v j y` put `- alpha\n- beta` on the real clipboard (read via `wl-paste` —
  Wayland session; XWayland app clipboard bridges through). Was fixed by the
  evening `nativeClipboardRems` work; now confirmed. Single-line `yy` → `- alpha`.
- ✅ **Escape from visual no longer strands the selection** (user's complaint).
  After `0 v l l <esc>` the native selection is collapsed and mode is normal.
- ✅ **`v gg` / `v ge`** select the whole doc line-wise (trail:3/units:3) — user
  said these "didn't work"; they do now (was likely the stale-build era).
- ✅ **`Ctrl-O` / `Ctrl-I` jumplist WORKS with real input.** This looked like a
  bug under CDP (rx never incremented, focus never moved) but that is a
  **CDP delivery limitation, not a defect**: with real ydotool keys, `gg`→`ge`
  then physical Ctrl+O returned focus alpha←gamma and Ctrl+I went forward
  again (badge `k=ctrl+o`/`k=ctrl+i`, rx incremented). The jumplist logic in
  `adapter.ts` (`case 'jump'`, `recordJump`) is fine. If the USER still sees it
  fail, suspect an OS/Electron binding on Ctrl+O (common "open file"
  accelerator) in *their* environment — worth asking.
- `$` end-of-line stays unreachable by construction (shift-blind; use `gl`) —
  known, documented in §9/§0.5, not re-litigated.

**e2e harness gotchas discovered (cost real time — heed these):**

- **The daily-template banner** ("Set Up Template / Not Now") shifts bullet
  positions as it renders/dismisses, so precomputed click coords go stale and
  the click lands on empty space → focus never attaches (looks like clicks are
  "broken"). Dismiss the banner first, then click via a **locator** that
  resolves position at click-time, not a cached rect.
- **`selectRem` probing leaves the editor stuck** in `.in-selected-portal`
  with hit-testing falling through to `<html>` (even after pointer-events is
  forced to `auto`). Once in this state CDP clicks are dead; the reliable
  reset is a full app relaunch (`pkill` the 9223 process + `./e2e/launch.sh`).
- **Ctrl-chord delivery splits three ways** (all verified this session):
  `C-d`/`C-u`/`C-r` reach the steal via CDP; `C-o`/`C-i` do NOT via CDP but DO
  via real hardware; `C-w` reaches neither (Electron eats it even from a real
  keyboard). ⇒ `run.mjs`/`stress.mjs` cannot cover `C-o`/`C-i`/`C-w`; use
  `e2e/real-input.mjs` (ydotool) for those.

### 2026-07-07 late night — Ctrl-W was dead at real keyboards; C-h/C-l pane nav + real-input e2e

User report: Ctrl-W → h/l did nothing in real usage although the e2e passed.
**Root cause: Electron consumes a real Ctrl+W in the main process — the
renderer (and thus RemNote's key steal) never sees the keydown.** Proved with
kernel-level uinput (ydotool through the compositor, identical to a physical
keyboard): a real `h` arrives (badge rx increments), a real Ctrl+W does not;
a page-level capture listener logged real C-h/C-l/C-j/C-k/C-o/C-i all
arriving — only C-w is eaten. The CDP suites synthesize input inside the
renderer, bypassing Electron, which is why they lied. §9 has the new blocker
entry.

Fix + hardening:

- **`Ctrl-H` / `Ctrl-L` = focus previous/next pane** (the classic vim
  `<C-h>`/`<C-w>h` remap). Stolen + handled in normal mode; `C-w` chord kept
  for hosts that deliver it (web?). Help sheet now lists Ctrl-h/Ctrl-l only.
- **New `e2e/real-input.mjs`** (§7): ydotool-based key-DELIVERY test — real
  `h`, real C-h/C-l must reach the steal; documents the C-w hole (warns if a
  platform change ever makes it arrive). Requires the window focused +
  `systemctl --user start ydotool` (user has a udev ACL on /dev/uinput).
- Harness `focusPane` now records `paneMoves` so pane bindings are
  unit-assertable; tests for `C-w h/l/w` and direct `C-h`/`C-l`. 118/118.
- **Verified end-to-end with real input**: with a real split open, physical
  Ctrl+H switched `getFocusedPaneId()` to the left pane, Ctrl+L back —
  through the full kernel → compositor → Electron → steal path.

Env note: the machine runs **niri**, not Hyprland (CLAUDE.md is stale on
this); the e2e RemNote is an XWayland window. Real input via `ydotool`
(uinput) works regardless of compositor.

NEXT (user-directed, in order): bug-hunt current functionality live; release
`/` (RemNote's slash menu must open; `;` is the only command-line key) and
drop `:todo`/`:done`/`:untodo`; add `:vsplit`/`:s`-style Ex commands
(pane-open path still unknown — SDK has none; shift+click is the only known
trigger); command-line suggestions (wildmenu) incl. `:e` document completion.

### 2026-07-07 night — handoff batch closed: all ☐ probes verified, visual-`e` fix

Picked up the evening handoff below; every open item is now resolved.

- ☑ **indentSelection rewrite live-verified** — fresh app restart to load the
  bundle, then smoke suite **16/16 twice** (the previously-racy
  "v j . indent" step passed both times) and stress **59/59**.
- ☑ **`o` on a ToDo creates a sibling** — probed live via sdk-repl: built a
  todo with `:todo`, pressed `o`; both rems report the same `getParentRem()`
  (the daily doc), new bullet is NOT a child of the todo.
- ☑ **`:todo` on a multi-bullet visual selection** — `vv j j` over three
  bullets + `;todo` ⏎ set todo status on exactly the three selected rems
  (checked via `isTodo()` on all daily-doc children; unrelated rows
  untouched). Command exit cleared the trail, mode returned to normal.
- ☑ **Ctrl-W with a real split pane** — opened a second pane live, then
  `C-w h` / `C-w l` / `C-w w` each switched `getFocusedPaneId()` correctly
  (h→left, l→right, w→cycle). *E2e recipe:* the SDK cannot open a split
  (`window.openRem` takes no pane arg); **Shift+click on a rem-reference
  link** opens it in a new pane (Ctrl+click and Alt+click do nothing). Close
  it via the pane-header icon button (hover top of the pane).
- ☑ **Charwise visual rendering** — eyeballed via screenshot: the native
  text selection tracks the vim selection exactly (`0 v l l l` highlights
  "task"), plus cursorline tint + left bar. Side effect noted: RemNote's
  floating **formatting toolbar pops up over any native selection** — vim
  charwise-visual triggers it. Harmless (keys still work) but visually noisy;
  candidate for a mode-scoped CSS hide if it annoys.
- ☑ **BUG FOUND+FIXED while probing: visual-mode `e` could never advance
  past the current word end.** `state.head` is an ON-char index, but
  `wordEnd` measures from an I-beam caret: from head on a word's last char
  it returns head+1, and the `landsOn` −1 adjustment lands right back on
  head — `v e e e …` stayed stuck forever (live-reproduced: selection never
  grew past "task"). Fix in `handleVisual` (engine.ts): when a `landsOn`
  motion makes no progress, rerun it from head+1 (vim's block-cursor "must
  land later" rule — applies only in visual; normal-mode I-beam `e` already
  guarantees progress). New regression test (`v e` then `e` on
  "one two three"); 116/116 unit, fix verified live (`v e` → "task",
  second `e` → "task one").
- ☑ **copyText/writeClipboard decision (was the last ☐): KEEP the sandbox
  tiers, comments fixed.** They're proven dead only on the *desktop* app;
  the try is free, other hosts (web) may grant clipboard-write, and the
  `clip:api`/`clip:exec` badges are exactly how we'd notice. The comments
  now say the select+cut+reinsert fallback is the real live path instead of
  calling the direct write "preferred". §0.5 wording was already aligned.

No engine/adapter contract changes beyond the `handleVisual` fix; harness
untouched.

### 2026-07-07 evening — HANDOFF: live e2e verified, native rem-clipboard landed

Read this first — it supersedes the "BLOCKED" status of the entry below.
Session ended mid-verification (account switch); here is the exact state.

**Live environment (was running at handoff, easy to recreate):**

- e2e RemNote on CDP **9223** via `./e2e/launch.sh` (run in background; app up
  in ~30 s). Login **persists** in the scratch HOME (`/tmp/remnote-vim-e2e-home`,
  `e2e/.env` account, knowledge base "VIM") — it boots straight into the
  Daily Document. Webpack dev server on 8080 (`npm run dev`) serves the
  plugin; RemNote side is already configured to develop-from-localhost.
- **The plugin iframe does NOT pick up rebuilds**: webpack rebuilds, but the
  widget keeps running old code (no live-reload handshake), and CDP
  `Page.reload` on the iframe target reloads it *without* re-activating the
  plugin. **Reloading the MAIN window kills the whole app** (RemNote treats
  main-frame reload as exit — verified twice). The only reliable way to load
  a new bundle: `pkill -f 'remote-debugging-port=9223'; ./e2e/launch.sh`.
- Suite invocations that pass:
  `REMNOTE_CDP_PORT=9223 VIM_E2E_SETTLE=1600 npm run e2e` and
  `REMNOTE_CDP_PORT=9223 VIM_E2E_SETTLE=1600 node e2e/stress.mjs`.
  The raised `VIM_E2E_SETTLE` matters: with the default 900 ms the *first*
  insert after plugin activation still races the key-release and drops the
  first typed char (reproduced: 12/16; with 1600 ms: 16/16).

**⚠ ONE ITEM IN FLIGHT — finish this first:** `indentSelection` in
`src/adapter/adapter.ts` was rewritten this session (derive the indent
destination once per same-parent run instead of re-querying
`positionAmongstSiblings` between `setParent` calls — the re-query races
RemNote's data layer and can return the unit itself as its own "previous
sibling", silently skipping it; reproduced twice as `run.mjs` "v j . indent"
failing on the *pasted-then-indented* beta bullet while stress phase 4
passes). The rewrite is `tsc`-clean and 115/115 on unit tests but **has NOT
been live-verified**. Next action: restart the e2e app (see above) so the
plugin loads the current bundle, then run the smoke suite twice — expect
16/16 both times. If beta still ends up at doc level, instrument
`indentSelection` via `e2e/sdk-repl.mjs` (below).

**Landed this session — whole-rem ops now hit the OS clipboard natively:**

`dd`, `yy`, visual-line `d`/`y` previously wrote the clipboard via
`writeClipboard()` from the sandbox — which **can never work** (see
discoveries). They now go through `nativeClipboardRems()` (adapter):
`editor.selectRem(ids)` → `editor.copy()` → pane-refocus caret recovery,
with `cutRems()` = that + the proven `removeRems()` loop for the delete
family. All verified live: `yy` → `- line` on the OS clipboard
(`clip:native` badge), `v j y` → both bullets, `dd`+`p` round-trip intact,
and typing works immediately after a yank (caret survives). Unit tests
needed no changes (harness semantics already said "clipboard gets the
text" — now it's actually true live).

**Discoveries this session (all probed live on RemNote 1.26.30, §9 updated):**

1. **Sandbox clipboard writes are dead, always**: in the plugin iframe
   `navigator.clipboard.writeText` rejects (`Document is not focused`), the
   `clipboard-write` permission is hard-**denied**, and `execCommand('copy')`
   returns false (no transient user activation ever reaches the iframe —
   stolen keys arrive via async postMessage). `writeClipboard()`'s first two
   tiers are dead weight live; only host-side native paths work. The
   charwise `copyText` action still tries `writeClipboard` first — harmless
   (its select+cut+reinsert fallback does the real work) but a candidate for
   simplification.
2. **`editor.copy()` on a Rem selection works** and writes RemNote's own
   serialization (text/plain `- bullet` lines + rich text/html) — this is
   the only multi-rem clipboard path available to the sandbox.
3. **`editor.cut()` on a Rem selection writes EMPTY html** to the clipboard
   (it serializes *after* removal, apparently). Never use it for rem cuts;
   copy-then-remove instead. (Text-range `cut()` via `selectText` is fine —
   the charwise paths keep using it.)
4. **The `selectRem` "one-way door" has an escape hatch**:
   `window.getFocusedPaneId()` before + `window.setFocusedPaneId(paneId)`
   after clears the Rem selection and restores the text caret to its exact
   pre-selection rem AND column (probed with a marker insert). Everything
   else fails: `collapseSelection`, `moveCaret(Vertical)`, `selectText`,
   `selectRem([])`, `insertPlainText` over the selection, even a real
   Escape (we steal it) — only pane refocus (or a real ArrowDown/click, which
   the plugin can't synthesize) recovers. §9 rewritten accordingly.
5. **RemNote can boot with `pointer-events-none` stuck on
   `.rn-editor-container`** (its suppress-mouse-while-typing state; a real
   pointer never entering the window leaves it set). Symptom: every CDP
   `mouse.click` falls through to `<html>`, `elementFromPoint` returns the
   root, clicks focus nothing — looks exactly like a zoom/coordinate bug
   (it isn't; dpr=1). Both suites now strip the class once at startup;
   `sdk-repl.mjs`/manual sessions may need
   `document.querySelector('.rn-editor-container').classList.remove('pointer-events-none')`.

**New tool — `e2e/sdk-repl.mjs`**: run arbitrary async JS *inside the
sandboxed plugin iframe* with `a` = the live `VimAdapter` and `p` = the
`RNPlugin` (SDK): `node e2e/sdk-repl.mjs 'return await
p.focus.getFocusedRem()'`. Works because the adapter now exposes
`globalThis.__vimAdapter` (constructor; sandbox-scope only). This is how all
of the above was probed — vastly faster than rebuild-and-keypress loops.
Documented in §7.

**Files touched this session** (committed together with this log):
`src/adapter/adapter.ts` (nativeClipboardRems, cutRems, deleteRem/yankRem/
deleteRemSelection/yankRemSelection rewires, yankRemSelection now
invalidates the model, `__vimAdapter` hook, indentSelection rewrite),
`e2e/run.mjs` + `e2e/stress.mjs` (pointer-events strip; stress phase 5
updated to the new v-cycle: `vv`/`vvd` where it meant visual-line),
`e2e/launch.sh` (extracted-AppRun path + APPDIR export, deep-link warning),
`e2e/sdk-repl.mjs` (new).

**Still ☐ after the indent verification** (from the batch below):

- ☐ `o` on a ToDo bullet — verify live it creates a *sibling* (build one
  with `:todo`, press `o`, check `getParentRem()` via sdk-repl).
- ☐ `:todo` on a multi-bullet visual selection — verify live.
- ☐ `Ctrl-W h/l` with a real split pane — verify live.
- ☐ Charwise visual (`v` + `h/l/e` …) selection rendering — eyeball via
  screenshot that the native text selection tracks.
- ☐ Consider simplifying `copyText`/`writeClipboard` given discovery #1
  (drop the dead tiers, or keep as defensive fallback — decide, then align
  the §0.5 wording).

### 2026-07-07 — user-reported bug batch (in progress, Claude)

**Context discovered first:** `dist/` was built 2026-07-06 20:16 but
`src/engine`+`src/adapter` were edited 2026-07-07 ~14:00 — the running plugin
was an OLD build missing today's engine (v-cycle flip, sibling-only `o`,
subtree registers, clipboard). Several user reports were symptoms of the
stale build. Also: the repo had an empty `.git`; a baseline commit of the
pre-fix state is now in history (`main`).

Plan (☑ done / ☐ pending), driven by the user's report:

- ☑ git init + baseline commit; `.gitignore` for node_modules/dist/zip
- ☑ **Ctrl-W h/l panes** — root cause: `ctrl+w` was never in `keymap.ts`, so
  the engine's pane code was unreachable. Added.
- ☑ **v = charwise first** — engine already flipped (v → charwise, `vv` →
  line, `vvv` → normal; j/k still auto-upgrade charwise→line). Unit tests
  updated to the new cycle (they still asserted the old one and failed).
- ☑ **`de` on "a asdf" deleting too much** — `wordEnd` used vim's
  block-cursor rule (`e` must advance ≥2); switched to I-beam rule
  (`e > c`) matching this plugin's between-chars caret model.
- ☑ **`d$`** — already existed as `dgl`/`dgh` g-chords; now unit-tested and
  documented ( `$` itself is unreachable: shift-blind stealing reports `4`).
- ☑ **`;` find-repeat removed** — `;` now always opens the command line;
  `,` keeps reverse-repeat. `/` also opens the command line.
- ☑ **Ctrl-E/Ctrl-Y unbound** — no view-scroll API exists (only caret moves),
  so per user's call the keys are no longer stolen.
- ☑ **Ctrl-O/Ctrl-I jumplist** — new `jump` action; adapter records rem ids
  before jumps (`gg`/`ge`/`:e`) with vim's truncate-forward semantics;
  in-doc return walks the caret (stays alive), cross-doc falls back to
  `window.openRem`.
- ☑ **Yank → system clipboard** — layered: charwise deletes now go through
  native `editor.cut()` (host-side clipboard, sandbox-proof); charwise `y`
  emits new `copyText` action (async clipboard API → execCommand →
  select+cut+reinsert fallback); line register still flattens to
  tab-indented text via `writeClipboard`. Badge shows `clip:` status.
  **Update (evening entry above): verified live — the sandbox tiers can
  never fire; whole-rem ops now use `nativeClipboardRems` instead.**
- ☑ **Normal-mode cursor visibility** — cursorline: `[data-rem-id]
  :focus-within` row tint + colored left bar via registerCSS.
- ☑ **Visual-mode `/` command palette** — `;`/`/`/`:` from visual/visual-line
  enter command mode KEEPING the selection trail (tint stays via render());
  new Ex verbs `:todo`, `:done`, `:untodo` apply to all selected bullets
  (else focused bullet). Command-mode exit always clears the trail.
- ☐ **`o` on ToDo creating a child** — believed fixed by rebuild (old build
  had "child-aware o"; current `newBullet` is sibling-only). Verify live
  against a todo bullet.
- ☑ tests updated + extended (jumplist, clipboard, visual command line,
  charwise g-chords, I-beam `e`): 115/115 green; `tsc` clean
- ☑ live e2e pass — **UNBLOCKED, see the evening entry above**: environment
  works (launch.sh + e2e/.env login persisted), smoke suite 16/16 with
  `VIM_E2E_SETTLE=1600` (then 15/16 ×2 on an indent data race — fix in
  flight, see above), stress 59/59, clipboard tiers verified live. Remaining
  manual probes are re-listed in the evening entry's ☐ section.
- ☑ docs: VIM_STATUS.md was deleted from the working tree mid-session (not
  by Claude — swept into commit daaa04e by `git add -A`; full text
  recoverable from commit 122d18e). Its live content now lives here: feature
  status → §0.5, blockers → §9. `:help` widget (vim_help.tsx) updated with
  the new keys; README links fixed.
- ☑ **Companion-service design notes** — design-only exploration of a
  background companion service (CDP-based) to lift sandbox limits
  (shift-blindness, caret reads, true scrolling, clipboard). Explicitly NOT
  implemented; verdict: park it, file upstream issues first. Written up in
  **[Appendix A](#appendix-a-companion-service-design-notes-design-only-not-implemented)**
  (originally the standalone `SERVICE_NOTES.md`, folded in 2026-07-08).

Engine/adapter contract changes in this batch (for anyone rebasing):

- `Action.deleteRange` gained `yank?: boolean` (route through native cut →
  OS clipboard) and `keepLead?: boolean` (change-family deletes skip the
  column-0 whitespace swallow AND the model's normalizeModel trim; `cw` must
  leave "hello world" as "bye world", not "byeworld").
- New actions: `copyText {text,start?,end?}`, `jump {dir}`.
- `handleCommand` leave-path now always emits `clearRemSelection`.
- Harness mirrors all of the above + `clipboard`/`jumps` fields for tests.

## 0.5 Feature status (what works live)

Formerly VIM_STATUS.md; trimmed to what a contributor needs. Engine suite:
**153/153** unit tests green (run `npm test` — don't trust this number, verify).

Working live in the real app (RemNote 1.26.30, SDK 0.0.46):

- **Modes** — `i` insert / `Esc` normal / `v` charwise visual / `vv`
  visual-line (`v`+`j/k` auto-upgrades) / `;` `/` `:` command line; mode badge
  bottom-right; per-mode key stealing (insert releases everything but Esc).
- **Motions** — `h l 0 w b e f<c> t<c>` `,`(reverse find repeat), counts;
  g-chords for shift-blind capitals: `gl`=`$` `gh`=`^` `gg` `ge`=`G`
  `ga`=`A` (append at line end).
  `e` uses I-beam semantics (any forward progress counts), so `de` on
  `a asdf` deletes just `a`.
- **Operators** — `d c y` + motions/text objects (`dw de db dd df<c> dt<c>
  diw daw`), `dgl`=`d$`, `dgh`=`d^`, `x X s S D C`, `r<c>`, backtick=`~`.
- **Text objects** — `iw aw`, pairs `ib ab`(=`i(`/`a(`) `i[ a[`, quotes
  `i' a'` `` i` a` `` — under d/c/y and in charwise visual (`vi[`). `i{`/`i"`
  exist in the engine but are untypeable live (shifted keys).
- **Marks** — `m<c>` remembers the bullet, `'<c>` jumps back (a jumplist
  entry; `''` returns to the pre-jump spot); `:marks` lists them.
- **`gj`** = vim `J`: join the next sibling bullet (space-separated, its
  children adopted; counts: `3gj`).
- **`C-a`/`C-x`** — increment/decrement the number under/after the cursor,
  with counts (CDP- and real-keyboard-verified, real-input.mjs 2026-07-08).
- **Dot-repeat `.`** — repeats the last completed normal-mode change (`dw`,
  `3x`, `r<c>`, `p`, `gj`, `C-a`…). Changes that enter insert mode (`cw`,
  `o`) are NOT recorded — inserted text never reaches the engine.
- **Charwise visual** — `v` + `h/l/w/b/e/f/gl/gh` to shape; `d x c s y p o`;
  `gg/ge/G` escalate to line-wise to the doc boundary.
- **Visual-line (multi-bullet)** — extend with `j/k`/counts/`gg/ge`; `d`/`x`
  cut, `y` yank, `p` paste, `.`/`,` indent/outdent; `;` or `/` opens the
  command line over the selection; registers carry whole subtrees; caret
  walks to a survivor before any deletion.
- **System clipboard** — charwise deletes route through native text-range
  `editor.cut()`; charwise yanks through `copyText` (live path is the
  select+cut+reinsert fallback — direct sandbox writes are permission-denied,
  see §9); whole-rem ops (`dd`/`yy`/visual-line `d`/`y`) through
  `nativeClipboardRems` (`selectRem` + `editor.copy()` + pane-refocus caret
  recovery) — clipboard gets RemNote's own `- bullet` serialization. Badge
  `clip:` field shows which path fired (`clip:native`/`clip:api`/
  `clip:exec`/`clip:FAIL`).
- **Jumplist** — `Ctrl-O`/`Ctrl-I` over `gg`/`ge`/`:e` jumps (vim
  truncate-forward semantics).
- **Panes** — `Ctrl-H`/`Ctrl-L` focus previous/next pane (the vim-classic
  `C-w h`/`C-w l` chord is also bound but a real Ctrl+W never reaches the
  desktop app — Electron eats it; see §9).
- **Scrolling** — `Ctrl-D`/`Ctrl-U` (caret page-moves; view follows).
  `Ctrl-E`/`Ctrl-Y` deliberately unbound — no view-scroll API exists.
- **Command line** — opened with `;` only (`/` now belongs to RemNote's own
  slash-command menu; `:todo`/`:done`/`:untodo` were removed). `:help` cheat
  sheet; `:e <name>` search+open (a jump); `:w` acknowledged (autosave);
  `:s/pat/repl/[gia]` substitute (visual selection or focused bullet as
  range, `a` = whole doc — but note the shift-blind typeable-regex subset,
  §9); `:vsplit`/`:split`/`:q`/`:only` pane management (undocumented
  `window.setRemWindowTree` RPC; focus follows vim semantics — new pane on
  split, survivor on `:q`); Tab-cycled **wildmenu** of command suggestions
  with live (deduped) `:e`/`:vs`/`:sp` document search; `:sort [n] [rev]`
  (selection siblings or focused bullet's children), `:t`/`:co[py]`
  duplicate, `:d`/`:y` delete/yank bullets (register + OS clipboard like
  dd/yy), `:g/pat/d` global delete, `:marks`. All live-verified 2026-07-08.
- **New bullets** — `o`/`go`(=`O`) always create a *sibling* (never a child).
- **Cursor visibility** — cursorline row tint + colored left caret bar
  outside insert mode.
- **Undo/redo** — `u`/`Ctrl-R` delegate to RemNote's history.

Known limitations (beyond §9 platform blockers):

- Caret column desyncs after an intra-line mouse click (collapsed caret is
  unreadable in the sandbox); re-anchor with `0`/`gl` or enter+leave insert.
- Charwise visual uses a real native text selection, so RemNote's floating
  formatting toolbar pops up over it (harmless; keys keep working).
- Capitals act as their lowercase key (shift-blind stealing); use synonyms.
- `j`/`k` move between Rems — a bullet is one line by construction.

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
`moveCaret(_, MoveUnit.LINE)` are all no-ops in this sandbox — see §9). The
one primitive that *does* move the real, visible
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
distinguish Shift — see `keymap.ts`'s top comment and §9 for the empirical
writeup. Practical consequence for anyone
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

Two independent layers with different jobs. Prefer the unit suite for anything that's pure vim
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
`<c-r>`, `<c-d>`, `<c-u>`, `<c-w>`, `<c-o>`, `<c-i>` for named keys;
everything else char-by-char) and feeds each through `handleKey` exactly like
the adapter does, except insert-mode plain characters are typed directly into
`lines` (mirroring that insert mode releases stolen keys live). Use a 4th
constructor arg (`indents: number[]`) to build a nested-tree fixture for
visual-line tests. `Harness.clipboard` models what the adapter would have
written to the system clipboard; `jumps`/`jumpPos` model the adapter's
jumplist with row numbers standing in for rem ids.

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

### Real-input delivery test — `e2e/real-input.mjs`

The CDP suites synthesize input inside the renderer and therefore CANNOT see
keys the Electron main process eats (real Ctrl+W — §9). This script sends
kernel-level uinput events via **ydotool** — the identical path to a physical
keyboard — and asserts on what actually reaches the plugin's key steal (read
from the debug badge). Covers `h`, `C-h`/`C-l`, `C-o`/`C-i` (CDP-invisible,
only this suite can see them) and documents the `C-w` hole:

```bash
systemctl --user start ydotool        # once per session (user service exists)
REMNOTE_CDP_PORT=9223 node e2e/real-input.mjs
```

The e2e RemNote window must be FOCUSED in the compositor (real keys go to the
focused window; the script aborts otherwise instead of typing into whatever
else is focused). Run this whenever you add a modifier-chord binding — a
chord that passes the CDP suites can still be dead at a real keyboard.

### SDK REPL — `e2e/sdk-repl.mjs`

Runs an async JS body *inside the sandboxed plugin iframe*, with `a` bound to
the live `VimAdapter` instance and `p` to the `RNPlugin` (the adapter exposes
itself as `globalThis.__vimAdapter` for exactly this):

```bash
node e2e/sdk-repl.mjs 'const f = await p.focus.getFocusedRem(); return f?.text;'
node e2e/sdk-repl.mjs 'return (await p.editor.getSelection())?.type ?? "none";'
```

This is the fastest way to answer "what does SDK call X actually do live?" —
no rebuild, no keypress choreography. All of the §9 selection/clipboard
findings were probed this way. Caveats: the app must be running with the dev
plugin loaded (it attaches to the `localhost:8080` iframe CDP target), and
state you mutate is real — clean up after probes. Remember the app restart
requirement when you edit adapter code (§0 evening entry): the iframe does
not pick up rebuilds; `pkill -f 'remote-debugging-port=9223'` and relaunch.

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

What's actually enforced in code you'll touch (all verified empirically
against RemNote 1.26.30):

- **Key stealing is SHIFT-BLIND.** The steal matcher reports the bare key
  regardless of Shift, and `shift+…` specs never match at all (probed live:
  with only `shift+v` stolen, neither `v` nor `V` is captured; with `v`
  stolen, both are captured and reported as `v`; `$` reports as `4`, `Q` as
  `q`). Ctrl combinations DO match correctly.
- **Leading whitespace**: RemNote's data layer trims it from a Rem
  immediately while the editor keeps it until a later normalization. The
  adapter mirrors the trim (`normalizeModel`) and extends column-0 deletes
  over the doomed whitespace — except `keepLead` (change-family) deletes,
  which stay vim-exact because an insert follows immediately.

- **Shift is unobservable** (`keymap.ts` top comment) → no real capital-key
  bindings, ever. Use the synonym pattern (§6).
- **The command line is shift-blind too** (typed Ex characters arrive through
  the same steal): capitals and shifted punctuation are UNTYPEABLE in
  `:commands` — `ALPHA` arrives as `alpha`, `$`→`4`, `%`→`5`, `(`→`9`,
  `)`→`0`, `^`→`6`, `*`→`8`, `?`→`/`. Practical `:s` fallout: patterns are
  limited to the unshifted regex subset (literals, `.`, `[...]`, `\d`/`\w`/
  `\b`-style escapes, `\/`); regex groups, `$`-forms in the replacement
  (`$1`, `$&`, `$$`) and therefore vim `\1` backrefs are code-correct
  (verified via direct `substitute()` calls) but unreachable from the
  keyboard; case-changing substitutions are impossible. Don't "fix" a
  capital-letter `:s` bug report — it's this.
- **`setRemWindowTree` regenerates every pane id and drops the pane focus**
  (`getFocusedPaneId()` → null, caret dead until a pane is focused). There is
  also NO layout getter, so a hand-arranged nested layout can only be rebuilt
  flat. After any tree write, re-fetch `getOpenPaneIds()` (order matches the
  leaf order — verified live) and `setFocusedPaneId` the intended leaf; that
  also restores the caret to the pane's last-focused rem. `setPaneTree()` in
  the adapter is the reference implementation — route new layout writes
  through it.
- **`positionAmongstSiblings()` races the data layer right after an edit** —
  it can return a stale position or effectively make a rem its own
  previous/next sibling. Bit `indentSelection` (2026-07-07, fixed by deriving
  the destination once per run) and `joinRem` (2026-07-08, fixed by locating
  the sibling by id in `getChildrenRem()` instead). When you need "the rem
  next to X" right after a mutation, find X by id in the children list and
  index from there — don't re-query positions.
- **SDK `rem.remove()` of a currently-rendered rem leaves a ZOMBIE row** —
  the data layer drops it (reads/search agree) but the open document keeps
  rendering it, and a click focuses the detached rem (a substitute aimed at
  "the focused bullet" then edits the zombie: reproduced live). Mostly an
  e2e/scripting hazard: after SDK-side removals, force a re-render with an
  `openRem` round-trip (another doc, then back) before clicking anything.
- **The collapsed caret can't be read**, only moved relatively (§6) → don't
  add code that assumes you can query "where is the caret right now" from
  RemNote directly; track it in the model instead.
- **`requestNative: true` currently does nothing** (manifest.json has it set
  to `false`; `domCaret.ts` exists for if/when RemNote unblocks it, but
  `hostDocument()` will keep returning `null` in the sandbox until then).
- **Direct clipboard writes from the sandbox NEVER work** (probed live):
  `navigator.clipboard.writeText` rejects with "Document is not focused",
  the `clipboard-write` permission is hard-denied for the plugin iframe, and
  `execCommand('copy')` returns false (no user activation ever reaches the
  iframe — stolen keys arrive by async postMessage). Every clipboard write
  must ride a native editor operation in the host: text-range
  `selectText`+`cut()` (charwise) or `selectRem`+`copy()` (whole-rem).
- **`editor.cut()` on a Rem selection writes EMPTY html to the clipboard**
  (it serializes after removal). For rem cuts: `copy()` first, then remove
  via the SDK (`cutRems` in the adapter). Text-range `cut()` is unaffected.
- **`editor.selectRem` blurs the caret — recover it with a pane refocus.**
  The old "one-way door, never call it" rule is obsolete: capture
  `window.getFocusedPaneId()` before selecting, call
  `window.setFocusedPaneId(paneId)` after, and the Rem selection clears with
  the caret restored to its exact pre-selection rem AND column (verified
  with a marker insert). Nothing else recovers it: `collapseSelection`,
  `moveCaret`/`moveCaretVertical`, `selectText`, `selectRem([])`,
  `insertPlainText`, and even a real Escape (stolen by us) all leave the
  selection stuck — and while it's stuck, typed keys bypass the steal and
  open RemNote's selection-actions popup. Use `nativeClipboardRems` as the
  reference implementation; visual-line mode still uses the CSS-tint trail
  (a persistent native selection would keep the caret dead between keys).
- **A real Ctrl+W NEVER reaches the renderer on the desktop app** — Electron
  consumes it in the main process before any web content sees it (verified
  with kernel-level uinput via ydotool: the keydown never fires in the page,
  while Ctrl+H/L/J/K/O/I all arrive). **CDP tests are blind to this**:
  CDP-synthesized input is injected inside the renderer, bypassing the
  Electron layer, so a `C-w` binding looks green over CDP and is dead at a
  real keyboard. Any new modifier-chord binding must be verified with
  `e2e/real-input.mjs` (§7) before trusting it. Pane nav therefore lives on
  Ctrl-H/Ctrl-L (the `C-w` chord stays bound for hosts that deliver it).
- **Ctrl-chord delivery splits THREE ways** (all verified 2026-07-08) — this
  is subtler than the C-w blocker and bit a bughunt hard:
  - `C-d` / `C-u` / `C-r` reach RemNote's key steal via **CDP** (so
    run.mjs/stress.mjs can drive them).
  - `C-o` / `C-i` do **NOT** reach the steal via CDP (rx never increments) but
    **DO** via real hardware (ydotool). So the jumplist looks broken under CDP
    and works at a real keyboard — do not "fix" a jumplist bug you only saw in
    a CDP test; reproduce it with `e2e/real-input.mjs` first.
  - `C-w` reaches neither (previous bullet).
  Net: `run.mjs`/`stress.mjs` cannot cover `C-o`/`C-i`/`C-w`; only
  `real-input.mjs` can.
- **`elementFromPoint` can fall through to `<html>` even with pointer-events
  fine**, making CDP `mouse.click` focus nothing. Two distinct causes seen:
  (1) the **daily-template banner** rendering/dismissing shifts bullet Y
  positions, so a precomputed click coord lands in empty space — dismiss the
  banner and click via a Playwright **locator** (position resolved at
  click-time); (2) leftover **`selectRem` state** stuck as
  `.in-selected-portal` on `.rn-editor-container` deadens hit-testing until a
  full app relaunch. If clicks mysteriously stop focusing, relaunch the app
  rather than fighting it.
- **RemNote can boot with `pointer-events-none` stuck on
  `.rn-editor-container`** (suppress-mouse-while-typing state that never
  clears when no real pointer enters the window — an e2e/CDP hazard more
  than a user-facing one). All CDP clicks then fall through to `<html>` and
  focus nothing. The e2e suites strip the class at startup; do the same in
  manual sessions if clicks mysteriously no-op.
- **A freshly launched window swallows synthetic CDP clicks until
  `page.bringToFront()`** (found 2026-07-08 night, cost a full debug loop):
  clicks dispatch fine but `document.activeElement` stays `BODY` and no rem
  ever focuses, while keystrokes still reach the key steal (rx increments) —
  so rem-targeted commands silently no-op. All suites now call
  `bringToFront()` right after connecting; do the same in ad-hoc scripts.
- **RemNote's own Ctrl+E opens the audio-embed widget** (on an empty bullet
  it renders the "Insert an Audio URL" box and wedges the doc for e2e).
  The plugin deliberately does NOT steal Ctrl+E/Ctrl+Y (no view-scroll API,
  see engine.ts), so never press them in suites — stress.mjs dropped its
  `<c-e>`/`<c-y>` steps for exactly this reason (user-reported wedge).

## 10. Build & release

```bash
npm run check-types   # tsc --noEmit, run before committing
npm run build          # rm -rf dist && webpack (production) && zip dist/ → PluginZip.zip
```

`PluginZip.zip` is the distributable uploaded via RemNote's plugin store flow
(or side-loaded). `public/manifest.json` is copied into `dist/` verbatim by
`CopyPlugin` in `webpack.config.js` — bump `version` there for a release.

---

## Appendix A. Companion-service design notes (design-only, not implemented)

The plugin has hit four hard walls that no amount of in-sandbox cleverness
removes (§9): shift-blind key stealing, an unreadable collapsed caret, no
view-scroll API, and second-class clipboard access from an unfocused sandbox
iframe. This appendix thinks through whether a local background service could
lift them, what it would look like, and whether it is worth the cost.
**Design-only; do not implement from this document without an explicit
decision.** (Formerly the standalone `SERVICE_NOTES.md`, folded in here so the
project has a single developer guide.)

### The one-line pitch

The e2e harness already proves the approach: a process attached to RemNote
over the Chrome DevTools Protocol (CDP) has full host-page access — real DOM
selections, real key events with modifier state, real scrolling, native
clipboard. A small always-on daemon doing exactly what `e2e/ctl.mjs` does,
plus a WebSocket bridge to the plugin, turns every "impossible" item into a
feature.

### What it would unlock, concretely

| Sandbox limitation | With a CDP companion |
|---|---|
| Shift-blindness → synonym table (`gl`=`$`, `ge`=`G`, `vv`=`V`) | A capture-phase `keydown` listener in the host page sees `key`, `shiftKey`, `ctrlKey` exactly. Real `$ ^ V G A O ~ : > <` become bindable; the synonym table becomes an optional fallback. |
| Collapsed caret unreadable → column desync after mouse clicks | Host-page `getSelection()` reads the caret directly; push `{caret}` events to the plugin on every selectionchange. The model never desyncs again. |
| No view scrolling → Ctrl-E/Ctrl-Y removed | `scroller.scrollBy(0, dy)` on the editor scroll container. True vim scroll (view moves, cursor stays). |
| Clipboard writes may be blocked in the unfocused iframe | The service process writes the OS clipboard itself (`wl-copy` on this machine, or CDP `Browser.setPermission` + host-page `navigator.clipboard`). Deterministic, no fallback tiers. *Update 2026-07-07: mostly solved in-sandbox — whole-rem yanks now ride `selectRem`+`editor.copy()` with pane-refocus caret recovery (§9), so the daemon's clipboard value shrinks to exotic cases (yank without any native op, custom formats).* |
| `/` opens RemNote's own slash menu only for the focused bullet | The service can synthesize real key events (`Input.dispatchKeyEvent`) — or the plugin keeps its own `:`-command palette and the service just supplies real keys. |

### Architecture sketch (option A — recommended shape *if* this is ever built)

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

### Alternatives considered (and why they lose)

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

### Costs and risks of option A (the honest part)

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

### If it ever goes ahead: staged plan (smallest useful slice first)

1. **Caret mirror only** (read-only, no key handling): daemon pushes caret
   offsets; plugin drops the click-desync limitation. Lowest risk, validates
   the bridge end-to-end.
2. **Clipboard verb**: replaces the three-tier fallback with one native call.
3. **Scroll verb**: restore Ctrl-E/Ctrl-Y as true scrolling.
4. **Shift-faithful key layer**: real `$`, `V`, `:` … retire the synonym
   table by default, keep it as the no-daemon fallback.

Each stage independently useful, independently revertible, and the plugin
stays fully functional at every stage with the daemon off.

### Verdict

Technically sound and already 80 % proven by the e2e infrastructure, but it
buys polish, not capability the current plugin lacks entirely — every
blocked item now has a workable synonym or fallback. Recommendation: park
this until either (a) the click-desync/caret issue becomes a daily
irritation, or (b) RemNote ships native plugins (option C), which would
obsolete most of the daemon. Re-evaluate after filing the upstream issues
about shift-blind `stealKeys` and native-plugin availability — a fix on
their side is strictly better than any of this.
