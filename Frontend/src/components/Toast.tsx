import { Icon } from '../icons/Icon';
import { usePos } from '../store';
import { useIsMobile } from '../lib/useViewport';

export function Toast() {
  const { state } = usePos();
  const isMobile = useIsMobile();
  if (!state.toast) return null;

  return (
    <div
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
        borderRadius: 50,
        background: '#1E3932',
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
      <Icon icon="lucide:check-circle-2" size={18} color="#d4e9e2" />
      {state.toast}
    </div>
  );
}
