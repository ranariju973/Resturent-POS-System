import type { CSSProperties } from 'react';
import { Icon } from '../icons/Icon';
import { CONFIG, PASSWORD_MIN, usePos } from '../store';
import { CARD_SHADOW, ErrorLine, Field, bareInput } from '../components/ui';
import { GoogleButton } from '../components/GoogleButton';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

export function Login() {
  const { state, actions } = usePos();

  /*
   * An unlinked terminal cannot take a PIN at all.
   *
   * The server has no way to know which restaurant four digits belong to
   * without this machine's device cookie, so offering the keypad would be
   * offering a door that cannot open. The tabs disappear and only Google
   * sign-in is shown, which is what an owner needs to set the terminal up.
   */
  const pinMode = state.terminalLinked && state.mode === 'pin';
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
          {/*
            * The restaurant this TERMINAL belongs to, read before anyone signs
            * in. A keypad that cannot name its restaurant gives a cashier no
            * way to notice they are standing at the wrong one.
            */}
          <span style={{ fontSize: 21, fontWeight: 700, color: '#006241', lineHeight: 1.2 }}>
            {state.restaurant?.name ?? 'Restaurant POS'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.58)' }}>
            {state.terminalLinked
              ? (state.terminal?.name ?? 'Terminal')
              : 'This terminal is not set up yet'}
          </span>
        </div>

        {/* Hidden entirely while unlinked: there is only one usable door. */}
        {state.terminalLinked ? (
          <div
            style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 50, background: '#f2f0eb' }}
          >
            <TabButton
              active={pinMode}
              icon="lucide:grid-2x2"
              label="Staff PIN"
              onClick={() => actions.patch({ mode: 'pin', loginError: '' })}
            />
            <TabButton
              active={!pinMode}
              icon="lucide:user-round"
              label="Owner"
              onClick={() =>
                actions.patch({ mode: 'owner', loginError: '', pin: '', match: null })
              }
            />
          </div>
        ) : null}

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
          <OwnerPanel shakeAnim={shakeAnim} />
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
            maxWidth: 380,
            lineHeight: 1.6,
          }}
        >
          {state.terminalLinked
            ? 'Staff sign in with the PIN their manager set. Owners use the Owner tab.'
            : 'Only an owner can link a terminal, and it only has to be done once.'}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The administrator door — both credentials on one panel.
 *
 * Google and email+password are alternatives, not tiers. Google is listed
 * first because it is the one that carries whatever 2FA the owner already has
 * and stores no secret here; the password form exists so that running a
 * restaurant does not require holding a Google account.
 *
 * A real <form> rather than a div of inputs, so Enter submits and password
 * managers recognise the fields — an owner signing in at 6am should not have
 * to reach for the mouse.
 */
function OwnerPanel({ shakeAnim }: { shakeAnim: string }) {
  const { state, actions } = usePos();
  const signup = state.ownerTab === 'signup';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 2 }}>
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center' }}>
        <SubTab
          active={!signup}
          label="Sign in"
          onClick={() => actions.setOwnerTab('signin')}
        />
        <SubTab
          active={signup}
          label="Create account"
          onClick={() => actions.setOwnerTab('signup')}
        />
      </div>

      {!state.terminalLinked ? (
        <p style={hintText}>
          An owner needs to sign in once to link this terminal. After that, staff can use their
          PIN.
        </p>
      ) : null}

      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: shakeAnim }}
        onSubmit={(e) => {
          e.preventDefault();
          void (signup ? actions.signUpWithPassword() : actions.signInWithPassword());
        }}
      >
        {signup ? (
          <Field label="Your name" htmlFor="owner-name">
            <input
              id="owner-name"
              type="text"
              autoComplete="name"
              maxLength={80}
              placeholder="e.g. Priya Sharma"
              value={state.authName}
              onChange={(e) => actions.patch({ authName: e.target.value, loginError: '' })}
              style={bareInput}
            />
          </Field>
        ) : null}

        <Field label="Email" htmlFor="owner-email">
          <input
            id="owner-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            placeholder="you@restaurant.com"
            value={state.authEmail}
            onChange={(e) => actions.patch({ authEmail: e.target.value, loginError: '' })}
            style={bareInput}
          />
        </Field>

        <Field label="Password" htmlFor="owner-password">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              id="owner-password"
              type={state.authShowPassword ? 'text' : 'password'}
              /*
               * 'new-password' on the signup half is what makes a password
               * manager OFFER to generate one instead of autofilling the
               * existing entry for this site.
               */
              autoComplete={signup ? 'new-password' : 'current-password'}
              maxLength={72}
              placeholder={signup ? `At least ${PASSWORD_MIN} characters` : '••••••••'}
              value={state.authPassword}
              onChange={(e) => actions.patch({ authPassword: e.target.value, loginError: '' })}
              style={{ ...bareInput, flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              className="press"
              aria-label={state.authShowPassword ? 'Hide password' : 'Show password'}
              onClick={() => actions.patch({ authShowPassword: !state.authShowPassword })}
              style={{
                border: 0,
                background: 'transparent',
                color: 'rgba(0,0,0,0.45)',
                display: 'flex',
                alignItems: 'center',
                padding: 0,
                marginTop: 4,
              }}
            >
              <Icon icon={state.authShowPassword ? 'lucide:eye-off' : 'lucide:eye'} size={17} />
            </button>
          </span>
        </Field>

        <button
          type="submit"
          className="press hv-primary"
          disabled={state.authPending}
          style={state.authPending ? { ...confirmButton, opacity: 0.6 } : confirmButton}
        >
          <Icon icon={signup ? 'lucide:user-round-plus' : 'lucide:log-in'} size={18} />
          {state.authPending
            ? signup
              ? 'Creating account…'
              : 'Signing in…'
            : signup
              ? 'Create account'
              : 'Sign in'}
        </button>
      </form>

      {/*
        * No "forgot password" link, deliberately — there is no mail provider
        * in this deployment, so it would be a button that cannot work. Signing
        * in with Google on the same address links the two accounts and leaves
        * either credential able to open it, which is the recovery path.
        */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={rule} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.45)' }}>or</span>
        <span style={rule} />
      </div>

      <div style={{ animation: shakeAnim }}>
        <GoogleButton
          disabled={state.authPending}
          onCredential={(credential) => void actions.signInWithGoogle(credential)}
        />
      </div>

      {state.loginError ? <ErrorLine message={state.loginError} /> : null}
    </div>
  );
}

function SubTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="press"
      onClick={onClick}
      style={{
        border: 0,
        background: 'transparent',
        padding: '2px 0 5px',
        fontSize: 14,
        fontWeight: 700,
        color: active ? '#00754A' : 'rgba(0,0,0,0.45)',
        borderBottom: `2px solid ${active ? '#00754A' : 'transparent'}`,
      }}
    >
      {label}
    </button>
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

const hintText: CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontWeight: 500,
  color: 'rgba(0,0,0,0.58)',
  textAlign: 'center',
  lineHeight: 1.55,
};

const rule: CSSProperties = { flex: 1, height: 1, background: '#edebe9' };

const lockedButton: CSSProperties = {
  ...confirmButton,
  border: '1px solid #edebe9',
  background: '#edebe9',
  color: 'rgba(0,0,0,0.32)',
  cursor: 'not-allowed',
};
