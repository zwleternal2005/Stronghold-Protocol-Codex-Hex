// Native offer UI: two-tap confirmation and the choice overlay's responsive cards.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Countdown, Button } from './components.js';
import { GIcon } from './gameComponents.js';
import { spTap } from './choiceOverlay.js';
import { HexIcon, hexIsMythic } from './hexIcon.js';
import { t } from '../../../shared/i18n.js';

export const offerSeat = (offer, myId) => offer?.seats?.find(s => s.playerId === myId) || null;
export const offerPickable = (offer, myId, readOnly, busy) => !readOnly && busy == null && offerSeat(offer, myId)?.picked === false;
export const offerBlocksPrep = offers => !!offers?.some(o => o.quorum !== 'none');
// [ASSUMED] Nonblocking picks auto-collapse; a deliberate reopen can inspect the completed seat.
export function offerVisible(offers, myId, dismissed = [], selected = null) {
  return offers.find(o => o.seq === selected?.seq && offerSeat(o, myId)?.picked === selected.picked)
    || offers.find(o => o.quorum !== 'none')
    || offers.find(o => !dismissed.includes(o.seq) && !offerSeat(o, myId)?.picked)
    || null;
}
const ICONS = { funds: 'sell', layers: 'bolt', item: 'shield', chess: 'rook', refresh: 'refresh' };

export function OfferOverlay({ pub, myId, readOnly = false, onAction }) {
  const [selected, setSelected] = useState(null);
  const [dismissed, setDismissed] = useState([]);
  const [armed, setArmed] = useState(null);
  const [busy, setBusy] = useState(null);
  const root = useRef(null);
  const offers = pub?.offers || [];
  const offer = offerVisible(offers, myId, dismissed, selected);
  const open = o => { setSelected({ seq: o.seq, picked: offerSeat(o, myId)?.picked }); setArmed(null); };
  const dismissible = offer?.quorum === 'none';
  const dismiss = () => {
    if (!dismissible) return;
    setDismissed(ids => [...ids.filter(id => id !== offer.seq && offers.some(o => o.seq === id)), offer.seq]);
    setSelected(null); setArmed(null);
  };
  useEffect(() => { setArmed(null); setBusy(null); }, [offer?.seq]);
  useEffect(() => {
    if (!offer) return;
    const previous = document.activeElement;
    root.current?.focus();
    return () => previous?.focus?.();
  }, [offer?.seq]);
  if (!offer) return html`<${OfferDock} offers=${offers} myId=${myId} onOpen=${open} />`;
  const can = offerPickable(offer, myId, readOnly, busy);
  const act = async (idx, refresh = false) => {
    if (!can || !refresh && offerSeat(offer, myId)?.slots[idx]?.available === false) return;
    const token = `${offer.seq}:${idx}`;
    setArmed(null); setBusy(token);
    try { await onAction(offer, idx, refresh, offerSeat(offer, myId)?.slots[idx]?.id); }
    finally { setBusy(b => b === token ? null : b); }
  };
  const tap = idx => {
    if (offerSeat(offer, myId)?.slots[idx]?.available === false) return;
    const next = spTap(armed, idx, can);
    setArmed(next.armed);
    if (next.pick != null) void act(next.pick);
  };
  const onKeyDown = e => {
    if (e.key === 'Escape') { if (armed == null) dismiss(); setArmed(null); e.stopPropagation(); }
    if (e.key !== 'Tab') return;
    const buttons = [...root.current.querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1);
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { first.focus(); e.preventDefault(); }
  };
  return html`<div ref=${root} tabindex="-1" class=${`spov offerov ${offer.hex ? 'hexd-host' : ''}`} role="dialog" aria-modal="true" aria-label=${offer.hex ? '海克斯选择' : t('插件选择')} onKeyDown=${onKeyDown}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <nav class="offerov__tabs" aria-label=${t('插件选择')}>
        ${offers.map(o => html`<${Button} key=${o.seq} size="sm" onClick=${() => open(o)} aria-pressed=${o.seq === offer.seq}>${o.hex ? '海克斯选择' : `${o.pluginId} / ${o.id}`}<//>`)}
        ${dismissible ? html`<${Button} size="sm" onClick=${dismiss}>${t('收起')}<//>` : null}
      </nav>
      ${offer.hex
        ? html`<${HexDraftView} offer=${offer} myId=${myId} readOnly=${readOnly} busy=${busy} armed=${armed} onTap=${tap} onRefresh=${idx => act(idx, true)} />`
        : html`<${OfferView} offer=${offer} myId=${myId} readOnly=${readOnly} busy=${busy} armed=${armed} onTap=${tap} onRefresh=${idx => act(idx, true)} />`}
    </div>
  </div>`;
}

// 品质标签：中文一眼可读（银/金/彩），拉丁名只作副标，不再用单字母缩写。
const TIER = { 银: ['银', 'SILVER', 'silver'], 金: ['金', 'GOLD', 'gold'], 彩: ['彩', 'PRISMATIC', 'prismatic'] };
/** 卡片右上状态位：中文优先，终端风格靠等宽字体保留。 */
const CARD_STATE = { idle: '待选', armed: '已选', locked: '锁定' };

/** 海克斯选择：独立整页的指令终端。窗口居中，三张候选等宽等高，品质整轮一致。 */
export function HexDraftView({ offer, myId, readOnly = false, busy = null, armed = null, onTap = () => {}, onRefresh = () => {} }) {
  const mine = offerSeat(offer, myId);
  const seat = mine || offer.seats[0];
  const can = offerPickable(offer, myId, readOnly, busy);
  const slots = seat?.slots || [];
  const rarity = slots.find(card => card?.rarity)?.rarity || '金';
  const [zh, latin, cls] = TIER[rarity] || TIER.金;
  const status = readOnly || !mine ? t('观战中') : mine.picked ? t('等待队友') : t('选择一项');
  return html`<div class=${`hexd hexd--${cls}`}>
    <div class="hexd__veil" aria-hidden="true"></div>
    <div class="hexd__win" role="group" aria-label="海克斯选择">
      <div class="hexd__bar">
        <span class="hexd__dots" aria-hidden="true"><i class="on"></i><i class="on"></i><i></i></span>
        <span class="hexd__brand">STRONGHOLD://HEX_DRAFT</span>
        <span class="hexd__round">R${String(offer.round ?? 5).padStart(2, '0')}</span>
      </div>
      <div class="hexd__body">
        <p class="hexd__cmd"><b>guest@stronghold</b>:~$ hex --draft --tier ${latin.toLowerCase()}</p>
        <h2 class="hexd__title">检出候选 <b>${String(slots.length).padStart(2, '0')}</b> 项 · 请指定</h2>
        <p class="hexd__meta"><span class="hexd__tier">${zh}色海克斯</span><span>${status}</span><span>${t('还有 {n} 人未选择', { n: offer.waiting })}</span></p>

        <div class="hexd__grid">
          ${slots.map((card, idx) => {
            const pickable = can && card.available !== false;
            const isArmed = pickable && armed === card.idx;
            const mythic = hexIsMythic(card.name);
            return html`<article class=${`hexd-card ${mythic ? 'hexd-card--mythic hex-mythic' : ''} ${pickable ? 'is-pickable' : ''} ${isArmed ? 'is-armed' : ''}`} key=${card.idx}>
              ${mythic ? html`<div class="hexd-card__abyss" aria-hidden="true"><span class="hexd-card__sigil"></span><span class="hexd-card__sweep"></span></div>` : null}
              <header class="hexd-card__head">
                <span class="hexd-card__tier">${mythic ? '神话' : (TIER[card.rarity] || TIER.金)[0]}</span>
                <span class="hexd-card__state">${pickable ? (isArmed ? CARD_STATE.armed : CARD_STATE.idle) : CARD_STATE.locked}</span>
                <span class="hexd-card__no">#${String(idx + 1).padStart(2, '0')}</span>
              </header>
              <button type="button" class="hexd-card__hit" disabled=${!pickable}
                aria-pressed=${isArmed} aria-busy=${busy != null} onClick=${() => onTap(card.idx)}
                aria-label=${isArmed ? t('{name}，已选中，再次点击确认', { name: card.name }) : card.name}>
                <span class="hexd-card__icon"><${HexIcon} name=${card.name} rarity=${card.rarity} /></span>
                <span class="hexd-card__name">${card.name}</span>
                ${card.custom ? html`<span class="hexd-card__custom">自选</span>` : null}
                <span class="hexd-card__desc">${card.desc}</span>
                ${card.available === false ? html`<span class="hexd-card__lock">${t('暂不可用')}</span>` : null}
                ${isArmed ? html`<span class="hexd-card__confirm"><${Icon} name="check" />${t('确认选择')}</span>` : null}
              </button>
              <footer class="hexd-card__foot">
                <button type="button" class="hexd-card__re" disabled=${!can || card.remaining <= 0}
                  onClick=${() => onRefresh(card.idx)}>${t('刷新（剩余 {n} 次）', { n: card.remaining })}</button>
              </footer>
            </article>`;
          })}
        </div>

        <div class="hexd__status">
          <span class="hexd__timer"><${Countdown} deadline=${offer.deadline} total=${offer.windowSec} size="sm" /></span>
          <span class="hexd__hint">${t('点击卡牌选中，再次点击确认')}</span>
        </div>
      </div>
    </div>
  </div>`;
}

export function OfferDock({ offers, myId, onOpen }) {
  return html`<nav class="offerov__dock" aria-label=${t('插件选择')}>
    ${offers.map(o => html`<${Button} key=${o.seq} size="sm" onClick=${() => onOpen(o)}>
      ${t('插件选择')} · ${o.id} · ${offerSeat(o, myId)?.picked ? t('等待队友') : t('选择一项')}<//>`)}
  </nav>`;
}

/** Pure view for the native match popup and node rendering tests; all plugin text stays text. */
export function OfferView({ offer, myId, readOnly = false, busy = null, armed = null, onTap = () => {}, onRefresh = () => {} }) {
  const mine = offerSeat(offer, myId);
  const seat = mine || offer.seats[0];
  const can = offerPickable(offer, myId, readOnly, busy);
  return html`<header class="spov__head">
    <div><h2>${offer.hex ? '海克斯选择' : `${t('插件选择')} · ${offer.id}`}</h2><p>${t('点击卡牌选中，再次点击确认')}</p>
      <p role="status">${readOnly || !mine ? t('观战中') : mine.picked ? t('等待队友') : t('选择一项')}
        · ${t('还有 {n} 人未选择', { n: offer.waiting })}</p></div>
    <${Countdown} deadline=${offer.deadline} total=${offer.windowSec} size="md" />
  </header>
  <div class="spov__grid spov__grid--3">
    ${(seat?.slots || []).map(card => html`<div class=${`offerov__slot ${offer.hex ? `hexov__slot hexov__slot--${card.rarity} ${hexIsMythic(card.name) ? 'hex-mythic' : ''}` : ''}`} key=${card.idx}>
      <button type="button" class=${`spcard ${can && card.available !== false ? 'is-pickable' : ''} ${can && card.available !== false && armed === card.idx ? 'is-armed' : ''}`}
        disabled=${!can || card.available === false} aria-pressed=${can && card.available !== false && armed === card.idx} aria-busy=${busy != null} onClick=${() => onTap(card.idx)}
        aria-label=${card.available !== false && armed === card.idx ? t('{name}，已选中，再次点击确认', { name: card.name }) : card.name}>
        <span class="spcard__head"><span class="spcard__icon" aria-hidden="true"><${GIcon} name=${ICONS[card.icon]} /></span>
          <b class="spcard__name">${card.name}</b></span>
        ${offer.hex ? html`<span class="hexov__rarity">${hexIsMythic(card.name) ? '神话' : card.rarity} · 海克斯 ${card.custom ? '· 自选' : ''}</span>` : null}
        <span class="spcard__desc">${card.desc}</span>
        ${card.available === false ? html`<span class="spcard__unavailable">${t('暂不可用')}</span>` : null}
        ${can && card.available !== false && armed === card.idx ? html`<span class="spcard__confirm"><${Icon} name="check" />${t('确认选择')}</span>` : null}
      </button>
      <${Button} size="sm" icon="refresh" disabled=${!can || card.remaining <= 0} onClick=${() => onRefresh(card.idx)}>
        ${t('刷新（剩余 {n} 次）', { n: card.remaining })}<//>
    </div>`)}
  </div>`;
}
