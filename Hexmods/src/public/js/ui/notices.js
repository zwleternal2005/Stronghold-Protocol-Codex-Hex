// Version announcements are maintained by the mod author and shared with 更新说明.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from './components.js';
import { t } from '../../../shared/i18n.js';
import { LargeBondShowcase } from './releaseNotes.js';

export function NoticesButton() {
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/announcements', { cache: 'no-cache' }).then((res) => res.ok ? res.json() : null).then((payload) => {
      if (!cancelled && payload?.published === true && typeof payload.content === 'string' && payload.content.trim()) setNotice(payload);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!notice) return null;
  return html`<span class="notice-slot">
    <button type="button" class="notice-entry tapx" data-testid="notices-open" aria-label=${t('公告')} onClick=${() => setOpen(true)}>${t('公告')}</button>
    <${Modal} open=${open} title=${notice.title || t('公告')} micro=${notice.version ? `v${notice.version}` : 'NOTICE'} onClose=${() => setOpen(false)}
      actions=${html`<${Button} variant="primary" onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
      <article class="notice-list"><p class="notice-card__body">${notice.content}</p><${LargeBondShowcase} text=${notice.content} /></article>
    <//>
  </span>`;
}
