import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from './helpers/battleHarness.js';
import { install } from '../server/sim/content/bonds/addon/battle.js';
import { computeBonds, pieceBonds, bondList, bondSnapshot, offBondCounts } from '../server/match/bondsMeta.js';
import { HEX_CATALOG } from '../shared/hexCatalog.js';
import { Match } from '../server/match/Match.js';
import { getVersionData } from '../server/data.js';
import { VirtualScheduler } from '../server/match/scheduler.js';

const defs = { chess: {
  solo: chessRec({ id: 'solo', bonds: ['soloShip'], skill: { spCost: 100 } }),
  plain: chessRec({ id: 'plain', skill: { spCost: 100 } }),
  preci: chessRec({ id: 'preci', bonds: ['preciShip'], skill: null }),
}, enemies: { target: enemyRec({ key: 'target', hp: 10000, def: 200, res: 0 }) } };

function setup(picks, bonds, ids = ['solo', 'plain'], options = {}) {
  const h = makeBattle({ content: options.content || 'generic', defs, players: [
    { playerId: 'p1', hexPicks: picks, bonds, units: ids.map((chessId, i) => ({ uid: i + 1, chessId, row: 9, col: 3 + i, ...(i === 0 && options.items ? { items: options.items } : {}) })) },
    { playerId: 'p2', bonds: {}, units: [{ uid: 10, chessId: 'plain', row: 10, col: 3 }] },
  ], extraContent: options.content === 'full' ? [] : [{ install }] });
  h.b.start();
  return h;
}

test('不再孤独仅在独行激活时扩大属性与部署技力', () => {
  for (const selected of [false, true]) {
    const h = setup(selected ? ['不再孤独'] : [], { soloShip: { active: true, tier: 1 } });
    const [member, ally, other] = h.b.allyUnits;
    assert.ok(member.s.atk > member.base.atk);
    assert.equal(ally.s.atk > ally.base.atk, selected);
    assert.equal(ally.s.maxHp > ally.base.maxHp, selected);
    assert.equal(ally.skill.sp > 0, selected);
    assert.equal(other.s.atk, other.base.atk);
    assert.equal(h.b.errorCount, 0);
  }
  const h = setup(['不再孤独'], { soloShip: { active: false } });
  assert.equal(h.b.allyUnits[1].s.atk, h.b.allyUnits[1].base.atk);
});

test('屠宰与手术通过真实伤害管线转换精准干员的物理和法术伤害', () => {
  for (const selected of [false, true]) {
    const h = setup(selected ? ['屠宰与手术'] : [], {}, ['preci', 'plain']);
    const [member, ally] = h.b.allyUnits;
    const e = h.b.spawnEnemy('target', { pos: [9, 8] });
    const a = h.b.dealDamage({ source: member, target: e, amount: 300, type: 'phys', canDodge: false });
    const b = h.b.dealDamage({ source: ally, target: e, amount: 300, type: 'phys', canDodge: false });
    assert.equal(a, selected ? 300 : 100);
    assert.equal(b, 100);
    assert.equal(h.b.errorCount, 0);
  }
});

test('已有双模机械臂时追加一次结算伤害的10%真伤', () => {
  for (const selected of [false, true]) {
    const h = setup(selected ? ['屠宰与手术'] : [], {}, ['preci'], { content: 'full', items: ['chess_item_5_03_e_a'] });
    const [member] = h.b.allyUnits;
    const e = h.b.spawnEnemy('target', { pos: [9, 8] });
    const hits = [];
    h.b.on('damageApplied', (c) => { if (c.target === e) hits.push({ type: c.dmg.type, amount: c.amount }); });
    h.b.addBuff(e, { key: 'test:fragile', mods: { artsTakenMul: 1.5 } });
    h.b.dealDamage({ source: member, target: e, amount: 300, type: 'phys', canDodge: false });
    assert.deepEqual(hits, selected ? [{ type: 'true', amount: 45 }, { type: 'arts', amount: 450 }] : [{ type: 'arts', amount: 450 }]);
    assert.equal(e.hp, 10000 - (selected ? 495 : 450));
    assert.equal(h.b.errorCount, 0);
  }
});

test('两个聚合持有者各自强化友军，敌方减益不叠加', () => {
  const bond = { docShip: { active: true, tier: 3, count: 6, thresholds: [2, 3, 6] } };
  const h = makeBattle({ content: 'generic', defs, players: [
    { playerId: 'p1', hexPicks: ['愈合于铿锵战火'], bonds: bond, units: [{ uid: 1, chessId: 'plain', row: 9, col: 3 }] },
    { playerId: 'p2', hexPicks: ['愈合于铿锵战火'], bonds: bond, units: [{ uid: 2, chessId: 'plain', row: 10, col: 3 }] },
  ], extraContent: [{ install }] });
  h.b.start();
  for (const u of h.b.allyUnits) {
    assert.ok(Math.abs(u.s.atk / u.base.atk - 1.2) < 1e-9);
    assert.equal(u.s.blockCnt, u.base.blockCnt + 2);
  }
  const e = h.b.spawnEnemy('target', { pos: [9, 8] });
  assert.equal(e.s.aspd, 90);
  assert.equal(e.s.dmgTakenMul, 1.1);
  assert.equal(h.b.errorCount, 0);
});

test('愈合于铿锵战火六人效果仅按持有者的聚合计数触发', () => {
  for (const count of [5, 6]) {
    const h = setup(['愈合于铿锵战火'], { docShip: { active: true, tier: count >= 6 ? 3 : 2, count, thresholds: [2, 3, 6] } }, ['plain']);
    const [ally, other] = h.b.allyUnits;
    const e = h.b.spawnEnemy('target', { pos: [9, 8] });
    assert.equal(ally.s.blockCnt, ally.base.blockCnt + (count === 6 ? 2 : 0));
    assert.ok(Math.abs(ally.s.atk / ally.base.atk - (count === 6 ? 1.2 : 1)) < 1e-9);
    assert.equal(other.s.atk, other.base.atk);
    assert.equal(e.s.aspd, count === 6 ? 90 : 100);
    assert.ok(Math.abs(e.s.dmgTakenMul - (count === 6 ? 1.1 : 1)) < 1e-9);
    assert.equal(h.b.errorCount, 0);
  }
});

function bondFixture() {
  const match = new Match({ mode: 'coop', difficulty: 'NORMAL', seed: 7, scheduler: new VirtualScheduler(),
    seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true }],
    data: getVersionData('act3autochess@V3_1', { log: { warn() {}, error() {} } }),
    send() {}, broadcast() {}, onEnd() {} });
  match.disabledBonds = [];
  match.staticInactiveBonds = [];
  match.bondChoice = null;
  return { match, ps: match.players.get('p1') };
}

const selectedCard = name => HEX_CATALOG.find(card => card.name === name);
const hexDescriptions = name => selectedCard(name).bondChanges.effects.map(effect => ({ name, ...effect }));

test('持有深海才扩展阿戈尔3/6/9/12档，快照复制有效阈值', () => {
  const { match, ps } = bondFixture();
  try {
    const native = [...ps.gd.bond('egirShip').thresholds];
    for (const selected of [false, true]) {
      ps.hexPicks = selected ? [{ name: '深海倾灭' }] : [];
      for (const count of [0, 2, 3, 5, 6, 8, 9, 11, 12, 13]) {
        ps.bondCountBonus.egirShip = count;
        const state = computeBonds(ps.gd, ps).egirShip;
        const thresholds = selected ? [3, 6, 9, 12] : [3, 6];
        assert.deepEqual(state.thresholds, thresholds);
        assert.equal(state.tier, thresholds.filter(n => count >= n).length);
        assert.equal(state.active, count >= 3);
        assert.deepEqual(state.hexEffects, selected ? hexDescriptions('深海倾灭') : undefined);
        const snapshot = bondSnapshot({ egirShip: state }).egirShip;
        assert.deepEqual(snapshot.thresholds, thresholds);
        snapshot.thresholds.push(99);
        assert.deepEqual(state.thresholds, thresholds);
      }
    }
    assert.deepEqual(ps.gd.bond('egirShip').thresholds, native);
  } finally { match.dispose(); }
});

test('愈合仅保底第一档，实际六人才到聚合第三档，禁用优先于强制激活', () => {
  const { match, ps } = bondFixture();
  try {
    ps.hexPicks = [{ name: '愈合于铿锵战火' }];
    for (const [count, tier] of [[0, 1], [1, 1], [2, 1], [3, 2], [5, 2], [6, 3]]) {
      ps.bondCountBonus.docShip = count;
      const state = computeBonds(ps.gd, ps).docShip;
      assert.equal(state.count, count);
      assert.equal(state.tier, tier);
      assert.deepEqual(state.thresholds, [2, 3, 6]);
      assert.deepEqual(state.hexEffects, hexDescriptions('愈合于铿锵战火'));
    }
    ps.hexPicks = [];
    assert.equal(computeBonds(ps.gd, ps).docShip.tier, 2);
    ps.hexEffectState = { forcedBonds: { egirShip: true, miraShip: true } };
    ps.bondCountBonus.egirShip = 0;
    ps.bondCountBonus.miraShip = 0;
    assert.equal(computeBonds(ps.gd, ps).egirShip.tier, 1);
    assert.equal(computeBonds(ps.gd, ps).miraShip.tier, 1);
    ps.hexPicks = [{ name: '愈合于铿锵战火' }, { name: '深海倾灭' }];
    ps.bondCountBonus.egirShip = 12;
    for (const byName of [false, true]) {
      match.disabledBonds = byName ? ['聚合', '阿戈尔', '奇迹'] : ['docShip', 'egirShip', 'miraShip'];
      const states = computeBonds(ps.gd, ps);
      for (const id of ['docShip', 'egirShip', 'miraShip']) {
        assert.equal(states[id].active, false);
        assert.equal(states[id].tier, 0);
      }
    }
    match.disabledBonds = [];
    match.staticInactiveBonds = ['egirShip'];
    assert.equal(computeBonds(ps.gd, ps).egirShip.tier, 0);
    ps.gd.modeInactiveBonds.add('docShip');
    const states = computeBonds(ps.gd, ps);
    assert.equal(states.docShip, undefined);
    const off = offBondCounts(ps.gd, ps);
    for (const full of [false, true]) {
      const row = bondList(ps.gd, states, { full, off }).find(b => b.bondId === 'docShip');
      assert.equal(row.off, true);
      assert.equal(row.active, false);
      assert.deepEqual(row.thresholds, [2, 3, 6]);
      assert.deepEqual(row.hexEffects, hexDescriptions('愈合于铿锵战火'));
    }
  } finally { match.dispose(); }
});

test('永久转化保留原盟约并去重，opts和ps标志剔除转化及深海扩展档位', () => {
  const { match, ps } = bondFixture();
  try {
    const id = ps.gd.visibleChess.find(id => !ps.gd.chess(id).bonds.includes('egirShip'));
    const piece = { uid: 500, id, kind: 'chess', items: [], meta: { hexDeepSea: { egir: true } } };
    const native = [...ps.gd.chess(id).bonds];
    assert.deepEqual(pieceBonds(ps.gd, piece), [...native, 'egirShip']);
    assert.deepEqual(pieceBonds(ps.gd, { ...piece, meta: {}, hexDeepSea: { egir: true } }), [...native, 'egirShip']);
    assert.deepEqual(pieceBonds(ps.gd, { ...piece, hexDeepSea: { egir: true }, meta: { hexDeepSea: undefined } }), native);
    assert.deepEqual(pieceBonds(ps.gd, piece, null, { hexDeepSeaEnabled: false }), native);
    const egirId = ps.gd.visibleChess.find(id => ps.gd.chess(id).bonds.includes('egirShip'));
    assert.equal(pieceBonds(ps.gd, { ...piece, id: egirId }).filter(b => b === 'egirShip').length, 1);
    ps.board.set('9,5', piece);
    ps.hexPicks = [{ name: '深海倾灭' }];
    ps.bondCountBonus.egirShip = 8;
    assert.equal(computeBonds(ps.gd, ps).egirShip.tier, 3);
    for (const state of [computeBonds(ps.gd, ps, { hexDeepSeaEnabled: false }),
      computeBonds(ps.gd, { ...ps, hexDeepSeaEnabled: false })]) {
      assert.equal(state.egirShip.count, 8);
      assert.equal(state.egirShip.tier, 2);
      assert.deepEqual(state.egirShip.thresholds, [3, 6]);
      assert.equal(state.egirShip.hexEffects, undefined);
    }
    assert.deepEqual(piece.meta.hexDeepSea, { egir: true });
    assert.deepEqual(ps.gd.chess(id).bonds, native);
  } finally { match.dispose(); }
});

test('公私视图都展示深海和愈合的有效阈值及逐档说明，零人深海仍可查看', () => {
  const { match, ps } = bondFixture();
  try {
    ps.hexPicks = [{ name: '深海倾灭' }, { name: '愈合于铿锵战火' }];
    ps.recompute();
    const lists = [ps.privateView().bonds, match.publicView().players.find(p => p.playerId === ps.playerId).bonds];
    for (const list of lists) {
      for (const [id, name, thresholds] of [['egirShip', '深海倾灭', [3, 6, 9, 12]], ['docShip', '愈合于铿锵战火', [2, 3, 6]]]) {
        const row = list.find(b => b.bondId === id);
        assert.ok(row, id);
        assert.deepEqual(row.thresholds, thresholds);
        assert.deepEqual(row.hexEffects, hexDescriptions(name));
      }
    }
    ps.hexPicks = [];
    assert.ok(!bondList(ps.gd, computeBonds(ps.gd, ps)).some(b => b.bondId === 'egirShip'));
  } finally { match.dispose(); }
});

test('命令显示阈值取目标效果并合并海克斯档位，不覆盖原始计算结果', () => {
  const { match, ps } = bondFixture();
  try {
    const gd = Object.create(ps.gd);
    gd.raw = { ...ps.gd.raw, effects: { ...ps.gd.raw.effects, test_hex_target: { displayThresholds: [4, 7] } } };
    ps.hexPicks = [{ name: '深海倾灭' }];
    ps.bondCountBonus.egirShip = 9;
    const states = computeBonds(gd, ps);
    for (const full of [false, true]) {
      const row = bondList(gd, states, { full, effectOverrides: { [gd.bond('egirShip').effectId]: 'test_hex_target' } }).find(b => b.bondId === 'egirShip');
      assert.equal(row.effectId, 'test_hex_target');
      assert.deepEqual(row.thresholds, [4, 7, 9, 12]);
      assert.deepEqual(row.hexEffects, hexDescriptions('深海倾灭'));
    }
    assert.deepEqual(states.egirShip.thresholds, [3, 6, 9, 12]);
  } finally { match.dispose(); }
});

test('既有强制激活和更改盟约效果卡按目录通用聚合描述', () => {
  const { match, ps } = bondFixture();
  try {
    const names = ['奇迹！', '真正的奇迹！', '华尔街之狼', '不再孤独', '屠宰与手术', '真知灼见'];
    ps.hexPicks = names.map(name => ({ name }));
    const states = computeBonds(ps.gd, ps);
    for (const name of names) {
      const card = selectedCard(name);
      const id = card.bondChanges?.bondId || ps.gd.bondIds.find(id => ps.gd.bond(id).name === card.bond);
      const expected = card.bondChanges ? hexDescriptions(name) : [{ name, effect: card.effect }];
      for (const full of [false, true]) {
        const row = bondList(ps.gd, states, { full }).find(b => b.bondId === id);
        assert.ok(row, name);
        assert.deepEqual(row.hexEffects.filter(effect => effect.name === name), expected);
      }
    }
  } finally { match.dispose(); }
});

test('battleInput非普通战斗副本与聚合匹配，剔除转化人数和9/12档且保留原棋子', () => {
  const { match, ps } = bondFixture();
  try {
    ps.hexPicks = [{ name: '深海倾灭' }, { name: '愈合于铿锵战火' }];
    const id = ps.gd.visibleChess.find(id => !ps.gd.chess(id).bonds.includes('egirShip'));
    const piece = ps.newPiece('chess', id);
    piece.meta.hexDeepSea = { egir: true, stats: { hp: 10, atk: 1, def: 1, res: 0.1 } };
    ps.board.set('9,5', piece);
    ps._legalityStale = false;
    ps.bondCountBonus.egirShip = 8;
    ps.recompute();
    assert.equal(ps.battleInput().bonds.egirShip.tier, 3);
    for (const kind of ['unite', 'boss', 'hidden']) {
      const input = ps.battleInput({ kind });
      assert.equal(input.bonds.egirShip.count, 8);
      assert.equal(input.bonds.egirShip.tier, 2);
      assert.deepEqual(input.bonds.egirShip.thresholds, [3, 6]);
      assert.deepEqual(input.bonds.docShip.thresholds, [2, 3, 6]);
      assert.equal(input.units[0].hexDeepSea, undefined);
    }
    assert.equal(ps.bonds.egirShip.count, 9);
    assert.equal(piece.meta.hexDeepSea.egir, true);
  } finally { match.dispose(); }
});
