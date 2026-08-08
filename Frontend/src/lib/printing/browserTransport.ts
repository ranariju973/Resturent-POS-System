/**
 * The default transport: the browser's own print dialog.
 *
 * Works on every device with nothing installed, which is why it is the
 * fallback for everything. What it cannot do is choose a printer or suppress
 * the dialog — both need OS-level access a web page does not have, which is
 * the entire reason QZ Tray exists as an option.
 */
import { printHtml } from './printFrame';
import type { PrintRequest, PrintTransport } from './transport';

export const browserTransport: PrintTransport = {
  id: 'browser',
  label: 'Browser print',

  /** Always. This is the mechanism everything else falls back to. */
  available: async () => true,

  async print(req: PrintRequest) {
    /*
     * Copies are sequential, awaited one at a time — each opens its own
     * dialog, since a web page cannot tell the OS to run off three. The
     * settings screen says so, rather than silently printing one.
     */
    for (let i = 0; i < Math.max(1, req.copies); i += 1) {
      await printHtml(req.html, req.paper);
    }
  },

  /** A web page cannot enumerate printers. Named printers need QZ. */
  listPrinters: async () => [],
};
