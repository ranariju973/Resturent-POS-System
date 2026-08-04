/**
 * MongoDB connection with bounded exponential backoff.
 *
 * Mongoose buffers operations while disconnected, which turns a dead database
 * into hanging requests rather than clear errors — bufferCommands is off so
 * queries fail fast and the health check reports the truth.
 */
import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Never let a connection string with credentials reach the logs. */
function safeUri(uri) {
  try {
    const u = new URL(uri);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return '(unparseable MONGO_URI)';
  }
}

function attachConnectionListeners() {
  const c = mongoose.connection;
  c.on('connected', () => logger.info('MongoDB connected', { db: c.name }));
  c.on('disconnected', () => logger.warn('MongoDB disconnected'));
  c.on('reconnected', () => logger.info('MongoDB reconnected'));
  c.on('error', (err) => logger.error('MongoDB connection error', { message: err.message }));
}

export async function connectDB() {
  mongoose.set('strictQuery', true);
  // Defence in depth against query-operator injection: any filter value that
  // is an object of $-prefixed keys gets wrapped in $eq, so a request body
  // smuggling `{"$ne": null}` into a filter matches literally instead of
  // becoming an operator. Zod validation is the first line of defence; this is
  // the backstop for anything that slips past it.
  //
  // Consequence: server-authored operator filters must be marked with
  // mongoose.trusted({ ... }), otherwise they are wrapped too and fail to cast.
  // See User.findActiveByPin, Ticket.findActive and Customer.search.
  mongoose.set('sanitizeFilter', true);
  if (env.isDev) mongoose.set('debug', false);

  attachConnectionListeners();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await mongoose.connect(env.MONGO_URI, {
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS: 45_000,
        maxPoolSize: 20,
        minPoolSize: 2,
        bufferCommands: false,
        autoIndex: !env.isProd, // build indexes explicitly in production
      });
      return mongoose.connection;
    } catch (err) {
      const isLast = attempt === MAX_ATTEMPTS;
      logger.error('MongoDB connection attempt failed', {
        attempt,
        of: MAX_ATTEMPTS,
        uri: safeUri(env.MONGO_URI),
        message: err.message,
      });

      if (isLast) throw new Error(`Could not connect to MongoDB after ${MAX_ATTEMPTS} attempts`);

      const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      logger.warn(`Retrying MongoDB connection in ${delay}ms`);
      await sleep(delay);
    }
  }
  return null;
}

export async function disconnectDB() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.connection.close(false);
  logger.info('MongoDB connection closed');
}

/** 1 = connected. Used by the health check. */
export const isDBHealthy = () => mongoose.connection.readyState === 1;

export default connectDB;
