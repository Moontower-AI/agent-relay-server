'use strict';

const { Schema, model } = require('mongoose');

const EventSchema = new Schema(
  {
    webhookId: {
      type: Schema.Types.ObjectId,
      ref: 'Webhook',
      required: true,
      index: true,
    },
    githubDeliveryId: { type: String, required: true },
    eventType: { type: String, required: true, index: true },
    headers: { type: Object, default: {} },
    payload: { type: Schema.Types.Mixed, required: true },
    receivedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

// Idempotency: GitHub may retry a delivery with the same X-GitHub-Delivery id.
EventSchema.index({ webhookId: 1, githubDeliveryId: 1 }, { unique: true });

EventSchema.set('toJSON', { versionKey: false });

module.exports = model('Event', EventSchema);
