/**
 * Bulk data purge — admin only.
 *
 * Each handler deletes ALL documents in its data category for the current
 * restaurant. Cloudinary assets attached to those documents (menu items)
 * are destroyed alongside them.
 *
 * ── Why deleteMany rather than iterating ────────────────────────────────
 * An item-by-item loop would fire N audit entries, N Cloudinary calls and
 * N database writes for what is logically one operation. deleteMany is one
 * write, the Cloudinary calls are batched, and the audit entry is one row
 * carrying the count.
 */
import mongoose from 'mongoose';
import { withTransaction } from '../utils/transaction.js';
import { invalidateStats } from '../utils/statsCache.js';
import { emitEvent, EVENTS } from '../utils/eventBus.js';
import { MenuItem } from '../models/MenuItem.js';
import { Category } from '../models/Category.js';
import { Table } from '../models/Table.js';
import { Ticket } from '../models/Ticket.js';
import { Customer } from '../models/Customer.js';
import { Order } from '../models/Order.js';
import { Expense } from '../models/Expense.js';
import { Counter } from '../models/Counter.js';
import { Attendance } from '../models/Attendance.js';
import { Payroll } from '../models/Payroll.js';
import { AuditLog } from '../models/AuditLog.js';
import { AUDIT_ACTION } from '../constants/enums.js';
import { deleteImage } from '../config/cloudinary.js';
import { ApiError, sendSuccess, asyncHandler } from '../utils/apiResponse.js';
import { invalidateMenu } from '../utils/menuCache.js';
import { logger } from '../utils/logger.js';

/**
 * Destroy Cloudinary assets in parallel, capped to avoid overwhelming
 * the API. Failures are logged, not thrown — a leaked image is recoverable,
 * a failed purge that rolled back is not.
 */
async function destroyImages(publicIds, req) {
  const BATCH = 10;
  let destroyed = 0;
  for (let i = 0; i < publicIds.length; i += BATCH) {
    const batch = publicIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((id) => deleteImage(id)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') destroyed += 1;
      else {
        logger.error('Cloudinary asset cleanup failed during purge', {
          requestId: req.id,
          message: r.reason?.message,
        });
      }
    }
  }
  return destroyed;
}

// ── 1. Menu Management ──────────────────────────────────────────────────
export const purgeMenu = asyncHandler(async (req, res) => {
  // Collect Cloudinary ids BEFORE deleting the rows that hold them.
  const items = await MenuItem.find({}).select('+imagePublicId').lean();
  const publicIds = items
    .map((i) => i.imagePublicId)
    .filter(Boolean);

  const itemResult  = await MenuItem.deleteMany({});
  const catResult   = await Category.deleteMany({});

  const cloudDestroyed = await destroyImages(publicIds, req);

  await AuditLog.record(
    {
      action: AUDIT_ACTION.DATA_PURGE,
      resource: 'MenuManagement',
      meta: {
        itemsDeleted: itemResult.deletedCount,
        categoriesDeleted: catResult.deletedCount,
        cloudinaryDestroyed: cloudDestroyed,
        cloudinaryTotal: publicIds.length,
      },
    },
    req,
  );

  await invalidateMenu();

  return sendSuccess(res, {
    purged: true,
    category: 'menu',
    counts: {
      items: itemResult.deletedCount,
      categories: catResult.deletedCount,
      images: cloudDestroyed,
    },
  });
});

// ── 2. Table Management ─────────────────────────────────────────────────
export const purgeTables = asyncHandler(async (req, res) => {
  const result = await withTransaction(async (session) => {
    if (await Order.exists({ status: 'open', $or: [
      { table: mongoose.trusted({ $ne: null }) }, { 'tableIds.0': mongoose.trusted({ $exists: true }) },
    ] }).session(session)) throw ApiError.conflict('Settle or void every table bill before clearing tables');
    const result = await Table.deleteMany({}, { session });
    await AuditLog.record({ action: AUDIT_ACTION.DATA_PURGE, resource: 'TableManagement',
      meta: { tablesDeleted: result.deletedCount } }, req, { session });
    return result;
  }, { required: true });

  return sendSuccess(res, {
    purged: true,
    category: 'tables',
    counts: { tables: result.deletedCount },
  });
});

// ── 3. Kitchen Management ───────────────────────────────────────────────
export const purgeKitchen = asyncHandler(async (req, res) => {
  const result = await Ticket.deleteMany({});

  await AuditLog.record(
    {
      action: AUDIT_ACTION.DATA_PURGE,
      resource: 'KitchenManagement',
      meta: { ticketsDeleted: result.deletedCount },
    },
    req,
  );

  return sendSuccess(res, {
    purged: true,
    category: 'kitchen',
    counts: { tickets: result.deletedCount },
  });
});

// ── 4. Customer Data ────────────────────────────────────────────────────
export const purgeCustomers = asyncHandler(async (req, res) => {
  const result = await Customer.deleteMany({});

  await AuditLog.record(
    {
      action: AUDIT_ACTION.DATA_PURGE,
      resource: 'CustomerData',
      meta: { customersDeleted: result.deletedCount },
    },
    req,
  );

  return sendSuccess(res, {
    purged: true,
    category: 'customers',
    counts: { customers: result.deletedCount },
  });
});

// ── 5. Reports Section ──────────────────────────────────────────────────
export const purgeReports = asyncHandler(async (req, res) => {
  const counts = await withTransaction(async (session) => {
    // Financial deletion must remove its kitchen references and release unpaid groups together.
    const orders = await Order.deleteMany({}, { session });
    const tickets = await Ticket.deleteMany({}, { session });
    await Table.updateMany({ currentOrder: mongoose.trusted({ $ne: null }) }, { $set: {
      currentOrder: null, mergedInto: null, status: 'available', occupiedAt: null,
    } }, { session });
    const expenses = await Expense.deleteMany({}, { session });
    const attendance = await Attendance.deleteMany({}, { session });
    const payroll = await Payroll.deleteMany({}, { session });
    // Counter has a tenant-bearing composite key rather than the scope plugin.
    const tenantId = String(req.tenantId);
    const counters = await Counter.collection.deleteMany({
      _id: new RegExp(`:${tenantId}(:|$)`),
    }, { session });
    const counts = { orders: orders.deletedCount, tickets: tickets.deletedCount,
      expenses: expenses.deletedCount, attendance: attendance.deletedCount,
      payroll: payroll.deletedCount, counters: counters.deletedCount };
    await AuditLog.record({ action: AUDIT_ACTION.DATA_PURGE, resource: 'ReportsSection',
      meta: counts }, req, { session });
    return counts;
  }, { required: true });
  await invalidateStats();
  emitEvent(EVENTS.ORDER_VOIDED, { reason: 'reports-cleared' });
  return sendSuccess(res, { purged: true, category: 'reports', counts });
});

export default { purgeMenu, purgeTables, purgeKitchen, purgeCustomers, purgeReports };
