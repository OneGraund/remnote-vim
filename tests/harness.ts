import { handleKey, initialState } from '../src/engine/engine';
import { Action, Snapshot, VimState } from '../src/engine/types';

interface DocState {
  lines: string[];
  indents: number[];
  row: number;
  caret: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * A fake editor executing engine actions the same way the RemNote
 * adapter does: lines model Rems, `indents` models tree depth,
 * `lineRegister` models the adapter-held rich line register.
 */
export class Harness {
  lines: string[];
  indents: number[];
  row: number;
  caret: number;
  sel: { start: number; end: number } | null = null;
  lineRegister: string[] = [];
  /** The last Ex command line executed (without ':'), for command-mode tests. */
  lastEx: string | null = null;
  /** Visual-line selection: the trail of rows the head has walked. */
  vTrail: number[] | null = null;
  /** [lo, hi] rows of the active selection (derived from the trail). */
  vSelRows: [number, number] | null = null;
  /** What the adapter would have written to the system clipboard. */
  clipboard: string | null = null;
  /** Jumplist rows (adapter keeps rem ids; rows model the same thing here). */
  jumps: number[] = [];
  jumpPos = 0;
  /** focusPane directions emitted (the adapter cycles real panes). */
  paneMoves: number[] = [];
  /** Marks: name → row (the adapter stores rem ids). */
  marks: Record<string, number> = {};
  state: VimState;

  private undoStack: DocState[] = [];
  private redoStack: DocState[] = [];
  private typingRun = false;

  constructor(lines: string[], row = 0, caret = 0, indents?: number[]) {
    this.lines = [...lines];
    this.indents = indents ? [...indents] : lines.map(() => 0);
    this.row = row;
    this.caret = caret;
    this.state = { ...initialState(), mode: 'normal' };
  }

  get mode() {
    return this.state.mode;
  }
  get line() {
    return this.lines[this.row] ?? '';
  }

  snapshot(): Snapshot {
    return { text: this.line, caret: this.caret };
  }

  /**
   * Feed a key sequence. Tokens: plain characters, or <esc> <cr> <bs>
   * <space> <c-r>. In insert mode, plain characters are typed directly
   * into the document (they are not stolen in the real app either).
   */
  get commandLine() {
    return this.state.commandLine;
  }

  keys(seq: string) {
    for (const key of tokenize(seq)) this.step(key);
  }

  /** One key through the engine — shared by keys() and replayKeys. */
  private step(key: string) {
    if (this.state.mode === 'insert' && key !== 'Escape') {
      this.type(key === 'Enter' ? '\n' : key);
      return;
    }
    const { state, actions } = handleKey(this.state, key, this.snapshot());
    this.state = state;
    const mutates = actions.some((a) => MUTATING.has(a.t));
    if (mutates) this.pushUndo();
    this.typingRun = false;
    for (const a of actions) this.exec(a);
  }

  private type(text: string) {
    if (!this.typingRun) {
      this.pushUndo();
      this.typingRun = true;
    }
    const l = this.line;
    this.lines[this.row] = l.slice(0, this.caret) + text + l.slice(this.caret);
    this.caret += text.length;
    this.sel = null;
  }

  private docState(): DocState {
    return { lines: [...this.lines], indents: [...this.indents], row: this.row, caret: this.caret };
  }

  private restore(s: DocState) {
    this.lines = [...s.lines];
    this.indents = [...s.indents];
    this.row = s.row;
    this.caret = s.caret;
    this.sel = null;
  }

  private syncVSel() {
    this.vSelRows = this.vTrail
      ? [Math.min(...this.vTrail), Math.max(...this.vTrail)]
      : null;
  }

  /** Rows of `row`'s subtree: itself plus following rows with deeper indent. */
  subtreeRows(row: number): number[] {
    const out = [row];
    for (let r = row + 1; r < this.lines.length && this.indents[r] > this.indents[row]; r++) {
      out.push(r);
    }
    return out;
  }

  /** Is `anc` an ancestor of `row` (per the indents-derived tree)? */
  private isAncestor(anc: number, row: number): boolean {
    return anc < row && this.subtreeRows(anc).includes(row);
  }

  /** Trail rows minus those covered by a selected ancestor, in doc order. */
  normalizedTrail(): number[] {
    const trail = this.vTrail ?? [this.row];
    const set = new Set(trail);
    return [...set]
      .filter((r) => ![...set].some((a) => a !== r && this.isAncestor(a, r)))
      .sort((a, b) => a - b);
  }

  private pushUndo() {
    this.undoStack.push(this.docState());
    this.redoStack = [];
  }

  private recordJump() {
    this.jumps = this.jumps.slice(0, this.jumpPos);
    if (this.jumps[this.jumps.length - 1] !== this.row) this.jumps.push(this.row);
    this.jumpPos = this.jumps.length;
    this.marks["'"] = this.row; // the adapter's recordJump sets the ' mark too
  }

  private exec(a: Action) {
    switch (a.t) {
      case 'setCaret':
        this.caret = clamp(a.at, 0, this.line.length);
        this.sel = null;
        break;
      case 'collapseSelection':
        this.caret = clamp(a.at, 0, this.line.length);
        this.sel = null;
        break;
      case 'select':
        this.sel = { start: a.start, end: a.end };
        break;
      case 'deleteRange': {
        const l = this.line;
        // Mirror the adapter: a deletion starting at column 0 swallows the
        // whitespace run that would become the new line start (RemNote's
        // data layer trims it anyway).
        let end = a.end;
        if (a.start === 0 && !a.keepLead) {
          while (end < l.length && /\s/.test(l[end])) end++;
        }
        if (a.yank) this.clipboard = l.slice(a.start, end);
        this.lines[this.row] = l.slice(0, a.start) + l.slice(end);
        this.caret = a.start;
        this.sel = null;
        break;
      }
      case 'copyText':
        this.clipboard = a.text;
        break;
      case 'insertText': {
        const l = this.line;
        this.lines[this.row] = l.slice(0, a.at) + a.text + l.slice(a.at);
        this.caret = a.at + a.text.length;
        this.sel = null;
        break;
      }
      case 'moveVertical':
        this.row = clamp(this.row + a.dir * a.count, 0, this.lines.length - 1);
        this.caret = clamp(this.caret, 0, this.line.length);
        this.sel = null;
        break;
      case 'deleteRem': {
        const count = Math.min(a.count, this.lines.length - this.row);
        this.lineRegister = this.lines.slice(this.row, this.row + count);
        this.clipboard = this.lineRegister.join('\n');
        this.lines.splice(this.row, count);
        this.indents.splice(this.row, count);
        if (this.lines.length === 0) {
          this.lines = [''];
          this.indents = [0];
        }
        this.row = clamp(this.row, 0, this.lines.length - 1);
        this.caret = 0;
        this.sel = null;
        break;
      }
      case 'yankRem':
        this.lineRegister = this.lines.slice(this.row, this.row + a.count);
        this.clipboard = this.lineRegister.join('\n');
        break;
      case 'pasteRem': {
        const at = a.where === 'below' ? this.row + 1 : this.row;
        for (let i = 0; i < a.count; i++) {
          this.lines.splice(at, 0, ...this.lineRegister);
          this.indents.splice(at, 0, ...this.lineRegister.map(() => this.indents[this.row] ?? 0));
        }
        this.row = at;
        this.caret = 0;
        this.sel = null;
        break;
      }
      case 'newBullet': {
        const at = a.where === 'below' ? this.row + 1 : this.row;
        this.lines.splice(at, 0, '');
        this.indents.splice(at, 0, this.indents[this.row] ?? 0);
        this.row = at;
        this.caret = 0;
        this.sel = null;
        break;
      }
      case 'scroll':
        this.row = clamp(this.row + a.dir * a.count, 0, this.lines.length - 1);
        this.caret = clamp(this.caret, 0, this.line.length);
        this.sel = null;
        break;
      case 'runEx':
        this.lastEx = a.cmd;
        break;
      case 'indent':
        this.indents[this.row]++;
        break;
      case 'outdent':
        this.indents[this.row] = Math.max(0, this.indents[this.row] - 1);
        break;
      case 'vStart':
        this.vTrail = [this.row];
        this.syncVSel();
        break;
      case 'vExtend': {
        if (!this.vTrail) this.vTrail = [this.row];
        for (let i = 0; i < a.count; i++) {
          const head = this.vTrail[this.vTrail.length - 1];
          const next = clamp(head + a.dir, 0, this.lines.length - 1);
          if (next === head) break;
          if (this.vTrail.length >= 2 && this.vTrail[this.vTrail.length - 2] === next) {
            this.vTrail.pop();
          } else {
            this.vTrail.push(next);
          }
        }
        this.syncVSel();
        break;
      }
      case 'deleteRemSelection': {
        const units = this.normalizedTrail();
        const all = new Set<number>();
        for (const r of units) for (const x of this.subtreeRows(r)) all.add(x);
        const rows = [...all].sort((a2, b2) => a2 - b2);
        this.lineRegister = rows.map((r) => this.lines[r]);
        this.clipboard = this.lineRegister.join('\n');
        for (let i = rows.length - 1; i >= 0; i--) {
          this.lines.splice(rows[i], 1);
          this.indents.splice(rows[i], 1);
        }
        if (this.lines.length === 0) {
          this.lines = [''];
          this.indents = [0];
        }
        this.row = clamp(rows[0] ?? 0, 0, this.lines.length - 1);
        this.caret = 0;
        this.vTrail = null;
        this.syncVSel();
        break;
      }
      case 'yankRemSelection': {
        const units = this.normalizedTrail();
        const all = new Set<number>();
        for (const r of units) for (const x of this.subtreeRows(r)) all.add(x);
        this.lineRegister = [...all].sort((a2, b2) => a2 - b2).map((r) => this.lines[r]);
        this.clipboard = this.lineRegister.join('\n');
        this.row = this.vTrail?.[0] ?? this.row;
        this.vTrail = null;
        this.syncVSel();
        break;
      }
      case 'indentSelection': {
        for (const r of this.normalizedTrail()) {
          for (const x of this.subtreeRows(r)) this.indents[x]++;
        }
        this.vTrail = null;
        this.syncVSel();
        break;
      }
      case 'outdentSelection': {
        for (const r of this.normalizedTrail()) {
          for (const x of this.subtreeRows(r)) this.indents[x] = Math.max(0, this.indents[x] - 1);
        }
        this.vTrail = null;
        this.syncVSel();
        break;
      }
      case 'clearRemSelection':
        if (this.vTrail) this.row = this.vTrail[this.vTrail.length - 1];
        this.vTrail = null;
        this.syncVSel();
        break;
      case 'goDoc':
        this.recordJump();
        this.row = a.where === 'start' ? 0 : this.lines.length - 1;
        this.caret = 0;
        this.sel = null;
        break;
      case 'jump': {
        // Same algorithm as the adapter (rows stand in for rem ids).
        if (a.dir === -1) {
          if (this.jumpPos === this.jumps.length) {
            if (this.jumps[this.jumps.length - 1] !== this.row) this.jumps.push(this.row);
            this.jumpPos = this.jumps.length - 1;
            if (this.jumpPos > 0 && this.jumps[this.jumpPos] === this.row) this.jumpPos--;
          } else if (this.jumpPos > 0) {
            this.jumpPos--;
          } else break;
        } else {
          if (this.jumpPos >= this.jumps.length - 1) break;
          this.jumpPos++;
        }
        const target = this.jumps[this.jumpPos];
        if (target != null) {
          this.row = clamp(target, 0, this.lines.length - 1);
          this.caret = 0;
        }
        break;
      }
      case 'focusPane':
        this.paneMoves.push(a.dir);
        break;
      case 'setMark':
        this.marks[a.name] = this.row;
        break;
      case 'gotoMark': {
        const target = this.marks[a.name];
        if (target == null) break;
        this.recordJump();
        this.row = clamp(target, 0, this.lines.length - 1);
        this.caret = 0;
        break;
      }
      case 'joinRem': {
        // Mirror the adapter: join with the NEXT SIBLING (same indent, not
        // past a shallower row). The sibling's subtree rows simply stay —
        // removing the sibling's own row makes them the joined row's children
        // in the flat indent model, matching the adapter's child adoption.
        const joins = Math.max(1, a.count - 1);
        for (let j = 0; j < joins; j++) {
          let sib = -1;
          for (let r = this.row + 1; r < this.lines.length; r++) {
            if (this.indents[r] < this.indents[this.row]) break;
            if (this.indents[r] === this.indents[this.row]) {
              sib = r;
              break;
            }
          }
          if (sib < 0) break;
          this.lines[this.row] = this.lines[this.row] + ' ' + this.lines[sib];
          this.lines.splice(sib, 1);
          this.indents.splice(sib, 1);
        }
        break;
      }
      case 'replayKeys':
        for (const k of a.keys.slice(0, 32)) this.step(k);
        break;
      case 'undo': {
        const s = this.undoStack.pop();
        if (s) {
          // the state pushed just before this undo command itself is not a change
          this.redoStack.push(this.docState());
          this.restore(s);
        }
        break;
      }
      case 'redo': {
        const s = this.redoStack.pop();
        if (s) {
          this.undoStack.push(this.docState());
          this.restore(s);
        }
        break;
      }
      case 'mode':
        break;
    }
  }
}

const MUTATING = new Set<Action['t']>([
  'deleteRange',
  'insertText',
  'deleteRem',
  'pasteRem',
  'newBullet',
  'indent',
  'outdent',
  'deleteRemSelection',
  'indentSelection',
  'outdentSelection',
  'joinRem',
]);

function tokenize(seq: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < seq.length) {
    if (seq[i] === '<') {
      const j = seq.indexOf('>', i);
      if (j > i) {
        const name = seq.slice(i + 1, j).toLowerCase();
        const map: Record<string, string> = {
          esc: 'Escape',
          cr: 'Enter',
          enter: 'Enter',
          bs: 'Backspace',
          space: ' ',
          'c-r': 'C-r',
          'c-d': 'C-d',
          'c-u': 'C-u',
          'c-w': 'C-w',
          'c-h': 'C-h',
          'c-l': 'C-l',
          'c-o': 'C-o',
          'c-i': 'C-i',
          'c-a': 'C-a',
          'c-x': 'C-x',
        };
        if (map[name]) {
          out.push(map[name]);
          i = j + 1;
          continue;
        }
      }
    }
    out.push(seq[i]);
    i++;
  }
  return out;
}
