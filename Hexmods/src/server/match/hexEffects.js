import { HEX_CATALOG, hexBondCardBlocked } from '../../shared/hexCatalog.js';

const cards = HEX_CATALOG.map((card, i) => ({ ...card, id: `hex_${i}` }));
const byName = new Map(cards.map(card => [card.name, card]));
const rewards = {
  '可露希尔的资金夹': [8, 1], '产能不足喵': [10, 1],
  '真的产能不足喵': [15, 2], '真的真的产能不足喵': [20, 4],
};
const health = { '苟住': 6, '真得苟住': 11, '血多不疼': 20 };
const repeatable = new Set(['产能不足喵', '真的产能不足喵', '真的真的产能不足喵']);
const operatorNames = { '艾斯黛尔': '艾丝黛尔' };

// ── v0.1.3 ────────────────────────────────────────────────────────────────
// 花到上头两档：每休整期开始发放的 [资金, 免费刷新, 寻呼模块]
const PURSE = { '花到上头': [5, 2, 1], '花到上头++': [8, 2, 2] };
const PAGER_ITEM = 'chess_item_4_01_e_a'; // 寻呼模块（items.json, tier 4）
// 引火成书 / 重锤回响 的赠与盟约
const GIFT_BOND = { '引火成书': 'yanShip', '重锤回响': 'victoriaShip' };
// 魔王冠冕：总加成 = 50% + 1%×完美 − 2%×非完美，下限 15%，无上限（用户 2026-11-18 确认）。
const CROWN_BASE = 50;
const CROWN_GAIN = 1;
const CROWN_LOSS = 2;
const CROWN_MIN = 15;

function hexOwned(ps, name) {
  return (ps.hexPicks || []).some(p => p.name === name);
}

const DEEP_SEA_STATS = ['hp', 'atk', 'def', 'res'];
const deepSeaNumber = v => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, v)) : 0;

export function hexDeepSeaState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { ...(value.egir === true ? { egir: true } : {}),
    stats: Object.fromEntries(DEEP_SEA_STATS.map(k => [k, deepSeaNumber(value.stats?.[k])])) };
}

export function addHexDeepSea(piece, value) {
  const gain = hexDeepSeaState(value);
  if (!gain || piece?.kind !== 'chess') return false;
  const before = hexDeepSeaState(piece.meta?.hexDeepSea);
  const stats = Object.fromEntries(DEEP_SEA_STATS.map(k => [k, deepSeaNumber((before?.stats[k] || 0) + gain.stats[k])]));
  if (!gain.egir && !DEEP_SEA_STATS.some(k => gain.stats[k] > 0)) return false;
  (piece.meta ||= {}).hexDeepSea = { ...(before?.egir || gain.egir ? { egir: true } : {}), stats };
  return true;
}

/** 魔王冠冕当前总加成（百分点）；未持有返回 0。下限 15%。 */
export function hexCrownPct(ps) {
  const crown = ps.hexEffectState?.crown;
  if (!crown) return 0;
  return Math.max(CROWN_MIN, Number(crown.pct) || CROWN_BASE);
}

/** 每场自己的普通战斗结算后调用一次：完美 +1%，非完美 −2%，不低于 15%。 */
export function settleHexCrown(ps, perfect) {
  if (!hexOwned(ps, '魔王冠冕')) return null;
  const crown = (state(ps).crown ||= { pct: CROWN_BASE });
  const before = Math.max(CROWN_MIN, Number(crown.pct) || CROWN_BASE);
  const after = Math.max(CROWN_MIN, before + (perfect ? CROWN_GAIN : -CROWN_LOSS));
  crown.pct = after;
  ps.dirty();
  return { before, after, perfect };
}

/** 当前生效的「出售不给钱」档位名，null 表示不限制。 */
export function hexPurse(ps) {
  if (hexOwned(ps, '花到上头++')) return '花到上头++';
  if (hexOwned(ps, '花到上头')) return '花到上头';
  return null;
}

/** 出售干员是否被「花到上头」拦掉资金。 */
export function hexBlocksSellFunds(ps) {
  return hexPurse(ps) !== null;
}

/** 每休整期开始发放一次；同一回合重复调用只发一次。 */
function grantPurse(match, ps, s) {
  const name = hexPurse(ps);
  if (!name) return null;
  const purse = (s.purse ||= { lastRound: 0 });
  if (purse.lastRound === match.round) return null;
  const [funds, refreshes, pagers] = PURSE[name];
  ps.addFunds(funds, { reason: 'hex' });
  ps.shop.freeRefreshes += refreshes;
  let pagersGiven = 0;
  for (let i = 0; i < pagers; i++) if (ps.acquireItem(PAGER_ITEM, { source: 'hex' })) pagersGiven++;
  purse.lastRound = match.round;
  ps.dirty();
  return { name, funds, refreshes, pagers: pagersGiven };
}

/** 赠两名不同干员（按盟约筛选，不超过调度中心等级）。 */
function grantDistinctBondOperators(match, ps, bondId, count) {
  const granted = [], seen = new Set();
  for (let i = 0; i < count; i++) {
    const id = match.pool.roll(match.rngShop, {
      maxTier: ps.shop.level,
      filter: (cid) => {
        const rec = ps.gd.chess(cid);
        return !!rec && !!rec.bonds?.includes(bondId) && !match.chessExcluded(rec) && !seen.has(rec.name);
      },
      extra: ps.diyStockEntries(),
    });
    if (!id) break;
    const rec = ps.gd.chess(id);
    seen.add(rec.name);
    if (!ps.acquireChess(id, { source: 'hex' })) break;
    granted.push(rec.name);
  }
  return { granted, missing: Math.max(0, count - granted.length) };
}

function state(ps) {
  return ps.hexEffectState ||= {};
}

const DEEP_SEA_ITEMS = ['阿戈尔重刃', '变形同构体'];

function deepSeaEconomy(match, ps) {
  return state(ps).deepSeaEconomy ||= {
    selectedRound: match.round, lastPrepRound: match.round,
    items: Object.fromEntries(DEEP_SEA_ITEMS.map(name => [name, false])),
  };
}

// 逐件落账；缺货项留待选卡回调、升级或后续休整开始重试。
export function grantHexDeepSeaItems(match, ps) {
  if (!hexOwned(ps, '深海倾灭')) return null;
  const s = deepSeaEconomy(match, ps);
  if (ps.shop.level < 6 || s.grantingItems || DEEP_SEA_ITEMS.every(name => s.items[name])) return null;
  const granted = [], missing = [];
  s.grantingItems = true;
  try {
    for (const name of DEEP_SEA_ITEMS) {
      if (s.items[name]) continue;
      const id = Object.keys(ps.gd.raw.items || {}).find(id => {
        const rec = ps.gd.item(id);
        return rec?.name === name && rec.itemType === 'EQUIP' && !rec.isGolden;
      });
      if (id && match.itemPool.canGain(id) && ps.acquireItem(id, { source: 'hex' })) {
        s.items[name] = true;
        granted.push(id);
      } else missing.push(name);
    }
  } finally {
    delete s.grantingItems;
    ps.dirty();
  }
  return { name: '深海倾灭', status: missing.length ? 'partial' : 'applied', granted, missing };
}

function grantDeepSeaOperator(match, ps) {
  if (!hexOwned(ps, '深海倾灭')) return null;
  const s = deepSeaEconomy(match, ps);
  if (match.round <= s.selectedRound || match.round <= s.lastPrepRound) return null;
  s.lastPrepRound = match.round;
  ps.dirty();
  const id = match.pool.roll(match.rngShop, {
    maxTier: ps.shop.level,
    filter: id => {
      const rec = ps.gd.chess(id);
      return rec?.visible && !rec.isGolden && !rec.isDiy && !rec.isHidden
        && !rec.hideInShop && !rec.shopExcluded && rec.bonds?.includes('egirShip') && !match.chessExcluded(rec);
    },
  });
  const granted = id && ps.acquireChess(id, { source: 'hex' }) ? [id] : [];
  return { name: '深海倾灭', status: granted.length ? 'applied' : 'partial', granted,
    ...(!granted.length ? { reason: 'no-eligible-chess' } : {}) };
}

function grantRandomChess(match, ps, tier, count) {
  const granted = [];
  for (let i = 0; i < count; i++) {
    const id = match.pool.roll(match.rngShop, { tier, extra: ps.diyStockEntries() });
    if (!id || !ps.acquireChess(id, { source: 'hex' })) break;
    granted.push(id);
  }
  return granted;
}

export function lowSupplyItems(ps) {
  return Object.entries(ps.gd.raw.items || {}).filter(([, item]) => item && item.itemType === 'EQUIP'
    && item.tier === 1 && !item.isGolden && !item.isHidden && !item.hideInShop && !item.shopExcluded)
    .map(([id]) => id).sort();
}

export function lowSupplyAvailable(match, ps) {
  const ids = lowSupplyItems(ps);
  return ids.length > 0 && ids.every(id => match.itemPool.canGain(id));
}

export function eligibleGift(match, ps, source) {
  const owned = ps.hexPicks || [];
  const owns = c => owned.some(p => p.id === c.id || p.name === c.name);
  const off = new Set([...match.disabledBonds, ...match.staticInactiveBonds].map(id => match.gd.bond(id)?.name || id));
  const reinforcement = owned.some(p => {
    const c = cards.find(x => x.id === p.id || x.name === p.name);
    return c?.tags?.includes('盟约') && c.tags.includes('增援');
  });
  const offerIndex = match.globalSettings.hexRounds.filter(r => r <= match.round).length;
  const eligible = cards.filter(c => c.rarity === source.rarity && c.name !== source.name
    && (repeatable.has(c.name) || !owns(c))
    && (typeof match.opts.hexEffectAvailable !== 'function' || match.opts.hexEffectAvailable(match, ps, c))
    && !(c.natural?.maxRound && match.round > c.natural.maxRound)
    && !hexBondCardBlocked(c, offerIndex, off)
    && !(reinforcement && c.tags?.includes('盟约') && c.tags.includes('增援'))
    && !c.incompatibleWith?.some(name => owned.some(p => p.name === name))
    && !owned.some(p => byName.get(p.name)?.incompatibleWith?.includes(c.name)));
  const normal = eligible.filter(c => !c.natural?.fallbackOnly);
  return normal.length ? normal : eligible.filter(c => c.natural?.fallbackOnly);
}

// Call after the selected card is recorded in ps.hexPicks.
export function applyHexEffect(match, ps, catalogCard) {
  const card = byName.get(catalogCard?.name);
  if (!card) return { status: 'unimplemented', reason: 'unknown-card' };
  const name = card.name;
  if (name === '深海倾灭') {
    deepSeaEconomy(match, ps);
    return grantHexDeepSeaItems(match, ps) || { status: 'applied' };
  }
  if (name === '不再孤独') {
    const bondId = 'soloShip';
    const bond = ps.gd.bond(bondId);
    const disabled = [...(match.disabledBonds || []), ...(match.staticInactiveBonds || [])];
    if (!bond || ps.gd.modeInactiveBonds.has(bondId) || disabled.includes(bondId) || disabled.includes(bond.name)) {
      return { status: 'partial', granted: [], reason: 'bond-disabled-or-missing' };
    }
    const id = match.pool.roll(match.rngShop, {
      maxTier: ps.shop.level,
      filter: id => ps.gd.chess(id)?.bonds?.includes(bondId) && !match.chessExcluded(ps.gd.chess(id)),
      extra: ps.diyStockEntries(),
    });
    const granted = id && ps.acquireChess(id, { source: 'hex' }) ? [id] : [];
    return { status: granted.length ? 'applied' : 'partial', granted, ...(!granted.length ? { reason: 'no-eligible-chess' } : {}) };
  }
  if (name === '屠宰与手术') {
    const bondId = 'preciShip';
    const bond = ps.gd.bond(bondId);
    const disabled = [...(match.disabledBonds || []), ...(match.staticInactiveBonds || [])];
    if (!bond || ps.gd.modeInactiveBonds.has(bondId) || disabled.includes(bondId) || disabled.includes(bond.name)) {
      return { status: 'partial', granted: [], reason: 'bond-disabled-or-missing' };
    }
    const granted = [];
    for (let i = 0; i < 2; i++) {
      const id = match.pool.roll(match.rngShop, {
        maxTier: ps.shop.level,
        filter: id => ps.gd.chess(id)?.bonds?.includes(bondId) && !match.chessExcluded(ps.gd.chess(id)),
        extra: ps.diyStockEntries(),
      });
      if (!id || !ps.acquireChess(id, { source: 'hex' })) break;
      granted.push(id);
    }
    return { status: granted.length === 2 ? 'applied' : 'partial', granted,
      ...(granted.length < 2 ? { reason: 'no-eligible-chess' } : {}) };
  }
  if (name === '愈合于铿锵战火') {
    ps.recompute();
    return { status: ps.bonds.docShip?.active ? 'applied' : 'partial', ...(!ps.bonds.docShip?.active ? { reason: 'bond-disabled-or-missing' } : {}) };
  }
  if (name === '奇迹！' || name === '真正的奇迹！' || name === '华尔街之狼') {
    const s = state(ps);
    const bondId = name === '华尔街之狼' ? 'investShip' : 'miraShip';
    (s.forcedBonds ||= {})[bondId] = true;
    if (bondId === 'miraShip') ps.counters['hex:miracle:mode'] = name === '奇迹！' ? 1 : 2;
    else s.wallStreet = { lastRound: match.round };
    ps.recompute();
    if (bondId === 'investShip') ps.addFunds(-(1 + match.rngShop.int(3)), { reason: 'hex' });
    return { status: ps.bonds[bondId]?.active ? 'applied' : 'partial', ...(!ps.bonds[bondId]?.active ? { reason: 'bond-disabled-or-missing' } : {}) };
  }
  if (name === '真知灼见') {
    ps.counters['hex:insight:paid'] = Math.floor((ps.layers.visiShip || 0) / 10);
    ps.counters['hex:insight:active'] = 1;
    const granted = [], missing = [];
    for (const operator of ['渡桥', '空弦']) {
      const id = ps.gd.visibleChess.find(id => ps.gd.chess(id).name === operator && !match.chessExcluded(ps.gd.chess(id)));
      const pool = id && ps.poolOf(ps.gd.baseIdOf(id));
      if (id && (!pool.has(id) || pool.left(id) > 0) && ps.acquireChess(id, { source: 'hex' })) granted.push(operator);
      else missing.push(operator);
    }
    return { status: missing.length ? 'partial' : 'applied', granted, missing };
  }
  // ── v0.1.3 经济 / 回合类 ──────────────────────────────────────────────
  if (name === '再就业回执') {
    ps.addFunds(1, { reason: 'hex' });
    state(ps).rehire = { round: match.round, used: false };
    ps.dirty();
    return { status: 'applied' };
  }
  if (PURSE[name]) {
    const granted = grantPurse(match, ps, state(ps));
    return { status: 'applied', ...(granted ? { granted } : {}) };
  }
  if (name === '超前投资') {
    ps.addFunds(3, { reason: 'hex' });
    const lost = ps.funds; // 含刚获得的 3 资金：文案顺序为先得 3，再失去当前全部资金
    ps.addFunds(-lost, { reason: 'hex' });
    state(ps).invest = { paid: false, lost, dueRound: match.round + 2 };
    ps.dirty();
    return { status: 'applied', lost };
  }
  if (name === '越级调度') {
    if (ps.shop.level >= ps.gd.maxShopLevel) {
      ps.addFunds(15, { reason: 'hex' });
      ps.shop.freeRefreshes += 5;
      ps.dirty();
      return { status: 'applied', alt: 'max-level' };
    }
    ps.shop.level++;
    ps.shop.upgradePrice = ps.gd.upgradeBase(ps.shop.level) ?? 0;
    if (typeof ps._openLevelSlots === 'function') ps._openLevelSlots();
    ps.shop.freeRefreshes += 3;
    match.dispatch(ps, 'onLevelUp', { level: ps.shop.level, price: 0 });
    grantHexDeepSeaItems(match, ps);
    ps.dirty();
    return { status: 'applied', level: ps.shop.level };
  }
  if (name === '重奏之影') {
    state(ps).encore = { left: 2 };
    return { status: 'applied' };
  }
  if (GIFT_BOND[name]) {
    const { granted, missing } = grantDistinctBondOperators(match, ps, GIFT_BOND[name], 2);
    return { status: missing ? 'partial' : 'applied', granted,
      ...(missing ? { reason: 'no-eligible-chess' } : {}) };
  }
  if (name === '名刀司命！') {
    const s = state(ps);
    s.lastStand = { used: false, payoutRound: 0, paid: false };
    return { status: 'applied' };
  }
  if (name === '魔王冠冕') {
    state(ps).crown = { pct: CROWN_BASE };
    return { status: 'applied' };
  }
  if (rewards[name]) {
    const [funds, refreshes] = rewards[name];
    ps.addFunds(funds, { reason: 'hex' });
    ps.shop.freeRefreshes += refreshes;
    ps.dirty();
    return { status: 'applied' };
  }
  if (health[name]) {
    ps.lp += health[name];
    ps.dirty();
    match.markPublic();
    return { status: 'applied' };
  }
  if (name === '随机白银' || name === '随机黄金') {
    const pool = eligibleGift(match, ps, card);
    const gift = match.rngShop.pick(pool);
    if (!gift) return { status: 'unavailable', reason: 'no-eligible-gift' };
    (ps.hexPicks ||= []).push({ id: gift.id, name: gift.name, rarity: gift.rarity, round: match.round, custom: false, gifted: true });
    const result = ['低阶调香', '众志合一', '众志合一+'].includes(gift.name)
      ? { status: 'applied' } : applyHexEffect(match, ps, gift);
    ps.addFunds(name === '随机白银' ? 3 : 6, { reason: 'hex' });
    ps.dirty();
    return { status: result.status === 'applied' || gift.name === '安慰奖' ? 'applied' : 'partial', gift: gift.name, result };
  }
  if (name === '一阶增援') {
    const granted = grantRandomChess(match, ps, 1, 4);
    return { status: granted.length === 4 ? 'applied' : 'partial', granted };
  }
  if (name === '维多利亚的低级补给') {
    const ids = lowSupplyItems(ps);
    if (!lowSupplyAvailable(match, ps)) return { status: 'unavailable', reason: 'equipment-unavailable', granted: [] };
    const granted = [];
    for (const id of ids) {
      if (!ps.acquireItem(id, { source: 'hex' })) return { status: 'partial', reason: 'equipment-acquisition-failed', granted };
      granted.push(id);
    }
    return { status: 'applied', granted };
  }
  if (card.operators) {
    const granted = [], missing = [];
    for (const operator of card.operators) {
      const name = operatorNames[operator] || operator;
      const id = ps.gd.visibleChess.find(id => ps.gd.chess(id).name === name && !match.chessExcluded(ps.gd.chess(id)));
      const pool = id && ps.poolOf(ps.gd.baseIdOf(id));
      if (id && (!pool.has(id) || pool.left(id) > 0) && ps.acquireChess(id, { source: 'hex' })) granted.push(operator);
      else missing.push(operator);
    }
    return { status: missing.length ? 'partial' : 'applied', granted, missing };
  }
  if (name === '人生切片') {
    const s = state(ps).slice = { lastRound: match.round, done: false };
    const tier = Math.min(6, Math.ceil(match.round / 2));
    const granted = grantRandomChess(match, ps, tier, 1);
    if (tier === 6 && granted.length) s.done = true;
    return { status: granted.length ? 'applied' : 'partial', granted };
  }
  if (name === '小小运营下') {
    state(ps).thrifty = { selectedRound: match.round, lastEnd: 0, pending: false, lastStart: 0 };
    return { status: 'applied' };
  }
  if (name === '文火猛炖') {
    state(ps).stew = { selectedRound: match.round, lastStart: match.round, distributed: false };
    return { status: 'applied' };
  }
  if (name === '安慰奖') {
    ps.addFunds(8, { reason: 'hex' });
    return { status: 'partial', unimplemented: ['全员1%攻击'] };
  }
  return { status: 'unimplemented', reason: 'missing-effect-context' };
}

// roundStart runs once after PlayerState.startRound; prepEnd runs before its counters reset.
export function advanceHexEffects(match, ps, event) {
  const s = state(ps), round = match.round, results = [];
  if (event === 'prepEnd' && s.thrifty && round >= s.thrifty.selectedRound && round > s.thrifty.lastEnd) {
    s.thrifty.pending = ps.round.buys === 0;
    s.thrifty.lastEnd = round;
  }
  if (event === 'prepEnd') {
    // 偏科补课：层数最低的已激活可叠层盟约 +8，并列按 gd.bondIds 固定顺序取第一个
    if (hexOwned(ps, '偏科补课')) {
      const active = Object.keys(ps.bonds || {}).filter(id => ps.bonds[id]?.active && !ps.gd.bond(id)?.noStack);
      if (active.length) {
        const low = active.reduce((m, id) => Math.min(m, ps.layers[id] || 0), Infinity);
        const order = ps.gd.bondIds || [];
        const pick = active.filter(id => (ps.layers[id] || 0) === low)
          .sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
        const added = ps.addLayers(pick, 8, { requireActive: true, reason: 'hex' });
        results.push({ name: '偏科补课', status: added === 8 ? 'applied' : 'partial', bondId: pick, added });
      }
    }
    // 重锤回响：维多利亚每跨 25 层里程碑 +5 资金，每回合最多 3 次
    if (hexOwned(ps, '重锤回响')) {
      const milestones = Math.floor((ps.layers.victoriaShip || 0) / 25);
      const h = (s.hammer ||= { paid: milestones });
      if (milestones > h.paid) {
        const times = Math.min(3, milestones - h.paid);
        ps.addFunds(times * 5, { reason: 'hex' });
        h.paid = milestones;
        ps.dirty();
        results.push({ name: '重锤回响', status: 'applied', funds: times * 5, times });
      }
    }
  }
  if (event === 'prepStart') {
    const deepSeaItems = grantHexDeepSeaItems(match, ps);
    if (deepSeaItems) results.push(deepSeaItems);
    const deepSeaOperator = grantDeepSeaOperator(match, ps);
    if (deepSeaOperator) results.push(deepSeaOperator);
    const purse = grantPurse(match, ps, s);
    if (purse) results.push({ name: purse.name, status: 'applied', funds: purse.funds, refreshes: purse.refreshes, pagers: purse.pagers });
    if (s.lastStand?.used && !s.lastStand.paid && round >= s.lastStand.payoutRound) {
      ps.addFunds(12, { reason: 'hex' });
      ps.shop.freeRefreshes += 2;
      ps.dirty();
      s.lastStand.paid = true;
      results.push({ name: '名刀司命！', status: 'applied', funds: 12, refreshes: 2 });
    }
    return results;
  }
  if (event !== 'roundStart') return results;
  if (s.invest && !s.invest.paid && round >= s.invest.dueRound) {
    const payout = s.invest.lost * 3;
    ps.addFunds(payout, { reason: 'hex' });
    s.invest.paid = true;
    results.push({ name: '超前投资', status: 'applied', funds: payout });
  }
  if (s.wallStreet && round > s.wallStreet.lastRound) {
    const amount = 1 + match.rngShop.int(3);
    const deducted = -ps.addFunds(-amount, { reason: 'hex' });
    s.wallStreet.lastRound = round;
    results.push({ name: '华尔街之狼', status: 'applied', deducted });
  }
  if (s.thrifty && round > s.thrifty.selectedRound && round > s.thrifty.lastStart) {
    if (s.thrifty.pending && s.thrifty.lastEnd === round - 1) {
      ps.addFunds(1, { reason: 'hex' });
      ps.shop.freeRefreshes++;
      ps.dirty();
      results.push({ name: '小小运营下', status: 'applied' });
    }
    s.thrifty.pending = false;
    s.thrifty.lastStart = round;
  }
  if (s.slice && !s.slice.done && round > s.slice.lastRound) {
    const tier = Math.min(6, Math.ceil(round / 2));
    const granted = grantRandomChess(match, ps, tier, 1);
    s.slice.lastRound = round;
    if (tier === 6 && granted.length) s.slice.done = true;
    results.push({ name: '人生切片', status: granted.length ? 'applied' : 'partial', granted });
  }
  if (s.stew && round > s.stew.lastStart) {
    ps.addFunds(2, { reason: 'hex' });
    s.stew.lastStart = round;
    let distribution = null;
    if (!s.stew.distributed && round >= s.stew.selectedRound + 3) {
      const active = Object.keys(ps.bonds).filter(id => ps.bonds[id]?.active).sort();
      distribution = {};
      if (active.length) {
        const total = round * 15, base = Math.floor(total / active.length), remainder = total % active.length;
        active.forEach((id, i) => { distribution[id] = ps.addLayers(id, base + (i < remainder ? 1 : 0), { requireActive: true, reason: 'hex' }); });
      }
      s.stew.distributed = true;
    }
    const distributed = distribution && Object.values(distribution).reduce((sum, n) => sum + n, 0);
    results.push({ name: '文火猛炖', status: distribution && distributed !== round * 15 ? 'partial' : 'applied', distribution });
  }
  return results;
}
