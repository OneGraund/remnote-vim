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
  { spec: 'ctrl+e', sym: 'C-e' },
  { spec: 'ctrl+y', sym: 'C-y' },
];

const plainLetters: KeyBinding[] = letters.map((l) => ({ spec: l, sym: l }));
const plainDigits: KeyBinding[] = digits.map((d) => ({ spec: d, sym: d }));
const plainPunct: KeyBinding[] = [
  { spec: ';', sym: ';' },
  { spec: ',', sym: ',' },
  { spec: '.', sym: '.' },
  { spec: '`', sym: '`' },
];

export const NORMAL_BINDINGS: KeyBinding[] = [
  ...named,
  ...plainLetters,
  ...plainDigits,
  ...plainPunct,
];

export const INSERT_BINDINGS: KeyBinding[] = [{ spec: 'escape', sym: 'Escape' }];

export const ALL_BINDINGS: KeyBinding[] = NORMAL_BINDINGS;

/**
 * Map an is-hotkey spec (as reported by RemNote's steal event) to an engine
 * symbol. Built in binding order so shifted specs resolve first.
 */
export const SPEC_TO_SYM: Record<string, string> = {};
for (const b of ALL_BINDINGS) {
  if (!(b.spec in SPEC_TO_SYM)) SPEC_TO_SYM[b.spec] = b.sym;
}

export function bindingsForMode(mode: string): KeyBinding[] {
  return mode === 'insert' ? INSERT_BINDINGS : NORMAL_BINDINGS;
}
