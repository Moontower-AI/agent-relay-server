# agent-relay-server

A Node.js relay that sits between GitHub and a fleet of AI agents running on private networks. GitHub pushes webhooks to the server; agents poll it like an email inbox and ack events as they process them.

## Design summary

- **GitHub → server**: HMAC-SHA256 over the raw body, verified with `crypto.timingSafeEqual` against the per-webhook secret.
- **Admin → server**: `X-Admin-Token` header, constant-time compared to `ADMIN_TOKEN` from env.
- **Agent → server**: `Authorization: Bearer agt.<publicId>.<secret>`. Only the argon2id hash of the secret is stored; the plaintext is shown exactly once at creation.
- **Storage**: MongoDB via Mongoose. Webhook secrets are AES-256-GCM encrypted at rest (they must be recoverable to verify HMACs).
- **Fan-out**: when a GitHub delivery arrives, one `Delivery` row is created per subscribed agent. Unique `(eventId, agentId)` index makes retries safe.
- **Idempotency**: unique `(webhookId, githubDeliveryId)` index on `Event` — GitHub may retry a delivery, and we'll reuse the existing `Event` row.
- **Consumption model**: short polling. Agents `GET /agent/inbox` and `POST /agent/inbox/:id/ack`.
- **Retention**: events are kept forever. No TTL. Purge manually if/when needed.

## Setup

```bash
cp .env.example .env
# Generate ADMIN_TOKEN and ENCRYPTION_KEY:
node -e "console.log('ADMIN_TOKEN=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"

npm install
npm run dev   # or: npm start
```

Requires MongoDB reachable at `MONGO_URI`. Runs on `PORT` (default 3000). Put a reverse proxy with TLS termination in front of it in production and set `TRUST_PROXY=1`.

## Bootstrap flow

All `admin` calls require `X-Admin-Token: $ADMIN_TOKEN`.

### 1. Create a webhook

```bash
curl -sS -X POST http://localhost:3000/admin/webhooks \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"primary"}'
```

Response (the `secret` is shown exactly once — save it):

```json
{
  "webhook": { "_id": "...", "name": "primary", "subscribers": [], ... },
  "secret": "e3b0c44298fc1c149afbf4c8996fb9242...",
  "deliveryUrl": "http://localhost:3000/webhooks/github/<id>"
}
```

### 2. Register the webhook with GitHub

In the target repo/org **Settings → Webhooks → Add webhook**:

- **Payload URL**: the `deliveryUrl` returned above (use your public HTTPS host).
- **Content type**: `application/json`.
- **Secret**: the `secret` from the response.
- **Events**: whatever you want to receive.

### 3. Create an agent

```bash
curl -sS -X POST http://localhost:3000/admin/agents \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"worker-1"}'
```

Response (the `apiKey` is shown exactly once — save it):

```json
{
  "agent": { "_id": "...", "name": "worker-1", "publicId": "...", ... },
  "apiKey": "agt.xxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
}
```

### 4. Subscribe the agent to the webhook

```bash
curl -sS -X POST http://localhost:3000/admin/webhooks/<webhookId>/subscribers \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"agentId":"<agentId>"}'
```

Multiple agents can subscribe to the same webhook — each gets its own delivery row.

## Agent polling loop

```bash
AGENT_KEY="agt.<publicId>.<secret>"

# Fetch unread deliveries, oldest first, page size 50.
curl -sS "http://localhost:3000/agent/inbox?status=unread&limit=50" \
  -H "Authorization: Bearer $AGENT_KEY"

# Fetch a full event.
curl -sS "http://localhost:3000/agent/inbox/<deliveryId>" \
  -H "Authorization: Bearer $AGENT_KEY"

# Ack a single delivery.
curl -sS -X POST "http://localhost:3000/agent/inbox/<deliveryId>/ack" \
  -H "Authorization: Bearer $AGENT_KEY"

# Batch ack.
curl -sS -X POST "http://localhost:3000/agent/inbox/ack" \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H 'content-type: application/json' \
  -d '{"deliveryIds":["id1","id2","id3"]}'
```

Pagination uses cursor-based forward iteration:

```
GET /agent/inbox?status=unread&limit=50
→ { items: [...], nextCursor: "..." }

GET /agent/inbox?status=unread&limit=50&cursor=<nextCursor>
```

Iterate until `nextCursor` is `null`.

## Admin API reference

| Method | Path                                       | Purpose                                            |
| ------ | ------------------------------------------ | -------------------------------------------------- |
| POST   | `/admin/webhooks`                          | Create webhook, returns plaintext secret once      |
| GET    | `/admin/webhooks`                          | List webhooks                                      |
| GET    | `/admin/webhooks/:id`                      | Get webhook                                        |
| DELETE | `/admin/webhooks/:id`                      | Delete webhook                                     |
| POST   | `/admin/webhooks/:id/rotate-secret`        | Rotate HMAC secret (returns new plaintext once)    |
| POST   | `/admin/webhooks/:id/subscribers`          | Add subscriber (`{ agentId }`)                     |
| DELETE | `/admin/webhooks/:id/subscribers/:agentId` | Remove subscriber                                  |
| POST   | `/admin/agents`                            | Create agent, returns plaintext apiKey once        |
| GET    | `/admin/agents`                            | List agents                                        |
| GET    | `/admin/agents/:id`                        | Get agent                                          |
| DELETE | `/admin/agents/:id`                        | Delete agent (also removes from all subscriptions) |
| POST   | `/admin/agents/:id/rotate-key`             | Rotate API key (returns new plaintext once)        |
| POST   | `/admin/agents/:id/disable`                | Set `{ disabled: true \| false }`                  |


## Security notes

- `secret` and `apiKey` are returned **once, at creation** (and on rotation). There is no "reveal" endpoint — rotate if you lose the plaintext.
- GitHub HMAC verification is constant-time and rejects missing/mismatched headers before touching the DB user data.
- Agent API keys are stored as argon2id hashes. Lookup is by the public id portion of the token; the secret is verified with `argon2.verify`.
- Webhook HMAC secrets are AES-256-GCM encrypted at rest using `ENCRYPTION_KEY`. Losing this key makes existing webhook secrets unrecoverable — rotate them.
- Rate limits are applied to `/admin`, `/agent`, and `/webhooks/github` independently. Tune in `src/app.js` if needed.
- Run behind a reverse proxy that terminates TLS. Set `TRUST_PROXY=1` so `express-rate-limit` and request logging see real client IPs.
- No CORS: this server is called only by GitHub and internal agents.

## Out of scope (v1)

- Per-subscription event-type filters (agents filter client-side).
- Automatic purge / TTL (retention is forever, by design).
- Long-polling, SSE, WebSocket delivery.
- Multi-tenant isolation beyond admin/agent boundaries.
- Web UI.
