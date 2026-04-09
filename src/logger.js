'use strict';

const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-admin-token"]',
      'req.headers["x-hub-signature-256"]',
      'req.headers.cookie',
    ],
    censor: '[redacted]',
  },
});

module.exports = logger;
