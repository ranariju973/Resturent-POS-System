/**
 * The Attendance tab.
 *
 * Marks are STAGED, not saved as you click. Attendance is payroll input, so a
 * mark that silently failed but showed as saved becomes a wrong wage two weeks
 * later — the admin marks the roster, sees what is unsaved, and commits it in
 * one request. That request is idempotent server-side, so re-saving a day
 * corrects it rather than doubling it.
 *
 * Everybody on the roster is listed, including people with no record yet. A
 * screen showing only those already marked is a screen that hides whoever was
 * forgotten.
 */
import { useEffect } from 'react';
import { usePos } from '../store';
import { useIsMobile } from '../lib/useViewport';
import { Icon } from '../icons/Icon';
import {
  ErrorLine,
  IconButton,
  LoadState,
  ModalOverlay,
  ModalTitle,
  card,
  primaryPill,
  tableHeaderCell,
} from '../components/ui';
import { SkeletonRows } from '../components/motion';
import type { AttendanceStatus } from '../data/types';

const STATUSES: Array<{ id: AttendanceStatus; label: string; bg: string; fg: string }> = [
  { id: 'present', label: 'Present', bg: '#d4e9e2', fg: '#00754A' },
  { id: 'absent', label: 'Absent', bg: '#fdecea', fg: '#c82014' },
  { id: 'half_day', label: 'Half day', bg: '#fdf3e0', fg: '#8a6a24' },
  { id: 'leave', label: 'Leave', bg: '#e6edf7', fg: '#2b4d80' },
];

const GRID = '1.4fr auto 1.2fr';
/** Stacked on a phone — see the note where it is used. */
const MOBILE_GRID = '1fr';

export function EmployeeAttendance() {
  const { state, actions } = usePos();
  const isMobile = useIsMobile();

  useEffect(() => {
    void actions.loadAttendanceDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.attDate]);

  const pending = Object.keys(state.attDraft).length;
  const markedCount = state.attRows.filter((r) => r.status !== null).length;

  return (
    <section style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 16px',
            borderRadius: 50,
            border: '1px solid #d6dbde',
            background: '#ffffff',
          }}
        >
          <Icon icon="lucide:calendar-check" size={15} />
          <input
            type="date"
            value={state.attDate}
            onChange={(e) => actions.setAttDate(e.target.value)}
            style={{ border: 0, background: 'transparent', fontSize: 14, fontWeight: 700 }}
          />
        </label>

        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.58)' }}>
          {markedCount} of {state.attRows.length} marked
        </span>

        <button
          type="button"
          className="press hv-primary"
          onClick={() => void actions.saveAttendanceDay()}
          disabled={pending === 0 || state.attSaving}
          style={{
            ...primaryPill,
            marginLeft: 'auto',
            ...(pending === 0 || state.attSaving ? { opacity: 0.5, cursor: 'default' } : null),
          }}
        >
          <Icon icon="lucide:check" size={15} />
          {state.attSaving ? 'Saving…' : pending ? `Save ${pending} change${pending === 1 ? '' : 's'}` : 'Saved'}
        </button>
      </div>

      <div
        style={{
          display: isMobile ? 'none' : 'grid',
          gridTemplateColumns: GRID,
          gap: 10,
          padding: '0 12px',
          alignItems: 'center',
        }}
      >
        <span style={tableHeaderCell}>Employee</span>
        <span style={tableHeaderCell}>Status</span>
        <span style={tableHeaderCell}>Note</span>
      </div>

      {state.attRows.map((row) => {
        const draft = state.attDraft[row.employeeId];
        const status = draft?.status ?? row.status;
        const notes = draft ? draft.notes : row.notes;
        const dirty = Boolean(draft);

        return (
          <div
            key={row.employeeId}
            className="cells"
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? MOBILE_GRID : GRID,
              gap: 10,
              alignItems: isMobile ? 'stretch' : 'center',
              padding: 12,
              borderRadius: 10,
              // A staged row is tinted so what is about to be saved is obvious
              // before the button is pressed.
              border: `1px solid ${dirty ? '#00754A' : '#e8ecef'}`,
              background: dirty ? '#f4faf8' : '#ffffff',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {/*
                The month view for this person. The day roster answers "who is
                in today"; this answers "how has their month gone", which is
                the question that comes up when payroll looks wrong.
              */}
              <IconButton
                icon="lucide:calendar-check"
                title={`${row.name}'s attendance this month`}
                iconSize={14}
                size={30}
                onClick={() => actions.openAttendanceCalendar(row.employeeId, row.name)}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
                  {row.name}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)' }}>
                  {row.roleLabel}
                  {status === null ? ' · not marked' : ''}
                </span>
              </span>
            </span>

            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STATUSES.map((option) => {
                const active = status === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className="press"
                    onClick={() => actions.setAttMark(row.employeeId, option.id)}
                    style={{
                      padding: '7px 13px',
                      borderRadius: 50,
                      fontSize: 12,
                      fontWeight: 700,
                      border: `1px solid ${active ? option.fg : '#d6dbde'}`,
                      background: active ? option.bg : '#ffffff',
                      color: active ? option.fg : 'rgba(0,0,0,0.45)',
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </span>

            <input
              value={notes}
              onChange={(e) => actions.setAttNote(row.employeeId, e.target.value)}
              // A note is part of a mark, so there is nothing to attach it to
              // until a status has been chosen.
              disabled={status === null}
              placeholder={status === null ? 'Mark a status first' : 'Optional note'}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                border: '1px solid #d6dbde',
                background: status === null ? '#f7f7f5' : '#ffffff',
                fontSize: 13,
              }}
            />
          </div>
        );
      })}

      {state.attError ? <ErrorLine message={state.attError} /> : null}

      <LoadState
        loading={state.attLoading}
        skeleton={<SkeletonRows count={5} height={64} />}
        error={state.attLoading ? '' : state.attError}
        empty={!state.attLoading && !state.attError && state.attRows.length === 0}
        emptyMessage="No active cashier or kitchen staff to mark. Add an employee first."
        onRetry={() => void actions.loadAttendanceDay()}
      />

      <AttendanceCalendar />
    </section>
  );
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Look up a status colour without repeating the palette. */
const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

/**
 * One employee's month, colour-filled by status.
 *
 * ── Everything here is UTC, deliberately ───────────────────────────────────
 * The server stores each attendance day at exactly T00:00:00.000Z, so a day is
 * a calendar key rather than a moment. Building the grid with local-time
 * `new Date(y, m, d)` in a +05:30 timezone shifts every square back by one and
 * paints Monday's status onto Sunday — the kind of error nobody notices until
 * a wage is short.
 */
function AttendanceCalendar() {
  const { state, actions } = usePos();
  const employee = state.attCalEmployee;

  useEffect(() => {
    if (employee) void actions.loadAttendanceCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.id, state.attCalMonth]);

  if (!employee) return null;

  const [year, month] = state.attCalMonth.split('-').map(Number);
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // Day 0 of the NEXT month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leadingBlanks = firstOfMonth.getUTCDay();

  const monthLabel = firstOfMonth.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <ModalOverlay maxWidth={420} gap={16}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <ModalTitle>{employee.name}</ModalTitle>
        <IconButton icon="lucide:x" title="Close" onClick={actions.closeAttendanceCalendar} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton
          icon="lucide:chevron-left"
          title="Previous month"
          onClick={() => actions.stepAttCalMonth(-1)}
        />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(0,0,0,0.87)' }}>
          {monthLabel}
        </span>
        <IconButton
          icon="lucide:chevron-right"
          title="Next month"
          onClick={() => actions.stepAttCalMonth(1)}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {WEEKDAYS.map((day, i) => (
          <span
            key={i}
            style={{
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'rgba(0,0,0,0.45)',
            }}
          >
            {day}
          </span>
        ))}

        {Array.from({ length: leadingBlanks }, (_, i) => <span key={`blank-${i}`} />)}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const key = `${state.attCalMonth}-${String(day).padStart(2, '0')}`;
          const status = state.attCalDays[key];
          const paint = status ? STATUS_BY_ID[status] : null;

          return (
            <span
              key={key}
              title={paint ? paint.label : 'Not marked'}
              style={{
                aspectRatio: '1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                // Unmarked is deliberately pale and grey rather than a fourth
                // colour: "nobody has said yet" is not a status, and payroll
                // does not pay or dock for it.
                background: paint ? paint.bg : '#f7f7f5',
                color: paint ? paint.fg : 'rgba(0,0,0,0.32)',
              }}
            >
              {day}
            </span>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {STATUSES.map((option) => (
          <span
            key={option.id}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600 }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 4,
                background: option.bg,
                border: `1px solid ${option.fg}`,
              }}
            />
            {option.label}
          </span>
        ))}
      </div>

      {state.attCalError ? <ErrorLine message={state.attCalError} /> : null}
      {state.attCalLoading ? (
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Loading…</span>
      ) : null}
    </ModalOverlay>
  );
}
