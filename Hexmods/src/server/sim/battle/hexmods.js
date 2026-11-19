// server/sim/battle/hexmods.js — v0.1.3 新增海克斯的战斗内效果。
//
// 生效范围（用户 2026-11-17 确认）：海克斯只作用于持有者自己的战斗。这里的每个效果都从
// `unit.player.input.hexPicks` 读取（该玩家自己的选择），联合 / 联防的继承状态走 run 外的
// `carryState`。深海倾灭另外检查 kind === 'normal' 与玩家 hexDeepSeaEnabled，隔离永久成长和转化。
//
// 开场类在 battleStart 统一结算（需要全队列信息：干员数、相邻、玩家生命）；持续类挂在
// hpChanged / skillStart / attack / tick 上。深海倾灭通过 battleEnd 只输出本场持久增量。
import * as S from '../content/support/index.js';

const OP = 'op';
const ALLY = 'ally';
const LONG = 1e9; // 「持续本场」用的等价无限时长（避免 Infinity 参与时长运算）

function picksOf(unit) {
  return unit?.player?.input?.hexPicks || [];
}

function has(unit, name) {
  return picksOf(unit).includes(name);
}

function itemsOf(unit) {
  return Array.isArray(unit?.items) ? unit.items : [];
}

function isOwnOp(unit) {
  return !!unit && unit.kind === OP && unit.side === ALLY && !!unit.player;
}

/** 四向相邻的**同一玩家**干员（「你的干员」口径；与原版「周围四格」一致）。 */
function neighbours(battle, unit) {
  const out = [];
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const other = battle.unitAt(unit.tileR + dr, unit.tileC + dc);
    if (other && other.side === ALLY && other.kind === OP && other.player === unit.player) out.push(other);
  }
  return out;
}

/** 主目标周围 8 格里离施法者最近的另一个敌人。 */
function adjacentEnemy(battle, primary, source) {
  let best = null;
  let bestDist = Infinity;
  for (const enemy of battle.aliveEnemies()) {
    if (enemy === primary || !enemy.alive) continue;
    const dr = Math.abs(enemy.tileR - primary.tileR);
    const dc = Math.abs(enemy.tileC - primary.tileC);
    if (Math.max(dr, dc) !== 1) continue;
    const dist = Math.abs(enemy.x - source.x) + Math.abs(enemy.y - source.y);
    if (dist < bestDist) { bestDist = dist; best = enemy; }
  }
  return best;
}

/** 开场类：空装上阵 / 结阵 / 海克斯装备集成 / 少而精 / 背水一战 / 名刀司命 / 备用电容。 */
export function applyOpeningHexes(battle) {
  const byPlayer = new Map();
  for (const unit of battle.allyUnits) {
    if (!isOwnOp(unit)) continue;
    const list = byPlayer.get(unit.player.playerId);
    if (list) list.push(unit); else byPlayer.set(unit.player.playerId, [unit]);
  }
  for (const ops of byPlayer.values()) {
    for (const unit of ops) {
      const picks = picksOf(unit);
      if (!picks.length) continue;
      // 空装上阵：未携带任何装备
      if (picks.includes('空装上阵') && itemsOf(unit).length === 0) {
        battle.addBuff(unit, { key: 'hex:bareGear', persist: true, allowDead: true, mods: { atkPct: 0.10, hpPct: 0.10 } });
      }
      // 结阵：每个相邻干员给一份（文案未设上限）
      if (picks.includes('结阵')) {
        const n = neighbours(battle, unit).length;
        if (n > 0) {
          battle.addBuff(unit, { key: 'hex:formation', persist: true, allowDead: true,
            mods: { hpFlat: 500 * n, defPct: 0.10 * n } });
        }
      }
      // 海克斯装备集成：至少 2 件装备
      if (picks.includes('海克斯装备集成') && itemsOf(unit).length >= 2) {
        battle.addBuff(unit, { key: 'hex:gearSet', persist: true, allowDead: true, mods: { atkPct: 0.20, hpPct: 0.15 } });
      }
      // 名刀司命！：全体干员 80% 全属性（攻击 / 防御 / 生命 / 法抗）。整局常驻——
      // 选卡后每场战斗开场都会重新应用，不是只生效一次。
      if (picks.includes('名刀司命！')) {
        battle.addBuff(unit, { key: 'hex:lastStand', persist: true, allowDead: true,
          mods: { atkPct: 0.80, defPct: 0.80, hpPct: 0.80, resMul: 1.8 } });
      }
      // 魔王冠冕：干员 +1 阻挡，并按当前总加成（50% 起，完美 +1% / 非完美 −2%，下限 15%）
      // 提升攻击、防御、最大生命与法抗。加成在结算时更新，每场开场重新应用；此处再夹一次下限做双保险。
      const crownRaw = Number(unit.player?.input?.hexCrown);
      if (Number.isFinite(crownRaw) && crownRaw > 0) {
        const pct = Math.max(15, crownRaw) / 100;
        battle.addBuff(unit, { key: 'hex:crown', persist: true, allowDead: true,
          mods: { atkPct: pct, defPct: pct, hpPct: pct, resMul: 1 + pct, blockCnt: 1 } });
      }
      // 备用电容：开场 6 点技力（gainSp 自身把溢出转成充能，不越过技力上限）
      if (picks.includes('备用电容') && unit.skill && !unit.skill.noSkill) unit.skill.gainSp(6, 'hex', true);
    }
    const lead = ops[0];
    const picks = picksOf(lead);
    // 少而精：该玩家的干员不超过 5 名（不含召唤物、装置）
    if (ops.length > 0 && ops.length <= 5 && picks.includes('少而精')) {
      for (const unit of ops) {
        battle.addBuff(unit, { key: 'hex:fewElite', persist: true, allowDead: true,
          mods: { atkPct: 0.80, hpPct: 0.80, aspd: 20 } });
      }
    }
    // 背水一战：玩家生命不高于本局初始生命 50%
    const input = lead.player?.input;
    const lp = Number(input?.lp);
    const startLp = Number(input?.startLp);
    if (picks.includes('背水一战') && Number.isFinite(lp) && Number.isFinite(startLp)
      && startLp > 0 && lp <= startLp * 0.5) {
      for (const unit of ops) {
        battle.addBuff(unit, { key: 'hex:lastDitch', persist: true, allowDead: true, mods: { atkPct: 0.25, hpPct: 0.25 } });
      }
    }
  }
}

/** 热身完毕：开战 12 秒时仍存活的干员获得 15 点攻速。 */
function onWarmupTick(battle) {
  if (battle._hexWarmupDone || battle.time < 12) return;
  battle._hexWarmupDone = true;
  for (const unit of battle.allyUnits) {
    if (!unit.alive || !unit.deployed || !has(unit, '热身完毕')) continue;
    battle.addBuff(unit, { key: 'hex:warmup', persist: true, mods: { aspd: 15 } });
  }
}

/** 坚定风采（两档）：每名干员每场一次，生命首次低于 30% 时回复并（金版）短暂减伤。 */
function onFirmHpChanged(battle, ctx) {
  const unit = ctx.target;
  if (!isOwnOp(unit) || !unit.alive) return;
  if (unit._hexFirmUsed) return;
  const gold = has(unit, '坚定风采+');
  if (!gold && !has(unit, '坚定风采')) return;
  const maxHp = unit.s.maxHp;
  if (!(maxHp > 0) || unit.hp / maxHp >= 0.30) return;
  unit._hexFirmUsed = true;
  battle.heal({ source: unit, target: unit, amount: maxHp * (gold ? 0.80 : 0.50), mode: 'restore' });
  if (gold) battle.addBuff(unit, { key: 'hex:firmPlus', duration: 3, mods: { dmgTakenMul: 0.8 }, visible: true });
}

/** 技力传递：施法者开技时，给同队一名未开技、技力充满比例最低的干员 +5 技力。 */
function transferSp(battle, caster) {
  const playerId = caster.player?.playerId;
  if (playerId == null) return;
  let best = null;
  let bestRatio = Infinity;
  for (const unit of battle.allyUnits) {
    if (unit === caster || !isOwnOp(unit) || !unit.alive || !unit.deployed) continue;
    if (unit.player.playerId !== playerId) continue;
    const skill = unit.skill;
    if (!skill || skill.noSkill || skill.active || skill.kind === 'passive') continue;
    const cost = skill.spCost || 0;
    if (!(cost > 0)) continue;
    const ratio = (skill.sp || 0) / cost;
    if (ratio < bestRatio) { bestRatio = ratio; best = unit; }
  }
  if (best) best.skill.gainSp(5, 'hex');
}

/** 余音护航 / 引火成书 / 技力传递：释放技能时。 */
function onSkillStart(battle, ctx) {
  const unit = ctx.unit;
  if (!isOwnOp(unit)) return;
  // 余音护航：护盾 = 该技能的技力条（满条值）× 100，可叠加，持续到战斗结束
  if (has(unit, '余音护航') && unit.skill) {
    const amount = Math.round((unit.skill.spCost || 0) * 100);
    if (amount > 0) {
      const held = unit.findBuff('hex:echoShield');
      battle.addBuff(unit, { key: 'hex:echoShield', shield: (held?.shield || 0) + amount,
        duration: LONG, visible: true, refresh: 'replace' });
    }
  }
  // 引火成书：炎已激活时，每名炎干员本场首次主动开技 +5 层
  if (has(unit, '引火成书') && !unit._hexEmberUsed && (unit.def?.bonds || []).includes('yanShip')
    && unit.player.bonds?.yanShip?.active) {
    unit._hexEmberUsed = true;
    battle.addLayers(unit.player.playerId, 'yanShip', 5, 'hex');
  }
  if (has(unit, '技力传递')) transferSp(battle, unit);
}

/** 第四艺术：每第 4 次对敌普攻，主目标与相邻另一敌人各受 120% 攻击法术伤害。 */
function onAttack(battle, ctx) {
  if (ctx.isSkill) return;
  const unit = ctx.attacker;
  if (!isOwnOp(unit)) return;
  if (!has(unit, '第四艺术')) return;
  const count = (unit._hexArtCount = (unit._hexArtCount || 0) + 1);
  if (count % 4 !== 0) return;
  const primary = Array.isArray(ctx.targets) ? ctx.targets[0] : null;
  if (!primary || !primary.alive) return;
  const targets = [primary, adjacentEnemy(battle, primary, unit)].filter(t => t && t.alive);
  for (const target of targets) {
    battle.dealDamage({ source: unit, credit: unit, target, amount: unit.s.atk * 1.2, type: 'arts',
      attackType: 'ADDITION', applyWay: 'NONE', calculation: 'precomputed', dodgeMode: 'ignore',
      tags: ['hex:fourthArt'] });
  }
}

const DEEP_SEA_STATS = ['hp', 'atk', 'def', 'res'];
const deepSeaNumber = v => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, v)) : 0;
export const hexDeepSeaEnabled = (battle, player) => battle.kind === 'normal' && player?.input?.hexDeepSeaEnabled === true;

/** 只接收真实输入棋子的身份；召唤物及临时生成的干员不创造可持久棋子。 */
export function applyHexDeepSeaUnit(battle, unit, input) {
  if (!isOwnOp(unit) || !hexDeepSeaEnabled(battle, unit.player)) return;
  const stats = Object.fromEntries(DEEP_SEA_STATS.map(k => [k, deepSeaNumber(input.hexDeepSea?.stats?.[k])]));
  unit.hexDeepSea = { stats, ...(input.hexDeepSea?.egir === true ? { egir: true } : {}) };
  unit._hexDeepSeaInitialStats = { ...stats };
  unit._hexDeepSeaPiece = input.uid != null;
  applyDeepSeaStats(battle, unit);
}

function applyDeepSeaStats(battle, unit) {
  const s = unit.hexDeepSea.stats;
  if (DEEP_SEA_STATS.some(k => s[k] > 0)) S.passiveBuff(battle, unit, 'hex:deepSea:stats', {
    hpFlat: s.hp, atkFlat: s.atk, defFlat: s.def, resFlat: s.res,
  });
}

function deepSeaBases(battle, player) {
  return new Set(player.units.filter(u => u._hexDeepSeaPiece && u.commandReserveFor == null
    && S.unitBonds(u).includes('egirShip')).map(S.baseChessId));
}

/** 保留输入的人数加成与调和；只把新出现的不同 baseId 追加到人数。倒地不减少编队人数。 */
function refreshDeepSeaCount(battle, player) {
  const state = player.bonds?.egirShip, initial = player._hexDeepSeaCount;
  if (!state || !initial) return;
  const bases = deepSeaBases(battle, player);
  const added = [...bases].filter(id => !initial.bases.has(id)).length;
  const harmony = initial.bases.size === 0 && bases.size > 0 && S.bondActive(battle, player.playerId, 'maniShip') ? 1 : 0;
  state.count = deepSeaNumber(initial.count + added + harmony);
  const thresholds = Array.isArray(state.thresholds) && state.thresholds.length ? state.thresholds : [3, 6, 9, 12];
  state.tier = thresholds.filter(n => Number.isFinite(n) && state.count >= n).length;
  state.active = state.tier > 0;
}

function deepSeaGainEntry(battle, unit) {
  if (!unit._hexDeepSeaPiece || !hexDeepSeaEnabled(battle, unit.player)) return null;
  let byUid = battle._hexDeepSeaGains.get(unit.ownerId);
  if (!byUid) battle._hexDeepSeaGains.set(unit.ownerId, (byUid = new Map()));
  let entry = byUid.get(unit.uid);
  if (!entry) byUid.set(unit.uid, (entry = { uid: unit.uid }));
  return entry;
}

function onDeepSeaDeath(battle, ctx) {
  const killer = ctx.killer, victim = ctx.unit;
  // death 是实际击倒：fatal/kill 救回不会到这里；death 复活不撤销本次击倒。
  if (ctx.reason !== 'killed' || !victim || !isOwnOp(killer) || !hexDeepSeaEnabled(battle, killer.player)) return;
  const state = killer.player.bonds?.egirShip;
  if (!state?.active || state.count < 9 || !S.isMember(battle, killer, 'egirShip')) return;
  // 先锁定本次击倒前的档位，转化凑足 12 人只影响后续击倒。
  const absorb = state.count >= 12;
  if (victim.kind === OP && !S.unitBonds(victim).includes('egirShip')) {
    victim.hexDeepSea ??= { stats: Object.fromEntries(DEEP_SEA_STATS.map(k => [k, 0])) };
    victim.hexDeepSea.egir = true;
    const entry = deepSeaGainEntry(battle, victim);
    if (entry) entry.egir = true;
    if (hexDeepSeaEnabled(battle, victim.player)) {
      refreshDeepSeaCount(battle, victim.player);
      battle.emit('hexDeepSeaMembers', { playerId: victim.ownerId });
    }
  }
  if (!absorb || !ctx.stats) return;
  killer.hexDeepSea ??= { stats: Object.fromEntries(DEEP_SEA_STATS.map(k => [k, 0])) };
  const stats = killer.hexDeepSea.stats;
  let changed = false;
  for (const k of DEEP_SEA_STATS) {
    const gain = deepSeaNumber(ctx.stats[k === 'hp' ? 'maxHp' : k] * 0.01);
    const total = deepSeaNumber(stats[k] + gain);
    if (total > stats[k]) { stats[k] = total; changed = true; }
  }
  if (!changed) return;
  applyDeepSeaStats(battle, killer);
  // 立即重算，后续 death 钩子与同一吞噬链都能使用成长后的属性。
  void killer.s;
  const entry = deepSeaGainEntry(battle, killer);
  if (entry) entry.stats = Object.fromEntries(DEEP_SEA_STATS.map(k => [k,
    deepSeaNumber(stats[k] - (killer._hexDeepSeaInitialStats?.[k] ?? 0)),
  ]));
}

/** 每个玩家输入完成后初始化，早于盟约安装；不依赖海克斯的展示名或 coop 模式。 */
export function initHexDeepSeaPlayer(battle, player) {
  if (!hexDeepSeaEnabled(battle, player)) return;
  const bases = deepSeaBases(battle, player);
  player._hexDeepSeaCount = { bases, count: deepSeaNumber(player.bonds?.egirShip?.count ?? bases.size) };
  if (battle._hexDeepSeaGains) return;
  battle._hexDeepSeaGains = new Map();
  battle.on('death', ctx => onDeepSeaDeath(battle, ctx), { priority: 100 });
  battle.on('deploy', ({ unit }) => {
    if (!isOwnOp(unit) || !hexDeepSeaEnabled(battle, unit.player)) return;
    refreshDeepSeaCount(battle, unit.player);
    battle.emit('hexDeepSeaMembers', { playerId: unit.ownerId });
  }, { priority: 100 });
  battle.on('battleEnd', ({ result }) => {
    const gains = Object.create(null);
    for (const [pid, byUid] of battle._hexDeepSeaGains) {
      if (!hexDeepSeaEnabled(battle, battle.getPlayer(pid))) continue;
      const entries = [...byUid.values()].filter(e => e.egir || DEEP_SEA_STATS.some(k => e.stats?.[k] > 0));
      if (entries.length) gains[pid] = entries.map(e => ({ ...e, ...(e.stats ? { stats: { ...e.stats } } : {}) }));
    }
    result.hexDeepSeaGains = gains;
  });
}

/** v0.1.3 会在战斗内注册钩子的卡名；没有它就不安装，未选卡的对局保持原执行路径。 */
const BATTLE_HEX = new Set([
  '空装上阵', '备用电容', '热身完毕', '结阵', '坚定风采', '坚定风采+', '余音护航',
  '引火成书', '背水一战', '海克斯装备集成', '技力传递', '少而精', '第四艺术', '名刀司命！',
  '魔王冠冕',
]);

/** 在战斗上安装一次；由 _setupUnit 的首次调用触发（早于 battleStart）。 */
export function installHexBattleHooks(battle, picks = []) {
  if (battle._hexHooksInstalled) return;
  if (!picks.some(name => BATTLE_HEX.has(name))) return;
  battle._hexHooksInstalled = true;
  battle.on('battleStart', () => applyOpeningHexes(battle), { priority: -10 });
  battle.on('tick', () => onWarmupTick(battle), { priority: -10 });
  battle.on('hpChanged', (ctx) => onFirmHpChanged(battle, ctx || {}));
  battle.on('skillStart', (ctx) => onSkillStart(battle, ctx || {}));
  battle.on('attack', (ctx) => onAttack(battle, ctx || {}));
}
