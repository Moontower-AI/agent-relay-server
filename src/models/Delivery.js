'use strict';

const { Schema, model } = require('mongoose');

const DELIVERY_STATUSES = ['unread', 'read'];

const DeliverySchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
      index: true,
    },
    agentId: {
      type: Schema.Types.ObjectId,
      ref: 'Agent',
      required: true,
    },
    webhookId: {
      type: Schema.Types.ObjectId,
      ref: 'Webhook',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: DELIVERY_STATUSES,
      default: 'unread',
    },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Primary inbox query: list unread for an agent, oldest first.
DeliverySchema.index({ agentId: 1, status: 1, createdAt: 1 });
// No duplicate inbox rows even if a GitHub retry races through.
DeliverySchema.index({ eventId: 1, agentId: 1 }, { unique: true });

DeliverySchema.set('toJSON', { versionKey: false });

module.exports = model('Delivery', DeliverySchema);
module.exports.DELIVERY_STATUSES = DELIVERY_STATUSES;
