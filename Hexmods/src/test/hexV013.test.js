import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getData, getVersionData } from '../server/data.js';
import { DataSource } from '../server/sim/simdata.js';
import * as bondSupport from '../server/sim/content/support/index.js';
import { install as installCoreBonds } from '../server/sim/content/bonds/core.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { HEX_CATALOG, hexBondCardBlocked } from '../shared/hexCatalog.js';
import { applyHexEffect, advanceHexEffects, eligibleGift, hexBlocksSellFunds } from '../server/match/hexEffects.js';
import { makeBattle, chessRec, enemyRec } from './helpers/battleHarness.js';

const card = name => HEX_CATALOG.find(c => c.name === name);
const close = (actual, expected, msg = '') => assert.ok(Math.abs(actual - expected) < 1e-6,
  `${msg} ${actual} != ${expected}`);

function fixture() {
  const log = { warn() {}, error() {} };
  const match = new Match({ mode: 'coop', difficulty: 'FUNNY', seed: 7, scheduler: new VirtualScheduler(),
    seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true }],
    data: getData({ log }), hexEffectAvailable: () => true, send() {}, broadcast() {}, onEnd() {} });
  match.round = 1;
  return { match, ps: match.players.get('p1') };
}

// ── 经济 / 回合类 ────────────────────────────────────────────────────────

test('再就业回执立即给 1 资金并登记每回合一次的出售刷新', () => {
  const { match, ps } = fixture();
  const before = ps.funds;
  assert.equal(applyHexEffect(match, ps, card('再就业回执')).status, 'applied');
  assert.equal(ps.funds, before + 1);
  assert.deepEqual(ps.hexEffectState.rehire, { round: 1, used: false });
  match.dispose();
});

test('花到上头与花到上头++ 每休整期发放资源、拦截出售资金且互斥', () => {
  const { match, ps } = fixture();
  assert.equal(hexBlocksSellFunds(ps), false);
  const funds = ps.funds;
  const refreshes = ps.shop.freeRefreshes;
  ps.hexPicks = [{ id: 'x', name: '花到上头', rarity: '金', round: 1 }];
  assert.equal(applyHexEffect(match, ps, card('花到上头')).status, 'applied');
  assert.equal(ps.funds, funds + 5);
  assert.equal(ps.shop.freeRefreshes, refreshes + 2);
  assert.equal(hexBlocksSellFunds(ps), true);
  // 同一回合不重复发放，新回合再发一次
  advanceHexEffects(match, ps, 'prepStart');
  assert.equal(ps.funds, funds + 5);
  match.round = 2;
  advanceHexEffects(match, ps, 'prepStart');
  assert.equal(ps.funds, funds + 10);
  assert.deepEqual(card('花到上头').incompatibleWith, ['花到上头++']);
  assert.deepEqual(card('花到上头++').incompatibleWith, ['花到上头']);
  match.dispose();
});

test('超前投资清零当前资金并两回合后按 3 倍返还', () => {
  const { match, ps } = fixture();
  ps.funds = 5;
  const result = applyHexEffect(match, ps, card('超前投资'));
  assert.equal(result.status, 'applied');
  assert.equal(result.lost, 8); // 5 + 刚落袋的 3
  assert.equal(ps.funds, 0);
  advanceHexEffects(match, ps, 'roundStart'); // 第 1 回合：还没到期
  assert.equal(ps.funds, 0);
  match.round = 3;
  advanceHexEffects(match, ps, 'roundStart');
  assert.equal(ps.funds, 24);
  advanceHexEffects(match, ps, 'roundStart'); // 只发一次
  assert.equal(ps.funds, 24);
  match.dispose();
});

test('越级调度免费升一级；满级改为资金与刷新', () => {
  const { match, ps } = fixture();
  const level = ps.shop.level;
  const refreshes = ps.shop.freeRefreshes;
  assert.equal(applyHexEffect(match, ps, card('越级调度')).status, 'applied');
  assert.equal(ps.shop.level, level + 1);
  assert.equal(ps.shop.freeRefreshes, refreshes + 3);
  ps.shop.level = ps.gd.maxShopLevel;
  const funds = ps.funds;
  const r2 = ps.shop.freeRefreshes;
  assert.equal(applyHexEffect(match, ps, card('越级调度')).status, 'applied');
  assert.equal(ps.funds, funds + 15);
  assert.equal(ps.shop.freeRefreshes, r2 + 5);
  match.dispose();
});

test('偏科补课给最低层已激活盟约 +8 层，重锤回响按 25 层里程碑给资金', () => {
  const { match, ps } = fixture();
  ps.hexPicks = [{ id: 'x', name: '偏科补课', rarity: '金', round: 1 }];
  ps.bonds.visiShip = { active: true };
  ps.bonds.miraShip = { active: true };
  ps.layers.visiShip = 3;
  ps.layers.miraShip = 20;
  advanceHexEffects(match, ps, 'prepEnd');
  assert.equal(ps.layers.visiShip, 11);
  assert.equal(ps.layers.miraShip, 20);

  ps.hexPicks = [{ id: 'y', name: '重锤回响', rarity: '金', round: 1 }];
  ps.layers.victoriaShip = 50;
  ps.hexEffectState.hammer = { paid: 0 };
  const funds = ps.funds;
  advanceHexEffects(match, ps, 'prepEnd');
  assert.equal(ps.funds, funds + 10); // 两个里程碑，每层 5 资金
  advanceHexEffects(match, ps, 'prepEnd');
  assert.equal(ps.funds, funds + 10); // 同一批里程碑不再重复
  match.dispose();
});

// ── 战斗类 ──────────────────────────────────────────────────────────────

const defs = {
  chess: {
    bare: chessRec({ id: 'bare', stats: { maxHp: 1000, atk: 100, def: 100 }, skill: { spCost: 100 } }),
    yan: chessRec({ id: 'yan', bonds: ['yanShip'], stats: { maxHp: 1000, atk: 100, def: 100 }, skill: { spCost: 100 } }),
  },
  enemies: { dummy: enemyRec({ key: 'dummy', hp: 100000, def: 0, res: 0, speed: 0 }) },
};

function fight(picks, units, opts = {}) {
  const h = makeBattle({ content: 'generic', defs, players: [
    { playerId: 'p1', hexPicks: picks, bonds: opts.bonds || {}, lp: opts.lp, startLp: opts.startLp, units },
    { playerId: 'p2', bonds: {}, units: [{ uid: 99, chessId: 'bare', row: 10, col: 3 }] },
  ] });
  h.b.start();
  return h;
}

test('空装上阵只惠及未携带装备的干员', () => {
  const h = fight(['空装上阵'], [
    { uid: 1, chessId: 'bare', row: 9, col: 3 },
    { uid: 2, chessId: 'bare', row: 9, col: 6, items: ['test_item'] },
  ]);
  const [bare, geared, other] = h.b.allyUnits;
  close(bare.s.atk / bare.base.atk, 1.10);
  close(bare.s.maxHp / bare.base.maxHp, 1.10);
  close(geared.s.atk / geared.base.atk, 1);
  close(other.s.atk / other.base.atk, 1);
  assert.equal(h.b.errorCount, 0);
});

test('结阵按四向相邻数量叠加最大生命与防御', () => {
  const h = fight(['结阵'], [
    { uid: 1, chessId: 'bare', row: 9, col: 3 },
    { uid: 2, chessId: 'bare', row: 9, col: 4 },
    { uid: 3, chessId: 'bare', row: 9, col: 7 },
  ]);
  const [a, b, lone] = h.b.allyUnits;
  close(a.s.maxHp, a.base.maxHp + 500);
  close(a.s.def, a.base.def * 1.10);
  close(b.s.maxHp, b.base.maxHp + 500);
  close(lone.s.maxHp, lone.base.maxHp);
  close(lone.s.def, lone.base.def);
  assert.equal(h.b.errorCount, 0);
});

test('海克斯装备集成需要至少两件装备', () => {
  const h = fight(['海克斯装备集成'], [
    { uid: 1, chessId: 'bare', row: 9, col: 3, items: ['a', 'b'] },
    { uid: 2, chessId: 'bare', row: 9, col: 6, items: ['a'] },
  ]);
  const [two, one] = h.b.allyUnits;
  close(two.s.atk / two.base.atk, 1.20);
  close(two.s.maxHp / two.base.maxHp, 1.15);
  close(one.s.atk / one.base.atk, 1);
  assert.equal(h.b.errorCount, 0);
});

test('少而精在干员不超过 5 名时给 80% 攻击生命与 20 攻速', () => {
  const h = fight(['少而精'], [
    { uid: 1, chessId: 'bare', row: 9, col: 3 },
    { uid: 2, chessId: 'bare', row: 9, col: 6 },
  ]);
  const [a, b, other] = h.b.allyUnits;
  for (const u of [a, b]) {
    close(u.s.atk / u.base.atk, 1.80);
    close(u.s.maxHp / u.base.maxHp, 1.80);
    close(u.s.aspd, 120);
  }
  close(other.s.atk / other.base.atk, 1);
  assert.equal(h.b.errorCount, 0);
});

test('背水一战只在玩家生命不高于初始 50% 时生效', () => {
  const units = [{ uid: 1, chessId: 'bare', row: 9, col: 3 }];
  const hurt = fight(['背水一战'], units, { lp: 50, startLp: 100 });
  close(hurt.b.allyUnits[0].s.atk / hurt.b.allyUnits[0].base.atk, 1.25);
  const safe = fight(['背水一战'], units, { lp: 51, startLp: 100 });
  close(safe.b.allyUnits[0].s.atk / safe.b.allyUnits[0].base.atk, 1);
});

test('坚定风采在首次跌破 30% 生命时回复，且每场只触发一次', () => {
  const h = fight(['坚定风采'], [{ uid: 1, chessId: 'bare', row: 9, col: 3 }]);
  const unit = h.b.allyUnits[0];
  const maxHp = unit.s.maxHp;
  h.b.dealDamage({ source: null, target: unit, amount: maxHp * 0.75, type: 'true', canDodge: false });
  close(unit.hp, maxHp * 0.75, '回复 50% 后');
  const healed = unit.hp;
  h.b.dealDamage({ source: null, target: unit, amount: maxHp * 0.30, type: 'true', canDodge: false });
  assert.ok(unit.hp < healed);
  assert.equal(h.b.errorCount, 0);
});

test('坚定风采+ 回复 80% 并附 3 秒减伤', () => {
  const h = fight(['坚定风采+'], [{ uid: 1, chessId: 'bare', row: 9, col: 3 }]);
  const unit = h.b.allyUnits[0];
  h.b.dealDamage({ source: null, target: unit, amount: unit.s.maxHp * 0.75, type: 'true', canDodge: false });
  const buff = unit.findBuff('hex:firmPlus');
  assert.ok(buff && buff.mods.dmgTakenMul === 0.8);
  assert.equal(h.b.errorCount, 0);
});

test('备用电容开场给 6 点技力，余音护航按技力条给护盾', () => {
  const h = fight(['备用电容', '余音护航'], [{ uid: 1, chessId: 'bare', row: 9, col: 3 }]);
  const unit = h.b.allyUnits[0];
  assert.equal(unit.skill.sp, 6);
  unit.skill.activate('manual', { free: true });
  const shield = unit.findBuff('hex:echoShield');
  assert.ok(shield, '应获得护盾');
  assert.equal(shield.shield, 10000); // spCost 100 × 100
  assert.equal(h.b.errorCount, 0);
});

test('技力传递把 5 点技力交给未开技且充满比例最低的干员', () => {
  const h = fight(['技力传递'], [
    { uid: 1, chessId: 'bare', row: 9, col: 3 },
    { uid: 2, chessId: 'bare', row: 9, col: 6 },
  ]);
  const [caster, receiver] = h.b.allyUnits;
  caster.skill.activate('manual', { free: true });
  assert.equal(receiver.skill.sp, 5);
  assert.equal(h.b.errorCount, 0);
});

test('引火成书在炎激活时给首次开技的炎干员 +5 层', () => {
  const bonds = { yanShip: { active: true } };
  const h = fight(['引火成书'], [{ uid: 1, chessId: 'yan', row: 9, col: 3 }], { bonds });
  const unit = h.b.allyUnits[0];
  unit.skill.activate('manual', { free: true });
  assert.equal(h.b._pp('p1').layerGains.yanShip, 5);
  assert.equal(h.b.errorCount, 0);
});

test('第四艺术每第 4 次普攻追加 120% 攻击的法术伤害', () => {
  const h = fight(['第四艺术'], [{ uid: 1, chessId: 'bare', row: 9, col: 3 }]);
  const unit = h.b.allyUnits[0];
  const enemy = h.b.spawnEnemy('dummy', { pos: [9, 5] });
  const before = enemy.hp;
  for (let i = 0; i < 3; i++) h.b.emit('attack', { attacker: unit, targets: [enemy], isSkill: false });
  close(enemy.hp, before, '前三次不触发');
  h.b.emit('attack', { attacker: unit, targets: [enemy], isSkill: false });
  close(before - enemy.hp, 120);
  assert.equal(h.b.errorCount, 0);
});

test('名刀司命给全体干员 80% 全属性，且不影响其他玩家', () => {
  const h = fight(['名刀司命！'], [{ uid: 1, chessId: 'bare', row: 9, col: 3 }]);
  const [unit, other] = h.b.allyUnits;
  close(unit.s.atk / unit.base.atk, 1.80);
  close(unit.s.maxHp / unit.base.maxHp, 1.80);
  close(unit.s.def / unit.base.def, 1.80);
  close(unit.s.res, unit.base.res * 1.8);
  close(other.s.atk / other.base.atk, 1);
  assert.equal(h.b.errorCount, 0);
});

// ── 深海倾灭：真实击倒与持久化契约 ──────────────────────────────────────

const deepSeaData = getVersionData('act3autochess@V3_1', { log: { warn() {}, error() {} } });
const deepSeaDefs = {
  ...deepSeaData,
  chess: { ...deepSeaData.chess, ...Object.fromEntries([
    ['sea', ['egirShip']], ['food', ['yanShip']], ['food2', []], ['food3', []],
    ['foodCopy', ['yanShip']], ['seaBench', ['egirShip']],
  ].map(([id, bonds]) => [id, chessRec({ id, baseId: id === 'foodCopy' ? 'food' : id, bonds,
    stats: { maxHp: 1000, atk: 100, def: 100, res: 20 }, skill: { spCost: 100 } })])) },
  enemies: { ...deepSeaData.enemies, seaDummy: enemyRec({ key: 'seaDummy', hp: 2000, atk: 300, def: 200, res: 40, speed: 0 }) },
};
const seaPiece = (chessId, uid, row = 9, col = 3) => ({ kind: 'chess', chessId, uid, row, col, dir: 'RIGHT' });
const seaStats = u => ({ hp: u.s.maxHp, atk: u.s.atk, def: u.s.def, res: u.s.res });
const zeroSeaStats = () => ({ hp: 0, atk: 0, def: 0, res: 0 });

function seaFight({ count = 12, enabled = true, kind = 'normal', units = [seaPiece('sea', 1)],
  others = [], layers = 10, effect2 = false, bench = [], setup, kits } = {}) {
  bondSupport.setGameData(deepSeaData);
  try {
    const thresholds = enabled ? [3, 6, 9, 12] : [3, 6];
    const h = makeBattle({ kind, content: 'generic', data: new DataSource(deepSeaDefs),
      flags: { layerGainsEnabled: false }, kits, setup, players: [
        { playerId: 'p1', side: 'L', seat: 0, hexDeepSeaEnabled: enabled,
          hexPicks: enabled ? ['深海倾灭'] : [],
          bonds: { egirShip: { active: count >= 3, count, tier: thresholds.filter(n => count >= n).length, layers, thresholds } },
          ...(effect2 ? { bondEffectOverrides: { bondeffect_egir: 'bondeffect_egir_2' } } : {}),
          units, bench, contentInfo: { handPieces: bench.map(p => ({ id: p.chessId, slot: p.idx,
            bonds: p.bonds, position: 'MELEE' })) } }, ...others,
      ], extraContent: [{ install: installCoreBonds }] });
    h.b.start();
    assert.equal(h.b.errorCount, 0, '战斗初始化不得吞掉异常');
    return h;
  } finally { bondSupport.setGameData(null); }
}

function seaHit(h, killer, victim) {
  h.b.dealDamage({ source: killer, credit: killer, target: victim, amount: victim.s.maxHp * 10,
    type: 'true', canDodge: false });
  assert.equal(h.b.errorCount, 0, '伤害与击倒钩子不得吞掉异常');
}

function seaGains(h, pid = 'p1') {
  h.b.forceEnd();
  assert.equal(h.b.errorCount, 0, '结算钩子不得吞掉异常');
  return h.result().hexDeepSeaGains?.[pid] || [];
}

function assertSeaStats(actual, expected, message) {
  for (const k of ['hp', 'atk', 'def', 'res']) close(actual[k], expected[k], `${message} ${k}`);
}

test('深海9人把同层生命百分比同时用于攻击，8人和无卡保持原阿戈尔', () => {
  for (const layers of [0, 20]) {
    for (const [count, enabled] of [[8, true], [9, true], [12, true], [12, false]]) {
      const h = seaFight({ count, enabled, layers, units: [seaPiece('sea', 1), seaPiece('food', 2, 11, 7)] });
      const u = h.unit(1), plain = h.unit(2), ratio = 1.35 + layers * 0.01;
      close(u.s.maxHp, 1000 * ratio, '原生命增益');
      close(u.s.atk, enabled && count >= 9 ? 100 * ratio : 100, '9人攻击增益');
      assertSeaStats(seaStats(plain), { hp: 1000, atk: 100, def: 100, res: 20 }, '非成员不受益');
      assert.deepEqual(seaGains(h), []);
    }
  }
});

test('深海9人真实击倒友敌干员都追加阿戈尔并保留原盟约、归属和阵营', () => {
  for (const side of ['ally', 'enemy']) {
    const h = seaFight({ count: 9, others: [{ playerId: 'p2', hexDeepSeaEnabled: true, bonds: {},
      units: [seaPiece('food', 2, 11, 7)] }] });
    const killer = h.unit(1), victim = h.unit(2), before = seaStats(killer);
    // 引擎输入只有我方棋子；切换目标阵营以验证奖励不依赖敌我过滤。
    victim.side = side;
    seaHit(h, killer, victim);
    assert.equal(h.hooksOf('death').filter(c => c.unit === victim).length, 1);
    assert.equal(victim.hexDeepSea.egir, true);
    assert.deepEqual(bondSupport.unitBonds(victim), ['yanShip', 'egirShip']);
    assert.equal(victim.side, side);
    assert.equal(victim.ownerId, 'p2');
    assert.deepEqual(victim.def.bonds, ['yanShip']);
    assertSeaStats(seaStats(killer), before, '9人不得吸收属性');
    assert.deepEqual(seaGains(h, 'p2'), [{ uid: 2, egir: true }]);
    assert.deepEqual(h.result().hexDeepSeaGains.p1 || [], []);
  }
});

test('深海8人不转化，12人非阿戈尔击倒不奖励，主动撤退也不奖励', () => {
  for (const [count, killerId] of [[8, 1], [12, 2]]) {
    const h = seaFight({ count, units: [seaPiece('sea', 1), seaPiece('food', 2, 11, 7), seaPiece('food2', 3, 12, 5)] });
    seaHit(h, h.unit(killerId), h.unit(3));
    assert.equal(h.unit(3).hexDeepSea.egir, undefined);
    assert.deepEqual(seaGains(h), []);
  }
  const h = seaFight({ units: [seaPiece('sea', 1), seaPiece('food', 2, 11, 7)] });
  h.b.retreat(h.unit(2));
  assert.equal(h.hooksOf('death')[0].reason, 'retreat');
  assert.equal(h.unit(2).hexDeepSea.egir, undefined);
  assert.deepEqual(seaGains(h), []);
});

test('深海12人击倒普通敌人当场获得最终四属性1%，后续death监听已能读到成长', () => {
  let observed;
  const h = seaFight({ setup(b) { b.on('death', ({ killer }) => { observed = seaStats(killer); }, { priority: -500 }); } });
  const killer = h.unit(1), before = seaStats(killer);
  const victim = h.spawn('seaDummy', { pos: [9, 8] });
  victim.hp = 7;
  seaHit(h, killer, victim);
  const gain = { hp: 20, atk: 3, def: 2, res: 0.4 };
  const expected = { hp: before.hp + 20 * 1.45, atk: before.atk + 3 * 1.45,
    def: before.def + 2, res: before.res + 0.4 };
  assertSeaStats(seaStats(killer), expected, '当场生效，生命取最大值而非剩余7点');
  assertSeaStats(observed, expected, '同次death后续处理可见');
  assert.deepEqual(seaGains(h), [{ uid: 1, stats: gain }]);
});

test('深海12人吸收击倒瞬间技能和临时增益，技能退场清理后快照仍保留', () => {
  let skillEnded = false;
  const h = seaFight({ units: [seaPiece('sea', 1), seaPiece('food', 2, 11, 7)], kits: {
    food: () => ({ skill: { kind: 'duration', duration: 30, trigger: 'NEVER',
      mods: { hpPct: 1, atkPct: 2, defPct: 0.5, resFlat: 15 },
      onEnd() { skillEnded = true; } } }),
  } });
  const killer = h.unit(1), victim = h.unit(2);
  assert.equal(victim.skill.activate('manual', { free: true }), true);
  h.b.addBuff(victim, { key: 'test:temporary', duration: 30,
    mods: { hpFlat: 200, atkFlat: 50, defFlat: 40, resFlat: 5 } });
  const final = seaStats(victim);
  assertSeaStats(final, { hp: 2400, atk: 450, def: 210, res: 40 }, '确实存在临时最终属性');
  victim.hp = 1;
  seaHit(h, killer, victim);
  assert.equal(skillEnded, true);
  assert.equal(victim.skill.active, false);
  assert.equal(!!victim.findBuff('test:temporary'), false);
  assert.deepEqual(h.hooksOf('death').find(c => c.unit === victim).stats,
    { maxHp: 2400, atk: 450, def: 210, res: 40 });
  assertSeaStats(seaGains(h).find(e => e.uid === 1).stats,
    { hp: 24, atk: 4.5, def: 2.1, res: 0.4 }, '永久增量使用清理前快照');
});

test('深海12人开场友军吞噬保留原基础攻击继承，同时结算转化和永久1%', () => {
  const h = seaFight({ units: [seaPiece('sea', 1), seaPiece('food', 2, 9, 4)] });
  const killer = h.unit(1), food = h.unit(2);
  assert.equal(food.hexDeepSea.egir, true);
  assert.equal(h.hooksOf('death').filter(c => c.unit === food && c.killer === killer).length, 1);
  close(killer.s.atk, (100 + 1) * 1.45 + 100, '基础攻击继承和永久增量分别结算');
  const gains = seaGains(h);
  assert.deepEqual(gains.find(e => e.uid === 2), { uid: 2, egir: true });
  assertSeaStats(gains.find(e => e.uid === 1).stats, { hp: 10, atk: 1, def: 1, res: 0.2 }, '友军同样奖励');
});

test('深海致死保护和kill救回均不奖，实际death复活后再次击倒可再次奖励', () => {
  const h = seaFight({ units: [seaPiece('sea', 1), seaPiece('food', 2, 11, 7)] });
  const killer = h.unit(1), victim = h.unit(2);
  h.b.on('fatal', c => { if (c.unit === victim) c.prevented = true; }, { once: true, priority: 1000 });
  seaHit(h, killer, victim);
  assert.equal(victim.alive, true, '致死保护应救活');
  assert.equal(h.hooksOf('death').length, 0);
  assert.deepEqual(killer.hexDeepSea.stats, zeroSeaStats());
  h.b.on('kill', ({ victim: v }) => { if (v === victim) v.hp = v.s.maxHp / 2; }, { once: true, priority: 1000 });
  seaHit(h, killer, victim);
  assert.equal(victim.alive, true, 'kill处理救回');
  assert.equal(h.hooksOf('death').length, 0);
  assert.equal(victim.hexDeepSea.egir, undefined);
  assert.deepEqual(killer.hexDeepSea.stats, zeroSeaStats());
  seaHit(h, killer, victim);
  assert.equal(h.hooksOf('death').length, 1);
  assert.equal(victim.alive, true, '转化后使用阿戈尔首次击倒复活');
  seaHit(h, killer, victim);
  assert.equal(h.hooksOf('death').length, 2);
  assert.equal(victim.alive, false);
  assert.equal(h.b.redeploy(victim, { free: true }), true);
  seaHit(h, killer, victim);
  assert.equal(h.hooksOf('death').length, 3);
  assertSeaStats(seaGains(h).find(e => e.uid === 1).stats,
    { hp: 39, atk: 3.9, def: 3, res: 0.6 }, '三次真实击倒分别奖励，首次未转化前为1000/100');
});

test('深海动态转化按不同baseId从9到12，重复本体不加人数，凑12的当次不追发吸收', () => {
  const h = seaFight({ count: 9, units: [seaPiece('sea', 1), seaPiece('food', 2, 10, 3),
    seaPiece('foodCopy', 3, 10, 6), seaPiece('food2', 4, 11, 3), seaPiece('food3', 5, 11, 6)] });
  const killer = h.unit(1);
  for (const [uid, count] of [[2, 10], [3, 10], [4, 11], [5, 12]]) {
    seaHit(h, killer, h.unit(uid));
    assert.equal(killer.player.bonds.egirShip.count, count, `转化uid=${uid}后的不同本体人数`);
    assert.deepEqual(killer.hexDeepSea.stats, zeroSeaStats(), '达到12的当次仍按击倒前9人档结算');
    close(h.unit(uid).s.atk, 145, '动态成员立即获得9人攻击增益');
  }
  assert.equal(killer.player.bonds.egirShip.tier, 4);
  seaHit(h, killer, h.spawn('seaDummy', { pos: [9, 8] }));
  assert.deepEqual(seaGains(h).find(e => e.uid === 1).stats, { hp: 20, atk: 3, def: 2, res: 0.4 });
});

test('深海egir_2保留攻击增益和永久奖励，倒地换上整备干员而非原干员复活', () => {
  const h = seaFight({ effect2: true, units: [seaPiece('sea', 1), seaPiece('food', 2, 11, 7)],
    bench: [{ kind: 'chess', uid: 3, chessId: 'seaBench', idx: 0, bonds: ['egirShip'] }] });
  close(h.unit(1).s.atk, 145);
  seaHit(h, h.unit(1), h.unit(2));
  assert.equal(h.unit(2).alive, false);
  const replacement = h.b.allyUnits.find(u => u.defId === 'seaBench' && u.alive);
  assert.ok(replacement, 'egir_2召唤整备区成员');
  close(replacement.s.atk / replacement.base.atk, replacement.s.maxHp / replacement.base.maxHp,
    '替补动态成员同样享受9人攻击');
  assertSeaStats(seaGains(h).find(e => e.uid === 1).stats, { hp: 10, atk: 1, def: 1, res: 0.2 }, '换人前记录实际击倒');
});

test('深海无卡对照不转化、不吸收、不继承旧永久状态，合作个人normal仅持有者有效', () => {
  for (const enabled of [false, true]) {
    const h = seaFight({ enabled, units: [seaPiece('sea', 1), seaPiece('food', 2, 11, 7)],
      others: [{ playerId: 'p2', hexDeepSeaEnabled: false, hexPicks: [], bonds: {},
        units: [{ ...seaPiece('food2', 3, 12, 7), hexDeepSea: { egir: true, stats: { hp: 999, atk: 99, def: 99, res: 9 } } }] }] });
    assertSeaStats(seaStats(h.unit(3)), { hp: 1000, atk: 100, def: 100, res: 20 }, '无卡个人屏蔽旧状态');
    seaHit(h, h.unit(1), h.unit(2));
    assert.equal(bondSupport.unitBonds(h.unit(2)).includes('egirShip'), enabled);
    assert.equal(seaGains(h).some(e => e.uid === 1), enabled);
    assert.deepEqual(h.result().hexDeepSeaGains?.p2 || [], []);
  }
});

test('深海永久成长经服务器结算进入piece.meta，跨战斗累计且重复结算不翻倍', () => {
  const { match, ps } = fixture();
  try {
    ps.hexPicks = [{ name: '深海倾灭' }];
    const piece = ps.newPiece('chess', 'sea');
    ps.board.clear();
    ps.board.set('9,3', piece);
    for (let round = 0; round < 2; round++) {
      const h = seaFight({ units: [{ ...seaPiece('sea', piece.uid),
        ...(piece.meta.hexDeepSea ? { hexDeepSea: piece.meta.hexDeepSea } : {}) }] });
      const u = h.unit(piece.uid);
      close(u.s.atk, (100 + round * 3) * 1.45, '下一场携带上场永久增量');
      seaHit(h, u, h.spawn('seaDummy', { pos: [9, 8] }));
      seaGains(h);
      const f = { kind: 'normal', players: ['p1'], battle: h.b,
        spec: { players: h.b.players.map(p => p.input) } };
      match._settleHexDeepSea(f, h.result());
      match._settleHexDeepSea(f, h.result());
      assertSeaStats(piece.meta.hexDeepSea.stats, { hp: (round + 1) * 20, atk: (round + 1) * 3,
        def: (round + 1) * 2, res: (round + 1) * 0.4 }, '服务器累计仅一次');
    }
  } finally { match.dispose(); }
});

for (const kind of ['unite', 'boss', 'hidden']) {
  test(`深海${kind}屏蔽旧永久属性、追加成员和9/12档奖励`, () => {
    const units = [seaPiece('sea', 1), { ...seaPiece('food', 2, 11, 7),
      hexDeepSea: { egir: true, stats: { hp: 1000, atk: 100, def: 100, res: 20 } } }];
    const withCard = seaFight({ kind, units });
    const control = seaFight({ kind, enabled: false, units });
    assertSeaStats(seaStats(withCard.unit(1)), seaStats(control.unit(1)), '原生阿戈尔不叠加深海攻击');
    assertSeaStats(seaStats(withCard.unit(2)), seaStats(control.unit(2)), '旧永久状态不污染联合');
    assert.equal(bondSupport.unitBonds(withCard.unit(2)).includes('egirShip'), false);
    seaHit(withCard, withCard.unit(1), withCard.unit(2));
    assert.equal(bondSupport.unitBonds(withCard.unit(2)).includes('egirShip'), false);
    assert.deepEqual(seaGains(withCard), []);
  });
}

// ── 盟约卡规则锁死 ──────────────────────────────────────────────────────
test('盟约卡只第 1 次发放出现，且绑定盟约被禁用时不出现', () => {
  const yan = card('引火成书'), victoria = card('重锤回响'), general = card('偏科补课');
  assert.equal(hexBondCardBlocked(yan, 1, new Set()), false);
  assert.equal(hexBondCardBlocked(yan, 2, new Set()), true);
  assert.equal(hexBondCardBlocked(yan, 1, new Set(['炎'])), true);
  assert.equal(hexBondCardBlocked(victoria, 1, new Set()), false);
  assert.equal(hexBondCardBlocked(victoria, 3, new Set()), true);
  assert.equal(hexBondCardBlocked(victoria, 1, new Set(['维多利亚'])), true);
  // 通用盟约卡同样受「仅第 1 次发放」锁死，但不随单个盟约禁用消失
  assert.equal(hexBondCardBlocked(general, 1, new Set()), false);
  assert.equal(hexBondCardBlocked(general, 2, new Set()), true);
  assert.equal(hexBondCardBlocked(general, 1, new Set(['炎'])), false);
  // 非盟约卡不受此规则影响
  assert.equal(hexBondCardBlocked(card('再就业回执'), 3, new Set()), false);
});

test('后续发放的赠予池里不再出现盟约卡', () => {
  const { match, ps } = fixture();
  const source = { name: '随机黄金', rarity: '金' };
  match.round = 5; // 第 2 次发放
  const later = eligibleGift(match, ps, source);
  assert.ok(later.length > 0);
  assert.ok(later.every(c => !c.tags.includes('盟约')), later.map(c => c.name).join(','));
  match.round = 1; // 第 1 次发放
  assert.ok(eligibleGift(match, ps, source).some(c => c.tags.includes('盟约')));
  match.dispose();
});
