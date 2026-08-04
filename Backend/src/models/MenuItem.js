/**
 * Menu item.
 *
 * Two independent flags, often confused:
 *   available  — the stock in / sold out toggle. Cashiers and kitchen staff
 *                may flip this (permission `menu:toggle_stock`); it is the
 *                only menu field they can touch. Changes hourly.
 *   isActive   — soft delete. Admin only. Permanent-ish.
 *
 * Deletion is soft because orders reference menu items. History has to keep
 * resolving, and a removed item must not vanish from last month's report.
 * Orders additionally snapshot name and price at sale time, so a later
 * rename or reprice cannot rewrite what a customer was charged.
 */
import mongoose from 'mongoose';
import { minorField } from '../utils/money.js';

const menuItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true,
      minlength: 2,
      maxlength: 80,
    },

    /** Price in minor units — 425 means $4.25. See src/utils/money.js. */
    priceMinor: minorField({
      // A free item is almost always a mistake rather than an intent.
      min: [1, 'Price must be greater than zero'],
    }),

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Item must belong to a category'],
      index: true,
    },

    description: { type: String, trim: true, maxlength: 300, default: '' },

    imageUrl: { type: String, trim: true, maxlength: 500, default: '' },

    // Needed to delete the asset from Cloudinary when the image is replaced
    // or the item removed — without it, every upload orphans a file forever.
    imagePublicId: { type: String, trim: true, default: null, select: false },

    available: { type: Boolean, default: true, index: true },

    isActive: { type: Boolean, default: true, index: true },

    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.imagePublicId;
        delete ret.__v;
        delete ret._id;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

menuItemSchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

/**
 * Convenience for clients that want major units. Read-only — all arithmetic
 * happens on priceMinor.
 */
menuItemSchema.virtual('price').get(function priceGetter() {
  return this.priceMinor / 100;
});

// Name is unique per category among live items — 'Cold Brew' can exist in
// Beverages without blocking a differently-priced 'Cold Brew' elsewhere.
menuItemSchema.index(
  { category: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    collation: { locale: 'en', strength: 2 },
  },
);

// The POS grid query: live items in a category, in stock.
menuItemSchema.index({ isActive: 1, available: 1, category: 1 });

// Search-by-name for the menu screen.
menuItemSchema.index({ name: 'text' });

/** Soft delete. Keeps the row resolvable from historical orders. */
menuItemSchema.methods.softDelete = function softDelete() {
  this.isActive = false;
  this.available = false;
  this.deletedAt = new Date();
  return this.save();
};

/** Items a cashier should see on the billing grid. */
menuItemSchema.statics.findSellable = function findSellable(filter = {}) {
  return this.find({ ...filter, isActive: true, available: true });
};

export const MenuItem = mongoose.model('MenuItem', menuItemSchema);
export default MenuItem;
