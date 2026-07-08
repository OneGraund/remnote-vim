/**
 * Pure, SDK-free helpers for the adapter — everything here is plain data math
 * so the unit suite can cover it directly (adapter.ts itself can only be
 * exercised live). The RichTextInterface import is type-only (erased at
 * runtime), so this module stays loadable outside the plugin sandbox.
 */
import type { RichTextInterface } from '@remnote/plugin-sdk';
import { ATOMIC_CH } from '../engine/motions';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Flatten RemNote rich text into the MODEL-SPACE string the engine reasons
 * about. The invariant (probed live 2026-07-08 on RemNote 1.26.30): the
 * result's UTF-16 length equals RemNote's own rich-text offset space — the
 * space `editor.selectText` ranges and `getSelection().range` are measured
 * in. Concretely:
 *
 *   - plain string segments and `{i:'m'}` text runs count their UTF-16 units
 *     (an emoji inside text is 2 units in both spaces);
 *   - every OTHER element (rem reference `q`, image `i`, LaTeX `x`, audio,
 *     card delimiter, …) is ATOMIC: RemNote gives it exactly 2 units, so it
 *     becomes the single astral placeholder ATOMIC_CH (2 units, 1 code
 *     point — one caret stop, which is also what `moveCaret` counts).
 *
 * The old approach (`richText.toString`, which expands a reference to its
 * full display name) shifted every offset right of the element by
 * name-length − 2: motions and deletes on formatted lines hit the wrong
 * characters, and the engine believed the line was longer than the editor
 * did. That was the user-visible "cursor thinks it's at EOL / chaos on
 * formatted lines" instability.
 */
export function flattenRich(rich: RichTextInterface | undefined | null): string {
  if (!rich) return '';
  let out = '';
  for (const el of rich) {
    if (typeof el === 'string') out += el;
    else if (el.i === 'm') out += el.text ?? '';
    else out += ATOMIC_CH;
  }
  return out;
}

/**
 * Strip atomic-element placeholders from text about to be INSERTED as plain
 * text (charwise `p`, the copyText reinsert path). A chip can't be recreated
 * from its placeholder — inserting the literal private-use char would put
 * garbage in the document. The whole-line register (dd/yy) keeps full rich
 * text and is unaffected; only charwise registers lose atomic elements,
 * which is documented as a known limitation.
 */
export function sanitizeInsert(text: string): string {
  return text.split(ATOMIC_CH).join('');
}

/**
 * Infer the caret position after `pre` changed into `fresh`: find the common
 * prefix/suffix and put the caret at the end of the changed region (which is
 * where typing/deleting leaves it). If nothing changed, keep `fallback`.
 */
export function diffCaret(pre: string, fresh: string, fallback: number): number {
  if (pre === fresh) return clamp(fallback, 0, fresh.length);
  let p = 0;
  const maxP = Math.min(pre.length, fresh.length);
  while (p < maxP && pre[p] === fresh[p]) p++;
  let s = 0;
  const maxS = Math.min(pre.length - p, fresh.length - p);
  while (s < maxS && pre[pre.length - 1 - s] === fresh[fresh.length - 1 - s]) s++;
  return clamp(fresh.length - s, 0, fresh.length);
}

export interface SettleOpts {
  /** Extra confirmation reads after the first (default 3). */
  rounds?: number;
  /** Pause between reads (default 40 ms). */
  delayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Read a lagging async source until two consecutive reads AGREE (bounded).
 * RemNote's editor read API can return text from a keystroke or two ago
 * right after native typing or an SDK edit — a single read at a mode
 * boundary can capture a truncated line, and every later offset computation
 * inherits the error ("cursor believes it is at the end of the line while
 * characters remain"). Agreement between two reads ~40 ms apart is the
 * cheapest observable signal that the editor has flushed.
 */
export async function settleRead<T>(
  read: () => Promise<T>,
  equals: (a: T, b: T) => boolean,
  opts: SettleOpts = {}
): Promise<T> {
  const {
    rounds = 3,
    delayMs = 40,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = opts;
  let prev = await read();
  for (let i = 0; i < rounds; i++) {
    await sleep(delayMs);
    const next = await read();
    if (equals(prev, next)) return next;
    prev = next;
  }
  return prev;
}
