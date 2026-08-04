/**
 * Schema validation middleware.
 *
 * This is the allow-list layer: a request reaches a controller only if every
 * field it carries was declared in a schema. Anything undeclared is a hard
 * 400, not a silent strip — see below.
 *
 * Validated values are written back onto the request, so controllers work
 * with parsed, coerced, trimmed data rather than raw strings.
 */
import { ZodError } from 'zod';
import { ApiError } from '../utils/apiResponse.js';

const TARGETS = ['body', 'query', 'params'];

function toDetails(err) {
  return err.issues.map((i) => ({
    field: i.path.join('.') || '(root)',
    message: i.message,
  }));
}

/**
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny}} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      for (const target of TARGETS) {
        const schema = schemas[target];
        if (!schema) continue;

        const result = schema.parse(req[target] ?? {});

        // req.query and req.params are getter-only on some Express versions,
        // so assign properties rather than replacing the object.
        if (target === 'body') {
          req.body = result;
        } else {
          for (const key of Object.keys(req[target])) delete req[target][key];
          Object.assign(req[target], result);
        }
      }
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(ApiError.badRequest('Validation failed', {
          code: 'VALIDATION_ERROR',
          details: toDetails(err),
          cause: err,
        }));
      }
      return next(err);
    }
  };
}

export default validate;

/**
 * ── A note on .strict(), used by every schema in src/validators ────────────
 *
 * Zod strips unknown keys by default. Every schema here calls `.strict()`
 * instead, which rejects them.
 *
 * Stripping is the friendlier default and the wrong one for an API. If a
 * cashier's client sends `{available: false, priceMinor: 1}` to the
 * stock-toggle endpoint, silently dropping `priceMinor` means the request
 * succeeds and nobody ever learns the attempt was made. Rejecting turns a
 * privilege-escalation probe into a 400 and a log line.
 */
