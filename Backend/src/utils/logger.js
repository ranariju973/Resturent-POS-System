/**
 * Structured logger.
 *
 * The redaction format below is the single place that guarantees credentials
 * and PII never reach a log file. Add to SENSITIVE_KEYS rather than trusting
 * call sites to remember what is safe to pass.
 */
import winston from 'winston';
import { env } from '../config/env.js';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'pin',
  'adminoverride',
  'adminoverridepin',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'secret',
  'apikey',
  'api_key',
  // PII — customer records carry these and they should not sit in log storage.
  'phone',
  'email',
]);

const REDACTED = '[REDACTED]';

function redact(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, seen));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, seen);
  }
  return out;
}

const redactFormat = winston.format((info) => {
  const { level, message, timestamp, stack, ...meta } = info;
  return { level, message, timestamp, stack, ...redact(meta) };
});

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  redactFormat(),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level} ${stack || message}${extra}`;
  }),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  redactFormat(),
  winston.format.json(),
);

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: env.isProd ? prodFormat : devFormat,
  transports: [new winston.transports.Console({ handleExceptions: true })],
  exitOnError: false,
  silent: env.isTest,
});

/** Stream adapter so morgan writes through winston instead of straight to stdout. */
export const httpLogStream = {
  write: (line) => logger.http?.(line.trim()) ?? logger.info(line.trim()),
};

export default logger;
