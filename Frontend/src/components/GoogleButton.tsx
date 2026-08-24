/**
 * Google's own sign-in button.
 *
 * ── Why Google renders it and we do not ────────────────────────────────────
 * A hand-built button would have to run the OAuth flow itself. Google Identity
 * Services renders one that handles the popup, the account chooser and the
 * ID token, and hands back a signed credential — which is the only part this
 * app actually wants. Drawing our own would mean reimplementing the flow to
 * arrive at the same token, and getting a worse one.
 *
 * The script is loaded on demand rather than from a tag in index.html: the
 * till spends almost all its life on screens that never need it, and a staff
 * member signing in with a PIN should not wait on a Google request first.
 */
import { useEffect, useRef, useState } from 'react';

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const SCRIPT_ID = 'google-identity-services';

interface CredentialResponse {
  credential?: string;
}

interface GoogleAccounts {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: CredentialResponse) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }): void;
      renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

/** Load the GSI script once, no matter how many buttons ask for it. */
let loader: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (loader) return loader;

  loader = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('script failed')));
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('script failed'));
    document.head.appendChild(script);
  }).catch((err) => {
    // Let a later attempt retry rather than caching the failure forever — a
    // till on a flaky connection should recover by itself.
    loader = null;
    throw err;
  });

  return loader;
}

export function GoogleButton({
  onCredential,
  disabled = false,
}: {
  onCredential: (credential: string) => void;
  disabled?: boolean;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * The callback in a ref, not a dependency.
   *
   * google.accounts.id.initialize() is global and effectively once-per-page:
   * re-running it on every render of a parent would re-register the handler
   * and re-render the button, which makes it flicker mid-click. Reading the
   * latest callback through a ref keeps the effect's dependency list empty
   * while never calling a stale closure.
   */
  const handler = useRef(onCredential);
  handler.current = onCredential;

  useEffect(() => {
    let cancelled = false;
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

    if (!clientId) {
      setFailed(true);
      return undefined;
    }

    loadGoogleScript()
      .then(() => {
        if (cancelled || !host.current || !window.google) return;

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) handler.current(response.credential);
          },
          // No auto sign-in: a shared till must never silently resume the last
          // owner's session because their browser still remembers them.
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        window.google.accounts.id.renderButton(host.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'pill',
          logo_alignment: 'left',
          width: 320,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 500,
          color: '#c82014',
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        Google sign-in could not load. Check this terminal&rsquo;s connection, then reload.
      </p>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        // The button is Google's own iframe and cannot be disabled through a
        // prop, so a request in flight is shown by dimming and swallowing
        // clicks — which also stops a double-tap minting two sessions.
        ...(disabled ? { opacity: 0.6, pointerEvents: 'none' } : null),
      }}
    >
      <div ref={host} />
    </div>
  );
}

export default GoogleButton;
