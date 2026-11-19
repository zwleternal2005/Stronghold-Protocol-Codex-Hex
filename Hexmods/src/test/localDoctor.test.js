import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLocalDoctorStore, isLocalDoctorRequest, handleLocalDoctor } from '../server/localDoctor.js';
import { createRequestHandler } from '../server/http/routes.js';
import { createDoctorArchive, createIdentity } from '../public/js/net.js';
import { migrateStats, buildRecord, STATS_VERSION } from '../public/js/ui/stats.js';

const memory = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-local-doctor-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const rec = (id, t = 1) => ({ id, t, v: 3, end: 'settled', victory: true, selfId: 'p_old', players: [{ playerId: 'p_old', name: '旧博士' }] });

test('文件档案跨实例恢复编号、姓名与超过界面上限的完整战绩，重复/压缩迁移不丢旧记录', async (t) => {
  const dir = await fixture(t);
  let store = createLocalDoctorStore({ dir });
  const initial = await store.read();
  const records = Array.from({ length: 1005 }, (_, i) => rec(`match-${i}`, i));
  const legacy = JSON.stringify({ v: 1, records });
  await store.merge({ name: '永久博士', records, legacy, migration: true });
  await Promise.all([
    store.merge({ records: [rec('parallel-a', 2001)] }),
    store.merge({ records: [rec('parallel-b', 2002)] }),
  ]);
  await store.merge({ name: '旧缓存姓名', migration: true, records: [{ ...records[1004], compact: true }] });
  store = createLocalDoctorStore({ dir });
  const restored = await store.read();
  assert.equal(restored.doctorId, initial.doctorId);
  assert.equal(restored.name, '永久博士');
  assert.equal(restored.total, 1007);
  assert.equal(restored.records.length, 1000);
  assert.notEqual(restored.records.find((r) => r.id === 'match-1004').compact, true);
  assert.equal((await fs.readdir(path.join(dir, 'records'))).length, 1007);
  const backups = await fs.readdir(path.join(dir, 'legacy'));
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'legacy', backups[0]), 'utf8')).raw, legacy);
  await store.merge({ name: '改名', records: [] });
  assert.equal((await createLocalDoctorStore({ dir }).read()).name, '改名');
});

test('两个独立 Node 进程恢复同一个永久档案', async (t) => {
  const dir = await fixture(t);
  const moduleUrl = new URL('../server/localDoctor.js', import.meta.url).href;
  const run = promisify(execFile);
  const code = `import { createLocalDoctorStore } from ${JSON.stringify(moduleUrl)};
    const store = createLocalDoctorStore({ dir: process.argv[1] });
    if (process.argv[2] === 'write') await store.merge({ name: '进程重启博士', records: [{ id: 'process-record', t: 1 }] });
    console.log(JSON.stringify(await store.read()));`;
  const first = JSON.parse((await run(process.execPath, ['--input-type=module', '-e', code, dir, 'write'])).stdout);
  const second = JSON.parse((await run(process.execPath, ['--input-type=module', '-e', code, dir, 'read'])).stdout);
  assert.deepEqual(second, first);
  assert.equal(second.name, '进程重启博士');
  assert.equal(second.records[0].id, 'process-record');
});

test('损坏档案拒绝覆盖或重发编号；写入失败不会伪报成功，原文件保留', async (t) => {
  const dir = await fixture(t);
  const file = path.join(dir, 'profile.json');
  await fs.writeFile(file, '{broken');
  await assert.rejects(createLocalDoctorStore({ dir }).read());
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  const blocker = path.join(dir, 'not-directory');
  await fs.writeFile(blocker, '保留');
  await assert.rejects(createLocalDoctorStore({ dir: blocker }).merge({ name: '失败' }));
  assert.equal(await fs.readFile(blocker, 'utf8'), '保留');
});

test('严格区分回环、LAN、代理、跨站和 DNS 重绑定', () => {
  const req = { socket: { remoteAddress: '127.0.0.1', localPort: 32123 }, headers: { host: 'localhost:32123' } };
  assert.equal(isLocalDoctorRequest(req), true);
  for (const ip of ['192.168.1.2', '10.0.0.2', '8.8.8.8']) assert.equal(isLocalDoctorRequest({ ...req, socket: { ...req.socket, remoteAddress: ip } }), false);
  for (const headers of [
    { 'x-forwarded-for': '127.0.0.1' }, { forwarded: 'for=127.0.0.1' },
    { 'x-real-ip': '127.0.0.1' }, { 'cf-connecting-ip': '192.168.1.2' }, { via: 'proxy' }, { origin: 'http://evil.example' },
    { host: 'evil.example:32123' }, { 'sec-fetch-site': 'cross-site' }, { host: 'localhost:3140' },
  ]) assert.equal(isLocalDoctorRequest({ ...req, headers: { ...req.headers, ...headers } }), false);
});

test('真实 HTTP 路由独立随机端口：重启恢复，LAN/转发客户端无本机数据且不能写入', async (t) => {
  const dir = await fixture(t);
  let reads = 0, writes = 0;
  const fakeStore = { read: async () => { reads++; return { name: '不应泄露' }; }, merge: async () => { writes++; } };
  for (const method of ['GET', 'POST']) {
    let answer;
    await handleLocalDoctor({ method, socket: { remoteAddress: '192.168.1.4' }, headers: { 'x-sp-local-profile': '1' } }, {}, fakeStore,
      (_req, _res, status, value) => { answer = { status, value }; });
    assert.deepEqual(answer.value, { scope: 'browser' });
    assert.equal(answer.status, method === 'GET' ? 200 : 403);
  }
  assert.equal(reads + writes, 0);
  async function start() {
    const server = http.createServer(createRequestHandler({
      localDoctor: createLocalDoctorStore({ dir }), health: {}, log: { error: () => {} },
      serveStatic: async (_req, res) => { res.writeHead(404); res.end(); },
    }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${server.address().port}/api/local-doctor` };
  }
  let running = await start();
  const headers = { 'X-SP-Local-Profile': '1', 'Content-Type': 'application/json' };
  const call = (opts) => fetch(running.url, { headers, ...opts });
  const first = await (await call()).json();
  assert.equal((await call({ method: 'POST', body: JSON.stringify({ name: 'HTTP博士', records: [rec('http-record')] }) })).status, 200);
  await new Promise((resolve) => running.server.close(resolve));
  running = await start();
  t.after(() => new Promise((resolve) => running.server.close(resolve)));
  const restored = await (await call()).json();
  assert.equal(restored.doctorId, first.doctorId);
  assert.equal(restored.name, 'HTTP博士');
  assert.equal(restored.records[0].id, 'http-record');
  const remoteHeaders = { ...headers, 'X-Forwarded-For': '192.168.1.2' };
  assert.deepEqual(await (await call({ headers: remoteHeaders })).json(), { scope: 'browser' });
  assert.equal((await call({ method: 'POST', headers: remoteHeaders, body: JSON.stringify({ name: '篡改' }) })).status, 403);
  assert.equal((await call({ headers: { ...headers, Origin: 'http://evil.example' } })).status, 200);
  assert.equal((await call({ headers: {} })).status, 403);
  assert.equal((await (await call()).json()).name, 'HTTP博士');
});

test('客户端迁移完整旧历史，保留原缓存；待写队列跨页面重启重试，永久编号不依赖会话 token', async () => {
  const local = memory({ 'sp.name': '旧姓名' });
  const legacyRecords = Array.from({ length: 1003 }, (_, i) => rec(`legacy-${i}`, i));
  const legacy = JSON.stringify({ v: 1, records: legacyRecords });
  local.setItem('sp.pref.stats', legacy);
  const normalized = migrateStats(JSON.parse(legacy), Infinity);
  assert.equal(normalized.stats.records.length, 1003);
  let stored = { scope: 'host', doctorId: 'doc_12345678-1234-1234-1234-123456789012', name: '', records: [] }, fail = false;
  const fetchImpl = async (_url, opts) => {
    if (fail) throw new Error('离线');
    if (opts.method === 'POST') {
      const input = JSON.parse(opts.body);
      if (input.name && (!input.migration || !stored.name)) stored.name = input.name;
      stored.records = [...new Map([...stored.records, ...input.records].map((r) => [r.id, r])).values()];
    }
    return { ok: true, json: async () => structuredClone(stored) };
  };
  const errors = [];
  let archive = createDoctorArchive({ local, fetch: fetchImpl, onError: (e) => errors.push(e) });
  const first = await archive.init({ name: '旧姓名', legacy, records: normalized.stats.records });
  assert.equal(stored.records.length, 1003);
  assert.equal(local.getItem('sp.pref.stats'), legacy);
  fail = true;
  archive.saveName('新姓名');
  archive.saveRecords([rec('离线结算', 2000)]);
  await assert.rejects(archive.flush());
  assert.ok(errors.length);
  assert.ok(local.getItem('sp.doctor.pending').includes('离线结算'));
  fail = false;
  archive = createDoctorArchive({ local, fetch: fetchImpl });
  const restored = await archive.init({ name: '旧缓存', legacy, records: normalized.stats.records });
  assert.equal(restored.name, '新姓名');
  assert.equal(restored.doctorId, first.doctorId);
  assert.equal(stored.records.length, 1004);
  assert.equal(local.getItem('sp.doctor.pending'), null);
  const identity = createIdentity({ local, session: memory(), channel: null });
  identity.saveToken('temporary-session');
  identity.clearToken();
  assert.equal(archive.doctorId(), first.doctorId);
});

test('两个 LAN 浏览器各用独立档案，既不读取本机档案也不发起远端文件写入', async () => {
  let posts = 0;
  const fetchImpl = async (_url, opts) => {
    if (opts.method !== 'GET') posts++;
    return { ok: true, json: async () => ({ scope: 'browser' }) };
  };
  const browser = (doctorId) => {
    let saved = { doctorId, name: '', records: [] };
    return async (input) => {
      if (input) saved = { ...saved, name: input.name || saved.name, records: [...new Map([...saved.records, ...(input.records || [])].map((r) => [r.id, r])).values()] };
      return structuredClone(saved);
    };
  };
  const a = createDoctorArchive({ local: memory(), fetch: fetchImpl, browser: browser('doc_a') });
  const b = createDoctorArchive({ local: memory(), fetch: fetchImpl, browser: browser('doc_b') });
  await a.init({ name: '甲', records: [rec('甲的战绩')] });
  await b.init({ name: '乙', records: [rec('乙的战绩')] });
  a.saveName('甲改名');
  await a.flush();
  assert.notEqual(a.doctorId(), b.doctorId());
  const restoredB = await b.init();
  assert.equal(restoredB.name, '乙');
  assert.deepEqual(restoredB.records.map((r) => r.id), ['乙的战绩']);
  assert.equal(posts, 0);
});

test('统计构建和迁移仍排除测试局，近期窗口保持原有上限', () => {
  assert.equal(buildRecord({ test: true, players: [{ playerId: 'p' }] }, { myId: 'p' }), null);
  const raw = { v: STATS_VERSION, records: Array.from({ length: 1002 }, (_, i) => rec(`window-${i}`, i)) };
  raw.records.push({ ...rec('test'), test: true });
  assert.equal(migrateStats(raw).stats.records.length, 1000);
  assert.equal(migrateStats(raw, Infinity).stats.records.length, 1002);
});
