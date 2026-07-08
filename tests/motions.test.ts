import { describe, expect, it } from 'vitest';
import {
  ATOMIC_CH,
  charClass,
  cpBack,
  cpForward,
  cpStart,
  cpWidthAt,
  findChar,
  firstNonBlank,
  nextWordStart,
  numberAt,
  pairObject,
  prevWordStart,
  quoteObject,
  stopsBetween,
  wordEnd,
  wordObject,
} from '../src/engine/motions';

// Direct tests of the pure text math — the exact offset arithmetic every
// motion, operator and visual selection is built on. Fixture text uses
// I-beam between-char offsets in [0, len].

describe('charClass', () => {
  it('classifies spaces, words and punctuation', () => {
    expect(charClass(' ', false)).toBe(0);
    expect(charClass('\t', false)).toBe(0);
    expect(charClass('a', false)).toBe(1);
    expect(charClass('Z', false)).toBe(1);
    expect(charClass('0', false)).toBe(1);
    expect(charClass('_', false)).toBe(1);
    expect(charClass('-', false)).toBe(2);
    expect(charClass('.', false)).toBe(2);
  });

  it('big words collapse word/punct into one class', () => {
    expect(charClass('-', true)).toBe(1);
    expect(charClass('a', true)).toBe(1);
    expect(charClass(' ', true)).toBe(0);
  });

  it('treats accented letters as word chars', () => {
    expect(charClass('ä', false)).toBe(1);
    expect(charClass('ø', false)).toBe(1);
  });
});

describe('nextWordStart (w)', () => {
  it('moves to the next word across a single space', () => {
    expect(nextWordStart('foo bar', 0, false)).toBe(4);
  });
  it('stops at punctuation as its own word', () => {
    expect(nextWordStart('foo-bar', 0, false)).toBe(3);
    expect(nextWordStart('foo-bar', 3, false)).toBe(4);
  });
  it('big W skips punctuation runs', () => {
    expect(nextWordStart('foo-bar baz', 0, true)).toBe(8);
  });
  it('from whitespace lands on the next word', () => {
    expect(nextWordStart('a   b', 1, false)).toBe(4);
  });
  it('runs to end of line when no further word exists', () => {
    expect(nextWordStart('word', 1, false)).toBe(4);
    expect(nextWordStart('word  ', 1, false)).toBe(6);
  });
  it('at or past the end stays at the end', () => {
    expect(nextWordStart('ab', 2, false)).toBe(2);
    expect(nextWordStart('', 0, false)).toBe(0);
  });
  it('crosses multiple spaces and tabs', () => {
    expect(nextWordStart('a \t  b', 0, false)).toBe(5);
  });
});

describe('prevWordStart (b)', () => {
  it('moves to the start of the previous word', () => {
    expect(prevWordStart('foo bar', 4, false)).toBe(0);
    expect(prevWordStart('foo bar', 7, false)).toBe(4);
  });
  it('from mid-word goes to that word start', () => {
    expect(prevWordStart('foo bar', 6, false)).toBe(4);
  });
  it('punctuation is its own word', () => {
    expect(prevWordStart('foo-bar', 4, false)).toBe(3);
    expect(prevWordStart('foo-bar', 3, false)).toBe(0);
  });
  it('big B treats punct+word as one word', () => {
    expect(prevWordStart('foo-bar baz', 8, true)).toBe(0);
  });
  it('skips trailing whitespace first', () => {
    expect(prevWordStart('foo   ', 6, false)).toBe(0);
  });
  it('at the start stays at 0', () => {
    expect(prevWordStart('abc', 0, false)).toBe(0);
    expect(prevWordStart('', 0, false)).toBe(0);
  });
});

describe('wordEnd (e, I-beam rule)', () => {
  it('moves past the end of the current word', () => {
    expect(wordEnd('hello world', 0, false)).toBe(5);
  });
  it('any forward progress counts (de on "a asdf" deletes just "a")', () => {
    expect(wordEnd('a asdf', 0, false)).toBe(1);
  });
  it('from a word end jumps past the NEXT word', () => {
    expect(wordEnd('hello world', 5, false)).toBe(11);
  });
  it('from whitespace lands past the next word', () => {
    expect(wordEnd('a  bcd', 1, false)).toBe(6);
  });
  it('punctuation runs end separately', () => {
    expect(wordEnd('ab--cd', 0, false)).toBe(2);
    expect(wordEnd('ab--cd', 2, false)).toBe(4);
  });
  it('big E treats punct+word as one run', () => {
    expect(wordEnd('ab--cd efg', 0, true)).toBe(6);
  });
  it('at the very end stays there', () => {
    expect(wordEnd('abc', 3, false)).toBe(3);
  });
  it('trailing whitespace with no further word returns len', () => {
    expect(wordEnd('ab  ', 2, false)).toBe(4);
  });
});

describe('firstNonBlank (^)', () => {
  it('finds the first non-blank', () => {
    expect(firstNonBlank('   abc')).toBe(3);
    expect(firstNonBlank('abc')).toBe(0);
  });
  it('all-blank and empty lines give 0', () => {
    expect(firstNonBlank('    ')).toBe(0);
    expect(firstNonBlank('')).toBe(0);
  });
});

describe('findChar', () => {
  const s = 'hello world';

  it('f returns the offset after the found char (inclusive)', () => {
    expect(findChar(s, 0, 'f', 'o', false)).toEqual({ target: 5, landsOn: true });
  });
  it('f searches strictly after the cursor char', () => {
    // caret 4 = cursor char 'o' — a fresh f skips it, finds the o in world
    expect(findChar(s, 4, 'f', 'o', false)?.target).toBe(8);
  });
  it('f repeat searches from the caret (already past the last hit)', () => {
    expect(findChar(s, 5, 'f', 'o', true)?.target).toBe(8);
  });
  it('f fails when the char does not occur', () => {
    expect(findChar(s, 0, 'f', 'z', false)).toBeNull();
  });
  it('t stops just before the char', () => {
    expect(findChar(s, 0, 't', 'o', false)).toEqual({ target: 4, landsOn: false });
  });
  it('t repeat skips the char it is already touching', () => {
    // caret 4 = just before the o at 4; repeat must reach the o in world
    expect(findChar(s, 4, 't', 'o', true)?.target).toBe(7);
  });
  it('F finds a match immediately left of the cursor char (regression)', () => {
    // caret 2 on "abc" = cursor char 'c'; Fb must land on the adjacent b.
    expect(findChar('abc', 2, 'F', 'b', false)?.target).toBe(1);
  });
  it('F lands ON the found char', () => {
    expect(findChar(s, 9, 'F', 'o', false)?.target).toBe(7);
  });
  it('F repeat skips the char the caret is touching (after an f landing)', () => {
    // after fo the caret is at 5, touching the o at 4 — repeat finds nothing earlier? no: only one o before → fails
    expect(findChar('xoxo', 4, 'F', 'o', true)?.target).toBe(1);
  });
  it('F fails when nothing is left of the cursor', () => {
    expect(findChar('abc', 0, 'F', 'a', false)).toBeNull();
  });
  it('T lands just after the found char', () => {
    expect(findChar(s, 9, 'T', 'o', false)?.target).toBe(8);
  });
  it('T on an adjacent match reports the current position (no move)', () => {
    // caret 2 on "abc"... use "xbc": caret 2, Tx → after x at 0 → 1
    expect(findChar('xbc', 2, 'T', 'x', false)?.target).toBe(1);
    // adjacent: caret 2 on "axc", Tx → target 2 = no move, but not null
    expect(findChar('axc', 2, 'T', 'x', false)?.target).toBe(2);
  });
  it('T repeat skips the adjacent match and finds an earlier one', () => {
    expect(findChar('xaxb', 3, 'T', 'x', true)?.target).toBe(1);
  });
});

describe('pairObject', () => {
  it('inner and around ranges of a simple pair', () => {
    // "a(bc)d" — caret on b
    expect(pairObject('a(bc)d', 2, '(', ')', false)).toEqual({ start: 2, end: 4 });
    expect(pairObject('a(bc)d', 2, '(', ')', true)).toEqual({ start: 1, end: 5 });
  });
  it('caret on the delimiters counts as inside', () => {
    expect(pairObject('a(bc)d', 1, '(', ')', false)).toEqual({ start: 2, end: 4 });
    expect(pairObject('a(bc)d', 4, '(', ')', false)).toEqual({ start: 2, end: 4 });
  });
  it('nesting picks the innermost pair containing the caret', () => {
    expect(pairObject('(a(b)c)', 3, '(', ')', false)).toEqual({ start: 3, end: 4 });
    expect(pairObject('(a(b)c)', 5, '(', ')', false)).toEqual({ start: 1, end: 6 });
  });
  it('caret outside any pair fails', () => {
    expect(pairObject('a(b)c', 0, '(', ')', false)).toBeNull();
    expect(pairObject('a(b)c', 4, '(', ')', false)).toBeNull();
  });
  it('unbalanced delimiters fail gracefully', () => {
    expect(pairObject('a(bc', 2, '(', ')', false)).toBeNull();
    expect(pairObject('ab)c', 1, '(', ')', false)).toBeNull();
  });
  it('empty pair: inner is empty, around covers both chars', () => {
    expect(pairObject('a()b', 1, '(', ')', false)).toEqual({ start: 2, end: 2 });
    expect(pairObject('a()b', 1, '(', ')', true)).toEqual({ start: 1, end: 3 });
  });
  it('brackets work like parens', () => {
    expect(pairObject('x[ab]y', 2, '[', ']', false)).toEqual({ start: 2, end: 4 });
  });
});

describe('quoteObject', () => {
  it('inner and around ranges', () => {
    expect(quoteObject("a'bc'd", 2, "'", false)).toEqual({ start: 2, end: 4 });
    expect(quoteObject("a'bc'd", 2, "'", true)).toEqual({ start: 1, end: 5 });
  });
  it('around swallows trailing whitespace after the closing quote', () => {
    expect(quoteObject("'ab'  c", 1, "'", true)).toEqual({ start: 0, end: 6 });
  });
  it('around takes leading whitespace when there is no trailing', () => {
    expect(quoteObject("x  'ab'", 4, "'", true)).toEqual({ start: 1, end: 7 });
  });
  it('quotes pair up from the line start (vim rule)', () => {
    // "a'b'c'd'" — pairs are (1,3) and (5,7); caret on c (4) → NEXT pair
    expect(quoteObject("a'b'c'd'", 4, "'", false)).toEqual({ start: 6, end: 7 });
  });
  it('caret before any quote uses the next pair', () => {
    expect(quoteObject("ab 'cd'", 0, "'", false)).toEqual({ start: 4, end: 6 });
  });
  it('escaped quotes do not close', () => {
    expect(quoteObject("'a\\'b'", 2, "'", false)).toEqual({ start: 1, end: 5 });
  });
  it('a lone quote fails', () => {
    expect(quoteObject("ab'cd", 1, "'", false)).toBeNull();
  });
  it('backticks work', () => {
    expect(quoteObject('a`bc`d', 3, '`', false)).toEqual({ start: 2, end: 4 });
  });
});

describe('wordObject (iw/aw)', () => {
  it('inner word from mid-word', () => {
    expect(wordObject('foo bar baz', 5, false, false)).toEqual({ start: 4, end: 7 });
  });
  it('around word swallows trailing whitespace', () => {
    expect(wordObject('foo bar baz', 5, true, false)).toEqual({ start: 4, end: 8 });
  });
  it('around word takes leading whitespace when at line end', () => {
    expect(wordObject('foo bar', 5, true, false)).toEqual({ start: 3, end: 7 });
  });
  it('on whitespace the object is the space run', () => {
    expect(wordObject('a   b', 2, false, false)).toEqual({ start: 1, end: 4 });
  });
  it('punctuation is its own inner word', () => {
    expect(wordObject('a--b', 1, false, false)).toEqual({ start: 1, end: 3 });
  });
  it('big word object includes punctuation', () => {
    expect(wordObject('a-b c', 1, false, true)).toEqual({ start: 0, end: 3 });
  });
  it('caret past the last char clamps onto it', () => {
    expect(wordObject('abc', 3, false, false)).toEqual({ start: 0, end: 3 });
  });
  it('empty line fails', () => {
    expect(wordObject('', 0, false, false)).toBeNull();
  });
});

describe('numberAt (C-a/C-x)', () => {
  it('number under the cursor', () => {
    expect(numberAt('ab 42 cd', 3)).toEqual({ start: 3, end: 5, value: 42 });
    expect(numberAt('ab 42 cd', 4)).toEqual({ start: 3, end: 5, value: 42 });
  });
  it('next number after the cursor', () => {
    expect(numberAt('ab 42 cd', 0)).toEqual({ start: 3, end: 5, value: 42 });
  });
  it('no number fails', () => {
    expect(numberAt('hello', 0)).toBeNull();
  });
  it('cursor past the last number fails', () => {
    expect(numberAt('42 ab', 3)).toBeNull();
  });
  it('leading minus is part of the number', () => {
    expect(numberAt('x -7', 2)).toEqual({ start: 2, end: 4, value: -7 });
  });
  it('a dash inside a word is a separator', () => {
    expect(numberAt('a-5', 0)).toEqual({ start: 2, end: 3, value: 5 });
  });
  it('a dash after a digit is a separator (5-3 is not 5 and -3)', () => {
    expect(numberAt('5-3', 1)).toEqual({ start: 2, end: 3, value: 3 });
  });
  it('multi-digit numbers', () => {
    expect(numberAt('v1234x', 2)).toEqual({ start: 1, end: 5, value: 1234 });
  });
});

describe('code points (surrogate pairs and atomic placeholders)', () => {
  const s = 'a😀b'; // a=0, 😀=1..3, b=3, len 4

  it('cpWidthAt: 2 at an astral char, 1 elsewhere', () => {
    expect(cpWidthAt(s, 0)).toBe(1);
    expect(cpWidthAt(s, 1)).toBe(2);
    expect(cpWidthAt(s, 3)).toBe(1);
  });
  it('cpWidthAt: a lone surrogate half is width 1 (defensive)', () => {
    expect(cpWidthAt('\ud83d', 0)).toBe(1);
  });
  it('cpStart snaps a mid-pair offset to the pair start', () => {
    expect(cpStart(s, 2)).toBe(1);
    expect(cpStart(s, 1)).toBe(1);
    expect(cpStart(s, 3)).toBe(3);
    expect(cpStart(s, 0)).toBe(0);
  });
  it('cpForward steps whole code points and clamps', () => {
    expect(cpForward(s, 0, 1)).toBe(1);
    expect(cpForward(s, 1, 1)).toBe(3);
    expect(cpForward(s, 0, 2)).toBe(3);
    expect(cpForward(s, 0, 99)).toBe(4);
  });
  it('cpBack steps whole code points and clamps', () => {
    expect(cpBack(s, 4, 1)).toBe(3);
    expect(cpBack(s, 3, 1)).toBe(1);
    expect(cpBack(s, 1, 1)).toBe(0);
    expect(cpBack(s, 4, 99)).toBe(0);
  });
  it('stopsBetween counts code points, signed', () => {
    expect(stopsBetween(s, 0, 4)).toBe(3);
    expect(stopsBetween(s, 4, 0)).toBe(-3);
    expect(stopsBetween(s, 1, 3)).toBe(1);
    expect(stopsBetween(s, 2, 2)).toBe(0);
  });
  it('ATOMIC_CH is one astral code point (2 units, 1 stop)', () => {
    expect(ATOMIC_CH.length).toBe(2);
    expect([...ATOMIC_CH].length).toBe(1);
    expect(stopsBetween(`x${ATOMIC_CH}y`, 0, 4)).toBe(3);
  });
  it('plain ASCII: units equal stops', () => {
    expect(stopsBetween('hello', 0, 5)).toBe(5);
    expect(cpForward('hello', 2, 2)).toBe(4);
    expect(cpBack('hello', 2, 2)).toBe(0);
  });
});
