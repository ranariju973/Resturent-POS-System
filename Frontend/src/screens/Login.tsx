import type { CSSProperties } from 'react';
import { Icon } from '../icons/Icon';
import { CONFIG, usePos } from '../store';
import { CARD_SHADOW, ErrorLine, Field, bareInput } from '../components/ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

export function Login() {
  const { state, actions } = usePos();
  const pinMode = state.mode === 'pin';
  const matched = state.match;
  const shakeAnim = state.shaking ? 'shake 0.4s cubic-bezier(0.36,0.07,0.19,0.97) 1' : 'none';

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: '32px 24px',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 428,
          background: '#ffffff',
          borderRadius: 12,
          boxShadow: CARD_SHADOW,
          padding: '28px 28px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#00754A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            <Icon icon="lucide:coffee" size={26} />
          </span>
          <span style={{ fontSize: 21, fontWeight: 700, color: '#006241', lineHeight: 1.2 }}>
            {CONFIG.restaurantName}
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
            {CONFIG.terminalLabel}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 50, background: '#f2f0eb' }}>
          <TabButton
            active={pinMode}
            icon="lucide:grid-2x2"
            label="PIN"
            onClick={() => actions.patch({ mode: 'pin', loginError: '' })}
          />
          <TabButton
            active={!pinMode}
            icon="lucide:key-round"
            label="Admin password"
            onClick={() =>
              actions.patch({ mode: 'password', loginError: '', pin: '', match: null })
            }
          />
        </div>

        {pinMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                minHeight: 92,
                justifyContent: 'center',
              }}
            >
              {matched ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 18px 8px 8px',
                    borderRadius: 50,
                    background: '#d4e9e2',
                    animation: 'riseIn 0.22s ease-out',
                  }}
                >
                  <img
                    src={matched.avatar}
                    alt={matched.name}
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: '50%',
                      objectFit: 'cover',
                      display: 'block',
                      border: '2px solid #ffffff',
                    }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#1E3932' }}>
                      Welcome, {matched.name.split(' ')[0]}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#00754A',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {matched.role}
                    </span>
                  </span>
                </div>
              ) : (
                <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
                  {state.authPending
                    ? 'Checking…'
                    : `Enter your ${CONFIG.pinLength}-digit PIN`}
                </span>
              )}

              <div style={{ display: 'flex', gap: 12, animation: shakeAnim }}>
                {Array.from({ length: CONFIG.pinLength }, (_, i) => {
                  const filled = i < state.pin.length;
                  return (
                    <span
                      key={i}
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        transition: 'all 0.15s ease',
                        background: filled ? '#00754A' : 'transparent',
                        border: `2px solid ${filled ? '#00754A' : '#d6dbde'}`,
                      }}
                    />
                  );
                })}
              </div>

              {state.loginError ? <ErrorLine message={state.loginError} /> : null}
            </div>

            <div
              className={state.authPending ? 'auth-pending' : undefined}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}
            >
              {KEYS.map((key) => {
                const util = key === 'clear' || key === 'back';
                return (
                  <button
                    key={key}
                    type="button"
                    className="press hv-green-border"
                    disabled={state.authPending}
                    onClick={() => void actions.pressKey(key)}
                    style={{
                      height: 62,
                      borderRadius: 50,
                      border: `1px solid ${util ? '#edebe9' : '#d6dbde'}`,
                      background: util ? '#f9f9f9' : '#ffffff',
                      color: util ? 'rgba(0,0,0,0.58)' : 'rgba(0,0,0,0.87)',
                      fontSize: util ? 15 : 24,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {key === 'clear' ? 'Clear' : key === 'back' ? '⌫' : key}
                  </button>
                );
              })}
            </div>

            {matched ? (
              <button
                type="button"
                className="press hv-primary"
                onClick={actions.confirmPin}
                style={confirmButton}
              >
                <Icon icon="lucide:log-in" size={18} />
                Confirm &amp; start shift
              </button>
            ) : (
              <button type="button" disabled style={lockedButton}>
                <Icon icon="lucide:lock" size={16} />
                Confirm &amp; start shift
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 2 }}>
            <div
              style={{
                animation: shakeAnim,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <Field label="Work email" htmlFor="email">
                <input
                  id="email"
                  type="email"
                  placeholder="admin@cafe.com"
                  value={state.email}
                  onChange={(e) => actions.patch({ email: e.target.value, loginError: '' })}
                  style={bareInput}
                />
              </Field>
              <Field label="Password" htmlFor="pw">
                <input
                  id="pw"
                  type="password"
                  placeholder="••••••••"
                  value={state.password}
                  onChange={(e) => actions.patch({ password: e.target.value, loginError: '' })}
                  style={bareInput}
                />
              </Field>
            </div>

            {state.loginError ? <ErrorLine message={state.loginError} /> : null}

            <button
              type="button"
              className="press hv-primary"
              disabled={state.authPending}
              onClick={() => void actions.signIn()}
              style={{
                ...confirmButton,
                display: 'block',
                ...(state.authPending ? { opacity: 0.6, cursor: 'default' } : null),
              }}
            >
              {state.authPending ? 'Signing in…' : 'Sign In'}
            </button>
            <a href="#forgot" style={{ alignSelf: 'center', fontSize: 13, fontWeight: 600 }}>
              Forgot password?
            </a>
          </div>
        )}
      </div>

      {CONFIG.showDemoHint ? (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 500,
            color: 'rgba(0,0,0,0.45)',
            textAlign: 'center',
          }}
        >
          {/* The old hint printed working PINs. Credentials now come from the
              backend seed (`npm run seed -- --demo`), which generates them
              randomly and prints them once — so there is nothing to hard-code
              here, which is the point. */}
          Sign in with your staff PIN, or use the Admin tab
        </p>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="press"
      onClick={onClick}
      style={{
        flex: 1,
        padding: '10px 16px',
        borderRadius: 50,
        border: 0,
        fontSize: 14,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        background: active ? '#ffffff' : 'transparent',
        color: active ? '#00754A' : 'rgba(0,0,0,0.45)',
        boxShadow: active ? CARD_SHADOW : 'none',
      }}
    >
      <Icon icon={icon} size={15} />
      {label}
    </button>
  );
}

const confirmButton: CSSProperties = {
  width: '100%',
  padding: '15px 24px',
  borderRadius: 50,
  border: '1px solid #00754A',
  background: '#00754A',
  color: '#ffffff',
  fontSize: 15,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

const lockedButton: CSSProperties = {
  ...confirmButton,
  border: '1px solid #edebe9',
  background: '#edebe9',
  color: 'rgba(0,0,0,0.32)',
  cursor: 'not-allowed',
};
