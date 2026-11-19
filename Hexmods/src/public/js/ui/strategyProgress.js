import { html } from './components.js';
import { t } from '../../../shared/i18n.js';

const label = p => Number.isInteger(p?.current) && p.current >= 0 && Number.isInteger(p.total) && p.total > 0
  ? `${p.current} / ${p.total}` : '';

/** The same read-only progress in the effect badge, tooltip and strategy details. */
export function strategyProgressModel(effect) {
  const progress = label(effect?.progress);
  if (!progress) return null;
  const rewards = label(effect.roundProgress);
  const full = !!rewards && effect.roundProgress.current >= effect.roundProgress.total;
  const remaining = Number.isInteger(effect.nextRewardRefreshes) ? effect.nextRewardRefreshes
    : Math.max(0, effect.progress.total - effect.progress.current);
  const lines = [[t('主动刷新'), progress]];
  if (!full) lines.push([t('距下次赠送'), t('还需 {n} 次刷新', { n: remaining })]);
  if (rewards) lines.push([t('本回合获得'), rewards]);
  return {
    badge: full ? t('本回合已满') : t('还需 {n} 次刷新', { n: remaining }),
    buttonText: full ? t('已满') : String(remaining),
    lines,
  };
}

export function StrategyProgress({ effect }) {
  const model = strategyProgressModel(effect);
  return model ? html`<div class="strategy-progress">${model.lines.map(([name, value]) =>
    html`<p key=${name}>${name} <strong class="num">${value}</strong></p>`)}</div>` : null;
}
