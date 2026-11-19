// Presentation of existing strategy counters; content handlers remain their only writers.
export function bandProgressView(ps) {
  const band = ps.bandId ? ps.gd.band(ps.bandId) : null;
  const buff = band?.buffs?.find(b => b.key === 'refresh_shop_count_gain_coin_bond_char_chess');
  if (!buff) return null;
  const params = { ...buff.bb, ...buff.bbStr };
  const positive = n => Number.isFinite(n) && Math.trunc(n) > 0 ? Math.trunc(n) : null;
  const count = n => Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  const total = positive(params.refresh_count), limit = positive(params.max_count);
  if (!total) return null;
  // 回合奖励计数延迟复位，展示读取不能修改判定状态。
  const rewards = ps.counters['band:chiave:r'] === ps.m.round ? count(ps.counters['band:chiave']) : 0;
  const refreshes = ps.gd.config?.version?.family === 'regulation'
    ? count(ps.round?.refreshes) : count(ps.counters['band:chiave:refreshes']);
  const current = refreshes % total;
  return {
    progress: { current, total },
    nextRewardRefreshes: limit && rewards >= limit ? null : total - current,
    ...(limit ? { roundProgress: { current: rewards, total: limit } } : {}),
  };
}
