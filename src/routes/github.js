'use strict';

const express = require('express');

const Event = require('../models/Event');
const githubHmac = require('../middleware/githubHmac');
const asyncHandler = require('../util/asyncHandler');
const { fanOut } = require('../services/delivery');
const logger = require('../logger');

const router = express.Router();

// Allowlist of GitHub headers we persist with the event. We intentionally drop
// hop-by-hop headers, signatures, and anything that would just be noise.
const GITHUB_HEADER_ALLOWLIST = [
  'x-github-event',
  'x-github-delivery',
  'x-github-hook-id',
  'x-github-hook-installation-target-id',
  'x-github-hook-installation-target-type',
  'user-agent',
];

function pickHeaders(req) {
  const out = {};
  for (const name of GITHUB_HEADER_ALLOWLIST) {
    const v = req.get(name);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

// Raw body parser — must run before HMAC verification so we have exact bytes.
router.post(
  '/:webhookId',
  express.raw({ type: '*/*', limit: '10mb' }),
  githubHmac,
  asyncHandler(async (req, res) => {
    const deliveryId = req.get('x-github-delivery');
    const eventType = req.get('x-github-event');
    if (!deliveryId || !eventType) {
      const err = new Error('missing github delivery headers');
      err.status = 400;
      err.code = 'bad_request';
      err.expose = true;
      throw err;
    }

    let payload;
    try {
      payload = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      const err = new Error('invalid json payload');
      err.status = 400;
      err.code = 'invalid_payload';
      err.expose = true;
      throw err;
    }

    // Idempotent upsert on (webhookId, githubDeliveryId). If GitHub retries
    // the same delivery we'll reuse the existing Event — no duplicate row.
    let event;
    let createdNewEvent = false;
    try {
      event = await Event.create({
        webhookId: req.webhook._id,
        githubDeliveryId: deliveryId,
        eventType,
        headers: pickHeaders(req),
        payload,
      });
      createdNewEvent = true;
    } catch (err) {
      if (err?.code === 11000) {
        event = await Event.findOne({
          webhookId: req.webhook._id,
          githubDeliveryId: deliveryId,
        }).exec();
      } else {
        throw err;
      }
    }

    // Fan out to currently-subscribed agents. Even on a retry we run this —
    // the unique (eventId, agentId) index makes it a no-op for agents that
    // already have a delivery row, while catching any agents subscribed
    // between the original and the retry.
    const subscribers = Array.isArray(req.webhook.subscribers)
      ? req.webhook.subscribers
      : [];
    const { created } = await fanOut({
      event,
      webhookId: req.webhook._id,
      subscriberIds: subscribers,
    });

    logger.info(
      {
        webhookId: req.webhook._id.toString(),
        eventId: event._id.toString(),
        eventType,
        deliveryId,
        createdNewEvent,
        deliveriesCreated: created,
        subscribers: subscribers.length,
      },
      'github delivery accepted',
    );

    res.status(202).json({
      ok: true,
      eventId: event._id,
      deliveriesCreated: created,
      duplicate: !createdNewEvent,
    });
  }),
);

module.exports = router;
