/**
 * Dialogs for the Employees screen.
 *
 * Each self-gates on the modal union tag and renders nothing otherwise, so they
 * can sit unconditionally at the bottom of the screen — the same arrangement
 * menuModals.tsx uses.
 *
 * The recurring detail worth knowing: every save here keeps the dialog OPEN on
 * failure and shows the reason inline. The two most likely failures are a PIN
 * somebody else already has and a delete the server refuses, and both need the
 * admin to read something and try again — closing the form would throw away
 * what they typed and leave them guessing.
 */
import { usePos } from '../store';
import { Icon } from '../icons/Icon';
import { money } from '../lib/format';
import {
  ErrorLine,
  Field,
  ModalActions,
  ModalOverlay,
  ModalTitle,
  bareInput,
} from './ui';
import type { StaffRole } from '../data/types';

const ROLES: Array<{ id: StaffRole; label: string; blurb: string }> = [
  { id: 'cashier', label: 'Cashier', blurb: 'Takes orders and settles bills' },
  { id: 'kitchen_staff', label: 'Kitchen Staff', blurb: 'Works the kitchen display' },
];

export function EmployeeModal() {
  const { state, actions } = usePos();
  if (state.modal?.kind !== 'emp') return null;

  const adding = state.modal.mode === 'add';

  return (
    <ModalOverlay maxWidth={480} gap={16} scroll>
      <ModalTitle>{adding ? 'Add employee' : 'Edit employee'}</ModalTitle>

      <Field label="Full name" htmlFor="empname">
        <input
          id="empname"
          value={state.empDraft.name}
          onChange={(e) => actions.setEmpDraft({ name: e.target.value })}
          style={bareInput}
          placeholder="Asha Menon"
        />
      </Field>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'rgba(0,0,0,0.58)',
          }}
        >
          Role
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          {ROLES.map((role) => {
            const active = state.empDraft.role === role.id;
            return (
              <button
                key={role.id}
                type="button"
                className="press"
                onClick={() => actions.setEmpDraft({ role: role.id })}
                style={{
                  flex: 1,
                  textAlign: 'left',
                  padding: '11px 14px',
                  borderRadius: 10,
                  border: `1px solid ${active ? '#00754A' : '#d6dbde'}`,
                  background: active ? '#d4e9e2' : '#ffffff',
                  color: active ? '#00754A' : 'rgba(0,0,0,0.58)',
                }}
              >
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{role.label}</span>
                <span style={{ display: 'block', fontSize: 11, marginTop: 2 }}>{role.blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/*
        Only on creation. Changing an existing PIN is its own dialog, because it
        is its own endpoint and should be audited as a credential change rather
        than buried inside a name correction.
      */}
      {adding ? (
        <Field label="Login PIN (4 digits)" htmlFor="emppin">
          <input
            id="emppin"
            value={state.empDraft.pin}
            onChange={(e) => actions.setEmpDraft({ pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            style={{ ...bareInput, letterSpacing: '0.4em' }}
            placeholder="••••"
            inputMode="numeric"
            autoComplete="off"
          />
        </Field>
      ) : null}

      <div style={{ display: 'flex', gap: 12 }}>
        <Field label="Phone" htmlFor="empphone" style={{ flex: 1 }}>
          <input
            id="empphone"
            value={state.empDraft.phone}
            onChange={(e) => actions.setEmpDraft({ phone: e.target.value })}
            style={bareInput}
            placeholder="Optional"
          />
        </Field>
        <Field label="Joined on" htmlFor="empjoined" style={{ flex: 1 }}>
          <input
            id="empjoined"
            type="date"
            value={state.empDraft.joinedOn}
            onChange={(e) => actions.setEmpDraft({ joinedOn: e.target.value })}
            style={bareInput}
          />
        </Field>
      </div>

      <Field label="Monthly salary" htmlFor="empsalary">
        <input
          id="empsalary"
          value={state.empDraft.salary}
          onChange={(e) => actions.setEmpDraft({ salary: e.target.value })}
          style={bareInput}
          placeholder="0.00"
          inputMode="decimal"
        />
      </Field>

      <Field label="Notes" htmlFor="empnotes">
        <input
          id="empnotes"
          value={state.empDraft.notes}
          onChange={(e) => actions.setEmpDraft({ notes: e.target.value })}
          style={bareInput}
          placeholder="Optional"
        />
      </Field>

      {state.empError ? <ErrorLine message={state.empError} /> : null}

      <ModalActions
        onCancel={actions.closeModal}
        onSave={() => void actions.saveEmployee()}
        busy={state.empSaving}
        busyLabel="Saving…"
        saveLabel={adding ? 'Add employee' : 'Save changes'}
      />
    </ModalOverlay>
  );
}

/**
 * Set or replace a login PIN.
 *
 * The PIN is never read back from the server — only ever written — so this
 * always starts blank rather than showing the current one.
 */
export function EmployeePinModal() {
  const { state, actions } = usePos();
  const modal = state.modal;
  if (modal?.kind !== 'emppin') return null;

  const employee = state.employees.find((e) => e.id === modal.target);

  return (
    <ModalOverlay maxWidth={400} gap={16}>
      <ModalTitle>Set login PIN</ModalTitle>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'rgba(0,0,0,0.58)' }}>
        {employee ? `${employee.name} signs in` : 'They sign in'} with these four digits at the
        terminal. Tell them in person — it is not shown again, only replaced.
      </p>

      <Field label="New PIN" htmlFor="pinfield">
        <input
          id="pinfield"
          value={state.pinDraft}
          onChange={(e) => actions.setPinDraft(e.target.value)}
          style={{ ...bareInput, letterSpacing: '0.4em', fontSize: 20 }}
          placeholder="••••"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
        />
      </Field>

      {state.pinError ? <ErrorLine message={state.pinError} /> : null}

      <ModalActions
        onCancel={actions.closeModal}
        onSave={() => void actions.saveEmployeePin()}
        busy={state.empSaving}
        busyLabel="Saving…"
        saveLabel="Set PIN"
      />
    </ModalOverlay>
  );
}

/**
 * Delete confirmation.
 *
 * Deliberately says what will probably happen: for anyone who has worked a
 * shift the server refuses, because their past orders still name them. The
 * refusal arrives as an inline message rather than a toast so it can be read.
 */
export function EmployeeDeleteModal() {
  const { state, actions } = usePos();
  const modal = state.modal;
  if (modal?.kind !== 'empdel') return null;

  const employee = state.employees.find((e) => e.id === modal.target);

  return (
    <ModalOverlay maxWidth={420} gap={16}>
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: '#fdecea',
          color: '#c82014',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon icon="lucide:alert-triangle" size={20} />
      </span>

      <ModalTitle>Remove {employee?.name ?? 'this employee'}?</ModalTitle>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'rgba(0,0,0,0.58)' }}>
        This deletes the account permanently. If they have ever taken an order the server will
        refuse, because past bills still carry their name — deactivate them instead, which stops
        their PIN working straight away.
      </p>

      {state.empError ? <ErrorLine message={state.empError} /> : null}

      <ModalActions
        onCancel={actions.closeModal}
        onSave={() => void actions.deleteEmployee()}
        busy={state.empSaving}
        busyLabel="Removing…"
        saveLabel="Remove"
        destructive
      />
    </ModalOverlay>
  );
}

/** Bonus and deduction for one employee's month. */
export function PayrollAdjustModal() {
  const { state, actions } = usePos();
  const modal = state.modal;
  if (modal?.kind !== 'pay') return null;

  const row = state.payRows.find((r) => r.employeeId === modal.employee);

  return (
    <ModalOverlay maxWidth={420} gap={16}>
      <ModalTitle>Adjust {row?.name ?? 'pay'}</ModalTitle>

      <p style={{ margin: 0, fontSize: 13, color: 'rgba(0,0,0,0.58)' }}>
        {row ? `${modal.month} · earned ${money(row.earned)}` : modal.month}
      </p>

      <div style={{ display: 'flex', gap: 12 }}>
        <Field label="Bonus" htmlFor="paybonus" style={{ flex: 1 }}>
          <input
            id="paybonus"
            value={state.payDraft.bonus}
            onChange={(e) => actions.setPayDraft({ bonus: e.target.value })}
            style={bareInput}
            placeholder="0.00"
            inputMode="decimal"
          />
        </Field>
        <Field label="Deduction" htmlFor="paydeduct" style={{ flex: 1 }}>
          <input
            id="paydeduct"
            value={state.payDraft.deduction}
            onChange={(e) => actions.setPayDraft({ deduction: e.target.value })}
            style={bareInput}
            placeholder="0.00"
            inputMode="decimal"
          />
        </Field>
      </div>

      <Field label="Note" htmlFor="paynote">
        <input
          id="paynote"
          value={state.payDraft.notes}
          onChange={(e) => actions.setPayDraft({ notes: e.target.value })}
          style={bareInput}
          placeholder="Optional — e.g. festival bonus"
        />
      </Field>

      {state.payFormError ? <ErrorLine message={state.payFormError} /> : null}

      <ModalActions
        onCancel={actions.closeModal}
        onSave={() => void actions.savePayAdjustment()}
        saveLabel="Save adjustment"
      />
    </ModalOverlay>
  );
}
