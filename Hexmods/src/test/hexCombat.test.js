import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { getData } from '../server/data.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';
import { DataSource, getDefaultSource } from '../server/sim/simdata.js';
import { chessRec, flatStage } from './helpers/battleHarness.js';

const data = new DataSource({ stages: { flat: flatStage() }, chess: {
  op: chessRec({ id: 'op', skill: null, stats: { maxHp: 1000, atk: 100 } }),
} }, getDefaultSource());
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

function battle(picks, bonds = {}, kind = 'normal') {
  const spec = buildBattleSpec({ kind, stageId: 'flat', content: 'none', players: [
    { playerId: 'p1', bonds, hexPicks: picks, units: [{ uid: 1, chessId: 'op', row: 9, col: 5 }] },
    { playerId: 'p2', bonds, units: [{ uid: 2, chessId: 'op', row: 10, col: 5 }] },
  ] });
  return { spec, sim: createBattleFromSpec(spec, data, { quiet: true }) };
}

test('选择状态进入真实战场规格并发放安慰奖资金', () => {
  const match = new Match({ mode: 'solo', difficulty: 'FUNNY', seed: 7, scheduler: new VirtualScheduler(),
    seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true }],
    globalSettings: { hexEnabled: true, hexRounds: [1], hexCustomEnabled: true },
    hexSelections: { p1: { 1: '安慰奖' } }, data: getData({ log: { warn() {}, error() {} } }),
    send() {}, broadcast() {}, onEnd() {} });
  match.round = 1;
  const ps = match.players.get('p1');
  const funds = ps.funds;
  assert.equal(match.openHexWindow(), true);
  const window = match.offerWin[0];
  assert.equal(match.requestOffer(ps, 'hex', 0, { pluginId: 'hex', seq: window.seq }).ok, true);
  assert.equal(ps.funds, funds + 8);
  ps.board.set('9,5', { uid: 100, kind: 'chess', id: ps.gd.visibleChess[0], items: [] });
  ps._legalityStale = false;
  const input = ps.battleInput();
  assert.equal(input.units.length, 1);
  const field = match._ccField({ fieldId: 'n:p1', kind: 'normal', players: ['p1'], opts: { players: [input] } });
  assert.deepEqual(field.spec.players[0].hexPicks, ['安慰奖']);
  assert.deepEqual(match._startMsg(field, 'p1').spec.players[0].hexPicks, ['安慰奖']);
  const actual = match._specBattle(field.spec);
  const baseSpec = structuredClone(field.spec);
  delete baseSpec.players[0].hexPicks;
  const base = match._specBattle(baseSpec);
  assert.equal(actual.allyUnits.length, 1);
  close(actual.allyUnits[0].s.atk / base.allyUnits[0].s.atk, 1.01);
  match.dispose();
});

test('各档按激活盟约数量增加属性，未选玩家不受影响', () => {
  const bonds = { a: { active: true, tier: 2 }, b: { active: true, tier: 1 }, c: { active: false } };
  for (const [name, value, pen] of [['众志合一', .03, .005], ['众志合一+', .05, .01], ['众志合一++', .07, .015]]) {
    const { sim } = battle([name, '安慰奖'], bonds);
    sim.start();
    const [op, other] = sim.allyUnits;
    close(op.s.atk / op.base.atk, 1.01 + 2 * value);
    close(op.s.maxHp / op.base.maxHp, 1 + 2 * value);
    close(op.s.defIgnorePct, 2 * pen);
    close(op.s.resIgnorePct, 2 * pen);
    close(other.s.atk / other.base.atk, 1);
    close(other.s.maxHp / other.base.maxHp, 1);
    assert.equal(sim.errorCount, 0);
  }
});

test('低阶调香按最大生命每秒恢复，规格往返保持一致', () => {
  const { spec, sim } = battle(['低阶调香']);
  const replica = createBattleFromSpec(JSON.parse(JSON.stringify(spec)), data, { quiet: true });
  for (const b of [sim, replica]) {
    b.start();
    const [op, other] = b.allyUnits;
    op.hp -= 100; other.hp -= 100;
    for (let i = 0; i < 30; i++) b.step();
    close(op.hp, op.s.maxHp - 100 + op.s.maxHp * .002 * b.time);
    close(other.hp, other.s.maxHp - 100);
    assert.equal(b.errorCount, 0);
  }
  close(sim.allyUnits[0].hp, replica.allyUnits[0].hp);
});
