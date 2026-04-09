'use strict';

const crypto = require('crypto');

// Length-safe constant-time string compare. Returns false if either side is
// missing or the byte lengths differ (Buffer.compare/timingSafeEqual throws on
// mismatched lengths, which would leak length information).
function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = { timingSafeEqualStrings };
