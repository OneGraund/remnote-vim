import { describe, expect, it } from 'vitest';
import type { RichTextInterface } from '@remnote/plugin-sdk';
import { ATOMIC_CH } from '../src/engine/motions';
import { diffCaret, flattenRich, sanitizeInsert, settleRead } from '../src/adapter/pure';

// The adapter's pure data math: the rich-text → model-space flatten (the
// offset-space contract with RemNote, probed live 2026-07-08), the insert
// sanitizer, insert-exit caret diffing, and the lag-tolerant settle read.

describe('flattenRich (model-space flatten)', () => {
  it('plain string segments pass through', () => {
    expect(flattenRich(['hello'])).toBe('hello');
    expect(flattenRich(['a', 'b'])).toBe('ab');
  });

  it('formatted text runs keep their characters', () => {
    expect(flattenRich([{ i: 'm', text: 'bold', b: true } as never])).toBe('bold');
    expect(
      flattenRich(['see ', { i: 'm', text: 'it', b: true, u: true } as never, ' end'])
    ).toBe('see it end');
  });

  it('a rem reference becomes ONE atomic placeholder (2 units), not its name', () => {
    const rich = ['see ', { i: 'q', _id: 'xyz' } as never, ' end'];
    const flat = flattenRich(rich as RichTextInterface);
    expect(flat).toBe(`see ${ATOMIC_CH} end`);
    // the invariant that matters: length matches RemNote's offset space
    expect(flat.length).toBe(10);
  });

  it('images, LaTeX and unknown elements are atomic too', () => {
    expect(flattenRich([{ i: 'i', url: 'u' } as never])).toBe(ATOMIC_CH);
    expect(flattenRich([{ i: 'x', text: 'x^2' } as never])).toBe(ATOMIC_CH);
    expect(flattenRich([{ i: 'a', url: 'u' } as never])).toBe(ATOMIC_CH);
    expect(flattenRich([{ i: 'g', _id: null } as never])).toBe(ATOMIC_CH);
  });

  it('LaTeX source length does NOT leak into the flatten', () => {
    const flat = flattenRich(['a', { i: 'x', text: '\\frac{a}{b}+c' } as never, 'b']);
    expect(flat.length).toBe(4); // 1 + 2 + 1, matching richText.length live
  });

  it('emoji inside text keep their two UTF-16 units', () => {
    expect(flattenRich(['a😀b']).length).toBe(4);
  });

  it('mixed line: every element in order', () => {
    const flat = flattenRich([
      'x ',
      { i: 'm', text: 'bold' } as never,
      { i: 'q', _id: 'id1' } as never,
      ' y',
    ]);
    expect(flat).toBe(`x bold${ATOMIC_CH} y`);
  });

  it('a text element without text flattens to nothing', () => {
    expect(flattenRich([{ i: 'm' } as never])).toBe('');
  });

  it('empty, null and undefined flatten to the empty string', () => {
    expect(flattenRich([])).toBe('');
    expect(flattenRich(undefined)).toBe('');
    expect(flattenRich(null)).toBe('');
  });
});

describe('sanitizeInsert', () => {
  it('passes plain text through', () => {
    expect(sanitizeInsert('hello')).toBe('hello');
    expect(sanitizeInsert('')).toBe('');
  });

  it('strips atomic placeholders', () => {
    expect(sanitizeInsert(`a${ATOMIC_CH}b`)).toBe('ab');
    expect(sanitizeInsert(`${ATOMIC_CH}${ATOMIC_CH}`)).toBe('');
  });

  it('keeps real emoji (only the placeholder is special)', () => {
    expect(sanitizeInsert('a😀b')).toBe('a😀b');
  });
});

describe('diffCaret (insert-exit caret inference)', () => {
  it('unchanged text keeps the fallback, clamped', () => {
    expect(diffCaret('abc', 'abc', 2)).toBe(2);
    expect(diffCaret('abc', 'abc', 99)).toBe(3);
    expect(diffCaret('abc', 'abc', -1)).toBe(0);
  });

  it('append at the end puts the caret after the appended text', () => {
    expect(diffCaret('abc', 'abcXY', 0)).toBe(5);
  });

  it('insert in the middle puts the caret after the insertion', () => {
    expect(diffCaret('abcd', 'abXYcd', 0)).toBe(4);
  });

  it('insert at the start', () => {
    expect(diffCaret('abc', 'Xabc', 0)).toBe(1);
  });

  it('deletion at the end lands at the new end', () => {
    expect(diffCaret('abcdef', 'abc', 0)).toBe(3);
  });

  it('deletion in the middle lands at the deletion point', () => {
    expect(diffCaret('abcdef', 'abef', 0)).toBe(2);
  });

  it('replacement lands after the replaced region', () => {
    expect(diffCaret('abcdef', 'abXYef', 0)).toBe(4);
  });

  it('everything replaced lands at the end of the new text', () => {
    expect(diffCaret('abc', 'xyz', 0)).toBe(3);
  });

  it('empty to text and text to empty', () => {
    expect(diffCaret('', 'hello', 0)).toBe(5);
    expect(diffCaret('hello', '', 3)).toBe(0);
  });

  it('ambiguous repeated chars still land inside bounds', () => {
    const caret = diffCaret('aa', 'aaa', 1);
    expect(caret).toBeGreaterThanOrEqual(0);
    expect(caret).toBeLessThanOrEqual(3);
  });
});

describe('settleRead (lag-tolerant reads)', () => {
  const eq = (a: string | null, b: string | null) => a === b;
  const noSleep = () => Promise.resolve();

  it('returns immediately once two consecutive reads agree', async () => {
    let calls = 0;
    const read = async () => {
      calls++;
      return 'stable';
    };
    const out = await settleRead(read, eq, { sleep: noSleep });
    expect(out).toBe('stable');
    expect(calls).toBe(2); // first read + one confirmation
  });

  it('keeps reading while the value is still changing', async () => {
    const values = ['v1', 'v2', 'v3', 'v3', 'v3'];
    let i = 0;
    const read = async () => values[Math.min(i++, values.length - 1)];
    const out = await settleRead(read, eq, { sleep: noSleep });
    expect(out).toBe('v3');
  });

  it('gives up after the configured rounds and returns the latest value', async () => {
    let i = 0;
    const read = async () => `v${i++}`; // never stabilizes
    const out = await settleRead(read, eq, { rounds: 3, sleep: noSleep });
    expect(out).toBe('v3'); // 1 initial + 3 rounds
  });

  it('a null (failed) read can settle to null — callers must handle it', async () => {
    const read = async () => null;
    const out = await settleRead<string | null>(read, eq, { sleep: noSleep });
    expect(out).toBeNull();
  });

  it('stale-then-fresh: catches text arriving on the second read', async () => {
    const values = ['hell', 'hello', 'hello'];
    let i = 0;
    const read = async () => values[Math.min(i++, values.length - 1)];
    const out = await settleRead(read, eq, { sleep: noSleep });
    expect(out).toBe('hello');
  });

  it('honors the sleep injection and delay', async () => {
    const delays: number[] = [];
    const read = async () => 'x';
    await settleRead(read, eq, {
      delayMs: 25,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(delays).toEqual([25]);
  });

  it('custom equality: settles on equivalent-but-not-identical values', async () => {
    const values = [{ v: 1 }, { v: 2 }, { v: 2 }];
    let i = 0;
    const read = async () => values[Math.min(i++, values.length - 1)];
    const out = await settleRead(read, (a, b) => a.v === b.v, { sleep: noSleep });
    expect(out.v).toBe(2);
  });
});
