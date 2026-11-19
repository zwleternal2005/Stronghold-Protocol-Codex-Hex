// Global room settings shared by the lobby, Match and BattleSpec.

export const GLOBAL_SETTINGS_DEFAULTS = Object.freeze({
  difficultyMercy: true,
  enemyHpBonus: 0,
  enemyAtkBonus: 0,
  allyHpBonus: 0,
  allyAtkBonus: 0,
  infiniteFunds: false,
  classicAutoChess: false,
  bondLayerUncap: true,
  operatorLayerCapScale: 0,
  hexEnabled: true,
  hexRounds: Object.freeze([1, 5, 9]),
  hexCustomEnabled: false,
  hexRarityWeights: Object.freeze({ silver: 25, gold: 55, prismatic: 20 }),
  hexSelectionSeconds: 15,
});

export const OPERATOR_LAYER_CAP_SCALES = Object.freeze([-2, -1, 0, 1, 2, 3]);

export function operatorLayerCap(base, scale = 0) {
  const n = Number(base);
  if (!(n > 0)) return Infinity;
  if (scale === 3) return Infinity;
  const factor = 1 + (Number.isInteger(scale) ? scale * 0.5 : 0);
  return Math.max(0, Math.floor(n * factor));
}

export const GLOBAL_SETTINGS_KEYS = Object.freeze(Object.keys(GLOBAL_SETTINGS_DEFAULTS));

const isPlain = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isBonus = (value) => Number.isInteger(value) && value >= 0 && value <= 10;

/**
 * Normalize a complete or partial settings object into a frozen, JSON-safe snapshot.
 * Throws RangeError/TypeError when a caller crosses the protocol boundary with bad data.
 */
export function normalizeGlobalSettings(input = {}, { partial = false } = {}) {
  if (!isPlain(input)) throw new TypeError('global settings must be a plain object');
  for (const key of Object.keys(input)) {
    if (!GLOBAL_SETTINGS_KEYS.includes(key)) throw new RangeError(`unknown global setting ${key}`);
  }
  const out = partial ? {} : { ...GLOBAL_SETTINGS_DEFAULTS };
  for (const key of Object.keys(input)) out[key] = input[key];
  if (!partial || Object.hasOwn(out, 'difficultyMercy')) {
    if (typeof out.difficultyMercy !== 'boolean') throw new TypeError('difficultyMercy must be boolean');
  }
  for (const key of ['enemyHpBonus', 'enemyAtkBonus', 'allyHpBonus', 'allyAtkBonus']) {
    if ((!partial || Object.hasOwn(out, key)) && !isBonus(out[key])) throw new RangeError(`${key} must be an integer from 0 to 10`);
  }
  for (const key of ['infiniteFunds', 'classicAutoChess', 'bondLayerUncap', 'hexEnabled', 'hexCustomEnabled']) {
    if ((!partial || Object.hasOwn(out, key)) && typeof out[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  }
  if ((!partial || Object.hasOwn(out, 'operatorLayerCapScale')) && !OPERATOR_LAYER_CAP_SCALES.includes(out.operatorLayerCapScale)) {
    throw new RangeError('operatorLayerCapScale must be one of -2,-1,0,1,2,3');
  }
  if (!partial || Object.hasOwn(out, 'hexRounds')) {
    const rounds = out.hexRounds;
    if (!Array.isArray(rounds) || Array.from(rounds).some((n) => !Number.isInteger(n) || n < 1 || n > 14)
      || new Set(rounds).size !== rounds.length) throw new RangeError('hexRounds must contain unique integers from 1 to 14');
    out.hexRounds = Object.freeze([...rounds].sort((a, b) => a - b));
  }
  if (!partial || Object.hasOwn(out, 'hexRarityWeights')) {
    const weights = out.hexRarityWeights;
    const keys = ['silver', 'gold', 'prismatic'];
    if (!isPlain(weights) || Object.keys(weights).length !== keys.length
      || keys.some((key) => !Object.hasOwn(weights, key) || !Number.isInteger(weights[key]) || weights[key] < 0 || weights[key] > 100)
      || keys.reduce((sum, key) => sum + weights[key], 0) !== 100) {
      throw new RangeError('hexRarityWeights must contain silver, gold and prismatic integers totaling 100');
    }
    out.hexRarityWeights = Object.freeze({ silver: weights.silver, gold: weights.gold, prismatic: weights.prismatic });
  }
  if ((!partial || Object.hasOwn(out, 'hexSelectionSeconds'))
    && (!Number.isInteger(out.hexSelectionSeconds) || out.hexSelectionSeconds < 1 || out.hexSelectionSeconds > 60)) {
    throw new RangeError('hexSelectionSeconds must be an integer from 1 to 60');
  }
  return Object.freeze(out);
}

/** Strict structural check for the room.setGlobalSettings patch. */
export function isGlobalSettingsPatch(value) {
  if (!isPlain(value) || Object.keys(value).length === 0) return false;
  try {
    normalizeGlobalSettings(value, { partial: true });
    return true;
  } catch {
    return false;
  }
}

export function enemyGlobalScale(settings) {
  const s = normalizeGlobalSettings(settings);
  const mercy = s.difficultyMercy ? 0.7 : 1;
  return Object.freeze({
    hpMul: mercy * (1 + s.enemyHpBonus / 10),
    atkMul: mercy * (1 + s.enemyAtkBonus / 10),
  });
}

export function allyGlobalScale(settings) {
  const s = normalizeGlobalSettings(settings);
  return Object.freeze({
    hpMul: 1 + s.allyHpBonus / 10,
    atkMul: 1 + s.allyAtkBonus / 10,
  });
}

/** Apply the authoritative ally/enemy scales to a Battle option snapshot. */
export function applyGlobalBattleScales(options, settings) {
  const s = normalizeGlobalSettings(settings);
  const enemy = enemyGlobalScale(s);
  const ally = allyGlobalScale(settings);
  const mul = (value, factor, fallback = 1) => (Number.isFinite(value) ? value : fallback) * factor;
  const players = Array.isArray(options?.players) ? options.players.map((player) => ({
    ...player,
    units: Array.isArray(player?.units) ? player.units.map((unit) => ({
      ...unit,
      mods: { ...(unit.mods || {}), hpMul: mul(unit.mods?.hpMul, ally.hpMul), atkMul: mul(unit.mods?.atkMul, ally.atkMul) },
    })) : player?.units,
  })) : options?.players;
  const spawns = Array.isArray(options?.spawns) ? options.spawns.map((spawn) => ({
    ...spawn,
    mods: { ...(spawn.mods || {}), hpMul: mul(spawn.mods?.hpMul, enemy.hpMul), atkMul: mul(spawn.mods?.atkMul, enemy.atkMul) },
  })) : options?.spawns;
  const current = options?.flags?.enemyScale;
  const enemyScale = {
    ...(current && typeof current === 'object' ? current : {}),
    hpMul: mul(current?.hpMul, enemy.hpMul),
    atkMul: mul(current?.atkMul, enemy.atkMul),
  };
  return { ...options, players, spawns, flags: {
    ...(options?.flags || {}),
    enemyScale,
    bondLayerUncap: s.bondLayerUncap === true,
    operatorLayerCapScale: s.operatorLayerCapScale,
  } };
}
