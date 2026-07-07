/** Vim modes. */
export type Mode = 'normal' | 'insert' | 'visual' | 'visual-line' | 'command';

/**
 * What the engine sees of the editor at the moment a key arrives.
 * `text` is the flattened text of the focused line (Rem), `caret` is a
 * between-characters offset in [0, text.length].
 */
export interface Snapshot {
  text: string;
  caret: number;
}

/**
 * Abstract editor operations. The engine never touches the editor —
 * it emits these and an adapter (RemNote plugin, fake editor in tests)
 * executes them in order.
 */
export type Action =
  | { t: 'setCaret'; at: number }
  | { t: 'select'; start: number; end: number }
  | { t: 'deleteRange'; start: number; end: number }
  | { t: 'insertText'; at: number; text: string }
  | { t: 'moveVertical'; dir: -1 | 1; count: number }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'deleteRem'; count: number }
  | { t: 'yankRem'; count: number }
  | { t: 'pasteRem'; where: 'below' | 'above'; count: number }
  | { t: 'newBullet'; where: 'below' | 'above' }
  | { t: 'indent' }
  | { t: 'outdent' }
  /**
   * Visual-line selection, vim-style: the caret physically walks visible
   * rows. `vStart` anchors on the focused Rem; each `vExtend` moves the
   * selection head one visible row down (+1) or up (-1) — crossing sibling
   * boundaries into parents/ancestors exactly like vim's V+j/k. The adapter
   * owns the resulting trail; selecting a parent row covers its subtree.
   */
  | { t: 'vStart' }
  | { t: 'vExtend'; dir: -1 | 1; count: number }
  | { t: 'deleteRemSelection' }
  | { t: 'yankRemSelection' }
  | { t: 'indentSelection' }
  | { t: 'outdentSelection' }
  | { t: 'clearRemSelection' }
  | { t: 'goDoc'; where: 'start' | 'end' }
  /** Move the caret vertically by `count` Rems, page-style (Ctrl-D/U/E/Y). */
  | { t: 'scroll'; dir: -1 | 1; count: number }
  /** Run an Ex command line (without the leading ':'), e.g. "wq", "e foo". */
  | { t: 'runEx'; cmd: string }
  /** Focus the previous (-1) or next (+1) pane (Ctrl-W h / Ctrl-W l). */
  | { t: 'focusPane'; dir: -1 | 1 }
  | { t: 'mode'; mode: Mode };

/** The register: either in-line text or whole-line (Rem) content held by the adapter. */
export type Register = { kind: 'char'; text: string } | { kind: 'line' };

export type Operator = 'd' | 'c' | 'y' | '>' | '<';

/** Keys the engine is still waiting to complete (multi-key commands). */
export type Pending =
  | { p: 'none' }
  | { p: 'g' }
  | { p: 'replace' }
  | { p: 'find'; key: 'f' | 'F' | 't' | 'T' }
  | { p: 'textobj'; key: 'i' | 'a' }
  /** Ctrl-W pressed; waiting for the pane-direction key (h/l/w). */
  | { p: 'pane' };

export interface VimState {
  mode: Mode;
  /** Count digits typed before a command/motion, e.g. "12" in `12j`. */
  count: string;
  /** Pending operator and the count typed before it (`2d3w` → opCount "2"). */
  op: Operator | null;
  opCount: string;
  pending: Pending;
  register: Register | null;
  /** Last f/F/t/T search, for `;` and `,`. */
  lastFind: { key: 'f' | 'F' | 't' | 'T'; ch: string } | null;
  /** Visual mode: anchor and head as between-char offsets. */
  anchor: number;
  head: number;
  /** Command-line mode: text typed after `:` (excludes the leading colon). */
  commandLine: string;
}

export function initialState(): VimState {
  return {
    mode: 'insert',
    count: '',
    op: null,
    opCount: '',
    pending: { p: 'none' },
    register: null,
    lastFind: null,
    anchor: 0,
    head: 0,
    commandLine: '',
  };
}

export interface EngineResult {
  state: VimState;
  actions: Action[];
}
