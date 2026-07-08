# Contributing to remnote-vim

Thanks for wanting to help. This plugin brings modal, vim-style editing to the
RemNote desktop app. The short version of how to work on it is below;
[**DEVELOPMENT.md**](./DEVELOPMENT.md) is the full deep-dive (architecture, the
platform constraints that shape every design decision, and concrete recipes for
adding commands or debugging live).

## Getting set up

```bash
git clone https://github.com/onegraund/remnote-vim
cd remnote-vim
npm install
npm run dev          # webpack-dev-server on http://localhost:8080
```

Then in RemNote: **Settings → Plugins → Build → Develop from localhost**, enter
`http://localhost:8080/`, click **Develop**, and turn on the "Vim Mode" toggle.
A `-- NORMAL --` badge appears bottom-right when it's active.

## The one rule that keeps this codebase sane

Keep the two halves separate:

- **`src/engine/`** is a synchronous, pure state machine —
  `(VimState, key, {text, caret}) → (VimState, Action[])`. It has never heard of
  RemNote, awaits nothing, and touches no DOM. This is where vim *semantics*
  live, and it's exhaustively unit-tested with a fake editor.
- **`src/adapter/`** is the only code that talks to the RemNote plugin SDK. It
  turns stolen keys into engine symbols, runs the engine, and executes the
  returned `Action`s against RemNote.

New motion / operator / mode behavior → `src/engine/` (with tests). New way of
talking to RemNote (an `Action` case, an SDK call, a key to steal) →
`src/adapter/`. See DEVELOPMENT.md §1–§2.

## Tests

```bash
npm run check-types   # tsc
npm test              # engine unit tests (Vitest) — fast, deterministic, no RemNote
npm run e2e           # live end-to-end against a running RemNote (local only)
```

CI runs the type-check, unit tests, and a production build on every PR. The
**engine suite is the contract** — add or update tests for any behavior you
change. The live `e2e/` harness needs a running RemNote with a debug port and a
test account (`cp e2e/.env.example e2e/.env`); it can't run in CI. See
DEVELOPMENT.md §7 for how to drive it.

## Before you open a PR

- `npm run check-types` and `npm test` are green.
- If the change is user-visible, update the `;help` sheet
  (`src/widgets/vim_help.tsx`) and the feature status in DEVELOPMENT.md §0.5.
- Note whether you live-verified in the real app — many bugs only show up
  against RemNote's async data layer, not the fake editor (DEVELOPMENT.md §6, §9).

## Reporting bugs

Use the issue templates. Because RemNote's plugin sandbox can't see the Shift
key, many capitals and symbols are intentionally remapped (`$`→`gl`, `G`→`ge`,
`A`→`ga`, …). Check `;help` and the README's "Known limitations" before filing —
it might be working as designed.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
