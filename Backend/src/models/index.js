/**
 * Model registry.
 *
 * Importing this file registers every schema with Mongoose, which matters for
 * `populate()` — a ref to a model that was never imported fails at runtime
 * with "Schema hasn't been registered". Import this once at boot and the
 * problem cannot happen.
 */
export { Tenant, slugify } from './Tenant.js';
export { User } from './User.js';
export { Device, mintDeviceToken, hashDeviceToken } from './Device.js';
export { RefreshToken, hashToken } from './RefreshToken.js';
export { Category } from './Category.js';
export { MenuItem } from './MenuItem.js';
export { Table } from './Table.js';
export { Order } from './Order.js';
export { Ticket } from './Ticket.js';
export { Customer } from './Customer.js';
export { Expense } from './Expense.js';
export { Attendance } from './Attendance.js';
export { Payroll } from './Payroll.js';
export { PrinterSettings } from './PrinterSettings.js';
export { AuditLog } from './AuditLog.js';
export { Counter, nextSequence, serviceDayKey } from './Counter.js';
