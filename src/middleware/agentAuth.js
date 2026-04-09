'use strict';

const Agent = require('../models/Agent');
const { parseToken, verifySecret } = require('../services/credentials');
const logger = require('../logger');

function unauthorized(next, message = 'agent authentication required') {
  const err = new Error(message);
  err.status = 401;
  err.code = 'unauthorized';
  err.expose = true;
  return next(err);
}

async function agentAuthImpl(req, _res, next) {
  const header = req.get('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return unauthorized(next);
  }
  const token = header.slice(7).trim();
  const parsed = parseToken(token);
  if (!parsed) {
    return unauthorized(next);
  }

  const agent = await Agent.findOne({ publicId: parsed.publicId }).exec();
  if (!agent || agent.disabled) {
    return unauthorized(next);
  }

  const ok = await verifySecret(agent.apiKeyHash, parsed.secret);
  if (!ok) {
    return unauthorized(next);
  }

  req.agent = agent;

  // Fire-and-forget lastSeenAt bump — don't block the response on this.
  Agent.updateOne({ _id: agent._id }, { $set: { lastSeenAt: new Date() } })
    .exec()
    .catch((err) => logger.warn({ err }, 'failed to update agent lastSeenAt'));

  return next();
}

function agentAuth(req, res, next) {
  agentAuthImpl(req, res, next).catch(next);
}

module.exports = agentAuth;
