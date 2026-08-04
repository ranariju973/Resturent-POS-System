/**
 * Uniform response envelope + the error type routes should throw.
 *
 * Every handler returning through these helpers means the client sees one
 * shape, and the error handler has a reliable way to tell an intentional
 * 4xx from an unexpected crash.
 */

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message Client-safe message — assume the user reads it
   * @param {object} [options]
   * @param {Array} [options.details] Field-level validation details
   * @param {string} [options.code] Stable machine-readable code
   * @param {Error} [options.cause] Original error, logged but never sent
   */
  constructor(status, message, { details, code, cause } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.code = code;
    this.cause = cause;
    // Marks this as deliberate, so the handler does not treat it as a bug.
    this.expected = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(msg = 'Invalid request', opts) {
    return new ApiError(400, msg, opts);
  }
  static unauthorized(msg = 'Authentication required', opts) {
    return new ApiError(401, msg, opts);
  }
  static forbidden(msg = 'Insufficient permissions', opts) {
    return new ApiError(403, msg, opts);
  }
  static notFound(msg = 'Resource not found', opts) {
    return new ApiError(404, msg, opts);
  }
  static conflict(msg = 'Conflicting state', opts) {
    return new ApiError(409, msg, opts);
  }
  static payloadTooLarge(msg = 'Payload too large', opts) {
    return new ApiError(413, msg, opts);
  }
  static tooManyRequests(msg = 'Too many requests', opts) {
    return new ApiError(429, msg, opts);
  }
  static internal(msg = 'Something went wrong', opts) {
    return new ApiError(500, msg, opts);
  }
}

/** Success envelope: { success: true, data, meta? } */
export function sendSuccess(res, data, { status = 200, meta } = {}) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 * Express 4 does not forward async rejections on its own.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default { ApiError, sendSuccess, asyncHandler };
