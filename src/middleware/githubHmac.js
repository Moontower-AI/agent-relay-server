'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const Webhook = require('../models/Webhook');
const { decrypt } = require('../services/secrets');

function unauthorized(next, code = 'unauthorized') {
  const err = new Error('webhook signature invalid');
  err.status = 401;
  err.code = code;
  err.expose = true;
  return next(err);
}

// Verifies the X-Hub-Signature-256 header over the raw request body using the
// per-webhook secret. On success, attaches the loaded Webhook doc and the raw
// body to req for the handler to consume.
async function githubHmacImpl(req, _res, next) {
  const { webhookId } = req.params;
  if (!mongoose.isValidObjectId(webhookId)) {
    return unauthorized(next, 'unknown_webhook');
  }

  const webhook = await Webhook.findById(webhookId).exec();
  if (!webhook) {
    return unauthorized(next, 'unknown_webhook');
  }

  const signatureHeader = req.get('x-hub-signature-256');
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return unauthorized(next);
  }
  const providedHex = signatureHeader.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/i.test(providedHex)) {
    return unauthorized(next);
  }

  // req.body here is a Buffer because the route mounts express.raw() first.
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  let secretPlain;
  try {
    secretPlain = decrypt(webhook.secret);
  } catch {
    // Misconfigured encryption key or tampered stored blob.
    return unauthorized(next, 'webhook_secret_unreadable');
  }

  const expected = crypto.createHmac('sha256', secretPlain).update(raw).digest();
  const provided = Buffer.from(providedHex, 'hex');
  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return unauthorized(next);
  }

  req.webhook = webhook;
  req.rawBody = raw;
  return next();
}

function githubHmac(req, res, next) {
  githubHmacImpl(req, res, next).catch(next);
}

module.exports = githubHmac;
