// shared/modUpdate.js — 规程海克斯模组的「检查更新」纯逻辑（服务端与浏览器共用）。
//
// 版本口径：模组自己的版本是 shared/constants.js 的 MOD_VERSION（标题屏徽标、更新公告、更新检查同值）；
// 引擎的 APP_VERSION 是另一条线，不参与这里的比较。
//
// 数据源：夸克网盘分享（玩家拿包的同一个地址）。分享根下**并存两代**：
//   /卫戍协议 海克斯模组/卫戍协议：规程 海克斯模组/…      ← 本模组（二代）
//   /卫戍协议 海克斯模组/卫戍协议：盟约 海克斯模组/…      ← 第一代，绝不能算进规程的版本
// 所以扫描必须按相对路径里的世代关键字（MOD_UPDATE_SCOPE_DEFAULT = '规程'）过滤；否则第一代的
// 「v0.07.2」与规程的「v0.1.2」会在同一根数轴上互相压过，把玩家引去另一个世代的包。
//
// 检查结果 → 浏览器视图的形状由 updateCheckView 钉死；网络/解析失败一律退化为 checked:false，
// 客户端不弹窗，游戏照常玩。

/** 模组更新检查的默认地址（夸克分享）。 */
export const MOD_UPDATE_URL_DEFAULT = 'https://pan.quark.cn/s/4bd49b5e625f';
/** 拿不到更具体地址时的落地页。 */
export const MOD_UPDATE_FALLBACK_URL = MOD_UPDATE_URL_DEFAULT;
/** 世代关键字：只认相对路径里含它的文件（'规程'），第一代「盟约」的包一律排除。 */
export const MOD_UPDATE_SCOPE_DEFAULT = '规程';

/**
 * 版本号规范化：去掉首尾空白与末尾多余的 `.0` 段（`0.1.2.0` ⇒ `0.1.2`）。
 *
 * 规程的版本一直是**三段式**（0.1.1、0.1.2…），所以比较按段进行，而不是折成小数：
 * 折算会把 `0.1.10` 变成 `0.110`（=0.11），反而小于 `0.1.9`（=0.19）—— 第十个补丁会被判成旧版。
 * 第一代「盟约」用的是 0.07.2 小数口径，与本模组不同，两代也不该放在同一条轴上比较（靠世代过滤隔开）。
 * @param {string} v @returns {string}
 */
export function canonicalModVersion(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d+)*$/.test(s)) return s;
  const segs = s.split('.');
  while (segs.length > 1 && segs[segs.length - 1] === '0') segs.pop();
  return segs.join('.');
}

/**
 * 比较两个版本号：>0 表示 a 更新（逐段数字比较，缺失的段按 0）。
 * @param {string} a @param {string} b @returns {number}
 */
export function compareModVersions(a, b) {
  const pa = canonicalModVersion(a).split('.');
  const pb = canonicalModVersion(b).split('.');
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = Number(pa[i]) || 0;
    const y = Number(pb[i]) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 从文件名提取版本号：取最后一个 `v?X.Y…` 形状的串（文件名尾部才是版本）。
 * @param {string} name @returns {string|null}
 */
export function versionFromFileName(name) {
  const s = String(name || '');
  const hits = [...s.matchAll(/[vV](\d+(?:\.\d+)+)/g)];
  if (hits.length) return hits[hits.length - 1][1];
  const bare = [...s.matchAll(/(?:^|[\s_（(【-])(\d+\.\d+(?:\.\d+)*)(?=$|[\s_）)】.zip])/g)];
  return bare.length ? bare[bare.length - 1][1] : null;
}

const cut = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const httpsUrl = (v) => (/^https:\/\/\S+$/.test(typeof v === 'string' ? v.trim() : '') ? v.trim() : '');

/**
 * 校验远端清单（普通 JSON 渠道）：认不出就 null，字段逐个收窄。
 * @param {any} raw @returns {{ version: string, notes: string, downloadUrl: string, file: string, bytes: number } | null}
 */
export function parseUpdateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const version = cut(raw.version, 32);
  if (!version || /[<>]/.test(version)) return null;
  const bytes = Number(raw.bytes);
  return {
    version,
    notes: cut(raw.notes, 400),
    downloadUrl: httpsUrl(raw.downloadUrl),
    file: cut(raw.file, 200),
    bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0,
  };
}

/**
 * 检查结果 → 浏览器视图（纯函数）。
 * @param {string} current @param {{ version: string, notes?: string, downloadUrl?: string, file?: string, bytes?: number } | null} manifest
 * @returns {{ checked: boolean, outdated: boolean, current: string, latest: string, notes: string, downloadUrl: string, file: string, bytes: number }}
 */
export function updateCheckView(current, manifest) {
  const now = String(current ?? '');
  if (!manifest) return { checked: false, outdated: false, current: now, latest: '', notes: '', downloadUrl: '', file: '', bytes: 0 };
  const outdated = compareModVersions(manifest.version, now) > 0;
  return {
    checked: true,
    outdated,
    current: now,
    latest: manifest.version,
    notes: outdated ? cut(manifest.notes, 400) : '',
    downloadUrl: outdated ? (manifest.downloadUrl || MOD_UPDATE_FALLBACK_URL) : '',
    file: outdated ? cut(manifest.file, 200) : '',
    bytes: outdated ? (Number(manifest.bytes) || 0) : 0,
  };
}
