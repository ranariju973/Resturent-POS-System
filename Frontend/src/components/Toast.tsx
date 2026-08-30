import { Icon } from '../icons/Icon';
import { usePos } from '../store';
import { useIsMobile } from '../lib/useViewport';

export function Toast() {
  const { state } = usePos();
  const isMobile = useIsMobile();
  if (!state.toast) return null;

  /*
   * A failure is not a confirmation, and must not look like one.
   *
   * This pill used to render every message on the same dark-green ground with
   * the same checkmark, so "Image must be a JPEG, PNG or WebP" arrived wearing
   * the visual language of success. The colour is the fastest signal on the
   * screen; the icon and the longer dwell time (set in the store) do the rest.
   */
  const error = state.toastTone === 'error';

  return (
    <div
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
      style={{
        position: 'fixed',
        /*
         * Clears the tab bar on a phone, which occupies exactly where this
         * used to sit. Full width too: a right-anchored pill on a 375px
         * screen either wraps to two lines or truncates the message.
         */
        bottom: isMobile ? 'calc(84px + env(safe-area-inset-bottom))' : 24,
        right: isMobile ? 12 : 24,
        left: isMobile ? 12 : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isMobile ? 'center' : undefined,
        gap: 10,
        padding: '13px 22px',
        borderRadius: error ? 14 : 50,
        maxWidth: isMobile ? undefined : 420,
        background: error ? '#8c1d18' : '#1E3932',
        color: '#ffffff',
        fontSize: 14,
        fontWeight: 600,
        textAlign: isMobile ? 'center' : undefined,
        boxShadow: '0 0 6px rgba(0,0,0,0.24), 0 8px 12px rgba(0,0,0,0.14)',
        animation: 'toastIn 0.22s ease-out',
        // Above the tab bar and the billing summary bar, both of which sit at
        // 40 and 35 — a message the user must read outranks a control.
        zIndex: 41,
      }}
    >
      <Icon
        icon={error ? 'lucide:alert-circle' : 'lucide:check-circle-2'}
        size={18}
        color={error ? '#ffd9d6' : '#d4e9e2'}
      />
      {state.toast}
    </div>
  );
}
