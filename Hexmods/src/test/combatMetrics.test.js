import test from 'node:test';
import assert from 'node:assert/strict';
import { trackCombat, combineCombat } from '../public/js/battle/metrics.js';
import { createBattleRunner } from '../public/js/battle/runner.js';
import { makeBattle, chessRec, enemyRec } from './helpers/battleHarness.js';
import { combatMetricsLayout } from '../public/js/ui/combatMetricsLayout.js';
import * as simSpec from '../server/sim/spec.js';
import { LocalBossPool } from '../server/sim/spec.js';
import { DataSource, getDefaultSource } from '../server/sim/simdata.js';
import { flatStage, flatRoutes } from './helpers/battleHarness.js';
import { InPageSimHost, WorkerSimHost } from '../public/js/battle/simHost.js';
import { createSimWorker } from '../public/js/battle/simWorkerRuntime.js';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

async function metricsSim() {
  return { spec: simSpec, ds: new DataSource({
    stages: { meter_stage: flatStage({ id: 'meter_stage' }) },
    chess: { meter_op: chessRec({ id: 'meter_op', skill: null,
      stats: { maxHp: 2000, atk: 20, def: 0, hpRecoveryPerSec: 30, bat: .1 } }) },
    enemies: { meter_enemy: enemyRec({ key: 'meter_enemy', hp: 100000, atk: 80, bat: .1, speed: 0, range: 2 }) },
  }, getDefaultSource()) };
}
function metricsSpec(timeLimit = 1.1) {
  return simSpec.buildBattleSpec({ battleId: 'meter_worker', fieldId: 'f1', stageId: 'meter_stage',
    seed: 27, timeLimit, content: 'generic', flags: { startOpCooldown: 0 },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: 'meter_op', row: 9, col: 5 }] }],
    routes: flatRoutes(), spawns: [{ time: 0, enemyKey: 'meter_enemy', routeIndex: 0, pos: [9, 6] }] });
}
function nodeWorkerHost() {
  const worker = new Worker(new URL(import.meta.url));
  const port = { postMessage: value => worker.postMessage(value), terminate: () => worker.terminate() };
  worker.on('message', data => port.onmessage?.({ data }));
  worker.on('error', error => port.onerror?.(error));
  worker.on('messageerror', error => port.onmessageerror?.(error));
  return new WorkerSimHost({ workerFactory: () => port, timeoutMs: 15000 });
}
async function loadWorker(host) {
  await host.load('meter-test', { cs: 'meter-test', data: {} });
  return host;
}

if (!isMainThread) {
  const dispatch = createSimWorker({ loadSim: metricsSim });
  let queue = Promise.resolve();
  parentPort.on('message', data => {
    queue = queue.then(async () => {
      try { parentPort.postMessage({ id: data.id, value: await dispatch(data.method, data.args) }); }
      catch (error) { parentPort.postMessage({ id: data.id, error: { message: error.message } }); }
    });
  });
} else {

function fixture() {
  const h = makeBattle({ content: 'none', units: [{ chessId: 'meter_op', row: 10, col: 5 }],
    defs: { chess: { meter_op: chessRec({ id: 'meter_op', skill: null, stats: { maxHp: 2000, def: 0 } }) },
      enemies: { meter_enemy: enemyRec({ key: 'meter_enemy', hp: 1000, speed: 0 }) } } });
  const b = h.b;
  b.start();
  const op = b.allyUnits[0];
  const enemy = h.spawn('meter_enemy', { pos: [9, 10] });
  return { b, op, enemy };
}
const totals = (read) => combineCombat([read()], 'p1');

test('实际扣血与承伤：过量、免伤、元素条、友伤、自损和无来源', () => {
  const { b, op, enemy } = fixture();
  const read = trackCombat(b);
  b.dealDamage({ source: op, target: enemy, amount: 100, type: 'true' });
  b.dealElementDamage({ source: op, target: enemy, amount: 20, element: 'neural' });
  b.dealDamage({ source: enemy, target: op, amount: 80, type: 'true' });
  b.dealHPLose({ source: op, target: op, amount: 30 });
  b.dealHPLose({ source: null, target: op, amount: 20 });
  b.dealDamage({ source: op, target: enemy, amount: 0, type: 'true' });
  b.dealDamage({ source: op, target: enemy, amount: 5000, type: 'true' });
  const result = totals(read);
  assert.equal(result.damage, 1000);
  assert.equal(result.taken, 130);
  assert.equal(result.rows[0].types.true, 1000);
  assert.equal(Object.values(result.rows[0].types).reduce((a, n) => a + n, 0), 1000);
});

test('治疗的对象/位置接口保持原样：有效量、过疗、静默再生及 restore', () => {
  const { b, op, enemy } = fixture();
  const heal = b.heal;
  const read = trackCombat(b);
  b.dealDamage({ source: enemy, target: op, amount: 500, type: 'true' });
  assert.equal(b.heal({ source: op, target: op, amount: 120 }), 120);
  assert.equal(b.heal(op, op, 80), 80);
  assert.equal(b.heal(op, op, 40, { silent: true, regen: true }), 40);
  assert.equal(b.heal({ source: op, target: op, amount: 50, mode: 'restore' }), 50);
  assert.equal(b.heal({ source: op, target: op, amount: 1000 }), 210);
  assert.equal(b.heal(op, op, 100), 0);
  assert.equal(totals(read).healing, 450);
  assert.equal(b.heal, heal);
  assert.equal(b.errorCount, 0);
});

test('禁疗和零结算不计入有效治疗', () => {
  const { b, op } = fixture();
  const read = trackCombat(b);
  op.hp -= 100;
  b.addBuff(op, { key: 'meter_noheal', flags: { healFree: true }, duration: 10 });
  assert.equal(b.heal({ source: op, target: op, amount: 90 }), 0);
  assert.equal(totals(read).healing, 0);
});

test('嵌套结算精确归类，无重复累计，显式 credit:null 不回退来源', () => {
  const { b, op, enemy } = fixture();
  b.on('hpChanged', (c) => {
    if (c.dmg?.type === 'phys') b.dealDamage({ source: op, target: enemy, amount: 25, type: 'true' });
  }, { priority: Number.MAX_VALUE });
  const read = trackCombat(b);
  b.dealDamage({ source: op, target: enemy, amount: 100, type: 'phys' });
  b.dealDamage({ source: op, credit: null, target: enemy, amount: 50, type: 'arts' });
  const row = totals(read).rows[0];
  assert.equal(row.damage, 125);
  assert.equal(row.types.phys, 100);
  assert.equal(row.types.true, 25);
  assert.equal(row.types.arts, 0);
});

test('嵌套治疗与再次读取不重复计算', () => {
  const { b, op } = fixture();
  const read = trackCombat(b);
  op.hp -= 500;
  let nested = false;
  b.on('heal', () => { if (!nested) { nested = true; b.heal({ source: op, target: op, amount: 50 }); } });
  b.heal({ source: op, target: op, amount: 100 });
  assert.equal(totals(read).healing, 150);
  assert.equal(totals(read).healing, 150);
});

test('召唤物三项归属沿用 ownerUnit 链，重复挂载只有一份', () => {
  const { b, op, enemy } = fixture();
  const read = trackCombat(b);
  assert.equal(trackCombat(b), read);
  const summon = Object.assign(Object.create(Object.getPrototypeOf(op)), op, {
    kind: 'token', id: 'summon', uid: null, ownerUnit: op, stats: { ...op.stats }, hp: 300,
  });
  b.dealDamage({ source: summon, target: enemy, amount: 70, type: 'true' });
  b.heal({ source: summon, target: summon, amount: 40 });
  b.dealHPLose({ source: null, target: summon, amount: 20 });
  const result = totals(read);
  assert.equal(result.rows.length, 1);
  assert.equal(result.damage, 70);
  assert.equal(result.healing, 40);
  assert.equal(result.taken, 20);
  read.stop(); read.stop();
  b.dealDamage({ source: op, target: enemy, amount: 10, type: 'true' });
  assert.equal(totals(read).damage, 70);
});

test('安装统计不改变模拟结算、随机数或快照', () => {
  const a = fixture(), b = fixture();
  trackCombat(a.b);
  for (const f of [a, b]) {
    f.b.dealDamage({ source: f.op, target: f.enemy, amount: 90, type: 'phys' });
    f.b.dealHPLose({ source: f.enemy, target: f.op, amount: 20 });
    f.b.heal({ source: f.op, target: f.op, amount: 10 });
    for (let i = 0; i < 30; i++) f.b.step();
  }
  assert.deepEqual(a.b.snapshot(), b.b.snapshot());
  assert.deepEqual(a.b.result(), b.b.result());
  assert.equal(a.b.rng.state(), b.b.rng.state());
});

function runnerFixture({ hidden = false } = {}) {
  const handlers = new Map();
  let clock = 0, frame = null, pump = null, current;
  const net = { on: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name); }, send() {} };
  const sim = { ds: {}, spec: {
    createBattleFromSpec() {
      current = fixture();
      current.b.on('tick', () => {
        current.b.dealHPLose({ source: current.op, target: current.enemy, amount: 1 });
        current.b.dealHPLose({ source: null, target: current.op, amount: 1 });
        current.b.heal({ source: current.op, target: current.op, amount: 1 });
      });
      return current.b;
    }, attachLpMeter: () => ({ lp: 0 }), battleProgress: () => ({ leaks: 0 }), compactResult: (r) => r,
  } };
  const runner = createBattleRunner({ net, store: { patch() {} }, loadSim: async () => sim,
    combatMetrics: false, now: () => clock, doc: { hidden, addEventListener() {} },
    raf: (fn) => { frame = fn; return 1; }, caf() {}, setInterval: (fn) => { pump = fn; return 1; }, clearInterval() {},
  });
  return { runner, start: (id = 'b1', elapsed = 0, authoritative = false, watch = false) => handlers.get('b.start')({ battleId: id, fieldId: 'f1',
    spec: { players: [{ playerId: 'p1' }] }, elapsed, speed: 1, authoritative, watch }),
    async ready() { for (let i = 0; i < 200 && !runner.state()?.members; i++) { frame?.(); await new Promise(setImmediate); } assert.ok(runner.state()?.members); },
    advance(ms) { clock += ms; if (hidden) pump?.(); else frame?.(); }, current: () => current };
}

test('runner 默认持续采集：中途设置开关、后台泵、静默追帧不漏', async () => {
  for (const hidden of [false, true]) {
    const f = runnerFixture({ hidden });
    try {
      f.start('b1', 2, true); await f.ready();
      const first = f.runner.combatMetrics({ ownerId: 'p1' });
      assert.ok(first.damage >= 50);
      f.runner.setCombatMetrics(true); f.advance(1000);
      f.runner.setCombatMetrics(false); f.advance(1000);
      const result = f.runner.combatMetrics({ ownerId: 'p1' });
      assert.ok(result.damage > first.damage);
      assert.equal(result.damage, result.healing);
      assert.equal(result.damage, result.taken);
    } finally { f.runner.dispose(); }
  }
});

test('runner 同 battleId 重发/清场重播替换快照，跨场累计，上一场只取已结束', async () => {
  const f = runnerFixture();
  try {
    f.start(); await f.ready(); f.advance(1000);
    const before = f.runner.combatMetrics({ ownerId: 'p1' }).damage;
    f.start(); await new Promise(setImmediate);
    assert.equal(f.runner.combatMetrics({ ownerId: 'p1' }).damage, before);
    f.runner.clear({ keepMetrics: true });
    assert.equal(f.runner.combatMetrics({ scope: 'last', ownerId: 'p1' }).damage, 0);
    f.start(); await f.ready(); f.advance(2000);
    assert.equal(f.runner.combatMetrics({ ownerId: 'p1' }).damage, f.runner.combatMetrics({ scope: 'battle', ownerId: 'p1' }).damage);
    f.current().b.forceEnd('forced');
    const ended = f.runner.combatMetrics({ scope: 'last', ownerId: 'p1' }).damage;
    f.runner.clear({ keepMetrics: true });
    f.start('b2'); await f.ready(); f.advance(1000);
    assert.equal(f.runner.combatMetrics({ scope: 'last', ownerId: 'p1' }).damage, ended);
    assert.equal(f.runner.combatMetrics({ ownerId: 'p1' }).damage, ended + f.runner.combatMetrics({ scope: 'battle', ownerId: 'p1' }).damage);
    f.runner.clear();
    assert.equal(f.runner.combatMetrics().damage, 0);
  } finally { f.runner.dispose(); }
});

test('切换观战副本后返回本场，历史快照与当前快照不重复叠加', async () => {
  const f = runnerFixture();
  try {
    f.start('own'); await f.ready(); f.advance(1000);
    const own = f.runner.combatMetrics({ ownerId: 'p1' }).damage;
    f.start('replica', 0, false, true); await f.ready(); f.advance(1000);
    const combined = f.runner.combatMetrics({ ownerId: 'p1' }).damage;
    assert.ok(combined > own);
    f.start('own'); await new Promise(setImmediate);
    assert.equal(f.runner.combatMetrics({ ownerId: 'p1' }).damage, combined);
  } finally { f.runner.dispose(); }
});

test('真实 Worker 协议与页内相同战斗三项完全一致，节流不丢自然结束尾包', async () => {
  const remote = await loadWorker(nodeWorkerHost());
  const local = await new InPageSimHost({ loadSim: metricsSim }).load();
  try {
    const spec = metricsSpec();
    local.start(spec); await remote.start(spec);
    assert.deepEqual(remote.combatMetrics(), local.combatMetrics());
    local.step(1); const first = await remote.step(1);
    assert.equal('combatMetrics' in first, false);
    local.step(7); const update = await remote.step(7);
    assert.ok(update.combatMetrics);
    assert.deepEqual(remote.combatMetrics(), local.combatMetrics());
    local.step(24); const lastLive = await remote.step(24);
    assert.ok(lastLive.combatMetrics);
    local.step(600); const final = await remote.step(600);
    assert.ok(final.state.time - lastLive.state.time < .25);
    assert.equal(final.state.finished, true);
    assert.equal(final.combatMetrics.complete, true);
    assert.deepEqual(remote.combatMetrics(), local.combatMetrics());
    assert.deepEqual(remote.battle.snapshot(), local.battle.snapshot());
    assert.deepEqual(remote.compactResult(), local.compactResult({ battleId: spec.battleId }));
    const result = totals(remote.combatMetrics);
    assert.ok(result.damage > 0); assert.ok(result.healing > 0); assert.ok(result.taken > 0);
    const before = remote.combatMetrics();
    remote.accept(final); remote.accept(final);
    assert.deepEqual(remote.combatMetrics(), before);
    assert.ok(JSON.stringify(final.combatMetrics).length < 2000);
  } finally { remote.stop(); local.stop(); }
});

test('真实 Worker 强制结束最终同步，重播归零且迟到旧包不污染新战斗', async () => {
  const remote = await loadWorker(nodeWorkerHost());
  const local = await new InPageSimHost({ loadSim: metricsSim }).load();
  try {
    const spec = metricsSpec(20);
    local.start(spec); await remote.start(spec);
    local.step(20); await remote.step(20);
    local.forceEnd('forced'); await remote.forceEnd('forced');
    assert.deepEqual(remote.combatMetrics(), local.combatMetrics());
    assert.equal(remote.combatMetrics().complete, true);
    await remote.start(spec);
    const previous = remote.combatMetrics;
    const oldStep = remote.step(20);
    const finalRead = previous.flush();
    const restart = remote.start(spec);
    await oldStep;
    assert.equal(totals(remote.combatMetrics).taken, 0);
    assert.equal(remote.battle.time, 0);
    await Promise.all([finalRead, restart]);
    assert.ok(totals(previous).taken > 0);
    assert.equal(totals(remote.combatMetrics).taken, 0);
    assert.equal(remote.combatMetrics().complete, false);
    assert.equal(remote.battle.time, 0);
    local.start(spec); local.step(20); await remote.step(20);
    local.forceEnd('forced'); await remote.forceEnd('forced');
    assert.deepEqual(remote.combatMetrics(), local.combatMetrics());
  } finally { remote.stop(); local.stop(); }
});

test('runner 真实 Worker：当前/上一场/累计一致，清场在途尾包及重播不重复', async () => {
  const host = nodeWorkerHost();
  const runner = createBattleRunner({ net: { on: () => () => {}, send() {} }, store: { patch() {} },
    vanillaCs: () => 'official', simContent: () => ({ cs: 'meter-test' }),
    contentFor: async () => ({ cs: 'meter-test', data: {} }),
    loadSim: async () => ({ remote: true, cs: 'meter-test', content: { cs: 'meter-test', data: {} } }),
    createHost: () => host, now: () => 0, doc: { hidden: true, addEventListener() {} },
    raf: () => 1, caf() {}, setInterval: () => 1, clearInterval() {} });
  const spec = { ...metricsSpec(20), cs: 'meter-test' };
  const start = () => runner.onStart({ battleId: spec.battleId, fieldId: 'f1', spec, speed: 1, elapsed: 0 });
  try {
    await start(); await host.step(19);
    const inFlight = host.step(1);
    const entry = runner._entries.get(spec.battleId);
    runner.clear({ keepMetrics: true });
    await inFlight; await entry.metricsFlush;
    const tail = totals(host.combatMetrics);
    assert.ok(tail.healing > 0);
    assert.deepEqual(runner.combatMetrics({ ownerId: 'p1' }), tail);
    await start(); await host.step(20); await host.forceEnd('forced');
    assert.deepEqual(runner.combatMetrics({ scope: 'battle', ownerId: 'p1' }), tail);
    assert.deepEqual(runner.combatMetrics({ scope: 'last', ownerId: 'p1' }), tail);
    assert.deepEqual(runner.combatMetrics({ ownerId: 'p1' }), tail);
    const replay = runner._entries.get(spec.battleId);
    runner.clear({ keepMetrics: true }); await replay.metricsFlush;
    assert.deepEqual(runner.combatMetrics({ scope: 'last', ownerId: 'p1' }), tail);
    await start(); const pendingStep = host.step(20);
    const reset = runner._entries.get(spec.battleId);
    runner.clear(); await pendingStep; await reset.metricsFlush;
    assert.equal(runner.combatMetrics({ ownerId: 'p1' }).damage, 0);
  } finally { runner.dispose(); }
});

test('同名干员合并三项、跨玩家隔离，快照不被汇总修改', () => {
  const row = { ownerId: 'p1', name: '同名', kind: 'op', damage: 1, healing: 2, taken: 3, types: { true: 1 } };
  const record = { seconds: 1, owners: ['p1', 'p2'], rows: [row, { ...row }, { ...row, ownerId: 'p2' }] };
  assert.deepEqual([combineCombat([record], 'p1').damage, combineCombat([record], 'p1').healing, combineCombat([record], 'p1').taken], [2, 4, 6]);
  assert.equal(combineCombat([record]).rows.length, 2);
  assert.equal(row.taken, 3);
});

test('Boss 血池同步不当作伤害，过量只计池中实际扣血', () => {
  const { b, op, enemy } = fixture();
  const read = trackCombat(b);
  enemy.bossPool = new LocalBossPool(1000);
  b.dealDamage({ source: op, target: enemy, amount: 100, type: 'true' });
  enemy.bossPool.sync(600, 100);
  assert.equal(totals(read).damage, 100);
  b.dealDamage({ source: op, target: enemy, amount: 1000, type: 'true' });
  assert.equal(totals(read).damage, 700);
});

test('吸收盾、致死保护和命中次数生命只记录实际 HP 损失', () => {
  for (const mode of ['shield', 'fatal', 'hitCount']) {
    const { b, op, enemy } = fixture();
    const read = trackCombat(b);
    let expected;
    if (mode === 'shield') {
      b.addBuff(enemy, { key: 'meter_shield', shield: 200, duration: 10 });
      expected = 0;
    } else if (mode === 'fatal') {
      enemy.hp = 100;
      b.on('fatal', (c) => { if (c.unit === enemy) { enemy.hp = 1; c.prevented = true; } });
      expected = 99;
    } else {
      b.addBuff(enemy, { key: 'meter_hits', flags: { hitCount: true }, duration: 10 });
      expected = 1;
    }
    b.dealDamage({ source: op, target: enemy, amount: 100, type: 'true' });
    assert.equal(totals(read).damage, expected, mode);
    assert.equal(b.errorCount, 0);
  }
});

test('采集器在部署和 battleStart 前挂载，部署治疗不漏采', () => {
  const h = makeBattle({ content: 'none', units: [{ chessId: 'meter_start', row: 10, col: 5 }],
    defs: { chess: { meter_start: chessRec({ id: 'meter_start', skill: null }) } } });
  const read = trackCombat(h.b);
  h.b.on('battleStart', () => {
    const op = h.b.allyUnits[0];
    h.b.dealHPLose({ target: op, amount: 100 });
    h.b.heal({ source: op, target: op, amount: 80 });
  });
  h.b.step();
  assert.equal(totals(read).taken, 100);
  assert.equal(totals(read).healing, 80);
});

test('直接改血没有结算事件，不猜测伤害归因；restore 不计治疗', () => {
  const { b, op } = fixture();
  const read = trackCombat(b);
  op.hp -= 100;
  b.heal({ source: op, target: op, amount: 100, mode: 'restore' });
  assert.equal(totals(read).taken, 0);
  assert.equal(totals(read).healing, 0);
});

test('矮屏统计面板落在可视区内', () => {
  const layout = combatMetricsLayout({ cornerTop: 60, cornerBottom: 110, viewportHeight: 390, rem: 40 });
  assert.equal(layout.viewportDocked, true);
  assert.ok(layout.viewportSpace <= 390);
});
}
