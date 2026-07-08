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
  /**
   * Leave visual mode: collapse any active NATIVE text selection and place
   * the caret at `at`. Distinct from setCaret because a plain relative
   * moveCaret against a live selection shrinks/extends it instead of
   * collapsing (observed live: Escape from `v ll` left "be" selected and the
   * selection toolbar open). When a text selection is active, a collapsed
   * selectText range is the one API that both clears it AND sets the caret
   * absolutely; with no selection the adapter falls back to the setCaret
   * relative-move path.
   */
  | { t: 'collapseSelection'; at: number }
  /**
   * `yank: true` marks register-worthy deletes (x, dw, visual d, c, s, …):
   * the adapter routes them through the editor's native CUT so the removed
   * text also lands on the system clipboard, vim `clipboard=unnamed` style.
   * Internal edits (r, ~, visual-p replace) leave the clipboard alone.
   *
   * `keepLead: true` suppresses the adapter's column-0 whitespace swallow
   * (RemNote's data layer trims leading spaces, so plain deletes remove them
   * eagerly). Change-style deletes set it: text is typed/inserted right at
   * the start, so no leading space survives anyway and vim's exact range
   * must be kept (`cw` on "hello world" must leave the space alone).
   */
  | { t: 'deleteRange'; start: number; end: number; yank?: boolean; keepLead?: boolean }
  | { t: 'insertText'; at: number; text: string }
  /**
   * Put `text` on the system clipboard (yank without deleting). `start`/`end`
   * give the source range in the focused line so the adapter can fall back to
   * a native cut+reinsert when direct clipboard writes are blocked.
   */
  | { t: 'copyText'; text: string; start?: number; end?: number }
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
  /** Jumplist navigation: Ctrl-O (back, -1) / Ctrl-I (forward, +1). */
  | { t: 'jump'; dir: -1 | 1 }
  /** `m<c>`: remember the focused Rem under a single-char mark name. */
  | { t: 'setMark'; name: string }
  /** `'<c>`: jump to a mark (a jumplist entry, like vim). */
  | { t: 'gotoMark'; name: string }
  /**
   * `gj` (vim J): join the focused bullet with its next sibling `count`
   * times — sibling text appended with a space, its children adopted.
   */
  | { t: 'joinRem'; count: number }
  /**
   * `.` (dot-repeat): re-feed the recorded keys of the last normal-mode
   * change through the engine. The executor must run them through the same
   * key loop it uses for real keys (fresh snapshot per key).
   */
  | { t: 'replayKeys'; keys: string[] }
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
  | { p: 'pane' }
  /** `m` pressed; waiting for the mark name. */
  | { p: 'mark' }
  /** `'` pressed; waiting for the mark name to jump to. */
  | { p: 'gotoMark' };

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
  /** Dot-repeat: keys of the normal-mode command currently being typed. */
  keyLog: string[];
  /** Dot-repeat: keys of the last completed normal-mode CHANGE (`.` replays). */
  lastChange: string[] | null;
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
    keyLog: [],
    lastChange: null,
  };
}

export interface EngineResult {
  state: VimState;
  actions: Action[];
}
