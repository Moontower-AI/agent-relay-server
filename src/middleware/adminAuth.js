'use strict';

const config = require('../config');
const { timingSafeEqualStrings } = require('../util/timingSafe');

function adminAuth(req, _res, next) {
  const presented = req.get('x-admin-token');
  if (!presented || !timingSafeEqualStrings(presented, config.adminToken)) {
    const err = new Error('admin authentication required');
    err.status = 401;
    err.code = 'unauthorized';
    err.expose = true;
    return next(err);
  }
  return next();
}

module.exports = adminAuth;
