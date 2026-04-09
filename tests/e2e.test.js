'use strict';

// Configure env BEFORE any app module loads (config.js validates at require-time).
// Note: config.port is never consulted in tests — supertest binds its own
// ephemeral server per request — so this value is arbitrary but must pass
// schema validation (positive integer).
process.env.PORT = '3000';
process.env.MONGO_URI = 'mongodb://placeholder/git-relay-test';
process.env.ADMIN_TOKEN = 'a'.repeat(64);
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 0xab).toString('base64');
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const { buildApp } = require('../src/app');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

let mongo;
let app;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = buildApp();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  // Wipe collections between tests so each one starts from a clean slate.
  const { collections } = mongoose.connection;
  for (const name of Object.keys(collections)) {
    await collections[name].deleteMany({});
  }
});

// -------- helpers -----------------------------------------------------------

function signBody(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function createWebhook(name = 'primary') {
  return request(app)
    .post('/admin/webhooks')
    .set('X-Admin-Token', ADMIN_TOKEN)
    .send({ name });
}

function createAgent(name = 'worker-1') {
  return request(app)
    .post('/admin/agents')
    .set('X-Admin-Token', ADMIN_TOKEN)
    .send({ name });
}

function subscribe(webhookId, agentId) {
  return request(app)
    .post(`/admin/webhooks/${webhookId}/subscribers`)
    .set('X-Admin-Token', ADMIN_TOKEN)
    .send({ agentId });
}

function postGithubDelivery({ webhookId, secret, eventType, deliveryId, payload }) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return request(app)
    .post(`/webhooks/github/${webhookId}`)
    .set('content-type', 'application/json')
    .set('X-GitHub-Event', eventType)
    .set('X-GitHub-Delivery', deliveryId)
    .set('X-Hub-Signature-256', signBody(secret, body))
    .send(body);
}

// -------- happy path --------------------------------------------------------

test('happy path: create, subscribe, deliver, list, fetch, ack', async () => {
  const wh = await createWebhook();
  assert.equal(wh.status, 201);
  assert.ok(wh.body.secret, 'plaintext secret returned once');
  assert.ok(wh.body.webhook._id);
  assert.ok(
    wh.body.deliveryUrl.endsWith(`/webhooks/github/${wh.body.webhook._id}`),
    'deliveryUrl points at the new webhook',
  );

  const agent = await createAgent();
  assert.equal(agent.status, 201);
  assert.match(agent.body.apiKey, /^agt\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const sub = await subscribe(wh.body.webhook._id, agent.body.agent._id);
  assert.equal(sub.status, 200);
  assert.deepEqual(sub.body.webhook.subscribers, [agent.body.agent._id]);

  const payload = { action: 'opened', number: 42 };
  const post = await postGithubDelivery({
    webhookId: wh.body.webhook._id,
    secret: wh.body.secret,
    eventType: 'pull_request',
    deliveryId: 'delivery-1',
    payload,
  });
  assert.equal(post.status, 202);
  assert.equal(post.body.deliveriesCreated, 1);
  assert.equal(post.body.duplicate, false);

  // List the agent's inbox.
  const inbox = await request(app)
    .get('/agent/inbox?status=unread')
    .set('Authorization', `Bearer ${agent.body.apiKey}`);
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.items.length, 1);
  assert.equal(inbox.body.items[0].status, 'unread');
  assert.equal(inbox.body.items[0].event.eventType, 'pull_request');

  const deliveryId = inbox.body.items[0]._id;

  // Fetch the full event.
  const one = await request(app)
    .get(`/agent/inbox/${deliveryId}`)
    .set('Authorization', `Bearer ${agent.body.apiKey}`);
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.event.payload, payload);

  // Ack it.
  const ack = await request(app)
    .post(`/agent/inbox/${deliveryId}/ack`)
    .set('Authorization', `Bearer ${agent.body.apiKey}`);
  assert.equal(ack.status, 200);
  assert.equal(ack.body.ok, true);

  // Unread count should be zero now; read count should be one.
  const unreadAfter = await request(app)
    .get('/agent/inbox?status=unread')
    .set('Authorization', `Bearer ${agent.body.apiKey}`);
  assert.equal(unreadAfter.body.items.length, 0);

  const readAfter = await request(app)
    .get('/agent/inbox?status=read')
    .set('Authorization', `Bearer ${agent.body.apiKey}`);
  assert.equal(readAfter.body.items.length, 1);
  assert.equal(readAfter.body.items[0].status, 'read');

  // Ack is idempotent: acking again still succeeds (matchedCount > 0).
  const ackAgain = await request(app)
    .post(`/agent/inbox/${deliveryId}/ack`)
    .set('Authorization', `Bearer ${agent.body.apiKey}`);
  assert.equal(ackAgain.status, 200);
});

// -------- idempotency ------------------------------------------------------

test('replaying the same github delivery is a no-op on Delivery rows', async () => {
  const wh = await createWebhook();
  const agent = await createAgent();
  await subscribe(wh.body.webhook._id, agent.body.agent._id);

  const payload = { hello: 'world' };
  const common = {
    webhookId: wh.body.webhook._id,
    secret: wh.body.secret,
    eventType: 'push',
    deliveryId: 'replay-1',
    payload,
  };

  const first = await postGithubDelivery(common);
  assert.equal(first.status, 202);
  assert.equal(first.body.duplicate, false);

  const second = await postGithubDelivery(common);
  assert.equal(second.status, 202);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.eventId, first.body.eventId);

  const inbox = await request(app)
    .get('/agent/inbox?status=unread')
    .set('Authorization', `Bearer ${agent.body.apiKey}`);
  assert.equal(inbox.body.items.length, 1, 'replay must not create a second delivery');
});

// -------- fan-out ----------------------------------------------------------

test('one webhook fans out to multiple subscribed agents', async () => {
  const wh = await createWebhook();
  const a = await createAgent('worker-a');
  const b = await createAgent('worker-b');
  const c = await createAgent('worker-c');
  await subscribe(wh.body.webhook._id, a.body.agent._id);
  await subscribe(wh.body.webhook._id, b.body.agent._id);
  await subscribe(wh.body.webhook._id, c.body.agent._id);

  const res = await postGithubDelivery({
    webhookId: wh.body.webhook._id,
    secret: wh.body.secret,
    eventType: 'push',
    deliveryId: 'fanout-1',
    payload: { ok: true },
  });
  assert.equal(res.status, 202);
  assert.equal(res.body.deliveriesCreated, 3);

  for (const agent of [a, b, c]) {
    const inbox = await request(app)
      .get('/agent/inbox')
      .set('Authorization', `Bearer ${agent.body.apiKey}`);
    assert.equal(inbox.body.items.length, 1);
  }
});

// -------- negative auth ----------------------------------------------------

test('admin endpoints reject a missing or wrong token', async () => {
  const noToken = await request(app).post('/admin/webhooks').send({ name: 'x' });
  assert.equal(noToken.status, 401);

  const wrongToken = await request(app)
    .post('/admin/webhooks')
    .set('X-Admin-Token', 'wrong')
    .send({ name: 'x' });
  assert.equal(wrongToken.status, 401);
});

test('github ingress rejects a wrong HMAC', async () => {
  const wh = await createWebhook();

  const res = await request(app)
    .post(`/webhooks/github/${wh.body.webhook._id}`)
    .set('content-type', 'application/json')
    .set('X-GitHub-Event', 'push')
    .set('X-GitHub-Delivery', 'bad-sig')
    .set('X-Hub-Signature-256', 'sha256=' + 'a'.repeat(64))
    .send(JSON.stringify({ nope: true }));
  assert.equal(res.status, 401);
});

test('github ingress rejects a missing signature header', async () => {
  const wh = await createWebhook();
  const res = await request(app)
    .post(`/webhooks/github/${wh.body.webhook._id}`)
    .set('content-type', 'application/json')
    .set('X-GitHub-Event', 'push')
    .set('X-GitHub-Delivery', 'no-sig')
    .send(JSON.stringify({ nope: true }));
  assert.equal(res.status, 401);
});

test('agent endpoints reject a bogus bearer token', async () => {
  const noHeader = await request(app).get('/agent/inbox');
  assert.equal(noHeader.status, 401);

  const wrongShape = await request(app)
    .get('/agent/inbox')
    .set('Authorization', 'Bearer not-a-valid-token');
  assert.equal(wrongShape.status, 401);

  const wrongSecret = await request(app)
    .get('/agent/inbox')
    .set('Authorization', 'Bearer agt_abcdefghijkl_wrongsecret');
  assert.equal(wrongSecret.status, 401);
});

// -------- isolation --------------------------------------------------------

test('agents cannot read another agent\'s inbox', async () => {
  const wh = await createWebhook();
  const alice = await createAgent('alice');
  const bob = await createAgent('bob');
  await subscribe(wh.body.webhook._id, alice.body.agent._id);

  await postGithubDelivery({
    webhookId: wh.body.webhook._id,
    secret: wh.body.secret,
    eventType: 'push',
    deliveryId: 'isolation-1',
    payload: { private: true },
  });

  const aInbox = await request(app)
    .get('/agent/inbox')
    .set('Authorization', `Bearer ${alice.body.apiKey}`);
  assert.equal(aInbox.body.items.length, 1);
  const aliceDeliveryId = aInbox.body.items[0]._id;

  // Bob has no subscription, so his inbox should be empty.
  const bInbox = await request(app)
    .get('/agent/inbox')
    .set('Authorization', `Bearer ${bob.body.apiKey}`);
  assert.equal(bInbox.body.items.length, 0);

  // Bob tries to fetch Alice's delivery directly by id → scoped query returns 404.
  const peek = await request(app)
    .get(`/agent/inbox/${aliceDeliveryId}`)
    .set('Authorization', `Bearer ${bob.body.apiKey}`);
  assert.equal(peek.status, 404);

  // Bob tries to ack Alice's delivery → scoped update returns 404.
  const stealAck = await request(app)
    .post(`/agent/inbox/${aliceDeliveryId}/ack`)
    .set('Authorization', `Bearer ${bob.body.apiKey}`);
  assert.equal(stealAck.status, 404);

  // Alice's delivery is still unread.
  const stillUnread = await request(app)
    .get('/agent/inbox?status=unread')
    .set('Authorization', `Bearer ${alice.body.apiKey}`);
  assert.equal(stillUnread.body.items.length, 1);
});

// -------- rotation ---------------------------------------------------------

test('rotating an agent key invalidates the old one', async () => {
  const agent = await createAgent();
  const oldKey = agent.body.apiKey;

  // Old key works.
  const before = await request(app)
    .get('/agent/inbox')
    .set('Authorization', `Bearer ${oldKey}`);
  assert.equal(before.status, 200);

  const rotated = await request(app)
    .post(`/admin/agents/${agent.body.agent._id}/rotate-key`)
    .set('X-Admin-Token', ADMIN_TOKEN);
  assert.equal(rotated.status, 200);
  const newKey = rotated.body.apiKey;
  assert.notEqual(newKey, oldKey);

  // Old key is now rejected; new key works.
  const oldReject = await request(app)
    .get('/agent/inbox')
    .set('Authorization', `Bearer ${oldKey}`);
  assert.equal(oldReject.status, 401);

  const newAccept = await request(app)
    .get('/agent/inbox')
    .set('Authorization', `Bearer ${newKey}`);
  assert.equal(newAccept.status, 200);
});

test('rotating a webhook secret invalidates deliveries signed with the old one', async () => {
  const wh = await createWebhook();
  const oldSecret = wh.body.secret;

  const rotated = await request(app)
    .post(`/admin/webhooks/${wh.body.webhook._id}/rotate-secret`)
    .set('X-Admin-Token', ADMIN_TOKEN);
  assert.equal(rotated.status, 200);
  const newSecret = rotated.body.secret;
  assert.notEqual(newSecret, oldSecret);

  // A delivery signed with the old secret is rejected.
  const withOld = await postGithubDelivery({
    webhookId: wh.body.webhook._id,
    secret: oldSecret,
    eventType: 'push',
    deliveryId: 'rot-old',
    payload: { a: 1 },
  });
  assert.equal(withOld.status, 401);

  // A delivery signed with the new secret is accepted.
  const withNew = await postGithubDelivery({
    webhookId: wh.body.webhook._id,
    secret: newSecret,
    eventType: 'push',
    deliveryId: 'rot-new',
    payload: { a: 1 },
  });
  assert.equal(withNew.status, 202);
});
