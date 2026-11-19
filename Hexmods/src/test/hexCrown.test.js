// 魔王冠冕（彩）：干员 +1 阻挡、50% 全属性起，完美 +1% / 非完美 −2%，下限 15%、无上限。
// 用户 2026-11-18 确认：加算；全属性 = 攻/防/最大生命/法抗；只统计自己的普通战斗；仅自己的干员。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { HEX_CATALOG } from '../shared/hexCatalog.js';
import { applyHexEffect, hexCrownPct, settleHexCrown } from '../server/match/hexEffects.js';
import { makeBattle, chessRec, enemyRec } from './helpers/battleHarness.js';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(resolve(srcRoot, rel), 'utf8');
const close = (actual, expected, msg = '') => assert.ok(Math.abs(actual - expected) < 1e-6,
  `${msg} ${actual} != ${expected}`);
const card = name => HEX_CATALOG.find(c => c.name === name);

function fixture() {
  const log = { warn() {}, error() {} };
  const match = new Match({ mode: 'coop', difficulty: 'FUNNY', seed: 7, scheduler: new VirtualScheduler(),
    seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true }],
    data: getData({ log }), hexEffectAvailable: () => true, send() {}, broadcast() {}, onEnd() {} });
  match.round = 1;
  return { match, ps: match.players.get('p1') };
}

const defs = {
  chess: {
    bare: chessRec({ id: 'bare', stats: { maxHp: 1000, atk: 100, def: 100 }, skill: { spCost: 100 } }),
  },
  enemies: { dummy: enemyRec({ key: 'dummy', hp: 100000, def: 0, res: 0, speed: 0 }) },
};

function fight(picks, units, opts = {}) {
  const h = makeBattle({ content: 'generic', defs, players: [
    { playerId: 'p1', hexPicks: picks, hexCrown: opts.hexCrown, bonds: {}, units },
    { playerId: 'p2', bonds: {}, units: [{ uid: 99, chessId: 'bare', row: 10, col: 3 }] },
  ] });
  h.b.start();
  return h;
}

test('目录条目为彩色战斗卡，文案含全部数值与下限', () => {
  const entry = card('魔王冠冕');
  assert.ok(entry, '目录应包含魔王冠冕');
  assert.equal(entry.rarity, '彩');
  assert.deepEqual(entry.tags, ['战斗']);
  assert.equal(entry.effect,
    '干员获得 1 点阻挡数，并获得 50% 全属性提升。每次完美作战使该提升额外 +1%，非完美作战则 -2%；加成无上限，最低 15%。');
});

test('选卡后冠冕从 50% 起算，完美 +1、非完美 -2、下限 15、无上限', () => {
  const { match, ps } = fixture();
  assert.equal(hexCrownPct(ps), 0);
  ps.hexPicks = [{ id: 'hex_crown', name: '魔王冠冕', rarity: '彩', round: 1 }];
  assert.equal(applyHexEffect(match, ps, card('魔王冠冕')).status, 'applied');
  assert.equal(hexCrownPct(ps), 50);

  assert.deepEqual(settleHexCrown(ps, true), { before: 50, after: 51, perfect: true });
  assert.equal(hexCrownPct(ps), 51);
  assert.deepEqual(settleHexCrown(ps, false), { before: 51, after: 49, perfect: false });
  assert.equal(hexCrownPct(ps), 49);

  // 下限 15：连续失败的扣减在 15% 处停住，不再继续下降
  for (let i = 0; i < 40; i++) settleHexCrown(ps, false);
  assert.equal(hexCrownPct(ps), 15);
  settleHexCrown(ps, false);
  assert.equal(hexCrownPct(ps), 15);

  // 无上限：从 15% 起连续完美可以一直累加
  for (let i = 0; i < 100; i++) settleHexCrown(ps, true);
  assert.equal(hexCrownPct(ps), 115);
  match.dispose();
});

test('未持有冠冕的玩家结算不产生任何状态', () => {
  const { match, ps } = fixture();
  assert.equal(settleHexCrown(ps, true), null);
  assert.equal(ps.hexEffectState?.crown, undefined);
  match.dispose();
});

test('战斗开场按当前加成提升攻防血法抗，并为干员 +1 阻挡', () => {
  const h = fight(['魔王冠冕'], [{ uid: 1, chessId: 'bare', row: 9, col: 3 }], { hexCrown: 50 });
  const [unit, other] = h.b.allyUnits;
  close(unit.s.atk / unit.base.atk, 1.50);
  close(unit.s.maxHp / unit.base.maxHp, 1.50);
  close(unit.s.def / unit.base.def, 1.50);
  close(unit.s.res, unit.base.res * 1.50);
  assert.equal(unit.s.blockCnt, (unit.base.blockCnt || 0) + 1);
  // 其他玩家不享受
  close(other.s.atk / other.base.atk, 1);
  assert.equal(other.s.blockCnt, other.base.blockCnt || 0);
  assert.equal(h.b.errorCount, 0);
});

test('低于 15 的传入值按 15% 保底处理', () => {
  const h = fight(['魔王冠冕'], [{ uid: 1, chessId: 'bare', row: 9, col: 3 }], { hexCrown: 5 });
  const [unit] = h.b.allyUnits;
  close(unit.s.atk / unit.base.atk, 1.15);
  assert.equal(unit.s.blockCnt, (unit.base.blockCnt || 0) + 1);
  assert.equal(h.b.errorCount, 0);
});

test('没选冠冕时战斗不获得加成', () => {
  const h = fight([], [{ uid: 1, chessId: 'bare', row: 9, col: 3 }], { hexCrown: 50 });
  const [unit] = h.b.allyUnits;
  close(unit.s.atk / unit.base.atk, 1);
  assert.equal(unit.s.blockCnt, unit.base.blockCnt || 0);
  assert.equal(h.b.errorCount, 0);
});

test('战斗输入携带冠冕当前值，结算只在非联防的普通战斗更新', () => {
  const round = read('server/match/player/round.js');
  assert.match(round, /hexEffectState\?\.crown \? \{ hexCrown: Math\.max\(15,/);
  const settle = read('server/match/match/settle.js');
  assert.match(settle, /if \(!uniteResult\) settleHexCrown\(ps, r\.perfect !== false && counted === 0\);/);
  // Boss 战走 bossRounds 的独立结算，不调用冠冕更新
  const boss = read('server/match/match/bossRounds.js');
  assert.ok(!boss.includes('settleHexCrown'), 'Boss 战不计入冠冕增减');
});
