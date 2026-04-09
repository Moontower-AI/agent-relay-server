'use strict';

// Fan-out logic: given an Event and the list of subscribed agent ids, create
// one Delivery row per subscriber. The unique (eventId, agentId) index makes
// retries idempotent — duplicates are silently dropped.

const Delivery = require('../models/Delivery');

async function fanOut({ event, webhookId, subscriberIds }) {
  if (!Array.isArray(subscriberIds) || subscriberIds.length === 0) {
    return { created: 0 };
  }
  const docs = subscriberIds.map((agentId) => ({
    eventId: event._id,
    agentId,
    webhookId,
    status: 'unread',
  }));

  try {
    const inserted = await Delivery.insertMany(docs, { ordered: false });
    return { created: inserted.length };
  } catch (err) {
    // Duplicate key (11000) means a retry raced us — treat as success for the
    // rows that made it in, ignore the dupes.
    if (err?.code === 11000 || err?.writeErrors) {
      const insertedCount =
        err.result?.nInserted ??
        (Array.isArray(err.insertedDocs) ? err.insertedDocs.length : 0);
      return { created: insertedCount };
    }
    throw err;
  }
}

module.exports = { fanOut };
