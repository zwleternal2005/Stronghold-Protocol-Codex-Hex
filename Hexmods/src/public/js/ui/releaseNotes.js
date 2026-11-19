import { h } from '../../vendor/preact.module.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from './components.js';
import { createStore, useStore, selectRoute } from '../store.js';
import { APP_VERSION } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';
import { RELEASE_SEEN_PREFIX, announcementSections, releaseLink } from './releaseNotesModel.js';
import { HEX_CATALOG } from '../../../shared/hexCatalog.js';
import { HexIcon, hexIsMythic } from './hexIcon.js';

const request = createStore({ serial: 0 });
export function ReleaseNotesButton() {
  return html`<button type="button" class="title-repo release-notes-entry" onClick=${() => request.set((s) => ({ serial: s.serial + 1 }))}>${t('更新说明与公告')}</button>`;
}

function inline(text) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^\s)]+\)|https:\/\/[^\s<>"'\u3000-\u303f\uff00-\uffef]+)/g).map((part) => {
    if (part.startsWith('`')) return html`<code>${part.slice(1, -1)}</code>`;
    if (part.startsWith('**')) return html`<strong>${part.slice(2, -2)}</strong>`;
    if (part.startsWith('*')) return html`<em>${part.slice(1, -1)}</em>`;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link && releaseLink(link[2])) return html`<a href=${releaseLink(link[2])} target="_blank" rel="noopener noreferrer">${link[1]}</a>`;
    if (part.startsWith('https://') && releaseLink(part)) return html`<a href=${releaseLink(part)} target="_blank" rel="noopener noreferrer">${part}</a>`;
    return part;
  });
}

/** 大型盟约介绍从目录元数据生成，正文提到名称才附加，每张只展示一次。 */
export function LargeBondShowcase({ text = '' }) {
  const entries = HEX_CATALOG.filter(entry => entry.largeBond === true && text.includes(entry.name));
  if (!entries.length) return null;
  return html`<section class="hex-showcase" aria-label="大型盟约海克斯介绍">
    ${entries.map(entry => {
      const mythic = hexIsMythic(entry.name);
      const paragraphs = entry.effect.split(/\r?\n+|(?<=[。；;])\s*(?=(?:[【（(]\s*)?(?:9|12|九|十二)\s*(?:人|名|位|[）)】]|盟约))/u).filter(part => part.trim());
      return html`<article key=${entry.name} class=${`hex-feature hex-r-${entry.rarity}${mythic ? ' hex-mythic' : ''}`}>
        <div class="hex-feature__art" aria-hidden="true">
          <span class="hex-feature__orbit"></span>
          <${HexIcon} name=${entry.name} rarity=${entry.rarity} alt="" />
        </div>
        <div class="hex-feature__body">
          <div class="hex-feature__meta"><span class=${mythic ? 'hex-mythic-badge' : 'hex-feature__tier'}>${mythic ? '神话' : `${entry.rarity}色`}</span><span>${entry.bond ? `${entry.bond} · ` : ''}大型盟约专属</span></div>
          <h3 class="hex-feature__name">${entry.name}</h3>
          <div class="hex-feature__effect">${paragraphs.map((paragraph, index) => html`<p key=${index}>${paragraph}</p>`)}</div>
          ${entry.note ? html`<p class="hex-feature__note">${entry.note}</p>` : null}
        </div>
      </article>`;
    })}
  </section>`;
}

/** 保留原有 Markdown 正文解析，再附加大型盟约介绍。 */
export function ReleaseMarkdown({ text }) {
  const blocks = [];
  const lines = text.trim().split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^```/.test(line)) {
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      blocks.push(html`<pre><code>${code.join('\n')}</code></pre>`);
    } else if (/^#{3,6} /.test(line)) {
      const [, hashes, title] = line.match(/^(#+) (.*)$/);
      blocks.push(h(`h${hashes.length}`, {}, inline(title)));
    } else if (/^[-*] /.test(line)) {
      const items = [];
      do { items.push(html`<li>${inline(lines[i].slice(2))}</li>`); } while (++i < lines.length && /^[-*] /.test(lines[i]));
      i--;
      blocks.push(html`<ul>${items}</ul>`);
    } else blocks.push(html`<p>${inline(line)}</p>`);
  }
  return html`<article class="release-notes-body">${blocks}<${LargeBondShowcase} text=${text} /></article>`;
}

export function ReleaseNotesHost() {
  const safe = useStore((s) => ['title', 'lobby'].includes(selectRoute(s)) && !s.ui.restoring);
  const serial = useStore((s) => s.serial, Object.is, request);
  const [sections, setSections] = useState([]);
  const [releaseVersion, setReleaseVersion] = useState(APP_VERSION);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const attempted = useRef(false);
  const handled = useRef(0);
  useEffect(() => {
    if (!safe) return undefined;
    const manual = serial !== handled.current;
    if (!manual && attempted.current) return undefined;
    let seen = false;
    try { seen = localStorage.getItem(RELEASE_SEEN_PREFIX + APP_VERSION) === '1'; } catch { /* private mode: once per page */ }
    if (!manual && seen) return undefined;
    let cancelled = false;
    fetch('/api/announcements', { cache: 'no-cache' }).then((res) => {
      if (!res.ok) throw new Error(`announcements: ${res.status}`);
      return res.json();
    }).then((payload) => {
      const entries = announcementSections(payload);
      if (cancelled) return;
      attempted.current = true; handled.current = serial;
      if (!entries.length) { setSections([]); setFailed(false); setOpen(false); return; }
      setSections(entries); setReleaseVersion(payload.version || APP_VERSION); setIndex(0); setFailed(false); setOpen(true);
    }).catch(() => {
      if (cancelled) return;
      attempted.current = true; handled.current = serial;
      if (manual) { setFailed(true); setOpen(true); }
    });
    return () => { cancelled = true; };
  }, [safe, serial]);
  const close = () => {
    if (!failed && sections.length) {
      try { localStorage.setItem(RELEASE_SEEN_PREFIX + releaseVersion, '1'); } catch { /* private mode */ }
    }
    setOpen(false);
  };
  return html`<${Modal} open=${safe && open} title=${t('更新说明与公告')} micro=${failed ? '' : sections[index]?.title}
    class="release-notes" width="min(10rem, 94vw)" onClose=${close}
    actions=${html`<${Button} disabled=${failed || index === 0} onClick=${() => setIndex(index - 1)}>${t('更新版本')}<//>
      <${Button} disabled=${failed || index >= sections.length - 1} onClick=${() => setIndex(index + 1)}>${t('更早版本')}<//>
      <${Button} variant="primary" onClick=${close}>${t('关闭')}<//>`}>
    ${failed ? html`<p>${t('更新说明加载失败，请稍后重试。')}</p>` : html`<${ReleaseMarkdown} key=${index} text=${sections[index]?.body || ''} />`}
  <//>`;
}
