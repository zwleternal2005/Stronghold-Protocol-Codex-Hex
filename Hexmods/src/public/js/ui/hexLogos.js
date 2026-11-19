// 非盟约海克斯的专属图标（内联 SVG）。
// 约定：40px 下必须可辨认 —— 描边 ≥2.6、元素不超过 6 个、每枚保留一个实心锚点。
// 造型参考 Hextech 三形体系（方框定结构、菱形引导、圆形聚焦），与盟约图标同色系。
// 带盟约的海克斯不使用本文件，改用 public/assets/bond 下的原始盟约图标。
const S = (w = 2.7) => `stroke="currentColor" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
const F = 'fill="currentColor" stroke="none"';

export const HEX_LOGOS = Object.freeze({
  '一阶增援': `
    <rect x="9" y="20" width="7" height="7" rx="1.2" ${F}/>
    <rect x="20.5" y="20" width="7" height="7" rx="1.2" ${F}/>
    <rect x="32" y="20" width="7" height="7" rx="1.2" ${S(2.4)} opacity=".45"/>
    <path d="M24 13V4m0 0-4.2 4.4M24 4l4.2 4.4" ${S(3)}/>
    <path d="M8 33h32" ${S(2.6)} stroke-dasharray="3 4" opacity=".55"/>`,

  '维多利亚的低级补给': `
    <rect x="8" y="18" width="32" height="21" rx="2" ${S()}/>
    <rect x="8" y="18" width="32" height="8" rx="2" fill="currentColor" opacity=".9" stroke="none"/>
    <path d="M20 18v-4.5a4 4 0 0 1 8 0V18" ${S()}/>
    <path d="M24 26v13" ${S(2.4)} opacity=".5"/>`,

  '可露希尔的资金夹': `
    <path d="M7 20h18a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V23a3 3 0 0 1 3-3z" ${S()}/>
    <rect x="7" y="26" width="18" height="6" fill="currentColor" opacity=".85" stroke="none"/>
    <path d="M33 9a9 9 0 1 0 0 13" ${S(2.8)}/>
    <path d="M34 6.5v5h-5" ${S(2.8)}/>`,

  '人生切片': `
    <circle cx="24" cy="24" r="15" ${S(2.6)} opacity=".35"/>
    <path d="M24 9a15 15 0 0 1 0 30z" fill="currentColor" opacity=".85" stroke="none"/>
    <circle cx="24" cy="24" r="15" ${S(2.6)}/>
    <path d="M24 9v30M24 9l7.5 13M24 39l-7.5-13" ${S(2.4)} opacity=".55"/>`,

  '小小运营下': `
    <path d="M10 11h28L27 24.5V36l-6 4V24.5z" ${S()}/>
    <path d="M10 11h28L27 24.5H21z" fill="currentColor" opacity=".8" stroke="none"/>
    <path d="M13 42h7M24 42h7" ${S(2.6)} stroke-dasharray="3 4" opacity=".55"/>`,

  '安慰奖': `
    <circle cx="24" cy="19" r="11" ${S()}/>
    <circle cx="24" cy="19" r="6" fill="currentColor" opacity=".9" stroke="none"/>
    <path d="M17 28 13 42l7-3.6 4 3.6 4-3.6 7 3.6-4-14" ${S()}/>`,

  '随机白银': `
    <rect x="9" y="9" width="30" height="30" rx="7" ${S()}/>
    <circle cx="17" cy="17" r="2.8" ${F}/>
    <circle cx="31" cy="17" r="2.8" ${F}/>
    <circle cx="24" cy="24" r="2.8" ${F}/>
    <circle cx="17" cy="31" r="2.8" ${F}/>
    <circle cx="31" cy="31" r="2.8" ${F}/>`,

  '低阶调香': `
    <path d="M17 20h14v15a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5z" ${S()}/>
    <path d="M17 27h14v8a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5z" fill="currentColor" opacity=".85" stroke="none"/>
    <path d="M20.5 20v-4h7v4" ${S(2.5)}/>
    <path d="M24 16v-5" ${S(2.5)}/>
    <path d="M37 20c1.4 2 1.4 4 0 6M37 29c1 1.4 1 2.8 0 4" ${S(2.4)} opacity=".6"/>`,

  '众志合一': `
    <circle cx="24" cy="24" r="6.5" ${F}/>
    <circle cx="24" cy="9.5" r="3.6" ${S(2.5)}/>
    <circle cx="38.5" cy="24" r="3.6" ${S(2.5)}/>
    <circle cx="24" cy="38.5" r="3.6" ${S(2.5)}/>
    <circle cx="9.5" cy="24" r="3.6" ${S(2.5)}/>
    <path d="M24 13v5M33 24h-3.5M24 35v-5M15 24h3.5" ${S(2.6)} opacity=".7"/>`,

  '众志合一+': `
    <circle cx="24" cy="24" r="7" ${F}/>
    <circle cx="24" cy="8.5" r="3.2" ${S(2.4)}/>
    <circle cx="37.5" cy="16" r="3.2" ${S(2.4)}/>
    <circle cx="37.5" cy="32" r="3.2" ${S(2.4)}/>
    <circle cx="24" cy="39.5" r="3.2" ${S(2.4)}/>
    <circle cx="10.5" cy="32" r="3.2" ${S(2.4)}/>
    <circle cx="10.5" cy="16" r="3.2" ${S(2.4)}/>
    <circle cx="24" cy="24" r="12.5" ${S(2.3)} stroke-dasharray="3 4" opacity=".5"/>`,

  '众志合一++': `
    <circle cx="24" cy="24" r="8" ${F}/>
    <circle cx="24" cy="24" r="15" ${S(2.6)}/>
    <circle cx="24" cy="24" r="20" ${S(2.3)} stroke-dasharray="3 4" opacity=".45"/>
    <path d="M24 4v5M44 24h-5M24 44v-5M4 24h5" ${S(2.8)} opacity=".85"/>`,

  '苟住': `
    <path d="M24 6 39 12.5v11.8C39 32.6 32.4 39.2 24 42 15.6 39.2 9 32.6 9 24.3V12.5z" ${S()}/>
    <path d="M24 13v21c5-1.6 9-5.6 9-10.2V13z" fill="currentColor" opacity=".8" stroke="none"/>`,

  '真得苟住': `
    <path d="M24 5 40 11.8v12.4C40 32.8 32.8 39.8 24 43 15.2 39.8 8 32.8 8 24.2V11.8z" ${S()}/>
    <path d="M24 12 35 16.6v7.8c0 6-4.6 11-11 13.2-6.4-2.2-11-7.2-11-13.2v-7.8z" fill="currentColor" opacity=".28" stroke="none"/>
    <path d="M24 18v10M19 23h10" ${S(2.8)}/>`,

  '血多不疼': `
    <path d="M24 39S9 30 9 20.5A8 8 0 0 1 24 16a8 8 0 0 1 15 4.5C39 30 24 39 24 39z" ${S()}/>
    <path d="M24 39S9 30 9 20.5A8 8 0 0 1 24 16z" fill="currentColor" opacity=".85" stroke="none"/>
    <path d="M38.5 24.5h5M38.5 29h4M38.5 20h4" ${S(2.5)} opacity=".6"/>`,

  '产能不足喵': `
    <rect x="9" y="17" width="26" height="16" rx="3" ${S()}/>
    <path d="M38 21v8" ${S(4)}/>
    <path d="M13 17 15.5 9l4.5 4.4M29 17 31.5 9l4.5 4.4" ${S(2.5)}/>
    <circle cx="18" cy="25" r="1.8" ${F}/><circle cx="26" cy="25" r="1.8" ${F}/>
    <path d="M20 29.5c1.6 1.4 3.4 1.4 5 0" ${S(2.2)}/>`,

  '真的产能不足喵': `
    <rect x="9" y="16" width="26" height="18" rx="3" ${S()}/>
    <path d="M38 21v8" ${S(4)}/>
    <path d="M13 16 15.5 8l4.5 4.4M29 16 31.5 8l4.5 4.4" ${S(2.5)}/>
    <rect x="12" y="21" width="7" height="4" rx="1" ${F}/>
    <rect x="21" y="21" width="7" height="4" rx="1" ${F} opacity=".5"/>
    <circle cx="17" cy="29" r="1.6" ${F}/><circle cx="26" cy="29" r="1.6" ${F}/>
    <path d="M20 31.6c1.5 1.2 3.2 1.2 4.6 0" ${S(2)}/>`,

  '真的真的产能不足喵': `
    <rect x="9" y="16" width="26" height="18" rx="3" ${S()}/>
    <path d="M38 21v8" ${S(4)}/>
    <path d="M13 16 15.5 8l4.5 4.4M29 16 31.5 8l4.5 4.4" ${S(2.5)}/>
    <rect x="11.5" y="20.5" width="6" height="4.5" rx="1" ${F}/>
    <rect x="19" y="20.5" width="6" height="4.5" rx="1" ${F}/>
    <rect x="26.5" y="20.5" width="6" height="4.5" rx="1" ${F} opacity=".6"/>
    <circle cx="17" cy="28.5" r="1.6" ${F}/><circle cx="26" cy="28.5" r="1.6" ${F}/>
    <path d="M20 31c1.5 1.2 3.2 1.2 4.6 0" ${S(2)}/>`,

  '随机黄金': `
    <rect x="9" y="9" width="30" height="30" rx="7" ${S()}/>
    <rect x="9" y="9" width="30" height="10" rx="7" fill="currentColor" opacity=".35" stroke="none"/>
    <circle cx="17" cy="17" r="2.6" ${F}/>
    <circle cx="31" cy="17" r="2.6" ${F}/>
    <circle cx="17" cy="24" r="2.6" ${F}/>
    <circle cx="31" cy="24" r="2.6" ${F}/>
    <circle cx="17" cy="31" r="2.6" ${F}/>
    <circle cx="31" cy="31" r="2.6" ${F}/>`,

  '文火猛炖': `
    <path d="M8 23h32v8a9 9 0 0 1-9 9H17a9 9 0 0 1-9-9z" ${S()}/>
    <rect x="8" y="23" width="32" height="6" fill="currentColor" opacity=".8" stroke="none"/>
    <path d="M5 23h38" ${S(2.8)}/>
    <path d="M24 6c0 3-3.4 3.4-3.4 6.2 0 1.6 1.4 2.8 2.8 2.8M31 8.5c0 2.2-2.4 2.6-2.4 4.6 0 1.1.9 2 2 2" ${S(2.5)}/>`,

  // ── v0.1.3 新增 22 条 ─────────────────────────────────────────────
  // 银
  '再就业回执': `
    <rect x="6.5" y="6.5" width="19" height="24" rx="2.5" ${S()}/>
    <path d="M11.5 13h9M11.5 18h9M11.5 23h5" ${S(2.2)} opacity=".55"/>
    <rect x="11" y="26" width="6" height="3" rx="1" ${F} opacity=".85"/>
    <path d="M34 33a7.5 7.5 0 1 0-2.2-9.2" ${S(2.8)}/>
    <path d="m34.4 22.4-4 1.8.9 3.8" ${S(2.5)}/>`,

  '空装上阵': `
    <rect x="13" y="21" width="22" height="17" rx="3" ${S()}/>
    <path d="M13 21h22" ${S(2.8)}/>
    <path d="M24 15V5m0 0-4.6 4.6M24 5l4.6 4.6" ${S(3)}/>
    <rect x="18" y="26.5" width="12" height="5" rx="1.4" ${F} opacity=".9"/>
    <path d="M7 30v5M41 30v5" ${S(2.2)} opacity=".4"/>`,

  '备用电容': `
    <rect x="7" y="14" width="34" height="20" rx="4" ${S()}/>
    <path d="M27.5 18.5 20 26h5l-4.2 7.5 8.4-8.4h-5z" ${F}/>
    <path d="M12.5 20v8M16.5 20v8" ${S(2.6)}/>
    <path d="M40 20v8" ${S(3)}/>`,

  '热身完毕': `
    <circle cx="21" cy="27" r="12" ${S()}/>
    <path d="M21 27v-7M21 27l5 3" ${S(2.8)}/>
    <path d="M17 8h8M21 8v5" ${S(2.8)}/>
    <path d="m34 11 5 5M39 11l-5 5" ${S(2.4)}/>
    <circle cx="21" cy="27" r="1.6" ${F}/>`,

  '结阵': `
    <rect x="7.5" y="17" width="14" height="14" rx="2.5" ${S()}/>
    <rect x="26.5" y="17" width="14" height="14" rx="2.5" ${S()}/>
    <rect x="11" y="21" width="7" height="6" rx="1.4" ${F} opacity=".85"/>
    <path d="M21.5 24h5" ${S(3)}/>
    <circle cx="24" cy="24" r="2" ${F}/>`,

  '坚定风采': `
    <path d="M24 39c-9-6-14-11-14-17a8 8 0 0 1 14-5 8 8 0 0 1 14 5c0 6-5 11-14 17z" ${S()}/>
    <path d="M24 18v11M18.5 23.5h11" ${S(2.9)}/>
    <circle cx="24" cy="23.5" r="2.4" ${F}/>`,

  // 金
  '花到上头': `
    <path d="M12 22h24l-3 16a3 3 0 0 1-3 2.6H18A3 3 0 0 1 15 38z" ${S()}/>
    <path d="M16 22c0-4 3.6-6 8-6s8 2 8 6" ${S(2.8)}/>
    <rect x="19" y="26.5" width="10" height="4" rx="1" ${F} opacity=".85"/>
    <path d="M24 6v5M33 8l-3 4.5M15 8l3 4.5" ${S(2.4)}/>`,

  '花到上头++': `
    <path d="M9 24h20l-2.6 13a3 3 0 0 1-3 2.4H14.6a3 3 0 0 1-3-2.4z" ${S()}/>
    <path d="M13 24c0-3.6 2.8-5.4 6-5.4s6 1.8 6 5.4" ${S(2.6)}/>
    <rect x="14.5" y="28" width="9" height="4" rx="1" ${F} opacity=".85"/>
    <path d="M31 14h11M36.5 8.5v11" ${S(2.9)}/>`,

  '超前投资': `
    <path d="m6 35 10-11 7.5 6.5L37 15" ${S(2.9)}/>
    <path d="M30 15h7v7" ${S(2.8)}/>
    <circle cx="15" cy="30" r="3.4" ${S(2.4)}/>
    <circle cx="15" cy="30" r="1.3" ${F}/>`,

  '重奏之影': `
    <path d="M17 9l10 10-10 10L7 19z" ${S()}/>
    <path d="M32 21l8.5 8.5L32 38l-8.5-8.5z" ${S(2.5)} opacity=".55"/>
    <circle cx="17" cy="19" r="3" ${F}/>
    <path d="M36 9v8M32 13h8" ${S(2.9)}/>`,

  '余音护航': `
    <path d="M24 5.5 38 11v11c0 9-6 15.5-14 20-8-4.5-14-11-14-20V11z" ${S()}/>
    <rect x="19" y="18" width="10" height="6.5" rx="1.4" ${F} opacity=".85"/>
    <path d="M33 17.5a7.5 7.5 0 0 1 0 13M37 14a12 12 0 0 1 0 20" ${S(2.4)} opacity=".55"/>`,

  '偏科补课': `
    <rect x="8" y="10" width="26" height="5" rx="1.6" ${S(2.4)} opacity=".45"/>
    <rect x="8" y="19" width="18" height="5" rx="1.6" ${S(2.4)} opacity=".45"/>
    <rect x="8" y="28" width="9" height="5" rx="1.6" ${F} opacity=".9"/>
    <path d="M36 23v11M30.5 28.5h11" ${S(2.9)}/>`,

  '坚定风采+': `
    <path d="M24 38c-8.4-5.6-13-10.4-13-16a7.4 7.4 0 0 1 13-4.4A7.4 7.4 0 0 1 37 22c0 5.6-4.6 10.4-13 16z" ${S()}/>
    <path d="M24 21v9M19.5 25.5h9" ${S(2.8)}/>
    <path d="M7 33a17 17 0 0 1 34 0" ${S(2.4)} opacity=".45"/>
    <circle cx="24" cy="25.5" r="2.2" ${F}/>`,

  '引火成书': `
    <path d="M8.5 20.5H19a3 3 0 0 1 3 3v16a4 4 0 0 0-4-4H8.5z" ${S(2.5)}/>
    <path d="M39.5 20.5H29a3 3 0 0 0-3 3v16a4 4 0 0 1 4-4h9.5z" ${S(2.5)} opacity=".45"/>
    <path d="M24 18c0-4-3.6-5.6-3.6-9.6 3.6 1 6.6 4.6 6.6 9.2 0 2.6-1.4 4.4-3.2 4.4S21 20.2 21 18.4z" ${F}/>`,

  '重锤回响': `
    <rect x="20" y="13" width="16" height="9" rx="2" ${S()}/>
    <path d="M26 22v19" ${S(3.2)}/>
    <path d="M7 26a15 15 0 0 1 0-12M3 20a21 21 0 0 1 0-14" ${S(2.4)} opacity=".5"/>
    <rect x="23" y="16" width="10" height="3" rx="1" ${F} opacity=".85"/>`,

  '背水一战': `
    <path d="M24 5.5 37 11v10c0 9-5.5 15-13 19-7.5-4-13-10-13-19V11z" ${S()}/>
    <path d="M24 15v14m0 0-4.4-4.4M24 29l4.4-4.4" ${S(2.8)}/>
    <path d="m13 12.5 6.5 7" ${S(2.6)} opacity=".45"/>
    <circle cx="24" cy="34" r="2" ${F} opacity=".8"/>`,

  '海克斯装备集成': `
    <rect x="9.5" y="14" width="20" height="20" rx="3" ${S()}/>
    <path d="M29.5 24H41M36.5 18.5v11" ${S(2.6)}/>
    <rect x="14" y="18" width="5.5" height="5.5" rx="1.2" ${F} opacity=".9"/>
    <rect x="21" y="25" width="5.5" height="5.5" rx="1.2" ${F} opacity=".5"/>
    <path d="M15.5 14V8M23.5 14V8" ${S(2.4)} opacity=".55"/>`,

  // 彩
  '越级调度': `
    <path d="M7.5 38.5h9v-9h9v-9h9v-9h6" ${S(2.8)}/>
    <path d="M35 11.5h6.5V18" ${S(2.9)}/>
    <rect x="11.5" y="31.5" width="5" height="5" rx="1" ${F} opacity=".85"/>`,

  '技力传递': `
    <circle cx="13" cy="24" r="7" ${S()}/>
    <circle cx="35" cy="24" r="7" ${S()}/>
    <path d="M20.5 24h7M24.5 20.5 28 24l-3.5 3.5" ${S(2.8)}/>
    <circle cx="13" cy="24" r="2.6" ${F}/>`,

  '少而精': `
    <rect x="11" y="20" width="16" height="16" rx="3" ${S()}/>
    <rect x="15" y="24" width="8" height="8" rx="1.8" ${F} opacity=".85"/>
    <circle cx="35.5" cy="24" r="2.6" ${S(2.2)} opacity=".4"/>
    <circle cx="35.5" cy="32.5" r="2.6" ${S(2.2)} opacity=".4"/>
    <path d="M11 14h16" ${S(2.4)} opacity=".35"/>`,

  '第四艺术': `
    <path d="M24 5.5 39 24 24 42.5 9 24z" ${S()}/>
    <path d="M23 14 15 26h9" ${S(3)}/>
    <path d="M24 14v18" ${S(3)}/>
    <circle cx="35.5" cy="11.5" r="2.6" ${F}/>`,

  '名刀司命！': `
    <path d="M31.5 6.5 38 13 18 33l-6.5 6.5 2.2-9.5z" ${S(2.6)}/>
    <path d="m20 26 6 6" ${S(2.4)} opacity=".5"/>
    <circle cx="13.5" cy="36.5" r="3" ${F}/>
    <path d="M8 13.5 11 17M40 21.5l-3.2 3.2" ${S(2.4)} opacity=".5"/>`,

  // 深海倾灭：三叉深渊冠、被吞入的核心与回卷潮汐，48 网格小尺寸可辨。
  '深海倾灭': `
    <path d="M10 14 16 20 24 7l8 13 6-6-4 17H14z" ${S(2.8)}/>
    <path d="M7 32c5-4 9-4 14 0s9 4 14 0l6-4" ${S(2.8)}/>
    <path d="M10 39c5-3 9-3 14 0s9 3 14-1" ${S(2.8)} opacity=".65"/>
    <path d="m24 19 5 7-5 6-5-6z" ${F}/>
    <path d="M24 4v2M5 23l3 1M40 24l3-1" ${S(2.6)} opacity=".55"/>
    <path d="M16 12 12 8M32 12l4-4" ${S(2.6)} opacity=".55"/>
  `,

  '魔王冠冕': `
    <path d="M9.5 33.5 12 15l7 7L24 10.5l5 11.5 7-7 2.5 18.5z" ${S(2.7)}/>
    <rect x="9.5" y="33.5" width="29" height="5.5" rx="1.6" ${F}/>
    <circle cx="24" cy="25.5" r="2.9" ${F}/>
    <path d="M16 31h4M28 31h4" ${S(2.4)} opacity=".45"/>`,
});

/** 取某个海克斯的内联图标；未收录的返回 null（调用方退回品质首字）。 */
export function hexLogo(name) {
  return HEX_LOGOS[name] || null;
}
