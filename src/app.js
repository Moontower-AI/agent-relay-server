'use strict';

const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./logger');
const errorHandler = require('./middleware/errorHandler');

const healthRoutes = require('./routes/health');
const githubRoutes = require('./routes/github');
const adminRoutes = require('./routes/admin');
const agentRoutes = require('./routes/agent');

// Rate limiters. Values chosen to be generous for legitimate use but to
// meaningfully slow down credential-stuffing attempts.
const adminLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
const agentLimiter = rateLimit({
  windowMs: 60_000,
  max: 600, // agents poll — this is per-IP, not per-agent
  standardHeaders: true,
  legacyHeaders: false,
});
const githubLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

function buildApp() {
  const app = express();

  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      redact: logger.redact,
      customLogLevel(_req, res, err) {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // Health first — no auth, no body parsing required.
  app.use('/healthz', healthRoutes);

  // GitHub ingress: mounts its own raw body parser inside the route module
  // so that HMAC verification can run over the exact bytes GitHub sent.
  app.use('/webhooks/github', githubLimiter, githubRoutes);

  // Everything below this point uses JSON bodies.
  app.use(express.json({ limit: '1mb' }));

  app.use('/admin', adminLimiter, adminRoutes);
  app.use('/agent', agentLimiter, agentRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
