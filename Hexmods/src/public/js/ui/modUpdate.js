// public/js/ui/modUpdate.js — 标题屏的「网盘有新版本」提醒（规程海克斯模组）。
//
// 数据：同源 `GET /update-check`（server/hexmodUpdate.js 的缓存视图）。网盘由服务端去拉，
// 浏览器不出跨域请求，检查失败也只是 checked:false —— 这里什么都不画，绝不挡住开始游戏。
//
// 行为：
//   * 标题屏打开后查一次（之后每 5 分钟补查）；有更新的版本时在徽标下方显示「有新版本 vX」入口；
//   * **不在游戏内自动弹窗**：自动校验与推送由启动器负责（同一份网盘、同一个世代过滤），
//     进游戏后再弹一次只会重复打断。玩家想看详情就点入口，窗口里有「前往网盘下载」和「暂不更新」。

import { html, Modal, Button, Icon } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { t } from '../../../shared/i18n.js';
import { MOD_UPDATE_FALLBACK_URL } from '../../../shared/modUpdate.js';

const POLL_MS = 5 * 60_000;

/** 同源拉一次检查结果；拿不到就保持 null（不弹窗）。 */
export function useModUpdateCheck() {
  const [view, setView] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/update-check', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => { if (alive && v && typeof v === 'object') setView(v); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return view;
}

const sizeText = (n) => {
  const b = Number(n) || 0;
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(2)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(b / 1024))} KB`;
};

/**
 * 标题屏的更新提醒：有新版本时自动弹出窗口，关掉后留一个可点开的入口。
 * 只在规程启动时渲染（title.js 里按 regStart 判断）。
 */
export function ModUpdateNotice() {
  const view = useModUpdateCheck();
  const [open, setOpen] = useState(false);

  const latest = view && view.outdated ? String(view.latest || '') : '';
  const current = String((view && view.current) || '');
  const file = String((view && view.file) || '');
  const bytes = Number(view && view.bytes) || 0;

  if (!latest) return null;

  const dismiss = () => { setOpen(false); };
  const openNetdisk = () => {
    const url = (view && view.downloadUrl) || MOD_UPDATE_FALLBACK_URL;
    try { window.open(url, '_blank', 'noopener'); } catch { /* 弹窗被拦：地址仍显示在窗口里 */ }
  };

  return html`
    <button type="button" class="title-update" data-testid="title-update" onClick=${() => setOpen(true)}
      title=${t('网盘有更新，点开查看')}>
      <${Icon} name="download" class="title-update__icon" />
      <span>${t('有新版本')} <b>v${latest}</b></span>
    </button>
    <${Modal} open=${open} onClose=${dismiss} tone="gold" width="min(5.6rem, 92vw)"
      micro="MOD UPDATE" title=${t('发现新版本')} actions=${html`
        <${Button} variant="ghost" onClick=${dismiss}>${t('暂不更新')}<//>
        <${Button} variant="primary" icon="download" onClick=${openNetdisk}>${t('前往网盘下载')}<//>
      `}>
      <div class="modupd">
        <p class="modupd__ver">
          <span class="modupd__cur">v${current}</span>
          <span class="modupd__arrow" aria-hidden="true">→</span>
          <b class="modupd__new">v${latest}</b>
        </p>
        ${file ? html`<p class="modupd__file"><${Icon} name="info" class="modupd__ico" />${file}${bytes ? html` <em>· ${sizeText(bytes)}</em>` : null}</p>` : null}
        <p class="modupd__hint">${t('前往夸克网盘下载新版本，解压覆盖当前游戏目录后重新启动即可。')}</p>
        <p class="modupd__hint modupd__hint--soft">${t('选择「暂不更新」不会影响当前版本游玩，之后仍可从标题屏的入口回来更新。')}</p>
      </div>
    <//>
  `;
}
