// server/hexmodUpdate.js — 规程海克斯模组的「检查更新」（网盘渠道）。
//
// 服务端启动时（之后每 CHECK_INTERVAL_MS）去发布渠道拿「最新版本号」，与本地 MOD_VERSION 比对并缓存；
// 浏览器从标题屏打**同源的** `GET /update-check`（routes.js）拿这份缓存 —— 远端请求只在服务端发生，
// 浏览器不出跨域请求，也不会因为网盘接口挂掉而卡在标题屏。
//
// 支持两种渠道（按 URL 形状自动识别）：
//   1) 夸克网盘分享（`https://pan.quark.cn/s/<id>`，可带 `?pwd=`）：匿名走分享接口列目录（token → 逐层扫描），
//      从文件名里提取版本号（如 `卫戍协议：规程 海克斯模组 v0.1.2.zip`），取最大者为最新版。
//   2) 普通 JSON 清单：`{ "version": "…", "notes": "…", "downloadUrl": "https://…" }`。
//
// **世代隔离**：同一个分享根下并存第一代「盟约」与第二代「规程」。扫描只认相对路径里含
// MOD_UPDATE_SCOPE_DEFAULT（'规程'）的那一支 —— 否则两代的版本号会在同一条小数轴上互相压过，
// 把规程玩家引去下载第一代的包（反之亦然）。`SP_MOD_UPDATE_SCOPE` 可覆盖（空串 = 扫全树）。
//
// 纪律：这条检查绝不阻塞启动、绝不抛进请求路径。拉不到/解析不了就退化成 checked:false，标题屏不弹窗。

import { MOD_VERSION } from '../shared/constants.js';
import {
  MOD_UPDATE_URL_DEFAULT, MOD_UPDATE_SCOPE_DEFAULT,
  compareModVersions, versionFromFileName, parseUpdateManifest, updateCheckView,
} from '../shared/modUpdate.js';

/** `GET /update-check` 的唯一路径（routes.js 同值）。 */
export const UPDATE_CHECK_URL = '/update-check';
const FETCH_TIMEOUT_MS = 8000;
const CHECK_INTERVAL_MS = 30 * 60_000;

/** 夸克分享链接（可带 ?pwd= 提取码）。 */
export const QUARK_SHARE_RE = /pan\.quark\.cn\/s\/([a-zA-Z0-9]+)/i;

export const quarkShareId = (url) => QUARK_SHARE_RE.exec(String(url || ''))?.[1] || null;

/**
 * 从一页夸克文件列表里挑最新版本（纯函数）：只看文件（file_type ≠ 0），版本号取自文件名。
 * @param {Array<{ file_name: string, file_type?: number, size?: number }>} list
 * @returns {{ version: string, name: string, size: number } | null}
 */
export function newestVersionedFile(list) {
  let best = null;
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || typeof f.file_name !== 'string' || (f.file_type ?? 1) === 0) continue;
    const v = versionFromFileName(f.file_name);
    if (!v) continue;
    if (!best || compareModVersions(v, best.version) > 0) {
      best = { version: v, name: f.file_name, size: Number(f.size) || 0 };
    }
  }
  return best;
}

/**
 * @param {{ url?: string, current?: string, fetchImpl?: typeof fetch, now?: () => number, log?: object,
 *           timeoutMs?: number, intervalMs?: number, scope?: string }} opts
 */
export function createModUpdateChecker(opts = {}) {
  const url = opts.url || process.env.SP_MOD_UPDATE_URL || MOD_UPDATE_URL_DEFAULT;
  const current = opts.current || MOD_VERSION;
  const doFetch = opts.fetchImpl || ((...a) => globalThis.fetch(...a));
  const now = opts.now || (() => Date.now());
  const log = opts.log || null;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? CHECK_INTERVAL_MS;
  const scope = opts.scope ?? process.env.SP_MOD_UPDATE_SCOPE ?? MOD_UPDATE_SCOPE_DEFAULT;
  const inScope = (rel) => !scope || String(rel).includes(scope);

  let lastView = updateCheckView(current, null);
  let lastAt = 0;
  let inflight = false;

  const note = (line, err) => {
    if (!log) return;
    if (err) log.warn?.(`[modupd] ${line}`, err); else log.info?.(`[modupd] ${line}`);
  };

  const jtext = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const QK = 'https://drive-pc.quark.cn/1/clouddrive';
  const qs = 'pr=ucpro&fr=pc';

  async function quarkManifest(shareUrl) {
    const id = quarkShareId(shareUrl);
    if (!id) throw new Error('not a quark share url');
    let passcode = '';
    try {
      const q = new URL(shareUrl).searchParams;
      passcode = q.get('pwd') || q.get('passcode') || '';
    } catch { /* 无查询串 */ }
    const deadline = now() + timeoutMs;
    const left = () => deadline - now();
    const post = async (u, body) => {
      const r = await doFetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (left() <= 0) throw new Error('timeout');
      const j = await r.json();
      if (j.status !== 200 || !j.data) throw new Error(`quark api status ${j.status}（${j.message || '分享可能已取消或需要提取码'}）`);
      return j.data;
    };
    const getJson = async (u) => {
      const r = await doFetch(u);
      if (left() <= 0) throw new Error('timeout');
      const j = await r.json();
      if (j.status !== 200) throw new Error(`quark api status ${j.status}`);
      return j.data || {};
    };
    const tok = await post(`${QK}/share/sharepage/token?${qs}`, { pwd_id: id, passcode });
    const stoken = encodeURIComponent(tok.stoken);
    // 逐层扫目录（depth ≤ 3）：分享根 → 世代目录 → 版本子目录；目录一律下探，文件按相对路径做世代过滤。
    let best = null;
    const walk = async (fid, depth, trail) => {
      if (depth > 3 || left() <= 0) return;
      const u = `${QK}/share/sharepage/detail?${qs}&pwd_id=${id}&stoken=${stoken}&pdir_fid=${fid || '0'}&_page=1&_size=200&_fetch_banner=0&_fetch_share=0&_fetch_total=1&_sort=file_type:asc,updated_at:desc`;
      const d = await getJson(u);
      for (const f of d.list || []) {
        const rel = `${trail}/${f.file_name}`;
        if (f.file_type === 0) { await walk(f.fid, depth + 1, rel); continue; }
        if (!inScope(rel)) continue;
        const v = versionFromFileName(f.file_name);
        if (v && (!best || compareModVersions(v, best.version) > 0)) {
          best = { version: v, name: jtext(f.file_name, 200), size: Number(f.size) || 0 };
        }
      }
    };
    await walk('0', 0, '');
    if (!best) throw new Error(scope ? `分享里没有「${scope}」的带版本号文件` : '分享里没有带版本号的文件');
    return { version: best.version, notes: '', downloadUrl: shareUrl, file: best.name, bytes: best.size };
  }

  async function jsonManifest(u) {
    const r = await doFetch(u, { headers: { accept: 'application/json' } });
    if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : 'no response'}`);
    const manifest = parseUpdateManifest(await r.json());
    if (!manifest) throw new Error('bad manifest shape');
    return manifest;
  }

  /** 拉一次远端版本并刷新缓存；任何失败都吞掉（checked:false），只影响这一次结果。 */
  async function check() {
    if (inflight) return lastView;
    inflight = true;
    try {
      const manifest = quarkShareId(url) ? await quarkManifest(url) : await jsonManifest(url);
      lastView = updateCheckView(current, manifest);
      lastAt = now();
      if (lastView.outdated) note(`发现新版本 v${manifest.version}（本地 v${current}）—— 标题屏会弹更新窗口`);
      else note(`已是最新版本 v${current}`);
    } catch (e) {
      lastView = updateCheckView(current, null);
      lastAt = now();
      note(`检查更新失败（不影响进入游戏）：${e && e.message ? e.message : e}`, e);
    } finally {
      inflight = false;
    }
    return lastView;
  }

  /** 浏览器请求的同步视图：缓存有效期内直接回；过期了就后台补查（本次仍回旧值，绝不等待网络）。 */
  function status() {
    if (!inflight && now() - lastAt > intervalMs) check().catch(() => {});
    return lastView;
  }

  return { check, status, url, current, scope };
}
