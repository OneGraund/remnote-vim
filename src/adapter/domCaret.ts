/**
 * Direct DOM caret access — only possible when the plugin runs natively
 * (manifest `requestNative: true`), i.e. in the host page rather than a
 * cross-origin sandbox iframe.
 *
 * RemNote's sandboxed editor API can delete/insert by absolute offsets but
 * cannot move or report the real DOM caret (selectText with a collapsed
 * range, collapseSelection and moveCaret all leave it untouched), so native
 * DOM access is the only way to implement caret motions faithfully.
 */

/** The host document, or null when sandboxed (cross-origin access throws). */
export function hostDocument(): Document | null {
  try {
    const top = window.top;
    if (top && top.document) return top.document;
  } catch {
    /* cross-origin: sandboxed */
  }
  return null;
}

/** The focused RemNote line editor element, if any. */
export function focusedEditorEl(doc: Document): HTMLElement | null {
  const ae = doc.activeElement as HTMLElement | null;
  if (!ae) return null;
  const ed = ae.closest ? (ae.closest('.EditorContainer') as HTMLElement | null) : null;
  if (ed) return ed;
  return ae.isContentEditable ? ae : null;
}

/** Read the caret as a text offset within the focused line, or null. */
export function readDomCaret(doc: Document): number | null {
  const ed = focusedEditorEl(doc);
  if (!ed) return null;
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!ed.contains(r.endContainer)) return null;
  const pre = doc.createRange();
  pre.selectNodeContents(ed);
  pre.setEnd(r.endContainer, r.endOffset);
  return pre.toString().length;
}

/** Place the caret at text offset `at` within the focused line. */
export function setDomCaret(doc: Document, at: number): boolean {
  const ed = focusedEditorEl(doc);
  if (!ed) return false;
  const walker = doc.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  let remaining = at;
  let node: Node | null = null;
  let offset = 0;
  let last: Node | null = null;
  let placed = false;
  while ((node = walker.nextNode())) {
    last = node;
    const len = (node.textContent ?? '').length;
    if (remaining <= len) {
      offset = remaining;
      placed = true;
      break;
    }
    remaining -= len;
  }
  const sel = doc.getSelection();
  if (!sel) return false;
  const range = doc.createRange();
  if (placed && node) {
    range.setStart(node, offset);
  } else if (last) {
    range.setStart(last, (last.textContent ?? '').length);
  } else {
    range.setStart(ed, 0);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}
