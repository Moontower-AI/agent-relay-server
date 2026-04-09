'use strict';

const { Schema, model } = require('mongoose');

// The `secret` field holds the AES-256-GCM envelope (iv|tag|ciphertext, base64)
// produced by services/secrets.js. We must be able to recover the plaintext to
// recompute the HMAC on every incoming GitHub delivery, so it cannot be hashed.
const WebhookSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    secret: { type: String, required: true },
    subscribers: [{ type: Schema.Types.ObjectId, ref: 'Agent', index: true }],
  },
  { timestamps: true },
);

WebhookSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    // Never leak the encrypted secret blob in API responses.
    delete ret.secret;
    return ret;
  },
});

module.exports = model('Webhook', WebhookSchema);
