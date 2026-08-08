import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Manrope is a design token, so it ships with the bundle rather than via a CDN.
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import { App } from './App';
import { PublicInvoice } from './screens/PublicInvoice';
import { PosProvider } from './store';
import './styles.css';

/**
 * The public invoice link, intercepted before anything else mounts.
 *
 * ── Why here and not inside App ────────────────────────────────────────────
 * A customer opening a receipt has no account and never will. Rendering this
 * inside the provider would still run `bootstrapAuth()` on mount — a pointless
 * round trip to /api/auth/refresh that can only fail — and flash the session
 * splash at them first. Deciding before the provider exists means the entire
 * auth lifecycle simply never runs for them.
 *
 * The slug is validated server-side; this only has to recognise the shape.
 */
const invoiceSlug = /^\/invoice\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname)?.[1];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {invoiceSlug ? (
      <PublicInvoice slug={invoiceSlug} />
    ) : (
      <PosProvider>
        <App />
      </PosProvider>
    )}
  </StrictMode>,
);
