## What this changes

<!-- One or two sentences. Link the issue if there is one (Fixes #123). -->

## Where the change lives

- [ ] `src/engine/` — pure vim semantics (a motion / operator / mode transition)
- [ ] `src/adapter/` — RemNote-facing (a new Action, SDK call, or key steal)
- [ ] docs / tests / tooling only

## Checklist

- [ ] `npm run check-types` passes
- [ ] `npm test` passes (added/updated engine tests for new behavior)
- [ ] Live-verified in the real app, or noted why not (see DEVELOPMENT.md §7)
- [ ] Updated the `;help` sheet (`src/widgets/vim_help.tsx`) and DEVELOPMENT.md
      §0.5 if this adds or changes a user-visible command

<!--
Keep engine logic in src/engine/ (pure, unit-tested) and RemNote calls in
src/adapter/ — that boundary is the reason the core is testable. See
DEVELOPMENT.md §1.
-->
