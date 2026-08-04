/**
 * Operating expense — feeds the Reports P&L tab.
 *
 * Admin-only data (permission `reports:view`). Nothing in the cashier or
 * kitchen surface reads this collection.
 */
import mongoose from 'mongoose';
import { EXPENSE_CATEGORY_VALUES } from '../constants/enums.js';
import { minorField } from '../utils/money.js';

const expenseSchema = new mongoose.Schema(
  {
    /** The date the cost was incurred, which is not necessarily createdAt. */
    date: { type: Date, required: [true, 'Expense date is required'], index: true },

    category: {
      type: String,
      required: true,
      enum: { values: EXPENSE_CATEGORY_VALUES, message: '{VALUE} is not a valid expense category' },
      index: true,
    },

    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      minlength: 2,
      maxlength: 200,
    },

    /** Minor units, same convention as every other money field. */
    amountMinor: minorField({ min: [1, 'Amount must be greater than zero'] }),

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    isActive: { type: Boolean, default: true, index: true },
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

expenseSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

expenseSchema.virtual('amount').get(function amountGetter() {
  return this.amountMinor / 100;
});

// The P&L query: live expenses in a date window, grouped by category.
expenseSchema.index({ isActive: 1, date: -1 });
expenseSchema.index({ category: 1, date: -1 });

export const Expense = mongoose.model('Expense', expenseSchema);
export default Expense;
