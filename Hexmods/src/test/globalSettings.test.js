import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Lobby, Room } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { canEditGlobalSettings, loadGlobalSettingsPref, loadPersonalHex } from '../public/js/ui/globalSettings.js';
import { savePref } from '../public/js/store.js';
import { C2S, validateC2S } from '../shared/protocol.js';
import { GLOBAL_SETTINGS_DEFAULTS, normalizeGlobalSettings, enemyGlobalScale, allyGlobalScale, applyGlobalBattleScales, operatorLayerCap } from '../shared/globalSettings.js';
import { wireOptions } from '../server/match/host/proxy.js';
import { Match } from '../server/match/Match.js';
import { getData } from '../server/data.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { PHASE } from '../shared/constants.js';
import { makeCtx } from '../server/match/effectsMeta.js';
import { useCommand } from '../server/match/bandCommands.js';
import { makeBattle, chessRec, enemyRec } from './helpers/battleHarness.js';

function fixture(t, mode = 'coop') {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry });
  t.after(() => lobby.shutdown());
  const creator = registry.create('创建者');
  const joiner = registry.create('加入者');
  creator.connected = joiner.connected = true;
  assert.equal(lobby.create(creator, { mode }).ok, true);
  const room = lobby.rooms.get(creator.roomCode);
  if (mode === 'coop') assert.equal(lobby.join(joiner, { code: room.code }).ok, true);
  return { lobby, creator, joiner, room };
}

function matchFixture(settings = {}) {
  const scheduler = new VirtualScheduler();
  const match = new Match({
    roomCode: 'TEST', mode: 'solo', difficulty: 'FUNNY', modeId: 'mode_single_funny', seed: 7,
    seats: [{ seat: 0, playerId: 'p1', name: '测试博士', isBot: false, connected: true }],
    globalSettings: settings,
    scheduler,
    clientCombat: false,
    botRehearsal: 0,
    data: getData({ log: { warn() {}, error() {} } }),
    send() {}, broadcast() {}, onEnd() {},
  });
  const player = match.players.get('p1');
  match.phase = PHASE.PREP;
  match.round = 1;
  return { match, player, scheduler };
}

function closeMatch(match) {
  match.dispose();
}

test('全局设置协议严格校验封闭字段、类型和范围', () => {
  assert.equal(validateC2S({ t: 'room.setGlobalSettings', settings: { enemyHpBonus: 3, infiniteFunds: true } }), null);
  assert.match(validateC2S({ t: 'room.setGlobalSettings', settings: { endless: true } }), /bad field settings/);
  assert.match(validateC2S({ t: 'room.setGlobalSettings', settings: { enemyAtkBonus: 11 } }), /bad field settings/);
  assert.match(validateC2S({ t: 'room.setGlobalSettings', settings: { difficultyMercy: 1 } }), /bad field settings/);
  assert.equal(C2S['room.setGlobalSettings'].settings({}), false);
});

test('全局设置偏好恢复、补全缺省字段并在损坏时回退', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage);
  assert.deepEqual(loadGlobalSettingsPref(), GLOBAL_SETTINGS_DEFAULTS);
  savePref('lobby.globalSettings', { enemyHpBonus: 4, infiniteFunds: true });
  assert.deepEqual(loadGlobalSettingsPref(), { ...GLOBAL_SETTINGS_DEFAULTS, enemyHpBonus: 4, infiniteFunds: true });
  for (const invalid of [null, [], 'bad', { enemyHpBonus: 11 }, { infiniteFunds: 1 }, { unknown: true }]) {
    savePref('lobby.globalSettings', invalid);
    assert.deepEqual(loadGlobalSettingsPref(), GLOBAL_SETTINGS_DEFAULTS);
  }
  values.set('sp.pref.lobby.globalSettings', '{');
  assert.deepEqual(loadGlobalSettingsPref(), GLOBAL_SETTINGS_DEFAULTS);
});

test('海克斯设置校验、克隆及协议边界', () => {
  const defaults = normalizeGlobalSettings();
  assert.equal(defaults.hexEnabled, true);
  assert.deepEqual(defaults.hexRounds, [1, 5, 9]);
  assert.equal(defaults.hexCustomEnabled, false);
  assert.deepEqual(defaults.hexRarityWeights, { silver: 25, gold: 55, prismatic: 20 });
  assert.equal(defaults.hexSelectionSeconds, 15);
  const rounds = [14, 1];
  const weights = { silver: 0, gold: 100, prismatic: 0 };
  const settings = normalizeGlobalSettings({ hexRounds: rounds, hexRarityWeights: weights, hexSelectionSeconds: 60 });
  rounds.push(5);
  weights.gold = 0;
  assert.deepEqual(settings.hexRounds, [1, 14]);
  assert.deepEqual(settings.hexRarityWeights, { silver: 0, gold: 100, prismatic: 0 });
  assert.ok(Object.isFrozen(settings.hexRounds));
  assert.ok(Object.isFrozen(settings.hexRarityWeights));
  assert.notEqual(defaults.hexRounds, GLOBAL_SETTINGS_DEFAULTS.hexRounds);
  assert.notEqual(defaults.hexRarityWeights, GLOBAL_SETTINGS_DEFAULTS.hexRarityWeights);
  assert.equal(validateC2S({ t: 'room.setGlobalSettings', settings: { hexRounds: [], hexSelectionSeconds: 1 } }), null);
  for (const patch of [
    { hexEnabled: 1 }, { hexCustomEnabled: null }, { hexRounds: [0] }, { hexRounds: [15] },
    { hexRounds: [1, 1] }, { hexRounds: ['1'] }, { hexRounds: null }, { hexRounds: Array(1) },
    { hexRarityWeights: { silver: 25, gold: 55, prismatic: 19 } },
    { hexRarityWeights: { silver: 25, gold: 55 } },
    { hexRarityWeights: { silver: 25, gold: 55, prismatic: 20, other: 0 } },
    { hexRarityWeights: { silver: -1, gold: 81, prismatic: 20 } },
    { hexRarityWeights: { silver: 25.5, gold: 54.5, prismatic: 20 } },
    { hexSelectionSeconds: 0 }, { hexSelectionSeconds: 61 }, { hexSelectionSeconds: 1.5 }, { hexSelectionSeconds: '15' },
  ]) {
    assert.throws(() => normalizeGlobalSettings(patch));
    assert.match(validateC2S({ t: 'room.setGlobalSettings', settings: patch }), /bad field settings/);
  }
});

test('海克斯偏好持久化及界面回调权限', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage);
  const settings = normalizeGlobalSettings({ hexEnabled: false, hexRounds: [2, 14], hexCustomEnabled: true,
    hexRarityWeights: { silver: 30, gold: 40, prismatic: 30 }, hexSelectionSeconds: 60 });
  savePref('lobby.globalSettings', settings);
  assert.deepEqual(loadGlobalSettingsPref(), settings);
  savePref('lobby.personalHex', { 1: '血多不疼', 14: '奇迹！' });
  assert.deepEqual(loadPersonalHex(), { 1: '血多不疼', 14: '奇迹！' });
  savePref('lobby.personalHex', { 15: '血多不疼' });
  assert.deepEqual(loadPersonalHex(), {});
  savePref('lobby.globalSettings', { hexRarityWeights: { silver: 0, gold: 0, prismatic: 0 } });
  assert.deepEqual(loadGlobalSettingsPref(), GLOBAL_SETTINGS_DEFAULTS);
  const ui = await readFile(new URL('../public/js/ui/globalSettings.js', import.meta.url), 'utf8');
  assert.match(ui, /global-settings-tab-hex/);
  assert.match(ui, /disabled=\$\{!editable \|\| saving \|\| !validWeights\}/);
  assert.match(ui, /\(room\?\.mode \?\? roomMode\) !== 'solo' \? html`<\$\{SettingSlider\} id="hexSelectionSeconds"/);
  assert.match(ui, /personal-hex-editor/);
  assert.match(ui, /lobby\.personalHex/);
});

test('共享设置默认值和敌我倍率独立计算', () => {
  const settings = normalizeGlobalSettings({ enemyHpBonus: 2, enemyAtkBonus: 4, allyHpBonus: 3, allyAtkBonus: 5 });
  assert.deepEqual(settings, { ...GLOBAL_SETTINGS_DEFAULTS, enemyHpBonus: 2, enemyAtkBonus: 4, allyHpBonus: 3, allyAtkBonus: 5 });
  assert.equal(enemyGlobalScale(settings).hpMul, 0.84);
  assert.ok(Math.abs(enemyGlobalScale(settings).atkMul - 0.98) < 1e-12);
  assert.deepEqual(allyGlobalScale(settings), { hpMul: 1.3, atkMul: 1.5 });
});

test('Room 构造与 JSON 序列化包含独立的创建者字段，未知创建者不授予房主权限', () => {
  const room = new Room('ABCD', 'coop', 'FUNNY', 0);
  assert.equal(room.creatorId, null);
  room.hostId = '继任房主';
  const state = JSON.parse(JSON.stringify(room.toState()));
  assert.equal(state.creatorId, null);
  assert.equal(canEditGlobalSettings(state, state.hostId), false);
  assert.equal(canEditGlobalSettings(null, null), false);
  assert.equal(canEditGlobalSettings({}, undefined), false);
});

test('创建者可更新全局设置，加入者和继任 host 只读，开局后禁止更新', (t) => {
  const { lobby, creator, joiner, room } = fixture(t);
  assert.deepEqual(room.toState().globalSettings, GLOBAL_SETTINGS_DEFAULTS);
  assert.equal(lobby.setGlobalSettings(creator, { settings: { enemyHpBonus: 2, infiniteFunds: true } }).ok, true);
  assert.equal(room.globalSettings.enemyHpBonus, 2);
  assert.equal(room.globalSettings.infiniteFunds, true);
  assert.equal(lobby.setGlobalSettings(joiner, { settings: { enemyHpBonus: 4 } }).error, 'NOT_HOST');
  lobby.leave(creator);
  assert.equal(lobby.setGlobalSettings(joiner, { settings: { enemyHpBonus: 4 } }).error, 'NOT_HOST');
  assert.equal(lobby.join(creator, { code: room.code }).ok, true);
  room.match = {};
  assert.equal(lobby.setGlobalSettings(creator, { settings: { enemyHpBonus: 4 } }).error, 'ROOM_STARTED');
});

test('Battle 选项分别应用 ally 和 enemy 倍率，且保留既有敌方倍率', () => {
  const scaled = applyGlobalBattleScales({
    players: [{ units: [{ uid: 1, mods: { hpMul: 1.1, atkMul: 0.9 } }] }],
    spawns: [{ enemyKey: 'e', mods: { hpMul: 1.2, atkMul: 1.3 } }],
    flags: { enemyScale: { hpMul: 1.5, atkMul: 1.4 } },
  }, { difficultyMercy: false, allyHpBonus: 2, allyAtkBonus: 3, enemyHpBonus: 1, enemyAtkBonus: 2 });
  assert.ok(Math.abs(scaled.players[0].units[0].mods.hpMul - 1.32) < 1e-12);
  assert.ok(Math.abs(scaled.players[0].units[0].mods.atkMul - 1.17) < 1e-12);
  assert.ok(Math.abs(scaled.spawns[0].mods.hpMul - 1.32) < 1e-12);
  assert.ok(Math.abs(scaled.spawns[0].mods.atkMul - 1.56) < 1e-12);
  assert.ok(Math.abs(scaled.flags.enemyScale.hpMul - 1.65) < 1e-12);
  assert.ok(Math.abs(scaled.flags.enemyScale.atkMul - 1.68) < 1e-12);
});

test('Match host 选项白名单转发全局设置，不透传 endless', () => {
  const out = wireOptions({ mode: 'coop', globalSettings: { ...GLOBAL_SETTINGS_DEFAULTS }, endless: true, send() {} });
  assert.deepEqual(out.globalSettings, GLOBAL_SETTINGS_DEFAULTS);
  assert.equal(Object.hasOwn(out, 'endless'), false);
});

test('新建单人房间的创建者可编辑，全局设置检查不修改房间状态', (t) => {
  const { creator, joiner, room } = fixture(t, 'solo');
  const before = JSON.stringify(room.toState());
  assert.equal(room.creatorId, creator.playerId);
  assert.equal(room.hostId, creator.playerId);
  assert.equal(canEditGlobalSettings(room.toState(), creator.playerId), true);
  assert.equal(canEditGlobalSettings(room.toState(), joiner.playerId), false);
  assert.equal(JSON.stringify(room.toState()), before);
});

test('多人加入者只读；创建者离开后继任 host 仍只读，原房主操作正常迁移', (t) => {
  const { lobby, creator, joiner, room } = fixture(t);
  assert.equal(canEditGlobalSettings(room.toState(), creator.playerId), true);
  assert.equal(canEditGlobalSettings(room.toState(), joiner.playerId), false);
  assert.equal(lobby.leave(creator).ok, true);
  const state = JSON.parse(JSON.stringify(room.toState()));
  assert.equal(state.creatorId, creator.playerId);
  assert.equal(state.hostId, joiner.playerId);
  assert.equal(canEditGlobalSettings(state, joiner.playerId), false);
  assert.equal(lobby.setDifficulty(joiner, { difficulty: 'NORMAL' }).ok, true);
  assert.equal(lobby.addBot(joiner).ok, true);
  assert.equal(room.creatorId, creator.playerId);
});

test('最初创建者重新加入仍按 creatorId 判断，新加入者不会继承权限', (t) => {
  const { lobby, creator, joiner, room } = fixture(t);
  lobby.leave(creator);
  assert.equal(lobby.join(creator, { code: room.code }).ok, true);
  assert.equal(room.hostId, joiner.playerId);
  assert.equal(canEditGlobalSettings(room.toState(), creator.playerId), true);
  assert.equal(canEditGlobalSettings(room.toState(), joiner.playerId), false);
});

test('单人创建前入口和房间入口接入真实设置控件与写通道', async () => {
  const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const [ui, lobby, room] = await Promise.all([
    read('public/js/ui/globalSettings.js'), read('public/js/screens/lobby.js'), read('public/js/screens/room.js'),
  ]);
  assert.match(lobby, /ProtocolSelect\} roomMode="solo" beforeCreate=\$\{true\}/);
  assert.match(lobby, /GlobalSettingsModal\} beforeCreate=\$\{true\} roomMode=\$\{roomMode\}/);
  assert.match(lobby, /globalOpen \? html`<\$\{GlobalSettingsModal\} beforeCreate=\$\{true\} settings=/);
  assert.match(lobby, /globalSettings=\$\{globalSettings\} onGlobalSettings=\$\{setGlobalSettings\}/);
  assert.match(lobby, /globalSettings \? \{ globalSettings \}/);
  assert.match(room, /GlobalSettingsButton\} class="room-global-settings"/);
  assert.match(room, /GlobalSettingsModal\} room=\$\{room\} myId=\$\{me.playerId\}/);
  assert.match(room, /net\.request\('room\.setGlobalSettings'/);
  assert.match(lobby, /useState\(loadGlobalSettingsPref\)/);
  assert.match(ui, /if \(!editable \|\| saving \|\| typeof onSave !== 'function'\) return/);
  assert.match(ui, /const ok = await onSave\(draft\);\s*if \(ok !== false\) \{\s*savePref\(GLOBAL_SETTINGS_PREF, normalizeGlobalSettings\(draft\)\);\s*onClose\?\.\(\);/);
  assert.match(ui, /onClose=\$\{onClose\}/);
  assert.match(room, /const setGlobalSettings = \(settings\) => run\('global'/);
  assert.match(ui, /难度设置/);
  assert.match(ui, /玩法设置/);
  assert.match(ui, /type="range" min="0" max="10" step="1"/);
  assert.match(ui, /difficultyMercy/);
  assert.match(ui, /infiniteFunds/);
  assert.match(ui, /classicAutoChess/);
  assert.match(ui, /研发中 \/ 未开放/);
});

test('房间全局设置只有底部入口，位于所有身份的 GoButton 左侧', async () => {
  const room = await readFile(new URL('../public/js/screens/room.js', import.meta.url), 'utf8');
  const top = room.slice(room.indexOf('<div class="rs-tools">'), room.indexOf('<div class="rs-top__right">'));
  const foot = room.slice(room.indexOf('<div class="room-bar__right rs-foot__right">'), room.indexOf('</footer>'));
  assert.doesNotMatch(top, /GlobalSettingsButton/);
  assert.equal((room.match(/<\$\{GlobalSettingsButton\}/g) || []).length, 1);
  assert.match(foot, /rs-foot__right">\s*<\$\{GlobalSettingsButton\} class="room-global-settings"/);
  assert.ok(foot.indexOf('GlobalSettingsButton') < foot.indexOf('${facts.isHost'));
  assert.ok(foot.indexOf('GlobalSettingsButton') < foot.indexOf('GoButton'));
});

test('底部入口使用蓝色游戏面板风格并垂直居中，不依赖顶部小屏豁免', async () => {
  const css = await readFile(new URL('../public/css/screens/room.css', import.meta.url), 'utf8');
  assert.match(css, /\.room-bar__right\s*\{[^}]*align-items: center/);
  assert.match(css, /\.room-global-settings\.btn\s*\{[^}]*align-self: center/);
  assert.match(css, /\.room-global-settings\.btn\s*\{[^}]*background: linear-gradient/);
  assert.match(css, /\.room-global-settings\.btn\s*\{[^}]*border-left: 3px solid/);
  assert.doesNotMatch(css, /:not\(\.room-global-settings\)/);
});

test('infiniteFunds 下购买、刷新、升级、奖励和 effects 扣费后始终保持有限资金 99', () => {
  for (const action of ['buy', 'refresh', 'levelUp', 'reward', 'effect']) {
    const { match, player } = matchFixture({ infiniteFunds: true });
    player.startRound(1);
    if (action === 'buy') {
      const chessId = Object.keys(player.gd._chess).find((id) => player.gd.chess(id)?.visible && !player.gd.isGolden(id));
      assert.ok(chessId);
      player.shop.slots[0] = { kind: 'chess', id: chessId, basePrice: 7, frozen: false, sold: false };
      assert.equal(player.buy(0).ok, true);
    } else if (action === 'refresh') {
      assert.equal(player.refresh().ok, true);
    } else if (action === 'levelUp') {
      assert.equal(player.levelUp().ok, true);
    } else if (action === 'reward') {
      const chessId = Object.keys(player.gd._chess).find((id) => player.gd.chess(id)?.visible && !player.gd.isGolden(id));
      assert.ok(chessId);
      const offer = player.pushRewardOffer('test', { ids: [chessId] });
      assert.ok(offer);
      offer.slots[0].price = 7;
      assert.equal(player.pickReward(0).ok, true);
    } else {
      const ctx = makeCtx(match, player, { kind: 'effect', key: 'effect:test' }, 'onSpend');
      assert.equal(ctx.spendFunds(13), true);
    }
    assert.equal(player.funds, 99, action);
    assert.ok(Number.isFinite(player.funds), action);
    closeMatch(match);
  }
});

test('classicAutoChess 保留资金，并把 onIncome、pendingFunds 和每 10 金币利息叠加', () => {
  const { match, player } = matchFixture({ classicAutoChess: true });
  player.startRound(1);
  player.funds = 27;
  player.endPrep();
  assert.equal(player.funds, 27);
  const originalDispatch = match.dispatch;
  match.dispatch = (ps, hook, ev) => {
    if (hook === 'onIncome') { ev.income = 3; ev.pending = 4; }
    return ev;
  };
  player.startRound(2);
  assert.equal(player.funds, 27 + 3 + 4 + Math.floor(27 / 10));
  match.dispatch = originalDispatch;
  closeMatch(match);

  const ordinary = matchFixture();
  ordinary.player.startRound(1);
  ordinary.player.funds = 27;
  ordinary.player.endPrep();
  assert.equal(ordinary.player.funds, 0);
  closeMatch(ordinary.match);
});

test('指令支付入口通过统一 spend，并在 infiniteFunds 下保持 99', () => {
  const skill = {
    effectId: 'test_command', type: 'ACTIVE', cost: 13, availType: 'ROUND_RESET', availCount: 1,
    unlockType: 'NONE', unlockParam: [], targetType: 'NO_TARGET', targetFilterType: null,
    buffs: [{ key: 'skill_gain_gold_cd_by_gold', bb: { mingold: 1, maxgold: 1 }, bbStr: {} }],
  };
  const band = { bandId: 'test_band', skills: [skill], buffs: [] };
  const ps = {
    m: { round: 1, globalSettings: { infiniteFunds: true } },
    gd: { raw: { bands: { test_band: band } }, band: (id) => id === 'test_band' ? band : null },
    bandId: 'test_band', command: null, commandMarks: [], commandDrafts: [], funds: 99,
    _gate: () => null, dirty() {}, canAfford: () => true,
    spend(n) { assert.equal(n, 13); this.funds = 99; return true; },
    addFunds() {}, _afterSpend(n, reason) { this.afterSpend = [n, reason]; }, recompute() {},
  };
  const ctx = { rng: { int: () => 1 } };
  assert.equal(useCommand(ps, 'test_command', {}, ctx).ok, true);
  assert.equal(ps.funds, 99);
  assert.deepEqual(ps.afterSpend, [13, 'command']);
});

test('Battle 模拟器实际消费全局 ally/enemy 倍率，且 enemy mercy 不影响 ally', () => {
  const settings = { difficultyMercy: true, enemyHpBonus: 0, enemyAtkBonus: 0, allyHpBonus: 3, allyAtkBonus: 5 };
  const options = applyGlobalBattleScales({
    players: [{ playerId: 'p1', seat: 0, side: 'L', units: [{ uid: 1, kind: 'chess', chessId: 'scale_op', row: 10, col: 5 }] }],
    spawns: [{ time: 0, enemyKey: 'scale_enemy', routeIndex: 0, pos: [9, 10] }],
  }, settings);
  const h = makeBattle({
    players: [{ ...options.players[0], bonds: {} }],
    enemies: options.spawns.map((s) => ({ key: s.enemyKey, time: s.time, route: s.routeIndex, pos: s.pos, mods: s.mods })),
    defs: {
      chess: { scale_op: chessRec({ id: 'scale_op', skill: null, stats: { maxHp: 1000, atk: 100 } }) },
      enemies: { scale_enemy: enemyRec({ key: 'scale_enemy', hp: 1000, atk: 100, speed: 0 }) },
    },
    content: 'none',
  });
  h.b.start();
  h.b.step();
  const ally = h.b.allyUnits[0];
  const enemy = h.b.enemies[0];
  assert.equal(ally.base.maxHp, 1300);
  assert.equal(ally.base.atk, 150);
  assert.equal(enemy.base.maxHp, 700);
  assert.equal(enemy.base.atk, 70);
  assert.ok(Number.isFinite(ally.hp));
  assert.ok(Number.isFinite(enemy.hp));
});

test('干员层数上限六档的协议、归一化和取整', () => {
  const expected = [0, 3, 7, 10, 14, Infinity];
  for (const [index, scale] of [-2, -1, 0, 1, 2, 3].entries()) {
    assert.equal(validateC2S({ t: 'room.setGlobalSettings', settings: { operatorLayerCapScale: scale } }), null);
    assert.equal(normalizeGlobalSettings({ operatorLayerCapScale: scale }).operatorLayerCapScale, scale);
    assert.equal(operatorLayerCap(7, scale), expected[index]);
    assert.equal(operatorLayerCap(0, scale), Infinity);
  }
  for (const invalid of [-3, 4, 0.5, '1', null]) {
    assert.match(validateC2S({ t: 'room.setGlobalSettings', settings: { operatorLayerCapScale: invalid } }), /bad field settings/);
    assert.throws(() => normalizeGlobalSettings({ operatorLayerCapScale: invalid }));
  }
  assert.throws(() => normalizeGlobalSettings({ bondLayerUncap: 1 }));
});

test('999 盟约上限开关传入 Battle 并控制实际层数', () => {
  for (const uncap of [false, true]) {
    const { flags } = applyGlobalBattleScales({}, { bondLayerUncap: uncap });
    const h = makeBattle({ content: 'none', flags, bonds: { test_bond: { active: true, layers: 998 } } });
    assert.equal(h.b.flags.bondLayerUncap, uncap);
    assert.equal(h.b.addLayers('p1', 'test_bond', 3, 'test'), uncap ? 3 : 1);
    assert.equal(h.b.getPlayer('p1').bonds.test_bond.layers, uncap ? 1001 : 999);
    assert.equal(h.b.addLayers('p1', 'test_bond', 1, 'test'), uncap ? 1 : 0);
  }
});

test('真实战斗安装华法琳特质并按设置限制技能叠层', async (t) => {
  for (const [scale, cap] of [[-2, 0], [-1, 3], [0, 7], [1, 10], [2, 14], [3, Infinity]]) {
    await t.test(`档位 ${scale}`, () => {
      const rec = chessRec({ id: 'cap_test_op', bonds: ['test_bond'], skill: null });
      rec.garrisonIds = ['garrison_95_a'];
      const { flags } = applyGlobalBattleScales({}, { operatorLayerCapScale: scale });
      const h = makeBattle({
        units: [{ chessId: 'cap_test_op', row: 10, col: 5 }],
        defs: { chess: { cap_test_op: rec } },
        bonds: { test_bond: { active: true, layers: 0 } }, flags,
      });
      assert.deepEqual(h.b.errors, [], '特质安装不应产生战斗错误');
      const instance = h.b._garInstances.find((it) => it.gid === 'garrison_95_a');
      assert.ok(instance, '应创建真实特质实例');
      assert.equal(instance.cap, cap);
      h.b.start();
      for (let i = 0; i < 20; i++) h.b.emit('skillStart', { unit: h.unit('cap_test_op') });
      assert.equal(h.b.getPlayer('p1').bonds.test_bond.layers, Math.min(cap, 20));
      assert.deepEqual(h.b.errors, []);
    });
  }
});

test('嵌套设置内容不变时不取消准备或广播', (t) => {
  const { lobby, creator, joiner, room } = fixture(t);
  const seat = room.seatOf(joiner.playerId);
  seat.ready = true;
  let broadcasts = 0;
  lobby.broadcastState = () => { broadcasts++; };
  assert.equal(lobby.setGlobalSettings(creator, { settings: {
    hexRounds: [...room.globalSettings.hexRounds].reverse(),
    hexRarityWeights: { ...room.globalSettings.hexRarityWeights },
  } }).ok, true);
  assert.equal(seat.ready, true);
  assert.equal(broadcasts, 0);
  assert.equal(lobby.setGlobalSettings(creator, { settings: { hexRounds: [2] } }).ok, true);
  assert.equal(seat.ready, false);
  assert.equal(broadcasts, 1);
});

test('个人海克斯协议和席位隔离及开局快照', (t) => {
  const { lobby, creator, joiner, room } = fixture(t);
  assert.equal(validateC2S({ t: 'room.hexSelection', picks: { 1: '血多不疼', 14: '奇迹！' } }), null);
  for (const picks of [null, [], { 0: '血多不疼' }, { 15: '血多不疼' }, { '01': '血多不疼' }, { 1: '不存在' }, { 1: null }]) {
    assert.match(validateC2S({ t: 'room.hexSelection', picks }), /bad field picks/);
    assert.equal(lobby.hexSelection(joiner, { picks }).error, 'BAD_MSG');
  }
  assert.equal(lobby.hexSelection(creator, { picks: { 1: '血多不疼' } }).ok, true);
  assert.equal(lobby.hexSelection(joiner, { picks: { 1: '奇迹！' }, playerId: creator.playerId }).ok, true);
  assert.deepEqual(room.seatOf(creator.playerId).hexSelection, { 1: '血多不疼' });
  assert.deepEqual(room.seatOf(joiner.playerId).hexSelection, { 1: '奇迹！' });
  assert.equal(JSON.stringify(room.toState()).includes('血多不疼'), false);
  let opts;
  lobby.MatchClass = class { constructor(o) { opts = o; } start() {} dispose() {} };
  assert.equal(lobby.startMatch(room).ok, true);
  assert.deepEqual(opts.hexSelections[creator.playerId], { 1: '血多不疼' });
  assert.deepEqual(opts.hexSelections[joiner.playerId], { 1: '奇迹！' });
  assert.deepEqual(wireOptions(opts).hexSelections, opts.hexSelections);
  assert.equal(lobby.hexSelection(joiner, { picks: {} }).error, 'ROOM_STARTED');
});

test('所有设置相关改动使用 CRLF', async () => {
  for (const file of ['public/js/screens/lobby.js', 'public/js/screens/room.js', 'public/js/ui/globalSettings.js',
    'public/css/screens/lobby.css', 'public/css/screens/room.css', 'server/lobby.js']) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(text.includes('\r\n'), file);
    assert.doesNotMatch(text, /(?<!\r)\n/, file);
  }
});
