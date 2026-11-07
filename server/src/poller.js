'use strict';
const db = require('./db');
const tuya = require('./tuya');
const L = require('./lib');

const J = s => { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } };
const cfgInt = (c, k, d) => (c[k] !== undefined && c[k] !== '' && !isNaN(+c[k]) ? +c[k] : d);
const BASE_SEC = +process.env.POLL_SEC || 60;
const LIVE_SEC = +process.env.LIVE_POLL_SEC || 2; // while the app is open (v3.5: heat-power estimate refreshes every 2 s)

const q = {
  upM5: db.prepare('insert or replace into m5(dev,ts,p,tc,tout,tin,tamb,tset,tbuf,hz,cp) values(?,?,?,?,?,?,?,?,?,?,?)'),
  upH1: db.prepare(`insert into h1(dev,ts,kwh,kwh_th,comp_s,starts,defr_n,defr_s,to_sum,to_n,tc_sum,tc_n,hz_sum) values(@dev,@ts,@kwh,@kwh_th,@comp_s,@starts,@defr_n,@defr_s,@to_sum,@to_n,@tc_sum,@tc_n,@hz_sum)
    on conflict(dev,ts) do update set kwh=kwh+excluded.kwh,kwh_th=kwh_th+excluded.kwh_th,comp_s=comp_s+excluded.comp_s,starts=starts+excluded.starts,
    defr_n=defr_n+excluded.defr_n,defr_s=defr_s+excluded.defr_s,to_sum=to_sum+excluded.to_sum,to_n=to_n+excluded.to_n,tc_sum=tc_sum+excluded.tc_sum,tc_n=tc_n+excluded.tc_n,hz_sum=hz_sum+excluded.hz_sum`),
  getSes: db.prepare('select * from ses where id=?'),
  insSes: db.prepare('insert into ses(dev,s,e,kwh,cs,h) values(?,?,?,0,0,?)'),
  updSes: db.prepare('update ses set kwh=?,cs=?,h=? where id=?'),
  endSes: db.prepare('update ses set e=? where id=?'),
  alert: db.prepare('insert into alerts(dev,kind,level,ts,params) values(?,?,?,?,?)'),
  ev: db.prepare('insert into events(dev,kind,ts,end_ts,info) values(?,?,?,?,?)'),
  evEnd: db.prepare('update events set end_ts=? where id=?'),
  saveDev: db.prepare('update devices set status=?,online=?,last_ok=?,last_poll=?,state=? where id=?'),
  savePoll: db.prepare('update devices set last_poll=?,online=?,state=? where id=?'),
  home: db.prepare('select * from homes where id=?'),
  all: db.prepare('select * from devices')
};

function addAlert(d, state, kind, level, params, cooldownMin) {
  const now = Date.now();
  state.cd = state.cd || {};
  if (cooldownMin && state.cd[kind] && now - state.cd[kind] < cooldownMin * 60000) return;
  state.cd[kind] = now;
  q.alert.run(d.id, kind, level, now, JSON.stringify(Object.assign({ name: d.name }, params || {})));
}

// ---------- weather (Open-Meteo) ----------
const wcache = new Map();
async function forecastTemp(home) {
  if (home.lat == null || home.lon == null) return null;
  const k = home.id, e = wcache.get(k);
  if (e && Date.now() - e.t < 600000) return e.v;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${home.lat}&longitude=${home.lon}&current=temperature_2m`, { signal: AbortSignal.timeout(10000) });
    const j = await r.json(); const v = j.current && typeof j.current.temperature_2m === 'number' ? j.current.temperature_2m : null;
    wcache.set(k, { t: Date.now(), v }); return v;
  } catch (e2) { return e && e.v != null ? e.v : null; }
}

// ---------- commands ----------
function rawValue(spec, code, v) {
  const s = spec[code];
  if (s && s.type === 'Integer' && typeof v === 'number') return Math.round(v * Math.pow(10, s.scale || 0));
  return v;
}
async function sendCommand(d, home, code, value) {
  const spec = J(d.spec);
  const r = await tuya.call(tuya.credsOf(home), 'POST', `/v1.0/devices/${d.tuya_id}/commands`, { commands: [{ code, value: rawValue(spec, code, value) }] });
  return r;
}

// ---------- automation ----------
function activeSlot(sch, tz, now) {
  const { dow, min } = L.localParts(tz, now), prev = dow === 1 ? 7 : dow - 1;
  for (const s of sch.slots || []) {
    const a = L.hm(s.from), b = L.hm(s.to); if (a == null || b == null) continue;
    const days = s.days && s.days.length ? s.days : [1, 2, 3, 4, 5, 6, 7];
    if (a < b ? (days.includes(dow) && min >= a && min < b) : ((days.includes(dow) && min >= a) || (days.includes(prev) && min < b))) return s;
  }
  return null;
}
async function runAuto(d, home, state, st, der, spec, cfg) {
  const auto = J(d.auto), now = Date.now(), wz = auto.weather || {};
  if (!auto.schedule?.enabled && !wz.enabled) return;
  const tz = home.tz || 'Asia/Tashkent';

  // --- weather = freeze protection: outdoor temp at/below the threshold and the pump is OFF -> switch it ON ---
  let freezeActive = false;
  if (wz.enabled) {
    let out = der.tamb;
    if (out == null || wz.source === 'forecast') { const f = await forecastTemp(home); if (f != null) out = f; }
    const below = wz.below != null && wz.below !== '' && !isNaN(+wz.below) ? +wz.below : 3;
    if (out != null) {
      freezeActive = out <= below + (state.freezeOn ? 1 : 0); // 1° hysteresis once protection has started
      if (out <= below && st.switch === false && (!state.lastFreeze || now - state.lastFreeze > 10 * 60000)) {
        const r = await sendCommand(d, home, 'switch', true);
        if (r.success) {
          state.lastFreeze = now; state.freezeOn = true; q.ev.run(d.id, 'auto', now, now, 'freeze_on switch=true');
          addAlert(d, state, 'freeze_on', 'info', { t: out, below }, 30);
        }
        return;
      }
      if (!freezeActive) state.freezeOn = false;
    }
  }

  if (!auto.schedule?.enabled) return;
  if (state.holdUntil && now < state.holdUntil) return;
  if (state.lastAuto && now - state.lastAuto < 5 * 60000) return;

  // --- weekly schedule: each on/off command is given ONCE per occurrence; a manual switch cancels the occurrence ---
  let slotMode = null, wantOn = null, target = null, key = null;
  const sk = L.slotKey(auto.schedule, tz, now);
  if (sk) {
    wantOn = true; key = sk.key; state.lastSlotKey = sk.key; const slot = sk.slot;
    if (slot.mode) slotMode = slot.mode;
    if (slot.setpoint != null && slot.setpoint !== '') {
      target = +slot.setpoint; const sp = spec.temp_set || {}, mx = sp.max != null ? sp.max / Math.pow(10, sp.scale || 0) : 75, mn = sp.min != null ? sp.min / Math.pow(10, sp.scale || 0) : 20;
      target = Math.min(Math.min(mx, +cfg.tmax || 75), Math.max(mn, target));
    }
  } else if (auto.schedule.outside !== 'keep') { wantOn = false; key = 'off:' + (state.lastSlotKey || ''); }
  if (wantOn === false && freezeActive) wantOn = null; // never switch off while freeze protection is needed
  const already = key != null && state.doneKey === key; // this occurrence was already handled (or cancelled by hand)
  const done = []; let failed = false;
  if (wantOn === true && !already && slotMode && der.modeCode && spec[der.modeCode] && st[der.modeCode] !== slotMode) { const r = await sendCommand(d, home, der.modeCode, slotMode); if (r.success) done.push(der.modeCode + '=' + slotMode); else failed = true; }
  if (wantOn !== null && !already && st.switch !== undefined && st.switch !== wantOn) { const r = await sendCommand(d, home, 'switch', wantOn); if (r.success) done.push('switch=' + wantOn); else failed = true; }
  if (target != null && !already && der.tset != null && Math.abs(der.tset - target) >= 0.5 && wantOn !== false) { const r = await sendCommand(d, home, 'temp_set', Math.round(target * 2) / 2); if (r.success) done.push('temp_set=' + target); else failed = true; }
  if (key != null && !already && wantOn !== null && !failed) state.doneKey = key; // one command only; never repeated for this occurrence
  if (done.length) { state.lastAuto = now; q.ev.run(d.id, 'auto', now, now, done.join(', ')); }
}

// ---------- one device ----------
async function pollDevice(d) {
  const now = Date.now(), home = q.home.get(d.home_id), cfg = J(d.cfg), spec = J(d.spec), state = J(d.state);
  state.pc = (state.pc || 0) + 1;
  let st = J(d.status), online = !!d.online, ok = false;
  try {
    const r = await tuya.call(tuya.credsOf(home), 'GET', `/v1.0/devices/${d.tuya_id}/status`);
    if (r.success && Array.isArray(r.result)) { st = {}; r.result.forEach(x => { st[x.code] = x.value; }); ok = true; }
    if (ok && (state.pc % 3 === 1 || !online)) {
      const i = await tuya.call(tuya.credsOf(home), 'GET', `/v1.0/devices/${d.tuya_id}`);
      if (i.success && i.result && typeof i.result.online === 'boolean') online = i.result.online; else if (!i.success) online = true;
    } else if (ok && online === false && state.pc % 3 !== 1) { /* keep */ }
  } catch (e) { ok = false; }
  if (ok && !state.infoSeen) { state.infoSeen = true; if (d.online === 0) online = true; }

  const lastOk = ok ? now : d.last_ok;
  const offMin = cfgInt(cfg, 'offlineMin', 3);
  const unreachable = (!ok && lastOk && now - lastOk > offMin * 60000) || (ok && online === false);
  if (unreachable && !state.offSince) { state.offSince = now; addAlert(d, state, 'offline', 'warn', { min: Math.max(offMin, Math.round((now - (lastOk || now)) / 60000)) }, 30); }
  if (!unreachable && ok && state.offSince) {
    const min = Math.round((now - state.offSince) / 60000); state.offSince = 0;
    if (min >= 2) addAlert(d, state, 'restored', 'info', { min }, 0);
  }
  if (!ok) { q.savePoll.run(now, unreachable ? 0 : (d.online ? 1 : 0), JSON.stringify(state), d.id); return; }

  const der = L.derive(cfg, spec, st);
  const dt = state.t ? Math.min((now - state.t) / 1000, 180) : 0;
  const h = Math.floor(now / 3600000) * 3600000, m5 = Math.floor(now / 300000) * 300000;
  const row = { dev: d.id, ts: h, kwh: 0, kwh_th: 0, comp_s: 0, starts: 0, defr_n: 0, defr_s: 0, to_sum: 0, to_n: 0, tc_sum: 0, tc_n: 0, hz_sum: 0 };
  if (dt > 0 && !state.wasUnreachable) {
    row.kwh = der.w * dt / 3.6e6;
    if (state.q != null || der.q != null) row.kwh_th = (((state.q || 0) + (der.q || 0)) / 2) * dt / 3600;
    if (der.comp) { row.comp_s = dt; if (der.hz != null) row.hz_sum = der.hz * dt; }
    if (der.defrost) row.defr_s = dt;
  }
  if (der.comp && state.comp === false) { row.starts = 1; (state.starts = state.starts || []).push(now); }
  if (state.starts) state.starts = state.starts.filter(t => now - t < 3600000);
  if (der.defrost && !state.defId) { row.defr_n = 1; state.defId = q.ev.run(d.id, 'defrost', now, null, '').lastInsertRowid; state.defStart = now; }
  if (!der.defrost && state.defId) { q.evEnd.run(now, state.defId); state.defId = 0; state.defStart = 0; }
  if (der.tamb != null) { row.to_sum = der.tamb; row.to_n = 1; }
  if (der.tcur != null) { row.tc_sum = der.tcur; row.tc_n = 1; }
  // ----- pump session: from switch ON to switch OFF; energy is kept per hour so its cost follows the tariff -----
  let ses = state.ses ? q.getSes.get(state.ses) : null;
  if (ses && ses.e) { ses = null; state.ses = 0; }
  if (ses && (row.kwh > 0 || row.comp_s > 0)) { const hh = J(ses.h); hh[h] = (hh[h] || 0) + row.kwh; q.updSes.run(ses.kwh + row.kwh, ses.cs + row.comp_s, JSON.stringify(hh), ses.id); }
  if (der.on && !ses) state.ses = q.insSes.run(d.id, now, null, '{}').lastInsertRowid;
  if (!der.on && ses) { q.endSes.run(now, ses.id); state.ses = 0; }
  q.upH1.run(row);
  q.upM5.run(d.id, m5, der.w, der.tcur, der.tout, der.tin, der.tamb, der.tset, der.tbuf, der.hz, der.comp ? 1 : 0);
  state.t = now; state.comp = der.comp; state.q = der.q; state.wasUnreachable = false;

  // ----- alerts -----
  if (der.on && der.tcur != null && der.tset != null && der.tcur < der.tset - cfgInt(cfg, 'lowDelta', 8)) {
    state.lowSince = state.lowSince || now;
    const min = Math.round((now - state.lowSince) / 60000);
    if (min >= cfgInt(cfg, 'lowMin', 90)) addAlert(d, state, 'low_temp', 'warn', { t: der.tcur, set: der.tset, min }, 360);
  } else state.lowSince = 0;
  if ((state.starts || []).length >= cfgInt(cfg, 'cycleN', 6)) addAlert(d, state, 'cycling', 'warn', { n: state.starts.length }, 180);
  if (state.defStart && (now - state.defStart) / 60000 >= cfgInt(cfg, 'defrostMin', 20)) addAlert(d, state, 'defrost_long', 'warn', { min: Math.round((now - state.defStart) / 60000) }, 120);
  if (der.tamb != null && der.tamb < cfgInt(cfg, 'freezeT', 2) && st.switch === false) addAlert(d, state, 'freeze_risk', 'crit', { t: der.tamb }, 180);

  try { await runAuto(d, home, state, st, der, spec, cfg); } catch (e) { console.error('auto', d.id, e.message); }
  q.saveDev.run(JSON.stringify(st), online ? 1 : 0, now, now, JSON.stringify(state), d.id);
}

let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try {
    const now = Date.now();
    const due = q.all.all().filter(d => now - d.last_poll >= ((d.live_until > now ? LIVE_SEC : BASE_SEC) * 1000 - 500));
    for (let i = 0; i < due.length; i += 5) {
      await Promise.all(due.slice(i, i + 5).map(d => pollDevice(d).catch(e => { console.error('poll', d.id, e.message); })));
    }
  } finally { busy = false; }
}
function cleanup() {
  const now = Date.now();
  db.prepare('delete from m5 where ts<?').run(now - 14 * 864e5);
  db.prepare('delete from ses where s<?').run(now - 365 * 864e5);
  db.prepare('delete from events where ts<?').run(now - 365 * 864e5);
  db.prepare('delete from alerts where ts<?').run(now - 120 * 864e5);
  db.prepare('delete from invites where exp<?').run(now);
}
function start() {
  setInterval(() => tick().catch(e => console.error(e)), 1000);
  setInterval(cleanup, 6 * 3600 * 1000); cleanup();
}
module.exports = { start, tick, pollDevice, sendCommand, rawValue, J };
