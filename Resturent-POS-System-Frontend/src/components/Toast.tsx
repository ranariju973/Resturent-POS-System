import { Icon } from '../icons/Icon';
import { usePos } from '../store';

export function Toast() {
  const { state } = usePos();
  if (!state.toast) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '13px 22px',
        borderRadius: 50,
        background: '#1E3932',
        color: '#ffffff',
        fontSize: 14,
        fontWeight: 600,
        boxShadow: '0 0 6px rgba(0,0,0,0.24), 0 8px 12px rgba(0,0,0,0.14)',
        animation: 'toastIn 0.22s ease-out',
        zIndex: 40,
      }}
    >
      <Icon icon="lucide:check-circle-2" size={18} color="#d4e9e2" />
      {state.toast}
    </div>
  );
}
