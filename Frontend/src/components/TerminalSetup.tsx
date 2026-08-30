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
 * ── Why it asks "which terminal is this?" and not "name a terminal" ────────
 * The device cookie belongs to the BROWSER, not the account, and it
 * deliberately survives logout — a till must not need re-linking at the end of
 * every shift. The consequence on a machine two owners have both used is that
 * the last one to link owns the cookie, so everyone else's session correctly
 * reports "this is not your terminal" and this screen opens again.
 *
 * That was fine. What was not fine is that the screen was a bare name box over
 * a create-only endpoint: the owner could not see that Terminal 1 already
 * existed, typing it was refused as a duplicate, and the only way forward was
 * to invent Terminal 4 for the till that had been Terminal 1 all along. One
 * machine, four names, none of them true.
 *
 * A picker fixes the question rather than the error message. The names on file
 * are the answers, and re-linking is a first-class verb.
 */
import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { usePos } from '../store';
import type { TerminalRow } from '../lib/auth';
import { ModalOverlay, ModalTitle, ModalActions, ErrorLine, Field, bareInput } from './ui';

export function TerminalSetup() {
  const { state, actions } = usePos();
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (!state.terminalSetup) return null;

  const creating = state.terminalChoice === 'new';
  const ready = creating ? state.terminalName.trim().length >= 2 : true;
  const busy = state.authPending;
  const hasTerminals = state.terminals.length > 0;

  const startRename = (row: TerminalRow) => {
    setEditing(row.id);
    setEditName(row.name);
    setConfirmRemove(null);
  };

  const commitRename = async () => {
    if (!editing) return;
    await actions.renameTerminal(editing, editName);
    setEditing(null);
  };

  return (
    <ModalOverlay maxWidth={460} scroll>
      <span style={badge}>
        <Icon icon="lucide:monitor-smartphone" size={22} />
      </span>

      <ModalTitle>{hasTerminals ? 'Which terminal is this?' : 'Set up this terminal'}</ModalTitle>

      <p style={lead}>
        {hasTerminals
          ? 'Pick the terminal this machine is, or add a new one.'
          : `Name this machine so your staff can sign in with their PIN at ${
              state.restaurant?.name ?? 'your restaurant'
            }.`}
      </p>

      {state.terminalsLoading ? (
        <p style={{ ...lead, textAlign: 'center' }}>Loading terminals&hellip;</p>
      ) : null}

      {hasTerminals ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state.terminals.map((row) => {
            const selected = state.terminalChoice === row.id;
            const isThisMachine = state.terminal?.name === row.name;

            if (editing === row.id) {
              return (
                <div key={row.id} style={{ ...rowBox, borderColor: '#00754A' }}>
                  <input
                    autoFocus
                    type="text"
                    maxLength={60}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void commitRename();
                      }
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    style={{ ...bareInput, marginTop: 0, flex: 1, minWidth: 0 }}
                  />
                  <IconButton icon="lucide:check" label="Save name" onClick={() => void commitRename()} />
                  <IconButton icon="lucide:x" label="Cancel" onClick={() => setEditing(null)} />
                </div>
              );
            }

            return (
              <div key={row.id} style={{ ...rowBox, borderColor: selected ? '#00754A' : '#d6dbde' }}>
                <button
                  type="button"
                  className="press"
                  disabled={busy}
                  onClick={() => actions.setTerminalChoice(row.id)}
                  style={pickButton}
                >
                  <span style={{ ...radio, borderColor: selected ? '#00754A' : '#d6dbde' }}>
                    {selected ? <span style={radioDot} /> : null}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={rowName}>
                      {row.name}
                      {isThisMachine ? <span style={pill}>this machine</span> : null}
                    </span>
                    <span style={rowMeta}>{lastSeenLabel(row)}</span>
                  </span>
                </button>

                {confirmRemove === row.id ? (
                  <>
                    <IconButton
                      icon="lucide:trash-2"
                      label={`Confirm removing ${row.name}`}
                      danger
                      onClick={() => {
                        setConfirmRemove(null);
                        void actions.removeTerminal(row.id);
                      }}
                    />
                    <IconButton
                      icon="lucide:x"
                      label="Keep it"
                      onClick={() => setConfirmRemove(null)}
                    />
                  </>
                ) : (
                  <>
                    <IconButton
                      icon="lucide:pencil"
                      label={`Rename ${row.name}`}
                      onClick={() => startRename(row)}
                    />
                    <IconButton
                      icon="lucide:trash-2"
                      label={`Remove ${row.name}`}
                      onClick={() => setConfirmRemove(row.id)}
                    />
                  </>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className="press"
            disabled={busy}
            onClick={() => actions.setTerminalChoice('new')}
            style={{
              ...rowBox,
              borderColor: creating ? '#00754A' : '#d6dbde',
              borderStyle: 'dashed',
              cursor: 'pointer',
              background: 'transparent',
              width: '100%',
            }}
          >
            <span style={{ ...radio, borderColor: creating ? '#00754A' : '#d6dbde' }}>
              {creating ? <span style={radioDot} /> : null}
            </span>
            <span style={{ ...rowName, fontWeight: 600 }}>Add a new terminal</span>
          </button>
        </div>
      ) : null}

      {creating ? (
        <Field label="Terminal name" htmlFor="terminal-name">
          <input
            id="terminal-name"
            type="text"
            autoFocus={!hasTerminals}
            maxLength={60}
            placeholder="e.g. Front counter"
            value={state.terminalName}
            onChange={(e) => actions.setTerminalName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ready && !busy) {
                e.preventDefault();
                void actions.linkThisTerminal();
              }
            }}
            style={bareInput}
          />
        </Field>
      ) : null}

      {/*
        * Two different warnings, because they describe two different costs.
        * Creating explains what the binding IS; re-linking explains what it
        * takes away — the machine that held this terminal before will need
        * setting up again, and finding that out afterwards is no use.
        */}
      <p style={note}>
        {creating
          ? 'This links the browser you are using right now — not the account. Do it on each till, once.'
          : 'This machine becomes that terminal. Any other browser currently using it will need to be set up again.'}
      </p>

      {state.loginError ? <ErrorLine message={state.loginError} /> : null}

      <ModalActions
        onCancel={actions.closeTerminalSetup}
        onSave={() => void actions.linkThisTerminal()}
        saveLabel={creating ? 'Link this terminal' : 'Use this terminal'}
        busyLabel={creating ? 'Linking…' : 'Re-linking…'}
        busy={busy}
        saveDisabled={!ready}
      />
    </ModalOverlay>
  );
}

/**
 * When a shift was last worked on it.
 *
 * `lastSeenAt` is written on staff PIN sign-in, so it is the one signal that
 * distinguishes the till someone actually uses from a row left over by a
 * previous owner — which is exactly the judgement this picker asks for.
 */
function lastSeenLabel(row: TerminalRow): string {
  if (!row.lastSeenAt) return 'Never used';

  const days = Math.floor((Date.now() - new Date(row.lastSeenAt).getTime()) / 86_400_000);
  if (days <= 0) return 'Used today';
  if (days === 1) return 'Used yesterday';
  if (days < 30) return `Used ${days} days ago`;
  return `Last used ${new Date(row.lastSeenAt).toLocaleDateString()}`;
}

function IconButton({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className="press"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        border: 0,
        background: 'transparent',
        color: danger ? '#8c1d18' : 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        padding: 5,
        flexShrink: 0,
      }}
    >
      <Icon icon={icon} size={16} />
    </button>
  );
}

const badge = {
  width: 44,
  height: 44,
  borderRadius: '50%',
  background: '#d4e9e2',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#00754A',
} as const;

const lead = {
  margin: 0,
  fontSize: 14,
  fontWeight: 500,
  color: 'rgba(0,0,0,0.58)',
  lineHeight: 1.55,
} as const;

const rowBox = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px 4px 4px',
  border: '1px solid #d6dbde',
  borderRadius: 12,
} as const;

const pickButton = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  padding: '9px 6px 9px 10px',
  border: 0,
  background: 'transparent',
  textAlign: 'left',
} as const;

const radio = {
  width: 18,
  height: 18,
  borderRadius: '50%',
  border: '2px solid #d6dbde',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
} as const;

const radioDot = {
  width: 9,
  height: 9,
  borderRadius: '50%',
  background: '#00754A',
} as const;

const rowName = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 14,
  fontWeight: 700,
  color: 'rgba(0,0,0,0.87)',
} as const;

const rowMeta = { fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.45)' } as const;

const pill = {
  padding: '2px 8px',
  borderRadius: 50,
  background: '#d4e9e2',
  color: '#00754A',
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
} as const;

const note = {
  margin: 0,
  padding: '11px 14px',
  borderRadius: 12,
  background: '#faf6ee',
  fontSize: 12.5,
  fontWeight: 500,
  color: '#8a6a24',
  lineHeight: 1.55,
} as const;

export default TerminalSetup;
