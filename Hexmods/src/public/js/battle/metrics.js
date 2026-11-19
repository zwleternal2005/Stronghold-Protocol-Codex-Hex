// 只读结算统计：不保存事件历史，不改写模拟方法或玩法数据。
export const DAMAGE_TYPES = Object.freeze(['phys', 'arts', 'true', 'elemental']);
const positive = (n) => Number.isFinite(n) && n > 0 ? n : 0;
const collectors = new WeakMap();

function operatorOf(source) {
  const seen = new Set();
  while (source && source.kind === 'token' && source.ownerUnit && !seen.has(source)) {
    seen.add(source);
    source = source.ownerUnit;
  }
  return source?.side === 'ally' && source.ownerId != null && (source.kind === 'op' || source.kind === 'token') ? source : null;
}

/** 在首个 tick（包括静默追帧）前安装；同一战斗重复安装共用采集器。 */
export function trackCombat(battle) {
  if (collectors.has(battle)) return collectors.get(battle);
  const rows = new Map();
  function rowOf(source) {
    const u = operatorOf(source);
    if (!u) return null;
    const key = JSON.stringify([u.ownerId, u.uid != null ? `uid:${u.uid}` : `unit:${u.id}:${u.defId}`]);
    if (!rows.has(key)) rows.set(key, {
      key, ownerId: u.ownerId, uid: u.uid, defId: u.defId, name: u.name, kind: u.kind,
      picture: { charId: u.def?.charId, isGolden: !!u.def?.golden, assets: { avatar: u.def?.avatar ?? u.def?.charId } },
      damage: 0, healing: 0, taken: 0, types: Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])),
    });
    return rows.get(key);
  }
  for (const u of battle.allyUnits || []) rowOf(u);
  // 每次结算直接读取实际 HP 变化，避免嵌套反伤/治疗混入累计差值；元素条和恢复生命不计入。
  const hook = battle.on('hpChanged', ({ source, credit, target, kind, dmg, hpRemoved, delta }) => {
    if (delta < 0) {
      const actual = positive(hpRemoved ?? -delta);
      const victim = rowOf(target);
      if (victim) victim.taken += actual;
      const src = credit === undefined ? source : credit;
      const row = src?.side !== target?.side ? rowOf(src) : null;
      if (row) {
        row.damage += actual;
        row.types[DAMAGE_TYPES.includes(dmg?.type) ? dmg.type : 'true'] += actual;
      }
    } else if (target?.side === 'ally' && (kind === 'heal' || kind === 'regen')) {
      const row = rowOf(source);
      if (row) row.healing += positive(delta);
    }
  }, { priority: Number.MAX_VALUE });
  let stopped = false;
  const read = () => ({
    seconds: positive(battle.time), complete: !!battle.finished,
    owners: (battle.players || []).map((p) => p.playerId),
    rows: [...rows.values()].map((r) => ({ ...r, types: { ...r.types } })),
  });
  read.stop = () => {
    if (stopped) return;
    stopped = true;
    battle.off(hook);
    collectors.delete(battle);
  };
  collectors.set(battle, read);
  return read;
}

/** 调用方按 battleId 替换快照，切场/重播不叠加同一场战斗。 */
export function combineCombat(records, ownerId = null) {
  const rows = new Map();
  const elapsed = new Map();
  let unsupported = false;
  for (const record of records) {
    if (record.unsupported && (ownerId == null || record.owners?.includes(ownerId))) unsupported = true;
    const owners = new Set((record.owners || []).filter((id) => ownerId == null || id === ownerId));
    for (const r of record.rows) {
      if (ownerId != null && r.ownerId !== ownerId) continue;
      owners.add(r.ownerId);
      const key = JSON.stringify([r.ownerId, r.kind, r.name || r.defId]);
      let row = rows.get(key);
      if (!row) {
        row = { ...r, key, damage: 0, healing: 0, taken: 0, types: Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) };
        rows.set(key, row);
      }
      Object.assign(row, { defId: r.defId, name: r.name, kind: r.kind, picture: r.picture });
      row.damage += positive(r.damage);
      row.healing += positive(r.healing);
      row.taken += positive(r.taken);
      for (const t of DAMAGE_TYPES) row.types[t] += positive(r.types?.[t]);
    }
    for (const owner of owners) elapsed.set(owner, (elapsed.get(owner) || 0) + positive(record.seconds));
  }
  const list = [...rows.values()].map((r) => {
    const seconds = elapsed.get(r.ownerId) || 0;
    return { ...r, seconds };
  }).sort((a, b) => b.damage - a.damage || b.healing - a.healing || a.key.localeCompare(b.key));
  return {
    rows: list, unsupported, damage: list.reduce((n, r) => n + r.damage, 0),
    healing: list.reduce((n, r) => n + r.healing, 0), taken: list.reduce((n, r) => n + r.taken, 0),
  };
}
