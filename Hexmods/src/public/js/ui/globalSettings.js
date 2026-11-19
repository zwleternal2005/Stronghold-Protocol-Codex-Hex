import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, Modal } from './components.js';
import { t } from '../../../shared/i18n.js';
import { GLOBAL_SETTINGS_DEFAULTS, normalizeGlobalSettings, OPERATOR_LAYER_CAP_SCALES } from '../../../shared/globalSettings.js';
import { loadPref, savePref } from '../store.js';
import { HEX_CATALOG, HEX_IMPLEMENTED } from '../../../shared/hexCatalog.js';
import { isHexSelection } from '../../../shared/protocol.js';
import { PersonalHexPicker } from './hexPickEditor.js';

export function loadPersonalHex() {
  const picks = loadPref('lobby.personalHex', {});
  return isHexSelection(picks) ? picks : {};
}

const selectableHex = new Set([...HEX_IMPLEMENTED, ...HEX_CATALOG.filter(card => card.operators).map(card => card.name)]);

const GLOBAL_SETTINGS_PREF = 'lobby.globalSettings';

export function loadGlobalSettingsPref() {
  try { return normalizeGlobalSettings(loadPref(GLOBAL_SETTINGS_PREF, {})); } catch { return normalizeGlobalSettings(); }
}

export function canEditGlobalSettings(room, myId) {
  return room?.creatorId != null && myId != null && room.creatorId === myId;
}

export function GlobalSettingsButton({ onClick, class: cls }) {
  return html`<${Button} variant="secondary" size="sm" icon="rook" class=${cls}
    title=${t('全局设置')} aria-label=${t('全局设置')} data-testid="global-settings-btn" onClick=${onClick}>${t('全局设置')}<//>`;
}

const DIFFICULTY_ROWS = [
  ['enemyHpBonus', '怪物生命值提升'],
  ['enemyAtkBonus', '怪物攻击力提升'],
  ['allyHpBonus', '干员生命值提升'],
  ['allyAtkBonus', '干员攻击力提升'],
];
const OPERATOR_CAP_LABELS = new Map([[-2, '-100%'], [-1, '-50%'], [0, '0%'], [1, '50%'], [2, '100%'], [3, '无上限']]);

function SettingSwitch({ id, label, checked, disabled, onChange, hint = '' }) {
  return html`<label class=${`global-setting global-setting--switch${disabled ? ' is-disabled' : ''}`} data-testid=${`global-setting-${id}`}>
    <span class="global-setting__copy"><b>${t(label)}</b>${hint ? html`<small>${t(hint)}</small>` : null}</span>
    <input type="checkbox" role="switch" checked=${checked === true} disabled=${disabled} onChange=${(e) => onChange(e.target.checked)} />
    <span class="global-setting__switch" aria-hidden="true"></span>
  </label>`;
}

function SettingSlider({ id, label, value, disabled, onChange, min = 0, max = 10, format = (v) => `${Math.max(0, Math.min(10, Number(v) || 0)) * 10}%`, hint = '每档 10%，最高 100%' }) {
  const range = min === 0 && max === 10
    ? html`<input type="range" min="0" max="10" step="1" value=${Number(value) || 0} disabled=${disabled}
        aria-label=${t(label)} onInput=${(e) => onChange(Number(e.target.value))} />`
    : html`<input type="range" min=${min} max=${max} step="1" value=${Number(value) || 0} disabled=${disabled}
        aria-label=${t(label)} onInput=${(e) => onChange(Number(e.target.value))} />`;
  return html`<label class=${`global-setting global-setting--slider${disabled ? ' is-disabled' : ''}`} data-testid=${`global-setting-${id}`}>
    <span class="global-setting__copy"><b>${t(label)}</b><small>${t(hint)}</small></span>
    <span class="global-setting__control">${range}<output>${format(value)}</output></span>
  </label>`;
}

export function GlobalSettingsModal({ room = null, roomMode = null, myId = null, beforeCreate = false, settings = null, onSave = null, onClose, onOpenHexCatalog = null, onEditPersonalHex = null }) {
  const editable = (beforeCreate && !room) || canEditGlobalSettings(room, myId);
  const source = settings || room?.globalSettings || GLOBAL_SETTINGS_DEFAULTS;
  const [draft, setDraft] = useState(() => normalizeGlobalSettings(source));
  const [activePage, setActivePage] = useState('difficulty');
  const [saving, setSaving] = useState(false);
  const [personalHex, setPersonalHex] = useState(loadPersonalHex);
  const [personalOpen, setPersonalOpen] = useState(false);
  const savePersonal = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (typeof onEditPersonalHex === 'function' && await onEditPersonalHex(personalHex) === false) return;
      savePref('lobby.personalHex', personalHex);
      setPersonalOpen(false);
    } finally { setSaving(false); }
  };
  const [weights, setWeights] = useState(() => ({ ...draft.hexRarityWeights }));
  useEffect(() => {
    const next = normalizeGlobalSettings(settings || room?.globalSettings || GLOBAL_SETTINGS_DEFAULTS);
    setDraft(next);
    setWeights({ ...next.hexRarityWeights });
  }, [room?.globalSettings, settings]);
  const validWeights = ['silver', 'gold', 'prismatic'].every((key) => Number.isInteger(weights[key]) && weights[key] >= 0 && weights[key] <= 100)
    && weights.silver + weights.gold + weights.prismatic === 100;
  const patch = (key, value) => {
    if (!editable || saving) return;
    setDraft(normalizeGlobalSettings({ ...draft, [key]: value }));
  };
  const save = async () => {
    if (!editable || saving || typeof onSave !== 'function') return;
    if (!validWeights) return;
    const snapshot = normalizeGlobalSettings({ ...draft, hexRarityWeights: weights });
    setSaving(true);
    try {
      const draft = snapshot;
      const ok = await onSave(draft);
      if (ok !== false) {
        savePref(GLOBAL_SETTINGS_PREF, normalizeGlobalSettings(draft));
        onClose?.();
      }
    } finally { setSaving(false); }
  };
  const capIndex = Math.max(0, OPERATOR_LAYER_CAP_SCALES.indexOf(draft.operatorLayerCapScale));
  return html`<${Modal} open=${true} title=${t('全局设置')} micro="GLOBAL SETTINGS" tone="red" class="global-settings" onClose=${onClose}
    actions=${html`<${Button} variant="secondary" icon="close" data-autofocus onClick=${onClose}>${t('关闭')}<//>
      <${Button} variant="primary" disabled=${!editable || saving || !validWeights} data-testid="global-settings-save" onClick=${save}>${saving ? t('保存中…') : t('保存设置')}<//>`}>
    <p class="modal__text" data-testid="global-settings-access" data-editable=${String(editable)}><${Icon} name=${editable ? 'edit' : 'eye'} /> ${editable
      ? beforeCreate && !room ? t('创建者 · 可编辑（创建房间前）') : t('创建者 · 可编辑')
      : t('只读 · 仅最初创建者可编辑')}</p>
    <nav class="global-settings__tabs" role="tablist" aria-label=${t('全局设置分类')}>
      <button type="button" role="tab" aria-selected=${activePage === 'difficulty'} class=${activePage === 'difficulty' ? 'is-active' : ''} data-testid="global-settings-tab-difficulty" onClick=${() => setActivePage('difficulty')}>${t('难度设置')}</button>
      <button type="button" role="tab" aria-selected=${activePage === 'gameplay'} class=${activePage === 'gameplay' ? 'is-active' : ''} data-testid="global-settings-tab-gameplay" onClick=${() => setActivePage('gameplay')}>${t('玩法设置')}</button>
      <button type="button" role="tab" aria-selected=${activePage === 'hex'} class=${activePage === 'hex' ? 'is-active' : ''} data-testid="global-settings-tab-hex" onClick=${() => setActivePage('hex')}>${t('海克斯设置')}</button>
    </nav>
    ${activePage === 'difficulty' ? html`<section class="global-settings__group" role="tabpanel" aria-labelledby="global-settings-difficulty">
      <h3 id="global-settings-difficulty"><${Icon} name="skull" />${t('难度设置')}</h3>
      <${SettingSwitch} id="difficultyMercy" label="鹰角的仁慈" checked=${draft.difficultyMercy} disabled=${!editable}
        hint="全局怪物生命值、攻击力下降 30%，默认开启" onChange=${(v) => patch('difficultyMercy', v)} />
      ${DIFFICULTY_ROWS.map(([id, label]) => html`<${SettingSlider} key=${id} id=${id} label=${label} value=${draft[id]} disabled=${!editable} onChange=${(v) => patch(id, v)} />`)}
      <${SettingSwitch} id="infiniteFunds" label="无限费用" checked=${draft.infiniteFunds} disabled=${!editable}
        hint="游戏内费用始终为 99，默认关闭" onChange=${(v) => patch('infiniteFunds', v)} />
    </section>` : activePage === 'gameplay' ? html`<section class="global-settings__group" role="tabpanel" aria-labelledby="global-settings-gameplay">
      <h3 id="global-settings-gameplay"><${Icon} name="rook" />${t('玩法设置')}</h3>
      <${SettingSwitch} id="classicAutoChess" label="经典自走棋模式" checked=${draft.classicAutoChess} disabled=${!editable}
        hint="回合结束保留资金，每 10 资金使下回合额外获得 1 资金，并与坎诺特盟约叠加" onChange=${(v) => patch('classicAutoChess', v)} />
      <${SettingSwitch} id="bondLayerUncap" label="解除盟约层数上限" checked=${draft.bondLayerUncap} disabled=${!editable}
        hint="解除原版 999 层限制，并继续按原有叠层比例增加效果，默认开启" onChange=${(v) => patch('bondLayerUncap', v)} />
      <${SettingSlider} id="operatorLayerCapScale" label="干员叠层上限" value=${capIndex} min="0" max="5" disabled=${!editable}
        hint="调整干员特质中每回合 / 每场战斗的叠层上限" format=${() => OPERATOR_CAP_LABELS.get(OPERATOR_LAYER_CAP_SCALES[capIndex]) || '0%'}
        onChange=${(v) => patch('operatorLayerCapScale', OPERATOR_LAYER_CAP_SCALES[Math.max(0, Math.min(5, v))])} />
      <div class="global-setting global-setting--locked" data-testid="global-setting-endless">
        <span class="global-setting__copy"><b>${t('无尽关卡')}</b><small>${t('研发中 / 未开放')}</small></span>
        <button type="button" disabled aria-disabled="true">${t('研发中 / 未开放')}</button>
      </div>
    </section>` : html`<section class="global-settings__group" role="tabpanel" aria-labelledby="global-settings-hex">
      <h3 id="global-settings-hex">${t('海克斯设置')}</h3>
      <${SettingSwitch} id="hexEnabled" label="启用海克斯" checked=${draft.hexEnabled} disabled=${!editable || saving} onChange=${(v) => patch('hexEnabled', v)} />
      <fieldset class="global-settings__rounds" disabled=${!editable || saving}>
        <legend>${t('出现回合')}</legend>
        ${Array.from({ length: 14 }, (_, i) => i + 1).map((round) => html`<label key=${round}><input type="checkbox" checked=${draft.hexRounds.includes(round)} onChange=${(e) => patch('hexRounds', e.target.checked ? [...draft.hexRounds, round] : draft.hexRounds.filter((n) => n !== round))} /><span>${round}</span></label>`)}
      </fieldset>
      <${SettingSwitch} id="hexCustomEnabled" label="启用自选" checked=${draft.hexCustomEnabled} disabled=${!editable || saving} onChange=${(v) => patch('hexCustomEnabled', v)} />
      <div class="global-settings__weights" data-testid="hex-rarity-weights">
        ${[['silver', '银'], ['gold', '金'], ['prismatic', '彩']].map(([key, label]) => html`<label key=${key}>${t(label)} <input type="number" min="0" max="100" step="1" value=${weights[key]} disabled=${!editable || saving} onInput=${(e) => setWeights({ ...weights, [key]: e.target.value === '' ? null : e.target.valueAsNumber })} /> %</label>`)}
        <span role=${validWeights ? undefined : 'alert'}>${t('总和')}：${Object.values(weights).every(Number.isInteger) ? weights.silver + weights.gold + weights.prismatic : '—'} / 100</span>
      </div>
      ${(room?.mode ?? roomMode) !== 'solo' ? html`<${SettingSlider} id="hexSelectionSeconds" label="选择时间" value=${draft.hexSelectionSeconds} min=${1} max=${60} disabled=${!editable || saving} hint="1–60 秒" format=${(v) => `${v} 秒`} onChange=${(v) => patch('hexSelectionSeconds', v)} />` : null}
      <div class="global-settings__hex-actions">
        <button type="button" disabled=${typeof onOpenHexCatalog !== 'function'} onClick=${() => onOpenHexCatalog?.()}>${t('海克斯图鉴')}${typeof onOpenHexCatalog !== 'function' ? t('（未接入）') : ''}</button>
        <button type="button" disabled=${!!room && typeof onEditPersonalHex !== 'function'} onClick=${() => setPersonalOpen((v) => !v)}>${t('个人自选编辑')}</button>
      </div>
      ${personalOpen ? html`<div data-testid="personal-hex-editor">
        <${PersonalHexPicker} rounds=${draft.hexRounds} picks=${personalHex} selectable=${selectableHex}
          disabled=${saving} onChange=${(next) => setPersonalHex(next)} />
        <${Button} disabled=${saving} onClick=${savePersonal}>${t('保存个人自选')}<//>
      </div>` : null}
    </section>`}
  <//>`;
}
