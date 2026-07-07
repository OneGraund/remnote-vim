import {
  findChar,
  firstNonBlank,
  nextWordStart,
  prevWordStart,
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

// ---------------------------------------------------------------- command line

const PAGE = 12; // Rems moved by Ctrl-D / Ctrl-U

function handleCommand(state: VimState, key: string, _snap: Snapshot): EngineResult {
  if (key === 'Escape') {
    return { ...toMode(state, 'normal', []), state: { ...state, mode: 'normal', commandLine: '' } };
  }
  if (key === 'Enter') {
    const cmd = state.commandLine.trim();
    const next: VimState = { ...state, mode: 'normal', commandLine: '' };
    const actions: Action[] = [{ t: 'mode', mode: 'normal' }];
    if (cmd) actions.unshift({ t: 'runEx', cmd });
    return { state: next, actions };
  }
  if (key === 'Backspace') {
    // Backspacing past the ':' leaves command mode entirely.
    if (state.commandLine.length === 0) {
      return { state: { ...state, mode: 'normal', commandLine: '' }, actions: [{ t: 'mode', mode: 'normal' }] };
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
    case 'h':
    case 'Backspace':
      return simple(head - count);
    case 'l':
    case ' ':
      return simple(head + count);
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
    case ';':
    case ',': {
      if (!state.lastFind) return null;
      let { key: fk, ch } = state.lastFind;
      if (key === ',') {
        fk = ({ f: 'F', F: 'f', t: 'T', T: 't' } as const)[fk];
      }
      const r = findChar(text, head, fk, ch, true);
      return r ? { result: r } : null;
    }
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
    const end = clamp(caret + count, 0, n);
    return reset(state, [
      { t: 'deleteRange', start: caret, end },
      { t: 'insertText', at: caret, text: key.repeat(end - caret) },
      { t: 'setCaret', at: caret },
    ]);
  }

  if (state.pending.p === 'find') {
    if (key.length !== 1) return reset(state);
    const fk = state.pending.key;
    const r = findChar(text, caret, fk, key, false);
    const st = { ...state, lastFind: { key: fk, ch: key } };
    if (!r) return reset(st);
    if (st.op) return applyOperator(st, snap, caret, r.target);
    return reset(st, [{ t: 'setCaret', at: motionCaret(r) }]);
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
    if (state.op && (key === 'w' || key === 'W')) {
      const obj = wordObject(text, caret, around, key === 'W');
      const st: VimState = { ...state, pending: { p: 'none' } };
      if (!obj) return reset(st);
      return applyOperator(st, snap, obj.start, obj.end);
    }
    return reset(state);
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

    // --- mode switches
    case 'i':
      return toMode(state, 'insert', []);
    case 'a':
      return toMode(state, 'insert', [{ t: 'setCaret', at: clamp(caret + 1, 0, n) }]);
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
      const head = clamp(caret, 0, Math.max(0, n - 1));
      r.state.anchor = head;
      r.state.head = head;
      r.actions.push(selectionAction(r.state, snap));
      return r;
    }

    // --- simple edits
    case 'x': {
      if (caret >= n) return reset(state);
      const end = clamp(caret + count, 0, n);
      return reset(withCharRegister(state, text.slice(caret, end)), [
        { t: 'deleteRange', start: caret, end },
      ]);
    }
    case 'X': {
      if (caret === 0) return reset(state);
      const start = clamp(caret - count, 0, n);
      return reset(withCharRegister(state, text.slice(start, caret)), [
        { t: 'deleteRange', start, end: caret },
      ]);
    }
    case 's': {
      const end = clamp(caret + count, 0, n);
      const st = end > caret ? withCharRegister(state, text.slice(caret, end)) : state;
      const acts: Action[] = end > caret ? [{ t: 'deleteRange', start: caret, end }] : [];
      return toMode(st, 'insert', acts);
    }
    case 'D':
      return reset(withCharRegister(state, text.slice(caret)), [
        { t: 'deleteRange', start: caret, end: n },
      ]);
    case 'C':
      return toMode(withCharRegister(state, text.slice(caret)), 'insert', [
        { t: 'deleteRange', start: caret, end: n },
      ]);
    case 'S':
      return toMode(withCharRegister(state, text), 'insert', [
        { t: 'deleteRange', start: 0, end: n },
      ]);
    case '~':
    case '`': {
      // backtick doubles as ~ (Shift+` is invisible to the key stealing)
      if (caret >= n) return reset(state);
      const end = clamp(caret + count, 0, n);
      const toggled = text
        .slice(caret, end)
        .split('')
        .map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()))
        .join('');
      return reset(state, [
        { t: 'deleteRange', start: caret, end },
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
      const at = key === 'p' ? clamp(caret + 1, 0, n) : caret;
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
    case 'C-d':
      return reset(state, [{ t: 'scroll', dir: 1, count: PAGE }]);
    case 'C-u':
      return reset(state, [{ t: 'scroll', dir: -1, count: PAGE }]);
    case 'C-e':
      return reset(state, [{ t: 'scroll', dir: 1, count: 1 }]);
    case 'C-y':
      return reset(state, [{ t: 'scroll', dir: -1, count: 1 }]);
    case 'C-w':
      return { state: { ...state, pending: { p: 'pane' }, count: '' }, actions: [] };

    // --- command-line mode. ':' is unreachable live (shift-blind stealing
    // reports it as ';'), so ';' doubles as ':' whenever it isn't a find
    // repeat — motionFor consumed it above when a previous f/t/F/T exists.
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
          { t: 'deleteRange', start: 0, end: text.length },
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
      return reset(withCharRegister(state, slice), [{ t: 'deleteRange', start, end }]);
    case 'c':
      return toMode(withCharRegister(state, slice), 'insert', [
        { t: 'deleteRange', start, end },
      ]);
    case 'y':
      return reset(withCharRegister(state, slice), [{ t: 'setCaret', at: start }]);
    case '>':
      return reset(state, [{ t: 'indent' }]);
    case '<':
      return reset(state, [{ t: 'outdent' }]);
  }
}

// ---------------------------------------------------------------- visual

function selectionAction(state: VimState, snap: Snapshot): Action {
  const n = snap.text.length;
  const lo = Math.min(state.anchor, state.head);
  const hi = Math.max(state.anchor, state.head);
  return { t: 'select', start: lo, end: clamp(hi + 1, 0, Math.max(n, lo)) };
}

function visualRange(state: VimState, snap: Snapshot): { start: number; end: number } {
  const n = snap.text.length;
  const lo = Math.min(state.anchor, state.head);
  const hi = Math.max(state.anchor, state.head);
  return { start: lo, end: clamp(hi + 1, 0, Math.max(n, lo)) };
}

function handleVisual(state: VimState, key: string, snap: Snapshot): EngineResult {
  const { text } = snap;
  const n = text.length;

  if (key === 'Escape') {
    return toMode(state, 'normal', [{ t: 'setCaret', at: clamp(state.head, 0, n) }]);
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
    const r = key.length === 1 ? findChar(text, state.head, fk, key, false) : null;
    const st: VimState = { ...state, pending: { p: 'none' }, count: '' };
    if (!r) return { state: st, actions: [] };
    st.lastFind = { key: fk, ch: key };
    st.head = clamp(r.landsOn ? r.target - 1 : r.target, 0, Math.max(0, n - 1));
    return { state: st, actions: [selectionAction(st, snap)] };
  }

  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return { state: { ...state, pending: { p: 'find', key } }, actions: [] };
  }

  const m = motionFor(state, key, snap, state.head);
  if (m && !m.vertical) {
    const target = m.result.landsOn ? m.result.target - 1 : m.result.target;
    const st = { ...state, head: clamp(target, 0, Math.max(0, n - 1)), count: '' };
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
        { t: 'deleteRange', start: range.start, end: range.end },
      ]);
    case 'c':
    case 's':
      return toMode(withCharRegister(state, slice), 'insert', [
        { t: 'deleteRange', start: range.start, end: range.end },
      ]);
    case 'y':
      return toMode(withCharRegister(state, slice), 'normal', [
        { t: 'setCaret', at: range.start },
      ]);
    case 'p':
    case 'P': {
      if (!state.register || state.register.kind !== 'char') {
        return toMode(state, 'normal', [{ t: 'setCaret', at: range.start }]);
      }
      const txt = state.register.text;
      return toMode(withCharRegister(state, slice), 'normal', [
        { t: 'deleteRange', start: range.start, end: range.end },
        { t: 'insertText', at: range.start, text: txt },
      ]);
    }
    case '>':
      return toMode(state, 'normal', [{ t: 'indent' }]);
    case '<':
      return toMode(state, 'normal', [{ t: 'outdent' }]);
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

    case 'Escape':
    case 'V':
      return toMode(state, 'normal', [{ t: 'clearRemSelection' }]);
  }
  return { state: { ...state, count: '' }, actions: [] };
}
