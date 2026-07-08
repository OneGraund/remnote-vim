/**
 * Keys to steal from RemNote (is-hotkey syntax) and the engine symbol each maps
 * to.
 *
 * HARD PLATFORM CONSTRAINT (verified empirically): RemNote's steal matcher is
 * shift-blind. A bare spec like 'v' matches BOTH v and Shift+V and reports the
 * same spec string, while 'shift+v'-style specs never match anything at all.
 * So shifted characters are indistinguishable from their unshifted keys, and
 * capital-letter vim commands (V, A, I, O, $, ~, <, >, :) cannot be bound to
 * their real keys. The engine provides unshifted synonyms instead: `vv` for
 * visual-line, `g`-chords (ge/gl/gh/go) for G/$/^/O, backtick for ~, `;` for
 * `:` when no find is pending, and `.`/`,` for `>`/`<` in visual-line mode.
 *
 * Ctrl combinations DO match correctly (ctrl+d etc. verified live).
 */
export interface KeyBinding {
  spec: string;
  sym: string;
}

const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
const digits = '0123456789'.split('');

const named: KeyBinding[] = [
  { spec: 'escape', sym: 'Escape' },
  { spec: 'enter', sym: 'Enter' },
  { spec: 'space', sym: ' ' },
  { spec: 'backspace', sym: 'Backspace' },
  { spec: 'ctrl+r', sym: 'C-r' },
  { spec: 'ctrl+d', sym: 'C-d' },
  { spec: 'ctrl+u', sym: 'C-u' },
  // Ctrl-E/Ctrl-Y are NOT stolen: RemNote has no view-scroll API, so the vim
  // behavior (scroll without moving the cursor) cannot be implemented.
  // Ctrl-W is stolen but NEVER ARRIVES on the desktop app: Electron consumes
  // a real Ctrl+W before the renderer sees it (verified with kernel-level
  // uinput — the keydown never fires; CDP-synthesized input bypasses that
  // layer, so CDP tests are blind to it). Kept for hosts that deliver it;
  // Ctrl-H/Ctrl-L below are the reachable pane-nav bindings.
  { spec: 'ctrl+w', sym: 'C-w' },
  { spec: 'ctrl+h', sym: 'C-h' },
  { spec: 'ctrl+l', sym: 'C-l' },
  { spec: 'ctrl+o', sym: 'C-o' },
  { spec: 'ctrl+i', sym: 'C-i' },
];

const plainLetters: KeyBinding[] = letters.map((l) => ({ spec: l, sym: l }));
const plainDigits: KeyBinding[] = digits.map((d) => ({ spec: d, sym: d }));
const plainPunct: KeyBinding[] = [
  { spec: ';', sym: ';' },
  { spec: ',', sym: ',' },
  { spec: '.', sym: '.' },
  { spec: '`', sym: '`' },
  // '/' is deliberately NOT stolen: RemNote's slash-command menu owns it
  // (the vim command line lives on ';').
];

export const NORMAL_BINDINGS: KeyBinding[] = [
  ...named,
  ...plainLetters,
  ...plainDigits,
  ...plainPunct,
];

export const INSERT_BINDINGS: KeyBinding[] = [{ spec: 'escape', sym: 'Escape' }];

// While TYPING a command line every printable key must reach the engine, not
// the document underneath — including keys normal mode leaves to RemNote.
// '/' here is the :s separator (`s/foo/bar/g`); the rest make :e arguments
// with hyphens etc. typeable. Shifted characters stay unreachable
// (shift-blind stealing), so command syntax must never REQUIRE them.
const commandExtra: KeyBinding[] = ['/', '-', '=', "'", '[', ']', '\\'].map(
  (c) => ({ spec: c, sym: c })
);
export const COMMAND_BINDINGS: KeyBinding[] = [
  ...NORMAL_BINDINGS,
  ...commandExtra,
  { spec: 'tab', sym: 'Tab' }, // wildmenu completion cycling
];

export const ALL_BINDINGS: KeyBinding[] = COMMAND_BINDINGS;

/**
 * Map an is-hotkey spec (as reported by RemNote's steal event) to an engine
 * symbol. Built in binding order so shifted specs resolve first.
 */
export const SPEC_TO_SYM: Record<string, string> = {};
for (const b of ALL_BINDINGS) {
  if (!(b.spec in SPEC_TO_SYM)) SPEC_TO_SYM[b.spec] = b.sym;
}

export function bindingsForMode(mode: string): KeyBinding[] {
  if (mode === 'insert') return INSERT_BINDINGS;
  if (mode === 'command') return COMMAND_BINDINGS;
  return NORMAL_BINDINGS;
}
