/**
 * NoSQL injection defence.
 *
 * ── The attack ─────────────────────────────────────────────────────────────
 * MongoDB queries are objects, so a JSON body is one decode away from being a
 * query. Post this to a login route:
 *
 *   { "email": { "$ne": null }, "password": { "$ne": null } }
 *
 * and a naive `User.findOne(req.body)` matches the first user in the
 * collection. No quotes to escape, no SQL — just a key starting with `$`.
 * A dotted key like `"user.role"` is the same trick against nested paths.
 *
 * ── Three layers, and why none of them is redundant ────────────────────────
 *   1. THIS middleware strips `$`-prefixed and dotted keys from body, query
 *      and params before any handler sees them. Broadest reach, no schema
 *      required, protects routes added later by someone who forgets the rest.
 *   2. Zod `.strict()` schemas (src/validators) reject unknown keys outright,
 *      so `$ne` on a validated route is a 400 rather than a silent strip.
 *      Narrower, but louder, and it catches typos too.
 *   3. Mongoose `sanitizeFilter` (src/config/db.js) neutralises operators that
 *      reach a query filter anyway. Last line, closest to the database.
 *
 * Layer 2 only covers routes with a schema. Layer 3 only covers filters, not
 * update payloads. Layer 1 covers everything and knows nothing. Keep all three.
 */
import mongoSanitize from 'express-mongo-sanitize';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/apiResponse.js';

/**
 * Strip Mongo operators from user input.
 *
 * Keys are REMOVED rather than replaced. `replaceWith: '_'` is the other
 * common option and it is worse here: it silently turns `$ne` into `_ne`, an
 * ordinary-looking field that then fails a strict schema for a confusing
 * reason. Removal leaves the request looking like what it should have been.
 *
 * Every strip is logged with the key and the caller. This is not noise — a
 * legitimate client never sends `$gt` as a field name, so a hit here is
 * someone probing, and it is worth knowing which endpoint they chose.
 */
export const sanitizeRequest = mongoSanitize({
  onSanitize: ({ req, key }) => {
    logger.warn('Blocked Mongo operator in request input', {
      requestId: req.id,
      userId: req.user?.id,
      key,
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
    });
  },
});

/**
 * Reject absurd query strings before anything tries to parse them.
 *
 * Express caps neither the number of query parameters nor the depth of nested
 * ones by default. A URL carrying thousands of keys costs CPU in the parser
 * on an endpoint that has not authenticated anyone yet.
 */
export function limitQueryComplexity({ maxKeys = 32 } = {}) {
  return (req, _res, next) => {
    const keys = Object.keys(req.query ?? {});
    if (keys.length > maxKeys) {
      logger.warn('Rejected request with an oversized query string', {
        requestId: req.id,
        count: keys.length,
        path: req.path,
        ip: req.ip,
      });
      return next(ApiError.badRequest('Too many query parameters'));
    }
    return next();
  };
}

export default sanitizeRequest;
