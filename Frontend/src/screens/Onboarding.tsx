/**
 * Naming a restaurant — the one screen between signing in with Google and
 * having a working till.
 *
 * ── Why it asks for a name and nothing else ────────────────────────────────
 * Address, tax number and receipt footer are all editable afterwards from the
 * settings screen. Asking for them here would trade a till someone can use in
 * ten seconds for a complete record they can fill in whenever they like — and
 * the first screen of a new product is the worst place to spend a person's
 * patience.
 *
 * Rendered instead of the app shell, not inside it: there is no restaurant
 * yet, so every screen behind the nav would fail its first request. The server
 * agrees — a session in this state can reach only /auth/me and /tenants.
 */
import { Icon } from '../icons/Icon';
import { usePos } from '../store';
import { CARD_SHADOW, ErrorLine, Field, bareInput } from '../components/ui';

export function Onboarding() {
  const { state, actions } = usePos();
  const name = state.restaurantName.trim();
  const ready = name.length >= 2 && !state.authPending;

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        padding: '32px 24px',
        overflowY: 'auto',
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void actions.submitRestaurantName();
        }}
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#ffffff',
          borderRadius: 12,
          boxShadow: CARD_SHADOW,
          padding: '30px 28px 26px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
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
            <Icon icon="lucide:store" size={26} />
          </span>
          <span style={{ fontSize: 21, fontWeight: 700, color: '#006241', lineHeight: 1.2 }}>
            Name your restaurant
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'rgba(0,0,0,0.58)',
              textAlign: 'center',
              lineHeight: 1.55,
            }}
          >
            {state.user ? `Signed in as ${state.user.name}. ` : ''}
            This is the last step before your till is ready.
          </span>
        </div>

        <Field label="Restaurant name" htmlFor="restaurant-name">
          <input
            id="restaurant-name"
            type="text"
            autoFocus
            maxLength={80}
            placeholder="e.g. Spice Garden"
            value={state.restaurantName}
            onChange={(e) => actions.setRestaurantName(e.target.value)}
            style={bareInput}
          />
        </Field>

        <p
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 500,
            color: 'rgba(0,0,0,0.45)',
            lineHeight: 1.6,
          }}
        >
          This is what customers see on their receipt. You can change it, and add your address and
          GST number, from Settings later.
        </p>

        {state.loginError ? <ErrorLine message={state.loginError} /> : null}

        <button
          type="submit"
          className="press hv-primary"
          disabled={!ready}
          style={{
            padding: '14px 22px',
            borderRadius: 50,
            border: 0,
            background: '#00754A',
            color: '#ffffff',
            fontSize: 15,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            ...(ready ? null : { opacity: 0.5, cursor: 'default' }),
          }}
        >
          {state.authPending ? 'Creating…' : 'Create restaurant'}
        </button>

        <button
          type="button"
          className="press"
          onClick={actions.logout}
          style={{
            alignSelf: 'center',
            border: 0,
            background: 'transparent',
            fontSize: 13,
            fontWeight: 600,
            color: 'rgba(0,0,0,0.58)',
            padding: '4px 8px',
          }}
        >
          Sign in with a different account
        </button>
      </form>
    </div>
  );
}

export default Onboarding;
