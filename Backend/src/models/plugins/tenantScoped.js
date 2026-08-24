/**
 * Confines a model to one restaurant.
 *
 * Applying this plugin does four things:
 *
 *   1. Adds a required `tenantId` to the schema.
 *   2. Stamps it on every write from the ambient tenant context.
 *   3. Filters every read, update, delete and aggregation by it.
 *   4. Keeps it out of `toJSON`, so it never reaches a client.
 *
 * ── Why the filtering lives here ───────────────────────────────────────────
 * The alternative is `tenantId: req.tenantId` written by hand in every
 * controller query. That approach fails open — a forgotten filter silently
 * serves another restaurant's data and looks like a working page — and there
 * is no mechanical way to prove it was never forgotten. Here the guarantee is
 * structural: a query cannot run unfiltered, because the code that would have
 * to remember is not the code doing the filtering.
 *
 * The cost is that this is implicit behaviour, which is a real cost. It is
 * bounded deliberately: one file, a fixed list of hooks, and a loud failure
 * (a thrown TenantContextMissing) whenever the context is absent. Nothing
 * here ever falls back to "all tenants".
 *
 * ── What this does NOT cover ───────────────────────────────────────────────
 * `Model.bulkWrite()` gets no query middleware from Mongoose, so its filters
 * must carry `tenantId` by hand. tests/tenant-coverage.test.mjs asserts that
 * every bulkWrite call site does.
 *
 * `populate()` follows an ObjectId that a tenant-filtered query already
 * returned, so it inherits that trust rather than re-checking. Reachability
 * from a document we scoped IS the check.
 */
import mongoose from 'mongoose';
import { getTenantId, isUnscoped, TenantContextMissing } from '../../utils/tenantContext.js';

/**
 * Query methods that must be tenant-filtered.
 *
 * Named explicitly rather than matched with /^find/ so that adding a hook is a
 * deliberate edit. A regex would silently start covering — or silently stop
 * covering — methods as Mongoose's surface changes between versions.
 */
const SCOPED_QUERIES = [
  'count',
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
];

/**
 * @param {import('mongoose').Schema} schema
 * @param {object} [options]
 * @param {boolean} [options.required=true]  Whether a document must have a tenant.
 *   Relaxed only for User, whose rows exist briefly before onboarding assigns
 *   one — see the note in models/User.js.
 * @param {Array<{fields: object, options?: object}>} [options.unique=[]]
 *   Unique indexes to declare tenant-first. A bare `unique: true` on a field
 *   would be global, which is the exact bug this plugin exists to prevent:
 *   restaurant A taking a staff PIN would stop restaurant B from using it.
 */
export function tenantScoped(schema, { required = true, unique = [] } = {}) {
  /*
   * A unique index on tenantId ALONE — the "one document per restaurant" case,
   * used by PrinterSettings — is the same key as a plain lookup index would
   * be. Declaring both makes Mongoose warn about a duplicate and leaves
   * MongoDB holding two indexes to do one job, so in that case the unique
   * index declared below is the only one, and it serves both purposes.
   */
  const uniqueOnTenantAlone = unique.some(({ fields }) => Object.keys(fields).length === 0);

  schema.add({
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required,
      index: !uniqueOnTenantAlone,
    },
  });

  // --- keep tenantId off the wire ------------------------------------------
  /*
   * Composed with whatever transform the model already declared, not
   * substituted for it. Every model in this project defines its own to strip
   * __v and _id; replacing that would quietly start leaking those instead.
   */
  const existing = schema.get('toJSON') ?? {};
  const inherited = existing.transform;
  schema.set('toJSON', {
    ...existing,
    virtuals: existing.virtuals ?? true,
    transform(doc, ret, options) {
      const out = inherited ? inherited(doc, ret, options) : ret;
      if (out && typeof out === 'object') delete out.tenantId;
      return out;
    },
  });

  // --- writes ---------------------------------------------------------------
  /*
   * Stamped on validate rather than save so the value is present before any
   * `required` check runs, and so `validateSync()` behaves the same as a save.
   */
  schema.pre('validate', function stampTenant(next) {
    if (isUnscoped()) return next();

    const context = getTenantId();
    if (!context) {
      // A model whose tenant is optional may legitimately be written with none
      // — a User created by Google sign-in, before onboarding picks a
      // restaurant. A required one has no such state.
      if (!required) return next();
      return next(new TenantContextMissing(`${this.constructor.modelName} write`));
    }

    /*
     * A document arriving with a DIFFERENT tenant than the context is refused
     * rather than corrected. Silently rewriting it would turn "this code has a
     * bug" into "this document moved restaurants", which is worse and much
     * harder to notice.
     */
    if (this.tenantId && String(this.tenantId) !== String(context)) {
      return next(new Error(
        `Refusing to write a ${this.constructor.modelName} belonging to another restaurant`,
      ));
    }

    this.tenantId = context;
    return next();
  });

  schema.pre('insertMany', function stampMany(next, docs) {
    if (isUnscoped()) return next();

    const context = getTenantId();
    if (!context) {
      if (!required) return next();
      return next(new TenantContextMissing(`${this.modelName} insertMany`));
    }

    for (const doc of Array.isArray(docs) ? docs : [docs]) {
      if (doc.tenantId && String(doc.tenantId) !== String(context)) {
        return next(new Error(
          `Refusing to write a ${this.modelName} belonging to another restaurant`,
        ));
      }
      doc.tenantId = context;
    }
    return next();
  });

  // --- reads and query-level writes ----------------------------------------
  schema.pre(SCOPED_QUERIES, function scopeQuery(next) {
    if (isUnscoped()) return next();

    const context = getTenantId();
    if (!context) {
      return next(new TenantContextMissing(`${this.model.modelName} query`));
    }

    /*
     * `where()` rather than mutating the filter object directly.
     *
     * It merges the condition on top of whatever the caller built, so a
     * controller that also passes a tenantId cannot widen the scope, and a
     * top-level $or stays correctly ANDed with the tenant clause instead of
     * being sat beside it.
     *
     * A plain ObjectId is a scalar, so `sanitizeFilter` (enabled globally in
     * config/db.js) leaves it alone — this is why tenantId is an ObjectId and
     * not something like a { $in: [...] }, which would need mongoose.trusted().
     */
    this.where({ tenantId: context });

    /*
     * An upsert that ends up INSERTING must carry the tenant too. The filter
     * above only constrains the match; without this the new document would be
     * written with no tenantId and fail its own required check — or worse, on
     * an optional-tenant model, succeed and belong to nobody.
     */
    if (this.getOptions?.().upsert) {
      const update = this.getUpdate() ?? {};
      if (!Array.isArray(update)) {
        this.setUpdate({
          ...update,
          $setOnInsert: { ...(update.$setOnInsert ?? {}), tenantId: context },
        });
      }
    }

    return next();
  });

  schema.pre('aggregate', function scopeAggregate(next) {
    if (isUnscoped()) return next();

    const context = getTenantId();
    if (!context) {
      return next(new TenantContextMissing(`${this.model().modelName} aggregate`));
    }

    const pipeline = this.pipeline();
    const first = pipeline[0];

    /*
     * $geoNear and $search must be the first stage of a pipeline, so a $match
     * cannot be placed above them. Neither is used in this codebase; the check
     * exists so that the day one is added, it fails loudly here instead of
     * running unfiltered across every restaurant.
     */
    if (first && ('$geoNear' in first || '$search' in first)) {
      return next(new Error(
        'A $geoNear/$search pipeline cannot be tenant-scoped by a prepended $match. '
          + 'Put the tenant filter inside the stage itself.',
      ));
    }

    pipeline.unshift({ $match: { tenantId: context } });
    return next();
  });

  // --- unique indexes, tenant-first ----------------------------------------
  /*
   * Prefixed with tenantId so uniqueness is per-restaurant. The prefix also
   * makes each index usable by the filter this plugin injects, which a
   * suffixed one would not be.
   *
   * ── Why `sparse` is translated into `partialFilterExpression` ────────────
   * This is a trap worth spelling out, because it produced a bug that let
   * exactly ONE person sign up with Google and then refused everybody else.
   *
   * On a COMPOUND index, `sparse: true` skips a document only when EVERY
   * indexed field is absent. Once tenantId is prepended, that condition can
   * essentially never hold — tenantId is always present — so `sparse` stops
   * doing anything at all. Worse, an explicit `null` counts as a value: two
   * accounts with `{tenantId: null, pinLookup: null}` are a duplicate key,
   * even though neither has a PIN.
   *
   * A partial index says what was actually meant: index a document only when
   * the field genuinely exists. Two admins with no PIN are then not in the
   * index at all, and cannot collide.
   */
  for (const { fields, options = {} } of unique) {
    const { sparse, ...rest } = options;
    const indexOptions = { ...rest, unique: true };

    if (sparse) {
      const names = Object.keys(fields);
      if (names.length !== 1) {
        throw new Error(
          'tenantScoped: sparse is only translated for a single-field unique index. '
            + `Got {${names.join(', ')}} — write an explicit partialFilterExpression instead.`,
        );
      }

      /*
       * Merged, not replaced: Category and MenuItem already pass a
       * partialFilterExpression of their own ({isActive: true}), and silently
       * dropping it would make a soft-deleted row keep its name reserved.
       */
      indexOptions.partialFilterExpression = {
        ...(rest.partialFilterExpression ?? {}),
        [names[0]]: { $type: 'string' },
      };
    }

    schema.index({ tenantId: 1, ...fields }, indexOptions);
  }
}

export default tenantScoped;
