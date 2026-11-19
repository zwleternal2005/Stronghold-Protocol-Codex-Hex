// 本机档案仅供严格回环、同源请求使用；每条战绩独立原子落盘，不受界面窗口上限影响。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const DEFAULT_DIR = fileURLToPath(new URL('../.local-doctor/', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const validId = (id) => typeof id === 'string' && /^doc_[0-9a-f-]{36}$/.test(id);
const newest = (a, b) => b.t - a.t || a.id.localeCompare(b.id);

export function isLocalDoctorRequest(req) {
  const ip = req.socket?.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return false;
  const headers = req.headers || {};
  if (Object.keys(headers).some((key) => /^(forwarded|x-forwarded-.*|x-real-ip|cf-connecting-ip|true-client-ip|via)$/i.test(key))) return false;
  let host;
  try { host = new URL(`http://${headers.host}`); } catch { return false; }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) || host.username || host.password) return false;
  if (Number(host.port || 80) !== req.socket.localPort) return false;
  if (headers.origin && ![`http://${host.host}`, `https://${host.host}`].includes(headers.origin)) return false;
  if (headers['sec-fetch-site'] && !['same-origin', 'none'].includes(headers['sec-fetch-site'])) return false;
  return true;
}

async function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, file);
    // Windows 不支持目录 fsync；文件本身已在 rename 前同步。
    if (process.platform !== 'win32') {
      const dir = await fs.open(path.dirname(file), 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    }
  } finally {
    await handle?.close();
    await fs.unlink(temp).catch((e) => { if (e.code !== 'ENOENT') throw e; });
  }
}

export function createLocalDoctorStore({ dir = process.env.SP_LOCAL_PROFILE_DIR || DEFAULT_DIR } = {}) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const profileFile = path.join(dir, 'profile.json');
  const recordDir = path.join(dir, 'records');
  async function profile() {
    await fs.mkdir(recordDir, { recursive: true, mode: 0o700 });
    try {
      const saved = JSON.parse(await fs.readFile(profileFile, 'utf8'));
      if (saved.v !== 1 || !validId(saved.doctorId) || typeof saved.name !== 'string') throw new Error('本机博士档案格式无效，请保留文件并恢复备份');
      return saved;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e; // 损坏档案绝不静默覆盖或另发编号。
      const saved = { v: 1, doctorId: `doc_${randomUUID()}`, name: '' };
      await atomicJson(profileFile, saved);
      return saved;
    }
  }
  async function snapshot(saved) {
    const records = [];
    for (const file of await fs.readdir(recordDir)) {
      if (!/^[0-9a-f]{64}\.json$/.test(file)) continue;
      const rec = JSON.parse(await fs.readFile(path.join(recordDir, file), 'utf8'));
      if (!rec || typeof rec.id !== 'string' || !Number.isFinite(rec.t)) throw new Error('本机历史战绩文件损坏，请恢复备份');
      records.push(rec);
    }
    records.sort(newest);
    return { scope: 'host', ...saved, total: records.length, records: records.slice(0, 1000) };
  }
  return {
    read: () => serial(async () => snapshot(await profile())),
    merge: (input) => serial(async () => {
      if (!input || typeof input !== 'object' || (input.records != null && (!Array.isArray(input.records) || input.records.length > 2000))) throw new TypeError('档案请求格式无效');
      const records = input.records || [];
      for (const rec of records) {
        if (!rec || typeof rec.id !== 'string' || !rec.id || rec.id.length > 128 || !Number.isFinite(rec.t) || JSON.stringify(rec).length > 250_000) throw new TypeError('战绩记录格式无效');
      }
      const saved = await profile();
      // 原始迁移快照先保存；重复迁移按内容去重，不覆盖旧浏览器数据。
      if (input.legacy != null) {
        if (typeof input.legacy !== 'string' || input.legacy.length > 8_000_000) throw new TypeError('旧档案过大');
        const legacyDir = path.join(dir, 'legacy');
        await fs.mkdir(legacyDir, { recursive: true, mode: 0o700 });
        const file = path.join(legacyDir, `${hash(input.legacy)}.json`);
        try { await fs.access(file); } catch (e) { if (e.code !== 'ENOENT') throw e; await atomicJson(file, { raw: input.legacy }); }
      }
      for (const rec of records) {
        if (rec.test === true) continue;
        const file = path.join(recordDir, `${hash(rec.id)}.json`);
        let old;
        try { old = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        // 完整结算可以补全旧摘要，摘要或重放不能覆盖已有完整战绩。
        if (!old || (old.compact === true && rec.compact !== true)) await atomicJson(file, rec);
      }
      if (typeof input.name === 'string' && (!input.migration || !saved.name)) {
        saved.name = input.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64);
        await atomicJson(profileFile, saved);
      }
      return { scope: 'host', ...saved };
    }),
  };
}

export async function handleLocalDoctor(req, res, store, sendJson) {
  const local = isLocalDoctorRequest(req);
  if (!local) {
    sendJson(req, res, req.method === 'GET' ? 200 : 403, { scope: 'browser' });
    return;
  }
  // 自定义头触发跨站预检；此路由不提供 CORS，恶意网页不能读写本机档案。
  if (req.headers['x-sp-local-profile'] !== '1') { sendJson(req, res, 403, { error: '本机档案需要同源请求' }); return; }
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    sendJson(req, res, 405, { error: '不支持的档案请求方法' });
    return;
  }
  try {
    if (req.method === 'GET') { sendJson(req, res, 200, await store.read()); return; }
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { sendJson(req, res, 415, { error: '档案请求需要 JSON' }); return; }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 12_000_000) { sendJson(req, res, 413, { error: '档案请求过大' }); req.resume(); return; }
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { sendJson(req, res, 400, { error: '档案 JSON 无效' }); return; }
    sendJson(req, res, 200, await store.merge(input));
  } catch (e) {
    sendJson(req, res, e instanceof TypeError ? 400 : 503, { error: e instanceof TypeError ? e.message : '本机档案读写失败，浏览器备份仍保留；请检查目录权限和磁盘空间' });
  }
}
