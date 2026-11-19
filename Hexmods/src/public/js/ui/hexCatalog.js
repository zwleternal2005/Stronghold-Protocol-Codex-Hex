import { html, Modal, Button } from './components.js';
import { HEX_CATALOG } from '../../../shared/hexCatalog.js';
import { HexIcon, HexPresentationBadge } from './hexIcon.js';

const GROUPS = [
  ['银', 'SILVER'],
  ['金', 'GOLD'],
  ['彩', 'PRISMATIC'],
];

/** 图鉴：按品质分组的图标网格。只展示条目本身，不写说明段落。 */
export function HexCatalog({ onClose }) {
  return html`<${Modal} open=${true} onClose=${onClose} class="hex-catalog">
    <header class="hex-catalog__head">
      <h2>海克斯图鉴</h2>
      <${Button} size="sm" onClick=${onClose}>关闭<//>
    </header>
    ${GROUPS.map(([rarity, latin]) => {
      const rows = HEX_CATALOG.filter(entry => entry.rarity === rarity);
      return html`<section class="hex-catalog__group" key=${rarity}>
        <h3 class=${`hex-catalog__title hex-r-${rarity}`}>${rarity}<small>${latin}</small><span>${rows.length}</span></h3>
        <div class="hex-catalog__grid">
          ${rows.map(entry => html`<article class=${`hex-catalog__card hex-r-${rarity} ${entry.presentation === 'mythic' ? 'hex-mythic' : ''}`} key=${entry.name}>
            <div class="hex-catalog__icon"><${HexIcon} name=${entry.name} rarity=${entry.rarity} /></div>
            <div class="hex-catalog__body">
              <b class="hex-catalog__name">${entry.name}</b>
              <${HexPresentationBadge} name=${entry.name} />
              <p class="hex-catalog__text">${entry.effect}</p>
              ${entry.bond ? html`<small class="hex-catalog__bond">${entry.bond}</small>` : null}
            </div>
          </article>`)}
        </div>
      </section>`;
    })}
  <//>`;
}
