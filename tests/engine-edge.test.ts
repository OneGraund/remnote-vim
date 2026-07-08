import { describe, expect, it } from 'vitest';
import { ATOMIC_CH } from '../src/engine/motions';
import { Harness } from './harness';

const h = (lines: string[] | string, row = 0, caret = 0) =>
  new Harness(typeof lines === 'string' ? [lines] : lines, row, caret);

// Robustness/edge suite born out of the 2026-07-08 stability pass: end-of-line
// arithmetic, empty/short lines, astral characters (emoji), and the atomic
// rich-element placeholder the adapter feeds the engine for references,
// images and LaTeX chips.

describe('end-of-line correctness', () => {
  it('l clamps at EOL, h at 0, without drifting', () => {
    const e = h('ab', 0, 0);
    e.keys('llll');
    expect(e.caret).toBe(2);
    e.keys('hhhh');
    expect(e.caret).toBe(0);
  });

  it('motions at EOL are no-ops, not errors', () => {
    const e = h('abc', 0, 3);
    for (const k of ['w', 'e', 'l', ' ']) {
      e.keys(k);
      expect(e.caret).toBe(3);
    }
  });

  it('x/D/C at EOL leave the line intact', () => {
    const e = h('abc', 0, 3);
    e.keys('x');
    expect(e.line).toBe('abc');
    e.keys('D');
    expect(e.line).toBe('abc');
    e.keys('C');
    expect(e.line).toBe('abc');
    expect(e.mode).toBe('insert');
  });

  it('r and ~ at EOL are no-ops', () => {
    const e = h('abc', 0, 3);
    e.keys('rz');
    expect(e.line).toBe('abc');
    e.keys('~');
    expect(e.line).toBe('abc');
  });

  it('a at EOL enters insert at the very end', () => {
    const e = h('abc', 0, 3);
    e.keys('a');
    expect(e.mode).toBe('insert');
    expect(e.caret).toBe(3);
  });

  it('dgl at EOL deletes nothing, dgh deletes back to first non-blank', () => {
    const e = h('abc', 0, 3);
    e.keys('dgl');
    expect(e.line).toBe('abc');
    e.keys('dgh');
    expect(e.line).toBe('');
  });

  it('x with a count larger than the rest of the line clamps (vim)', () => {
    const e = h('abcd', 0, 2);
    e.keys('9x');
    expect(e.line).toBe('ab');
    expect(e.caret).toBe(2);
  });

  it('X with a count larger than the prefix clamps', () => {
    const e = h('abcd', 0, 2);
    e.keys('9X');
    expect(e.line).toBe('cd');
    expect(e.caret).toBe(0);
  });

  it('$ then x is a no-op but gl-e-x deletes the last char... via h', () => {
    const e = h('abc', 0, 0);
    e.keys('glhx');
    expect(e.line).toBe('ab');
  });
});

describe('empty and single-char lines', () => {
  it('every motion is safe on an empty line', () => {
    const e = h('', 0, 0);
    e.keys('hlwbe0^glghfz');
    expect(e.line).toBe('');
    expect(e.caret).toBe(0);
    expect(e.mode).toBe('normal');
  });

  it('operators on an empty line do nothing and abort cleanly', () => {
    const e = h('', 0, 0);
    e.keys('dwdiwdaw');
    expect(e.line).toBe('');
    expect(e.mode).toBe('normal');
  });

  it('v on an empty line then d deletes nothing', () => {
    const e = h('', 0, 0);
    e.keys('vd');
    expect(e.line).toBe('');
    expect(e.mode).toBe('normal');
  });

  it('~ and r on an empty line are no-ops', () => {
    const e = h('', 0, 0);
    e.keys('~rz');
    expect(e.line).toBe('');
  });

  it('p of a char register onto an empty line works', () => {
    const e = h(['ab', ''], 0, 0);
    e.keys('x'); // register: 'a'
    e.keys('j');
    e.keys('p');
    expect(e.lines[1]).toBe('a');
  });

  it('single-char line: x empties it, caret at 0', () => {
    const e = h('x', 0, 0);
    e.keys('x');
    expect(e.line).toBe('');
    expect(e.caret).toBe(0);
  });

  it('single-char line: diw empties it', () => {
    const e = h('x', 0, 0);
    e.keys('diw');
    expect(e.line).toBe('');
  });

  it('single-char line: v selects it, d removes it', () => {
    const e = h('x', 0, 0);
    e.keys('vd');
    expect(e.line).toBe('');
  });
});

describe('emoji / astral characters (code-point stepping)', () => {
  // 'a😀b' — a=0, 😀 occupies units 1..3, b=3, len 4
  it('l and h step over an emoji as ONE character', () => {
    const e = h('a😀b', 0, 0);
    e.keys('l');
    expect(e.caret).toBe(1);
    e.keys('l');
    expect(e.caret).toBe(3); // never 2 (mid-pair)
    e.keys('h');
    expect(e.caret).toBe(1);
  });

  it('x deletes a whole emoji, never half of it', () => {
    const e = h('a😀b', 0, 1);
    e.keys('x');
    expect(e.line).toBe('ab');
    expect(e.clipboard).toBe('😀');
  });

  it('2x from the start deletes a + whole emoji', () => {
    const e = h('a😀b', 0, 0);
    e.keys('2x');
    expect(e.line).toBe('b');
  });

  it('X deletes a whole emoji backwards', () => {
    const e = h('a😀b', 0, 3);
    e.keys('X');
    expect(e.line).toBe('ab');
  });

  it('r replaces a whole emoji with one char', () => {
    const e = h('a😀b', 0, 1);
    e.keys('rz');
    expect(e.line).toBe('azb');
  });

  it('~ leaves an emoji intact and advances past it', () => {
    const e = h('a😀b', 0, 1);
    e.keys('~');
    expect(e.line).toBe('a😀b');
    expect(e.caret).toBe(3);
  });

  it('s on an emoji removes the pair and enters insert', () => {
    const e = h('a😀b', 0, 1);
    e.keys('sZ<esc>');
    expect(e.line).toBe('aZb');
  });

  it('v on an emoji selects the whole pair (d removes both units)', () => {
    const e = h('a😀b', 0, 1);
    e.keys('vd');
    expect(e.line).toBe('ab');
  });

  it('v e e extends over an emoji run cleanly (emoji is its own word)', () => {
    const e = h('ab😀 cd', 0, 0);
    e.keys('veed');
    // column-0 delete swallows the doomed leading space (RemNote trims it)
    expect(e.line).toBe('cd');
  });

  it('p after an emoji pastes past the whole pair', () => {
    const e = h('a😀b', 0, 0);
    e.keys('x'); // register 'a', line '😀b', caret 0
    e.keys('p'); // after the emoji, not inside it
    expect(e.line).toBe('😀ab');
  });

  it('a (append) from an emoji moves past both units', () => {
    const e = h('😀x', 0, 0);
    e.keys('a');
    expect(e.caret).toBe(2);
  });

  it('de on an emoji run deletes the run', () => {
    const e = h('😀😀 tail', 0, 0);
    e.keys('de');
    expect(e.line).toBe('tail'); // column-0 delete swallows the doomed space
  });
});

describe('atomic element placeholder (references/images/LaTeX)', () => {
  const CHIP = ATOMIC_CH; // 2 units, 1 code point — what the adapter feeds us
  const line = `see ${CHIP} end`; // s0 e1 e2 ' '3 chip4..6 ' '6 e7 n8 d9

  it('l/h treat a chip as one character', () => {
    const e = h(line, 0, 3);
    e.keys('l');
    expect(e.caret).toBe(4);
    e.keys('l');
    expect(e.caret).toBe(6);
    e.keys('h');
    expect(e.caret).toBe(4);
  });

  it('x deletes the whole chip', () => {
    const e = h(line, 0, 4);
    e.keys('x');
    expect(e.line).toBe('see  end');
  });

  it('r refuses to rewrite a chip', () => {
    const e = h(line, 0, 4);
    e.keys('rz');
    expect(e.line).toBe(line);
  });

  it('~ refuses a range containing a chip', () => {
    const e = h(line, 0, 3);
    e.keys('3~');
    expect(e.line).toBe(line);
  });

  it('~ before the chip works normally', () => {
    const e = h(line, 0, 0);
    e.keys('3~');
    expect(e.line).toBe(`SEE ${CHIP} end`);
  });

  it('w from the start lands on the chip (punct word), then past it', () => {
    const e = h(line, 0, 0);
    e.keys('w');
    expect(e.caret).toBe(4);
    e.keys('w');
    expect(e.caret).toBe(7);
  });

  it('dw across the chip deletes it; paste does NOT resurrect it as text', () => {
    const e = h(line, 0, 4);
    e.keys('dw'); // register holds chip+space
    expect(e.line).toBe('see end');
    e.keys('P'); // placeholder is stripped on plain-text insertion
    expect(e.line).toBe('see  end');
    expect(e.line.includes(CHIP)).toBe(false);
  });

  it('D from the chip clears through EOL', () => {
    const e = h(line, 0, 4);
    e.keys('D');
    expect(e.line).toBe('see ');
  });

  it('motions and EOL math agree on a chip-terminated line', () => {
    const e = h(`ab ${CHIP}`, 0, 0);
    e.keys('gl');
    expect(e.caret).toBe(5); // 2 text + space + 2-unit chip
    e.keys('hx');
    expect(e.line).toBe('ab ');
  });

  it('diw on text after a chip is unaffected by the chip width', () => {
    const e = h(line, 0, 8);
    e.keys('diw');
    expect(e.line).toBe(`see ${CHIP} `);
  });
});

describe('r (replace) vim semantics', () => {
  it('count larger than the rest of the line fails outright (no partial)', () => {
    const e = h('abc', 0, 1);
    e.keys('5rz');
    expect(e.line).toBe('abc');
  });

  it('count exactly fitting replaces all', () => {
    const e = h('abc', 0, 1);
    e.keys('2rz');
    expect(e.line).toBe('azz');
  });

  it('r at column 0 does not swallow the following space (keepLead)', () => {
    const e = h('a b', 0, 0);
    e.keys('rx');
    expect(e.line).toBe('x b');
  });

  it('~ at column 0 does not swallow the following space (keepLead)', () => {
    const e = h('a b', 0, 0);
    e.keys('~');
    expect(e.line).toBe('A b');
  });

  it('r aborted with Escape leaves the line alone', () => {
    const e = h('abc', 0, 0);
    e.keys('r<esc>x');
    expect(e.line).toBe('bc'); // Escape aborted r; x then deleted normally
  });

  it('r with a count replaces distinct positions, caret stays put', () => {
    const e = h('abcd', 0, 1);
    e.keys('3rz');
    expect(e.line).toBe('azzz');
    expect(e.caret).toBe(1);
  });
});

describe('counts in odd positions', () => {
  it('2d3w deletes six words', () => {
    const e = h('a b c d e f g', 0, 0);
    e.keys('2d3w');
    expect(e.line).toBe('g');
  });

  it('d2fx deletes through the second x', () => {
    const e = h('axbxc', 0, 0);
    e.keys('d2fx');
    expect(e.line).toBe('c');
  });

  it('2ft lands ON the second t', () => {
    const e = h('attention to detail', 0, 0);
    e.keys('2ft'); // a0 t1 t2 — the 2nd t is index 2
    expect(e.caret).toBe(2);
  });

  it('count 0 is the line-start motion, not a count digit', () => {
    const e = h('hello', 0, 4);
    e.keys('0');
    expect(e.caret).toBe(0);
  });

  it('10l uses the multi-digit count', () => {
    const e = h('abcdefghijklmnop', 0, 0);
    e.keys('10l');
    expect(e.caret).toBe(10);
  });

  it('count then a non-command key aborts cleanly', () => {
    const e = h('abc', 0, 0);
    e.keys('3q');
    e.keys('x');
    expect(e.line).toBe('bc'); // the count did not leak into x
  });

  it('d3d deletes three lines (count between doubled operator)', () => {
    const e = h(['a', 'b', 'c', 'd'], 0, 0);
    e.keys('d3d');
    expect(e.lines).toEqual(['d']);
  });
});

describe('F/T typed directly (engine-level; unreachable live)', () => {
  it('F finds the char immediately left of the cursor (regression)', () => {
    const e = h('abc', 0, 2);
    e.keys('Fb');
    expect(e.caret).toBe(1);
  });

  it('dFb deletes just the b', () => {
    const e = h('abc', 0, 2);
    e.keys('dFb');
    expect(e.line).toBe('ac');
  });

  it('T lands just after the found char', () => {
    const e = h('x_abc', 0, 4);
    e.keys('Tx');
    expect(e.caret).toBe(1);
  });

  it(', reverse-repeat after f skips the char the caret touches', () => {
    const e = h('xoxo', 0, 0);
    e.keys('fofo'); // ON the o at 3 (x0 o1 x2 o3)
    expect(e.caret).toBe(3);
    e.keys(','); // F reverse-repeat — lands on the earlier o at 1
    expect(e.caret).toBe(1);
    e.keys(','); // nothing earlier — stays
    expect(e.caret).toBe(1);
  });
});

describe('visual mode boundary cases', () => {
  it('vd at the last char of the line', () => {
    const e = h('abc', 0, 2);
    e.keys('vd');
    expect(e.line).toBe('ab');
  });

  it('v entered at EOL snaps onto the last char', () => {
    const e = h('abc', 0, 3);
    e.keys('vd');
    expect(e.line).toBe('ab');
  });

  it('v0 selects back to the line start', () => {
    const e = h('abcd', 0, 2);
    e.keys('v0d');
    expect(e.line).toBe('d'); // chars 0..2 inclusive deleted
  });

  it('vfx selects through the x inclusively', () => {
    const e = h('abxcd', 0, 0);
    e.keys('vfxd');
    expect(e.line).toBe('cd');
  });

  it('vFx from the end selects back onto the x', () => {
    const e = h('axbcd', 0, 3);
    e.keys('vFxd');
    expect(e.line).toBe('ad'); // x..c inclusive removed
  });

  it('visual o then extension moves the other end', () => {
    const e = h('abcdef', 0, 2);
    e.keys('vlloh'); // select c..e, swap, pull anchor-side left
    e.keys('d');
    expect(e.line).toBe('af');
  });

  it('visual y leaves the text intact and the caret at selection start', () => {
    const e = h('hello', 0, 1);
    e.keys('vlly');
    expect(e.line).toBe('hello');
    expect(e.caret).toBe(1);
    expect(e.clipboard).toBe('ell');
  });

  it('visual p replaces the selection with the register', () => {
    const e = h('hello world', 0, 0);
    e.keys('yw'); // register 'hello '
    e.keys('wvlp'); // select 'wo', replace
    expect(e.line).toBe('hello hello rld');
  });

  it('escape from visual with a pending count discards it', () => {
    const e = h('abcdef', 0, 0);
    e.keys('v3<esc>');
    expect(e.mode).toBe('normal');
    e.keys('x');
    expect(e.line).toBe('bcdef'); // count did not leak
  });

  it('vit-like unknown text object aborts without breaking the selection', () => {
    const e = h('abc', 0, 0);
    e.keys('viq'); // no such object
    expect(e.mode).toBe('visual');
    e.keys('<esc>');
    expect(e.mode).toBe('normal');
  });
});

describe('operator abort and recovery', () => {
  it('operator + Escape aborts', () => {
    const e = h('abc def', 0, 0);
    e.keys('d<esc>w');
    expect(e.line).toBe('abc def');
    expect(e.caret).toBe(4); // w moved normally afterwards
  });

  it('operator + unknown motion aborts and does not eat the next key', () => {
    const e = h('abc def', 0, 0);
    e.keys('dq');
    expect(e.line).toBe('abc def');
    e.keys('x');
    expect(e.line).toBe('bc def');
  });

  it('df with a char that does not occur aborts', () => {
    const e = h('abc', 0, 0);
    e.keys('dfz');
    expect(e.line).toBe('abc');
  });

  it('di with an unmatched pair aborts', () => {
    const e = h('abc', 0, 1);
    e.keys('di[');
    expect(e.line).toBe('abc');
  });

  it('c + Escape aborts without entering insert', () => {
    const e = h('abc', 0, 0);
    e.keys('c<esc>');
    expect(e.mode).toBe('normal');
    expect(e.line).toBe('abc');
  });
});

describe('register edge cases', () => {
  it('p with an empty register is a no-op', () => {
    const e = h('abc', 0, 0);
    e.keys('p');
    expect(e.line).toBe('abc');
  });

  it('yank does not move text; register survives motions', () => {
    const e = h('one two', 0, 0);
    e.keys('yw');
    e.keys('wwgh0');
    e.keys('P');
    expect(e.line).toBe('one one two');
  });

  it('3p repeats a char register three times', () => {
    const e = h('xy', 0, 0);
    e.keys('yl'); // 'x'
    e.keys('3p');
    expect(e.line).toBe('xxxxy');
  });

  it('x on the last char then p appends after it', () => {
    const e = h('ab', 0, 1);
    e.keys('x'); // 'b' cut, line 'a', caret 1 → clamped
    e.keys('p');
    expect(e.line).toBe('ab');
  });

  it('D then p pastes the tail after the cursor char', () => {
    const e = h('abcdef', 0, 3);
    e.keys('D'); // register 'def', line 'abc', caret 3
    e.keys('hP');
    expect(e.line).toBe('abdefc');
  });
});

describe('dot-repeat interplay with the new semantics', () => {
  it('. repeats x over an emoji correctly at a new position', () => {
    const e = h('a😀b😀c', 0, 1);
    e.keys('x'); // deletes first emoji
    expect(e.line).toBe('ab😀c');
    e.keys('l'); // caret 2 → onto the second emoji
    e.keys('.');
    expect(e.line).toBe('abc');
  });

  it('. repeats a failed r as a no-op without corrupting state', () => {
    const e = h('ab', 0, 0);
    e.keys('rz'); // line 'zb'
    e.keys('gl'); // caret 2 = EOL
    e.keys('.'); // r at EOL fails silently
    expect(e.line).toBe('zb');
  });

  it('. repeats ~ with keepLead at column 0', () => {
    const e = h(['a b', 'c d'], 0, 0);
    e.keys('~'); // 'A b'
    e.keys('j0');
    e.keys('.');
    expect(e.lines).toEqual(['A b', 'C d']);
  });

  it('an aborted command does not clobber lastChange', () => {
    const e = h('abcdef', 0, 0);
    e.keys('x'); // lastChange = x
    e.keys('dq'); // aborted operator
    e.keys('.');
    expect(e.line).toBe('cdef');
  });
});

describe('command-line editing edges', () => {
  it('typing after Tab-less content builds the buffer, Escape clears it', () => {
    const e = h('abc');
    e.keys(';sort n');
    expect(e.commandLine).toBe('sort n');
    e.keys('<esc>');
    expect(e.commandLine).toBe('');
    expect(e.mode).toBe('normal');
  });

  it('backspace across the whole buffer exits command mode', () => {
    const e = h('abc');
    e.keys(';ab<bs><bs><bs>');
    expect(e.mode).toBe('normal');
  });

  it('enter on whitespace-only command line runs nothing', () => {
    const e = h('abc');
    e.keys('; <cr>');
    expect(e.lastEx).toBeNull();
    expect(e.mode).toBe('normal');
  });

  it('count digits typed before ; do not leak into the command line', () => {
    const e = h('abc');
    e.keys('3;w<cr>');
    expect(e.lastEx).toBe('w');
  });

  it('special keys other than printables are ignored while typing', () => {
    const e = h('abc');
    e.keys(';e<c-d>x');
    expect(e.commandLine).toBe('ex');
  });
});

describe('multi-line stability (larger documents)', () => {
  const many = Array.from({ length: 40 }, (_, i) => `line ${i}`);

  it('long j/k runs clamp at both ends', () => {
    const e = h([...many], 0, 0);
    e.keys('99j');
    expect(e.row).toBe(39);
    e.keys('99k');
    expect(e.row).toBe(0);
  });

  it('caret column clamps when moving to a shorter line', () => {
    const e = h(['aaaaaaaaaa', 'bb', 'cccccccccc'], 0, 8);
    e.keys('j');
    expect(e.caret).toBe(2);
    e.keys('j');
    expect(e.caret).toBe(2); // the clamped column persists (adapter model)
  });

  it('gg and ge from the middle of a long doc', () => {
    const e = h([...many], 20, 3);
    e.keys('gg');
    expect(e.row).toBe(0);
    e.keys('ge');
    expect(e.row).toBe(39);
  });

  it('dd at the last line moves the cursor up, not out', () => {
    const e = h(['a', 'b', 'c'], 2, 0);
    e.keys('dd');
    expect(e.lines).toEqual(['a', 'b']);
    expect(e.row).toBe(1);
  });

  it('V-selection across many lines with a big count clamps', () => {
    const e = h([...many], 35, 0);
    e.keys('vv99jd');
    expect(e.lines.length).toBe(35);
  });

  it('undo after a large visual-line cut restores everything', () => {
    const e = h([...many], 5, 0);
    e.keys('vv9jd');
    expect(e.lines.length).toBe(30);
    e.keys('u');
    expect(e.lines).toEqual(many);
  });
});
