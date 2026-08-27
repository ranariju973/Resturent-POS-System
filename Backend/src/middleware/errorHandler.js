/**
 * 404 + centralised error handling.
 *
 * Two rules drive everything here:
 *   1. Clients get a generic message and a request id. Never a stack trace,
 *      never a raw driver/Mongoose error, never an internal path.
 *   2. The server logs the full detail, once, with the same request id.
 */
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { ApiError } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/** Unknown route — JSON, not Express's default HTML page. */
export function notFoundHandler(req, res, next) {
  next(new ApiError(404, 'Resource not found'));
}

/** Translate known error shapes into a client-safe ApiError. */
function normalize(err) {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return new ApiError(400, 'Validation failed', {
      code: 'VALIDATION_ERROR',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      cause: err,
    });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return new ApiError(400, 'Validation failed', {
      code: 'VALIDATION_ERROR',
      details: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
      cause: err,
    });
  }

  // Bad ObjectId etc. — a client-side mistake, not a server fault.
  if (err instanceof mongoose.Error.CastError) {
    return new ApiError(400, `Invalid value for "${err.path}"`, {
      code: 'INVALID_ID',
      cause: err,
    });
  }

  // Duplicate key. The offending field name is safe to name; the value is not
  // (it may be an email or phone number belonging to someone else).
  if (err?.code === 11000) {
    const keys = Object.keys(err.keyPattern || err.keyValue || {});

    /*
     * Compound indexes need naming by hand.
     *
     * Taking keys[0] is right for a single-field index and actively misleading
     * for a compound one. Every index in this codebase is tenant-first (see
     * models/plugins/tenantScoped.js), so keys[0] is usually `tenantId` — and
     * on the menu's {tenantId, category, name} index it reported "A record
     * with that category already exists" when what the admin actually did was
     * reuse an item NAME within a category.
     *
     * tenantId is dropped unconditionally: it is never something the client
     * chose, so it can never be the field they need to change.
     */
    const meaningful = keys.filter((k) => k !== 'tenantId');

    if (meaningful.includes('category') && meaningful.includes('name')) {
      return new ApiError(409, 'An item with that name already exists in this category', {
        code: 'DUPLICATE_KEY',
        cause: err,
      });
    }

    const field = meaningful[0] || keys[0] || 'field';
    return new ApiError(409, `A record with that ${field} already exists`, {
      code: 'DUPLICATE_KEY',
      cause: err,
    });
  }

  // Malformed JSON from body-parser.
  if (err?.type === 'entity.parse.failed') {
    return new ApiError(400, 'Malformed JSON body', { code: 'MALFORMED_JSON', cause: err });
  }

  if (err?.type === 'entity.too.large') {
    return new ApiError(413, 'Payload too large', { code: 'PAYLOAD_TOO_LARGE', cause: err });
  }

  if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
    // Deliberately uniform: do not tell an attacker whether a token was
    // expired, malformed, or signed with the wrong key.
    return new ApiError(401, 'Authentication required', { code: 'INVALID_TOKEN', cause: err });
  }

  if (err?.name === 'MongoNetworkError' || err?.name === 'MongooseServerSelectionError') {
    return new ApiError(503, 'Service temporarily unavailable', {
      code: 'DB_UNAVAILABLE',
      cause: err,
    });
  }

  /**
   * Last resort before 500: honour an explicit 4xx `status` on a plain Error.
   *
   * Middleware that throws `Object.assign(new Error(msg), { status: 400 })`
   * instead of an ApiError would otherwise be reported as a server fault —
   * the client sees "Something went wrong" for what was actually their bad
   * input, and the log records it as a bug on our side. Only 4xx is honoured;
   * a hand-set 5xx is still treated as a genuine fault.
   *
   * ApiError remains the right thing to throw. This just keeps the mistake
   * from being silent.
   */
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) {
    return new ApiError(err.status, err.message || 'Invalid request', {
      code: err.code,
      cause: err,
    });
  }

  return new ApiError(500, 'Something went wrong', { cause: err });
}

// The four-argument signature is load-bearing: Express decides what is an
// error handler by reading fn.length, so dropping an unused parameter here
// would silently demote this to ordinary middleware and every error would fall
// through to the default handler instead.
export function errorHandler(err, req, res, next) {
  const apiError = normalize(err);
  const original = apiError.cause || err;
  const isServerFault = apiError.status >= 500;

  const logPayload = {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    status: apiError.status,
    userId: req.user?.id,
    ip: req.ip,
    message: original?.message,
    stack: original?.stack,
  };

  if (isServerFault) logger.error('Unhandled request error', logPayload);
  else logger.warn('Request rejected', logPayload);

  if (res.headersSent) return next(err);

  const body = {
    success: false,
    error: {
      message: apiError.message,
      ...(apiError.code && { code: apiError.code }),
      ...(apiError.details && { details: apiError.details }),
    },
    requestId: req.id,
  };

  // Stack traces in development only — never in production responses.
  if (!env.isProd && isServerFault && original?.stack) {
    body.error.stack = original.stack.split('\n');
  }

  return res.status(apiError.status).json(body);
}

export default errorHandler;
