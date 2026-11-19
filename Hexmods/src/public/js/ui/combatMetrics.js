import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, useTicker } from './components.js';
import { UnitThumb } from './gameComponents.js';
import { battleRunner } from '../battle/runner.js';
import { t, N_ } from '../../../shared/i18n.js';
import { combatMetricsLayout } from './combatMetricsLayout.js';

const TYPES = Object.freeze([
  { id: 'phys', label: N_('物理') }, { id: 'arts', label: N_('法术') },
  { id: 'true', label: N_('真实') }, { id: 'elemental', label: N_('元素') },
]);
const number = (n) => Math.round(n || 0).toLocaleString('zh-CN');
const METRICS = Object.freeze([
  { id: 'damage', label: N_('伤害'), total: N_('总伤害') },
  { id: 'healing', label: N_('治疗'), total: N_('总治疗') },
  { id: 'taken', label: N_('承伤'), total: N_('总承伤') },
]);

/** A modeless panel: the battlefield stays visible and keeps playing. Mounted only while open. */
export function CombatMetricsPanel({ myId, onClose, runner = battleRunner }) {
  const [scope, setScope] = useState('battle');
  const [metric, setMetric] = useState('damage');
  const closeRef = useRef(null);
  const panelRef = useRef(null);
  useTicker(250);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.modal, .guide')) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const corner = panel?.parentElement;
    const viewport = window.visualViewport;
    const measure = () => {
      if (!panel || !corner) return;
      const rect = corner.getBoundingClientRect();
      const rootStyle = getComputedStyle(document.documentElement);
      const layout = combatMetricsLayout({
        cornerTop: rect.top, cornerBottom: rect.bottom,
        viewportHeight: viewport?.height || window.innerHeight,
        viewportTop: viewport?.offsetTop || 0,
        rem: parseFloat(rootStyle.fontSize) || 40,
        safeTop: parseFloat(rootStyle.getPropertyValue('--sa-t')) || 0,
        safeBottom: parseFloat(rootStyle.getPropertyValue('--sa-b')) || 0,
      });
      panel.style.setProperty('--combat-corner-height', `${rect.height || 44}px`);
      panel.style.setProperty('--combat-available-height', `${layout.availableHeight}px`);
      panel.style.setProperty('--combat-viewport-height', `${layout.viewportSpace}px`);
      panel.style.setProperty('--combat-viewport-top', `${layout.viewportPanelTop}px`);
      panel.dataset.viewportDocked = String(layout.viewportDocked);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (corner) observer?.observe(corner);
    window.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  }, []);
  const result = (myId != null ? runner?.combatMetrics({ scope, ownerId: myId }) : null) || { rows: [], damage: 0, healing: 0, taken: 0 };
  const selected = METRICS.find((m) => m.id === metric);
  const rows = [...result.rows].sort((a, b) => (b[metric] || 0) - (a[metric] || 0) || a.key.localeCompare(b.key));
  const maximum = Math.max(1, ...rows.map((r) => r[metric] || 0));
  return html`<section ref=${panelRef} id="combat-metrics-panel" class="combat-metrics brackets" role="dialog" aria-label=${t('作战统计')}
      onKeyDown=${(e) => { if (e.key === 'Escape') onClose(); e.stopPropagation(); }}>
    <header class="combat-metrics__head">
      <div><span class="combat-metrics__micro">COMBAT ANALYSIS</span><h2>${t('作战统计')}</h2></div>
      <button ref=${closeRef} type="button" class="combat-metrics__close" aria-label=${t('关闭作战统计')} onClick=${onClose}><${Icon} name="close" /></button>
      <div class="combat-metrics__tools">
        <div class="combat-metrics__scopes" role="group" aria-label=${t('统计范围')}>
          ${[['battle', t('当前战斗')], ['match', t('本局累计')], ['last', t('上一场战斗')]].map(([id, label]) => html`<button type="button" key=${id}
            aria-pressed=${scope === id} onClick=${() => setScope(id)}>${label}</button>`)}
        </div>
      </div>
    </header>
    <div class="combat-metrics__body" tabindex="0">
    <div class="combat-metrics__categories" role="group" aria-label=${t('统计项目')}>
      ${METRICS.map((m) => html`<button type="button" key=${m.id} aria-pressed=${metric === m.id}
        onClick=${() => setMetric(m.id)}>${t(m.label)}</button>`)}
    </div>
    ${result.unsupported ? html`<p class="combat-metrics__warning" role="status">${t('统计快照尚未同步；本局累计可能不完整。')}</p>` : null}
    <div class="combat-metrics__totals">
      <span>${t(selected.total)} <b>${result.unsupported && !rows.length ? '—' : number(result[metric])}</b></span>
    </div>
    <div class="combat-metrics__legend" aria-label=${t('排行说明')}>
      ${metric === 'damage' ? TYPES.map((type) => html`<span key=${type.id} class=${`combat-metrics__type combat-metrics__type--${type.id}`}>${t(type.label)}</span>`) : null}
      <span class="combat-metrics__sort">${t(selected.label)} · ${t('总量降序')}</span>
    </div>
    <ol class="combat-metrics__list" tabindex="0" aria-label=${`${t('干员排行')} · ${t(selected.label)}`}>
      ${rows.length ? rows.map((r, i) => {
        const description = metric === 'damage' ? TYPES.map((type) => `${t(type.label)} ${number(r.types[type.id])}`).join('，') : `${t(selected.label)} ${number(r[metric])}`;
        return html`<li key=${r.key} class="combat-metrics__row">
          <span class="combat-metrics__rank">${String(i + 1).padStart(2, '0')}</span>
          <${UnitThumb} kind=${r.kind === 'token' ? 'token' : 'chess'} id=${r.defId} ownerId=${r.ownerId}
            rec=${r.picture?.charId ? { ...r.picture, name: r.name } : null} showTier=${false} size="sm" />
          <div class="combat-metrics__unit">
            <div class="combat-metrics__name"><b title=${r.name}>${r.name || r.defId}</b></div>
            <div class="combat-metrics__bar" role="img" aria-label=${description} title=${description}>
              ${metric === 'damage' ? TYPES.map((type) => html`<span key=${type.id} class=${`combat-metrics__segment combat-metrics__segment--${type.id}`}
                style=${{ width: `${r.types[type.id] / maximum * 100}%` }}></span>`) : html`<span class=${`combat-metrics__segment combat-metrics__segment--${metric}`}
                style=${{ width: `${(r[metric] || 0) / maximum * 100}%` }}></span>`}
            </div>
            <div class="combat-metrics__values">
              <span><small>${t(selected.label)}</small><b>${number(r[metric])}</b></span>
            </div>
          </div>
        </li>`;
      }) : html`<li class="combat-metrics__empty">${result.unsupported ? t('当前范围无可用采集数据') : scope === 'last' ? t('暂无上一场战斗记录') : t('暂无本地战斗记录')}<br /><small>${result.unsupported ? t('等待战斗统计同步') : scope === 'last' ? t('打完一场战斗后显示') : t('开始战斗后实时显示干员数据')}</small></li>`}
    </ol>
    <p class="combat-metrics__note">${t('仅统计自己 · 同名干员合并 · 召唤物计入所属干员')}<br />${t('结算管线内的实际扣血 / 有效治疗 / 承伤（含生命流失）；直接改血不计。刷新后重新累计。')}</p>
    </div>
  </section>`;
}
