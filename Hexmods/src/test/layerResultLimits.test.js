import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from './helpers/battleHarness.js';
import { compactResult, resultDigest } from '../server/sim/spec.js';
import { MatchReports } from '../server/match/match/reports.js';
import { MatchClientCombat } from '../server/match/match/clientCombat.js';
import { layerGainRoom } from '../shared/constants.js';
import { REGULATION_INSTALLERS } from '../server/sim/content/garrisons/regulation.js';
import { payHammers } from '../server/sim/content/bonds/core.js';
import { gameData, setGameData } from '../server/sim/content/support/index.js';
import { readFileSync } from 'node:fs';
import { validateC2S } from '../shared/protocol.js';
import { validateClientResult } from '../server/match/fields.js';
import { MatchSettle } from '../server/match/match/settle.js';

const trait = { eventType: 'IN_BATTLE', bb: { bond_add_count: 20000 }, bbStr: { bond_type: 'bond_by_id', bond_id: 'bond_a' } };
const tempTrait = { eventType: 'IN_BATTLE', bb: { bond_add_as_tmp: 1, bond_add_count: 20001 }, bbStr: { bond_type: 'bond_by_id', bond_id: 'bond_a' } };
const rec = { bonds: ['bond_a'], garrisonIds: ['gain', 'temp'], tier: 1 };
const gd = { raw: { tokens: {} }, chess: id => id === 'op' ? rec : null, bond: id => id === 'bond_a' ? {} : null,
  garrison: id => ({ gain: trait, temp: tempTrait })[id] };
const spec = uncap => ({ kind: 'normal', round: 1, timeLimit: 60, flags: { bondLayerUncap: uncap, layerGainsEnabled: true },
  players: [{ playerId: 'p1', bonds: { bond_a: { layers: 0 } }, units: [{ uid: 1, chessId: 'op' }] }], spawns: [] });
const report = (layers, temp) => ({ reason: 'cleared', time: 1, killed: 0, total: 0, perPlayer: { p1: {
  killed: 0, total: 0, leaked: [], perfect: true, layerGains: layers, ...(temp && { tempLayerGains: temp }), unitsEnd: []
} } });
const check = (s, r) => validateClientResult(s, r, { gd });

test('真实战斗层数经压缩、协议与服务端校验保留超过10000的永久及临时层', () => {
  const h = makeBattle({ content: 'none', flags: { bondLayerUncap: true }, bonds: { bond_a: { active: true, layers: 0 } } });
  assert.equal(h.b.addLayers('p1', 'bond_a', 20000), 20000);
  assert.equal(h.b.addTempLayers('p1', 'bond_a', 20001), 20001);
  const raw = report(h.b._perPlayer.p1.layerGains, h.b._perPlayer.p1.tempLayerGains);
  const packed = compactResult(raw);
  assert.equal(validateC2S({ t: 'b.result', battleId: 'b1', result: packed }), null);
  const accepted = check(spec(true), packed);
  assert.equal(accepted.ok, false);
  assert.equal(accepted.reason, 'layers require server authority');
  assert.equal(packed.perPlayer.p1.layerGains.bond_a, 20000);
  assert.equal(packed.perPlayer.p1.tempLayerGains.bond_a, 20001);
});

test('999开关关闭时永久层仍受起始层和来源预算限制', () => {
  const s = spec(false);
  s.players[0].bonds.bond_a.layers = 998;
  assert.equal(check(s, report({ bond_a: 1 })).ok, true);
  assert.equal(check(s, report({ bond_a: 2 })).reason, 'layer bound');
  const h = makeBattle({ content: 'none', flags: { bondLayerUncap: false }, bonds: { bond_a: { active: true, layers: 998 } } });
  assert.equal(h.b.addLayers('p1', 'bond_a', 20000), 1);
});

test('拒绝非有限、越界、未知来源和禁用层数的结果', () => {
  for (const n of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '20001']) {
    const r = report({ bond_a: n }, { bond_a: n });
    assert.notEqual(validateC2S({ t: 'b.result', battleId: 'b1', result: r }), null);
    assert.equal(check(spec(true), r).ok, false);
  }
  assert.equal(check(spec(true), report({}, { bond_a: 1 })).reason, 'temp layers require server authority');
  assert.equal(check(spec(true), report({ forged: 1 })).ok, false);
  assert.equal(check(spec(true), report({}, { forged: 20001 })).ok, false);
  const s = spec(true); s.flags.layerGainsEnabled = false;
  assert.equal(check(s, report({ bond_a: 1 })).reason, 'layers disabled');
  assert.equal(check(s, report({}, { bond_a: 1 })).reason, 'layers disabled');
  const noTrait = spec(true); noTrait.players[0].units = [];
  assert.equal(check(noTrait, report({ bond_a: 20000 })).reason, 'layer bound');
});

test('真实规程临时特质和替补输入触发服务端接管', () => {
  const g = JSON.parse(readFileSync(new URL('../data/versions/act3autochess-v3_1/garrisons.json', import.meta.url), 'utf8')).garrison_13_a;
  const h = makeBattle({ content: 'none', bonds: { ursusShip: { active: true, layers: 0 } } });
  const it = { unit: { ownerId: 'p1' }, bb: g.bb, bbStr: g.bbStr };
  REGULATION_INSTALLERS[g.effectKey](h.b, [it]);
  h.b.start();
  assert.equal(h.b._perPlayer.p1.tempLayerGains.ursusShip, 4);
  const s = spec(false);
  s.players[0].bench = [{ uid: 2, kind: 'chess', chessId: 'op' }];
  const raw = report({}, { bond_a: 1 });
  let takeover;
  const f = { cc: true, battleId: 'b1', fieldId: 'f1', kind: 'normal', mode: 'client', authority: 'p1', spec: s };
  const m = { clientCombat: true, fields: [f], gd, requireCs: false, verifyStats: { rejected: 0 }, log: {},
    _fieldByBattle: MatchReports.prototype._fieldByBattle, _runOnServer(field, why) { takeover = [field, why]; } };
  MatchReports.prototype._onResult.call(m, { playerId: 'p1' }, { battleId: 'b1', result: raw });
  assert.deepEqual(takeover, [f, 'invalid']);
  assert.equal(m.verifyStats.rejected, 1);
  s.players[0].units = [];
  assert.equal(check(s, raw).reason, 'temp layers require server authority');
  const connected = new Map([['p1', { playerId: 'p1', connected: true, seat: 0 }]]);
  const ctx = { gd, players: connected };
  assert.equal(MatchClientCombat.prototype._authorityFor.call(ctx, { kind: 'normal', players: ['p1'], spec: s }), null);
  assert.equal(MatchClientCombat.prototype._authorityFor.call(ctx, { kind: 'normal', players: ['p1'], spec: spec(true) }), null);
});

test('替补入场实际安装规程临时层特质', (t) => {
  const previous = gameData();
  const garrisons = JSON.parse(readFileSync(new URL('../data/versions/act3autochess-v3_1/garrisons.json', import.meta.url), 'utf8'));
  setGameData({ ...previous, garrisons });
  t.after(() => setGameData(previous));
  const benchRec = chessRec({ id: 'bench_op', bonds: ['ursusShip'] });
  benchRec.garrisonIds = ['garrison_13_a'];
  const h = makeBattle({ defs: { chess: { bench_op: benchRec } }, players: [{ playerId: 'p1', seat: 0, side: 'L',
    units: [], bench: [{ uid: 2, idx: 0, kind: 'chess', chessId: 'bench_op', bonds: ['ursusShip'] }],
    bonds: { ursusShip: { active: true, layers: 0 } } }] });
  h.b.start();
  const unit = h.b._createAllyFromInput(h.b.getPlayer('p1'), { ...h.b.getPlayer('p1').input.bench[0], row: 10, col: 5, abs: true });
  h.b._setupUnit(unit);
  h.b._installGarrisonLate(unit);
  assert.equal(h.b._perPlayer.p1.tempLayerGains.ursusShip, 4);
});

test('明确禁用层数的联防和首领战不因解除上限转为服务端权威', () => {
  const ctx = { gd, players: new Map([['p1', { playerId: 'p1', connected: true, seat: 0 }]]) };
  for (const kind of ['unite', 'boss', 'hidden']) {
    const s = spec(true); s.kind = kind; s.flags.layerGainsEnabled = false;
    assert.equal(MatchClientCombat.prototype._authorityFor.call(ctx, { kind, spec: s, players: ['p1'] }), 'p1');
    const h = makeBattle({ kind, content: 'none', flags: s.flags, bonds: { bond_a: { active: true, layers: 0 } } });
    assert.equal(h.b.addLayers('p1', 'bond_a', 20000), 0);
    assert.equal(h.b.addTempLayers('p1', 'bond_a', 20000), 0);
    assert.equal(check(s, report({ bond_a: 1 })).reason, 'layers disabled');
    assert.equal(check(s, report({}, { bond_a: 1 })).reason, 'layers disabled');
  }
  for (const enabled of [true, undefined]) {
    const s = spec(true); s.kind = 'boss'; s.flags.layerGainsEnabled = enabled;
    assert.equal(MatchClientCombat.prototype._authorityFor.call(ctx, { kind: 'boss', spec: s, players: ['p1'] }), null);
  }
});

test('维多利亚批次限制不丢失待补里程碑', () => {
  const bond = { buffs: [{ bbStr: { key: 'bond_layer_added_reward_equip', pool: 'hammer' }, bb: { layer: 1, count: 1 } }] };
  let paid = 0, grants = 0;
  const ctx = { data: { bonds: { victoriaShip: bond } }, bondActive: () => true, layers: () => 250,
    counter: () => paid, setCounter: (_key, n) => { paid = n; }, rollItem: () => 'hammer', grantItem: () => { grants++; return true; } };
  assert.equal(payHammers(ctx), 100);
  assert.equal(paid, 100);
  assert.equal(payHammers(ctx), 100);
  assert.equal(payHammers(ctx), 50);
  assert.equal(paid, 250);
  assert.equal(grants, 250);
  assert.equal(payHammers(ctx), 0);
});

test('安全整数以内完整传输，溢出明确拒绝，摘要不掩盖结算取整差异', () => {
  const huge = 1e13 + 123;
  const packed = compactResult(report({ bond_a: huge }, { bond_a: huge + 1 }));
  assert.equal(packed.perPlayer.p1.layerGains.bond_a, huge);
  assert.equal(packed.perPlayer.p1.tempLayerGains.bond_a, huge + 1);
  assert.equal(validateC2S({ t: 'b.result', battleId: 'b1', result: packed }), null);
  assert.equal(check(spec(true), report({ bond_a: huge })).reason, 'layers require server authority');
  assert.equal(compactResult(report({ bond_a: Number.MAX_SAFE_INTEGER })).perPlayer.p1.layerGains.bond_a, Number.MAX_SAFE_INTEGER);
  assert.equal(layerGainRoom(Number.MAX_SAFE_INTEGER - 1, 1, { uncap: true }), 1);
  assert.throws(() => layerGainRoom(Number.MAX_SAFE_INTEGER - 1, 2, { uncap: true }), RangeError);
  const h = makeBattle({ content: 'none', flags: { bondLayerUncap: true }, bonds: { bond_a: { active: true, layers: 0 } } });
  assert.equal(h.b.addTempLayers('p1', 'bond_a', Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.throws(() => h.b.addTempLayers('p1', 'bond_a', 1), RangeError);
  assert.notEqual(resultDigest(report({ bond_a: 0.99999 })).json, resultDigest(report({ bond_a: 1 })).json);
  assert.notEqual(resultDigest(report({}, { bond_a: 0.99999 })).json, resultDigest(report({}, { bond_a: 1 })).json);
});

test('结算完整交付临时层且结算后清理', () => {
  const p = { playerId: 'p1', lp: 10, layers: {}, bounties: [], creditedKills: 0,
    stats: { lpLost: 0, leaks: 0, kills: 0, dmgDealt: 0, healing: 0, perfectRounds: 0 }, recompute() {} };
  let observed;
  const m = { gd: { bond: () => ({}), lpCapPerRound: 10 }, globalSettings: { bondLayerUncap: true }, order: [p],
    lastResults: new Map([['p1', report({ bond_a: 20000 }, { bond_a: 20001 }).perPlayer.p1]]),
    alivePlayers: () => [p], _stopClientCombat() {}, _charDamageTickers() {}, eliminateBroken() {},
    dispatch(_p, hook) { if (hook === 'onBattleResult') observed = p.tempLayers.bond_a; },
    fields: [], watchers: new Map(), markPublic() {}, setDeadline() {}, soloUntimed: true };
  MatchSettle.prototype.settle.call(m, null, null);
  assert.equal(p.layers.bond_a, 20000);
  assert.equal(observed, 20001);
  assert.equal(p.tempLayers, undefined);
});
