import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { HEX_CATALOG } from '../shared/hexCatalog.js';
import { createRng } from '../server/sim/rng.js';
import { validateC2S } from '../shared/protocol.js';
import { EffectsList } from '../public/js/ui/effectsList.js';

function fixture(settings = {}, extra = {}) {
  const scheduler = new VirtualScheduler();
  const match = new Match({ mode: 'coop', difficulty: 'FUNNY', seed: 7, scheduler,
    seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true },
      { seat: 1, playerId: 'p2', name: '二', connected: true },
      { seat: 2, playerId: 'ai_1', name: 'AI', isBot: true, connected: true }],
    globalSettings: settings, data: getData({ log: { warn() {}, error() {} } }),
    send() {}, broadcast() {}, onEnd() {}, hexEffectAvailable: () => true, onHexSelected() {}, ...extra });
  match.round = 1;
  return { match, scheduler };
}

test('自然候选遵守首次盟约、禁用、互斥、回合与兜底规则', () => {
  const { match } = fixture({ hexRounds: [1, 5] });
  const ps = match.players.get('p1');
  const id = name => `hex_${HEX_CATALOG.findIndex(c => c.name === name)}`;
  const drawOnly = (names, round = 1) => {
    match.opts.hexEffectAvailable = (_m, _ps, card) => names.includes(card.name);
    const seen = new Set(HEX_CATALOG.map((_, i) => `hex_${i}`).filter(x => !names.map(id).includes(x)));
    return match.drawHex({ round, seen: new Map([['p1', seen]]), rng: new Map([['p1', createRng(7)]]), rarity: new Map([['p1', '银']]) }, ps);
  };
  assert.equal(drawOnly(['炎小队增援'])?.name, '炎小队增援');
  assert.equal(drawOnly(['炎小队增援'], 5), null);
  match.disabledBonds = ['炎'];
  assert.equal(drawOnly(['炎小队增援']), null);
  match.disabledBonds = [];
  ps.hexPicks = [{ name: '阿戈尔小队增援' }];
  assert.equal(drawOnly(['炎小队增援']), null);
  ps.hexPicks = [{ name: '奇迹！' }];
  assert.equal(drawOnly(['真正的奇迹！']), null);
  ps.hexPicks = [];
  assert.equal(drawOnly(['人生切片'], 5), null);
  assert.equal(drawOnly(['产能不足喵', '苟住']).name, '苟住');
  assert.equal(drawOnly(['产能不足喵']).name, '产能不足喵');
  match.dispose();
});

test('效果未接入或无候选时记录错误并继续阶段', () => {
  for (const extra of [{ hexEffectAvailable: undefined }, { hexEffectAvailable: () => false }]) {
    const { match } = fixture({}, extra);
    let entered = 0;
    match.enterPrep = () => { entered++; };
    match.beforePrepOffers();
    assert.equal(entered, 1);
    assert.equal(match.offerWin.length, 0);
    assert.ok(match.errors.some(e => /效果接口未接入|候选海克斯不足/.test(e.message)));
    match.dispose();
  }
});

test('候选不足时按实际数量展示并可选择，零候选玩家不阻塞', () => {
  const { match, scheduler } = fixture({}, { hexEffectAvailable: (_m, ps, card) => ps.playerId !== 'p2' && card.name === '苟住' });
  let entered = 0;
  match.enterPrep = () => { entered++; };
  match.beforePrepOffers();
  const w = match.offerWin[0], p1 = match.players.get('p1');
  assert.equal(w.options.get('p1').length, 1);
  assert.equal(w.options.has('p2'), false);
  assert.ok(match.requestOffer(p1, 'hex', 1).error);
  assert.equal(match.requestOffer(p1, 'hex', 0).ok, true);
  scheduler.advance(0);
  assert.equal(entered, 1);
  assert.ok(match.errors.some(e => e.message.includes('p2')));
  match.dispose();
});

test('真实随机按权重抽取每玩家每轮品质，零权重不会被选中', () => {
  const { match } = fixture({ hexRarityWeights: { silver: 25, gold: 75, prismatic: 0 } });
  const counts = { 银: 0, 金: 0, 彩: 0 };
  for (let seed = 1; seed <= 2000; seed++) {
    match.seed = seed;
    assert.equal(match.openHexWindow(), true);
    const w = match.offerWin[0];
    const rarity = w.rarity.get('p1');
    counts[rarity]++;
    assert.ok(w.options.get('p1').every(c => c.rarity === rarity));
    match.offersDispose();
  }
  assert.equal(counts.彩, 0);
  assert.ok(counts.银 > 420 && counts.银 < 580, JSON.stringify(counts));
  match.dispose();
});

test('同品质普通卡后可重复使用同品质兜底，刷新也可再次出现', () => {
  const allowed = new Set(['苟住', '产能不足喵', '真得苟住', '血多不疼']);
  const { match } = fixture({ hexRarityWeights: { silver: 100, gold: 0, prismatic: 0 } },
    { hexEffectAvailable: (_m, _ps, card) => allowed.has(card.name) });
  assert.equal(match.openHexWindow(), true);
  const w = match.offerWin[0], ps = match.players.get('p1');
  const options = w.options.get('p1');
  assert.deepEqual(options.map(c => c.name), ['苟住', '产能不足喵', '产能不足喵']);
  assert.equal(match.requestOfferRefresh(ps, 'hex', 0).ok, true);
  assert.equal(options[0].name, '产能不足喵');
  assert.equal(match.requestOfferRefresh(ps, 'hex', 1).ok, true);
  assert.equal(options[1].name, '产能不足喵');
  assert.equal(w.refreshUsed.get('p1')[1], 1);
  match.dispose();
});

test('三种产能不足卡同轮可重复并能跨回合再次获取', () => {
  const cases = [
    ['silver', '产能不足喵'], ['gold', '真的产能不足喵'], ['prismatic', '真的真的产能不足喵'],
  ];
  for (const [key, name] of cases) {
    const weights = { silver: 0, gold: 0, prismatic: 0, [key]: 100 };
    const { match } = fixture({ hexRounds: [1, 5], hexRarityWeights: weights },
      { hexEffectAvailable: (_m, _ps, card) => card.name === name });
    const ps = match.players.get('p1');
    assert.equal(match.openHexWindow(), true);
    let w = match.offerWin[0];
    assert.deepEqual(w.options.get('p1').map(c => c.name), [name, name, name]);
    assert.equal(match.requestOfferRefresh(ps, 'hex', 0).ok, true);
    assert.equal(w.options.get('p1')[0].name, name);
    assert.equal(match.requestOffer(ps, 'hex', 0).ok, true);
    match.offersDispose();
    match.round = 5;
    assert.equal(match.openHexWindow(), true);
    w = match.offerWin[0];
    assert.deepEqual(w.options.get('p1').map(c => c.name), [name, name, name]);
    assert.equal(match.requestOffer(ps, 'hex', 1).ok, true);
    assert.equal(ps.hexPicks.filter(p => p.name === name).length, 2);
    match.dispose();
  }
});

test('私有快照持续包含本玩家全部海克斯，包括重复项', () => {
  const name = '产能不足喵';
  const sent = [];
  const { match } = fixture({ hexRounds: [1, 5], hexRarityWeights: { silver: 100, gold: 0, prismatic: 0 } },
    { hexEffectAvailable: (_m, _ps, card) => card.name === name, send: (id, msg) => { sent.push([id, msg]); return true; } });
  const p1 = match.players.get('p1'), p2 = match.players.get('p2');
  assert.deepEqual(p1.privateView().hexPicks, []);
  match.openHexWindow();
  assert.equal(match.requestOffer(p1, 'hex', 0).ok, true);
  match.flush();
  assert.deepEqual(sent.filter(([id, msg]) => id === 'p1' && msg.t === 'm.private').at(-1)[1].hexPicks.map(p => p.name), [name]);
  const first = p1.privateView();
  assert.deepEqual(first.hexPicks.map(p => p.name), [name]);
  assert.deepEqual(p2.privateView().hexPicks, []);
  match.offersDispose();
  match.round = 5;
  match.openHexWindow();
  assert.equal(match.requestOffer(p1, 'hex', 1).ok, true);
  match.flush();
  match._resync(p1);
  const resumed = sent.filter(([id, msg]) => id === 'p1' && msg.t === 'm.private').at(-1)[1];
  assert.deepEqual(resumed.hexPicks.map(p => [p.name, p.round]), [[name, 1], [name, 5]]);
  assert.equal(first.hexPicks.length, 1);
  resumed.hexPicks[0].name = 'changed';
  assert.equal(p1.privateView().hexPicks[0].name, name);
  match.dispose();
});

test('右侧效果栏保留重复海克斯并响应快照变化', () => {
  assert.equal(EffectsList({ effects: [], hexPicks: [] }), null);
  const pick = { name: '产能不足喵', rarity: '银' };
  const view = EffectsList({ effects: [], hexPicks: [pick, pick] });
  const rows = view.props.children[1];
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].key, rows[1].key);
  assert.equal(rows[0].props.pick.name, pick.name);
  assert.equal(rows[0].props.pick.rarity, pick.rarity);
  assert.equal(EffectsList({ effects: [], hexPicks: [pick] }).props.children[1].length, 1);
});

test('同品质兜底不可用时跨品质补齐并保持普通卡排重', () => {
  const allowed = new Set(['苟住', '真得苟住', '血多不疼']);
  const { match } = fixture({ hexRarityWeights: { silver: 100, gold: 0, prismatic: 0 } },
    { hexEffectAvailable: (_m, _ps, card) => allowed.has(card.name) });
  match.openHexWindow();
  const w = match.offerWin[0], ps = match.players.get('p1');
  assert.equal(w.options.get('p1')[0].name, '苟住');
  assert.deepEqual(new Set(w.options.get('p1').map(c => c.name)), allowed);
  assert.ok(match.requestOfferRefresh(ps, 'hex', 0).error);
  assert.equal(w.refreshUsed.get('p1')[0], 0);
  match.dispose();
});

test('跨品质兜底可重复且仍须效果可用', () => {
  const allowed = new Set(['苟住', '真的产能不足喵']);
  const { match } = fixture({ hexRarityWeights: { silver: 100, gold: 0, prismatic: 0 } },
    { hexEffectAvailable: (_m, _ps, card) => allowed.has(card.name) });
  match.openHexWindow();
  const w = match.offerWin[0];
  assert.deepEqual(w.options.get('p1').map(c => c.name), ['苟住', '真的产能不足喵', '真的产能不足喵']);
  assert.equal(match.requestOfferRefresh(match.players.get('p1'), 'hex', 1).ok, true);
  assert.equal(w.options.get('p1')[1].name, '真的产能不足喵');
  match.dispose();
});

test('已拥有普通卡不能自选或自然重复，已拥有兜底卡仍可自选', () => {
  const allowed = new Set(['苟住', '产能不足喵']);
  const { match } = fixture({ hexCustomEnabled: true, hexRarityWeights: { silver: 100, gold: 0, prismatic: 0 } },
    { hexSelections: { p1: { 1: '苟住' }, p2: { 1: '产能不足喵' } },
      hexEffectAvailable: (_m, _ps, card) => allowed.has(card.name) });
  match.players.get('p1').hexPicks = [{ name: '苟住' }];
  match.players.get('p2').hexPicks = [{ name: '产能不足喵' }];
  match.openHexWindow();
  const w = match.offerWin[0];
  assert.equal(w.options.get('p1')[0].name, '苟住');
  assert.equal(w.options.get('p1')[0].unavailable, true);
  assert.ok(w.options.get('p1').slice(1).every(c => c.name === '产能不足喵' && !c.custom));
  assert.equal(w.options.get('p2')[0].name, '产能不足喵');
  assert.equal(w.options.get('p2')[0].custom, true);
  assert.equal(w.options.get('p2')[1].name, '苟住');
  assert.equal(w.options.get('p2')[2].name, '产能不足喵');
  assert.ok(match.errors.some(e => e.message.includes('海克斯自选不可用: p1')));
  match.dispose();
});

test('未实现的自选保留在联机快照中且不能自动替换', () => {
  const { match, scheduler } = fixture({ hexCustomEnabled: true }, {
    hexSelections: { p1: { 1: '奇迹！' } },
    hexEffectAvailable: (_m, _ps, card) => card.name === '苟住',
  });
  match.openHexWindow();
  const w = match.offerWin[0], ps = match.players.get('p1');
  const slot = match.publicView().offers[0].seats.find(s => s.playerId === 'p1').slots[0];
  assert.equal(slot.name, '奇迹！');
  assert.equal(slot.available, false);
  const msg = { t: 'g.offer', offerId: 'hex', pluginId: 'hex', seq: w.seq, idx: 0, cardId: slot.id };
  assert.equal(validateC2S(msg), null);
  assert.ok(match.requestOffer(ps, msg.offerId, msg.idx, msg).error);
  scheduler.advance(15000);
  assert.equal(w.picks.get('p1').idx, null);
  assert.deepEqual(ps.hexPicks || [], []);
  match.dispose();
});

test('自选候选动态失效后超时不替换', () => {
  let available = true;
  const { match, scheduler } = fixture({ hexCustomEnabled: true }, {
    hexSelections: { p1: { 1: '苟住' } },
    hexEffectAvailable: (_m, _ps, card) => card.name !== '苟住' || available,
  });
  match.openHexWindow();
  const w = match.offerWin[0], ps = match.players.get('p1');
  available = false;
  assert.equal(match.offerViews()[0].seats.find(s => s.playerId === 'p1').slots[0].available, false);
  scheduler.advance(15000);
  assert.equal(w.picks.get('p1').idx, null);
  assert.deepEqual(ps.hexPicks || [], []);
  match.dispose();
});

test('选择回调异常不记录选择且可重试', () => {
  const { match } = fixture({}, { onHexSelected: () => { throw new Error('failed'); } });
  match.openHexWindow();
  const w = match.offerWin[0], ps = match.players.get('p1');
  assert.ok(match.requestOffer(ps, 'hex', 0).error);
  assert.equal(w.picks.has('p1'), false);
  assert.deepEqual(ps.hexPicks, []);
  assert.ok(match.errors.some(e => e.message.includes('failed')));
  match.opts.onHexSelected = () => {};
  assert.equal(match.requestOffer(ps, 'hex', 0).ok, true);
  assert.equal(ps.hexPicks.length, 1);
  match.dispose();
});

test('自选可异品质，普通候选及刷新保持本轮品质', () => {
  const { match } = fixture({ hexCustomEnabled: true, hexRarityWeights: { silver: 100, gold: 0, prismatic: 0 } },
    { hexSelections: { p1: { 1: '血多不疼' } } });
  match.openHexWindow();
  const w = match.offerWin[0], ps = match.players.get('p1');
  assert.equal(w.options.get('p1')[0].rarity, '彩');
  assert.ok(w.options.get('p1').slice(1).every(c => c.rarity === '银'));
  assert.equal(match.requestOfferRefresh(ps, 'hex', 0).ok, true);
  assert.equal(w.options.get('p1')[0].rarity, '银');
  match.dispose();
});

test('海克斯启用和回合配置', () => {
  const { match } = fixture({ hexEnabled: false });
  assert.equal(match.openHexWindow(), false);
  match.dispose();
  const other = fixture({ hexRounds: [5] }).match;
  assert.equal(other.openHexWindow(), false);
  other.dispose();
});

test('真正单人海克斯不限时，快照恢复后仍可刷新和选择', () => {
  const { match, scheduler } = fixture({ hexSelectionSeconds: 1 }, {
    mode: 'solo', seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true }],
  });
  let entered = 0;
  match.enterPrep = () => { entered++; };
  match.beforePrepOffers();
  const w = match.offerWin[0], ps = match.players.get('p1');
  assert.equal(w.deadline, 0);
  assert.equal(match._offerTimers.has(w), false);
  scheduler.advance(120000);
  const snapshot = JSON.parse(JSON.stringify(match.publicView()));
  const offer = snapshot.offers.find(o => o.hex);
  assert.equal(offer.deadline, 0);
  assert.equal(offer.windowSec, 0);
  assert.equal(offer.seats[0].picked, false);
  assert.equal(w.closed, false);
  assert.equal(entered, 0);
  assert.equal(match.requestOfferRefresh(ps, 'hex', 0, { pluginId: offer.pluginId, seq: offer.seq, cardId: offer.seats[0].slots[0].id }).ok, true);
  assert.equal(match.requestOffer(ps, 'hex', 0, { pluginId: offer.pluginId, seq: offer.seq }).ok, true);
  scheduler.advance(0);
  assert.equal(entered, 1);
  match.dispose();
});

test('合作单人房仍按设置超时', () => {
  const { match, scheduler } = fixture({ hexSelectionSeconds: 2 }, {
    mode: 'coop', seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true }],
  });
  match.openHexWindow();
  const w = match.offerWin[0], ps = match.players.get('p1');
  assert.equal(w.deadline, scheduler.now() + match.scaled(2000));
  assert.equal(match.publicView().offers[0].windowSec, 2);
  scheduler.advance(match.scaled(2000));
  assert.equal(w.closed, true);
  assert.equal(w.picks.get('p1').timeout, true);
  assert.equal(ps.hexPicks.length, 1);
  match.dispose();
});

test('休整前等待、快照恢复和所有人选择后继续', () => {
  const { match, scheduler } = fixture();
  let entered = 0;
  match.enterPrep = () => { entered++; };
  match.beforePrepOffers();
  const w = match.offerWin[0];
  const snapshot = match.publicView().offers.find(o => o.hex);
  assert.equal(snapshot.seats.find(s => s.playerId === 'p1').slots.length, 3);
  for (const id of ['p1', 'p2']) {
    assert.equal(match.requestOffer(match.players.get(id), 'hex', 0, { pluginId: 'hex', seq: w.seq }).ok, true);
  }
  assert.equal(entered, 0);
  scheduler.advance(0);
  assert.equal(entered, 1);
  match.dispose();
});

test('不同玩家的回合预选分别进入候选', () => {
  const { match } = fixture({ hexCustomEnabled: true }, { hexSelections: { p1: { 1: '血多不疼' }, p2: { 1: '奇迹！' } } });
  assert.equal(match.openHexWindow(), true);
  const w = match.offerWin[0];
  assert.equal(w.options.get('p1')[0].name, '血多不疼');
  assert.equal(w.options.get('p2')[0].name, '奇迹！');
  assert.equal(w.options.get('p1')[0].custom, true);
  assert.equal(w.options.get('p2')[0].custom, true);
  match.dispose();
});

test('自选首项、刷新排重、AI 和超时', () => {
  const selected = [];
  const { match, scheduler } = fixture({ hexCustomEnabled: true }, {
    hexSelections: { p1: { 1: '血多不疼' } }, onHexSelected: (_m, ps, pick) => selected.push([ps.playerId, pick]),
  });
  assert.equal(match.openHexWindow(), true);
  const w = match.offerWin[0];
  const p1 = match.players.get('p1');
  const p2 = match.players.get('p2');
  assert.equal(w.picks.has('ai_1'), true);
  assert.equal(w.options.get('p1')[0].rarity, '彩');
  assert.equal(w.options.get('p1')[0].custom, true);
  const first = w.options.get('p1').map(c => c.id);
  for (let idx = 0; idx < 3; idx++) {
    assert.equal(match.requestOfferRefresh(p1, 'hex', idx, { pluginId: 'hex', seq: w.seq }).ok, true);
    assert.ok(!first.includes(w.options.get('p1')[idx].id));
    first.push(w.options.get('p1')[idx].id);
    assert.ok(match.requestOfferRefresh(p1, 'hex', idx, { pluginId: 'hex', seq: w.seq }).error);
  }
  assert.equal(match.requestOffer(p1, 'hex', 1, { pluginId: 'hex', seq: w.seq }).ok, true);
  assert.equal(w.closed, false);
  const expected = w.options.get('p2')[0].id;
  scheduler.advance(15000);
  assert.equal(w.closed, true);
  assert.equal(p2.hexPicks[0].id, expected);
  assert.equal(selected.length, 3);
  assert.deepEqual(scheduler.errors, []);
  match.dispose();
});
