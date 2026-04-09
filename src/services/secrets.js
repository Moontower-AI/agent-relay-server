'use strict';

// AES-256-GCM envelope for webhook HMAC secrets at rest. We need the secret in
// plaintext every time GitHub posts a delivery so we can recompute the HMAC,
// so we cannot hash it — instead we encrypt with a key held in env.
//
// Envelope format (base64-encoded):
//   [ 12 bytes IV | 16 bytes auth tag | N bytes ciphertext ]

const crypto = require('crypto');
const config = require('../config');

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encrypt(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('secrets.encrypt: plaintext required');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, config.encryptionKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(envelope) {
  if (typeof envelope !== 'string' || envelope.length === 0) {
    throw new Error('secrets.decrypt: envelope required');
  }
  const buf = Buffer.from(envelope, 'base64');
  if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('secrets.decrypt: envelope too short');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, config.encryptionKey, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

// Generate a strong random HMAC secret that GitHub can echo back via HMAC-SHA256.
function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { encrypt, decrypt, generateWebhookSecret };
