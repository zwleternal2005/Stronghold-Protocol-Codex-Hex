import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../server/match/Match.js';
import { getVersionData } from '../server/data.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { HEX_CATALOG } from '../shared/hexCatalog.js';
import { applyHexEffect } from '../server/match/hexEffects.js';

function fixture() {
  const log = { warn() {}, error() {} };
  const match = new Match({ mode: 'coop', difficulty: 'FUNNY', seed: 7, scheduler: new VirtualScheduler(),
    seats: [{ seat: 0, playerId: 'p1', name: '一', connected: true }],
    data: getVersionData('act3autochess@V3_1', { log }), send() {}, broadcast() {}, onEnd() {} });
  match.disabledBonds = [];
  match.staticInactiveBonds = [];
  return { match, ps: match.players.get('p1') };
}
const card = name => HEX_CATALOG.find(c => c.name === name);

test('聚合海克斯激活第一档而不虚增实际人数', () => {
  const { match, ps } = fixture();
  try {
    ps.hexPicks = [{ name: '愈合于铿锵战火' }];
    for (const count of [0, 2, 3, 5, 6]) {
      ps.bondCountBonus.docShip = count;
      ps.recompute();
      assert.equal(ps.bonds.docShip.count, count);
      assert.equal(ps.bonds.docShip.tier, count >= 6 ? 3 : count >= 3 ? 2 : 1);
      assert.equal(ps.bonds.docShip.active, true);
    }
    assert.equal(applyHexEffect(match, ps, card('愈合于铿锵战火')).status, 'applied');
    for (const ban of ['docShip', '聚合']) {
      match.disabledBonds = [ban];
      ps.recompute();
      assert.equal(ps.bonds.docShip.active, false);
      assert.equal(ps.bonds.docShip.tier, 0);
      assert.equal(applyHexEffect(match, ps, card('愈合于铿锵战火')).reason, 'bond-disabled-or-missing');
    }
  } finally { match.dispose(); }
});

test('不再孤独从库存获取不超过调度等级的独行干员', () => {
  const { match, ps } = fixture();
  try {
    match.gd.modeInactiveBonds.delete('soloShip');
    ps.shop.level = 6;
    const before = match.pool.totalLeft();
    const result = applyHexEffect(match, ps, card('不再孤独'));
    assert.equal(result.status, 'applied');
    assert.equal(result.granted.length, 1);
    const chess = ps.gd.chess(result.granted[0]);
    assert.ok(chess.bonds.includes('soloShip'));
    assert.ok(chess.tier <= ps.shop.level);
    assert.equal(match.pool.totalLeft(), before - 1);
    match.disabledBonds = ['soloShip'];
    assert.equal(applyHexEffect(match, ps, card('不再孤独')).reason, 'bond-disabled-or-missing');
  } finally { match.dispose(); }
});

test('屠宰与手术从真实库存获取两名不超过调度等级的精准干员', () => {
  const { match, ps } = fixture();
  try {
    match.bondChoice = null;
    ps.shop.level = 2;
    const before = match.pool.totalLeft();
    const result = applyHexEffect(match, ps, card('屠宰与手术'));
    assert.equal(result.status, 'applied');
    assert.equal(result.granted.length, 2);
    for (const id of result.granted) {
      const chess = ps.gd.chess(id);
      assert.ok(chess.bonds.includes('preciShip'));
      assert.ok(chess.tier <= ps.shop.level);
    }
    assert.equal(match.pool.totalLeft(), before - 2);
    assert.equal(ps.round.gainedChess, 2);
  } finally { match.dispose(); }
});

test('精准库存不足时不透支，按实际获取数量报告', () => {
  const { match, ps } = fixture();
  try {
    match.bondChoice = null;
    ps.shop.level = 6;
    const eligible = [...match.pool.entries.keys()].filter(id => ps.gd.chess(id).bonds.includes('preciShip') && !match.chessExcluded(ps.gd.chess(id)));
    assert.ok(eligible.length > 0);
    for (const id of eligible) match.pool.take(id, match.pool.left(id));
    match.pool.give(eligible[0], 1);
    const before = match.pool.totalLeft();
    const result = applyHexEffect(match, ps, card('屠宰与手术'));
    assert.deepEqual(result, { status: 'partial', granted: [eligible[0]], reason: 'no-eligible-chess' });
    assert.equal(match.pool.totalLeft(), before - 1);
    assert.equal(match.pool.left(eligible[0]), 0);
    assert.deepEqual(applyHexEffect(match, ps, card('屠宰与手术')), {
      status: 'partial', granted: [], reason: 'no-eligible-chess',
    });
  } finally { match.dispose(); }
});

test('精准盟约禁用时不获取干员', () => {
  const { match, ps } = fixture();
  try {
    const before = match.pool.totalLeft();
    for (const ban of ['preciShip', '精准']) {
      match.disabledBonds = [ban];
      assert.deepEqual(applyHexEffect(match, ps, card('屠宰与手术')), {
        status: 'partial', granted: [], reason: 'bond-disabled-or-missing',
      });
    }
    match.disabledBonds = [];
    match.staticInactiveBonds = ['preciShip'];
    assert.equal(applyHexEffect(match, ps, card('屠宰与手术')).reason, 'bond-disabled-or-missing');
    assert.equal(match.pool.totalLeft(), before);
  } finally { match.dispose(); }
});
