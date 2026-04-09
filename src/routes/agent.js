'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');

const agentAuth = require('../middleware/agentAuth');
const asyncHandler = require('../util/asyncHandler');
const Delivery = require('../models/Delivery');

const router = express.Router();

router.use(agentAuth);

function httpError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  err.expose = true;
  return err;
}

function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const err = httpError(400, 'validation_error', 'request body is invalid');
    err.details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw err;
  }
  return result.data;
}

function assertValidObjectId(id, field = 'id') {
  if (!mongoose.isValidObjectId(id)) {
    throw httpError(400, 'invalid_id', `${field} is not a valid id`);
  }
}

// GET /agent/inbox
//   query: status = unread|read|all (default unread)
//          limit  = 1..200 (default 50)
//          cursor = delivery id to page after (exclusive)
//
// Returns deliveries for the authenticated agent only — scoping is
// enforced at the query level so there's no way to read another agent's inbox.
const listQuerySchema = z.object({
  status: z.enum(['unread', 'read', 'all']).default('unread'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

router.get(
  '/inbox',
  asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw httpError(400, 'validation_error', 'invalid query');
    }
    const { status, limit, cursor } = parsed.data;

    const filter = { agentId: req.agent._id };
    if (status !== 'all') filter.status = status;
    if (cursor) {
      assertValidObjectId(cursor, 'cursor');
      filter._id = { $gt: new mongoose.Types.ObjectId(cursor) };
    }

    const deliveries = await Delivery.find(filter)
      .sort({ _id: 1 })
      .limit(limit)
      .populate({ path: 'eventId', select: 'eventType githubDeliveryId receivedAt webhookId' })
      .exec();

    const items = deliveries.map((d) => {
      const obj = d.toJSON();
      // Rename populated eventId → event for clarity, keep the raw id too.
      if (d.eventId && typeof d.eventId === 'object') {
        obj.event = d.eventId;
        obj.eventId = d.eventId._id;
      }
      return obj;
    });

    const nextCursor = deliveries.length === limit
      ? deliveries[deliveries.length - 1]._id
      : null;

    res.json({ items, nextCursor });
  }),
);

// GET /agent/inbox/:deliveryId — full event payload.
router.get(
  '/inbox/:deliveryId',
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.deliveryId, 'deliveryId');
    const delivery = await Delivery.findOne({
      _id: req.params.deliveryId,
      agentId: req.agent._id,
    })
      .populate('eventId')
      .exec();
    if (!delivery) throw httpError(404, 'not_found', 'delivery not found');

    const obj = delivery.toJSON();
    if (delivery.eventId && typeof delivery.eventId === 'object') {
      obj.event = delivery.eventId;
      obj.eventId = delivery.eventId._id;
    }
    res.json(obj);
  }),
);

// POST /agent/inbox/:deliveryId/ack — single ack, idempotent.
router.post(
  '/inbox/:deliveryId/ack',
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.deliveryId, 'deliveryId');
    const now = new Date();
    const result = await Delivery.updateOne(
      { _id: req.params.deliveryId, agentId: req.agent._id },
      { $set: { status: 'read', readAt: now } },
    ).exec();
    if (result.matchedCount === 0) {
      throw httpError(404, 'not_found', 'delivery not found');
    }
    res.json({ ok: true });
  }),
);

// POST /agent/inbox/ack — batch ack.
const batchAckSchema = z.object({
  deliveryIds: z.array(z.string()).min(1).max(500),
});

router.post(
  '/inbox/ack',
  asyncHandler(async (req, res) => {
    const { deliveryIds } = parseBody(batchAckSchema, req.body);
    for (const id of deliveryIds) assertValidObjectId(id, 'deliveryIds');

    const now = new Date();
    const result = await Delivery.updateMany(
      { _id: { $in: deliveryIds }, agentId: req.agent._id },
      { $set: { status: 'read', readAt: now } },
    ).exec();

    res.json({ ok: true, acked: result.modifiedCount });
  }),
);

module.exports = router;
