'use strict';

const { Schema, model } = require('mongoose');

const AgentSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    // Short random public identifier used as the lookup key from the bearer
    // token. The secret portion is verified against apiKeyHash with argon2id.
    publicId: { type: String, required: true, unique: true, index: true },
    apiKeyHash: { type: String, required: true },
    lastSeenAt: { type: Date, default: null },
    disabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

AgentSchema.set('toJSON', {
  versionKey: false,
  transform(_doc, ret) {
    delete ret.apiKeyHash;
    return ret;
  },
});

module.exports = model('Agent', AgentSchema);
