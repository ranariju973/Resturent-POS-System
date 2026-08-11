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
function receiptCss(paper: PaperWidth, fixedPageSize = true): string {
  /*
   * `fixedPageSize` is false on Android.
   *
   * `@page { size: 58mm auto }` is what makes a desktop browser emit one
   * continuous receipt instead of paginating onto A4, and on a desktop it is
   * load-bearing. Android cannot honour it: the system print service
   * negotiates a real paper size with the selected printer, and a job
   * demanding an arbitrary custom page is rejected outright — which surfaces
   * as "there was a problem printing this page" with no further detail.
   *
   * So Android gets no `@page` rule and no fixed `width`. The receipt then
   * flows to whatever width the chosen paper actually is. A thermal roll
   * selected in the Android print dialog still prints correctly; A4 prints
   * the receipt at the top of a sheet, which is the honest fallback for a
   * phone printing to an office printer.
   */
  const page = fixedPageSize
    ? `@page { size: ${paper}mm auto; margin: 0; }`
    : `@page { margin: 4mm; }`;

  const width = fixedPageSize ? `width: ${paper}mm;` : `width: 100%; max-width: ${paper}mm;`;

  return `
    ${page}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      ${width}
      background: #fff;
      color: #000;
    }
    body {
      /* Monospace is not decoration: the column alignment the ESC/POS path
         computes in characters only matches on screen with a fixed advance. */
      font-family: ui-monospace, "Courier New", Courier, monospace;
      font-size: ${paper === 58 ? 11 : 12}px;
      line-height: 1.35;
      padding: ${fixedPageSize ? '4mm 3mm' : '0'};
      -webkit-font-smoothing: none;
    }
  `;
}

/** Two frames, so layout and fonts have settled before the dialog opens. */
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/*
 * ── Why mobile cannot use the iframe ───────────────────────────────────────
 * Everything above is true on a desktop browser. On a phone it is not:
 * iOS Safari and Chrome on Android do not reliably honour `print()` called on
 * a subframe. iOS in particular ignores the frame's document entirely and
 * paginates the TOP-LEVEL page instead — which is why printing a bill from a
 * phone produced a screenshot of the billing screen rather than the receipt.
 *
 * There is no way to feature-detect this: `print()` exists, returns without
 * error, and prints the wrong document. So the transport is chosen by
 * viewport, and the mobile branch makes the receipt the top-level document by
 * opening it in its own tab, where `print()` is unambiguous.
 */
const MOBILE_PRINT_MAX = 767;

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= MOBILE_PRINT_MAX;
}

/**
 * Print by handing the receipt to a new top-level document.
 *
 * The window is opened SYNCHRONOUSLY from the click that triggered the print —
 * a popup opened after an await has lost the user-activation that lets it
 * through the popup blocker.
 *
 * `onafterprint` closes it on the browsers that fire the event; the rest leave
 * a tab showing the receipt, which the user can dismiss. That is the honest
 * failure mode: a visible receipt they can print manually beats a silent
 * no-op or a screenshot of the wrong screen.
 */
function printViaWindow(html: string, paper: PaperWidth): Promise<void> {
  return new Promise((resolve, reject) => {
    const win = window.open('', '_blank');

    // Blocked by the popup blocker. Rejecting surfaces it as a toast through
    // the store's existing error handling — a silent resolve would look like
    // a print that simply did nothing.
    if (!win) {
      reject(
        new Error(
          'The print window was blocked. Allow pop-ups for this site to print from a phone.',
        ),
      );
      return;
    }

    win.document.open();
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        // No fixed @page: Android's print service rejects a custom page size.
        `<title>Receipt</title><style>${receiptCss(paper, false)}</style></head>` +
        `<body>${html}</body></html>`,
    );
    win.document.close();

    /*
     * The tab is NOT closed here.
     *
     * Android hands the document to the system print service, which reads it
     * asynchronously and outlives `print()` returning. Closing on `afterprint`
     * — which Android fires early, if at all — can pull the document out from
     * under the service mid-job, and the result is the generic "there was a
     * problem printing this page".
     *
     * Leaving the receipt on screen is also the better failure mode: if the
     * print service is unavailable the user still has the bill in front of
     * them and can retry from the browser menu.
     */
    const done = () => resolve();

    void (async () => {
      await nextFrame();
      try {
        await win.document.fonts?.ready;
      } catch {
        /* Not supported everywhere. */
      }
      try {
        win.focus();
        win.print();
      } catch {
        /* Leave the tab open with the receipt visible. */
      }
      done();
    })();
  });
}

/**
 * Print one document's worth of HTML.
 *
 * Resolves once the print dialog has been dismissed — or after a timeout,
 * because Safari does not reliably fire `afterprint` and a promise that never
 * settles would wedge a multi-copy loop forever.
 */
export function printHtml(html: string, paper: PaperWidth): Promise<void> {
  // A phone ignores a subframe's print() and paginates the page behind it
  // instead. See the note above printViaWindow.
  if (isMobileViewport()) return printViaWindow(html, paper);

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
