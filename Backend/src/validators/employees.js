/**
 * Employee (staff account) request schemas.
 *
 * ── An employee IS a user ──────────────────────────────────────────────────
 * There is no separate Employee collection: these endpoints write to the same
 * `User` documents that authenticate at the terminal. Creating an employee
 * creates a login, and that is why `pin` is part of the create payload rather
 * than a follow-up step — a cashier row without a PIN is an account nobody can
 * sign in to, and the model rejects it anyway.
 *
 * ── Why `role` is restricted to PIN_ROLES ──────────────────────────────────
 * Admins authenticate with email + password, not a PIN, and the User model's
 * integrity hook enforces that. Creating one therefore needs a different
 * payload entirely, so it is refused HERE, at the schema, rather than being
 * half-accepted and then failing on save with a Mongoose error the admin
 * cannot act on.
 */
import { z } from 'zod';
import { PIN_ROLES } from '../constants/enums.js';
import { PIN_LENGTH } from '../models/User.js';
import { toMinor } from '../utils/money.js';

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
export const idParamSchema = z.object({ id: objectId }).strict();

/** YYYY-MM-DD, and a real date — '2026-02-31' parses but is not a day. */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Not a real date');

const name = z.string().trim().min(2, 'Name is too short').max(80, 'Name is too long');

/** Same permissive-format / strict-content rule as the customer phone. */
const phone = z
  .string()
  .trim()
  .max(24, 'Phone number is too long')
  .refine((v) => v === '' || /^[+]?[\d\s()-]+$/.test(v), {
    message: 'Phone number may contain only digits, spaces and + ( ) -',
  });

const employmentNotes = z.string().trim().max(500, 'Notes are too long');

/**
 * The login PIN. Exactly PIN_LENGTH digits, imported from the model rather
 * than hardcoded so the two cannot disagree about what a valid PIN looks like.
 *
 * Leading zeros matter, so this is a string throughout — `0042` as a number is
 * 42, which is a three-digit PIN nobody typed.
 */
const pin = z
  .string()
  .regex(new RegExp(`^\\d{${PIN_LENGTH}}$`), `PIN must be exactly ${PIN_LENGTH} digits`);

const role = z.enum([...PIN_ROLES], {
  errorMap: () => ({ message: 'Role must be cashier or kitchen_staff' }),
});

/**
 * Monthly salary in MAJOR units, converted at the boundary — the same rule the
 * menu and expenses use. Renamed to `monthlySalaryMinor` on the way through so
 * nothing downstream has to remember which unit it is holding.
 *
 * Zero is allowed here, unlike an expense amount: an unpaid trainee or a
 * salary that has not been agreed yet is a real state, and refusing it would
 * force the admin to invent a number.
 */
const salaryMajor = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const text = String(v).trim();
  if (text === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Salary must be a number with at most 2 decimal places',
    });
    return z.NEVER;
  }
  const n = Number(text);
  if (n > 10_000_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Salary is implausibly large' });
    return z.NEVER;
  }
  return toMinor(n);
});

export const createEmployeeSchema = z
  .object({
    name,
    role,
    pin,
    phone: phone.optional().default(''),
    joinedOn: isoDay.optional(),
    monthlySalary: salaryMajor.optional().default(0),
    employmentNotes: employmentNotes.optional().default(''),
  })
  .strict()
  .transform(({ monthlySalary, ...rest }) => ({ ...rest, monthlySalaryMinor: monthlySalary }));

/**
 * Edit. `pin` is deliberately absent — changing a credential is its own
 * endpoint (PATCH /:id/pin) so that it is audited as a credential change and
 * cannot ride along inside an innocuous-looking name edit.
 */
export const updateEmployeeSchema = z
  .object({
    name: name.optional(),
    role: role.optional(),
    phone: phone.optional(),
    joinedOn: isoDay.optional(),
    monthlySalary: salaryMajor.optional(),
    employmentNotes: employmentNotes.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' })
  .transform(({ monthlySalary, ...rest }) =>
    monthlySalary === undefined ? rest : { ...rest, monthlySalaryMinor: monthlySalary },
  );

export const setPinSchema = z.object({ pin }).strict();

export const setActiveSchema = z.object({ isActive: z.boolean() }).strict();

export const listEmployeesSchema = z
  .object({
    role: role.optional(),
    /** Deactivated staff are hidden by default — the roster is a working list. */
    includeInactive: z.enum(['true', 'false']).optional(),
    search: z.string().trim().max(80, 'Search term is too long').optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    skip: z.coerce.number().int().min(0).max(10_000).optional().default(0),
  })
  .strict();

export default {
  createEmployeeSchema,
  updateEmployeeSchema,
  setPinSchema,
  setActiveSchema,
  listEmployeesSchema,
  idParamSchema,
};
