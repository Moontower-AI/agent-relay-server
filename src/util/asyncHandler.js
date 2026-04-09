'use strict';

// Express 4 does not forward rejected promises from async handlers to the
// error middleware. Wrap async handlers with this helper so thrown errors
// reach errorHandler via next(err).
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
