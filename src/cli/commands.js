'use strict';

// Command handlers for the relay CLI. Each handler is a thin wrapper around
// one admin endpoint in src/routes/admin.js. They all accept:
//   ctx  — { token, baseUrl, json }
//   args — positional arguments after `<resource> <action>`
//
// When ctx.json is true, handlers emit the raw API response and skip any
// banners so the output is pipeable to `jq`. Otherwise they print a
// human-friendly summary + a one-time-secret banner where applicable.

const { adminRequest } = require('./client');
const fmt = require('./format');

function usage(message) {
  const err = new Error(message);
  err.code = 'usage';
  throw err;
}

function summarizeWebhook(w) {
  const subs = Array.isArray(w.subscribers) ? w.subscribers.length : 0;
  return `${w._id}  ${w.name}  (${subs} subscriber${subs === 1 ? '' : 's'})`;
}

function summarizeAgent(a) {
  const state = a.disabled ? 'disabled' : 'enabled';
  return `${a._id}  ${a.name}  [${state}]  publicId=${a.publicId || '-'}`;
}

// -------- webhooks ----------------------------------------------------------

async function webhookCreate(ctx, [name]) {
  if (!name) usage('usage: relay webhook create <name>');
  const body = await adminRequest(ctx, 'POST', '/webhooks', { name });
  if (ctx.json) return fmt.printJson(body);
  fmt.printEntity('webhook created', body.webhook);
  process.stdout.write(`  deliveryUrl: ${body.deliveryUrl}\n`);
  fmt.secretBanner('WEBHOOK SECRET', body.secret, 'Use this as the GitHub webhook Secret. Cannot be retrieved later.');
}

async function webhookList(ctx) {
  const body = await adminRequest(ctx, 'GET', '/webhooks');
  if (ctx.json) return fmt.printJson(body);
  fmt.printList('webhooks', body.webhooks, summarizeWebhook);
}

async function webhookGet(ctx, [id]) {
  if (!id) usage('usage: relay webhook get <id>');
  const body = await adminRequest(ctx, 'GET', `/webhooks/${id}`);
  if (ctx.json) return fmt.printJson(body);
  fmt.printEntity('webhook', body.webhook);
}

async function webhookDelete(ctx, [id]) {
  if (!id) usage('usage: relay webhook delete <id>');
  await adminRequest(ctx, 'DELETE', `/webhooks/${id}`);
  if (ctx.json) return fmt.printJson({ deleted: id });
  process.stdout.write(`webhook deleted: ${id}\n`);
}

async function webhookRotateSecret(ctx, [id]) {
  if (!id) usage('usage: relay webhook rotate-secret <id>');
  const body = await adminRequest(ctx, 'POST', `/webhooks/${id}/rotate-secret`);
  if (ctx.json) return fmt.printJson(body);
  fmt.printEntity('webhook secret rotated', body.webhook);
  fmt.secretBanner('NEW WEBHOOK SECRET', body.secret, 'Update the GitHub webhook config with this value. Cannot be retrieved later.');
}

async function webhookSubscribe(ctx, [webhookId, agentId]) {
  if (!webhookId || !agentId) usage('usage: relay webhook subscribe <webhookId> <agentId>');
  const body = await adminRequest(ctx, 'POST', `/webhooks/${webhookId}/subscribers`, { agentId });
  if (ctx.json) return fmt.printJson(body);
  fmt.printEntity(`agent ${agentId} subscribed`, body.webhook);
}

async function webhookUnsubscribe(ctx, [webhookId, agentId]) {
  if (!webhookId || !agentId) usage('usage: relay webhook unsubscribe <webhookId> <agentId>');
  const body = await adminRequest(ctx, 'DELETE', `/webhooks/${webhookId}/subscribers/${agentId}`);
  if (ctx.json) return fmt.printJson(body);
  fmt.printEntity(`agent ${agentId} unsubscribed`, body.webhook);
}

// -------- agents ------------------------------------------------------------

async function agentCreate(ctx, [name]) {
  if (!name) usage('usage: relay agent create <name>');
  const body = await adminRequest(ctx, 'POST', '/agents', { name });
  if (ctx.json) return fmt.printJson(body);
  fmt.printEntity('agent created', body.agent);
  fmt.secretBanner('API KEY', body.apiKey, 'Give this to the agent as `Authorization: Bearer <key>`. Cannot be retrieved later.');
}

async function agentList(ctx) {
  const body = await adminRequest(ctx, 'GET', '/agents');
  if (ctx.json) return fmt.printJson(body);
  fmt.printList('agents', body.agents, summarizeAgent);
}

async function agentGet(ctx, [id]) {
  if (!id) usage('usage: relay agent get <id>');
  const body = await adminRequest(ctx, 'GET', `/agents/${id}`);
  if (ctx.json) return fmt.printJson(body);
  fmt.printEntity('agent', body.agent);
}

async function agentDelete(ctx, [id]) {
  if (!id) usage('usage: relay agent delete <id>');
  await adminRequest(ctx, 'DELETE', `/agents/${id}`);
  if (ctx.json) return fmt.printJson({ deleted: id });
  process.stdout.write(`agent deleted: ${id}\n`);
}

async function agentRotateKey(ctx, [id]) {
  if (!id) usage('usage: relay agent rotate-key <id>');
  const body = await adminRequest(ctx, 'POST', `/agents/${id}/rotate-key`);
  if (ctx.json) return fmt.printJson(body);
  fmt.printEntity('agent key rotated', body.agent);
  fmt.secretBanner('NEW API KEY', body.apiKey, 'Re-deploy the agent with this new key. Cannot be retrieved later.');
}

async function agentSetDisabled(ctx, [id], disabled) {
  if (!id) usage(`usage: relay agent ${disabled ? 'disable' : 'enable'} <id>`);
  const body = await adminRequest(ctx, 'POST', `/agents/${id}/disable`, { disabled });
  if (ctx.json) return fmt.printJson(body);
  fmt.printEntity(`agent ${disabled ? 'disabled' : 'enabled'}`, body.agent);
}

// -------- dispatch ----------------------------------------------------------

const webhook = {
  create: webhookCreate,
  list: webhookList,
  ls: webhookList,
  get: webhookGet,
  delete: webhookDelete,
  rm: webhookDelete,
  'rotate-secret': webhookRotateSecret,
  subscribe: webhookSubscribe,
  unsubscribe: webhookUnsubscribe,
};

const agent = {
  create: agentCreate,
  list: agentList,
  ls: agentList,
  get: agentGet,
  delete: agentDelete,
  rm: agentDelete,
  'rotate-key': agentRotateKey,
  disable: (ctx, args) => agentSetDisabled(ctx, args, true),
  enable: (ctx, args) => agentSetDisabled(ctx, args, false),
};

module.exports = {
  webhook,
  webhooks: webhook,
  agent,
  agents: agent,
};
