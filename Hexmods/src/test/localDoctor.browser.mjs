// 手动浏览器验收夹具：随机回环端口、临时档案，不触碰正在运行的游戏服务。
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-doctor-browser-'));
process.env.SP_LOCAL_PROFILE_DIR = dir;
const app = await startServer({ port: 0, host: '127.0.0.1', quiet: true, studio: false, assetIndex: false });
const [normal] = app.server.listeners('request');
app.server.removeListener('request', normal);
app.server.on('request', (req, res) => {
  if (req.url === '/__doctor-stop') { res.end('验收服务已停止'); void close(); return; }
  if (req.url === '/__doctor-report' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { console.log(body); res.end('ok'); });
    return;
  }
  if (req.url !== '/__doctor-test') { normal(req, res); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>博士档案浏览器验收</title>
<button id="run">验证真实 IndexedDB 和档案恢复</button><textarea id="result" rows="20" cols="100" readonly>等待点击</textarea>
<script type="module">
import { browserDoctorStorage, createDoctorArchive } from '/js/net.js';
const output = document.querySelector('#result');
document.querySelector('#run').addEventListener('click', async (event) => {
  const rect = event.target.getBoundingClientRect();
  const hit = event.isTrusted && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === event.target;
  try {
    const a = browserDoctorStorage();
    const initial = await a({ migration: true, name: '远端验收博士', records: [{ id: 'browser-check', t: 10, players: [] }] });
    const restored = await browserDoctorStorage()();
    if (!restored.doctorId || restored.doctorId !== initial.doctorId || restored.name !== '远端验收博士' || !restored.records.some(r => r.id === 'browser-check')) throw Error('IndexedDB 恢复失败');
    const archive = createDoctorArchive({ onError: message => { throw Error(message); } });
    const host = await archive.init({ name: '本机验收博士', records: [{ id: 'host-browser-check', t: 20, players: [] }] });
    const after = await createDoctorArchive().init();
    if (host.doctorId !== after.doctorId || after.name !== '本机验收博士' || !after.records.some(r => r.id === 'host-browser-check')) throw Error('本机 HTTP 档案恢复失败');
    output.value = JSON.stringify({ passed: true, pointerHit: hit, indexedDB: { doctorId: restored.doctorId, name: restored.name, count: restored.records.length }, host: { doctorId: after.doctorId, name: after.name, count: after.records.length } }, null, 2);
  } catch (error) { output.value = '失败：' + error.stack; }
  await fetch('/__doctor-report', { method: 'POST', body: output.value });
});
// 鼠标工具不可用时仍执行真实浏览器存储检查，报告不声称通过指针验收。
document.querySelector('#run').dispatchEvent(new Event('click'));
</script></html>`);
});
console.log(JSON.stringify({ port: app.port, url: app.url, test: `${app.url}/__doctor-test` }));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
}
const timer = setTimeout(close, 8 * 60_000);
process.once('SIGTERM', close);
process.once('SIGINT', close);
