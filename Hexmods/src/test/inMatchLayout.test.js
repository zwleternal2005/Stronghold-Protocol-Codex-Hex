import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandDisplayEffects } from '../shared/commandDisplay.js';
import { bandProgressView } from '../server/match/bandProgress.js';
import { strategyProgressModel } from '../public/js/ui/strategyProgress.js';
import { Match } from '../server/match/Match.js';
import { getVersionData } from '../server/data.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { PHASE } from '../shared/constants.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const bands = JSON.parse(read('data/versions/act3autochess-v3_1/bands.json'));
const band = Object.values(bands).find(b => b.skills?.some(s => s.buffs?.some(x => x.key === 'refresh_shop_count_gain_coin_bond_char_chess')));
const skill = band.skills.find(s => s.buffs?.some(x => x.key === 'refresh_shop_count_gain_coin_bond_char_chess'));
const rows = progress => commandDisplayEffects({ bands, originalBandId: band.bandId, commandEffectId: skill.effectId, commandType: skill.type, progress });
const rewardLimit = band.buffs.find(b => b.key === 'refresh_shop_count_gain_coin_bond_char_chess').bb.max_count;

test('非规程版本保留累计刷新语义，下一奖励距离跟随本回合奖励上限', () => {
  const ps = { bandId: band.bandId, gd: { band: () => band }, m: { round: 2 }, round: { refreshes: 1 }, counters: {
    'band:chiave:refreshes': 6, 'band:chiave:r': 2, 'band:chiave': 2,
  } };
  const before = JSON.stringify(ps.counters);
  const effect = rows(bandProgressView(ps))[0];
  assert.equal(effect.command, true);
  assert.equal(effect.commandType, 'PASSIVE');
  assert.deepEqual(effect.progress, { current: 2, total: 4 });
  const maxCount = band.buffs.find(b => b.key === 'refresh_shop_count_gain_coin_bond_char_chess').bb.max_count;
  assert.deepEqual(effect.roundProgress, { current: 2, total: maxCount });
  assert.equal(effect.nextRewardRefreshes, null);
  assert.equal(strategyProgressModel(effect).lines[0][1], '2 / 4');
  assert.equal(strategyProgressModel(effect).badge, '本回合已满');
  ps.m.round = 3;
  ps.round.refreshes = 0;
  const next = rows(bandProgressView(ps))[0];
  assert.deepEqual(next.progress, { current: 2, total: 4 });
  assert.equal(next.roundProgress.current, 0);
  assert.equal(next.nextRewardRefreshes, 2);
  assert.equal(JSON.stringify(ps.counters), before, '展示读取不能重置判定计数');
});

test('规程读取本回合刷新数，整倍数后的下一奖励需完整一组刷新', () => {
  const ps = { bandId: band.bandId, gd: { band: () => band, config: { version: { family: 'regulation' } } },
    m: { round: 2 }, round: { refreshes: 3 }, counters: {
      'band:chiave:refreshes': 6, 'band:chiave:r': 1, 'band:chiave': 2,
    } };
  const before = JSON.stringify(ps.counters);
  assert.deepEqual(bandProgressView(ps), {
    progress: { current: 3, total: 4 }, nextRewardRefreshes: 1,
    roundProgress: { current: 0, total: rewardLimit },
  });
  assert.equal(JSON.stringify(ps.counters), before, '展示读取不能重置旧回合的奖励计数');
  ps.round.refreshes = 4;
  assert.deepEqual(bandProgressView(ps), {
    progress: { current: 0, total: 4 }, nextRewardRefreshes: 4,
    roundProgress: { current: 0, total: rewardLimit },
  });
  ps.counters['band:chiave:r'] = 2;
  ps.counters['band:chiave'] = rewardLimit;
  ps.round.refreshes = 9;
  const full = rows(bandProgressView(ps))[0];
  assert.equal(full.nextRewardRefreshes, null);
  assert.equal(strategyProgressModel(full).badge, '本回合已满');
  ps.m.round = 3;
  ps.round.refreshes = 0;
  const fullCounters = JSON.stringify(ps.counters);
  const next = bandProgressView(ps);
  assert.deepEqual(next.progress, { current: 0, total: 4 });
  assert.equal(next.roundProgress.current, 0);
  assert.equal(next.nextRewardRefreshes, 4);
  assert.equal(JSON.stringify(ps.counters), fullCounters, '展示读取不能重置判定计数');
});

test('贾维进度缺失或非法计数归零，无有效刷新阈值时不展示', () => {
  const ps = { bandId: band.bandId, gd: { band: () => band, config: { version: { family: 'regulation' } } },
    m: { round: 1 }, counters: { 'band:chiave:r': 1, 'band:chiave': NaN } };
  for (const refreshes of [undefined, NaN, Infinity, -2]) {
    ps.round = { refreshes };
    const progress = bandProgressView(ps);
    assert.deepEqual(progress.progress, { current: 0, total: 4 });
    assert.equal(progress.roundProgress.current, 0);
    assert.equal(progress.nextRewardRefreshes, 4);
  }
  ps.gd.band = () => ({ buffs: [{ key: 'refresh_shop_count_gain_coin_bond_char_chess', bb: { refresh_count: 0 } }] });
  assert.equal(bandProgressView(ps), null);
  ps.gd.band = () => null;
  assert.equal(bandProgressView(ps), null);
});

test('规程真实刷新发奖、重连与跨回合的服务端进度一致', t => {
  const sent = [];
  const match = new Match({ mode: 'coop', difficulty: 'FUNNY', seed: 11, scheduler: new VirtualScheduler(),
    seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true },
      { seat: 1, playerId: 'p2', name: '二', connected: true }],
    data: getVersionData('act3autochess@V3_1', { log: { warn() {}, error() {} } }),
    send(playerId, message) { sent.push({ playerId, message }); }, broadcast() {}, onEnd() {} });
  t.after(() => match.dispose());
  match.round = 1;
  match.phase = PHASE.PREP;
  match.disabledBonds = [];
  match.staticInactiveBonds = [];
  match.bondChoice = null;
  const ps = match.players.get('p1');
  ps.bandId = band.bandId;
  ps.recompute();
  ps.shop.freeRefreshes = 20;
  ps.counters['band:chiave:refreshes'] = 17;
  const total = 4;
  const assertProgress = (current, rewards, remaining) => {
    const expected = { progress: { current, total }, nextRewardRefreshes: remaining,
      roundProgress: { current: rewards, total: rewardLimit } };
    assert.deepEqual(ps.bandProgressView(), expected);
    assert.deepEqual(ps.battleInput().bandProgress, expected);
    const effect = ps.privateView().effects.find(e => e.command);
    assert.ok(effect);
    assert.deepEqual(effect.progress, expected.progress);
    assert.deepEqual(effect.roundProgress, expected.roundProgress);
    assert.equal(effect.nextRewardRefreshes, remaining);
  };
  const refresh = () => assert.deepEqual(match.handle('p1', { t: 'g.refresh' }), { ok: true });
  assertProgress(0, 0, 4);
  for (let i = 1; i < 4; i++) {
    refresh();
    assertProgress(i, 0, 4 - i);
  }
  assert.equal(ps.round.gainedChess, 0);
  refresh();
  assertProgress(0, 1, null);
  assert.equal(ps.round.gainedChess, 1);
  for (let i = 0; i < 4; i++) refresh();
  assertProgress(0, 1, null);
  assert.equal(ps.round.gainedChess, 1);
  refresh();
  assertProgress(1, 1, null);
  for (let i = 0; i < 3; i++) refresh();
  assertProgress(0, 1, null);
  assert.equal(ps.round.gainedChess, 1, '本轮满额后不再发奖');
  match.onDisconnect('p1');
  sent.length = 0;
  const counters = { ...ps.counters };
  match.onReconnect('p1');
  const view = sent.findLast(s => s.playerId === 'p1' && s.message.t === 'm.private')?.message;
  assert.ok(view);
  const effect = view.effects.find(e => e.command);
  assert.deepEqual(effect.progress, { current: 0, total: 4 });
  assert.deepEqual(effect.roundProgress, { current: 1, total: rewardLimit });
  assert.equal(effect.nextRewardRefreshes, null);
  assert.deepEqual(ps.counters, counters);
  match.round = 2;
  ps.startRound(2);
  assertProgress(0, 0, 4);
  assert.deepEqual(ps.counters, counters, '回合开始只复位刷新数，奖励计数延迟复位');
  for (let i = 0; i < 4; i++) refresh();
  assertProgress(0, 1, null);
  assert.equal(ps.round.gainedChess, 1);
  assert.equal(ps.counters['band:chiave:refreshes'], 17, '规程不使用旧的累计刷新计数');
});

test('没有服务端进度时不编造计数或分母', () => {
  assert.equal(strategyProgressModel(rows(null)[0]), null);
  assert.equal(strategyProgressModel({ progress: { current: -1, total: 4 } }), null);
});

test('自己的指令进入商店工具网格，观战仍读取远端效果', () => {
  const game = read('public/js/screens/game.js');
  assert.match(game, /watchingOther && field \? \(field.effects \?\? null\) : priv\?\.effects/);
  assert.match(game, /commandTile=\$\{priv\?\.command && !spectator && !watchingOther && !pen/);
  assert.match(game, /<\$\{BandCommand\}/);
  assert.match(game, /ownCommandId=\$\{showShop && !barCollapsed && !watchingOther && !spectator && !pen \? priv\?\.command\?\.effectId : null\}/);
  assert.doesNotMatch(read('public/js/ui/effectsList.js'), /commandControl|<\$\{BandCommand\}/);
  assert.match(read('public/js/ui/effectsList.js'), /ownCommandId && e.iconKind === 'band' && e.command !== false && e.id === ownCommandId/);
});

test('DPS入口位于全屏后，现有统计面板和切换回调继续接线', () => {
  const game = read('public/js/screens/game.js');
  const corner = game.slice(game.indexOf('<div class="gm__corner">'));
  assert.ok(corner.indexOf('<${FullscreenButton}') < corner.indexOf('class="gm__gear gm__metrics"'));
  assert.equal((game.match(/class="gm__gear gm__metrics"/g) || []).length, 1);
  assert.match(corner, /CombatMetricsPanel/);
  assert.match(corner, /setMetricsOpen\(!metricsOpen\)/);
});

test('四块按钮使用同一等比网格并显示次数而非费用', () => {
  const css = read('public/css/screens/game-shop.css');
  const regHud = read('public/css/screens/game-reghud.css');
  const shop = read('public/js/ui/shopBar.js');
  const command = read('public/js/ui/bandCommand.js');
  assert.ok(css.includes('grid-template-columns: repeat(2, var(--compact-w))'));
  assert.ok(css.includes('--compact-w: calc(1.58rem / var(--compact-divisor))'));
  assert.ok(css.includes('--compact-h: calc(.64rem / var(--compact-divisor))'));
  assert.ok(regHud.includes('--compact-divisor: 1.3'));
  assert.ok(shop.includes('<div class="shopbar__command">${commandTile}</div>'));
  assert.ok(command.includes('c.usesLeft != null ? c.usesLeft'));
  assert.ok(command.includes('progress?.buttonText'));
  assert.ok(command.includes('delay=${800}'));
});

test('费用仅在顶栏生命值右侧渲染一份，保留未知值隐藏与零值', () => {
  const hud = read('public/js/ui/hud.js');
  assert.match(hud, /<\$\{DpCounter\} dp=\$\{isCombatPhase\(phase\) \|\| phase === PHASE.SETTLE \? hud\?\.dp : null\}/);
  assert.ok(hud.indexOf('<${DpCounter}') > hud.indexOf('<${LpTower} value=${lp}'));
  assert.match(hud, /if \(!Number.isFinite\(dp\)\) return null/);
  assert.doesNotMatch(read('public/js/ui/combatHud.js'), /DpCounter/);
  const css = read('public/css/screens/game.css');
  assert.match(css, /\.dpbox \{[^}]*flex-direction: row/);
  assert.match(css, /\.band-command\.toolbtn[^}]*font-family: var\(--command-font-family, inherit\)/s);
});
