import {
  ATOMIC_CH,
  cpBack,
  cpForward,
  cpStart,
  cpWidthAt,
  findCharCount,
  firstNonBlank,
  nextWordStart,
  numberAt,
  pairObject,
  prevWordStart,
  quoteObject,
  stopsBetween,
  wordEnd,
  wordObject,
  MotionResult,
} from './motions';
import { Action, EngineResult, Mode, Operator, Snapshot, VimState, initialState } from './types';

export { initialState };

/**
 * Feed one normalized key into the engine.
 *
 * Keys are engine symbols, not raw hotkey specs: single characters
 * ('a', 'A', '$', '0', ' '), or named keys 'Escape', 'Enter',
 * 'Backspace', 'C-r'.
 */
export function handleKey(state: VimState, key: string, snap: Snapshot): EngineResult {
  const res = dispatch(state, key, snap);
  return recordDotRepeat(state, key, res);
}

function dispatch(state: VimState, key: string, snap: Snapshot): EngineResult {
  switch (state.mode) {
    case 'insert':
      return handleInsert(state, key, snap);
    case 'normal':
      return handleNormal(state, key, snap);
    case 'visual':
      return handleVisual(state, key, snap);
    case 'visual-line':
      return handleVisualLine(state, key, snap);
    case 'command':
      return handleCommand(state, key, snap);
  }
}

/** Document-mutating actions worth repeating with `.` (undo/redo are not). */
const DOT_MUTATING = new Set<Action['t']>([
  'deleteRange',
  'insertText',
  'deleteRem',
  'pasteRem',
  'indent',
  'outdent',
  'joinRem',
]);

/**
 * Dot-repeat bookkeeping. A repeatable change is a key sequence that starts
 * AND completes in normal mode and emits a mutating action — `dw`, `3dd`,
 * `rx`, `p`, `gj`, `C-a`… Commands that enter insert mode (`cw`, `o`) are
 * not recorded: inserted text never reaches the engine (insert mode releases
 * every key), so a replay could only do half the change. `.` itself emits
 * `replayKeys` (not mutating), so it never records itself; the replayed keys
 * re-record naturally, keeping `lastChange` stable across repeats.
 */
function recordDotRepeat(pre: VimState, key: string, res: EngineResult): EngineResult {
  if (pre.mode !== 'normal') {
    if (res.state.keyLog.length) res.state = { ...res.state, keyLog: [] };
    return res;
  }
  const log = [...pre.keyLog, key];
  const st = res.state;
  const inProgress =
    st.mode === 'normal' &&
    (st.op !== null || st.pending.p !== 'none' || st.count !== '' || st.opCount !== '');
  if (inProgress) {
    res.state = { ...st, keyLog: log };
  } else if (st.mode === 'normal' && res.actions.some((a) => DOT_MUTATING.has(a.t))) {
    res.state = { ...st, keyLog: [], lastChange: log };
  } else if (st.keyLog.length) {
    res.state = { ...st, keyLog: [] };
  }
  return res;
}

// ---------------------------------------------------------------- command line

const PAGE = 12; // Rems moved by Ctrl-D / Ctrl-U

function handleCommand(state: VimState, key: string, snap: Snapshot): EngineResult {
  // Command mode can be entered from visual/visual-line with the selection
  // kept alive (so range commands can act on it). Leaving command mode — by
  // running a command or cancelling — always drops that selection: the rem
  // trail via clearRemSelection AND any native charwise text selection via
  // collapseSelection (entered-from-`v` case).
  const leave = (actions: Action[]): EngineResult => ({
    state: { ...state, mode: 'normal', commandLine: '' },
    actions: [
      ...actions,
      { t: 'clearRemSelection' },
      { t: 'collapseSelection', at: snap.caret },
      { t: 'mode', mode: 'normal' },
    ],
  });
  if (key === 'Escape') {
    return leave([]);
  }
  if (key === 'Enter') {
    const cmd = state.commandLine.trim();
    return leave(cmd ? [{ t: 'runEx', cmd }] : []);
  }
  if (key === 'Backspace') {
    // Backspacing past the ':' leaves command mode entirely.
    if (state.commandLine.length === 0) {
      return leave([]);
    }
    return { state: { ...state, commandLine: state.commandLine.slice(0, -1) }, actions: [] };
  }
  if (key.length === 1) {
    return { state: { ...state, commandLine: state.commandLine + key }, actions: [] };
  }
  return { state, actions: [] };
}

// ---------------------------------------------------------------- helpers

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function toMode(state: VimState, mode: Mode, actions: Action[]): EngineResult {
  return {
    state: { ...state, mode, count: '', op: null, opCount: '', pending: { p: 'none' } },
    actions: [...actions, { t: 'mode', mode }],
  };
}

function reset(state: VimState, actions: Action[] = []): EngineResult {
  return {
    state: { ...state, count: '', op: null, opCount: '', pending: { p: 'none' } },
    actions,
  };
}

function countOf(state: VimState): number {
  const c = state.count === '' ? 1 : parseInt(state.count, 10);
  const oc = state.opCount === '' ? 1 : parseInt(state.opCount, 10);
  return c * oc;
}

// ---------------------------------------------------------------- insert

function handleInsert(state: VimState, key: string, _snap: Snapshot): EngineResult {
  if (key === 'Escape') {
    return toMode(state, 'normal', []);
  }
  // Insert mode only steals Escape; anything else is unexpected — ignore.
  return { state, actions: [] };
}

// ---------------------------------------------------------------- motions

interface Motion {
  result: MotionResult;
  /** Line-wise motions (j/k) don't produce a char target. */
  vertical?: -1 | 1;
}

/**
 * Try to interpret `key` as a motion in the current context.
 * Returns null if the key is not a motion.
 */
function motionFor(
  state: VimState,
  key: string,
  snap: Snapshot,
  head: number
): Motion | null {
  const { text } = snap;
  const n = text.length;
  const count = countOf(state);

  const simple = (target: number, landsOn = false): Motion => ({
    result: { target: clamp(target, 0, n), landsOn },
  });

  switch (key) {
    // h/l step whole CODE POINTS: an astral char (emoji, or the adapter's
    // atomic-element placeholder) is one caret stop, never half of one.
    case 'h':
    case 'Backspace':
      return simple(cpBack(text, head, count));
    case 'l':
    case ' ':
      return simple(cpForward(text, head, count));
    case '0':
      return simple(0);
    case '^':
      return simple(firstNonBlank(text));
    case '$':
      return { result: { target: n, landsOn: true } };
    case 'w':
    case 'W': {
      let t = head;
      for (let i = 0; i < count; i++) t = nextWordStart(text, t, key === 'W');
      return simple(t);
    }
    case 'b':
    case 'B': {
      let t = head;
      for (let i = 0; i < count; i++) t = prevWordStart(text, t, key === 'B');
      return simple(t);
    }
    case 'e':
    case 'E': {
      let t = head;
      for (let i = 0; i < count; i++) t = wordEnd(text, t, key === 'E');
      return { result: { target: clamp(t, 0, n), landsOn: true } };
    }
    case 'j':
      return { result: { target: head, landsOn: false }, vertical: 1 };
    case 'k':
      return { result: { target: head, landsOn: false }, vertical: -1 };
    case 'Enter':
      return { result: { target: head, landsOn: false }, vertical: 1 };
    // ';' is NOT a find-repeat here: it is the live spelling of ':' (command
    // line), and doubling it up as "repeat find" made it unpredictable.
    // ',' still repeats the last f/F/t/T in the reverse direction.
    case ',': {
      if (!state.lastFind) return null;
      const fk = ({ f: 'F', F: 'f', t: 'T', T: 't' } as const)[state.lastFind.key];
      const r = findCharCount(text, head, fk, state.lastFind.ch, count, true);
      return r ? { result: r } : null;
    }
  }
  return null;
}

/**
 * Resolve a text-object key (the char after `i`/`a`) to a range. `b`/`B`
 * are vim's block synonyms — the only live-typeable spelling of `i(`/`i{`,
 * since `(`/`)`/`{`/`}` are shifted keys the stealing can't see. `"` is
 * likewise unreachable live (arrives as `'`) but supported for other hosts.
 */
function textObjectFor(
  text: string,
  caret: number,
  key: string,
  around: boolean
): { start: number; end: number } | null {
  switch (key) {
    case 'w':
    case 'W':
      return wordObject(text, caret, around, key === 'W');
    case 'b':
    case '(':
    case ')':
      return pairObject(text, caret, '(', ')', around);
    case 'B':
    case '{':
    case '}':
      return pairObject(text, caret, '{', '}', around);
    case '[':
    case ']':
      return pairObject(text, caret, '[', ']', around);
    case "'":
    case '"':
    case '`':
      return quoteObject(text, caret, key, around);
  }
  return null;
}

// ---------------------------------------------------------------- normal

function handleNormal(state: VimState, key: string, snap: Snapshot): EngineResult {
  const { text, caret } = snap;
  const n = text.length;
  const count = countOf(state);

  // --- multi-key continuations first
  if (state.pending.p === 'replace') {
    if (key.length !== 1) return reset(state);
    if (caret >= n) return reset(state);
    // vim: [count]r fails outright when fewer than count chars remain —
    // no partial replacement. Chars are code points (emoji count as one);
    // atomic elements (references etc.) can't be rewritten as text.
    if (stopsBetween(text, caret, n) < count) return reset(state);
    const end = cpForward(text, caret, count);
    if (text.slice(caret, end).includes(ATOMIC_CH)) return reset(state);
    // keepLead: the delete is immediately refilled at the same offset, so the
    // column-0 whitespace swallow must not fire (`r` on "a b" col 0 keeps " b").
    return reset(state, [
      { t: 'deleteRange', start: caret, end, keepLead: true },
      { t: 'insertText', at: caret, text: key.repeat(count) },
      { t: 'setCaret', at: caret },
    ]);
  }

  if (state.pending.p === 'find') {
    if (key.length !== 1) return reset(state);
    const fk = state.pending.key;
    // [count]f/t/F/T finds the count-th occurrence (2fx, d2fx).
    const r = findCharCount(text, caret, fk, key, count);
    const st = { ...state, lastFind: { key: fk, ch: key } };
    if (!r) return reset(st);
    if (st.op) return applyOperator(st, snap, caret, r.target);
    // Plain cursor find must land ON the char, exactly like the visual find
    // path (vStart). `findChar` reports `f` as the offset AFTER the char (its
    // inclusive operator-range end, consumed by applyOperator above), so an
    // on-char cursor is target-1; t/F/T already report an on-char offset
    // (landsOn:false). Without this, `fz` then `x` deleted the char after z.
    const at = r.landsOn ? cpStart(text, Math.max(0, r.target - 1)) : r.target;
    return reset(st, [{ t: 'setCaret', at }]);
  }

  if (state.pending.p === 'g') {
    // Operator + g-chord: dgl = delete to end of line (vim d$), dgh = to
    // first non-blank (vim d^). The g-chords stand in for the shifted keys.
    if (state.op) {
      if (key === 'l') return applyOperator(state, snap, caret, n);
      if (key === 'h') return applyOperator(state, snap, caret, firstNonBlank(text));
      return reset(state);
    }
    // g-chords double as unshifted synonyms for capital commands, which are
    // unreachable through RemNote's shift-blind key stealing.
    switch (key) {
      case 'g':
        return reset(state, [{ t: 'goDoc', where: 'start' }]);
      case 'e': // ge → G (end of document)
        return reset(state, [{ t: 'goDoc', where: 'end' }]);
      case 'l': // gl → $ (end of line)
        return reset(state, [{ t: 'setCaret', at: n }]);
      case 'h': // gh → ^ (first non-blank)
        return reset(state, [{ t: 'setCaret', at: firstNonBlank(text) }]);
      case 'o': // go → O (open bullet above)
        return toMode(state, 'insert', [{ t: 'newBullet', where: 'above' }]);
      case 'a': // ga → A (append at end of line)
        return toMode(state, 'insert', [{ t: 'setCaret', at: n }]);
      case 'j': // gj → J (join with the next sibling bullet)
        return reset(state, [{ t: 'joinRem', count }]);
      case 'd': // gd → Ctrl-D (half page down)
        return reset(state, [{ t: 'scroll', dir: 1, count: PAGE }]);
      case 'u': // gu → Ctrl-U (half page up)
        return reset(state, [{ t: 'scroll', dir: -1, count: PAGE }]);
    }
    return reset(state);
  }

  if (state.pending.p === 'pane') {
    const st: VimState = { ...state, pending: { p: 'none' } };
    if (key === 'h') return { state: st, actions: [{ t: 'focusPane', dir: -1 }] };
    if (key === 'l' || key === 'w') return { state: st, actions: [{ t: 'focusPane', dir: 1 }] };
    return { state: st, actions: [] };
  }

  if (state.pending.p === 'textobj') {
    const around = state.pending.key === 'a';
    if (state.op && key.length === 1) {
      const obj = textObjectFor(text, caret, key, around);
      const st: VimState = { ...state, pending: { p: 'none' } };
      if (!obj) return reset(st);
      return applyOperator(st, snap, obj.start, obj.end);
    }
    return reset(state);
  }

  if (state.pending.p === 'mark') {
    if (key.length !== 1) return reset(state);
    return reset(state, [{ t: 'setMark', name: key }]);
  }
  if (state.pending.p === 'gotoMark') {
    if (key.length !== 1) return reset(state);
    return reset(state, [{ t: 'gotoMark', name: key }]);
  }

  // --- counts
  if (/^[1-9]$/.test(key) || (key === '0' && state.count !== '')) {
    return { state: { ...state, count: state.count + key }, actions: [] };
  }

  // --- pending operator: doubled operator = line-wise, or operator + motion
  if (state.op) {
    return handleOperatorKey(state, key, snap);
  }

  // --- motions
  const m = motionFor(state, key, snap, caret);
  if (m) {
    if (m.vertical) {
      return reset(state, [{ t: 'moveVertical', dir: m.vertical, count }]);
    }
    return reset(state, [{ t: 'setCaret', at: motionCaret(m.result) }]);
  }

  switch (key) {
    // --- operators
    case 'd':
    case 'c':
    case 'y':
    case '>':
    case '<':
      return {
        state: { ...state, op: key as Operator, opCount: state.count, count: '' },
        actions: [],
      };

    // --- find prefixes
    case 'f':
    case 'F':
    case 't':
    case 'T':
      return { state: { ...state, pending: { p: 'find', key } }, actions: [] };
    case 'g':
      return { state: { ...state, pending: { p: 'g' } }, actions: [] };
    case 'r':
      return { state: { ...state, pending: { p: 'replace' } }, actions: [] };

    // --- marks (rem-level; `'x` jumps like vim's line-wise mark)
    case 'm':
      return { state: { ...state, pending: { p: 'mark' } }, actions: [] };
    case "'":
      return { state: { ...state, pending: { p: 'gotoMark' } }, actions: [] };

    // --- mode switches
    case 'i':
      return toMode(state, 'insert', []);
    case 'a':
      return toMode(state, 'insert', [{ t: 'setCaret', at: cpForward(text, caret, 1) }]);
    case 'I':
      return toMode(state, 'insert', [{ t: 'setCaret', at: firstNonBlank(text) }]);
    case 'A':
      return toMode(state, 'insert', [{ t: 'setCaret', at: n }]);
    case 'o':
      return toMode(state, 'insert', [{ t: 'newBullet', where: 'below' }]);
    case 'O':
      return toMode(state, 'insert', [{ t: 'newBullet', where: 'above' }]);
    // v cycles: v → charwise visual (select text within the bullet),
    // vv → visual-LINE (whole bullets), vvv → back to normal. j/k in
    // charwise also switch to visual-line, so `vj` selects two bullets.
    case 'v':
    case 'V': {
      const r = toMode(state, 'visual', []);
      // Head is an ON-char index: snap to the start of the code point so an
      // astral last char doesn't leave the head between surrogate halves.
      const head = cpStart(text, clamp(caret, 0, Math.max(0, n - 1)));
      r.state.anchor = head;
      r.state.head = head;
      r.actions.push(selectionAction(r.state, snap));
      return r;
    }

    // --- simple edits
    case 'x': {
      if (caret >= n) return reset(state);
      const end = cpForward(text, caret, count);
      return reset(withCharRegister(state, text.slice(caret, end)), [
        { t: 'deleteRange', start: caret, end, yank: true },
      ]);
    }
    case 'X': {
      if (caret === 0) return reset(state);
      const start = cpBack(text, caret, count);
      return reset(withCharRegister(state, text.slice(start, caret)), [
        { t: 'deleteRange', start, end: caret, yank: true },
      ]);
    }
    case 's': {
      const end = cpForward(text, caret, count);
      const st = end > caret ? withCharRegister(state, text.slice(caret, end)) : state;
      const acts: Action[] =
        end > caret ? [{ t: 'deleteRange', start: caret, end, yank: true, keepLead: true }] : [];
      return toMode(st, 'insert', acts);
    }
    case 'D':
      return reset(withCharRegister(state, text.slice(caret)), [
        { t: 'deleteRange', start: caret, end: n, yank: true },
      ]);
    case 'C':
      return toMode(withCharRegister(state, text.slice(caret)), 'insert', [
        { t: 'deleteRange', start: caret, end: n, yank: true },
      ]);
    case 'S':
      return toMode(withCharRegister(state, text), 'insert', [
        { t: 'deleteRange', start: 0, end: n, yank: true },
      ]);
    case '~':
    case '`': {
      // backtick doubles as ~ (Shift+` is invisible to the key stealing)
      if (caret >= n) return reset(state);
      // Whole code points (an emoji toggles to itself, but must never be
      // split); atomic elements can't be rewritten as text — refuse, like r.
      const end = cpForward(text, caret, count);
      const slice = text.slice(caret, end);
      if (slice.includes(ATOMIC_CH)) return reset(state);
      const toggled = [...slice]
        .map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()))
        .join('');
      // keepLead: delete-then-refill at the same offset (see `r`).
      return reset(state, [
        { t: 'deleteRange', start: caret, end, keepLead: true },
        { t: 'insertText', at: caret, text: toggled },
      ]);
    }

    // --- registers
    case 'p':
    case 'P': {
      if (!state.register) return reset(state);
      if (state.register.kind === 'line') {
        return reset(state, [
          { t: 'pasteRem', where: key === 'p' ? 'below' : 'above', count },
        ]);
      }
      const txt = state.register.text.repeat(count);
      // vim: p pastes after the character under the cursor, P before it
      const at = key === 'p' ? cpForward(text, caret, 1) : caret;
      return reset(state, [{ t: 'insertText', at, text: txt }]);
    }
    case 'Y':
      return reset({ ...state, register: { kind: 'line' } }, [{ t: 'yankRem', count }]);

    // --- undo / redo
    case 'u':
      return reset(state, Array.from({ length: count }, () => ({ t: 'undo' as const })));
    case 'C-r':
      return reset(state, Array.from({ length: count }, () => ({ t: 'redo' as const })));

    // --- document jumps
    case 'G':
      return reset(state, [{ t: 'goDoc', where: 'end' }]);

    // --- scrolling (approximated as caret moves; the view follows the caret)
    // Ctrl-E/Ctrl-Y are intentionally absent: RemNote exposes no view-scroll
    // API, so a faithful "scroll without moving the cursor" is impossible —
    // those keys are left to RemNote.
    case 'C-d':
      return reset(state, [{ t: 'scroll', dir: 1, count: PAGE }]);
    case 'C-u':
      return reset(state, [{ t: 'scroll', dir: -1, count: PAGE }]);
    case 'C-w':
      return { state: { ...state, pending: { p: 'pane' }, count: '' }, actions: [] };
    // Direct pane nav (vim's common `<C-h>`/`<C-l>` ↦ `<C-w>h`/`<C-w>l`
    // mapping). These exist because a real Ctrl+W never reaches the desktop
    // app's renderer (Electron eats it) — C-w above only works on hosts that
    // deliver it.
    case 'C-h':
      return reset(state, [{ t: 'focusPane', dir: -1 }]);
    case 'C-l':
      return reset(state, [{ t: 'focusPane', dir: 1 }]);

    // --- jumplist
    case 'C-o':
      return reset(state, [{ t: 'jump', dir: -1 }]);
    case 'C-i':
      return reset(state, [{ t: 'jump', dir: 1 }]);

    // --- number increment / decrement (vim Ctrl-A / Ctrl-X)
    case 'C-a':
    case 'C-x': {
      const r = numberAt(text, caret);
      if (!r) return reset(state);
      const next = String(r.value + (key === 'C-a' ? count : -count));
      return reset(state, [
        { t: 'deleteRange', start: r.start, end: r.end, keepLead: true },
        { t: 'insertText', at: r.start, text: next },
        // vim leaves the cursor on the last digit of the result
        { t: 'setCaret', at: r.start + next.length - 1 },
      ]);
    }

    // --- dot-repeat: replay the last normal-mode change
    case '.': {
      if (!state.lastChange || state.lastChange.length === 0) return reset(state);
      return reset(state, [{ t: 'replayKeys', keys: state.lastChange }]);
    }

    // --- command-line mode. ':' is unreachable live (shift-blind stealing
    // reports it as ';'), so ';' doubles as ':' — always, now that the
    // find-repeat meaning of ';' is retired. '/' is deliberately NOT ours:
    // it is not stolen at all, so RemNote's own slash-command menu opens
    // (user's call — RemNote commands stay on /, vim Ex lives on ;).
    case ':':
    case ';':
      return { state: { ...state, mode: 'command', commandLine: '', count: '', op: null, pending: { p: 'none' } }, actions: [{ t: 'mode', mode: 'command' }] };

    case 'Escape':
      return reset(state);
  }

  return reset(state);
}

/** Where a plain (non-operator) motion puts the caret. */
function motionCaret(r: MotionResult): number {
  return r.target;
}

function withCharRegister(state: VimState, text: string): VimState {
  return { ...state, register: { kind: 'char', text } };
}

// ------------------------------------------------- operator + motion

function handleOperatorKey(state: VimState, key: string, snap: Snapshot): EngineResult {
  const op = state.op as Operator;
  const { text, caret } = snap;
  const count = countOf(state);

  // Doubled operator → line-wise (dd, cc, yy, >>, <<)
  if (key === op) {
    switch (op) {
      case 'd':
        return reset(
          { ...state, register: { kind: 'line' } },
          [{ t: 'deleteRem', count }]
        );
      case 'y':
        return reset({ ...state, register: { kind: 'line' } }, [{ t: 'yankRem', count }]);
      case 'c':
        return toMode(withCharRegister(state, text), 'insert', [
          { t: 'deleteRange', start: 0, end: text.length, yank: true, keepLead: true },
        ]);
      case '>':
        return reset(state, [{ t: 'indent' }]);
      case '<':
        return reset(state, [{ t: 'outdent' }]);
    }
  }

  // Text objects: operator + i/a waits for the object key (iw, aw)
  if (key === 'i' || key === 'a') {
    return { state: { ...state, pending: { p: 'textobj', key } }, actions: [] };
  }

  // find-motion prefixes inside an operator (df, ct, ...)
  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return { state: { ...state, pending: { p: 'find', key } }, actions: [] };
  }
  // g-chord motions inside an operator (dgl = d$, dgh = d^)
  if (key === 'g') {
    return { state: { ...state, pending: { p: 'g' } }, actions: [] };
  }

  // cw acts like ce when on a word character (vim quirk)
  let effKey = key;
  if (op === 'c' && (key === 'w' || key === 'W') && caret < text.length && !/\s/.test(text[caret])) {
    effKey = key === 'w' ? 'e' : 'E';
  }

  const m = motionFor(state, effKey, snap, caret);
  if (m && !m.vertical) {
    return applyOperator(state, snap, caret, m.result.target);
  }

  return reset(state);
}

function applyOperator(state: VimState, snap: Snapshot, from: number, to: number): EngineResult {
  const op = state.op as Operator;
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const slice = snap.text.slice(start, end);

  switch (op) {
    case 'd':
      if (start === end) return reset(state);
      return reset(withCharRegister(state, slice), [{ t: 'deleteRange', start, end, yank: true }]);
    case 'c':
      return toMode(withCharRegister(state, slice), 'insert', [
        { t: 'deleteRange', start, end, yank: true, keepLead: true },
      ]);
    case 'y':
      if (start === end) return reset(state);
      return reset(withCharRegister(state, slice), [
        { t: 'copyText', text: slice, start, end },
        { t: 'setCaret', at: start },
      ]);
    case '>':
      return reset(state, [{ t: 'indent' }]);
    case '<':
      return reset(state, [{ t: 'outdent' }]);
  }
}

// ---------------------------------------------------------------- visual

// The selection covers the WHOLE code point the head sits on (an astral char
// or atomic-element placeholder is 2 units wide — hi+1 would cut it in half).
function selectionAction(state: VimState, snap: Snapshot): Action {
  const { start, end } = visualRange(state, snap);
  return { t: 'select', start, end };
}

function visualRange(state: VimState, snap: Snapshot): { start: number; end: number } {
  const n = snap.text.length;
  const lo = Math.min(state.anchor, state.head);
  const hi = Math.max(state.anchor, state.head);
  return { start: lo, end: clamp(hi + cpWidthAt(snap.text, hi), 0, Math.max(n, lo)) };
}

function handleVisual(state: VimState, key: string, snap: Snapshot): EngineResult {
  const { text } = snap;
  const n = text.length;

  if (key === 'Escape') {
    // collapseSelection, not setCaret: a relative caret move against the
    // live native selection resizes it instead of clearing it.
    return toMode(state, 'normal', [
      { t: 'collapseSelection', at: clamp(state.head, 0, n) },
    ]);
  }

  // g-chords: gg/ge escalate to a line-wise selection reaching the document
  // boundary (vim v gg / v G); gl/gh stay charwise, extending the selection
  // to the line end / first non-blank ($ / ^ synonyms).
  if (state.pending.p === 'g') {
    const st: VimState = { ...state, pending: { p: 'none' }, count: '' };
    if (key === 'g' || key === 'e') {
      const r = toMode(st, 'visual-line', []);
      r.actions.push({ t: 'vStart' });
      r.actions.push({ t: 'vExtend', dir: key === 'g' ? -1 : 1, count: 1000 });
      return r;
    }
    if (key === 'l' || key === 'h') {
      const target = key === 'l' ? cpStart(text, Math.max(0, n - 1)) : firstNonBlank(text);
      const st2 = { ...st, head: clamp(target, 0, Math.max(0, n - 1)) };
      return { state: st2, actions: [selectionAction(st2, snap)] };
    }
    return { state: st, actions: [] };
  }
  if (key === 'g') {
    return { state: { ...state, pending: { p: 'g' } }, actions: [] };
  }
  if (key === 'G') {
    const r = toMode(state, 'visual-line', []);
    r.actions.push({ t: 'vStart' });
    r.actions.push({ t: 'vExtend', dir: 1, count: 1000 });
    return r;
  }

  if (key === 'v' || key === 'V') {
    // second v: switch to visual-LINE mode (whole bullets)
    const r = toMode(state, 'visual-line', []);
    r.actions.push({ t: 'vStart' });
    return r;
  }

  if (/^[0-9]$/.test(key) && !(key === '0' && state.count === '')) {
    return { state: { ...state, count: state.count + key }, actions: [] };
  }

  if (state.pending.p === 'find') {
    const fk = state.pending.key;
    const r =
      key.length === 1 ? findCharCount(text, state.head, fk, key, countOf(state)) : null;
    const st: VimState = { ...state, pending: { p: 'none' }, count: '' };
    if (!r) return { state: st, actions: [] };
    st.lastFind = { key: fk, ch: key };
    st.head = cpStart(text, clamp(r.landsOn ? r.target - 1 : r.target, 0, Math.max(0, n - 1)));
    return { state: st, actions: [selectionAction(st, snap)] };
  }

  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return { state: { ...state, pending: { p: 'find', key } }, actions: [] };
  }

  // text objects reshape the whole selection (vim vi[ / va')
  if (state.pending.p === 'textobj') {
    const around = state.pending.key === 'a';
    const st: VimState = { ...state, pending: { p: 'none' }, count: '' };
    const obj = key.length === 1 ? textObjectFor(text, st.head, key, around) : null;
    if (!obj || obj.end <= obj.start) return { state: st, actions: [] };
    const st2 = {
      ...st,
      anchor: obj.start,
      head: cpStart(text, clamp(obj.end - 1, 0, Math.max(0, n - 1))),
    };
    return { state: st2, actions: [selectionAction(st2, snap)] };
  }
  if (key === 'i' || key === 'a') {
    return { state: { ...state, pending: { p: 'textobj', key } }, actions: [] };
  }

  const m = motionFor(state, key, snap, state.head);
  if (m && !m.vertical) {
    const onChar = (t: number) => cpStart(text, clamp(t, 0, Math.max(0, n - 1)));
    let target = m.result.landsOn ? onChar(m.result.target - 1) : m.result.target;
    // Inclusive motions measure from an I-beam caret, but the visual head is
    // an ON-char index — when the head already sits on a word's last char,
    // `e` reports that same char and the selection would never grow. Rerun
    // the motion from one char later (vim's "must land later" block-cursor
    // rule applies here, unlike in normal mode).
    if (m.result.landsOn && target === state.head && cpForward(text, state.head, 1) < n) {
      const m2 = motionFor(state, key, snap, cpForward(text, state.head, 1));
      if (m2 && !m2.vertical) {
        target = m2.result.landsOn ? onChar(m2.result.target - 1) : m2.result.target;
      }
    }
    const st = { ...state, head: onChar(target), count: '' };
    return { state: st, actions: [selectionAction(st, snap)] };
  }
  if (m && m.vertical) {
    // j/k in charwise visual: switch to LINE selection and extend — this is
    // what vim muscle memory expects from `v j` / `V j` (V arrives as v here,
    // since RemNote's key stealing is shift-blind).
    const r = toMode(state, 'visual-line', []);
    r.actions.push({ t: 'vStart' });
    r.actions.push({ t: 'vExtend', dir: m.vertical, count: countOf(state) });
    return r;
  }

  const range = visualRange(state, snap);
  const slice = text.slice(range.start, range.end);

  switch (key) {
    case 'o': {
      const st = { ...state, anchor: state.head, head: state.anchor };
      return { state: st, actions: [selectionAction(st, snap)] };
    }
    case 'd':
    case 'x':
      return toMode(withCharRegister(state, slice), 'normal', [
        { t: 'deleteRange', start: range.start, end: range.end, yank: true },
      ]);
    case 'c':
    case 's':
      return toMode(withCharRegister(state, slice), 'insert', [
        { t: 'deleteRange', start: range.start, end: range.end, yank: true, keepLead: true },
      ]);
    case 'y':
      return toMode(withCharRegister(state, slice), 'normal', [
        { t: 'copyText', text: slice, start: range.start, end: range.end },
        { t: 'setCaret', at: range.start },
      ]);
    case 'p':
    case 'P': {
      if (!state.register || state.register.kind !== 'char') {
        return toMode(state, 'normal', [{ t: 'setCaret', at: range.start }]);
      }
      const txt = state.register.text;
      return toMode(withCharRegister(state, slice), 'normal', [
        { t: 'deleteRange', start: range.start, end: range.end, keepLead: true },
        { t: 'insertText', at: range.start, text: txt },
      ]);
    }
    case '>':
      return toMode(state, 'normal', [{ t: 'indent' }]);
    case '<':
      return toMode(state, 'normal', [{ t: 'outdent' }]);

    // command line from charwise visual — range commands (:s) act on the
    // focused bullet ('/' is not stolen; it belongs to RemNote's slash menu)
    case ':':
    case ';':
      return {
        state: { ...state, mode: 'command', commandLine: '', count: '', op: null, pending: { p: 'none' } },
        actions: [{ t: 'mode', mode: 'command' }],
      };
  }

  return { state: { ...state, count: '' }, actions: [] };
}

function handleVisualLine(state: VimState, key: string, snap: Snapshot): EngineResult {
  const count = countOf(state);

  // g-chords: gg extends to the top of the document, ge to the bottom
  if (state.pending.p === 'g') {
    const st: VimState = { ...state, pending: { p: 'none' }, count: '' };
    if (key === 'g') return { state: st, actions: [{ t: 'vExtend', dir: -1, count: 1000 }] };
    if (key === 'e') return { state: st, actions: [{ t: 'vExtend', dir: 1, count: 1000 }] };
    return { state: st, actions: [] };
  }
  if (key === 'g') {
    return { state: { ...state, pending: { p: 'g' } }, actions: [] };
  }

  // counts (3j extends by three visible rows)
  if (/^[1-9]$/.test(key) || (key === '0' && state.count !== '')) {
    return { state: { ...state, count: state.count + key }, actions: [] };
  }

  switch (key) {
    // --- extend / shrink the selection one VISIBLE row at a time (vim V+j/k)
    case 'j':
    case 'Enter':
      return reset(state, [{ t: 'vExtend', dir: 1, count }]);
    case 'k':
      return reset(state, [{ t: 'vExtend', dir: -1, count }]);
    case 'G':
      return reset(state, [{ t: 'vExtend', dir: 1, count: 1000 }]);

    // --- operations on the selected bullets
    case 'd':
    case 'x':
      return toMode({ ...state, register: { kind: 'line' } }, 'normal', [
        { t: 'deleteRemSelection' },
      ]);
    case 'y':
      return toMode({ ...state, register: { kind: 'line' } }, 'normal', [
        { t: 'yankRemSelection' },
      ]);
    case 'c':
      // vim cc-on-selection: replace the selected lines with one empty line
      return toMode({ ...state, register: { kind: 'line' } }, 'insert', [
        { t: 'deleteRemSelection' },
        { t: 'newBullet', where: 'below' },
      ]);
    // Physically pressing vim's > and < works (Shift is invisible, so they
    // arrive as '.' and ','). Bare '.'/',' alias them ONLY in this mode;
    // normal-mode '.' stays reserved for a future repeat command.
    case '>':
    case '.':
      return toMode(state, 'normal', [{ t: 'indentSelection' }, { t: 'clearRemSelection' }]);
    case '<':
    case ',':
      return toMode(state, 'normal', [{ t: 'outdentSelection' }, { t: 'clearRemSelection' }]);
    case 'v':
      // third v completes the cycle: back to normal
      return toMode(state, 'normal', [{ t: 'clearRemSelection' }]);
    case 'p':
    case 'P':
      // replace the selected bullets with the line register
      if (state.register?.kind === 'line') {
        return toMode(state, 'normal', [
          { t: 'deleteRemSelection' },
          { t: 'pasteRem', where: 'above', count: 1 },
        ]);
      }
      return { state, actions: [] };

    // command line over the selection: the bullet trail is deliberately NOT
    // cleared, so range Ex commands (:s over the selection) apply to every
    // selected bullet. Leaving command mode clears it. ('/' is not stolen —
    // RemNote's slash menu owns it.)
    case ':':
    case ';':
      return {
        state: { ...state, mode: 'command', commandLine: '', count: '', op: null, pending: { p: 'none' } },
        actions: [{ t: 'mode', mode: 'command' }],
      };

    case 'Escape':
    case 'V':
      return toMode(state, 'normal', [{ t: 'clearRemSelection' }]);
  }
  return { state: { ...state, count: '' }, actions: [] };
}
