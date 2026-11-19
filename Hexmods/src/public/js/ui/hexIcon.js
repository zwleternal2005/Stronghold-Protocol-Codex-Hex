// 海克斯图标：盟约类用游戏原始盟约图标，其余用内联 SVG 专属图标。
// 规范例外：绑定了盟约但声明 logo: true 的卡，仍使用专属图标（视觉例外，不影响发放规则）。
// 以 data URI 形式交给 <img>，避免向 DOM 注入原始 HTML。
import { html } from './components.js';
import { HEX_BY_NAME, HEX_BOND_ICON } from '../../../shared/hexCatalog.js';
import { hexLogo } from './hexLogos.js';

export const HEX_TINT = Object.freeze({ 银: '#9ec3b6', 金: '#e0b354', 彩: '#c47ae0' });

const cache = new Map();

/** 神话只取目录的表现标记，不参与底层品质判断。 */
export const hexIsMythic = name => HEX_BY_NAME.get(name)?.presentation === 'mythic';

export function HexPresentationBadge({ name }) {
  return hexIsMythic(name) ? html`<span class="hex-mythic-badge">神话</span>` : null;
}

export function hexBondOf(name) {
  return HEX_BY_NAME.get(name)?.bond || null;
}

/** 该卡是否使用专属 Logo：未绑定盟约，或显式声明 logo: true。 */
export function hexUsesLogo(name) {
  const card = HEX_BY_NAME.get(name);
  if (!card) return false;
  return !!card.logo || !card.bond;
}

/** 该海克斯使用的图片地址：专属 Logo（未绑定盟约或声明 logo）优先，其次盟约图标，都没有则 null。 */
export function hexIconSrc(name, rarity = '金') {
  const mythic = hexIsMythic(name);
  const key = `${name}|${rarity}|${mythic}`;
  if (cache.has(key)) return cache.get(key);
  let src = null;
  const body = hexUsesLogo(name) ? hexLogo(name) : null;
  if (body) {
    const tint = mythic ? '#f0dfb7' : HEX_TINT[rarity] || HEX_TINT.金;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">`
      + body.split('currentColor').join(tint)
      + '</svg>';
    src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s{2,}/g, ' '))}`;
  } else {
    const file = HEX_BOND_ICON[hexBondOf(name)];
    if (file) src = `/assets/bond/${file}.png`;
  }
  cache.set(key, src);
  return src;
}

/** 统一尺寸的图标元素；无图时退回品质首字。 */
export function HexIcon({ name, rarity = '金', className = '', alt = '' }) {
  const src = hexIconSrc(name, rarity);
  const tone = `${hexUsesLogo(name) ? 'hexicon--logo' : 'hexicon--bond'}${hexIsMythic(name) ? ' hexicon--mythic' : ''}`;
  if (src) {
    return html`<img class=${`hexicon ${tone} ${className}`} src=${src} alt=${alt || name} loading="lazy" decoding="async" />`;
  }
  return html`<span class=${`hexicon hexicon--letter ${hexIsMythic(name) ? 'hexicon--mythic' : ''} ${className}`} aria-hidden="true">${(name || rarity).slice(0, 1)}</span>`;
}
