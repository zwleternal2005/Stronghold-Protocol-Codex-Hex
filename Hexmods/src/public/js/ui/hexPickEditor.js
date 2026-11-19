// 个人自选：在图鉴卡片上按回合指定海克斯。
// 布局全部用 rem，跟随根字号等比缩放；不按宽度切换列数或重排。
import { useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { HEX_CATALOG } from '../../../shared/hexCatalog.js';
import { HexIcon, HexPresentationBadge, hexIsMythic } from './hexIcon.js';
import { t } from '../../../shared/i18n.js';

const GROUPS = [['银', 'SILVER'], ['金', 'GOLD'], ['彩', 'PRISMATIC']];

/**
 * @param {object} props
 * @param {number[]} props.rounds    出现回合（来自设置里的 hexRounds）
 * @param {Record<string,string>} props.picks 回合 → 海克斯名
 * @param {Set<string>} props.selectable 允许自选的海克斯
 * @param {boolean} props.disabled
 * @param {(next: Record<string,string>) => void} props.onChange
 */
export function PersonalHexPicker({ rounds = [], picks = {}, selectable = new Set(), disabled = false, onChange = () => {} }) {
  const list = (rounds || []).slice().sort((a, b) => a - b);
  const [focus, setFocus] = useState(null);
  const active = list.includes(focus) ? focus : (list.find(round => !picks[round]) ?? list[0] ?? null);
  const badgeOf = name => list.filter(round => picks[round] === name);
  const assign = name => {
    if (active == null) return;
    const next = { ...picks };
    if (next[active] === name) delete next[active];
    else next[active] = name;
    onChange(next);
  };

  return html`<div class="hexpick" data-testid="personal-hex-picker">
    <div class="hexpick__rounds">
      <span class="hexpick__label">${t('出现回合')}</span>
      ${list.length
        ? list.map(round => html`<span class=${`hexpick__round ${hexIsMythic(picks[round]) ? 'hex-mythic' : ''} ${picks[round] ? 'is-set' : ''} ${round === active ? 'is-active' : ''}`} key=${round}>
            <button type="button" class="hexpick__pick" disabled=${disabled}
              aria-pressed=${round === active} onClick=${() => setFocus(round)}>
              <b>R${round}</b><small>${picks[round] || t('未指定')}</small>
              <${HexPresentationBadge} name=${picks[round]} />
            </button>
            ${picks[round] ? html`<button type="button" class="hexpick__clear" disabled=${disabled}
              aria-label=${t('清除第 {n} 回合', { n: round })} onClick=${() => { const next = { ...picks }; delete next[round]; onChange(next); }}>×</button>` : null}
          </span>`)
        : html`<span class="hexpick__hint">${t('先在上方勾选出现回合')}</span>`}
    </div>
    ${active != null ? html`<p class="hexpick__tip">${t('正在指定 R{n}：点卡片即可指定，再点一次取消。', { n: active })}</p>` : null}
    <div class="hexpick__scroll">
      ${GROUPS.map(([rarity, latin]) => {
        const rows = HEX_CATALOG.filter(entry => entry.rarity === rarity);
        if (!rows.length) return null;
        return html`<section class="hexpick__group" key=${rarity}>
          <h4 class="hexpick__title">${rarity}<small>${latin}</small></h4>
          <div class="hexpick__grid">
            ${rows.map(entry => {
              const roundsFor = badgeOf(entry.name);
              const usable = !selectable.size || selectable.has(entry.name);
              return html`<button type="button" key=${entry.name}
                class=${`hexpick__card hex-r-${rarity} ${entry.presentation === 'mythic' ? 'hex-mythic' : ''} ${roundsFor.length ? 'is-picked' : ''} ${usable ? '' : 'is-locked'}`}
                disabled=${disabled || !usable}
                aria-pressed=${roundsFor.length > 0}
                title=${usable ? entry.effect : t('（暂不可自选）')}
                onClick=${() => assign(entry.name)}>
                <span class="hexpick__icon"><${HexIcon} name=${entry.name} rarity=${entry.rarity} /></span>
                <span class="hexpick__body">
                  ${roundsFor.length ? html`<span class="hexpick__badges">${roundsFor.map(r => html`<i key=${r}>R${r}</i>`)}</span>` : null}
                  <b class="hexpick__name">${entry.name}</b>
                  <${HexPresentationBadge} name=${entry.name} />
                  <span class="hexpick__text">${entry.effect}</span>
                  ${entry.bond ? html`<small class="hexpick__bond">${entry.bond}</small>` : null}
                </span>
              </button>`;
            })}
          </div>
        </section>`;
      })}
    </div>
    <div class="hexpick__foot">
      <span class="hexpick__count">${t('已指定 {n} / {m}', { n: list.filter(r => picks[r]).length, m: list.length })}</span>
      <button type="button" class="hexpick__reset" disabled=${disabled || !Object.keys(picks).length}
        onClick=${() => onChange({})}>${t('清空')}</button>
    </div>
  </div>`;
}
