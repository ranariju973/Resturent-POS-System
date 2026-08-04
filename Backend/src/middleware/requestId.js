/**
 * Attaches a request id to every request and echoes it as X-Request-Id.
 *
 * This is what makes the generic production error body useful: the client
 * gets an id, the full stack trace stays server-side, and the two are
 * correlated in the logs.
 */
import { randomUUID } from 'node:crypto';

export function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  // Only trust an inbound id if it looks like an id — otherwise a client
  // could inject newlines or huge strings into every log line it touches.
  const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();

  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export default requestId;
