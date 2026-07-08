/**
 * Pure text math for vim motions over a single line.
 *
 * Caret model: between-characters offsets in [0, len]. The "character
 * under the cursor" at caret c is text[c]. Motion results are targets
 * usable directly as operator range ends: inclusive motions (e, f)
 * already return the offset *after* the swallowed character.
 */

export type CharClass = 0 | 1 | 2; // 0 = space, 1 = word, 2 = punct

export function charClass(ch: string, big: boolean): CharClass {
  if (/\s/.test(ch)) return 0;
  if (big) return 1;
  return /[A-Za-z0-9_À-ɏ]/.test(ch) ? 1 : 2;
}

export interface MotionResult {
  target: number;
  /**
   * True when the motion conceptually lands ON a character (e, f, $):
   * in visual mode the head becomes target-1 so the selection matches vim.
   */
  landsOn: boolean;
}

const isSpace = (ch: string) => /\s/.test(ch);

/** `w` / `W`: start of next word. */
export function nextWordStart(s: string, c: number, big: boolean): number {
  const n = s.length;
  let i = c;
  if (i >= n) return n;
  const cls = charClass(s[i], big);
  if (cls !== 0) {
    while (i < n && charClass(s[i], big) === cls) i++;
  }
  while (i < n && isSpace(s[i])) i++;
  return i;
}

/** `b` / `B`: start of previous word. */
export function prevWordStart(s: string, c: number, big: boolean): number {
  let i = c;
  while (i > 0 && isSpace(s[i - 1])) i--;
  if (i === 0) return 0;
  const cls = charClass(s[i - 1], big);
  while (i > 0 && !isSpace(s[i - 1]) && charClass(s[i - 1], big) === cls) i--;
  return i;
}

/**
 * `e` / `E`: offset just past the end of the current-or-next word.
 *
 * Caret-model note: vim's rule is "e must land on a LATER char", which for a
 * block cursor means advancing by 2+ (cursor already ON the word's last
 * char). This engine models an I-beam caret BETWEEN characters, so any
 * forward progress is a real move: `e` with the caret before the last char
 * of a word stops after that word (and `de` on "a asdf" deletes just "a",
 * not everything through "asdf").
 */
export function wordEnd(s: string, c: number, big: boolean): number {
  const n = s.length;
  let i = c;
  if (i >= n) return n;
  if (!isSpace(s[i])) {
    const e = endOfRun(s, i, big);
    if (e > c) return e;
    i = e;
  }
  while (i < n && isSpace(s[i])) i++;
  if (i >= n) return n;
  return endOfRun(s, i, big);
}

function endOfRun(s: string, i: number, big: boolean): number {
  const n = s.length;
  const cls = charClass(s[i], big);
  let j = i;
  while (j < n && !isSpace(s[j]) && charClass(s[j], big) === cls) j++;
  return j;
}

function startOfRun(s: string, i: number, big: boolean): number {
  const cls = charClass(s[i], big);
  let j = i;
  while (j > 0 && !isSpace(s[j - 1]) && charClass(s[j - 1], big) === cls) j--;
  return j;
}

/** `^`: first non-blank character of the line. */
export function firstNonBlank(s: string): number {
  const m = s.match(/\S/);
  return m ? (m.index as number) : 0;
}

/**
 * `f`/`F`/`t`/`T`. Returns null if the character is not found.
 * f returns the offset after the found char (inclusive), t the offset
 * before it, F/T the mirrored backward variants.
 */
export function findChar(
  s: string,
  c: number,
  key: 'f' | 'F' | 't' | 'T',
  ch: string,
  isRepeat: boolean
): MotionResult | null {
  if (key === 'f' || key === 't') {
    let from = isRepeat ? c : c + 1;
    let i = s.indexOf(ch, from);
    if (key === 't' && i >= 0 && i === c) {
      i = s.indexOf(ch, c + 2);
    }
    if (i < 0) return null;
    return key === 'f' ? { target: i + 1, landsOn: true } : { target: i, landsOn: false };
  } else {
    const from = c - 2;
    if (from < 0) return null;
    let i = s.lastIndexOf(ch, from);
    if (i < 0) return null;
    return key === 'F' ? { target: i, landsOn: false } : { target: i + 1, landsOn: false };
  }
}

/**
 * Text object for a bracket pair (`i(`/`a[`/…): the innermost pair that
 * contains the char at c (nesting-aware, single line). Vim fails when the
 * caret is outside any pair — so do we (null). `around` includes the
 * delimiters themselves.
 */
export function pairObject(
  s: string,
  c: number,
  open: string,
  close: string,
  around: boolean
): { start: number; end: number } | null {
  // Parse the whole line once, collecting matched pairs via a stack.
  const stack: number[] = [];
  const pairs: [number, number][] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === open) stack.push(i);
    else if (s[i] === close && stack.length) pairs.push([stack.pop() as number, i]);
  }
  // Innermost pair containing the cursor char = max open among candidates.
  let best: [number, number] | null = null;
  for (const [o, cl] of pairs) {
    if (o <= c && c <= cl && (!best || o > best[0])) best = [o, cl];
  }
  if (!best) return null;
  return around ? { start: best[0], end: best[1] + 1 } : { start: best[0] + 1, end: best[1] };
}

/**
 * Text object for a quoted string (`i'`/`a"`/…). Vim pairs quotes up from
 * the line start (no nesting), uses the pair containing the cursor or else
 * the NEXT pair after it, and `a` also swallows trailing whitespace after
 * the closing quote (or leading whitespace when there is none) — mirrored
 * here. Backslash-escaped quotes don't close.
 */
export function quoteObject(
  s: string,
  c: number,
  q: string,
  around: boolean
): { start: number; end: number } | null {
  const idx: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === q && (i === 0 || s[i - 1] !== '\\')) idx.push(i);
  }
  let best: [number, number] | null = null;
  for (let k = 0; k + 1 < idx.length; k += 2) {
    const [o, cl] = [idx[k], idx[k + 1]];
    if ((o <= c && c <= cl) || o > c) {
      best = [o, cl];
      break; // pairs are in line order; the first containing-or-later wins
    }
  }
  if (!best) return null;
  if (!around) return { start: best[0] + 1, end: best[1] };
  let start = best[0];
  let end = best[1] + 1;
  const e0 = end;
  while (end < s.length && /[ \t]/.test(s[end])) end++;
  if (end === e0) {
    while (start > 0 && /[ \t]/.test(s[start - 1])) start--;
  }
  return { start, end };
}

/**
 * Ctrl-A/Ctrl-X: the number under or after the cursor on this line —
 * vim's rule: the match containing the caret char, else the next one
 * after it. A '-' immediately before the digits is part of the number.
 */
export function numberAt(
  s: string,
  c: number
): { start: number; end: number; value: number } | null {
  const re = /-?\d+/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    let start = m.index;
    const end = start + m[0].length;
    if (end > c) {
      // A '-' that is part of a word (a-5) is a separator, not a sign.
      if (s[start] === '-' && start > 0 && /[\dA-Za-z]/.test(s[start - 1])) start++;
      return { start, end, value: parseInt(s.slice(start, end), 10) };
    }
  }
  return null;
}

/** Text object `iw`/`aw`: the word (or space run) containing the char at c. */
export function wordObject(
  s: string,
  c: number,
  around: boolean,
  big: boolean
): { start: number; end: number } | null {
  const n = s.length;
  if (n === 0) return null;
  const i = Math.min(c, n - 1);
  let start: number;
  let end: number;
  if (isSpace(s[i])) {
    start = i;
    while (start > 0 && isSpace(s[start - 1])) start--;
    end = i;
    while (end < n && isSpace(s[end])) end++;
  } else {
    start = startOfRun(s, i, big);
    end = endOfRun(s, i, big);
    if (around) {
      let e2 = end;
      while (e2 < n && isSpace(s[e2])) e2++;
      if (e2 > end) {
        end = e2;
      } else {
        while (start > 0 && isSpace(s[start - 1])) start--;
      }
    }
  }
  return { start, end };
}
