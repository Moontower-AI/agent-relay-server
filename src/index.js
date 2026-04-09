'use strict';

const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const { buildApp } = require('./app');

async function main() {
  await db.connect();

  const app = buildApp();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'git-relay-server listening');
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    server.close((err) => {
      if (err) {
        logger.error({ err }, 'error closing http server');
      }
    });

    // Give in-flight requests a moment to finish before killing the socket.
    const forceExit = setTimeout(() => {
      logger.warn('force exit after 10s');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      await db.disconnect();
    } catch (err) {
      logger.error({ err }, 'error closing mongoose');
    }
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
