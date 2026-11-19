import { HEX_CATALOG, hexBondCardBlocked } from '../../../shared/hexCatalog.js';
import { createRng, deriveSeed } from '../../sim/rng.js';

const rarityKeys = { '银': 'silver', '金': 'gold', '彩': 'prismatic' };
const cards = HEX_CATALOG.map((card, i) => ({ ...card, id: `hex_${i}` }));
const repeatable = new Set(['产能不足喵', '真的产能不足喵', '真的真的产能不足喵']);

export class MatchHex {
  openHexWindow() {
    const settings = this.globalSettings;
    const players = this.alivePlayers().filter(p => !p.left);
    if (!settings.hexEnabled || !settings.hexRounds.includes(this.round) || !players.length) return false;
    if (typeof this.opts.hexEffectAvailable !== 'function' || typeof this.opts.onHexSelected !== 'function') {
      this.reportError('hex', new Error('海克斯效果接口未接入：需要 hexEffectAvailable 和 onHexSelected'));
      return false;
    }
    const windowSec = this.mode === 'solo' ? 0 : settings.hexSelectionSeconds;
    const w = { id: 'hex', pluginId: 'hex', seq: this.offerSeq++, at: 'prep', round: this.round,
      slots: 3, quorum: 'all', deadline: windowSec ? this.sched.now() + this.scaled(windowSec * 1000) : 0,
      offer: { windowSec }, refresh: { perSlot: 1 },
      options: new Map(), picks: new Map(), refreshUsed: new Map(), seen: new Map(), rng: new Map(), rarity: new Map(), closed: false, hex: true };
    for (const ps of players) {
      const rng = createRng(deriveSeed(this.seed, `hex:${this.round}:${ps.seat}`));
      w.rng.set(ps.playerId, rng);
      w.rarity.set(ps.playerId, rng.weighted(Object.keys(rarityKeys), r => settings.hexRarityWeights[rarityKeys[r]]));
      w.seen.set(ps.playerId, new Set());
      const selection = settings.hexCustomEnabled ? this.opts.hexSelections?.[ps.playerId]?.[this.round] : null;
      const custom = cards.find(c => c.id === selection || c.name === selection);
      const options = [];
      if (selection && !custom) {
        this.reportError('hex', new Error(`海克斯自选不存在: ${ps.playerId} ${selection}`));
      } else if (custom) {
        const unavailable = !this.hexPickAvailable(ps, custom);
        if (unavailable) this.reportError('hex', new Error(`海克斯自选不可用: ${ps.playerId} ${selection}`));
        options.push({ ...custom, custom: true, unavailable });
        w.seen.get(ps.playerId).add(custom.id);
      }
      while (options.length < 3) {
        const card = this.drawHex(w, ps);
        if (!card) break;
        options.push(card);
      }
      if (options.length !== 3) this.reportError('hex', new Error(`候选海克斯不足三项: ${ps.playerId} 第${this.round}回合，实际${options.length}项`));
      if (!options.length) continue;
      w.options.set(ps.playerId, options);
      w.refreshUsed.set(ps.playerId, Array(options.length).fill(0));
    }
    if (!w.options.size) return false;
    this.offerWin.push(w);
    if (windowSec) this._offerTimers.set(w, this.later(this.scaled(windowSec * 1000), () => this._offerDeadline(w)));
    for (const ps of players) if (ps.botControlled && w.options.has(ps.playerId)) this._offerDefault(ps, w);
    this._offerSettleIfDone(w);
    this.markPublic();
    return !w.closed;
  }

  hexPickAvailable(ps, card) {
    const owned = ps.hexPicks || [];
    return this.opts.hexEffectAvailable(this, ps, card)
      && (repeatable.has(card.name) || !owned.some(p => card.id && p.id === card.id || p.name === card.name))
      && !card.incompatibleWith?.some(name => owned.some(p => p.name === name))
      && !owned.some(p => cards.find(c => c.name === p.name)?.incompatibleWith?.includes(card.name));
  }

  drawHex(w, ps) {
    const seen = w.seen.get(ps.playerId);
    const owned = ps.hexPicks || [];
    const disabled = new Set([...this.disabledBonds, ...this.staticInactiveBonds].map(id => this.gd.bond(id)?.name || id));
    const ownedCards = owned.map(x => cards.find(c => c.id === x.id || c.name === x.name)).filter(Boolean);
    const reinforcementPicked = ownedCards.some(c => c.tags?.includes('盟约') && c.tags?.includes('增援'));
    const offerIndex = this.globalSettings.hexRounds.filter(r => r <= w.round).length;
    const eligible = cards.filter(c => this.opts.hexEffectAvailable(this, ps, c)
      && (repeatable.has(c.name) || !seen.has(c.id) && !ownedCards.includes(c))
      && !(c.natural?.maxRound && w.round > c.natural.maxRound)
      && !hexBondCardBlocked(c, offerIndex, disabled)
      && !(reinforcementPicked && c.tags?.includes('盟约') && c.tags?.includes('增援'))
      && !c.incompatibleWith?.some(name => ownedCards.some(x => x.name === name))
      && !ownedCards.some(x => x.incompatibleWith?.includes(c.name)));
    const rng = w.rng.get(ps.playerId);
    const preferred = w.rarity.get(ps.playerId);
    let pool = eligible.filter(c => c.rarity === preferred && !c.natural?.fallbackOnly);
    if (!pool.length) pool = eligible.filter(c => c.rarity === preferred && c.natural?.fallbackOnly);
    if (!pool.length) {
      pool = eligible.filter(c => !c.natural?.fallbackOnly);
      if (!pool.length) pool = eligible;
      const weights = this.globalSettings.hexRarityWeights;
      const rarities = Object.keys(rarityKeys).filter(r => pool.some(c => c.rarity === r));
      const rarity = rng.weighted(rarities, r => weights[rarityKeys[r]]) || rng.pick(rarities);
      pool = pool.filter(c => c.rarity === rarity);
    }
    const card = rng.pick(pool);
    if (card) seen.add(card.id);
    return card || null;
  }

  applyHex(ps, w, idx) {
    const card = w.options.get(ps.playerId)[idx];
    if (card.unavailable || !this.hexPickAvailable(ps, card)) return false;
    if (!ps.hexPicks) ps.hexPicks = [];
    const pick = { id: card.id, name: card.name, rarity: card.rarity, round: w.round, custom: !!card.custom };
    ps.hexPicks.push(pick);
    try { this.opts.onHexSelected(this, ps, pick, card); } catch (e) {
      const index = ps.hexPicks.indexOf(pick);
      if (index !== -1) ps.hexPicks.splice(index, 1);
      this.reportError('onHexSelected', e);
      return false;
    }
    this.markPrivate(ps);
    return true;
  }
}
