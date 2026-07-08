import { describe, expect, it } from 'vitest';
import { Harness } from './harness';

const h = (lines: string[] | string, row = 0, caret = 0) =>
  new Harness(typeof lines === 'string' ? [lines] : lines, row, caret);

describe('motions', () => {
  it('h/l move by chars and clamp', () => {
    const e = h('hello');
    e.keys('lll');
    expect(e.caret).toBe(3);
    e.keys('hh');
    expect(e.caret).toBe(1);
    e.keys('hhhh');
    expect(e.caret).toBe(0);
    e.keys('99l');
    expect(e.caret).toBe(5);
  });

  it('0, ^ and $', () => {
    const e = h('  hello', 0, 4);
    e.keys('$');
    expect(e.caret).toBe(7);
    e.keys('0');
    expect(e.caret).toBe(0);
    e.keys('^');
    expect(e.caret).toBe(2);
  });

  it('w/b/e word motions', () => {
    const e = h('hello world foo');
    e.keys('w');
    expect(e.caret).toBe(6);
    e.keys('w');
    expect(e.caret).toBe(12);
    e.keys('bb');
    expect(e.caret).toBe(0);
    e.keys('e');
    expect(e.caret).toBe(5);
    e.keys('e');
    expect(e.caret).toBe(11);
  });

  it('w treats punctuation as its own word, W does not', () => {
    const e = h('foo-bar baz');
    e.keys('w');
    expect(e.caret).toBe(3);
    e.keys('w');
    expect(e.caret).toBe(4);
    const e2 = h('foo-bar baz');
    e2.keys('W');
    expect(e2.caret).toBe(8);
  });

  it('counts multiply motions', () => {
    const e = h('one two three four');
    e.keys('3w');
    expect(e.caret).toBe(14);
    e.keys('2b');
    expect(e.caret).toBe(4);
  });

  it('f/t/, char search (; is the command line, not a repeat)', () => {
    const e = h('hello world');
    e.keys('fo');
    expect(e.caret).toBe(4); // ON the first o
    e.keys('fo');
    expect(e.caret).toBe(7); // ON the o in world
    e.keys(',');
    expect(e.caret).toBe(4); // , reverse-repeats: back to the first o
    const e2 = h('hello world');
    e2.keys('t ');
    expect(e2.caret).toBe(5); // just before the space
  });

  it('j/k move vertically, Enter moves down', () => {
    const e = h(['a', 'b', 'c']);
    e.keys('j');
    expect(e.row).toBe(1);
    e.keys('2j');
    expect(e.row).toBe(2); // clamped
    e.keys('kk');
    expect(e.row).toBe(0);
    e.keys('<cr>');
    expect(e.row).toBe(1);
  });

  it('gg and G jump to document boundaries', () => {
    const e = h(['a', 'b', 'c'], 1);
    e.keys('G');
    expect(e.row).toBe(2);
    e.keys('gg');
    expect(e.row).toBe(0);
  });
});

describe('simple edits', () => {
  it('x deletes forward, X backward, with counts', () => {
    const e = h('abcdef', 0, 0);
    e.keys('x');
    expect(e.line).toBe('bcdef');
    e.keys('2x');
    expect(e.line).toBe('def');
    const e2 = h('abcdef', 0, 4);
    e2.keys('X');
    expect(e2.line).toBe('abcef');
    e2.keys('2X');
    expect(e2.line).toBe('aef');
  });

  it('x at end of line is a no-op', () => {
    const e = h('abc', 0, 3);
    e.keys('x');
    expect(e.line).toBe('abc');
  });

  it('D and C delete to end of line', () => {
    const e = h('hello world', 0, 5);
    e.keys('D');
    expect(e.line).toBe('hello');
    expect(e.mode).toBe('normal');
    const e2 = h('hello world', 0, 5);
    e2.keys('C');
    expect(e2.line).toBe('hello');
    expect(e2.mode).toBe('insert');
  });

  it('r replaces characters in place', () => {
    const e = h('abc');
    e.keys('rx');
    expect(e.line).toBe('xbc');
    expect(e.caret).toBe(0);
    const e2 = h('abc');
    e2.keys('3rz');
    expect(e2.line).toBe('zzz');
  });

  it('~ toggles case and advances', () => {
    const e = h('abC');
    e.keys('~');
    expect(e.line).toBe('AbC');
    expect(e.caret).toBe(1);
    e.keys('2~');
    expect(e.line).toBe('ABc');
  });

  it('s substitutes a char and enters insert', () => {
    const e = h('abc');
    e.keys('sx<esc>');
    expect(e.line).toBe('xbc');
  });

  it('S and cc clear the line and enter insert', () => {
    for (const cmd of ['S', 'cc']) {
      const e = h('hello', 0, 3);
      e.keys(cmd);
      expect(e.line).toBe('');
      expect(e.mode).toBe('insert');
    }
  });
});

describe('operators with motions', () => {
  it('dw from start and mid-word', () => {
    const e = h('hello world');
    e.keys('dw');
    expect(e.line).toBe('world');
    const e2 = h('hello world', 0, 2);
    e2.keys('dw');
    expect(e2.line).toBe('heworld');
  });

  it('de, d$, d0', () => {
    // vim would leave " world"; the adapter mirrors RemNote's leading-space
    // trim, so a column-0 delete swallows the whitespace run too.
    const e = h('hello world');
    e.keys('de');
    expect(e.line).toBe('world');
    const e2 = h('hello world', 0, 5);
    e2.keys('d$');
    expect(e2.line).toBe('hello');
    const e3 = h('hello world', 0, 6);
    e3.keys('d0');
    expect(e3.line).toBe('world');
  });

  it('de on a one-char word deletes just that word (I-beam e)', () => {
    // the reported bug: "a asdf" with the caret at 0 — de must delete "a",
    // not everything through "asdf"
    const e = h('a asdf');
    e.keys('de');
    expect(e.line).toBe('asdf');
    // and plain e from the same spot moves one word-end, not two
    const e2 = h('a asdf');
    e2.keys('e');
    expect(e2.caret).toBe(1);
    e2.keys('e');
    expect(e2.caret).toBe(6);
  });

  it('dgl deletes to end of line (live d$), dgh to first non-blank', () => {
    const e = h('hello world', 0, 5);
    e.keys('dgl');
    expect(e.line).toBe('hello');
    const e2 = h('hello world', 0, 6);
    e2.keys('dgh');
    expect(e2.line).toBe('world');
  });

  it('d with count: d2w', () => {
    const e = h('one two three four');
    e.keys('d2w');
    expect(e.line).toBe('three four');
    const e2 = h('one two three four');
    e2.keys('2dw');
    expect(e2.line).toBe('three four');
  });

  it('df and dt include/exclude the target char', () => {
    const e = h('hello world');
    e.keys('dfo');
    expect(e.line).toBe('world'); // vim: " world"; RemNote trims the lead space
    const e2 = h('hello world');
    e2.keys('dto');
    expect(e2.line).toBe('o world');
  });

  it('cw behaves like ce on a word char', () => {
    const e = h('hello world');
    e.keys('cwbye<esc>');
    expect(e.line).toBe('bye world');
  });

  it('dh and dl', () => {
    const e = h('abcd', 0, 2);
    e.keys('dh');
    expect(e.line).toBe('acd');
    const e2 = h('abcd', 0, 1);
    e2.keys('2dl');
    expect(e2.line).toBe('ad');
  });
});

describe('text objects', () => {
  it('diw deletes the inner word from mid-word', () => {
    const e = h('hello world', 0, 2);
    e.keys('diw');
    expect(e.line).toBe('world'); // vim: " world"; RemNote trims the lead space
  });

  it('daw also deletes trailing whitespace', () => {
    const e = h('hello world', 0, 2);
    e.keys('daw');
    expect(e.line).toBe('world');
  });

  it('ciw enters insert with the word removed', () => {
    const e = h('hello world', 0, 8);
    e.keys('ciwmoon<esc>');
    expect(e.line).toBe('hello moon');
  });

  it('diw on whitespace deletes the space run', () => {
    const e = h('a   b', 0, 2);
    e.keys('diw');
    expect(e.line).toBe('ab');
  });
});

describe('insert mode entries', () => {
  it('i / a position the caret', () => {
    const e = h('abc', 0, 1);
    e.keys('iX<esc>');
    expect(e.line).toBe('aXbc');
    const e2 = h('abc', 0, 1);
    e2.keys('aX<esc>');
    expect(e2.line).toBe('abXc');
  });

  it('I / A jump to line boundaries', () => {
    const e = h('  abc', 0, 3);
    e.keys('IX<esc>');
    expect(e.line).toBe('  Xabc');
    const e2 = h('abc', 0, 1);
    e2.keys('AX<esc>');
    expect(e2.line).toBe('abcX');
  });

  it('o / O create a new bullet below/above', () => {
    const e = h(['one', 'two'], 0);
    e.keys('onew<esc>');
    expect(e.lines).toEqual(['one', 'new', 'two']);
    expect(e.row).toBe(1);
    const e2 = h(['one', 'two'], 1);
    e2.keys('Onew<esc>');
    expect(e2.lines).toEqual(['one', 'new', 'two']);
  });

  it('escape returns to normal mode', () => {
    const e = h('abc');
    e.keys('i');
    expect(e.mode).toBe('insert');
    e.keys('<esc>');
    expect(e.mode).toBe('normal');
  });
});

describe('lines (rems)', () => {
  it('dd deletes the line, 2dd deletes two', () => {
    const e = h(['a', 'b', 'c'], 1);
    e.keys('dd');
    expect(e.lines).toEqual(['a', 'c']);
    expect(e.row).toBe(1);
    const e2 = h(['a', 'b', 'c'], 0);
    e2.keys('2dd');
    expect(e2.lines).toEqual(['c']);
  });

  it('dd on the last remaining line leaves an empty one', () => {
    const e = h(['only']);
    e.keys('dd');
    expect(e.lines).toEqual(['']);
  });

  it('yy p / P paste lines below/above', () => {
    const e = h(['a', 'b'], 0);
    e.keys('yyp');
    expect(e.lines).toEqual(['a', 'a', 'b']);
    expect(e.row).toBe(1);
    const e2 = h(['a', 'b'], 1);
    e2.keys('yyP');
    expect(e2.lines).toEqual(['a', 'b', 'b']);
    expect(e2.row).toBe(1);
  });

  it('dd then p moves a line', () => {
    const e = h(['a', 'b', 'c'], 0);
    e.keys('ddjp');
    expect(e.lines).toEqual(['b', 'c', 'a']);
  });

  it('Y is an alias for yy', () => {
    const e = h(['a', 'b'], 0);
    e.keys('Yp');
    expect(e.lines).toEqual(['a', 'a', 'b']);
  });

  it('>> and << change indent', () => {
    const e = h(['a']);
    e.keys('>>');
    expect(e.indents[0]).toBe(1);
    e.keys('<<');
    expect(e.indents[0]).toBe(0);
    e.keys('<<');
    expect(e.indents[0]).toBe(0);
  });
});

describe('registers', () => {
  it('xp swaps characters (classic idiom)', () => {
    const e = h('abc');
    e.keys('xp');
    expect(e.line).toBe('bac');
  });

  it('yw then p pastes after the cursor char', () => {
    const e = h('hello world');
    e.keys('yw$p');
    expect(e.line).toBe('hello worldhello ');
  });

  it('dw then P pastes before the cursor', () => {
    const e = h('one two', 0, 0);
    e.keys('dw$P');
    expect(e.line).toBe('twoone ');
  });

  it('deleted text lands in the register', () => {
    const e = h('abc def');
    e.keys('dw');
    expect(e.line).toBe('def');
    e.keys('$p');
    expect(e.line).toBe('defabc ');
  });

  it('p with a count repeats the register', () => {
    const e = h('ab');
    e.keys('yl');
    e.keys('3p');
    expect(e.line).toBe('aaaab');
  });
});

describe('visual mode (charwise, plain v)', () => {
  it('v + motions + d deletes the selection inclusively', () => {
    const e = h('hello');
    e.keys('vlld');
    expect(e.line).toBe('lo');
    expect(e.mode).toBe('normal');
  });

  it('h/l/w/b/e adjust the selection inside one bullet', () => {
    const e = h('one two three', 0, 4);
    e.keys('ve'); // select "two"
    expect(e.sel).toEqual({ start: 4, end: 7 });
    e.keys('l'); // extend over the space
    expect(e.sel).toEqual({ start: 4, end: 8 });
    e.keys('e'); // extend to the end of "three"
    expect(e.sel).toEqual({ start: 4, end: 13 });
    e.keys('bb'); // shrink back to the start of "two"
    expect(e.sel).toEqual({ start: 4, end: 5 });
    e.keys('d');
    expect(e.line).toBe('one wo three');
  });

  it('e advances to the NEXT word end when head is already on a word end', () => {
    const e = h('one two three', 0, 4);
    e.keys('ve'); // head lands ON 'o' of "two"
    expect(e.sel).toEqual({ start: 4, end: 7 });
    e.keys('e'); // must not get stuck: extend to the end of "three"
    expect(e.sel).toEqual({ start: 4, end: 13 });
  });

  it('vwd matches vim word selection', () => {
    const e = h('foo bar');
    e.keys('vwd');
    expect(e.line).toBe('ar');
  });

  it('v$y yanks to end of line, p pastes it', () => {
    const e = h('abc', 0, 1);
    e.keys('v$y');
    expect(e.caret).toBe(1);
    e.keys('$p');
    expect(e.line).toBe('abcbc');
  });

  it('vgl extends to end of line, vgh to first non-blank', () => {
    const e = h('hello', 0, 1);
    e.keys('vgld');
    expect(e.line).toBe('h');
    const e2 = h('  abc', 0, 4);
    e2.keys('vghd'); // anchor on 'c', back to first non-blank: "abc" goes
    expect(e2.line).toBe('  ');
  });

  it('vc changes the selection', () => {
    const e = h('hello world', 0, 0);
    e.keys('vllllcbye<esc>');
    expect(e.line).toBe('bye world');
  });

  it('o swaps anchor and head', () => {
    const e = h('abcdef', 0, 2);
    e.keys('vllohd');
    expect(e.line).toBe('af');
  });

  it('escape leaves visual without changes', () => {
    const e = h('abc');
    e.keys('vll<esc>');
    expect(e.line).toBe('abc');
    expect(e.mode).toBe('normal');
    expect(e.caret).toBe(2);
    // the native selection must be COLLAPSED, not left active (user-reported:
    // Escape kept the selection + RemNote's selection toolbar on screen)
    expect(e.sel).toBeNull();
  });

  it('vv (V) then d deletes the whole line', () => {
    const e = h(['a', 'b'], 0);
    e.keys('vvd');
    expect(e.lines).toEqual(['b']);
    expect(e.mode).toBe('normal');
  });

  it('vgg / vge escalate to a line-wise doc-boundary selection', () => {
    const e = h(['a', 'b', 'c', 'd'], 2);
    e.keys('vgg');
    expect(e.mode).toBe('visual-line');
    expect(e.vSelRows).toEqual([0, 2]);
    e.keys('d');
    expect(e.lines).toEqual(['d']);
    const e2 = h(['a', 'b', 'c', 'd'], 1);
    e2.keys('vge');
    expect(e2.vSelRows).toEqual([1, 3]);
    e2.keys('d');
    expect(e2.lines).toEqual(['a']);
  });
});

describe('visual-line mode (multi-bullet)', () => {
  const doc = () => ['one', 'two', 'three', 'four', 'five'];

  it('V j extends the selection down, k shrinks it', () => {
    const e = h(doc(), 1);
    e.keys('Vj');
    expect(e.vSelRows).toEqual([1, 2]);
    e.keys('j');
    expect(e.vSelRows).toEqual([1, 3]);
    e.keys('k');
    expect(e.vSelRows).toEqual([1, 2]);
  });

  it('V k selects upward from the anchor', () => {
    const e = h(doc(), 2);
    e.keys('Vk');
    expect(e.vSelRows).toEqual([1, 2]);
  });

  it('V j d cuts two bullets into the line register', () => {
    const e = h(doc(), 1);
    e.keys('Vjd');
    expect(e.lines).toEqual(['one', 'four', 'five']);
    expect(e.lineRegister).toEqual(['two', 'three']);
    expect(e.mode).toBe('normal');
  });

  it('cut bullets can be pasted back with p', () => {
    const e = h(doc(), 1);
    e.keys('Vjd'); // cut "two","three"; row is now on "four"
    e.keys('jp'); // move to "five", paste below
    expect(e.lines).toEqual(['one', 'four', 'five', 'two', 'three']);
  });

  it('V 2j selects with a count', () => {
    const e = h(doc(), 0);
    e.keys('V2jd');
    expect(e.lines).toEqual(['four', 'five']);
  });

  it('V j y yanks without deleting, p duplicates', () => {
    const e = h(doc(), 0);
    e.keys('Vjy');
    expect(e.lines).toEqual(doc());
    expect(e.lineRegister).toEqual(['one', 'two']);
    e.keys('p');
    expect(e.lines).toEqual(['one', 'one', 'two', 'two', 'three', 'four', 'five']);
  });

  it('V j > indents both bullets, < outdents them', () => {
    const e = h(doc(), 1);
    e.keys('Vj>');
    expect(e.indents).toEqual([0, 1, 1, 0, 0]);
    expect(e.mode).toBe('normal');
    const e2 = h(doc(), 1);
    e2.keys('Vj>');
    e2.keys('Vj<');
    expect(e2.indents).toEqual([0, 0, 0, 0, 0]);
  });

  it('selection clamps at the document end', () => {
    const e = h(['a', 'b'], 1);
    e.keys('Vjjjd');
    expect(e.lines).toEqual(['a']);
  });

  it('escape leaves visual-line without changes', () => {
    const e = h(doc(), 1);
    e.keys('Vjj<esc>');
    expect(e.lines).toEqual(doc());
    expect(e.mode).toBe('normal');
    expect(e.vSelRows).toBeNull();
  });

  it('undo restores a multi-bullet cut', () => {
    const e = h(doc(), 0);
    e.keys('Vjjd');
    expect(e.lines).toEqual(['four', 'five']);
    e.keys('u');
    expect(e.lines).toEqual(doc());
  });
});

describe('shift-blind synonyms (live-reachable spellings)', () => {
  const doc = () => ['one', 'two', 'three', 'four'];

  it('single v enters CHARWISE visual (in-bullet selection first)', () => {
    const e = h(doc(), 0);
    e.keys('v');
    expect(e.mode).toBe('visual');
    e.keys('jd'); // j upgrades to line-wise, so vjd still cuts two bullets
    expect(e.lines).toEqual(['three', 'four']);
  });

  it('v cycles: charwise → line-mode → normal', () => {
    const e = h('hello');
    e.keys('v');
    expect(e.mode).toBe('visual');
    e.keys('v');
    expect(e.mode).toBe('visual-line');
    e.keys('v');
    expect(e.mode).toBe('normal');
  });

  it('v then j switches to visual-line and extends (V j muscle memory)', () => {
    const e = h(doc(), 0);
    e.keys('vj');
    expect(e.mode).toBe('visual-line');
    expect(e.vSelRows).toEqual([0, 1]);
    e.keys('d');
    expect(e.lines).toEqual(['three', 'four']);
  });

  it('v 2j extends two lines with a count', () => {
    const e = h(doc(), 0);
    e.keys('v2jd');
    expect(e.lines).toEqual(['four']);
  });

  it('v then k extends upward', () => {
    const e = h(doc(), 2);
    e.keys('vkd');
    expect(e.lines).toEqual(['one', 'four']);
  });

  it('vv gives line-wise visual (V), then jd cuts bullets', () => {
    const e = h(doc(), 0);
    e.keys('vv');
    expect(e.mode).toBe('visual-line');
    e.keys('jd');
    expect(e.lines).toEqual(['three', 'four']);
  });

  it('. and , indent/outdent in visual-line', () => {
    const e = h(doc(), 1);
    e.keys('vj.');
    expect(e.indents).toEqual([0, 1, 1, 0]);
    e.keys('vj,');
    expect(e.indents).toEqual([0, 0, 0, 0]);
  });

  it('; without a pending find opens the command line', () => {
    const e = h('abc');
    e.keys(';');
    expect(e.mode).toBe('command');
    e.keys('w<cr>');
    expect(e.lastEx).toBe('w');
  });

  it('; opens the command line even after an f find (repeat retired)', () => {
    const e = h('a.b.c');
    e.keys('f.');
    // f lands the cursor ON the found char (index 1), not one past it — the
    // offset AFTER the char is `findChar`'s inclusive operator-range end, used
    // only by df/dt. A plain f then x must delete the char it landed on.
    expect(e.caret).toBe(1);
    e.keys(';');
    expect(e.mode).toBe('command');
    e.keys('<esc>');
    // , still reverse-repeats the find
    e.keys('f.,');
    expect(e.caret).toBe(1);
  });

  it('f lands ON the char so f<c> then x deletes exactly that char', () => {
    const e = h('the lazy dog');
    e.keys('fz');
    expect(e.caret).toBe(6); // the z in "lazy" (t0 h1 e2 _3 l4 a5 z6)
    e.keys('x');
    expect(e.lines[0]).toBe('the lay dog');
  });

  it('/ does NOT open the command line (RemNote slash menu owns it)', () => {
    const e = h('abc');
    e.keys('/');
    expect(e.mode).toBe('normal');
  });

  it("'/' and '-' are typeable INSIDE the command line (:s syntax, :e args)", () => {
    const e = h('abc');
    e.keys(';s/a-b/c/g<cr>');
    expect(e.lastEx).toBe('s/a-b/c/g');
    expect(e.mode).toBe('normal');
  });

  it('backtick toggles case like ~', () => {
    const e = h('abc');
    e.keys('`');
    expect(e.line).toBe('Abc');
  });

  it('g-chords: ge → doc end, gl → line end, gh → first non-blank', () => {
    const e = h(['  one', 'two', 'three'], 0, 3);
    e.keys('ge');
    expect(e.row).toBe(2);
    e.keys('gg');
    expect(e.row).toBe(0);
    e.keys('gl');
    expect(e.caret).toBe(5);
    e.keys('gh');
    expect(e.caret).toBe(2);
  });

  it('go opens a bullet above like O', () => {
    const e = h(['one', 'two'], 1);
    e.keys('gonew<esc>');
    expect(e.lines).toEqual(['one', 'new', 'two']);
  });

  it('gd / gu scroll like Ctrl-D / Ctrl-U', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `l${i}`);
    const e = h(lines, 0);
    e.keys('gd');
    expect(e.row).toBe(12);
    e.keys('gu');
    expect(e.row).toBe(0);
  });
});

describe('undo / redo', () => {
  it('u undoes dd, C-r redoes it', () => {
    const e = h(['a', 'b'], 0);
    e.keys('dd');
    expect(e.lines).toEqual(['b']);
    e.keys('u');
    expect(e.lines).toEqual(['a', 'b']);
    e.keys('<c-r>');
    expect(e.lines).toEqual(['b']);
  });

  it('u undoes x', () => {
    const e = h('abc');
    e.keys('x');
    expect(e.line).toBe('bc');
    e.keys('u');
    expect(e.line).toBe('abc');
  });

  it('u undoes typed insert-mode text as one unit', () => {
    const e = h('x', 0, 1);
    e.keys('ahello<esc>');
    expect(e.line).toBe('xhello');
    e.keys('u');
    expect(e.line).toBe('x');
  });
});

describe('edge cases', () => {
  it('all commands are safe on an empty line', () => {
    const e = h('');
    e.keys('x$0^wbeD~');
    expect(e.line).toBe('');
    expect(e.caret).toBe(0);
    expect(e.mode).toBe('normal');
  });

  it('unmapped keys in normal mode are consumed as no-ops', () => {
    const e = h('abc');
    e.keys('qmz');
    expect(e.line).toBe('abc');
    expect(e.mode).toBe('normal');
  });

  it('count then escape aborts cleanly', () => {
    const e = h('abcdef');
    e.keys('3<esc>x');
    expect(e.line).toBe('bcdef');
  });

  it('operator then invalid motion aborts', () => {
    const e = h('abc');
    e.keys('dqx');
    expect(e.line).toBe('bc');
  });

  it('space and backspace move in normal mode', () => {
    const e = h('abc', 0, 1);
    e.keys('<space>');
    expect(e.caret).toBe(2);
    e.keys('<bs>');
    expect(e.caret).toBe(1);
  });
});

describe('scrolling (Ctrl-D/U)', () => {
  const doc = () => Array.from({ length: 30 }, (_, i) => `line${i}`);

  it('Ctrl-D moves the caret down a page, Ctrl-U up', () => {
    const e = h(doc(), 0);
    e.keys('<c-d>');
    expect(e.row).toBe(12);
    e.keys('<c-d>');
    expect(e.row).toBe(24);
    e.keys('<c-u>');
    expect(e.row).toBe(12);
  });

  it('scrolling clamps at the ends', () => {
    const e = h(doc(), 0);
    e.keys('<c-u>');
    expect(e.row).toBe(0);
    e.keys('<c-d><c-d><c-d>');
    expect(e.row).toBe(29);
  });
});

describe('panes (Ctrl-W chord, Ctrl-H/Ctrl-L direct)', () => {
  it('C-w then h/l/w emits focusPane', () => {
    const e = h('x');
    e.keys('<c-w>h');
    expect(e.paneMoves).toEqual([-1]);
    e.keys('<c-w>l');
    expect(e.paneMoves).toEqual([-1, 1]);
    e.keys('<c-w>w');
    expect(e.paneMoves).toEqual([-1, 1, 1]);
  });

  it('C-h / C-l switch panes directly (desktop app never delivers C-w)', () => {
    const e = h('x');
    e.keys('<c-h><c-l><c-l>');
    expect(e.paneMoves).toEqual([-1, 1, 1]);
    expect(e.mode).toBe('normal');
  });
});

describe('jumplist (Ctrl-O / Ctrl-I)', () => {
  const doc = () => ['a', 'b', 'c', 'd', 'e'];

  it('Ctrl-O returns to where a gg/ge jump left from, Ctrl-I re-jumps', () => {
    const e = h(doc(), 2);
    e.keys('ge'); // jump to doc end; records row 2
    expect(e.row).toBe(4);
    e.keys('<c-o>');
    expect(e.row).toBe(2);
    e.keys('<c-i>');
    expect(e.row).toBe(4);
  });

  it('chained jumps walk back in order', () => {
    const e = h(doc(), 1);
    e.keys('ge'); // 1 → 4, jumps: [1]
    e.keys('gg'); // 4 → 0, jumps: [1, 4]
    expect(e.row).toBe(0);
    e.keys('<c-o>');
    expect(e.row).toBe(4);
    e.keys('<c-o>');
    expect(e.row).toBe(1);
    e.keys('<c-o>'); // list exhausted: stays
    expect(e.row).toBe(1);
    e.keys('<c-i>');
    expect(e.row).toBe(4);
    e.keys('<c-i>');
    expect(e.row).toBe(0);
    e.keys('<c-i>'); // at the newest entry: stays
    expect(e.row).toBe(0);
  });

  it('a new jump truncates the forward list (vim semantics)', () => {
    const e = h(doc(), 1);
    e.keys('ge'); // jumps: [1]
    e.keys('<c-o>'); // back at 1
    expect(e.row).toBe(1);
    e.keys('ge'); // new jump from 1 truncates the stashed forward entry
    e.keys('<c-o>');
    expect(e.row).toBe(1);
  });
});

describe('yank/delete → system clipboard', () => {
  it('yw copies the yanked text', () => {
    const e = h('hello world');
    e.keys('yw');
    expect(e.clipboard).toBe('hello ');
    expect(e.line).toBe('hello world'); // yank does not edit
  });

  it('x and dw copy the deleted text (clipboard=unnamed)', () => {
    const e = h('abc');
    e.keys('x');
    expect(e.clipboard).toBe('a');
    const e2 = h('hello world');
    e2.keys('dw');
    expect(e2.clipboard).toBe('hello ');
  });

  it('r and ~ do NOT touch the clipboard', () => {
    const e = h('abc');
    e.keys('yl'); // clipboard: "a"
    e.keys('rz`');
    expect(e.clipboard).toBe('a');
  });

  it('yy and visual-line yanks copy whole bullets', () => {
    const e = h(['one', 'two', 'three'], 0);
    e.keys('yy');
    expect(e.clipboard).toBe('one');
    e.keys('vjy'); // visual-line yank of two bullets
    expect(e.clipboard).toBe('one\ntwo');
  });

  it('charwise visual y copies the selection', () => {
    const e = h('hello world', 0, 6);
    e.keys('vey');
    expect(e.clipboard).toBe('world');
  });
});

describe('command line over a visual selection', () => {
  it('; from visual-line keeps the selection through command mode', () => {
    const e = h(['one', 'two', 'three'], 0);
    e.keys('vj'); // line-select rows 0-1
    expect(e.vSelRows).toEqual([0, 1]);
    e.keys(';');
    expect(e.mode).toBe('command');
    expect(e.vSelRows).toEqual([0, 1]); // selection survives into command mode
    e.keys('noop<cr>');
    expect(e.lastEx).toBe('noop');
    expect(e.mode).toBe('normal');
    expect(e.vSelRows).toBeNull(); // and is cleared afterwards
  });

  it('/ from visual-line does NOT open the command line (slash menu owns it)', () => {
    const e = h(['one', 'two'], 0);
    e.keys('vj/');
    expect(e.mode).toBe('visual-line');
    e.keys('<esc>');
    expect(e.mode).toBe('normal');
    expect(e.vSelRows).toBeNull();
  });

  it('documents are untouched by a selection command round-trip', () => {
    const e = h(['one', 'two', 'three'], 0);
    e.keys('vj;noop<cr>');
    expect(e.lines).toEqual(['one', 'two', 'three']);
    expect(e.lastEx).toBe('noop');
  });
});

describe('command-line mode (Ex)', () => {
  it(': enters command mode and types into the buffer', () => {
    const e = h('abc');
    e.keys(':');
    expect(e.mode).toBe('command');
    e.keys('wq');
    expect(e.commandLine).toBe('wq');
  });

  it('Enter runs the command and returns to normal', () => {
    const e = h('abc');
    e.keys(':wq<cr>');
    expect(e.lastEx).toBe('wq');
    expect(e.mode).toBe('normal');
    expect(e.commandLine).toBe('');
  });

  it('a command with arguments is captured whole', () => {
    const e = h('abc');
    e.keys(':e my note<cr>');
    expect(e.lastEx).toBe('e my note');
  });

  it(':help reaches the adapter as an Ex command', () => {
    const e = h('abc');
    e.keys(';help<cr>');
    expect(e.lastEx).toBe('help');
    expect(e.mode).toBe('normal');
  });

  it('Escape cancels command mode without running', () => {
    const e = h('abc');
    e.keys(':wq<esc>');
    expect(e.lastEx).toBeNull();
    expect(e.mode).toBe('normal');
    expect(e.commandLine).toBe('');
  });

  it('backspace edits the buffer, and past the colon exits', () => {
    const e = h('abc');
    e.keys(':wq<bs>');
    expect(e.commandLine).toBe('w');
    e.keys('<bs><bs>');
    expect(e.mode).toBe('normal');
  });

  it('an empty command line just returns to normal', () => {
    const e = h('abc');
    e.keys(':<cr>');
    expect(e.lastEx).toBeNull();
    expect(e.mode).toBe('normal');
  });

  it('normal-mode editing is unaffected by command keys after exit', () => {
    const e = h('hello');
    e.keys(':w<cr>');
    e.keys('x');
    expect(e.line).toBe('ello');
  });
});

describe('visual-line across hierarchy (nested trees)', () => {
  // Replicates the reported bug document:
  //   asdf                    row 0, depth 0
  //   Empty Bullet            row 1, depth 0
  //     asdf-child            row 2, depth 1
  //     E:asdf                row 3, depth 1
  //       g1                  row 4, depth 2   ← anchor in the bug report
  //       g2                  row 5, depth 2
  //   tail                    row 6, depth 0
  const tree = () =>
    new Harness(
      ['asdf', 'Empty Bullet', 'asdf-child', 'E:asdf', 'g1', 'g2', 'tail'],
      4, 0,
      [0, 0, 1, 1, 2, 2, 0]
    );

  it('THE BUG: selecting up from a grandchild crosses into the parent', () => {
    const e = tree();
    e.keys('vk'); // anchor g1, extend up onto E:asdf (the parent!)
    expect(e.vSelRows).toEqual([3, 4]);
    e.keys('k'); // further up onto asdf-child
    expect(e.vSelRows).toEqual([2, 4]);
    e.keys('k'); // onto Empty Bullet (grandparent)
    expect(e.vSelRows).toEqual([1, 4]);
  });

  it('cutting a selection that spans parent+uncle removes both subtrees', () => {
    const e = tree();
    e.keys('vkkkd'); // g1 → E:asdf → asdf-child → Empty Bullet, cut
    // Empty Bullet subtree covers everything walked; normalized = [Empty Bullet]
    expect(e.lines).toEqual(['asdf', 'tail']);
    expect(e.mode).toBe('normal');
  });

  it('selecting a parent row covers its subtree (normalization)', () => {
    const e = new Harness(['p', 'c1', 'c2', 'next'], 0, 0, [0, 1, 1, 0]);
    e.keys('vjd'); // anchor p, walk into c1: selection is still just p's subtree
    expect(e.lines).toEqual(['next']);
  });

  it('walking down through children into an uncle selects child+child+uncle', () => {
    const e = new Harness(['p', 'c1', 'c2', 'uncle', 'tail'], 1, 0, [0, 1, 1, 0, 0]);
    e.keys('vjjd'); // c1 → c2 → uncle
    expect(e.lines).toEqual(['p', 'tail']);
    expect(e.lineRegister).toEqual(['c1', 'c2', 'uncle']);
  });

  it('shrinking back across a parent boundary works (j then k)', () => {
    const e = tree();
    e.keys('vkj'); // up onto parent, back down to g1
    expect(e.vSelRows).toEqual([4, 4]);
    e.keys('<esc>');
    expect(e.lines.length).toBe(7);
  });

  it('indenting a cross-depth selection indents each unit', () => {
    const e = new Harness(['a', 'b', 'c'], 1, 0, [0, 0, 0]);
    e.keys('vj.'); // select b,c then indent
    expect(e.indents).toEqual([0, 1, 1]);
  });

  it('escape restores normal mode and drops highlight at any depth', () => {
    const e = tree();
    e.keys('vkk<esc>');
    expect(e.mode).toBe('normal');
    expect(e.vSelRows).toBeNull();
    expect(e.lines.length).toBe(7);
  });

  it('yank across hierarchy leaves the doc untouched', () => {
    const e = tree();
    e.keys('vky');
    expect(e.lines.length).toBe(7);
    expect(e.mode).toBe('normal');
    // E:asdf subtree (E:asdf, g1, g2) — normalized to the parent unit
    expect(e.lineRegister).toEqual(['E:asdf', 'g1', 'g2']);
  });

  it('selection clamps at document top', () => {
    const e = new Harness(['a', 'b'], 0, 0, [0, 0]);
    e.keys('vkkkk');
    expect(e.vSelRows).toEqual([0, 0]);
    e.keys('d');
    expect(e.lines).toEqual(['b']);
  });

  it('G in v-line extends to the end of the document', () => {
    const e = new Harness(['a', 'b', 'c', 'd'], 1, 0, [0, 0, 0, 0]);
    e.keys('vGd');
    expect(e.lines).toEqual(['a']);
  });
});

describe('text objects (pairs and quotes)', () => {
  it('di[ deletes inside brackets, da[ includes them', () => {
    const e = h('foo [bar baz] x', 0, 6);
    e.keys('di[');
    expect(e.line).toBe('foo [] x');
    const e2 = h('foo [bar baz] x', 0, 6);
    e2.keys('da[');
    expect(e2.line).toBe('foo  x');
  });

  it('dib targets parens (vim b block synonym)', () => {
    const e = h('f(a+b)*2', 0, 3);
    e.keys('dib');
    expect(e.line).toBe('f()*2');
  });

  it('nested pairs pick the innermost', () => {
    const e = h('a(b(c)d)e', 0, 4);
    e.keys('dib');
    expect(e.line).toBe('a(b()d)e');
  });

  it('pair object with the caret outside any pair is a no-op', () => {
    const e = h('a(b)c', 0, 0);
    e.keys('dib');
    expect(e.line).toBe('a(b)c');
  });

  it("di' deletes inside quotes; da' swallows trailing space", () => {
    const e = h("say 'hi ho' now", 0, 6);
    e.keys("di'");
    expect(e.line).toBe("say '' now");
    const e2 = h("say 'hi ho' now", 0, 6);
    e2.keys("da'");
    expect(e2.line).toBe('say now');
  });

  it("ci' before the quotes targets the NEXT quoted string (vim rule)", () => {
    const e = h("cmd 'arg' end", 0, 0);
    e.keys("ci'");
    expect(e.line).toBe("cmd '' end");
    expect(e.mode).toBe('insert');
  });

  it('di` handles backticks', () => {
    const e = h('run `ls -la` now', 0, 6);
    e.keys('di`');
    expect(e.line).toBe('run `` now');
  });

  it('vi[ reshapes a charwise selection to the bracket innards', () => {
    const e = h('foo [bar baz] x', 0, 6);
    e.keys('vi[d');
    expect(e.line).toBe('foo [] x');
  });

  it("va' selects around the quotes", () => {
    const e = h("say 'hi' now", 0, 5);
    e.keys("va'y");
    expect(e.clipboard).toBe("'hi' ");
  });
});

describe('marks', () => {
  it("m<c> sets a mark, '<c> jumps to it", () => {
    const e = h(['a', 'b', 'c'], 0, 0);
    e.keys('ma');
    expect(e.marks['a']).toBe(0);
    e.keys('jj');
    expect(e.row).toBe(2);
    e.keys("'a");
    expect(e.row).toBe(0);
  });

  it("'' returns to the position before the last jump", () => {
    const e = h(['a', 'b', 'c', 'd'], 3, 0);
    e.keys('gg'); // jump: records row 3 as '
    expect(e.row).toBe(0);
    e.keys("''");
    expect(e.row).toBe(3);
    e.keys("''"); // toggles back
    expect(e.row).toBe(0);
  });

  it('jump to an unset mark is a no-op', () => {
    const e = h(['a', 'b'], 1, 0);
    e.keys("'z");
    expect(e.row).toBe(1);
  });
});

describe('gj (join bullets)', () => {
  it('gj joins the next sibling with a space', () => {
    const e = h(['foo', 'bar', 'rest'], 0, 0);
    e.keys('gj');
    expect(e.lines).toEqual(['foo bar', 'rest']);
  });

  it('3gj joins three bullets into one', () => {
    const e = h(['a', 'b', 'c', 'd'], 0, 0);
    e.keys('3gj');
    expect(e.lines).toEqual(['a b c', 'd']);
  });

  it('gj skips over the current subtree to the next SIBLING', () => {
    const e = new Harness(['p', 'kid', 'q'], 0, 0, [0, 1, 0]);
    e.keys('gj');
    expect(e.lines).toEqual(['p q', 'kid']);
    expect(e.indents).toEqual([0, 1]);
  });

  it('gj with no following sibling is a no-op', () => {
    const e = new Harness(['x', 'top'], 0, 0, [1, 0]);
    e.keys('gj');
    expect(e.lines).toEqual(['x', 'top']);
  });

  it('gj is undoable', () => {
    const e = h(['foo', 'bar'], 0, 0);
    e.keys('gj');
    expect(e.lines).toEqual(['foo bar']);
    e.keys('u');
    expect(e.lines).toEqual(['foo', 'bar']);
  });
});

describe('ga (append at end of line)', () => {
  it('ga enters insert with the caret at the line end', () => {
    const e = h('hello', 0, 1);
    e.keys('ga!');
    expect(e.line).toBe('hello!');
    expect(e.mode).toBe('insert');
  });
});

describe('Ctrl-A / Ctrl-X (number increment)', () => {
  it('increments the number under the cursor', () => {
    const e = h('a 41 b', 0, 2);
    e.keys('<c-a>');
    expect(e.line).toBe('a 42 b');
  });

  it('decrements with Ctrl-X', () => {
    const e = h('a 41 b', 0, 3);
    e.keys('<c-x>');
    expect(e.line).toBe('a 40 b');
  });

  it('finds the next number after the cursor', () => {
    const e = h('x 9', 0, 0);
    e.keys('<c-a>');
    expect(e.line).toBe('x 10');
    // caret on the last digit of the result
    expect(e.caret).toBe(3);
  });

  it('applies counts', () => {
    const e = h('n 10', 0, 2);
    e.keys('5<c-a>');
    expect(e.line).toBe('n 15');
  });

  it('handles negative numbers', () => {
    const e = h('t -3', 0, 2);
    e.keys('<c-a>');
    expect(e.line).toBe('t -2');
    e.keys('<c-x><c-x>');
    expect(e.line).toBe('t -4');
  });

  it('a dash inside a word is a separator, not a sign', () => {
    const e = h('a-5', 0, 0);
    e.keys('<c-a>');
    expect(e.line).toBe('a-6');
  });

  it('no number on the line is a no-op', () => {
    const e = h('plain text', 0, 0);
    e.keys('<c-a>');
    expect(e.line).toBe('plain text');
  });
});

describe('dot-repeat', () => {
  it('. repeats dw', () => {
    const e = h('one two three', 0, 0);
    e.keys('dw');
    expect(e.line).toBe('two three');
    e.keys('.');
    expect(e.line).toBe('three');
  });

  it('. repeats a counted delete (3x)', () => {
    const e = h('abcdefgh', 0, 0);
    e.keys('3x');
    expect(e.line).toBe('defgh');
    e.keys('.');
    expect(e.line).toBe('gh');
  });

  it('. repeats r at a new position', () => {
    const e = h('abc', 0, 0);
    e.keys('rz');
    expect(e.line).toBe('zbc');
    e.keys('l.');
    expect(e.line).toBe('zzc');
  });

  it('. repeats dd', () => {
    const e = h(['a', 'b', 'c'], 0, 0);
    e.keys('dd');
    expect(e.lines).toEqual(['b', 'c']);
    e.keys('.');
    expect(e.lines).toEqual(['c']);
  });

  it('motions in between do not clobber the last change', () => {
    const e = h('one two three four', 0, 0);
    e.keys('dw');
    e.keys('wl0'); // pure motions
    e.keys('.');
    expect(e.line).toBe('three four');
  });

  it('insert-entering changes (cw) are NOT recorded', () => {
    const e = h('one two', 0, 0);
    e.keys('dw'); // recorded
    e.keys('cx<esc>'); // cw-family: enters insert, must not be recorded
    const before = e.line;
    e.keys('.');
    // '.' replays dw (the last recorded change), not the c-change
    expect(e.line).toBe(before.split(' ').slice(1).join(' ') || '');
  });

  it('. repeats Ctrl-A', () => {
    const e = h('v 5 9', 0, 2);
    e.keys('<c-a>');
    expect(e.line).toBe('v 6 9');
    e.keys('w.');
    expect(e.line).toBe('v 6 10');
  });

  it('. before any change is a no-op', () => {
    const e = h('abc', 0, 0);
    e.keys('.');
    expect(e.line).toBe('abc');
  });

  it('. repeats gj', () => {
    const e = h(['a', 'b', 'c'], 0, 0);
    e.keys('gj');
    expect(e.lines).toEqual(['a b', 'c']);
    e.keys('.');
    expect(e.lines).toEqual(['a b c']);
  });
});
