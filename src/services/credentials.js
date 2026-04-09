'use strict';

// Agent API key generation and verification.
//
// Token format: `agt.<publicId>.<secret>`
//   - publicId: 12 url-safe chars, used as the DB lookup key.
//   - secret:   43 url-safe chars (32 random bytes, base64url). Only the
//               argon2id hash is stored; the plaintext is shown once on
//               creation and never again.
//
// We use `.` as the separator because base64url's alphabet is
// [A-Za-z0-9_-] — it never contains a dot, so splitting is unambiguous.

const crypto = require('crypto');
const argon2 = require('argon2');

const TOKEN_PREFIX = 'agt';
const TOKEN_SEPARATOR = '.';
const PUBLIC_ID_BYTES = 9; // 9 bytes → 12 base64url chars
const SECRET_BYTES = 32;

function randomUrlSafe(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function generateRawKey() {
  return {
    publicId: randomUrlSafe(PUBLIC_ID_BYTES),
    secret: randomUrlSafe(SECRET_BYTES),
  };
}

function formatToken({ publicId, secret }) {
  return `${TOKEN_PREFIX}${TOKEN_SEPARATOR}${publicId}${TOKEN_SEPARATOR}${secret}`;
}

// Parse a bearer token into its components. Returns null for anything that
// doesn't match the expected shape — callers should treat null as auth failure.
function parseToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split(TOKEN_SEPARATOR);
  if (parts.length !== 3) return null;
  const [prefix, publicId, secret] = parts;
  if (prefix !== TOKEN_PREFIX) return null;
  if (!publicId || !secret) return null;
  return { publicId, secret };
}

async function hashSecret(secret) {
  return argon2.hash(secret, { type: argon2.argon2id });
}

async function verifySecret(hash, secret) {
  try {
    return await argon2.verify(hash, secret);
  } catch {
    return false;
  }
}

// Convenience: create a new key and return both the plaintext token (shown
// once) and the hashed storage form.
async function issueApiKey() {
  const raw = generateRawKey();
  const apiKeyHash = await hashSecret(raw.secret);
  return {
    publicId: raw.publicId,
    apiKey: formatToken(raw),
    apiKeyHash,
  };
}

module.exports = {
  issueApiKey,
  parseToken,
  verifySecret,
  hashSecret,
  formatToken,
  TOKEN_PREFIX,
};
