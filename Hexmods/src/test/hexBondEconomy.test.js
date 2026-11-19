import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { getVersionData } from '../server/data.js';
import { applyHexEffect, advanceHexEffects } from '../server/match/hexEffects.js';
import { HEX_CATALOG } from '../shared/hexCatalog.js';
import { compactResult, resultDigest, buildBattleSpec } from '../server/sim/spec.js';
import { isBattleResult } from '../shared/protocol.js';
import { validateClientResult, emptyPerPlayer } from '../server/match/fields.js';
import { uniteBattleOpts } from '../server/match/unite.js';
import { computeBonds } from '../server/match/bondsMeta.js';
import { PlayerState } from '../server/match/PlayerState.js';
import { SharedPool } from '../server/match/pool.js';
import { pieceBonds } from '../server/match/bondsMeta.js';

const names = new Set(['奇迹！', '真正的奇迹！', '真知灼见', '华尔街之狼']);
const card = name => HEX_CATALOG.find(c => c.name === name);
function fixture(selection = null, settings = {}, defaultEffects = false) {
  const m = new Match({ mode: 'coop', difficulty: 'NORMAL', seed: 7, scheduler: new VirtualScheduler(),
    seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true }],
    data: getVersionData('act3autochess@V3_1', { log: { warn() {}, error() {} } }),
    globalSettings: { hexEnabled: true, hexRounds: [1], hexCustomEnabled: true, ...settings },
    hexSelections: { p1: { 1: selection } },
    hexEffectAvailable: (_m, _p, c) => names.has(c.name),
    ...(!defaultEffects ? { onHexSelected: (match, ps, _pick, c) => applyHexEffect(match, ps, c) } : {}),
    send() {}, broadcast() {}, onEnd() {} });
  m.disabledBonds = [];
  m.staticInactiveBonds = [];
  m.bondChoice = null;
  m.round = 1;
  return { m, ps: m.players.get('p1') };
}
function select(m, ps, name, custom = false) {
  const c = { ...card(name), custom };
  assert.equal(m.applyHex(ps, { round: m.round, options: new Map([[ps.playerId, [c]]]) }, 0), true);
}

test('真实自选窗口与自然候选接入奇迹，休整开始只结算一次', () => {
  for (const name of ['奇迹！', '真正的奇迹！']) {
    const { m, ps } = fixture(name);
    assert.equal(m.openHexWindow(), true);
    const w = m.offerWin[0];
    assert.equal(w.options.get('p1')[0].name, name);
    assert.equal(m.requestOffer(ps, 'hex', 0, { pluginId: 'hex', seq: w.seq }).ok, true);
    assert.equal(ps.bonds.miraShip.active, true);
    ps.recompute();
    assert.equal(ps.bonds.miraShip.active, true);
    m.enterPrep();
    assert.equal(ps.layers.miraShip, 5);
    m.dispatch(ps, 'onPrepStart', { round: 1 });
    assert.equal(ps.layers.miraShip, 5);
    m.round = 2;
    m.enterPrep();
    assert.equal(ps.layers.miraShip, name === '奇迹！' ? 10 : 15);
    m.dispose();
  }
  for (const name of names) {
    const { m, ps } = fixture();
    m.opts.hexEffectAvailable = (_m, _p, c) => c.name === name;
    assert.equal(m.openHexWindow(), true);
    const w = m.offerWin[0];
    const options = w.options.get('p1');
    const index = options.findIndex(c => c.name === name && !c.custom);
    assert.ok(index >= 0, name);
    assert.equal(m.requestOffer(ps, 'hex', index, { pluginId: 'hex', seq: w.seq }).ok, true);
    assert.equal(ps.hexPicks[0].name, name);
    assert.equal(ps.hexPicks[0].custom, false);
    m.dispose();
  }
});

test('四项均可通过真实自选窗口获得', () => {
  for (const name of names) {
    const { m, ps } = fixture(name);
    assert.equal(m.openHexWindow(), true);
    const w = m.offerWin[0];
    assert.equal(w.options.get('p1')[0].name, name);
    assert.equal(m.requestOffer(ps, 'hex', 0, { pluginId: 'hex', seq: w.seq }).ok, true);
    assert.equal(ps.hexPicks[0].custom, true);
    m.dispose();
  }
});

test('禁用优先且不伪造盟约激活', () => {
  for (const [name, id] of [['奇迹！', 'miraShip'], ['真正的奇迹！', 'miraShip'], ['华尔街之狼', 'investShip']]) {
    const { m, ps } = fixture();
    m.disabledBonds = [id];
    select(m, ps, name, true);
    ps.recompute();
    assert.notEqual(ps.bonds[id]?.active, true);
    m.dispatch(ps, 'onPrepStart', { round: 1 });
    assert.equal(ps.layers[id] || 0, 0);
    m.dispose();
  }
});

test('华尔街当回合和后续回合各扣一次，资金不为负，投资人影响真实获得特质倍率', () => {
  const { m, ps } = fixture();
  ps.funds = 1;
  select(m, ps, '华尔街之狼');
  assert.equal(ps.funds, 0);
  assert.equal(ps.bonds.investShip.active, true);
  assert.equal(m.dispatcher.investRepeat(ps), 2);
  ps.addLayers('investShip', 100);
  assert.equal(m.dispatcher.investRepeat(ps), 3);
  assert.deepEqual(advanceHexEffects(m, ps, 'roundStart'), []);
  m.round = 2;
  ps.funds = 10;
  const out = advanceHexEffects(m, ps, 'roundStart');
  assert.ok(out[0].deducted >= 1 && out[0].deducted <= 3);
  assert.equal(ps.funds, 10 - out[0].deducted);
  assert.deepEqual(advanceHexEffects(m, ps, 'roundStart'), []);
  m.dispose();
});

test('真知灼见顺序获得干员，攻击不补历史层且保留远见资金', () => {
  const { m, ps } = fixture();
  ps.addLayers('visiShip', 25);
  const before = ps.funds;
  const gained = [];
  const acquire = ps.acquireChess.bind(ps);
  ps.acquireChess = (id, opts) => { gained.push(ps.gd.chess(id).name); return acquire(id, opts); };
  select(m, ps, '真知灼见');
  assert.deepEqual(gained, ['渡桥', '空弦']);
  assert.equal(ps.bonds.visiShip.active, true);
  assert.equal(ps.funds, before + 4);
  assert.equal(ps.counters['hex:insight:stacks'] || 0, 0);
  ps.addLayers('visiShip', 15);
  assert.equal(ps.counters['hex:insight:stacks'], 2);
  assert.equal(ps.funds, before + 8);
  ps.board.set('9,5', { uid: 100, kind: 'chess', id: ps.gd.visibleChess[0], items: [] });
  ps._legalityStale = false;
  const input = ps.battleInput();
  assert.equal(input.hexInsightStacks, 2);
  const field = m._ccField({ fieldId: 'n:p1', kind: 'normal', players: ['p1'], opts: { players: [input] } });
  const sim = m._specBattle(field.spec);
  const baseSpec = structuredClone(field.spec);
  delete baseSpec.players[0].hexInsightStacks;
  const base = m._specBattle(baseSpec);
  assert.ok(Math.abs(sim.allyUnits[0].s.atk / base.allyUnits[0].s.atk - 1.04) < 1e-7);
  m.dispose();
});

test('真知保留远见休整结束后的资金延期到账', () => {
  const { m, ps } = fixture();
  select(m, ps, '真知灼见');
  m.phase = 'PREP';
  m.dispatch(ps, 'onPrepEnd', { round: 1 });
  const funds = ps.funds;
  ps.addLayers('visiShip', 10);
  assert.equal(ps.funds, funds);
  assert.equal(ps.pendingFunds, 2);
  assert.equal(ps.counters['hex:insight:stacks'], 1);
  m.dispatch(ps, 'onLayers', { bondId: 'visiShip' });
  assert.equal(ps.pendingFunds, 2);
  m.round = 2;
  ps.startRound(2);
  assert.equal(ps.pendingFunds, 0);
  assert.equal(ps.funds, ps.gd.income(2) + 2);
  assert.equal(ps.counters['hex:insight:stacks'], 1);
  m.dispose();
});

test('战斗跨层即时生效，真实结算只持久化一次并进入联防和下场战斗', () => {
  const { m, ps } = fixture();
  ps.lp = 100;
  ps.addLayers('visiShip', 25);
  select(m, ps, '真知灼见');
  ps.board.set('9,5', { uid: 100, kind: 'chess', id: ps.gd.visibleChess[0], items: [] });
  ps._legalityStale = false;
  const input = ps.battleInput();
  const field = m._ccField({ fieldId: 'n:p1', kind: 'normal', players: ['p1'], opts: { players: [input] } });
  const sim = m._specBattle(field.spec);
  const op = sim.allyUnits[0];
  const initial = op.s.atk;
  const fundsBeforeBattle = ps.funds;
  assert.equal(sim.addLayers('p1', 'visiShip', 4), 4);
  assert.equal(op.s.atk, initial);
  assert.equal(sim.addLayers('p1', 'visiShip', 1), 1);
  assert.ok(Math.abs(op.s.atk / initial - 1.02) < 1e-7);
  assert.equal(sim.addLayers('p1', 'visiShip', 21), 21);
  assert.ok(Math.abs(op.s.atk / initial - 1.06) < 1e-7);
  assert.equal(ps.counters['hex:insight:stacks'] || 0, 0);
  assert.equal(ps.funds, fundsBeforeBattle);
  const result = sim._buildResult().perPlayer.p1;
  assert.equal(result.layerGains.visiShip, 26);
  ps.pendingLayerGains = result.layerGains;
  assert.equal(ps.battleInput({ reached: true }).hexInsightStacks, 3);
  m.lastResults.set('p1', result);
  m.settle(null, null);
  assert.equal(ps.layers.visiShip, 51);
  assert.equal(ps.funds, fundsBeforeBattle + 6);
  assert.equal(ps.counters['hex:insight:stacks'], 3);
  assert.equal(ps.counters['hex:insight:paid'], 5);
  m.dispatch(ps, 'onLayers', { bondId: 'visiShip', from: 25, to: 51, reason: 'battle' });
  m.dispatch(ps, 'onRoundStart', { round: 2 });
  assert.equal(ps.counters['hex:insight:stacks'], 3);
  assert.equal(ps.funds, fundsBeforeBattle + 6);
  const nextInput = ps.battleInput();
  assert.equal(nextInput.hexInsightStacks, 3);
  const nextField = m._ccField({ fieldId: 'n:p1:next', kind: 'normal', players: ['p1'], opts: { players: [nextInput] } });
  const next = m._specBattle(nextField.spec);
  assert.ok(Math.abs(next.allyUnits[0].s.atk / initial - 1.06) < 1e-7);
  m.dispose();
});

test('真知解除上限后跨越一万层即时生效并正确结算', () => {
  const { m, ps } = fixture(null, { bondLayerUncap: true });
  ps.lp = 100;
  ps.addLayers('visiShip', 9999);
  select(m, ps, '真知灼见');
  ps.board.set('9,5', { uid: 100, kind: 'chess', id: ps.gd.visibleChess[0], items: [] });
  ps._legalityStale = false;
  const field = m._ccField({ fieldId: 'n:p1:uncap', kind: 'normal', players: ['p1'], opts: { players: [ps.battleInput()] } });
  const sim = m._specBattle(field.spec);
  const op = sim.allyUnits[0], base = op.s.atk;
  assert.equal(sim.addLayers('p1', 'visiShip', 12), 12);
  assert.ok(Math.abs(op.s.atk / base - 1.04) < 1e-7);
  const result = sim._buildResult().perPlayer.p1;
  assert.equal(result.layerGains.visiShip, 12);
  m.lastResults.set('p1', result);
  m.settle(null, null);
  assert.equal(ps.layers.visiShip, 10011);
  assert.equal(ps.counters['hex:insight:stacks'], 2);
  assert.equal(ps.battleInput().hexInsightStacks, 2);
  m.dispatch(ps, 'onRoundStart', { round: 2 });
  assert.equal(ps.counters['hex:insight:stacks'], 2);
  m.dispose();
});

test('真知按层数上限截断后的实际增量触发', () => {
  const { m, ps } = fixture(null, { bondLayerUncap: false });
  ps.addLayers('visiShip', 989);
  select(m, ps, '真知灼见');
  ps.board.set('9,5', { uid: 100, kind: 'chess', id: ps.gd.visibleChess[0], items: [] });
  ps._legalityStale = false;
  const field = m._ccField({ fieldId: 'n:p1:cap', kind: 'normal', players: ['p1'], opts: { players: [ps.battleInput()] } });
  const sim = m._specBattle(field.spec);
  const op = sim.allyUnits[0], base = op.s.atk;
  assert.equal(sim.addLayers('p1', 'visiShip', 100), 10);
  assert.ok(Math.abs(op.s.atk / base - 1.02) < 1e-7);
  assert.equal(sim.addLayers('p1', 'visiShip', 10), 0);
  assert.ok(Math.abs(op.s.atk / base - 1.02) < 1e-7);
  m.dispose();
});

test('嵌套层数钩子按实际落账计数且不影响未选玩家', () => {
  const { m, ps } = fixture();
  ps.addLayers('visiShip', 25);
  select(m, ps, '真知灼见');
  ps.board.set('9,5', { uid: 100, kind: 'chess', id: ps.gd.visibleChess[0], items: [] });
  ps._legalityStale = false;
  const input = ps.battleInput();
  const other = structuredClone(input);
  other.playerId = 'p2';
  other.units[0].uid = 101;
  other.units[0].row = 10;
  delete other.hexInsightStacks;
  delete other.hexPicks;
  const field = m._ccField({ fieldId: 'n:p1:nested', kind: 'normal', players: ['p1'], opts: { players: [input, other] } });
  const sim = m._specBattle(field.spec);
  const [op, otherOp] = sim.allyUnits;
  const first = op.s.atk, second = otherOp.s.atk;
  let nested = false;
  sim.on('layerGain', ev => {
    if (!nested && ev.playerId === 'p1' && ev.bondId === 'visiShip') {
      nested = true;
      sim.addLayers('p1', 'visiShip', 5);
    }
  });
  assert.equal(sim.addLayers('p1', 'visiShip', 10), 10);
  assert.equal(sim.getPlayer('p1').bonds.visiShip.layers, 40);
  assert.ok(Math.abs(op.s.atk / first - 1.04) < 1e-7);
  assert.equal(otherOp.s.atk, second);
  assert.equal(sim.addLayers('p2', 'visiShip', 10), 10);
  assert.equal(otherOp.s.atk, second);
  m.dispose();
});

function deepSeaEconomyFixture() {
  const f = fixture(null, {}, true);
  f.m.opts.hexEffectAvailable = (_m, _ps, c) => ['深海倾灭', '越级调度'].includes(c.name);
  f.m.pool = new SharedPool(f.ps.gd);
  f.m.phase = 'PREP';
  return f;
}
const deepSeaItemIds = ps => ['阿戈尔重刃', '变形同构体'].map(name =>
  Object.keys(ps.gd.raw.items).find(id => ps.gd.item(id).name === name && !ps.gd.item(id).isGolden));
/** 原生阿戈尔干员里符合当前调度等级的一张（用户 2026-11-19：奖励不超过调度中心等级）。 */
const nativeEgir = (ps, tier = ps.shop.level) => ps.gd.visibleChess.find(id => {
  const rec = ps.gd.chess(id);
  return rec?.tier === tier && rec.bonds?.includes('egirShip');
});

test('深海默认选卡初始化保留战斗重算，已6级立即逐件发装备且重复回调不双发', () => {
  const { m, ps } = deepSeaEconomyFixture();
  ps.shop.level = 6;
  const ids = deepSeaItemIds(ps);
  assert.deepEqual(ids, ['chess_item_3_06_e_a', 'chess_item_6_03_e_a']);
  let recomputes = 0;
  const recompute = ps.recompute.bind(ps);
  ps.recompute = () => { recomputes++; return recompute(); };
  select(m, ps, '深海倾灭');
  assert.ok(recomputes > 0);
  assert.deepEqual(ids.map(id => m.itemPool.held(id)), [1, 1]);
  m.opts.onHexSelected(m, ps, ps.hexPicks[0], card('深海倾灭'));
  applyHexEffect(m, ps, card('深海倾灭'));
  assert.deepEqual(ids.map(id => m.itemPool.held(id)), [1, 1]);
  assert.equal(ps.round.gainedChess, 0);
  assert.equal(m.errorCount, 0);
  m.dispose();
});

for (const path of ['普通升级', '越级调度']) {
  test(`深海${path}达到6级当场发两件装备，后续休整不重复发`, () => {
    const { m, ps } = deepSeaEconomyFixture();
    ps.shop.level = 4;
    ps.shop.upgradePrice = 0;
    ps.funds = 999;
    select(m, ps, '深海倾灭');
    const ids = deepSeaItemIds(ps);
    const upgrade = () => path === '普通升级' ? assert.equal(ps.levelUp().ok, true) : applyHexEffect(m, ps, card('越级调度'));
    upgrade();
    assert.equal(ps.shop.level, 5);
    assert.deepEqual(ids.map(id => m.itemPool.held(id)), [0, 0]);
    upgrade();
    assert.equal(ps.shop.level, 6);
    assert.deepEqual(ids.map(id => m.itemPool.held(id)), [1, 1]);
    assert.equal(ps.round.gainedChess, 0);
    advanceHexEffects(m, ps, 'prepStart');
    m.round++;
    advanceHexEffects(m, ps, 'prepStart');
    advanceHexEffects(m, ps, 'prepStart');
    assert.deepEqual(ids.map(id => m.itemPool.held(id)), [1, 1]);
    assert.equal(m.errorCount, 0);
    m.dispose();
  });
}

test('深海选择回合不补干员，后续每个prepStart只给一次且满手走临时奖励队列', () => {
  const { m, ps } = deepSeaEconomyFixture();
  m.enterPrep();
  select(m, ps, '深海倾灭');
  assert.deepEqual(advanceHexEffects(m, ps, 'prepStart'), []);
  assert.equal(ps.round.gainedChess, 0);
  const native = nativeEgir(ps, 1);
  for (const [id, entry] of m.pool.entries) if (id !== native) entry.left = 0;
  const ordinary = ps.gd.visibleChess.find(id => !ps.gd.chess(id).bonds?.includes('egirShip'));
  ps.hand = ps.hand.map(() => ps.newPiece('chess', ordinary));
  assert.equal(ps.shop.level, 1);
  m.round = 2;
  m.enterPrep();
  const held = m.pool.left(native);
  assert.equal(ps.round.gainedChess, 1);
  assert.ok(ps.temp.some(p => p?.id === native && !ps.gd.isGolden(p.id)));
  m.enterPrep();
  advanceHexEffects(m, ps, 'prepStart');
  assert.equal(ps.round.gainedChess, 1);
  assert.equal(m.pool.left(native), held);
  m.round = 3;
  m.enterPrep();
  assert.equal(ps.round.gainedChess, 2);
  assert.equal(m.pool.left(native), held - 1);
  m.dispose();
});

test('深海抽取只认gd原生盟约，排除转化、morph、DIY、精锐与隐藏普通不可获取记录', () => {
  const { m, ps } = deepSeaEconomyFixture();
  select(m, ps, '深海倾灭');
  const ordinary = ps.gd.visibleChess.find(id => !ps.gd.chess(id).bonds?.includes('egirShip'));
  const converted = ps.newPiece('chess', ordinary);
  converted.meta.hexDeepSea = { egir: true, stats: {} };
  ps.hand[0] = converted;
  const morphed = ps.newPiece('chess', ordinary);
  morphed.items = deepSeaItemIds(ps).map(id => ({ id }));
  ps.hand[1] = morphed;
  assert.ok(pieceBonds(ps.gd, converted).includes('egirShip'));
  assert.ok(pieceBonds(ps.gd, morphed).includes('egirShip'));
  const native = nativeEgir(ps);
  const chess = ps.gd.chess.bind(ps.gd);
  const records = new Map([
    ['fake_diy', { ...chess(native), isDiy: true }],
    ['fake_elite', { ...chess(native), isGolden: true }],
    ['fake_hidden', { ...chess(native), isHidden: true }],
    ['fake_invisible', { ...chess(native), visible: false }],
    ['fake_excluded', { ...chess(native), shopExcluded: true }],
    ['fake_not_in_shop', { ...chess(native), hideInShop: true }],
  ]);
  ps.gd.chess = id => records.get(id) || chess(id);
  for (const entry of m.pool.entries.values()) entry.left = 0;
  m.pool.entries.get(ordinary).left = 5;
  for (const id of records.keys()) m.pool.entries.set(id, { left: 5, cap: 5, tier: 1 });
  let diyScanned = false;
  ps.diyStockEntries = () => { diyScanned = true; return [['fake_diy', { left: 5, tier: 1 }]]; };
  m.round = 2;
  const out = advanceHexEffects(m, ps, 'prepStart');
  assert.equal(out[0].status, 'partial');
  assert.equal(out[0].reason, 'no-eligible-chess');
  assert.equal(ps.round.gainedChess, 0);
  assert.equal(diyScanned, false);
  m.pool.entries.get(native).left = 1;
  m.round = 3;
  assert.deepEqual(advanceHexEffects(m, ps, 'prepStart')[0].granted, [native]);
  m.dispose();
});

test('深海遵守动态禁用和库存，缺货不透支且重复prep不增加当回合发放', () => {
  const { m, ps } = deepSeaEconomyFixture();
  select(m, ps, '深海倾灭');
  m.disabledBonds = ['egirShip'];
  m.round = 2;
  assert.equal(advanceHexEffects(m, ps, 'prepStart')[0].status, 'partial');
  assert.equal(ps.round.gainedChess, 0);
  m.disabledBonds = [];
  for (const entry of m.pool.entries.values()) entry.left = 0;
  m.round = 3;
  assert.equal(advanceHexEffects(m, ps, 'prepStart')[0].status, 'partial');
  assert.equal(ps.round.gainedChess, 0);
  const native = nativeEgir(ps);
  m.pool.entries.get(native).left = 1;
  assert.deepEqual(advanceHexEffects(m, ps, 'prepStart'), []);
  m.round = 4;
  assert.deepEqual(advanceHexEffects(m, ps, 'prepStart')[0].granted, [native]);
  assert.equal(m.pool.left(native), 0);
  m.round = 5;
  assert.equal(advanceHexEffects(m, ps, 'prepStart')[0].status, 'partial');
  assert.equal(ps.round.gainedChess, 1);
  m.dispose();
});

test('深海休整奖励的阿戈尔干员不超过当前调度中心等级', () => {
  const { m, ps } = deepSeaEconomyFixture();
  select(m, ps, '深海倾灭');
  // 只留一张 6 阶阿戈尔，1 级调度中心不应发放
  for (const entry of m.pool.entries.values()) entry.left = 0;
  const top = nativeEgir(ps, 6);
  m.pool.entries.get(top).left = 1;
  assert.equal(ps.shop.level, 1);
  m.round = 2;
  assert.equal(advanceHexEffects(m, ps, 'prepStart')[0].status, 'partial');
  assert.equal(ps.round.gainedChess, 0);
  // 升级到 6 后才允许取出
  ps.shop.level = 6;
  m.round = 3;
  const out = advanceHexEffects(m, ps, 'prepStart');
  assert.ok(out.some(r => r.granted?.includes(top)));
  assert.equal(ps.round.gainedChess, 1);
  m.dispose();
});

test('深海装备部分缺货逐件保留待领，重复选卡与prep重试不双发也不吞奖励', () => {
  for (const blockedIndex of [0, 1]) {
    const { m, ps } = deepSeaEconomyFixture();
    ps.shop.level = 6;
    const ids = deepSeaItemIds(ps);
    const blocked = ids[blockedIndex];
    const cap = m.itemPool.cap(blocked);
    assert.ok(cap > 0 && Number.isFinite(cap));
    for (let i = 0; i < cap; i++) ps.temp.push(ps.newPiece('item', blocked));
    select(m, ps, '深海倾灭');
    assert.equal(ps.hexPicks.length, 1);
    assert.equal(m.itemPool.held(ids[1 - blockedIndex]), 1);
    assert.deepEqual(ps.hexEffectState.deepSeaEconomy.items, {
      '阿戈尔重刃': blockedIndex !== 0, '变形同构体': blockedIndex !== 1,
    });
    m.opts.onHexSelected(m, ps, ps.hexPicks[0], card('深海倾灭'));
    assert.equal(advanceHexEffects(m, ps, 'prepStart')[0].status, 'partial');
    assert.equal(m.itemPool.held(ids[1 - blockedIndex]), 1);
    ps.temp = ps.temp.map(p => p?.id === blocked ? null : p);
    const retry = advanceHexEffects(m, ps, 'prepStart');
    assert.deepEqual(retry[0].granted, [blocked]);
    assert.equal(retry[0].status, 'applied');
    assert.deepEqual(ids.map(id => m.itemPool.held(id)), [1, 1]);
    m.opts.onHexSelected(m, ps, ps.hexPicks[0], card('深海倾灭'));
    assert.deepEqual(advanceHexEffects(m, ps, 'prepStart'), []);
    assert.deepEqual(ids.map(id => m.itemPool.held(id)), [1, 1]);
    assert.equal(ps.round.gainedChess, 0);
    assert.equal(m.errorCount, 0);
    m.dispose();
  }
});

test('深海装备获取失败可重试，获取时重入选卡回调不重复发放', () => {
  const { m, ps } = deepSeaEconomyFixture();
  ps.shop.level = 6;
  const ids = deepSeaItemIds(ps);
  const acquire = ps.acquireItem.bind(ps);
  let failSecond = true;
  ps.acquireItem = (id, opts) => {
    m.opts.onHexSelected(m, ps, ps.hexPicks[0], card('深海倾灭'));
    if (id === ids[1] && failSecond) return null;
    return acquire(id, opts);
  };
  select(m, ps, '深海倾灭');
  assert.deepEqual(ids.map(id => m.itemPool.held(id)), [1, 0]);
  failSecond = false;
  assert.deepEqual(applyHexEffect(m, ps, card('深海倾灭')).granted, [ids[1]]);
  assert.deepEqual(ids.map(id => m.itemPool.held(id)), [1, 1]);
  assert.equal(ps.hexEffectState.deepSeaEconomy.grantingItems, undefined);
  m.dispose();
});

test('深海真实自选窗口在prepStart后选到6级装备即时到账，首回合不给干员', () => {
  const { m, ps } = deepSeaEconomyFixture();
  m.opts.hexSelections = { p1: { 1: '深海倾灭' } };
  ps.shop.level = 6;
  m.enterPrep();
  assert.equal(m.openHexWindow(), true);
  const w = m.offerWin[0];
  assert.equal(w.options.get('p1')[0].name, '深海倾灭');
  assert.equal(m.requestOffer(ps, 'hex', 0, { pluginId: 'hex', seq: w.seq }).ok, true);
  assert.equal(ps.round.gainedChess, 0);
  assert.deepEqual(deepSeaItemIds(ps).map(id => m.itemPool.held(id)), [1, 1]);
  assert.deepEqual(advanceHexEffects(m, ps, 'prepStart'), []);
  m.round++;
  m.enterPrep();
  assert.equal(ps.round.gainedChess, 1);
  m.dispose();
});

const deepSeaStats = () => ({ hp: 123.125, atk: 4.75, def: 2.25, res: 0.125 });
function deepSeaFixture() {
  const f = fixture();
  f.ps.hexPicks = [{ name: '深海倾灭' }];
  const piece = f.ps.newPiece('chess', f.ps.gd.visibleChess.find(id => !f.ps.gd.chess(id).bonds?.includes('egirShip')));
  piece.meta.hexDeepSea = { egir: true, stats: deepSeaStats() };
  f.ps.board.set('9,5', piece);
  f.ps._legalityStale = false;
  f.ps.recompute();
  return { ...f, piece };
}

test('深海永久状态按UID传输、视图复制，合作个人normal启用且非持有者禁用', () => {
  const { m, ps, piece } = deepSeaFixture();
  const input = ps.battleInput();
  assert.equal(input.hexDeepSeaEnabled, true);
  assert.deepEqual(input.units[0].hexDeepSea, piece.meta.hexDeepSea);
  const view = ps.pieceView(piece);
  assert.deepEqual(view.hexDeepSea, piece.meta.hexDeepSea);
  view.hexDeepSea.stats.atk = 999;
  assert.equal(piece.meta.hexDeepSea.stats.atk, 4.75);
  const spec = buildBattleSpec({ players: [input] });
  assert.deepEqual(spec.players[0].units[0].hexDeepSea.stats, deepSeaStats());
  const sim = m._specBattle(spec);
  assert.deepEqual(sim.allyUnits[0].hexDeepSea.stats, deepSeaStats());
  const baseline = structuredClone(spec);
  delete baseline.players[0].units[0].hexDeepSea;
  const plain = m._specBattle(baseline);
  for (const [k, stat] of [['hp', 'maxHp'], ['atk', 'atk'], ['def', 'def'], ['res', 'res']]) {
    assert.ok(sim.allyUnits[0].s[stat] > plain.allyUnits[0].s[stat], k);
  }
  ps.hexPicks = [];
  const other = ps.battleInput();
  assert.notEqual(other.hexDeepSeaEnabled, true);
  assert.equal(other.units[0].hexDeepSea, undefined);
  m.dispose();
});

test('深海合作双人个人normal仅持有者启用，默认选卡检查登记为已实装', () => {
  const { m, ps, piece } = deepSeaFixture();
  const other = new PlayerState(m, { playerId: 'p2', seat: 1, name: '二', connected: true });
  m.players.set('p2', other);
  const theirs = other.newPiece('chess', piece.id);
  theirs.meta.hexDeepSea = structuredClone(piece.meta.hexDeepSea);
  other.board.set('9,5', theirs);
  other._legalityStale = false;
  other.recompute();
  assert.equal(ps.battleInput().hexDeepSeaEnabled, true);
  assert.notEqual(other.battleInput().hexDeepSeaEnabled, true);
  assert.equal(other.battleInput().units[0].hexDeepSea, undefined);
  const original = new Match({ mode: 'coop', difficulty: 'NORMAL', seed: 7, scheduler: new VirtualScheduler(),
    seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true }], data: m.data,
    globalSettings: { hexEnabled: true }, send() {}, broadcast() {}, onEnd() {} });
  original.disabledBonds = []; original.staticInactiveBonds = []; original.bondChoice = null;
  assert.equal(original.opts.hexEffectAvailable(original, original.players.get('p1'), { name: '深海倾灭' }), true);
  original.dispose();
  m.dispose();
});

test('深海联合联防首领输入隔离永久成长、转化人数与9/12档，不改持有棋子', () => {
  const { m, ps, piece } = deepSeaFixture();
  const before = structuredClone(piece.meta.hexDeepSea);
  for (const kind of ['unite', 'boss', 'hidden']) {
    const input = ps.battleInput({ kind });
    assert.equal(input.hexDeepSeaEnabled, false);
    assert.equal(input.units[0].hexDeepSea, undefined);
    assert.ok(!input.bonds.egirShip?.thresholds?.some(n => n === 9 || n === 12));
    const stripped = Object.create(ps);
    stripped.hexPicks = [];
    stripped.board = new Map([[ '9,5', { ...piece, meta: {} } ]]);
    stripped.bonds = computeBonds(stripped.gd, stripped);
    const normalWithoutCard = stripped.battleInput();
    assert.equal(input.bonds.egirShip?.count, normalWithoutCard.bonds.egirShip?.count);
    const spec = buildBattleSpec({ kind, players: [{ ...input, hexDeepSeaEnabled: true, units: [{ ...input.units[0], hexDeepSea: before }] }] });
    assert.equal(spec.players[0].hexDeepSeaEnabled, false);
    assert.equal(spec.players[0].units[0].hexDeepSea, undefined);
  }
  const united = uniteBattleOpts(m, { helpers: [ps], leaked: [] }, 10).players[0];
  assert.equal(united.hexDeepSeaEnabled, false);
  assert.equal(united.units[0].hexDeepSea, undefined);
  assert.deepEqual(piece.meta.hexDeepSea, before);
  m.dispose();
});

test('深海精锐合并累加全部材料小数成长并OR转化，原地升级保留，新棋子不继承', () => {
  const { m, ps } = fixture();
  const id = ps.gd.visibleChess.find(id => ps.gd.goldenIdOf(id) && ps.gd.mergeCount(id) === 3);
  const copies = Array.from({ length: 3 }, () => ps.newPiece('chess', id));
  copies[0].meta.hexDeepSea = { stats: { hp: 1.25, atk: 2.5, def: 0.25, res: 0.125 } };
  copies[1].meta.hexDeepSea = { egir: true, stats: { hp: 3.5, atk: 0.125, def: 1.5, res: 0.25 } };
  copies[2].meta.hexDeepSea = { stats: { hp: 0.25, atk: 1, def: 0.5, res: 0.125 } };
  ps.hand[0] = copies[0]; ps.hand[1] = copies[1];
  const elite = ps._mergeChess(id, copies[2]);
  assert.deepEqual(elite.meta.hexDeepSea, { egir: true, stats: { hp: 5, atk: 3.625, def: 2.25, res: 0.5 } });
  const promoted = ps.newPiece('chess', id);
  promoted.meta.hexDeepSea = { egir: true, stats: deepSeaStats() };
  ps.stow(promoted);
  const uid = promoted.uid;
  assert.equal(ps.promote(promoted), true);
  assert.equal(promoted.uid, uid);
  assert.deepEqual(promoted.meta.hexDeepSea.stats, deepSeaStats());
  m.phase = 'PREP';
  assert.equal(ps.sell(promoted.uid).ok, true);
  const repurchased = ps.acquireChess(id);
  assert.equal(repurchased.meta.hexDeepSea, undefined);
  elite.meta.hexDeepSea = { egir: true, stats: deepSeaStats() };
  const replaced = ps.transformChess(elite, id);
  assert.equal(replaced.meta.hexDeepSea, undefined);
  m.dispose();
});

test('深海normal只接收服务端结果，UID白名单、单条去重与整场防重复', () => {
  const { m, ps, piece } = deepSeaFixture();
  const hand = ps.newPiece('chess', piece.id);
  ps.hand[0] = hand;
  const input = ps.battleInput();
  const field = m._ccField({ fieldId: 'n:p1', kind: 'normal', players: ['p1'], opts: { players: [input], flags: { layerGainsEnabled: false } } });
  assert.equal(m._authorityFor(field), null);
  const result = { reason: 'cleared', time: 1, perPlayer: { p1: emptyPerPlayer() }, hexDeepSeaGains: { p1: [
    { uid: piece.uid, stats: { hp: 0.125, atk: 1.5, def: -1, res: Infinity } },
    { uid: piece.uid, stats: { atk: 100 } },
    { uid: hand.uid, egir: true, stats: { res: 0.25 } },
    { uid: 999999, egir: true, stats: { atk: 1000 } },
  ] } };
  field.battle = { result: () => result };
  field.resultSource = 'client';
  m._settleHexDeepSea(field, result);
  assert.equal(piece.meta.hexDeepSea.stats.atk, 4.75);
  field.resultSource = 'server';
  m._settleHexDeepSea(field, structuredClone(result));
  assert.equal(piece.meta.hexDeepSea.stats.atk, 4.75);
  m._settleHexDeepSea(field, result);
  assert.deepEqual(piece.meta.hexDeepSea.stats, { hp: 123.25, atk: 6.25, def: 2.25, res: 0.125 });
  assert.equal(hand.meta.hexDeepSea.egir, true);
  assert.equal(hand.meta.hexDeepSea.stats.res, 0.25);
  m._settleHexDeepSea(field, result);
  m._settleHexDeepSea(field, structuredClone(result));
  assert.equal(piece.meta.hexDeepSea.stats.atk, 6.25);
  assert.equal(validateClientResult(field.spec, { ...result, hexDeepSeaGains: undefined }, { gd: m.gd }).ok, false);
  const forged = { ...field.spec, players: [{ ...input, hexDeepSeaEnabled: false, hexPicks: [] }] };
  assert.equal(validateClientResult(forged, result, { gd: m.gd }).ok, false);
  m.dispose();
});

test('深海结果压缩和协议白名单保留小数，拒绝非法属性、重复UID并参与摘要', () => {
  const base = { reason: 'cleared', time: 1, perPlayer: { p1: emptyPerPlayer() } };
  const raw = { ...base, hexDeepSeaGains: { p1: [{ uid: 1, egir: true, stats: { hp: 1.125, atk: 2.5, def: 0, res: 0.25 }, injected: true }] } };
  const compact = compactResult(raw);
  assert.equal(isBattleResult(compact), true);
  assert.equal(compact.hexDeepSeaGains.p1[0].stats.hp, 1.125);
  assert.equal(compact.hexDeepSeaGains.p1[0].injected, undefined);
  assert.notEqual(resultDigest(compact).json, resultDigest(compactResult(base)).json);
  for (const invalid of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1']) {
    const bad = structuredClone(compact);
    bad.hexDeepSeaGains.p1[0].stats.atk = invalid;
    assert.equal(isBattleResult(bad), false);
  }
  const bad = structuredClone(compact);
  bad.hexDeepSeaGains.p1[0].stats.speed = 10;
  assert.equal(isBattleResult(bad), false);
  const duplicate = structuredClone(compact);
  duplicate.hexDeepSeaGains.p1.push(duplicate.hexDeepSeaGains.p1[0]);
  assert.equal(isBattleResult(duplicate), false);
});

test('深海真实模拟击倒产出本场增量，经普通战斗结束回写且不重复', () => {
  const { m, ps, piece } = deepSeaFixture();
  const input = ps.battleInput();
  input.bonds.egirShip = { active: true, count: 12, tier: 4, layers: 0, thresholds: [3, 6, 9, 12] };
  const field = m._ccField({ fieldId: 'n:p1', kind: 'normal', players: ['p1'], opts: { players: [input], flags: { layerGainsEnabled: false } } });
  const sim = m._specBattle(field.spec);
  field.battle = sim;
  field.resultSource = 'server';
  sim.start();
  const enemy = sim.spawnEnemy(Object.keys(m.gd.raw.enemies)[0], { pos: [9, 8] });
  assert.ok(enemy);
  sim.dealDamage({ source: sim.allyUnits[0], target: enemy, amount: 1e12, type: 'true', canDodge: false });
  sim._finish('forced');
  const result = sim.result();
  const gain = result.hexDeepSeaGains.p1.find(g => g.uid === piece.uid);
  assert.ok(gain.stats.hp > 0);
  const before = structuredClone(piece.meta.hexDeepSea.stats);
  m.fields = [field];
  m.phase = 'COMBAT';
  m._finishCombat(() => result);
  for (const k of ['hp', 'atk', 'def', 'res']) assert.equal(piece.meta.hexDeepSea.stats[k], before[k] + gain.stats[k]);
  const stored = structuredClone(piece.meta.hexDeepSea);
  m._finishCombat(() => result);
  assert.deepEqual(piece.meta.hexDeepSea, stored);
  m.dispose();
});

test('深海手牌替补接口带UID、成长、转化与完整原盟约', () => {
  const { m, ps, piece } = deepSeaFixture();
  const hand = ps.newPiece('chess', piece.id);
  hand.meta.hexDeepSea = { egir: true, stats: deepSeaStats() };
  ps.hand[3] = hand;
  const input = ps.battleInput();
  const ev = { input, kind: 'normal', spawns: [] };
  m.dispatch(ps, 'onBattleStart', ev);
  const bench = ev.input.bench.find(u => u.uid === hand.uid);
  const switched = ev.input.contentInfo.handPieces.find(u => u.slot === 3);
  assert.equal(switched.uid, hand.uid);
  assert.deepEqual(switched.hexDeepSea, hand.meta.hexDeepSea);
  assert.deepEqual(switched.hexDeepSea, bench.hexDeepSea);
  assert.ok(switched.bonds.includes('egirShip'));
  for (const id of ps.gd.chess(piece.id).bonds) assert.ok(switched.bonds.includes(id));
  m.dispose();
});
