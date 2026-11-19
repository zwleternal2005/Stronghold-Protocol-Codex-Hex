import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getData, getVersionData } from '../server/data.js';
import { PHASE } from '../shared/constants.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { HEX_CATALOG } from '../shared/hexCatalog.js';
import { applyHexEffect, advanceHexEffects, lowSupplyItems } from '../server/match/hexEffects.js';

function fixture({ regulation = false, available = () => true, defaults = false } = {}) {
  const log = { warn() {}, error() {} };
  const match = new Match({ mode: 'coop', difficulty: 'FUNNY', seed: 7, scheduler: new VirtualScheduler(),
    seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true }],
    data: regulation ? getVersionData('act3autochess@V3_1', { log }) : getData({ log }),
    ...(defaults ? {} : { hexEffectAvailable: available }), send() {}, broadcast() {}, onEnd() {} });
  match.round = 1;
  return { match, ps: match.players.get('p1') };
}
const card = name => HEX_CATALOG.find(c => c.name === name);

test('资金、刷新和玩家生命使用真实状态', () => {
  const { match, ps } = fixture();
  ps.lp = ps.gd.startLp(ps.bandId);
  const initial = ps.lp;
  assert.equal(applyHexEffect(match, ps, card('可露希尔的资金夹')).status, 'applied');
  assert.equal(ps.funds, 8);
  assert.equal(ps.stats.fundsGained, 8);
  assert.equal(ps.shop.freeRefreshes, 1);
  applyHexEffect(match, ps, card('苟住'));
  applyHexEffect(match, ps, card('真得苟住'));
  applyHexEffect(match, ps, card('血多不疼'));
  assert.equal(ps.lp, initial + 37);
  assert.equal(applyHexEffect(match, ps, card('众志合一')).status, 'unimplemented');
  assert.equal(applyHexEffect(match, ps, card('安慰奖')).status, 'partial');
  match.dispose();
});

test('低级补给从规程有效数据获取全部七种装备并预检库存', () => {
  const { match, ps } = fixture({ regulation: true, defaults: true });
  try {
    const supply = card('维多利亚的低级补给');
    const ids = ps.gd.shopItemsByTier[1];
    assert.equal(ids.length, 7);
    const blocked = ids.at(-1);
    const cap = match.itemPool.cap(blocked);
    for (let i = 0; i < cap; i++) assert.ok(ps.acquireItem(blocked, { deferMerge: true }));
    const before = ps.hand.length + ps.temp.length;
    assert.equal(match.opts.hexEffectAvailable(match, ps, supply), false);
    assert.equal(applyHexEffect(match, ps, supply).reason, 'equipment-unavailable');
    assert.equal(ps.hand.length + ps.temp.length, before);
    const held = [...ps.hand, ...ps.temp].find(p => p?.id === blocked);
    ps._detach(ps._itemLocations(blocked).find(l => l.piece === held));
    assert.equal(match.opts.hexEffectAvailable(match, ps, supply), true);
    const result = applyHexEffect(match, ps, supply);
    assert.equal(result.status, 'applied');
    assert.deepEqual(result.granted, ids);
  } finally { match.dispose(); }
});

test('低级补给动态过滤金色、隐藏、非装备及非一阶数据', () => {
  const ps = { gd: { raw: { items: {
    ordinary: { itemType: 'EQUIP', tier: 1 }, extra: { itemType: 'EQUIP', tier: 1 },
    gold: { itemType: 'EQUIP', tier: 1, isGolden: true }, hidden: { itemType: 'EQUIP', tier: 1, isHidden: true },
    shopHidden: { itemType: 'EQUIP', tier: 1, hideInShop: true }, excluded: { itemType: 'EQUIP', tier: 1, shopExcluded: true },
    other: { itemType: 'OTHER', tier: 1 }, higher: { itemType: 'EQUIP', tier: 2 },
  } } } };
  assert.deepEqual(lowSupplyItems(ps), ['extra', 'ordinary']);
});

test('随机白银和黄金经真实窗口选择且发放战斗类赠品', () => {
  for (const [name, gift, funds] of [['随机白银', '众志合一', 3], ['随机黄金', '众志合一+', 6]]) {
    const { match, ps } = fixture({ regulation: true, defaults: true });
    try {
      const original = match.opts.hexEffectAvailable;
      match.opts.hexEffectAvailable = (m, p, c) => (c.name === name || c.name === gift) && original(m, p, c);
      match.bondChoice = null;
      match.opts.hexSelections = { p1: { 1: name } };
      match.globalSettings = { ...match.globalSettings, hexCustomEnabled: true };
      match.openHexWindow();
      assert.equal(match.requestOffer(ps, 'hex', 0).ok, true);
      assert.deepEqual(ps.hexPicks.map(p => p.name), [name, gift]);
      assert.equal(ps.hexPicks[1].gifted, true);
      assert.equal(ps.funds, funds);
    } finally { match.dispose(); }
  }
});

test('无随机赠品时不发资金、不添加赠品', () => {
  const { match, ps } = fixture({ available: () => false });
  try {
    for (const name of ['随机白银', '随机黄金']) {
      assert.equal(applyHexEffect(match, ps, card(name)).reason, 'no-eligible-gift');
      assert.equal(ps.funds, 0);
      assert.equal(ps.hexPicks?.length || 0, 0);
    }
  } finally { match.dispose(); }
});

test('一阶增援从真实共享库存获取并可能合并', () => {
  const { match, ps } = fixture();
  const before = match.pool.totalLeft();
  const result = applyHexEffect(match, ps, card('一阶增援'));
  assert.equal(result.status, 'applied');
  assert.equal(result.granted.length, 4);
  assert.ok(result.granted.every(id => ps.gd.chess(id).tier === 1));
  assert.equal(match.pool.totalLeft(), before - 4);
  match.dispose();
});

test('随机赠送排除自身和已拥有，遵守首轮及兜底规则', () => {
  const { match, ps } = fixture();
  const source = card('随机白银');
  ps.hexPicks = HEX_CATALOG.map((c, i) => ({ ...c, id: `hex_${i}` })).filter(c => c.rarity === '银' && c.name !== '苟住');
  const result = applyHexEffect(match, ps, source);
  assert.equal(result.gift, '苟住');
  assert.equal(ps.hexPicks.filter(p => p.name === '苟住').length, 1);
  assert.equal(ps.funds, 3);
  assert.equal(ps.lp, 6);
  const again = applyHexEffect(match, ps, source);
  assert.equal(again.gift, '产能不足喵');
  assert.equal(again.status, 'applied');
  assert.equal(applyHexEffect(match, ps, source).gift, '产能不足喵');
  match.dispose();
});

test('随机赠送只在首次海克斯提供盟约，且受禁用和效果可用限制', () => {
  const { match, ps } = fixture({ regulation: true, available: (_m, _p, c) => c.name === '炎小队增援' });
  match.disabledBonds = [];
  match.staticInactiveBonds = [];
  const first = applyHexEffect(match, ps, card('随机白银'));
  assert.equal(first.gift, '炎小队增援');
  assert.equal(first.result.status, 'applied');
  assert.deepEqual(first.result.granted, card('炎小队增援').operators);
  ps.hexPicks = [];
  match.round = match.globalSettings.hexRounds[1];
  assert.equal(applyHexEffect(match, ps, card('随机白银')).reason, 'no-eligible-gift');
  match.round = match.globalSettings.hexRounds[0];
  const bond = ps.gd.bondIds.find(id => ps.gd.bond(id).name === '炎');
  assert.ok(bond);
  match.disabledBonds = [bond];
  assert.equal(applyHexEffect(match, ps, card('随机白银')).reason, 'no-eligible-gift');
  match.dispose();
});

test('规程版本各盟约小队使用真实获取接口', () => {
  for (const c of HEX_CATALOG.filter(c => c.operators)) {
    const { match, ps } = fixture({ regulation: true });
    match.disabledBonds = [];
    match.staticInactiveBonds = [];
    const result = applyHexEffect(match, ps, c);
    assert.equal(result.status, 'applied', c.name);
    assert.deepEqual(result.granted, c.operators);
    assert.equal(ps.round.gainedChess, 3);
    match.dispose();
  }
});

test('固定增援库存耗尽时不透支且报告缺失', () => {
  const { match, ps } = fixture({ regulation: true });
  match.disabledBonds = [];
  match.staticInactiveBonds = [];
  const id = ps.gd.visibleChess.find(id => ps.gd.chess(id).name === '拜松');
  const pool = ps.poolOf(id);
  pool.take(id, pool.left(id));
  const result = applyHexEffect(match, ps, card('炎小队增援'));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.missing, ['拜松']);
  assert.equal(pool.left(id), 0);
  assert.equal(ps.round.gainedChess, 2);
  match.dispose();
});

test('免费刷新由真实商店动作消费', () => {
  const { match, ps } = fixture();
  match.phase = PHASE.PREP;
  applyHexEffect(match, ps, card('可露希尔的资金夹'));
  assert.equal(ps.refresh().ok, true);
  assert.equal(ps.shop.freeRefreshes, 0);
  assert.equal(ps.funds, 8);
  assert.equal(ps.refresh().ok, true);
  assert.equal(ps.funds, 7);
  match.dispose();
});

test('人生切片随真实回合获得对应阶级并在获得六阶后停止', () => {
  const { match, ps } = fixture({ regulation: true });
  match.round = 1;
  let result = applyHexEffect(match, ps, card('人生切片'));
  assert.equal(ps.gd.chess(result.granted[0]).tier, 1);
  for (let round = 2; round <= 11; round++) {
    match.round = round;
    ps.startRound(round);
    result = advanceHexEffects(match, ps, 'roundStart').find(x => x.name === '人生切片');
    assert.equal(result.status, 'applied', `回合 ${round}`);
    assert.equal(ps.gd.chess(result.granted[0]).tier, Math.ceil(round / 2));
    assert.deepEqual(advanceHexEffects(match, ps, 'roundStart'), []);
  }
  assert.equal(ps.hexEffectState.slice.done, true);
  match.round = 12;
  ps.startRound(12);
  assert.deepEqual(advanceHexEffects(match, ps, 'roundStart'), []);
  match.dispose();
});

test('购买商品阻止小小运营奖励，真实回合重置后恢复', () => {
  const { match, ps } = fixture({ regulation: true });
  match.phase = PHASE.PREP;
  ps.startRound(1);
  applyHexEffect(match, ps, card('小小运营下'));
  const slot = ps.shop.slots.findIndex(s => s?.kind === 'chess');
  assert.ok(slot >= 0);
  assert.equal(ps.buy(slot).ok, true);
  assert.equal(ps.round.buys, 1);
  advanceHexEffects(match, ps, 'prepEnd');
  match.round = 2;
  ps.startRound(2);
  const funds = ps.funds;
  assert.deepEqual(advanceHexEffects(match, ps, 'roundStart'), []);
  assert.equal(ps.funds, funds);
  advanceHexEffects(match, ps, 'prepEnd');
  match.round = 3;
  ps.startRound(3);
  const before = ps.funds;
  advanceHexEffects(match, ps, 'roundStart');
  assert.equal(ps.funds, before + 1);
  assert.equal(ps.shop.freeRefreshes, 1);
  match.dispose();
});

test('文火猛炖在三个后续回合后仅分配一次', () => {
  const { match, ps } = fixture();
  applyHexEffect(match, ps, card('文火猛炖'));
  for (let r = 2; r <= 4; r++) {
    match.round = r;
    const out = advanceHexEffects(match, ps, 'roundStart');
    assert.equal(out[0].distribution === null, r < 4);
    assert.deepEqual(advanceHexEffects(match, ps, 'roundStart'), []);
  }
  assert.equal(ps.funds, 6);
  assert.equal(ps.hexEffectState.stew.distributed, true);
  match.round = 5;
  assert.equal(advanceHexEffects(match, ps, 'roundStart')[0].distribution, null);
  assert.equal(ps.funds, 8);
  match.dispose();
});

test('文火猛炖对真实激活盟约通过 addLayers 分配', () => {
  const { match, ps } = fixture();
  const id = ps.gd.bondIds.find(id => !match.disabledBonds.includes(id) && !match.staticInactiveBonds.includes(id) && ps.gd.bond(id).thresholdTemplate !== 'count_threshold_downward');
  ps.bondCountBonus[id] = 10;
  ps.recompute();
  assert.equal(ps.bonds[id].active, true);
  applyHexEffect(match, ps, card('文火猛炖'));
  match.round = 4;
  const result = advanceHexEffects(match, ps, 'roundStart')[0];
  assert.equal(result.status, 'applied');
  assert.equal(Object.values(result.distribution).reduce((a, b) => a + b, 0), 60);
  assert.equal(ps.layers[id], result.distribution[id]);
  advanceHexEffects(match, ps, 'roundStart');
  assert.equal(ps.layers[id], result.distribution[id]);
  match.dispose();
});

test('固定增援缺少数据时报告缺失', () => {
  const { match, ps } = fixture();
  const result = applyHexEffect(match, ps, card('炎小队增援'));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.missing, ['拜松', '矩', '乌有']);
  match.dispose();
});

test('真实 Match 在首轮选择后按休整结束和回合开始推进经济效果', () => {
  const { match, ps } = fixture({ regulation: true, defaults: true });
  match.disabledBonds = [];
  match.staticInactiveBonds = [];
  match.bondChoice = null;
  match.startRound(1);
  const select = name => {
    const c = card(name);
    assert.equal(match.opts.hexEffectAvailable(match, ps, c), true, name);
    const w = { round: match.round, options: new Map([[ps.playerId, [c]]]) };
    match.applyHex(ps, w, 0);
  };
  select('人生切片');
  select('小小运营下');
  select('文火猛炖');
  assert.equal(ps.hexEffectState.slice.lastRound, 1);
  assert.equal(ps.hexEffectState.stew.lastStart, 1);
  const gained = ps.round.gainedChess;
  assert.equal(gained, 1);
  match.phase = PHASE.PREP;
  match.startCombat = () => { match.phase = PHASE.COMBAT; };
  match.endPrep();
  assert.equal(ps.hexEffectState.thrifty.pending, true);
  match.startRound(2);
  assert.equal(ps.round.gainedChess, 1);
  assert.equal(ps.hexEffectState.slice.lastRound, 2);
  assert.equal(ps.hexEffectState.stew.lastStart, 2);
  assert.equal(ps.shop.freeRefreshes, 1);
  assert.equal(ps.funds, ps.gd.income(2) + 3);
  match.phase = PHASE.PREP;
  const slot = ps.shop.slots.findIndex(s => s?.kind === 'chess');
  assert.ok(slot >= 0);
  assert.equal(ps.buy(slot).ok, true);
  match.endPrep();
  assert.equal(ps.hexEffectState.thrifty.pending, false);
  match.startRound(3);
  assert.equal(ps.shop.freeRefreshes, 1);
  assert.equal(ps.funds, ps.gd.income(3) + 2);
  const bond = ps.gd.bondIds.find(id => ps.gd.bond(id).thresholdTemplate !== 'count_threshold_downward');
  ps.bondCountBonus[bond] = 10;
  ps.recompute();
  match.phase = PHASE.PREP;
  match.endPrep();
  const beforeLayers = ps.layers[bond] || 0;
  match.startRound(4);
  assert.equal(ps.hexEffectState.stew.distributed, true);
  assert.equal(ps.layers[bond] - beforeLayers, 60);
  match.dispose();
});

test('默认候选只开放当前数据与库存完整的固定小队', () => {
  const { match, ps } = fixture({ regulation: true, defaults: true });
  const check = match.opts.hexEffectAvailable;
  match.disabledBonds = [];
  match.staticInactiveBonds = [];
  const squad = card('炎小队增援');
  assert.equal(check(match, ps, squad), true);
  match.applyHex(ps, { round: 1, options: new Map([[ps.playerId, [squad]]]) }, 0);
  assert.equal(ps.round.gainedChess, 3);
  const id = ps.gd.visibleChess.find(id => ps.gd.chess(id).name === '拜松');
  const pool = ps.poolOf(id);
  pool.take(id, pool.left(id));
  assert.equal(check(match, ps, squad), false);
  assert.equal(check(match, ps, card('维多利亚的低级补给')), true);
  assert.equal(check(match, ps, card('随机白银')), true);
  match.dispose();
});

test('真实窗口自选已接入盟约效果，禁用及库存动态变化优先', () => {
  for (const [name, bond] of [['奇迹！', 'miraShip'], ['真正的奇迹！', 'miraShip'],
    ['华尔街之狼', 'investShip'], ['真知灼见', 'visiShip'], ['不再孤独', 'soloShip'],
    ['屠宰与手术', 'preciShip'], ['愈合于铿锵战火', 'docShip']]) {
    const { match, ps } = fixture({ regulation: true, defaults: true });
    try {
      match.disabledBonds = []; match.staticInactiveBonds = []; match.bondChoice = null;
      match.gd.modeInactiveBonds.delete(bond);
      ps.shop.level = 6;
      match.opts.hexSelections = { p1: { 1: name } };
      match.globalSettings = { ...match.globalSettings, hexCustomEnabled: true };
      assert.equal(match.opts.hexEffectAvailable(match, ps, card(name)), true, name);
      match.openHexWindow();
      const w = match.offerWin[0];
      assert.equal(w.options.get('p1')[0].name, name);
      match.disabledBonds = [bond];
      assert.equal(match.offerViews()[0].seats[0].slots[0].available, false, name);
      assert.ok(match.requestOffer(ps, 'hex', 0).error, name);
      match.disabledBonds = [];
      assert.equal(match.requestOffer(ps, 'hex', 0).ok, true, name);
      assert.equal(ps.hexPicks[0].name, name);
      if (name === '奇迹！' || name === '真正的奇迹！' || name === '华尔街之狼' || name === '愈合于铿锵战火') {
        assert.equal(ps.bonds[bond].active, true, name);
      }
      if (name === '真知灼见') assert.equal(ps.counters['hex:insight:active'], 1);
    } finally { match.dispose(); }
  }
});

test('真实窗口精准库存减少后不可选择，自选不自动替换', () => {
  const { match, ps } = fixture({ regulation: true, defaults: true });
  try {
    match.disabledBonds = []; match.staticInactiveBonds = []; match.bondChoice = null;
    ps.shop.level = 6;
    match.opts.hexSelections = { p1: { 1: '屠宰与手术' } };
    match.globalSettings = { ...match.globalSettings, hexCustomEnabled: true };
    match.openHexWindow();
    const w = match.offerWin[0];
    for (const [id] of match.pool._eligible({ maxTier: 6, filter: id => ps.gd.chess(id)?.bonds?.includes('preciShip') })) {
      match.pool.take(id, match.pool.left(id));
    }
    assert.equal(match.offerViews()[0].seats[0].slots[0].available, false);
    assert.ok(match.requestOffer(ps, 'hex', 0).error);
    match.sched.advance(15000);
    assert.equal(w.picks.get('p1').idx, null);
    assert.deepEqual(ps.hexPicks || [], []);
  } finally { match.dispose(); }
});

test('小小运营依据上回合购买计数发放且不重复', () => {
  const { match, ps } = fixture();
  applyHexEffect(match, ps, card('小小运营下'));
  advanceHexEffects(match, ps, 'prepEnd');
  match.round = 2;
  advanceHexEffects(match, ps, 'roundStart');
  advanceHexEffects(match, ps, 'roundStart');
  assert.equal(ps.funds, 1);
  assert.equal(ps.shop.freeRefreshes, 1);
  ps.round.buys = 1;
  advanceHexEffects(match, ps, 'prepEnd');
  match.round = 3;
  advanceHexEffects(match, ps, 'roundStart');
  assert.equal(ps.funds, 1);
  match.dispose();
});
