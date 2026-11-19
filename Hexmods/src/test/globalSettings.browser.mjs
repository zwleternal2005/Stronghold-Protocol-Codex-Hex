// 设置专用浏览器夹具：随机回环端口与临时档案，不接管玩家服务。
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-global-settings-'));
process.env.SP_LOCAL_PROFILE_DIR = dir;
const registry = new SessionRegistry();
const lobby = new Lobby({ registry });
function makeRoom(mode, migration = false) {
  const creator = registry.create('设置创建者');
  const member = registry.create('设置加入者');
  creator.connected = member.connected = true;
  lobby.create(creator, { mode });
  const room = lobby.rooms.get(creator.roomCode);
  if (mode === 'coop') lobby.join(member, { code: room.code });
  if (migration) lobby.leave(creator);
  return { room: room.toState(), creator: creator.playerId, member: member.playerId, code: room.code };
}
const solo = makeRoom('solo'), coop = makeRoom('coop'), successor = makeRoom('coop', true);
const rejoined = (() => {
  const creator = registry.create('重新加入创建者');
  const member = registry.create('重新加入成员');
  creator.connected = member.connected = true;
  lobby.create(creator, { mode: 'coop' });
  const room = lobby.rooms.get(creator.roomCode);
  lobby.join(member, { code: room.code });
  lobby.leave(creator);
  lobby.join(creator, { code: room.code });
  return { room: room.toState(), creator: creator.playerId, member: member.playerId };
})();
const cases = {
  pre: { room: null, myId: null },
  solo: { room: solo.room, myId: solo.creator },
  creator: { room: coop.room, myId: coop.creator },
  joiner: { room: coop.room, myId: coop.member },
  successor: { room: successor.room, myId: successor.member },
  rejoined: { room: rejoined.room, myId: rejoined.creator },
};
const app = await startServer({ port: 0, host: '127.0.0.1', quiet: true, studio: false, assetIndex: false });
const [normal] = app.server.listeners('request');
app.server.removeListener('request', normal);
app.server.on('request', (req, res) => {
  const url = new URL(req.url, app.url);
  if (url.pathname === '/__global-settings-stop') { res.end('设置验收服务已停止'); void close(); return; }
  if (url.pathname === '/__global-settings-report' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { console.log(body); res.end('ok'); });
    return;
  }
  if (url.pathname !== '/__global-settings-test') { normal(req, res); return; }
  const scenario = Object.hasOwn(cases, url.searchParams.get('case')) ? url.searchParams.get('case') : 'pre';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>全局设置隔离验收 · ${scenario}</title>
<link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css">
<link rel="stylesheet" href="/css/screens/lobby.css"><link rel="stylesheet" href="/css/screens/room.css">
<script type="importmap">{"imports":{"preact":"/vendor/preact.module.js","preact/hooks":"/vendor/hooks.module.js","htm":"/vendor/htm.module.js"}}</script>
<div id="app"></div><textarea id="result" readonly aria-label="设置验收结果" style="position:fixed;bottom:0;left:0;z-index:9999;font-size:12px;pointer-events:none;background:#111;color:#eee;width:100%;height:40px" tabindex="-1">等待打开全局设置</textarea>
<script type="module">
import { render } from '/vendor/preact.module.js';
import { html } from '/js/ui/components.js';
import { ProtocolSelect } from '/js/screens/lobby.js';
import { RoomScreen } from '/js/screens/room.js';
import { store } from '/js/store.js';
import { net } from '/js/net.js';
import { normalizeGlobalSettings } from '/shared/globalSettings.js';
const scenario = ${JSON.stringify(scenario)}, sample = ${JSON.stringify(cases[scenario])};
const result = { scenario, clicks: [], inputs: [], changes: [], opens: 0, closes: 0, escape: 0, tabs: 0, focusTrap: true, restored: false, requests: [], broadcasts: 0, storageWrites: [], errors: [] };
window.addEventListener('error', e => { result.errors.push(e.message); });
window.addEventListener('unhandledrejection', e => { result.errors.push(String(e.reason)); });
store.set({ room: sample.room, me: { playerId: sample.myId, name: '设置验收博士' }, connection: { status: 'online', ping: 1 } });
net.request = async (...args) => {
  result.requests.push(args);
  if (args[0] === 'room.setGlobalSettings') {
    const state = store.get();
    const next = normalizeGlobalSettings({ ...(state.room?.globalSettings || {}), ...(args[1]?.settings || {}) });
    store.set({ room: { ...state.room, globalSettings: next } });
    result.broadcasts++;
  }
  return { t: 'ok' };
};
const originalSet = Storage.prototype.setItem, originalRemove = Storage.prototype.removeItem;
Storage.prototype.setItem = function(key, value) { result.storageWrites.push(['set', key]); return originalSet.call(this, key, value); };
Storage.prototype.removeItem = function(key) { result.storageWrites.push(['remove', key]); return originalRemove.call(this, key); };
const before = JSON.stringify(store.get().room);
const storageBefore = JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]);
const output = document.querySelector('#result');
let wasOpen = false;
function inspect() {
  const modal = document.querySelector('.global-settings');
  const open = !!modal;
  if (open && !wasOpen) result.opens++;
  if (!open && wasOpen) { result.closes++; result.restored = document.activeElement?.dataset.testid === 'global-settings-btn'; }
  wasOpen = open;
  result.open = open;
  result.editable = modal?.querySelector('[data-editable]')?.dataset.editable ?? result.editable;
  if (modal) {
    const sliders = [...modal.querySelectorAll('input[type="range"]')];
    const switches = [...modal.querySelectorAll('input[type="checkbox"]')];
    const endless = modal.querySelector('[data-testid="global-setting-endless"] button');
    result.controls = {
      difficulty: !!modal.querySelector('[aria-labelledby="global-settings-difficulty"]'),
      gameplay: !!modal.querySelector('[aria-labelledby="global-settings-gameplay"]'),
      sliderCount: sliders.length,
      sliderRanges: sliders.every((input) => input.min === '0' && input.max === '10' && input.step === '1'),
      sliderValues: sliders.map((input) => Number(input.value)),
      switchCount: switches.length,
      mercyDefaultOn: modal.querySelector('[data-testid="global-setting-difficultyMercy"] input')?.checked === true,
      infiniteFundsDefaultOff: modal.querySelector('[data-testid="global-setting-infiniteFunds"] input')?.checked === false,
      classicDefaultOff: modal.querySelector('[data-testid="global-setting-classicAutoChess"] input')?.checked === false,
      endlessDisabled: endless?.disabled === true && endless?.getAttribute('aria-disabled') === 'true',
    };
    result.changes = [...modal.querySelectorAll('input')].map((input) => ({
      type: input.type, value: input.type === 'checkbox' ? input.checked : Number(input.value), disabled: input.disabled,
    }));
  }
  result.roomUnchanged = before === JSON.stringify(store.get().room);
  result.storageUnchanged = storageBefore === JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]);
  result.policy = {
    editableExpected: scenario === 'pre' || scenario === 'solo' || scenario === 'creator' || scenario === 'rejoined',
    editableActual: modal ? modal.querySelector('[data-editable]')?.dataset.editable === 'true' : null,
    controlsDisabled: modal ? [...modal.querySelectorAll('input')].every((input) => input.disabled === (scenario === 'joiner' || scenario === 'successor')) : null,
    requestCount: result.requests.filter(([type]) => type === 'room.setGlobalSettings').length,
    broadcastCount: result.broadcasts,
  };
  const entry = document.querySelector('[data-testid="global-settings-btn"]');
  const go = document.querySelector('.rs-go');
  if (entry && go) {
    const a = entry.getBoundingClientRect(), b = go.getBoundingClientRect();
    const hit = document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2);
    result.layout = {
      singleEntry: document.querySelectorAll('[data-testid="global-settings-btn"]').length === 1,
      inFooter: entry.parentElement.matches('.room-bar__right.rs-foot__right'),
      noTopEntry: !document.querySelector('.rs-tools [data-testid="global-settings-btn"]'),
      leftOfGo: a.right <= b.left,
      centered: Math.abs(a.y + a.height / 2 - b.y - b.height / 2) <= 1,
      visible: a.width > 0 && a.height >= 44 && a.left >= 0 && a.right <= innerWidth && a.top >= 0 && a.bottom <= innerHeight,
      pointerHit: open || !!hit && entry.contains(hit),
    };
  }
  const report = JSON.stringify(result);
  if (output.value !== report) {
    output.value = report;
    void fetch('/__global-settings-report', { method: 'POST', body: report });
  }
}
window.addEventListener('input', event => {
  const input = event.target.closest('input');
  if (input) result.inputs.push({ type: input.type, value: input.type === 'checkbox' ? input.checked : Number(input.value), trusted: event.isTrusted });
  requestAnimationFrame(inspect);
}, true);
window.addEventListener('change', event => {
  const input = event.target.closest('input');
  if (input) result.inputs.push({ type: input.type, value: input.type === 'checkbox' ? input.checked : Number(input.value), trusted: event.isTrusted });
  requestAnimationFrame(inspect);
}, true);
window.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const rect = button.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  result.clicks.push({ label: button.textContent.trim() || button.getAttribute('aria-label'), trusted: event.isTrusted, pointerHit: !!hit && button.contains(hit) });
  requestAnimationFrame(inspect);
}, true);
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') result.escape++;
  if (event.key === 'Tab' && document.querySelector('.global-settings')) {
    result.tabs++;
    requestAnimationFrame(() => { result.focusTrap &&= !!document.querySelector('.global-settings')?.contains(document.activeElement); inspect(); });
  }
  requestAnimationFrame(inspect);
});
const root = document.querySelector('#app');
if (scenario === 'pre') render(html\u0060<\u0024{ProtocolSelect} roomMode="solo" beforeCreate=\u0024{true} difficulty="FUNNY" season="act3autochess" online=\u0024{true}
  onDifficulty=\u0024{() => {}} onClose=\u0024{() => {}} onCreate=\u0024{() => {}} />\u0060, root);
else render(html\u0060<\u0024{RoomScreen} />\u0060, root);
new MutationObserver(inspect).observe(root, { childList: true, subtree: true });
inspect();
</script></html>`);
});
console.log(JSON.stringify({ port: app.port, test: `${app.url}/__global-settings-test?case=pre`, cases: Object.keys(cases) }));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  lobby.shutdown();
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
}
const timer = setTimeout(close, 15 * 60_000);
process.once('SIGTERM', close);
process.once('SIGINT', close);
