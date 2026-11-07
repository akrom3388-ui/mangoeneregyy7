'use strict';
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH || './data.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
create table if not exists users(id integer primary key, login text unique not null, name text, pass text not null, created integer);
create table if not exists homes(id integer primary key, name text not null, tz text default 'Asia/Tashkent', lat real, lon real, price real default 0, tuya text, created integer);
create table if not exists members(home_id integer not null, user_id integer not null, role text not null, primary key(home_id,user_id));
create table if not exists invites(code text primary key, home_id integer not null, role text not null, exp integer not null);
create table if not exists devices(
  id integer primary key, home_id integer not null, tuya_id text unique not null, name text, cfg text default '{}', auto text default '{}',
  spec text default '{}', status text default '{}', online integer default 0, last_ok integer default 0, last_poll integer default 0,
  state text default '{}', live_until integer default 0, created integer);
create table if not exists m5(dev integer, ts integer, p real, tc real, tout real, tin real, tamb real, tset real, primary key(dev,ts));
create table if not exists h1(dev integer, ts integer, kwh real default 0, kwh_th real default 0, comp_s real default 0, starts integer default 0,
  defr_n integer default 0, defr_s real default 0, to_sum real default 0, to_n integer default 0, tc_sum real default 0, tc_n integer default 0, primary key(dev,ts));
create table if not exists events(id integer primary key, dev integer, kind text, ts integer, end_ts integer, info text);
create index if not exists ev_dev on events(dev, ts);
create table if not exists ses(id integer primary key, dev integer, s integer, e integer, kwh real default 0, cs real default 0, h text default '{}');
create index if not exists ses_dev on ses(dev, s);
create table if not exists alerts(id integer primary key, dev integer, kind text, level text, ts integer, params text);
`);
// migrations (v3.2): Hz-weighted hourly sums, buffer temp, compressor frequency in the 5-min series
for (const sql of [
  'alter table h1 add column hz_sum real default 0',
  'alter table m5 add column tbuf real',
  'alter table m5 add column hz real',
  'alter table m5 add column cp integer',
  'alter table homes add column tariff text'
]) { try { db.exec(sql); } catch (e) { /* column already exists */ } }
module.exports = db;
