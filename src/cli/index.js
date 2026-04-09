'use strict';

// Admin CLI entry point. Loaded by bin/relay.js and by `npm run cli`.
//
// Usage:
//   relay <resource> <action> [positionals...] [--base-url URL] [--token VALUE] [--json]
//
// Environment:
//   ADMIN_TOKEN      — required unless --token is passed
//   RELAY_BASE_URL   — optional, overrides the default http://localhost:<PORT>
//   PORT             — used only to build the default base URL
//
// We deliberately do NOT require('../config.js'): that module mandates
// MONGO_URI and ENCRYPTION_KEY at import-time, which CLI users don't need.
// The CLI is fully decoupled from the server modules.

require('dotenv').config();

const { parseArgs } = require('node:util');

const commands = require('./commands');
const fmt = require('./format');

const GLOBAL_FLAGS = {
  'base-url': { type: 'string' },
  token: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

function printUsage(stream = process.stdout) {
  stream.write(`Usage: relay <resource> <action> [args...] [flags]

Resources:
  webhook   Manage webhooks (alias: webhooks)
  agent     Manage agents   (alias: agents)

Webhook actions:
  create <name>                        Create a webhook; prints secret once
  list                                 List all webhooks (alias: ls)
  get <id>                             Show one webhook
  delete <id>                          Delete a webhook (alias: rm)
  rotate-secret <id>                   Rotate HMAC secret; prints new secret once
  subscribe <webhookId> <agentId>      Add an agent subscriber
  unsubscribe <webhookId> <agentId>    Remove an agent subscriber

Agent actions:
  create <name>                        Create an agent; prints apiKey once
  list                                 List all agents (alias: ls)
  get <id>                             Show one agent
  delete <id>                          Delete an agent (alias: rm)
  rotate-key <id>                      Rotate apiKey; prints new key once
  disable <id>                         Disable an agent
  enable <id>                          Enable an agent

Flags:
  --base-url <url>   Override base URL (default: $RELAY_BASE_URL or http://localhost:$PORT)
  --token <value>    Override admin token (default: $ADMIN_TOKEN)
  --json             Print raw JSON (suppresses banners; pipeable to jq)
  -h, --help         Show this help

Examples:
  relay webhook create primary
  relay agent create worker-1 --json
  relay webhook subscribe 6718ab... 6718cd...
  relay agent disable 6718cd...
`);
}

function die(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function resolveResource(name) {
  if (!name) return null;
  const key = name.toLowerCase();
  return commands[key] || null;
}

function suggestActions(resource) {
  // List only the canonical actions (not aliases) for help output.
  const aliases = new Set(['ls', 'rm', 'webhooks', 'agents']);
  return Object.keys(resource).filter((k) => !aliases.has(k)).join(', ');
}

async function main(argv) {
  // Top-level help: `relay`, `relay -h`, `relay --help`.
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    printUsage();
    return 0;
  }

  const [resourceName, actionName, ...rest] = argv;

  const resource = resolveResource(resourceName);
  if (!resource) {
    printUsage(process.stderr);
    process.stderr.write(`\nunknown resource: ${resourceName}\n`);
    return 1;
  }

  if (!actionName) {
    printUsage(process.stderr);
    process.stderr.write(`\n${resourceName} requires an action: ${suggestActions(resource)}\n`);
    return 1;
  }

  const handler = resource[actionName];
  if (!handler) {
    printUsage(process.stderr);
    process.stderr.write(`\nunknown action: ${resourceName} ${actionName}\n`);
    process.stderr.write(`available: ${suggestActions(resource)}\n`);
    return 1;
  }

  // Parse flags from the remaining argv. parseArgs lets positionals and
  // flags mingle, so `relay agent create foo --json` works as well as
  // `relay agent create --json foo`.
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: GLOBAL_FLAGS,
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    printUsage(process.stderr);
    process.stderr.write(`\n${err.message}\n`);
    return 1;
  }

  if (parsed.values.help) {
    printUsage();
    return 0;
  }

  const token = parsed.values.token ?? process.env.ADMIN_TOKEN;
  if (!token) {
    die('error: ADMIN_TOKEN not set — add it to .env or pass --token');
  }
  const baseUrl =
    parsed.values['base-url'] ??
    process.env.RELAY_BASE_URL ??
    `http://localhost:${process.env.PORT || 3000}`;

  const ctx = {
    token,
    baseUrl: baseUrl.replace(/\/$/, ''),
    json: parsed.values.json,
  };

  try {
    await handler(ctx, parsed.positionals);
    return 0;
  } catch (err) {
    if (err.code === 'usage') {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    fmt.errorLine(err);
    return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    // Should not normally reach here — main() catches its own errors.
    process.stderr.write(`error: unexpected — ${err.stack || err.message}\n`);
    process.exit(1);
  },
);
