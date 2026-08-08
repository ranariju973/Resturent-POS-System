/**
 * Printing a fragment of a single-page app.
 *
 * ── Why an iframe, and not a print-scoped container ────────────────────────
 * The obvious approach is `@media print { body > *:not(.print-root) { display:
 * none } }`. It does not survive this app. The root is `height: 100dvh;
 * overflow: hidden` (App.tsx), the shell is nested flex panes each with
 * `minHeight: 0; overflowY: auto`, and the active screen sits inside a
 * `motion` wrapper whose transform creates a containing block. A print root
 * buried in that inherits a clipped, scrolled, transformed box — Chrome
 * routinely emits one blank page or a cropped sliver.
 *
 * Making it work would mean `html, body, #root { height: auto !important;
 * overflow: visible !important; display: block !important }` and more, and the
 * whole pile silently regresses the day someone adds another flex wrapper.
 *
 * An iframe gets a FRESH document: no inherited height, no scroll container,
 * no transform ancestor, no stylesheet unless we put one there.
 * `iframe.contentWindow.print()` then prints exactly and only that document.
 */
import type { PaperWidth } from './types';

/**
 * The stylesheet the receipt document carries.
 *
 * `@page { size: <w>mm auto }` is the load-bearing line: `auto` height is what
 * makes the browser emit one continuous receipt rather than paginating onto
 * A4. If a print preview ever looks page-shaped, this rule did not apply.
 */
function receiptCss(paper: PaperWidth): string {
  return `
    @page { size: ${paper}mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: ${paper}mm;
      background: #fff;
      color: #000;
    }
    body {
      /* Monospace is not decoration: the column alignment the ESC/POS path
         computes in characters only matches on screen with a fixed advance. */
      font-family: ui-monospace, "Courier New", Courier, monospace;
      font-size: ${paper === 58 ? 11 : 12}px;
      line-height: 1.35;
      padding: 4mm 3mm;
      -webkit-font-smoothing: none;
    }
  `;
}

/** Two frames, so layout and fonts have settled before the dialog opens. */
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * Print one document's worth of HTML.
 *
 * Resolves once the print dialog has been dismissed — or after a timeout,
 * because Safari does not reliably fire `afterprint` and a promise that never
 * settles would wedge a multi-copy loop forever.
 */
export function printHtml(html: string, paper: PaperWidth): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');

    /*
     * `visibility: hidden` at zero size, NOT `display: none`.
     * Safari and Firefox refuse to print a display:none frame — its document
     * is never laid out, so there is nothing to paginate.
     */
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
      visibility: 'hidden',
    } satisfies Partial<CSSStyleDeclaration>);

    document.body.appendChild(frame);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      frame.remove();
      resolve();
    };
    // The fallback for browsers that never fire afterprint. Long enough that a
    // user reading the dialog is not cut off mid-decision.
    const timer = window.setTimeout(finish, 60_000);

    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) return finish();

    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${receiptCss(paper)}</style></head><body>${html}</body></html>`);
    doc.close();

    win.addEventListener('afterprint', finish);

    void (async () => {
      await nextFrame();
      // Fonts must be measured before pagination, or a receipt can print with
      // the fallback face at the wrong advance and lose its alignment.
      try {
        await doc.fonts?.ready;
      } catch {
        /* Not supported everywhere; the frame wait above is enough. */
      }
      try {
        win.focus();
        win.print();
      } catch {
        finish();
      }
    })();
  });
}
