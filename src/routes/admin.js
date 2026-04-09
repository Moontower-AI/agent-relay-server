'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { z } = require('zod');

const adminAuth = require('../middleware/adminAuth');
const asyncHandler = require('../util/asyncHandler');

const Webhook = require('../models/Webhook');
const Agent = require('../models/Agent');

const secrets = require('../services/secrets');
const credentials = require('../services/credentials');

const router = express.Router();

router.use(adminAuth);

// -------- helpers -----------------------------------------------------------

function httpError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  err.expose = true;
  return err;
}

function assertValidObjectId(id, field = 'id') {
  if (!mongoose.isValidObjectId(id)) {
    throw httpError(400, 'invalid_id', `${field} is not a valid id`);
  }
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

// -------- webhooks ----------------------------------------------------------

const createWebhookSchema = z.object({
  name: z.string().min(1).max(128),
});

router.post(
  '/webhooks',
  asyncHandler(async (req, res) => {
    const { name } = parseBody(createWebhookSchema, req.body);
    const plaintextSecret = secrets.generateWebhookSecret();
    const encryptedSecret = secrets.encrypt(plaintextSecret);

    let webhook;
    try {
      webhook = await Webhook.create({
        name,
        secret: encryptedSecret,
        subscribers: [],
      });
    } catch (err) {
      if (err?.code === 11000) {
        throw httpError(409, 'webhook_exists', 'a webhook with that name already exists');
      }
      throw err;
    }

    // Plaintext secret is returned exactly once, here. It's never retrievable afterward.
    res.status(201).json({
      webhook: webhook.toJSON(),
      secret: plaintextSecret,
      deliveryUrl: `${req.protocol}://${req.get('host')}/webhooks/github/${webhook._id}`,
    });
  }),
);

router.get(
  '/webhooks',
  asyncHandler(async (_req, res) => {
    const webhooks = await Webhook.find().sort({ createdAt: -1 }).exec();
    res.json({ webhooks: webhooks.map((w) => w.toJSON()) });
  }),
);

router.get(
  '/webhooks/:id',
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    const webhook = await Webhook.findById(req.params.id).exec();
    if (!webhook) throw httpError(404, 'not_found', 'webhook not found');
    res.json({ webhook: webhook.toJSON() });
  }),
);

router.delete(
  '/webhooks/:id',
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    const result = await Webhook.deleteOne({ _id: req.params.id }).exec();
    if (result.deletedCount === 0) {
      throw httpError(404, 'not_found', 'webhook not found');
    }
    res.status(204).end();
  }),
);

router.post(
  '/webhooks/:id/rotate-secret',
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    const plaintextSecret = secrets.generateWebhookSecret();
    const encryptedSecret = secrets.encrypt(plaintextSecret);
    const webhook = await Webhook.findByIdAndUpdate(
      req.params.id,
      { $set: { secret: encryptedSecret } },
      { new: true },
    ).exec();
    if (!webhook) throw httpError(404, 'not_found', 'webhook not found');
    res.json({
      webhook: webhook.toJSON(),
      secret: plaintextSecret,
    });
  }),
);

const subscribeSchema = z.object({
  agentId: z.string().min(1),
});

router.post(
  '/webhooks/:id/subscribers',
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    const { agentId } = parseBody(subscribeSchema, req.body);
    assertValidObjectId(agentId, 'agentId');

    const agent = await Agent.findById(agentId).exec();
    if (!agent) throw httpError(404, 'agent_not_found', 'agent not found');

    const webhook = await Webhook.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { subscribers: agent._id } },
      { new: true },
    ).exec();
    if (!webhook) throw httpError(404, 'not_found', 'webhook not found');

    res.json({ webhook: webhook.toJSON() });
  }),
);

router.delete(
  '/webhooks/:id/subscribers/:agentId',
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    assertValidObjectId(req.params.agentId, 'agentId');

    const webhook = await Webhook.findByIdAndUpdate(
      req.params.id,
      { $pull: { subscribers: req.params.agentId } },
      { new: true },
    ).exec();
    if (!webhook) throw httpError(404, 'not_found', 'webhook not found');

    res.json({ webhook: webhook.toJSON() });
  }),
);

// -------- agents ------------------------------------------------------------

const createAgentSchema = z.object({
  name: z.string().min(1).max(128),
});

router.post(
  '/agents',
  asyncHandler(async (req, res) => {
    const { name } = parseBody(createAgentSchema, req.body);
    const issued = await credentials.issueApiKey();

    let agent;
    try {
      agent = await Agent.create({
        name,
        publicId: issued.publicId,
        apiKeyHash: issued.apiKeyHash,
      });
    } catch (err) {
      if (err?.code === 11000) {
        throw httpError(409, 'agent_exists', 'an agent with that name already exists');
      }
      throw err;
    }

    // Plaintext apiKey is returned exactly once.
    res.status(201).json({
      agent: agent.toJSON(),
      apiKey: issued.apiKey,
    });
  }),
);

router.get(
  '/agents',
  asyncHandler(async (_req, res) => {
    const agents = await Agent.find().sort({ createdAt: -1 }).exec();
    res.json({ agents: agents.map((a) => a.toJSON()) });
  }),
);

router.get(
  '/agents/:id',
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    const agent = await Agent.findById(req.params.id).exec();
    if (!agent) throw httpError(404, 'not_found', 'agent not found');
    res.json({ agent: agent.toJSON() });
  }),
);

router.delete(
  '/agents/:id',
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    const result = await Agent.deleteOne({ _id: req.params.id }).exec();
    if (result.deletedCount === 0) {
      throw httpError(404, 'not_found', 'agent not found');
    }
    // Also remove the agent from any webhook subscriber lists.
    await Webhook.updateMany(
      { subscribers: req.params.id },
      { $pull: { subscribers: req.params.id } },
    ).exec();
    res.status(204).end();
  }),
);

router.post(
  '/agents/:id/rotate-key',
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    const issued = await credentials.issueApiKey();
    const agent = await Agent.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          publicId: issued.publicId,
          apiKeyHash: issued.apiKeyHash,
        },
      },
      { new: true },
    ).exec();
    if (!agent) throw httpError(404, 'not_found', 'agent not found');
    res.json({ agent: agent.toJSON(), apiKey: issued.apiKey });
  }),
);

const disableSchema = z.object({
  disabled: z.boolean(),
});

router.post(
  '/agents/:id/disable',
  asyncHandler(async (req, res) => {
    assertValidObjectId(req.params.id);
    const { disabled } = parseBody(disableSchema, req.body);
    const agent = await Agent.findByIdAndUpdate(
      req.params.id,
      { $set: { disabled } },
      { new: true },
    ).exec();
    if (!agent) throw httpError(404, 'not_found', 'agent not found');
    res.json({ agent: agent.toJSON() });
  }),
);

module.exports = router;
