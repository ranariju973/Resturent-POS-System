/**
 * Kitchen ticket — the kitchen's view of an Order.
 *
 * Separate from Order because the two have different lifecycles and different
 * audiences: an order is settled and paid at the counter, a ticket moves
 * pending -> preparing -> ready -> served on the line. Kitchen staff can
 * advance a ticket without holding any permission over the bill.
 *
 * `statusHistory` records every transition with actor and timestamp. It is
 * append-only and doubles as prep-time data (how long between pending and
 * ready) for later reporting.
 */
import mongoose from 'mongoose';
import { tenantScoped } from './plugins/tenantScoped.js';
import {
  TICKET_STATUS,
  TICKET_STATUS_VALUES,
  ORDER_TYPE_VALUES,
  NEXT_TICKET_STATUS,
} from '../constants/enums.js';

const statusEntrySchema = new mongoose.Schema(
  {
    status: { type: String, required: true, enum: TICKET_STATUS_VALUES },
    at: { type: Date, required: true, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** True when this entry came from a backward correction, not normal flow. */
    recalled: { type: Boolean, default: false },
  },
  { _id: false },
);

const ticketSchema = new mongoose.Schema(
  {
    /*
     * Exactly one ticket per order. The uniqueness is declared through the
     * tenantScoped plugin as {tenantId, order} rather than inline — see the
     * index block below.
     */
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },

    /** Display number, mirrors the order's daily sequence. */
    no: { type: Number, required: true, index: true },

    /** Human label on the board — 'Table T3', 'Takeaway', 'Delivery'. */
    source: { type: String, required: true, trim: true, maxlength: 40 },

    type: {
      type: String,
      required: true,
      enum: { values: ORDER_TYPE_VALUES, message: '{VALUE} is not a valid order type' },
    },

    status: {
      type: String,
      required: true,
      enum: { values: TICKET_STATUS_VALUES, message: '{VALUE} is not a valid ticket status' },
      default: TICKET_STATUS.PENDING,
      index: true,
    },

    placedAt: { type: Date, required: true, default: Date.now, index: true },

    /** Stamped when the ticket first reaches 'ready' — prep duration endpoint. */
    readyAt: { type: Date, default: null },

    statusHistory: { type: [statusEntrySchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

ticketSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

/** Minutes on the board — drives the time-based urgency accents. */
ticketSchema.virtual('waitingMinutes').get(function waitingMinutes() {
  const end = this.readyAt?.getTime() ?? Date.now();
  return Math.floor((end - this.placedAt.getTime()) / 60000);
});

/** The one status this ticket may move to next. Null once served. */
ticketSchema.virtual('nextStatus').get(function nextStatus() {
  return NEXT_TICKET_STATUS[this.status] ?? null;
});

/*
 * One ticket per order, enforced by the database.
 *
 * Declared here rather than inline on the field so the key is {tenantId,
 * order}. An order id is a globally unique ObjectId, so this particular
 * constraint would still have been correct as a global index — it is scoped
 * anyway so that the index is usable by the tenant filter the plugin injects
 * into every query, instead of being a second lookup path the planner has to
 * choose between.
 */
ticketSchema.plugin(tenantScoped, {
  unique: [{ fields: { order: 1 } }],
});

// The kitchen board query: everything not yet served, oldest first.
ticketSchema.index({ tenantId: 1, status: 1, placedAt: 1 });
ticketSchema.index({ tenantId: 1, placedAt: -1 });
/**
 * The board also keeps recently-served tickets visible for a grace period —
 * getBoard's $or has a { status: SERVED, updatedAt: { $gte } } branch. Served
 * tickets are the ones that accumulate, so without this index that branch
 * degrades toward a full scan a little more with every service.
 */
ticketSchema.index({ tenantId: 1, status: 1, updatedAt: -1 });

/** Seed the history with the opening status. */
ticketSchema.pre('save', function seedHistory(next) {
  if (this.isNew && this.statusHistory.length === 0) {
    this.statusHistory.push({ status: this.status, at: this.placedAt ?? new Date(), by: null });
  }
  next();
});

/**
 * Move the ticket exactly one step forward and record who did it.
 *
 * Takes no target status by design — the destination is derived from the
 * STORED current status via NEXT_TICKET_STATUS, so a client cannot skip a
 * stage or walk a ticket backwards regardless of what it sends.
 *
 * @param {mongoose.Types.ObjectId|string|null} userId
 * @returns {this}
 * @throws if the ticket is already served
 */
ticketSchema.methods.advance = function advance(userId = null) {
  const next = NEXT_TICKET_STATUS[this.status];
  if (!next) throw new Error(`Ticket is already ${this.status} and cannot advance further`);

  this.status = next;
  this.statusHistory.push({ status: next, at: new Date(), by: userId });

  if (next === TICKET_STATUS.READY && !this.readyAt) this.readyAt = new Date();

  return this;
};

/**
 * Move the ticket one step BACKWARD. Admin only — enforced at the route.
 *
 * A kitchen is a place where people tap the wrong card with wet hands, and a
 * board that cannot be corrected is a board staff stop trusting. So this
 * exists — but it is deliberately not the mirror of `advance()`:
 *
 *   • `advance()` is available to every role, because it is the normal work.
 *   • `recall()` is admin-only, because moving a ticket backwards rewrites
 *     what the line believes about an order that may already be plated.
 *
 * `statusHistory` stays APPEND-ONLY either way. The mis-tap and its correction
 * both remain visible, so prep-time reporting can still see what happened
 * rather than a tidied-up version of it.
 *
 * @param {mongoose.Types.ObjectId|string|null} userId
 * @returns {this}
 * @throws if the ticket is already pending
 */
ticketSchema.methods.recall = function recall(userId = null) {
  const order = TICKET_STATUS_VALUES;
  const currentIndex = order.indexOf(this.status);

  if (currentIndex <= 0) {
    throw new Error('Ticket is already at the first stage and cannot be recalled');
  }

  const previous = order[currentIndex - 1];
  this.status = previous;
  this.statusHistory.push({ status: previous, at: new Date(), by: userId, recalled: true });

  // Clearing readyAt matters: `waitingMinutes` is measured to it, and leaving a
  // stale value would report a prep time that never happened.
  if (previous !== TICKET_STATUS.READY && previous !== TICKET_STATUS.SERVED) {
    this.readyAt = null;
  }

  return this;
};

/** Active board contents — everything except served. */
ticketSchema.statics.findActive = function findActive(filter = {}) {
  // trusted() because `sanitizeFilter` is on globally — see src/config/db.js.
  return this.find({
    ...filter,
    status: mongoose.trusted({ $ne: TICKET_STATUS.SERVED }),
  }).sort({ placedAt: 1 });
};

export const Ticket = mongoose.model('Ticket', ticketSchema);
export default Ticket;
