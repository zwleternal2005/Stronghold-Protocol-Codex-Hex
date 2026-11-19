// Active effects list (m.private.effects: band / 机变 / team / item / garrison effects with counters):
// compact icon column at the right edge, rich-text tooltip per effect. `counterText` (a 悬赏's "还剩 N 场作战", user
// playtest #6 item 4) replaces the bare counter in the tooltip's kind line.

import { html, Tooltip, MicroLabel } from './components.js';
import { useState } from '../../vendor/hooks.module.js';
import { Img, RichText, GIcon } from './gameComponents.js';
import { effectIconUrl } from './assetUrls.js';
import { HexIcon, hexIsMythic } from './hexIcon.js';
import { data } from '../data.js';
import { t, tName, N_ } from '../../../shared/i18n.js';
import { sentText } from './lang.js';
import { StrategyProgress, strategyProgressModel } from './strategyProgress.js';
import { commandDisplayText } from '../../../shared/commandDisplay.js';
import { bondEffectRecord } from './bondEffect.js';
import { formatBondEffect } from './richText.js';
import { HEX_CATALOG } from '../../../shared/hexCatalog.js';

const KIND = { band: N_('策略'), choice: N_('机变'), team: N_('团队增益'), item: N_('道具'), garrison: N_('特质') };

/**
 * A 悬赏's counter line in the current language: the battles its enemies still come for (server/match/player/views.js
 * sends the same Chinese text as `counterText` beside the count; a multi-round card has no count).
 * @param {{ counter?: number|null }} e
 */
export const bountyCounterText = (e) => (e.counter == null ? t('之后的每场作战') : t('还剩 {left} 场作战', { left: e.counter }));

/** Data files whose records an effect entry copies its name / description from (by its id or icon id). */
const SOURCES = ['effects', 'bands', 'items', 'garrisons'];

/**
 * An effect entry's description in the current language (the server copies a record's Chinese text: an effect's, a
 * strategy's, an item's, a 特质's — sentText; a reworded one, such as a multi-round 悬赏's, stays as sent).
 * @param {{ id?: string, iconId?: string, desc?: string }} e
 */
export function effectDesc(e) {
  const desc = e.desc || '';
  const ref = e.descRef;
  if (ref?.kind === 'bandSkill') {
    const band = typeof ref.bandId === 'string' ? data.lookup('bands', ref.bandId) : null;
    const skill = band?.skills?.find((s) => s?.effectId === ref.effectId) || null;
    if (skill) return commandDisplayText(skill.descRaw || skill.desc || desc);
  }
  if (ref?.kind === 'effect') {
    const effect = typeof ref.effectId === 'string' ? data.lookup('effects', ref.effectId) : null;
    if (effect) return effect.descRaw || effect.desc || desc;
  }
  if (ref?.kind === 'bondEffect') {
    const bond = typeof ref.bondId === 'string' ? data.lookup('bonds', ref.bondId) : null;
    const effect = typeof ref.effectId === 'string' ? data.lookup('effects', ref.effectId) : null;
    if (bond && effect) return formatBondEffect(bondEffectRecord(bond, effect, ref.layers), ref.layers);
  }
  if (!desc) return desc;
  for (const file of SOURCES) {
    for (const id of [e.id, e.iconId]) {
      const raw = typeof id === 'string' && id ? data.lookupRaw(file, id) : null;
      if (!raw) continue;
      const loc = data.lookup(file, id) || raw;
      for (const k of ['descRaw', 'desc']) {
        const v = sentText(desc, raw[k], loc[k]);
        if (v !== desc) return v;
      }
    }
  }
  return desc;
}

/**
 * 单个已选海克斯：平常只显示缩小图标（品质色环），点击图标展开名称与效果，再点一次收起。
 * 收起状态不占右侧面板宽度，条目变多时仍只排一列图标。
 */
function HexPickRow({ pick, card }) {
  const rarity = pick.rarity || card?.rarity || '';
  const mythic = hexIsMythic(pick.name);
  const tier = mythic ? '神话' : rarity || '海克斯';
  const presentationClass = mythic ? ' hex-mythic' : '';
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((v) => !v);
  return html`<div class=${`effects__row effects__row--hex${open ? ' is-open' : ''}`}>
    <button type="button" class=${`hexchip hex-r-${rarity || '金'}${presentationClass}`} aria-label=${`${pick.name}（${tier}）`}
      aria-expanded=${open ? 'true' : 'false'} onClick=${toggle}>
      <${HexIcon} name=${pick.name} rarity=${rarity || '金'} />
      <span class=${`hexchip__dot${mythic ? ' hexchip__dot--mythic' : ''}`} aria-hidden="true">${mythic ? '神' : ''}</span>
    </button>
    ${open ? html`<div class=${`hexrow hex-r-${rarity || '金'}${presentationClass}`}>
      <span class="hexrow__icon"><${HexIcon} name=${pick.name} rarity=${rarity || '金'} /></span>
      <span class="hexrow__body">
        <span class="hexrow__name">${pick.name}</span>
        <span class="hexrow__text">${card?.effect || ''}</span>
      </span>
      <span class="hexrow__tier">${tier}</span>
    </div>` : null}
  </div>`;
}

/** @param {{ effects: any[] }} props */
export function EffectsList({ effects, hexPicks, ownCommandId = null }) {
  const list = (Array.isArray(effects) ? effects : []).filter((e) => e && (e.name || e.desc)
    && !(ownCommandId && e.iconKind === 'band' && e.command !== false && e.id === ownCommandId));
  const picks = (Array.isArray(hexPicks) ? hexPicks : []).filter(p => p?.name);
  if (!list.length && !picks.length) return null;
  const m = data.get('assets');
  return html`<div class="effects" aria-label=${t('生效中的效果')}>
    <${MicroLabel}>EFFECTS</${MicroLabel}>
    ${picks.map((pick, i) => {
      const card = HEX_CATALOG.find(c => c.name === pick.name);
      return html`<${HexPickRow} key=${`hex-${i}`} pick=${pick} card=${card} />`;
    })}
    ${list.map((e, i) => {
      const key = e.viewKey ?? e.id ?? i;
      return html`<div class="effects__row" key=${key}><${Tooltip} key=${key} placement="bottom" text=${html`<div class="efftip">
        <b>${tName(e.name) || t('效果')}</b><span class="efftip__kind">${t(KIND[e.iconKind] || '')}${e.counterText ? ` · ${bountyCounterText(e)}` : e.counter != null ? ` · ${e.counter}` : ''}</span>
        <${RichText} as="p" text=${effectDesc(e)} />
        <${StrategyProgress} effect=${e} />
      </div>`}>
      <span class=${`effect effect--${e.iconKind || 'x'}`}>
        ${strategyProgressModel(e) ? html`<span class="effect__progress num">${strategyProgressModel(e).badge}</span>` : null}
        <${Img} src=${effectIconUrl(m, e)} fallback=${html`<${GIcon} name="bolt" />`} />
        ${e.counter != null && e.counter !== '' ? html`<b class="effect__n num">${e.counter}</b>` : null}
      </span>
    <//></div>`;
    })}
  </div>`;
}
