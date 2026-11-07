'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');
const tuya = require('./tuya');
const L = require('./lib');
const poller = require('./poller');
const J = poller.J;

const SECRET = process.env.JWT_SECRET || (() => { console.warn('JWT_SECRET berilmagan: vaqtinchalik kalit ishlatilmoqda (qayta ishga tushganda tokenlar bekor bo\'ladi)'); return crypto.randomBytes(32).toString('hex'); })();
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false }));

// ---------- helpers ----------
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => { console.error(e); res.status(500).json({ error: 'server_error', message: e.message }); });
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const checkPw = (pw, h) => { const [s, x] = h.split(':'); const y = hashPw(pw, s).split(':')[1]; return crypto.timingSafeEqual(Buffer.from(x, 'hex'), Buffer.from(y, 'hex')); };
const tries = new Map();
function limited(key) { const n = Date.now(), a = (tries.get(key) || []).filter(t => n - t < 600000); a.push(n); tries.set(key, a); return a.length > 10; }
const sign = (u, extra, exp) => jwt.sign(Object.assign({ uid: u }, extra || {}), SECRET, { expiresIn: exp || '90d' });
function auth(scope) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    try { const p = jwt.verify(h.replace(/^Bearer /i, ''), SECRET); if ((p.scope || 'app') !== (scope || 'app')) throw 0; req.uid = p.uid; req.jwt = p; next(); }
    catch (e) { res.status(401).json({ error: 'unauthorized' }); }
  };
}
const ROLE_RANK = { view: 1, control: 2, owner: 3 };
function homeRole(uid, hid) { const m = db.prepare('select role from members where home_id=? and user_id=?').get(hid, uid); return m ? m.role : null; }
function devAccess(req, res, min) {
  const d = db.prepare('select * from devices where id=?').get(+req.params.id);
  const role = d && homeRole(req.uid, d.home_id);
  if (!d || !role) { res.status(404).json({ error: 'not_found' }); return null; }
  if (ROLE_RANK[role] < ROLE_RANK[min || 'view']) { res.status(403).json({ error: 'forbidden' }); return null; }
  return { d, role, home: db.prepare('select * from homes where id=?').get(d.home_id) };
}
const userDevices = uid => db.prepare('select d.*,m.role from devices d join members m on m.home_id=d.home_id where m.user_id=?').all(uid);
function pubDev(d, role) { return { id: d.id, home_id: d.home_id, name: d.name, role, online: !!d.online }; }

// ---------- auth ----------
app.get('/health', (q, r) => r.json({ ok: true }));
app.post('/api/auth/register', wrap((req, res) => {
  if (process.env.ALLOW_REGISTER === '0') return res.status(403).json({ error: 'register_closed' });
  const { login, password, name } = req.body || {};
  if (!login || !password || String(password).length < 6) return res.status(400).json({ error: 'bad_input' });
  if (db.prepare('select 1 from users where login=?').get(String(login).toLowerCase())) return res.status(409).json({ error: 'exists' });
  const id = db.prepare('insert into users(login,name,pass,created) values(?,?,?,?)').run(String(login).toLowerCase(), name || login, hashPw(String(password)), Date.now()).lastInsertRowid;
  res.json({ token: sign(id), user: { id, login, name: name || login } });
}));
app.post('/api/auth/login', wrap((req, res) => {
  const { login, password } = req.body || {};
  if (limited(req.ip + '|' + login)) return res.status(429).json({ error: 'too_many' });
  const u = db.prepare('select * from users where login=?').get(String(login || '').toLowerCase());
  if (!u || !checkPw(String(password || ''), u.pass)) return res.status(401).json({ error: 'bad_credentials' });
  res.json({ token: sign(u.id), user: { id: u.id, login: u.login, name: u.name } });
}));
app.get('/api/me', auth(), wrap((req, res) => {
  const u = db.prepare('select id,login,name from users where id=?').get(req.uid);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  const homes = db.prepare('select h.id,h.name,h.tz,h.lat,h.lon,h.price,h.tariff,m.role from homes h join members m on m.home_id=h.id where m.user_id=?').all(req.uid);
  homes.forEach(h => { h.tariff = h.tariff ? J(h.tariff) : null; h.devices = db.prepare('select * from devices where home_id=?').all(h.id).map(d => pubDev(d, h.role)); });
  res.json({ user: u, homes });
}));
app.delete('/api/me', auth(), wrap((req, res) => {
  db.prepare('delete from members where user_id=?').run(req.uid); db.prepare('delete from users where id=?').run(req.uid); res.json({ ok: true });
}));

// ---------- homes ----------
app.post('/api/homes', auth(), wrap((req, res) => {
  const b = req.body || {}; if (!b.name) return res.status(400).json({ error: 'bad_input' });
  const id = db.prepare('insert into homes(name,tz,lat,lon,price,tariff,created) values(?,?,?,?,?,?,?)').run(b.name, b.tz || 'Asia/Tashkent', b.lat ?? null, b.lon ?? null, +b.price || 0, b.tariff ? JSON.stringify(b.tariff) : null, Date.now()).lastInsertRowid;
  db.prepare('insert into members values(?,?,?)').run(id, req.uid, 'owner'); res.json({ id });
}));
app.patch('/api/homes/:id', auth(), wrap((req, res) => {
  const id = +req.params.id; if (homeRole(req.uid, id) !== 'owner') return res.status(403).json({ error: 'forbidden' });
  const b = req.body || {}, h = db.prepare('select * from homes where id=?').get(id);
  db.prepare('update homes set name=?,tz=?,lat=?,lon=?,price=?,tariff=? where id=?').run(b.name ?? h.name, b.tz ?? h.tz, b.lat === undefined ? h.lat : b.lat, b.lon === undefined ? h.lon : b.lon, b.price === undefined ? h.price : +b.price, b.tariff === undefined ? h.tariff : (b.tariff ? JSON.stringify(b.tariff) : null), id);
  res.json({ ok: true });
}));
app.post('/api/homes/:id/invite', auth(), wrap((req, res) => {
  const id = +req.params.id; if (homeRole(req.uid, id) !== 'owner') return res.status(403).json({ error: 'forbidden' });
  const role = req.body && req.body.role === 'control' ? 'control' : 'view', code = crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare('insert into invites values(?,?,?,?)').run(code, id, role, Date.now() + 48 * 3600e3); res.json({ code, role, hours: 48 });
}));
app.post('/api/join', auth(), wrap((req, res) => {
  const inv = db.prepare('select * from invites where code=? and exp>?').get(String((req.body || {}).code || '').toUpperCase(), Date.now());
  if (!inv) return res.status(404).json({ error: 'bad_code' });
  if (!homeRole(req.uid, inv.home_id)) db.prepare('insert into members values(?,?,?)').run(inv.home_id, req.uid, inv.role);
  db.prepare('delete from invites where code=?').run(inv.code); res.json({ home_id: inv.home_id });
}));
app.get('/api/homes/:id/members', auth(), wrap((req, res) => {
  const id = +req.params.id; if (!homeRole(req.uid, id)) return res.status(404).json({ error: 'not_found' });
  res.json(db.prepare('select u.id,u.name,u.login,m.role from members m join users u on u.id=m.user_id where m.home_id=?').all(id));
}));
app.patch('/api/homes/:id/members/:uid', auth(), wrap((req, res) => {
  const id = +req.params.id; if (homeRole(req.uid, id) !== 'owner' || +req.params.uid === req.uid) return res.status(403).json({ error: 'forbidden' });
  const role = req.body && req.body.role === 'control' ? 'control' : 'view';
  db.prepare('update members set role=? where home_id=? and user_id=?').run(role, id, +req.params.uid); res.json({ ok: true });
}));
app.delete('/api/homes/:id/members/:uid', auth(), wrap((req, res) => {
  const id = +req.params.id, target = +req.params.uid;
  if (target !== req.uid && homeRole(req.uid, id) !== 'owner') return res.status(403).json({ error: 'forbidden' });
  if (homeRole(target, id) === 'owner') return res.status(400).json({ error: 'owner_cannot_leave' });
  db.prepare('delete from members where home_id=? and user_id=?').run(id, target); res.json({ ok: true });
}));

// ---------- devices ----------
app.post('/api/homes/:id/devices', auth(), wrap(async (req, res) => {
  const hid = +req.params.id; if (homeRole(req.uid, hid) !== 'owner') return res.status(403).json({ error: 'forbidden' });
  const { tuya_id, name } = req.body || {}; if (!tuya_id) return res.status(400).json({ error: 'bad_input' });
  const exist = db.prepare('select home_id from devices where tuya_id=?').get(tuya_id);
  if (exist) return res.status(409).json({ error: exist.home_id === hid ? 'already_added' : 'claimed' });
  const home = db.prepare('select * from homes where id=?').get(hid), c = tuya.credsOf(home);
  const s = await tuya.call(c, 'GET', `/v1.0/devices/${tuya_id}/status`);
  if (!s.success) return res.status(400).json({ error: 'tuya', message: s.msg || 'Qurilma topilmadi' });
  const sp = await tuya.call(c, 'GET', `/v1.0/devices/${tuya_id}/specifications`), spec = {};
  if (sp.success) for (const f of [].concat((sp.result || {}).functions || [], (sp.result || {}).status || [])) {
    let v = {}; try { v = JSON.parse(f.values || '{}'); } catch (e) { /* */ }
    spec[f.code] = Object.assign({ type: f.type, name: f.name, writable: (sp.result.functions || []).some(x => x.code === f.code) }, v);
  }
  const st = {}; s.result.forEach(x => { st[x.code] = x.value; });
  const id = db.prepare('insert into devices(home_id,tuya_id,name,cfg,spec,status,online,created) values(?,?,?,?,?,?,1,?)').run(hid, tuya_id, name || 'Nasos', JSON.stringify(L.withDefaults({})), JSON.stringify(spec), JSON.stringify(st), Date.now()).lastInsertRowid;
  res.json({ id, codes: Object.keys(spec), suggest: { power: Object.keys(spec).filter(k => /power|energy/i.test(k)) } });
}));
app.get('/api/devices/:id', auth(), wrap((req, res) => {
  const a = devAccess(req, res); if (!a) return; const { d, role, home } = a;
  db.prepare('update devices set live_until=? where id=?').run(Date.now() + 60000, d.id);
  let cfg = J(d.cfg); if (!cfg._dv) { cfg = L.withDefaults(cfg); db.prepare('update devices set cfg=? where id=?').run(JSON.stringify(cfg), d.id); d.cfg = JSON.stringify(cfg); }
  { const mg = L.migrateCfg(cfg); if (mg) { cfg = mg; db.prepare('update devices set cfg=? where id=?').run(JSON.stringify(cfg), d.id); d.cfg = JSON.stringify(cfg); } }
  const spec = J(d.spec), st = J(d.status), der = L.derive(cfg, spec, st), now = Date.now();
  const off = L.tzOffset(home.tz || 'Asia/Tashkent', now), day0 = Math.floor((now + off) / L.DAY) * L.DAY - off;
  const t = db.prepare('select sum(kwh) kwh,sum(kwh_th) th,sum(comp_s) cs,sum(starts) st,sum(defr_n) df,sum(defr_s) dfs from h1 where dev=? and ts>=?').get(d.id, day0);
  const tariff = home.tariff ? J(home.tariff) : null, mStart = Date.UTC(new Date(now + off).getUTCFullYear(), new Date(now + off).getUTCMonth(), 1) - off;
  const mRows = db.prepare('select ts,kwh from h1 where dev=? and ts>=?').all(d.id, mStart), mCosts = L.hourCosts(mRows, home.price || 0, tariff, off);
  let todayCost = 0; for (const r of mRows) if (r.ts >= day0) todayCost += mCosts.get(r.ts) || 0;
  const nowPrice = L.curPrice(L.monthKwh(mRows, off, now), tariff, home.price || 0);
  const ev = db.prepare("select ts,end_ts from events where dev=? and kind='defrost' order by ts desc limit 1").get(d.id);
  let lastSession = null; {
    const ls = db.prepare('select * from ses where dev=? order by s desc limit 1').get(d.id);
    if (ls) { const ms = Date.UTC(new Date(ls.s + off).getUTCFullYear(), new Date(ls.s + off).getUTCMonth(), 1) - off, rr = db.prepare('select ts,kwh from h1 where dev=? and ts>=?').all(d.id, ms); lastSession = L.sessionOut(Object.assign({}, ls, { h: J(ls.h) }), new Map(rr.map(r => [r.ts, r.kwh])), L.hourCosts(rr, home.price || 0, tariff, off), now); }
  }
  res.json({
    id: d.id, name: d.name, role, online: !!d.online, age: d.last_ok ? Math.round((now - d.last_ok) / 1000) : null,
    values: L.scaled(spec, st), spec, cfg, derived: der, price: nowPrice, tz: home.tz, tariff,
    today: { cost: Math.round(todayCost), kwh: +(t.kwh || 0).toFixed(2), kwh_th: +(t.th || 0).toFixed(2), comp_h: +((t.cs || 0) / 3600).toFixed(2), starts: t.st || 0, defr: t.df || 0, defr_min: +((t.dfs || 0) / 60).toFixed(1), cop: t.kwh > 0.2 && t.th > 0 ? +(t.th / t.kwh).toFixed(2) : null },
    lastSession, lastDefrost: ev || null, hold: J(d.state).holdUntil > now ? J(d.state).holdUntil : 0
  });
}));
app.patch('/api/devices/:id', auth(), wrap((req, res) => {
  const a = devAccess(req, res, 'owner'); if (!a) return; const b = req.body || {};
  if (b.name) db.prepare('update devices set name=? where id=?').run(b.name, a.d.id);
  if (b.cfg && typeof b.cfg === 'object') db.prepare('update devices set cfg=? where id=?').run(JSON.stringify(b.cfg), a.d.id);
  res.json({ ok: true });
}));
app.delete('/api/devices/:id', auth(), wrap((req, res) => {
  const a = devAccess(req, res, 'owner'); if (!a) return;
  ['m5', 'h1'].forEach(t => db.prepare(`delete from ${t} where dev=?`).run(a.d.id));
  db.prepare('delete from events where dev=?').run(a.d.id); db.prepare('delete from alerts where dev=?').run(a.d.id); db.prepare('delete from devices where id=?').run(a.d.id); res.json({ ok: true });
}));
app.post('/api/devices/:id/command', auth(), wrap(async (req, res) => {
  const a = devAccess(req, res, 'control'); if (!a) return; const { code, value } = req.body || {}, spec = J(a.d.spec);
  if (!code || !(spec[code] || J(a.d.status)[code] !== undefined)) return res.status(400).json({ error: 'bad_code' });
  const r = await poller.sendCommand(a.d, a.home, code, value);
  if (!r.success) return res.status(502).json({ error: 'tuya', message: r.msg });
  const st = J(a.d.status), state = J(a.d.state), auto = J(a.d.auto);
  st[code] = poller.rawValue(spec, code, value); state.holdUntil = Date.now() + (+auto.holdMin || 120) * 60000;
  if (code === 'switch' && auto.schedule && auto.schedule.enabled) { const sk = L.slotKey(auto.schedule, a.home.tz || 'Asia/Tashkent', Date.now()); state.doneKey = sk ? sk.key : 'off:' + (state.lastSlotKey || ''); }
  db.prepare('update devices set status=?,state=?,last_poll=0,live_until=? where id=?').run(JSON.stringify(st), JSON.stringify(state), Date.now() + 60000, a.d.id);
  db.prepare('insert into events(dev,kind,ts,end_ts,info) values(?,?,?,?,?)').run(a.d.id, 'cmd', Date.now(), Date.now(), `${req.uid}:${code}=${value}`);
  res.json({ ok: true });
}));
app.get('/api/devices/:id/auto', auth(), wrap((req, res) => { const a = devAccess(req, res); if (a) res.json(J(a.d.auto)); }));
app.put('/api/devices/:id/auto', auth(), wrap((req, res) => {
  const a = devAccess(req, res, 'control'); if (!a) return; const b = req.body || {};
  const clean = {
    base: b.base === '' || b.base == null ? null : +b.base, holdMin: +b.holdMin || 120,
    schedule: { enabled: !!(b.schedule || {}).enabled, outside: (b.schedule || {}).outside === 'keep' ? 'keep' : 'off', slots: ((b.schedule || {}).slots || []).slice(0, 28).map(s => ({ days: (s.days || []).map(Number).filter(x => x >= 1 && x <= 7), from: s.from, to: s.to, setpoint: s.setpoint === '' || s.setpoint == null ? null : +s.setpoint, mode: s.mode ? String(s.mode).slice(0, 40) : null })) },
    weather: { enabled: !!(b.weather || {}).enabled, source: (b.weather || {}).source === 'forecast' ? 'forecast' : 'device', below: (b.weather || {}).below === '' || (b.weather || {}).below == null || isNaN(+(b.weather || {}).below) ? 3 : +(b.weather || {}).below, rules: [] }
  };
  const state = J(a.d.state); state.holdUntil = 0; state.lastAuto = 0; state.doneKey = null;
  db.prepare('update devices set auto=?,state=? where id=?').run(JSON.stringify(clean), JSON.stringify(state), a.d.id); res.json({ ok: true });
}));

// ---------- series / stats ----------
app.get('/api/devices/:id/series', auth(), wrap((req, res) => {
  const a = devAccess(req, res); if (!a) return; const hours = Math.min(+req.query.hours || 24, 336), from = Date.now() - hours * 3600e3;
  const step = hours <= 24 ? 1 : hours <= 72 ? 3 : 12;
  const rows = db.prepare('select ts,p,tc,tout,tin,tamb,tset,tbuf,hz,cp from m5 where dev=? and ts>=? order by ts').all(a.d.id, from).filter((r, i) => i % step === 0);
  res.json(rows);
}));
app.get('/api/devices/:id/stats', auth(), wrap((req, res) => {
  const a = devAccess(req, res); if (!a) return; const period = ['day', 'week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'month';
  const tz = a.home.tz || 'Asia/Tashkent', now = Date.now(), off = L.tzOffset(tz, now), price = a.home.price || 0, shift = period === 'day' ? Math.min(Math.max(+req.query.shift || 0, 0), 60) : 0, R = L.rangeFor(period, off, now - shift * L.DAY);
  const sel = db.prepare('select * from h1 where dev=? and ts>=? and ts<?');
  const tariff = a.home.tariff ? J(a.home.tariff) : null, allRows = db.prepare('select ts,kwh from h1 where dev=? and ts>=?').all(a.d.id, Math.min(R.ps, Date.UTC(new Date(R.nl).getUTCFullYear() - 1, 0, 1)) - off), costs = L.hourCosts(allRows, price, tariff, off);
  const cur = L.aggregate(sel.all(a.d.id, R.s - off, R.e - off), off, R.key, costs), prev = L.aggregate(sel.all(a.d.id, R.ps - off, R.pe - off), off, R.key, costs);
  const sum = m => { const t = { k: '', kwh: 0, kwh_th: 0, comp_s: 0, starts: 0, defr: 0, to_sum: 0, to_n: 0, hz_sum: 0, cost: 0 }; for (const b of m.values()) for (const k of ['kwh', 'kwh_th', 'comp_s', 'starts', 'defr', 'to_sum', 'to_n', 'hz_sum', 'cost']) t[k] += b[k]; return L.fin(t, price); };
  const buckets = R.keys.map(k => L.fin(cur.get(k) || { k, kwh: 0, kwh_th: 0, comp_s: 0, starts: 0, defr: 0, to_sum: 0, to_n: 0, hz_sum: 0, cost: 0 }, price));
  const out = { period, shift, buckets, total: sum(cur), prev: sum(prev) };
  // v3.5: every hour and every pump session of the selected period (detailed table)
  if (period !== 'year') out.hours = L.hourRows(sel.all(a.d.id, R.s - off, R.e - off), costs, off);
  { const ses = db.prepare('select * from ses where dev=? and s<? and (e is null or e>=?) order by s desc').all(a.d.id, R.e - off, R.s - off), rowKwh = new Map(allRows.map(r => [r.ts, r.kwh]));
    out.sessions = ses.map(x => L.sessionOut(Object.assign({}, x, { h: J(x.h) }), rowKwh, costs, now)); }
  if (period === 'month') {
    const elapsed = Math.max((R.nl - R.s) / L.DAY, 0.05), left = (R.e - R.nl) / L.DAY;
    const w = db.prepare('select sum(kwh) k from h1 where dev=? and ts>=?').get(a.d.id, now - 7 * 864e5).k || 0;
    const avg = (R.nl - R.s) >= 7 * L.DAY ? w / 7 : out.total.kwh / elapsed;
    const f = out.total.kwh + avg * left; out.forecast = { kwh: +f.toFixed(1), cost: Math.round(out.total.cost + avg * left * L.curPrice(f, tariff, price)), per_day: +avg.toFixed(2) };
  }
  // correlation (daily kWh vs outdoor temperature) over the heating months
  const nd = new Date(R.nl), sy = nd.getUTCMonth() >= 9 ? nd.getUTCFullYear() : nd.getUTCFullYear() - 1, sStart = Date.UTC(sy, 9, 1);
  const sRows = db.prepare('select * from h1 where dev=? and ts>=?').all(a.d.id, sStart - off), sAgg = L.aggregate(sRows, off, 10, L.hourCosts(sRows, price, tariff, off)), days = [...sAgg.values()].map(b => L.fin(b, price));
  const pairs = days.filter(x => x.tout != null && x.kwh > 0.5).slice(-60).map(x => [x.tout, x.kwh]);
  out.corr = { pairs, fit: L.regress(pairs) };
  res.json(out);
}));
app.get('/api/devices/:id/events', auth(), wrap((req, res) => {
  const a = devAccess(req, res); if (a) res.json(db.prepare("select id,kind,ts,end_ts,info from events where dev=? and kind in ('defrost','auto') order by ts desc limit 50").all(a.d.id));
}));

// ---------- alerts / summary ----------
function alertRows(uid, lang, sinceId, limit) {
  const ids = userDevices(uid).map(d => d.id); if (!ids.length) return [];
  const rows = db.prepare(`select a.*,d.name dname from alerts a join devices d on d.id=a.dev where a.dev in (${ids.join(',')}) and a.id>? order by a.id desc limit ?`).all(sinceId, limit);
  return rows.map(r => Object.assign({ id: r.id, dev: r.dev, device: r.dname, kind: r.kind, level: r.level, ts: r.ts }, L.alertText(r.kind, J(r.params), lang)));
}
app.get('/api/alerts', auth(), wrap((req, res) => res.json(alertRows(req.uid, req.query.lang, 0, 60))));
app.get('/api/summary', auth(), wrap((req, res) => {
  const lang = req.query.lang || 'uz', devs = userDevices(req.uid);
  const maxA = devs.length ? db.prepare(`select coalesce(max(id),0) m from alerts where dev in (${devs.map(d => d.id).join(',')})`).get().m : 0;
  const since = req.query.since === undefined || req.query.since === '' ? -1 : +req.query.since;
  res.json({
    maxAlert: maxA, alerts: since < 0 ? [] : alertRows(req.uid, lang, since, 20).reverse(),
    devices: devs.map(d => { const der = L.derive(J(d.cfg), J(d.spec), J(d.status)); let tamb = der.tamb; if (tamb == null) { const m = db.prepare('select tamb from m5 where dev=? and tamb is not null order by ts desc limit 1').get(d.id); if (m) tamb = m.tamb; } return { id: d.id, name: d.name, online: !!d.online, tcur: der.tcur, tset: der.tset, tamb, kw: +(der.w / 1000).toFixed(2), comp: der.comp, on: der.on, defrost: der.defrost }; })
  });
}));

// ---------- Alisa (Yandex Smart Home) ----------
const ALICE_ID = process.env.ALICE_CLIENT_ID, ALICE_SECRET = process.env.ALICE_CLIENT_SECRET;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
app.get('/alice/oauth/authorize', (req, res) => {
  if (!ALICE_ID || req.query.client_id !== ALICE_ID) return res.status(400).send('bad client');
  const q = ['client_id', 'redirect_uri', 'state', 'response_type', 'scope'].map(k => `<input type=hidden name=${k} value="${esc(req.query[k])}">`).join('');
  res.send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;max-width:360px;margin:40px auto;padding:0 16px"><h2>Mango Monitor</h2><form method=post action=/alice/oauth/authorize>${q}<p><input name=login placeholder="Login" style="width:100%;padding:10px"></p><p><input name=password type=password placeholder="Parol" style="width:100%;padding:10px"></p><button style="padding:10px 20px">Kirish / Войти</button></form>`);
});
app.post('/alice/oauth/authorize', (req, res) => {
  const b = req.body || {}; if (!ALICE_ID || b.client_id !== ALICE_ID || limited(req.ip + '|alice')) return res.status(400).send('bad request');
  const u = db.prepare('select * from users where login=?').get(String(b.login || '').toLowerCase());
  if (!u || !checkPw(String(b.password || ''), u.pass)) return res.status(401).send('Login yoki parol xato');
  let ru; try { ru = new URL(b.redirect_uri); } catch (e) { return res.status(400).send('bad redirect'); }
  if (!/(^|\.)yandex\.(net|ru|com)$|(^|\.)yandex-team\.ru$/.test(ru.hostname) && !/^(localhost|127\.0\.0\.1)$/.test(ru.hostname)) return res.status(400).send('redirect not allowed');
  ru.searchParams.set('code', jwt.sign({ uid: u.id, scope: 'alice_code' }, SECRET, { expiresIn: '10m' })); if (b.state) ru.searchParams.set('state', b.state);
  res.redirect(ru.toString());
});
app.post('/alice/oauth/token', (req, res) => {
  const b = req.body || {}; if (!ALICE_ID || b.client_id !== ALICE_ID || b.client_secret !== ALICE_SECRET) return res.status(401).json({ error: 'invalid_client' });
  try {
    const p = jwt.verify(b.grant_type === 'refresh_token' ? b.refresh_token : b.code, SECRET), need = b.grant_type === 'refresh_token' ? 'alice_refresh' : 'alice_code';
    if (p.scope !== need) throw 0;
    res.json({ access_token: sign(p.uid, { scope: 'alice' }, '30d'), refresh_token: sign(p.uid, { scope: 'alice_refresh' }, '365d'), token_type: 'bearer', expires_in: 2592000 });
  } catch (e) { res.status(400).json({ error: 'invalid_grant' }); }
});
const alice = express.Router();
alice.head('/', (q, r) => r.sendStatus(200));
alice.use(auth('alice'));
alice.post('/user/unlink', (req, res) => res.json({ request_id: req.get('X-Request-Id') }));
const aliceDev = d => ({
  id: 'd' + d.id, name: d.name, type: 'devices.types.thermostat', device_info: { manufacturer: 'Mango', model: 'Heat pump' },
  capabilities: [
    { type: 'devices.capabilities.on_off', retrievable: true, reportable: false },
    { type: 'devices.capabilities.range', retrievable: true, reportable: false, parameters: { instance: 'temperature', unit: 'unit.temperature.celsius', random_access: true, range: { min: 20, max: 75, precision: 1 } } }
  ],
  properties: [{ type: 'devices.properties.float', retrievable: true, reportable: false, parameters: { instance: 'temperature', unit: 'unit.temperature.celsius' } }]
});
alice.get('/user/devices', (req, res) => res.json({ request_id: req.get('X-Request-Id'), payload: { user_id: String(req.uid), devices: userDevices(req.uid).map(aliceDev) } }));
function aliceState(d) {
  const der = L.derive(J(d.cfg), J(d.spec), J(d.status));
  if (!d.online) return { id: 'd' + d.id, error_code: 'DEVICE_UNREACHABLE' };
  return {
    id: 'd' + d.id,
    capabilities: [{ type: 'devices.capabilities.on_off', state: { instance: 'on', value: der.on } }, { type: 'devices.capabilities.range', state: { instance: 'temperature', value: der.tset ?? 0 } }],
    properties: [{ type: 'devices.properties.float', state: { instance: 'temperature', value: der.tcur ?? 0 } }]
  };
}
alice.post('/user/devices/query', (req, res) => {
  const mine = new Map(userDevices(req.uid).map(d => ['d' + d.id, d]));
  res.json({ request_id: req.get('X-Request-Id'), payload: { devices: ((req.body || {}).devices || []).map(x => mine.has(x.id) ? aliceState(mine.get(x.id)) : { id: x.id, error_code: 'DEVICE_NOT_FOUND' }) } });
});
alice.post('/user/devices/action', wrap(async (req, res) => {
  const mine = new Map(userDevices(req.uid).map(d => ['d' + d.id, d])), out = [];
  for (const x of (((req.body || {}).payload || {}).devices || [])) {
    const d = mine.get(x.id), caps = [];
    if (!d) { out.push({ id: x.id, action_result: { status: 'ERROR', error_code: 'DEVICE_NOT_FOUND' } }); continue; }
    const home = db.prepare('select * from homes where id=?').get(d.home_id);
    for (const c of x.capabilities || []) {
      let code, value, inst = c.state.instance;
      if (c.type.endsWith('on_off')) { code = 'switch'; value = !!c.state.value; }
      else if (c.type.endsWith('range') && inst === 'temperature') { code = 'temp_set'; value = +c.state.value; if (c.state.relative) { const der = L.derive(J(d.cfg), J(d.spec), J(d.status)); value = (der.tset || 0) + value; } }
      else { caps.push({ type: c.type, state: { instance: inst, action_result: { status: 'ERROR', error_code: 'INVALID_ACTION' } } }); continue; }
      let ok = d.role !== 'view'; if (ok) { try { ok = (await poller.sendCommand(d, home, code, value)).success; } catch (e) { ok = false; } }
      caps.push({ type: c.type, state: { instance: inst, action_result: ok ? { status: 'DONE' } : { status: 'ERROR', error_code: d.role === 'view' ? 'ACCESS_FORBIDDEN' : 'DEVICE_UNREACHABLE' } } });
    }
    out.push({ id: x.id, capabilities: caps });
  }
  res.json({ request_id: req.get('X-Request-Id'), payload: { devices: out } });
}));
app.use('/alice/v1.0', alice);

if (require.main === module) {
  const port = +process.env.PORT || 3000;
  app.listen(port, () => console.log('Mango Monitor server :' + port));
  poller.start();
}
module.exports = { app };
