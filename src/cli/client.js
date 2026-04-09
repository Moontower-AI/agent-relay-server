'use strict';

// Minimal admin API client. Uses the Node 18+ built-in fetch so no extra
// dependencies are pulled in. All admin endpoints live under /admin and
// require the `x-admin-token` header (see src/middleware/adminAuth.js).
//
// Error response shape from src/middleware/errorHandler.js is FLAT:
//   { error: '<code>', message?: '<human>', details?: [...] }

async function adminRequest(ctx, method, path, body) {
  const url = `${ctx.baseUrl}/admin${path}`;
  const headers = { 'x-admin-token': ctx.token };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    const err = new Error(`${cause.message} (${url})`);
    err.code = 'network';
    err.cause = cause;
    throw err;
  }

  if (res.status === 204) return null;

  let json;
  try {
    json = await res.json();
  } catch {
    json = {};
  }

  if (!res.ok) {
    const err = new Error(json.message || res.statusText || `HTTP ${res.status}`);
    err.code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    err.status = res.status;
    err.details = json.details;
    throw err;
  }

  return json;
}

module.exports = { adminRequest };
