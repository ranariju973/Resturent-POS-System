/**
 * Menu category — 'Beverages', 'Salads', 'Pizza'.
 *
 * Deletion is soft (isActive: false). Menu items reference categories, and a
 * hard delete would either orphan them or force a cascade that silently
 * removes products from the POS grid mid-service.
 */
import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      minlength: 2,
      maxlength: 40,
    },

    // Drives the pill colour in the billing grid.
    color: {
      type: String,
      required: true,
      trim: true,
      match: [/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex value like #00754A'],
      default: '#00754A',
    },

    sortOrder: { type: Number, default: 0 },

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

categorySchema.virtual('id').get(function idGetter() {
  return this._id?.toHexString?.() ?? this._id;
});

// Case-insensitive uniqueness among live categories only, so a name freed by
// a soft delete can be reused, and 'pizza' cannot be added alongside 'Pizza'.
categorySchema.index(
  { name: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    collation: { locale: 'en', strength: 2 },
  },
);

categorySchema.index({ sortOrder: 1, name: 1 });

export const Category = mongoose.model('Category', categorySchema);
export default Category;
