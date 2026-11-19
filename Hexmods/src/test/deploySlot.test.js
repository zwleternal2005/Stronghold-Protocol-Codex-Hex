// 额外上阵栏位（g.buySlot）：整局累计可购买 9 人，每个 15 资金，扣费与上限都由服务端权威判定。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getVersionData } from '../server/data.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { ERR, PHASE } from '../shared/constants.js';
import { C2S, validateC2S } from '../shared/protocol.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createSessionStack, attachWebSocket } from '../server/http/websocket.js';

const ok = (r) => r?.ok === true;

function fixture(settings = {}) {
  const scheduler = new VirtualScheduler();
  const sent = [];
  const match = new Match({ mode: 'coop', difficulty: 'FUNNY', seed: 11, scheduler,
    seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true },
      { seat: 1, playerId: 'p2', name: '二', connected: true }],
    globalSettings: settings, data: getVersionData('act3autochess@V3_1', { log: { warn() {}, error() {} } }),
    send(playerId, message) { sent.push({ playerId, message }); },
    broadcast() {}, onEnd() {}, hexEffectAvailable: () => true, onHexSelected() {} });
  match.round = 1;
  match.phase = PHASE.PREP;
  return { match, ps: match.players.get('p1'), sent };
}

test('购买栏位在 C2S 登记为空字段消息且验证请求编号', () => {
  assert.deepEqual(C2S['g.buySlot'], {});
  assert.equal(validateC2S({ t: 'g.buySlot' }), null);
  assert.equal(validateC2S({ t: 'g.buySlot', rid: 7 }), null);
  assert.equal(validateC2S({ t: 'g.buySlot', rid: -1 }), 'bad rid');
});

test('真实 Match.handle 可购买栏位并下发更新快照', t => {
  const { match, ps, sent } = fixture();
  t.after(() => match.dispose());
  const request = { t: 'g.buySlot', rid: 1 };
  const cap0 = ps.deployCap;
  const bonus0 = ps.deployCapBonus;
  ps.funds = 30;
  assert.equal(validateC2S(request), null);
  assert.deepEqual(match.handle('p1', request), { ok: true });
  assert.equal(ps.funds, 15);
  assert.equal(ps.deploySlotBought, 1);
  assert.equal(ps.deployCapBonus, bonus0);
  assert.equal(ps.deployCap, cap0 + 1);
  const view = sent.findLast(s => s.playerId === 'p1' && s.message.t === 'm.private')?.message;
  assert.ok(view);
  assert.equal(view.funds, 15);
  assert.equal(view.deployCap, cap0 + 1);
  assert.equal(view.shop.deploySlotBought, 1);
});

test('购买额外栏位按单价扣费且栏位增加', () => {
  const { match, ps } = fixture();
  assert.equal(ps.gd.deploySlotPrice, 15);
  assert.equal(ps.gd.deploySlotMax, 9);
  const cap0 = ps.deployCap;
  ps.funds = 40;
  assert.ok(ok(ps.buyDeploySlot()));
  assert.equal(ps.funds, 25);
  assert.equal(ps.deployCap, cap0 + 1);
  assert.equal(ps.deploySlotBought, 1);
  match.dispose();
});

test('资金不足时不扣费也不加栏位', () => {
  const { match, ps } = fixture();
  const cap0 = ps.deployCap;
  ps.funds = 14;
  assert.equal(ps.buyDeploySlot().error, ERR.NO_FUNDS);
  assert.equal(ps.funds, 14);
  assert.equal(ps.deployCap, cap0);
  assert.equal(ps.deploySlotBought, 0);
  match.dispose();
});

test('累计最多购买 9 人，之后返回上限错误', () => {
  const { match, ps } = fixture();
  const cap0 = ps.deployCap;
  ps.funds = 9 * 15;
  for (let i = 0; i < 9; i++) assert.ok(ok(ps.buyDeploySlot()), `第 ${i + 1} 次应当成功`);
  assert.equal(ps.funds, 0);
  assert.equal(ps.deploySlotBought, 9);
  assert.equal(ps.deployCap, cap0 + 9);
  ps.funds = 1000;
  assert.equal(ps.buyDeploySlot().error, ERR.MAX_DEPLOY_SLOTS);
  assert.equal(ps.deploySlotBought, 9);
  assert.equal(ps.deployCap, cap0 + 9);
  match.dispose();
});

test('非准备阶段拒绝购买栏位', () => {
  const { match, ps } = fixture();
  ps.funds = 100;
  match.phase = PHASE.COMBAT;
  assert.equal(ps.buyDeploySlot().error, ERR.WRONG_PHASE);
  assert.equal(ps.funds, 100);
  assert.equal(ps.deploySlotBought, 0);
  match.dispose();
});

test('部署保底之后每 15 资金增加 1 位，跨回合与重连仍遵守整局 9 位上限', t => {
  const { match, ps, sent } = fixture();
  t.after(() => match.dispose());
  ps.deployCapBonus = 2;
  ps.deployCapMin = ps.gd.deployCap + 6;
  const cap0 = ps.deployCapMin;
  ps.funds = 150;
  for (let i = 1; i <= 9; i++) {
    assert.deepEqual(match.handle('p1', { t: 'g.buySlot' }), { ok: true });
    assert.equal(ps.funds, 150 - i * 15);
    assert.equal(ps.deployCap, cap0 + i);
    assert.equal(ps.deploySlotBought, i);
    assert.equal(ps.deployCapBonus, 2);
    ps.recompute();
    assert.equal(ps.deployCap, cap0 + i);
    if (i === 4) {
      match.round = 2;
      ps.startRound(2);
      ps.funds = 90;
      assert.equal(ps.deploySlotBought, 4);
      assert.equal(ps.deployCap, cap0 + 4);
    }
  }
  match.onDisconnect('p1');
  sent.length = 0;
  match.onReconnect('p1');
  assert.equal(ps.connected, true);
  const view = sent.findLast(s => s.playerId === 'p1' && s.message.t === 'm.private')?.message;
  assert.ok(view);
  assert.equal(view.deployCap, cap0 + 9);
  assert.equal(view.shop.deploySlotBought, 9);
  assert.equal(view.shop.deploySlotPrice, 15);
  assert.equal(view.shop.deploySlotMax, 9);
  assert.equal(view.funds, 15);
  assert.deepEqual(match.handle('p1', { t: 'g.buySlot' }), { error: ERR.MAX_DEPLOY_SLOTS });
  assert.equal(ps.funds, 15);
  ps.deployCapMin = 0;
  assert.equal(ps.deployCap, ps.gd.deployCap + 2 + 9);
});

test('负部署加成触发最低 1 位时购买仍逐次增加且兼容未初始化已购数', t => {
  const { match, ps } = fixture();
  t.after(() => match.dispose());
  ps.deployCapBonus = -ps.gd.deployCap - 5;
  ps.deployCapMin = 0;
  assert.equal(ps.deployCap, 1);
  ps.funds = 30;
  assert.deepEqual(match.handle('p1', { t: 'g.buySlot' }), { ok: true });
  assert.equal(ps.deployCap, 2);
  assert.deepEqual(match.handle('p1', { t: 'g.buySlot' }), { ok: true });
  assert.equal(ps.deployCap, 3);
  assert.equal(ps.funds, 0);
  const bonus = ps.deployCapBonus;
  delete ps.deploySlotBought;
  assert.equal(ps.deployCap, 1);
  assert.equal(ps.deployCapBonus, bonus);
});

test('真实 Match.handle 拒绝资金不足和非准备阶段且不改栏位', t => {
  const { match, ps } = fixture();
  t.after(() => match.dispose());
  const cap0 = ps.deployCap;
  ps.funds = 14;
  assert.deepEqual(match.handle('p1', { t: 'g.buySlot' }), { error: ERR.NO_FUNDS });
  match.phase = PHASE.COMBAT;
  ps.funds = 30;
  assert.deepEqual(match.handle('p1', { t: 'g.buySlot' }), { error: ERR.WRONG_PHASE });
  assert.equal(ps.funds, 30);
  assert.equal(ps.deploySlotBought, 0);
  assert.equal(ps.deployCap, cap0);
});

test('生产 /ws 与 net.js 经真实会话和房间购买栏位，随后拒绝资金不足', { timeout: 10_000 }, async t => {
  // 仅准备阶段与初始资金由内存夹具设置；升级、会话、房间路由、购买和快照均走生产实现。
  const errors = [];
  const log = { info() {}, warn() {}, debug() {}, error(...args) { errors.push(args); } };
  const data = getVersionData('act3autochess@V3_1', { log });
  const { registry, lobby, network } = createSessionStack({}, { data, log });
  const server = createServer((req, res) => { res.writeHead(404); res.end(); });
  const wss = attachWebSocket(server, { network, log });
  let ws;
  t.after(async () => {
    const serverSockets = [...network.conns.keys()];
    const serverClosed = serverSockets.map(socket => once(socket, 'close'));
    network.close();
    lobby.shutdown();
    const closed = ws && ws.readyState !== WebSocket.CLOSED ? once(ws, 'close') : null;
    ws?.terminate();
    for (const socket of serverSockets) socket.terminate();
    await Promise.all([...serverClosed, ...(closed ? [closed] : [])]);
    await Promise.all([
      new Promise((resolve, reject) => wss.close(error => error ? reject(error) : resolve())),
      server.listening ? new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) : Promise.resolve(),
    ]);
    assert.equal(network.connectionCount, 0);
    assert.equal(lobby.rooms.size, 0);
    assert.equal(server.listening, false);
    assert.deepEqual(errors, []);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { address, port } = server.address();
  assert.equal(address, '127.0.0.1');
  assert.notEqual(port, 3140);
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const frames = [];
  const waiters = new Set();
  ws.on('message', raw => {
    frames.push(JSON.parse(raw.toString()));
    for (const wake of [...waiters]) wake();
  });
  const waitFor = (predicate, from = 0) => new Promise((resolve, reject) => {
    let timer;
    const wake = () => {
      const frame = frames.slice(from).find(predicate);
      if (!frame) return;
      clearTimeout(timer);
      waiters.delete(wake);
      resolve(frame);
    };
    timer = setTimeout(() => {
      waiters.delete(wake);
      reject(new Error('等待 WebSocket 回包超时'));
    }, 2000);
    waiters.add(wake);
    wake();
  });
  let rid = 0;
  const request = async (message, type = 'ok') => {
    const from = frames.length;
    const requestId = ++rid;
    ws.send(JSON.stringify({ ...message, rid: requestId }));
    const reply = await waitFor(frame => frame.rid === requestId, from);
    assert.equal(reply.t, type);
    return reply;
  };
  await once(ws, 'open');
  await request({ t: 'g.buySlot' }, 'error').then(reply => assert.equal(reply.code, ERR.BAD_MSG));
  const welcome = await request({ t: 'hello', name: '网络栏位测试' }, 'welcome');
  const session = registry.byId(welcome.playerId);
  assert.equal(session.connected, true);
  await request({ t: 'g.buySlot' }, 'error').then(reply => assert.equal(reply.code, ERR.NOT_IN_ROOM));
  await request({ t: 'room.create', mode: 'solo' });
  const room = lobby.rooms.get(session.roomCode);
  assert.ok(room.seatOf(session.playerId));
  assert.equal(room.hostId, session.playerId);
  await request({ t: 'g.buySlot' }, 'error').then(reply => assert.equal(reply.code, ERR.WRONG_PHASE));
  const match = new Match({
    roomCode: room.code, mode: room.mode, difficulty: room.difficulty, seed: 11,
    seats: [{ ...room.seatOf(session.playerId) }],
    scheduler: new VirtualScheduler(), data,
    send: (playerId, message) => lobby.sendToPlayer(room, playerId, message),
    broadcast: message => lobby.broadcastRoom(room, message), onEnd() {},
  });
  t.after(() => match.dispose());
  room.match = match;
  match.round = 1;
  match.phase = PHASE.PREP;
  const ps = match.players.get(session.playerId);
  ps.funds = 15;
  const cap0 = ps.deployCap;
  const from = frames.length;
  await request({ t: 'g.buySlot' });
  const snapshot = await waitFor(frame => frame.t === 'm.private' && frame.shop?.deploySlotBought === 1, from);
  assert.equal(ps.funds, 0);
  assert.equal(ps.deployCap, cap0 + 1);
  assert.equal(ps.deploySlotBought, 1);
  assert.equal(snapshot.funds, 0);
  assert.equal(snapshot.deployCap, cap0 + 1);
  assert.equal(snapshot.shop.deploySlotBought, 1);
  const deniedFrom = frames.length;
  const denied = await request({ t: 'g.buySlot' }, 'error');
  assert.equal(denied.code, ERR.NO_FUNDS);
  assert.equal(ps.funds, 0);
  assert.equal(ps.deployCap, cap0 + 1);
  assert.equal(ps.deploySlotBought, 1);
  for (const frame of frames.slice(deniedFrom).filter(frame => frame.t === 'm.private')) {
    assert.equal(frame.funds, 0);
    assert.equal(frame.deployCap, cap0 + 1);
    assert.equal(frame.shop.deploySlotBought, 1);
  }
  t.diagnostic(`生产 /ws 127.0.0.1:${port}：hello/建房/路由通过；购买 ok，资金 15→0，cap ${cap0}→${cap0 + 1}，私有快照已购数 1；再次购买 ${denied.code}，状态不变`);
});

test('私有快照下发栏位单价、上限与已购数量', () => {
  const { match, ps } = fixture();
  ps.funds = 40;
  ps.buyDeploySlot();
  const view = ps.privateView();
  assert.equal(view.shop.deploySlotPrice, 15);
  assert.equal(view.shop.deploySlotMax, 9);
  assert.equal(view.shop.deploySlotBought, 1);
  assert.equal(view.shop.freeRefreshes, ps.shop.freeRefreshes);
  match.dispose();
});