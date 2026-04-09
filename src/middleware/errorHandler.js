'use strict';

const logger = require('../logger');

// Centralized error handler. Routes should throw (or `next(err)`) plain errors
// optionally decorated with a `status` field and a safe `expose` message.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = Number.isInteger(err?.status) ? err.status : 500;

  if (status >= 500) {
    logger.error({ err, reqId: req.id }, 'request failed');
  }

  // Only expose a message if the error opted in (or it's a client error we built).
  const body = { error: err?.code || (status >= 500 ? 'internal_error' : 'bad_request') };
  if (err?.expose && err?.message) {
    body.message = err.message;
  }
  if (err?.details) {
    body.details = err.details;
  }
  res.status(status).json(body);
}

module.exports = errorHandler;
