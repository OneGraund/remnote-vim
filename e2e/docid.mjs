// Resolve today's Daily Document id from a running RemNote page.
//
// The naive approach — take the URL's trailing "-<id>" — breaks the moment a
// split pane is open: the URL becomes ".../(Slug-idA)_(Slug-idB)_50" and ends
// with the split ratio. Instead: collect every id-shaped token from the URL
// (plain tail + each parenthesized pane slug) and pick the one whose rem is
// actually today's daily document (title match via the read-only data API);
// fall back to the last candidate so a renamed/foreign-locale daily doc still
// resolves in the single-pane case.
/**
 * CSS selector prefix that scopes DOM queries to the pane showing the daily
 * document. With a split open, a daily-doc child zoomed in another pane
 * renders its rems TWICE — unscoped .EditorContainer queries return
 * duplicates and clicks can land in the wrong pane (moving focus there).
 * Pane DOM ids (#pane-0, #pane-1, …) follow the URL slug order
 * "(SlugA-idA)_(SlugB-idB)_ratio", so the daily pane index is the index of
 * the slug carrying docId. Returns '' when there is no split (or no #pane-*
 * elements), which keeps document-wide queries working.
 *
 * Call this right before each DOM query, not once at startup: the layout can
 * change mid-run (a human closing the split while a suite runs turned a
 * cached '#pane-0 ' into a match-nothing selector). The result is verified
 * against the live DOM and degrades to '' when stale.
 */
export async function dailyPaneScope(page, docId) {
  return page.evaluate((id) => {
    if (!document.querySelector('[id^=pane-]')) return '';
    const href = decodeURIComponent(location.href);
    const slugs = [...href.matchAll(/\(([^()]+)\)/g)].map((m) => m[1]);
    if (slugs.length < 2) return '';
    const idx = slugs.findIndex((s) => s.endsWith('-' + id));
    if (idx < 0) return '';
    const sel = `#pane-${idx} `;
    return document.querySelector(sel + '.EditorContainer') ? sel : '';
  }, docId);
}

export async function resolveDailyDocId(page) {
  return page.evaluate(() => {
    const href = decodeURIComponent(location.href);
    const candidates = [];
    for (const m of href.matchAll(/\(([^()]+)\)/g)) {
      const id = m[1].match(/-([A-Za-z0-9]+)$/)?.[1];
      if (id) candidates.push(id);
    }
    const tail = href.match(/-([A-Za-z0-9]+)$/)?.[1];
    if (tail) candidates.push(tail);
    // bare-id URL form (no title slug): /w/<kb>/<remId>
    const seg = href.split('/').pop() ?? '';
    if (/^[A-Za-z0-9]{10,24}$/.test(seg)) candidates.push(seg);
    if (candidates.length === 0) return null;

    // RemNote's English daily title: "July 7th, 2026"
    const d = new Date();
    const day = d.getDate();
    const suffix =
      day % 10 === 1 && day !== 11 ? 'st'
      : day % 10 === 2 && day !== 12 ? 'nd'
      : day % 10 === 3 && day !== 13 ? 'rd'
      : 'th';
    const title = `${d.toLocaleString('en-US', { month: 'long' })} ${day}${suffix}, ${d.getFullYear()}`;

    // Prefer the exact-today title; else any date-shaped title (covers a
    // session running past midnight with yesterday's daily doc still open);
    // else fall back to the last URL candidate (single-pane behavior).
    let dateShaped = null;
    for (const id of candidates) {
      try {
        const rem = window.Rem(window.CURRENT_KNOWLEDGE_BASE).findOne(id);
        // the in-page data model keeps a rem's text in `key` (not `text`)
        const text = (rem?.key ?? rem?.text ?? [])
          .map((x) => (typeof x === 'string' ? x : ''))
          .join('');
        if (text === title) return id;
        if (!dateShaped && /^[A-Z][a-z]+ \d+(st|nd|rd|th), \d{4}$/.test(text)) {
          dateShaped = id;
        }
      } catch {
        /* candidate isn't a rem — skip */
      }
    }
    return dateShaped ?? candidates[candidates.length - 1];
  });
}
