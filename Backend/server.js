/**
 * Process entrypoint.
 *
 * Boot order: validate env (crashes there if misconfigured) -> connect the
 * database -> start listening. Shutdown drains in-flight requests before
 * closing Mongo, so a deploy does not sever a half-written order.
 */
import { env } from './src/config/env.js';
import { logger } from './src/utils/logger.js';
import { connectDB, disconnectDB } from './src/config/db.js';
// Side-effect import: registers every schema with Mongoose before any query
// or populate() runs. Without it, refs resolve to an unregistered model.
import './src/models/index.js';
import app from './app.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

let server;
let shuttingDown = false;

async function start() {
  await connectDB();

  server = app.listen(env.PORT, () => {
    logger.info('Server listening', {
      port: env.PORT,
      env: env.NODE_ENV,
      corsOrigins: env.corsOrigins,
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${env.PORT} is already in use`);
    } else {
      logger.error('HTTP server error', { message: err.message });
    }
    process.exit(1);
  });

  // Slowloris mitigation: cap how long a client may take to send headers.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 10_000;
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — shutting down`);

  // Hard stop if a hung connection prevents a clean close.
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      logger.info('HTTP server closed');
    }
    await disconnectDB();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { message: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// An unhandled rejection or uncaught exception leaves the process in an
// unknown state — log it and restart rather than serving from a corrupt one.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    message: reason?.message ?? String(reason),
    stack: reason?.stack,
  });
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
  shutdown('uncaughtException');
});

start().catch((err) => {
  logger.error('Failed to start server', { message: err.message, stack: err.stack });
  process.exit(1);
});
