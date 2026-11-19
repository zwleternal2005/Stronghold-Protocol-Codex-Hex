import test from 'node:test';
import assert from 'node:assert/strict';
import { liveLayersUncapped, withLiveLayers, screenStrip, playerBonds, popupView } from '../public/js/ui/watchBonds.js';

test('live layer setting prefers the battle spec and falls back to room settings', () => {
  assert.equal(liveLayersUncapped({ flags: { bondLayerUncap: false } }, { bondLayerUncap: true }), false);
  assert.equal(liveLayersUncapped({ flags: { bondLayerUncap: true } }, { bondLayerUncap: false }), true);
  assert.equal(liveLayersUncapped({}, { bondLayerUncap: true }), false);
  assert.equal(liveLayersUncapped(null, { bondLayerUncap: true }), true);
  assert.equal(liveLayersUncapped(null, null), false);
});

test('live overlays honor the cap for existing and newly discovered bonds', () => {
  const bonds = [{ bondId: 'a', layers: 100 }];
  const live = { a: 12345, b: 15000 };
  assert.deepEqual(withLiveLayers(bonds, live).map(b => b.layers), [999, 999]);
  assert.deepEqual(withLiveLayers(bonds, live, true).map(b => b.layers), [12345, 15000]);
  assert.deepEqual(bonds, [{ bondId: 'a', layers: 100 }]);
  const settled = [{ bondId: 'a', layers: 16000 }];
  assert.strictEqual(withLiveLayers(settled, live, true)[0], settled[0]);
  assert.strictEqual(withLiveLayers(bonds, null, true), bonds);
});

test('watched strip, detail and popup share the same live layer setting', () => {
  const pub = { players: [{ playerId: 'me', bonds: [] }, { playerId: 'ally', name: 'Ally', bonds: [{ bondId: 'a', layers: 100 }] }] };
  const live = { ally: { a: 12345 } };
  for (const uncap of [false, true]) {
    const expected = uncap ? 12345 : 999;
    const strip = screenStrip({ pub, myId: 'me', combat: true, watchingOther: true, watching: 'n:ally', bondLayers: live, uncap });
    assert.equal(strip.ownerId, 'ally');
    assert.equal(strip.bonds[0].layers, expected);
    assert.equal(playerBonds({ pub, myId: 'me', ownerId: 'ally', live, uncap })[0].layers, expected);
    assert.equal(popupView({ open: { id: 'a', ownerId: 'ally' }, pub, myId: 'me', live, uncap }).entry.layers, expected);
    assert.equal(screenStrip({ pub, myId: 'me', settle: true, battleFieldId: 'n:ally', bondLayers: live, uncap }).bonds[0].layers, expected);
  }
  assert.equal(screenStrip({ pub, myId: 'me', watchingOther: true, watching: 'n:ally', bondLayers: live, uncap: true }).bonds[0].layers, 100);
});
