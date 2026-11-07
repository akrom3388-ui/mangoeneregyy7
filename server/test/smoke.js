// Smoke test: mock Tuya + full API flow. Run: npm test
process.env.DB_PATH = ':memory:'; process.env.JWT_SECRET = 'test'; process.env.TUYA_ID = 'id'; process.env.TUYA_SECRET = 'sec';
process.env.ALICE_CLIENT_ID = 'ac'; process.env.ALICE_CLIENT_SECRET = 'as';
const http = require('http'), assert = require('assert');
const dev = { switch: true, temp_set: 450, temp_current: 380, temp_in: 300, temp_out: 380, temp_outdoor: -35, compressor_state: true, pump_state: true, defrost: false };
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const send = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.url.startsWith('/v1.0/token')) return send({ success: true, result: { access_token: 'T', expire_time: 7200 } });
    if (req.url.endsWith('/status')) return send({ success: true, result: Object.entries(dev).map(([code, value]) => ({ code, value })) });
    if (req.url.endsWith('/specifications')) return send({ success: true, result: { functions: [{ code: 'switch', type: 'Boolean', values: '{}' }, { code: 'temp_set', type: 'Integer', values: '{"min":200,"max":750,"scale":1,"step":5}' }], status: [{ code: 'temp_current', type: 'Integer', values: '{"scale":1}' }, { code: 'temp_in', type: 'Integer', values: '{"scale":1}' }, { code: 'temp_out', type: 'Integer', values: '{"scale":1}' }, { code: 'temp_outdoor', type: 'Integer', values: '{"scale":1}' }] } });
    if (req.url.endsWith('/commands')) { JSON.parse(b).commands.forEach(c => { dev[c.code] = c.value; }); return send({ success: true, result: true }); }
    if (/\/v1\.0\/devices\/\w+$/.test(req.url)) return send({ success: true, result: { online: true } });
    send({ success: false, msg: 'nf' });
  });
}).listen(0, async () => {
  process.env.TUYA_BASE_URL = 'http://127.0.0.1:' + mock.address().port;
  const { app } = require('../src/index.js'), poller = require('../src/poller'), db = require('../src/db');
  const srv = app.listen(0); const base = 'http://127.0.0.1:' + srv.address().port;
  const api = async (m, p, body, tok) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  try {
    let r = await api('POST', '/api/auth/register', { login: 'a@b.uz', password: 'secret1', name: 'A' }); assert.equal(r.s, 200); const T = r.j.token;
    r = await api('POST', '/api/auth/login', { login: 'a@b.uz', password: 'bad' }); assert.equal(r.s, 401);
    r = await api('POST', '/api/homes', { name: 'Uy', price: 1000, lat: 41.3, lon: 69.2 }, T); const hid = r.j.id;
    r = await api('POST', `/api/homes/${hid}/devices`, { tuya_id: 'abc123', name: 'Nasos' }, T); assert.equal(r.s, 200, JSON.stringify(r.j)); const did = r.j.id;
    r = await api('POST', `/api/homes/${hid}/devices`, { tuya_id: 'abc123' }, T); assert.equal(r.s, 409);
    await api('PATCH', `/api/devices/${did}`, { cfg: { compW: 2500, pumpW: 100, flowLpm: 20 } }, T);
    for (let i = 0; i < 3; i++) { db.prepare('update devices set last_poll=0').run(); await new Promise(r => setTimeout(r, 1100)); await poller.tick(); }
    r = await api('GET', `/api/devices/${did}`, null, T); assert.equal(r.j.online, true);
    assert.equal(r.j.values.temp_set, 45); assert.ok(r.j.derived.w >= 2600, 'power est'); assert.ok(r.j.derived.q > 0, 'thermal power'); assert.ok(db.prepare('select sum(kwh) k from h1').get().k > 0, 'kwh integrated');
    console.log('device ok: w=%s q=%s kwh=%s cop=%s', r.j.derived.w, r.j.derived.q.toFixed(2), r.j.today.kwh, r.j.today.cop);
    r = await api('POST', `/api/devices/${did}/command`, { code: 'temp_set', value: 50 }, T); assert.equal(r.s, 200); assert.equal(dev.temp_set, 500);
    r = await api('PUT', `/api/devices/${did}/auto`, { base: 45, schedule: { enabled: true, outside: 'off', slots: [{ days: [1, 2, 3, 4, 5, 6, 7], from: '00:00', to: '23:59', setpoint: 45 }] }, weather: { enabled: true, source: 'device', below: 3 } }, T); assert.equal(r.s, 200);
    db.prepare('update devices set last_poll=0').run(); await poller.tick();
    assert.equal(dev.temp_set, 470, 'auto: base 45 + 2 (outdoor -3.5) = 47');
    for (const p of ['day', 'week', 'month', 'year']) { r = await api('GET', `/api/devices/${did}/stats?period=${p}`, null, T); assert.equal(r.s, 200, p); assert.ok(r.j.buckets.length > 0); }
    assert.ok(Array.isArray(r.j.sessions) && r.j.season === undefined); r = await api('GET', `/api/devices/${did}/stats?period=month`, null, T); assert.ok(r.j.forecast.kwh >= 0);
    r = await api('GET', `/api/devices/${did}/series?hours=24`, null, T); assert.ok(r.j.length >= 1);
    dev.switch = false; dev.compressor_state = false; db.prepare('update devices set last_poll=0').run(); await poller.tick();
    r = await api('GET', '/api/alerts?lang=ru', null, T); assert.ok(r.j.some(a => a.kind === 'freeze_risk'), 'freeze alert'); console.log('alert:', r.j[0].title);
    r = await api('GET', '/api/summary?since=0&lang=uzc', null, T); assert.equal(r.j.devices.length, 1); assert.ok(r.j.alerts.length >= 1); console.log('summary alert (uzc):', r.j.alerts[0].title);
    r = await api('POST', `/api/homes/${hid}/invite`, { role: 'view' }, T); const code = r.j.code;
    const u2 = (await api('POST', '/api/auth/register', { login: 'f@b.uz', password: 'secret2' })).j.token;
    assert.equal((await api('POST', '/api/join', { code }, u2)).s, 200);
    assert.equal((await api('POST', `/api/devices/${did}/command`, { code: 'switch', value: true }, u2)).s, 403);
    assert.equal((await api('GET', `/api/devices/${did}`, null, u2)).s, 200);
    // Alisa
    const loc = await fetch(base + '/alice/oauth/authorize', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'ac', redirect_uri: 'https://social.yandex.net/broker/redirect', state: 'x', login: 'a@b.uz', password: 'secret1' }) });
    assert.equal(loc.status, 302); const code2 = new URL(loc.headers.get('location')).searchParams.get('code');
    const tk = await (await fetch(base + '/alice/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: code2, client_id: 'ac', client_secret: 'as' }) })).json(); assert.ok(tk.access_token);
    r = await api('GET', '/alice/v1.0/user/devices', null, tk.access_token); assert.equal(r.j.payload.devices[0].id, 'd' + did);
    r = await api('POST', '/alice/v1.0/user/devices/action', { payload: { devices: [{ id: 'd' + did, capabilities: [{ type: 'devices.capabilities.on_off', state: { instance: 'on', value: true } }] }] } }, tk.access_token);
    assert.equal(r.j.payload.devices[0].capabilities[0].state.action_result.status, 'DONE'); assert.equal(dev.switch, true);
    assert.equal((await api('GET', '/api/me', null, tk.access_token)).s, 401, 'alice token must not work on app API');
    console.log('ALL TESTS PASSED');
  } catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  srv.close(); mock.close(); process.exit(process.exitCode || 0);
});
