/**
 * Linking a terminal to a restaurant.
 *
 * ── What this is actually for ──────────────────────────────────────────────
 * Staff sign in by tapping four digits, which tells the server nothing about
 * which restaurant they work at — and two restaurants can both issue PIN 1234.
 * Linking this machine is what resolves that: from here on it presents a
 * long-lived cookie with every PIN attempt, and the PIN is only ever matched
 * within the restaurant that cookie names.
 *
 * So this is not a settings nicety. Until it is done once, the PIN keypad on
 * this machine cannot work at all.
 *
 * The prompt appears on its own for an administrator sitting at an unlinked
 * terminal, because that is the moment the machine can be linked and the
 * person doing it is present. It is also reachable deliberately from the
 * Employees screen, for re-linking a replaced machine.
 */
import { Icon } from '../icons/Icon';
import { usePos } from '../store';
import { ModalOverlay, ModalTitle, ModalActions, ErrorLine, Field, bareInput } from './ui';

export function TerminalSetup() {
  const { state, actions } = usePos();
  if (!state.terminalSetup) return null;

  const ready = state.terminalName.trim().length >= 2;

  return (
    <ModalOverlay maxWidth={430}>
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: '#d4e9e2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#00754A',
        }}
      >
        <Icon icon="lucide:monitor-smartphone" size={22} />
      </span>

      <ModalTitle>
        {state.terminalLinked ? 'Re-link this terminal' : 'Set up this terminal'}
      </ModalTitle>

      <p
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 500,
          color: 'rgba(0,0,0,0.58)',
          lineHeight: 1.55,
        }}
      >
        {state.terminalLinked
          ? 'This will replace the existing link on this machine. Staff PINs keep working.'
          : `Name this machine so your staff can sign in with their PIN at ${state.restaurant?.name ?? 'your restaurant'}.`}
      </p>

      <Field label="Terminal name" htmlFor="terminal-name">
        <input
          id="terminal-name"
          type="text"
          autoFocus
          maxLength={60}
          placeholder="e.g. Front counter"
          value={state.terminalName}
          onChange={(e) => actions.setTerminalName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready && !state.authPending) {
              e.preventDefault();
              void actions.linkThisTerminal();
            }
          }}
          style={bareInput}
        />
      </Field>

      <p
        style={{
          margin: 0,
          padding: '11px 14px',
          borderRadius: 12,
          background: '#faf6ee',
          fontSize: 12.5,
          fontWeight: 500,
          color: '#8a6a24',
          lineHeight: 1.55,
        }}
      >
        This links the browser you are using right now — not the account. Do it on each till, once.
      </p>

      {state.loginError ? <ErrorLine message={state.loginError} /> : null}

      <ModalActions
        onCancel={actions.closeTerminalSetup}
        onSave={() => void actions.linkThisTerminal()}
        saveLabel="Link this terminal"
        busyLabel="Linking…"
        busy={state.authPending}
        saveDisabled={!ready}
      />
    </ModalOverlay>
  );
}

export default TerminalSetup;
