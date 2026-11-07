'use strict';
const crypto = require('crypto');
const cache = new Map();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (m, k) => crypto.createHmac('sha256', k).update(m).digest('hex').toUpperCase();

function defaults() { return { id: process.env.TUYA_ID, secret: process.env.TUYA_SECRET, region: process.env.TUYA_REGION || 'eu' }; }
function credsOf(home) {
  if (home && home.tuya) { try { const c = JSON.parse(home.tuya); if (c.id && c.secret) return c; } catch (e) { /* ignore */ } }
  return defaults();
}
async function raw(c, method, path, body, tok) {
  const base = process.env.TUYA_BASE_URL || `https://openapi.tuya${c.region || 'eu'}.com`;
  const t = Date.now().toString();
  const sts = `${method}\n${sha(body)}\n\n${path}`;
  const headers = { client_id: c.id, sign: hmac(c.id + tok + t + sts, c.secret), t, sign_method: 'HMAC-SHA256' };
  if (tok) headers.access_token = tok;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(base + path, { method, headers, body: body || undefined, signal: AbortSignal.timeout(20000) });
  return r.json();
}
async function token(c, force) {
  const e = cache.get(c.id);
  if (!force && e && Date.now() < e.exp) return e.tok;
  const r = await raw(c, 'GET', '/v1.0/token?grant_type=1', '', '');
  if (!r.success) throw new Error('Tuya token: ' + (r.msg || JSON.stringify(r)));
  cache.set(c.id, { tok: r.result.access_token, exp: Date.now() + ((r.result.expire_time || 7200) - 120) * 1000 });
  return r.result.access_token;
}
async function call(c, method, path, bodyObj) {
  if (!c || !c.id || !c.secret) throw new Error('Tuya kalitlari serverda sozlanmagan (.env)');
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  let r = await raw(c, method, path, body, await token(c));
  if (r && (r.code === 1010 || r.code === 1011)) r = await raw(c, method, path, body, await token(c, true));
  return r;
}
module.exports = { call, credsOf, defaults };
