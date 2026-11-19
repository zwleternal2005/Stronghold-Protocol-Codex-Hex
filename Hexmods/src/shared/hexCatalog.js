// 仅记录策划元数据；不表示效果或出现规则已经实装。
// 文案以《第一批海克斯池.xls》Sheet1 原文为准改写为完整可读句；数值与限制不得删改。
export const HEX_NATURAL_RULES = {
  bondTag: { offerIndex: 1, excludeDisabledBond: true },
  bondReinforcement: { requiredTags: ['盟约', '增援'], maxPerGame: 1 },
  fallbackOnly: '普通候选池耗尽时兜底',
  manualSelectionBypassesAppearanceRestrictions: true,
};

export const HEX_IMPLEMENTED = Object.freeze(['安慰奖', '低阶调香', '众志合一', '众志合一+', '众志合一++',
  '可露希尔的资金夹', '产能不足喵', '真的产能不足喵', '真的真的产能不足喵', '苟住', '真得苟住',
  '血多不疼', '一阶增援', '维多利亚的低级补给', '随机白银', '随机黄金', '人生切片', '小小运营下', '文火猛炖', '奇迹！', '真正的奇迹！',
  '真知灼见', '华尔街之狼', '不再孤独', '屠宰与手术', '愈合于铿锵战火',
  // v0.1.3 新增 22 条（银 6 / 金 10 / 彩 6）
  '再就业回执', '空装上阵', '备用电容', '热身完毕', '结阵', '坚定风采',
  '花到上头', '超前投资', '重奏之影', '余音护航', '偏科补课', '坚定风采+',
  '引火成书', '重锤回响', '背水一战', '海克斯装备集成',
  '越级调度', '技力传递', '少而精', '第四艺术', '名刀司命！', '花到上头++',
  '魔王冠冕', '深海倾灭']);

export const HEX_CATALOG = [
  { name: '一阶增援', rarity: '银', effect: '获得四张一阶干员。', tags: ['增援', '经济'] },
  { name: '维多利亚的低级补给', rarity: '银', effect: '获得全部一阶装备各一张。', tags: ['装备', '经济'] },
  { name: '可露希尔的资金夹', rarity: '银', effect: '获得 8 资金，以及 1 次免费刷新。', tags: ['经济'] },
  { name: '炎小队增援', rarity: '银', effect: '获得拜松、矩、乌有各一张。', tags: ['盟约', '增援', '经济'], bond: '炎', operators: ['拜松', '矩', '乌有'] },
  { name: '阿戈尔小队增援', rarity: '银', effect: '获得幽灵鲨、安哲拉、深巡各一张。', tags: ['盟约', '增援', '经济'], bond: '阿戈尔', operators: ['幽灵鲨', '安哲拉', '深巡'] },
  { name: '卡西米尔小队增援', rarity: '银', effect: '获得野鬃、砾、历阵锐枪芬各一张。', tags: ['盟约', '增援', '经济'], bond: '卡西米尔', operators: ['野鬃', '砾', '历阵锐枪芬'] },
  { name: '莱塔尼亚小队增援', rarity: '银', effect: '获得地灵、折光、车尔尼各一张。', tags: ['盟约', '增援', '经济'], bond: '莱塔尼亚', operators: ['地灵', '折光', '车尔尼'] },
  { name: '萨尔贡小队增援', rarity: '银', effect: '获得艾斯黛尔、泡泡、卡涅利安各一张。', tags: ['盟约', '增援', '经济'], bond: '萨尔贡', operators: ['艾斯黛尔', '泡泡', '卡涅利安'] },
  { name: '维多利亚小队增援', rarity: '银', effect: '获得慕斯、哈洛德、凯瑟琳各一张。', tags: ['盟约', '增援', '经济'], bond: '维多利亚', operators: ['慕斯', '哈洛德', '凯瑟琳'] },
  { name: '乌萨斯小队增援', rarity: '银', effect: '获得折桠、真理、乌啾各一张。', tags: ['盟约', '增援', '经济'], bond: '乌萨斯', operators: ['折桠', '真理', '乌啾'] },
  { name: '谢拉格小队增援', rarity: '银', effect: '获得角峰、哈洛德、初雪各一张。', tags: ['盟约', '增援', '经济'], bond: '谢拉格', operators: ['角峰', '哈洛德', '初雪'] },
  { name: '叙拉古小队增援', rarity: '银', effect: '获得拉普兰德、奥斯塔、伺夜各一张。', tags: ['盟约', '增援', '经济'], bond: '叙拉古', operators: ['拉普兰德', '奥斯塔', '伺夜'] },
  { name: '伊比利亚小队增援', rarity: '银', effect: '获得深靛、瑰盐、海沫各一张。', tags: ['盟约', '增援', '经济'], bond: '伊比利亚', operators: ['深靛', '瑰盐', '海沫'] },
  { name: '人生切片', rarity: '银', effect: '立即获得一张当前回合数 ÷ 2（向上取整）阶的干员；此后每个休整期开始时再获得一张，直到获得 6 阶干员后停止。', tags: ['增援', '经济'], natural: { maxRound: 3 } },
  { name: '小小运营下', rarity: '银', effect: '本回合未购买任何干员或装备时，下回合获得 1 资金与 1 次免费刷新。', tags: ['经济'], note: '每回合重新计算' },
  { name: '安慰奖', rarity: '银', effect: '获得 8 资金，全体干员攻击力 +1%。', tags: ['经济', '战斗'] },
  { name: '随机白银', rarity: '银', effect: '获得一个随机银色海克斯，并获得 3 资金。', tags: ['随机', '经济'] },
  { name: '低阶调香', rarity: '银', effect: '所有干员每秒恢复 0.2% 生命值。', tags: ['战斗', '治疗'] },
  { name: '众志合一', rarity: '银', effect: '场上每有一种已激活的盟约，全体干员获得 3% 攻击与生命加成，以及 0.5% 全能穿透。', tags: ['战斗'] },
  { name: '苟住', rarity: '银', effect: '获得 6 点玩家生命值。', tags: ['生存'] },
  { name: '产能不足喵', rarity: '银', effect: '获得 10 资金与 1 次免费刷新。欢迎进群赞助给作者充电喵。', tags: ['经济'], natural: { fallbackOnly: true } },
  { name: '再就业回执', rarity: '银', effect: '立即获得 1 资金。每个休整期首次出售干员时，获得 1 次免费刷新。', tags: ['经济'] },
  { name: '空装上阵', rarity: '银', effect: '每场战斗开始时，未携带任何装备的干员获得 10% 攻击力与 10% 最大生命加成，持续至本场战斗结束。', tags: ['战斗'] },
  { name: '备用电容', rarity: '银', effect: '每场战斗开始时，干员额外获得 6 点初始技力，不超过该技能的技力上限。', tags: ['战斗', '技力'] },
  { name: '热身完毕', rarity: '银', effect: '开战 12 秒后，仍存活的干员获得 15 点攻击速度，持续至本场战斗结束。', tags: ['战斗'] },
  { name: '结阵', rarity: '银', effect: '每场战斗开始时，所有相邻的干员获得 500 最大生命值、10% 防御加成。', tags: ['战斗'] },
  { name: '坚定风采', rarity: '银', effect: '每场战斗每名干员仅触发一次，干员生命首次低于 30% 时回复 50% 最大生命值血量。', tags: ['战斗', '治疗'] },
  { name: '奇迹！', rarity: '金', effect: '你始终视为激活奇迹盟约；每个休整期开始时获得 5 层奇迹层数。', tags: ['盟约', '经济'], bond: '奇迹', incompatibleWith: ['真正的奇迹！'], bondChanges: { bondId: 'miraShip', effects: [{ effect: '始终视为激活奇迹盟约；每个休整期开始时获得 5 层奇迹层数。' }] } },
  { name: '真知灼见', rarity: '金', effect: '获得渡桥、空弦各一张。你的远见每累计 10 层时，保留原有的 2 资金奖励，并额外使全体干员攻击力 +2%。', tags: ['盟约', '战力'], bond: '远见' },
  { name: '不再孤独', rarity: '金', effect: '获得一张独行干员（不超过当前调度中心等级）；你的独行对全体友方干员生效。', tags: ['盟约', '战力'], bond: '独行', bondChanges: { bondId: 'soloShip', effects: [{ effect: '独行效果对全体友方干员生效。' }] } },
  { name: '屠宰与手术', rarity: '金', effect: '获得两张精准干员（不超过当前盟约等级）。你的精准干员造成的伤害视为弱点伤害；若已能造成弱点伤害，则额外造成该次结算伤害 10% 的真实伤害。', tags: ['盟约', '战力'], bond: '精准', bondChanges: { bondId: 'preciShip', effects: [{ effect: '精准干员造成的伤害视为弱点伤害；已有弱点伤害时，额外造成该次结算伤害 10% 的真实伤害。' }] } },
  { name: '愈合于铿锵战火', rarity: '金', effect: '始终视为激活聚合的 2 人效果。聚合新增 6 人效果：实际达到 6 人时，全体友军阻挡数 +2、攻击力 +20%；全体敌人攻速 -10%，并获得 10% 脆弱。', tags: ['盟约', '战斗'], bond: '聚合', largeBond: true,
    bondChanges: { bondId: 'docShip', thresholds: [6], effects: [{ effect: '始终视为激活聚合的 2 人效果。' }, { threshold: 6, effect: '实际达到 6 人时，全体友军阻挡数 +2、攻击力 +20%；全体敌人攻速 -10%，承受伤害 +10%。' }] } }, 
  { name: '随机黄金', rarity: '金', effect: '获得一个随机金色海克斯，并获得 6 资金。', tags: ['随机', '经济'] },
  { name: '众志合一+', rarity: '金', effect: '场上每有一种已激活的盟约，全体干员获得 5% 攻击与生命加成，以及 1% 全能穿透。', tags: ['战斗'] },
  { name: '真得苟住', rarity: '金', effect: '获得 11 点玩家生命值。', tags: ['生存'] },
  { name: '真的产能不足喵', rarity: '金', effect: '获得 15 资金与 2 次免费刷新。欢迎进群赞助给作者充电喵。', tags: ['经济'], natural: { fallbackOnly: true } },
  { name: '花到上头', rarity: '金', effect: '出售干员时不再获得资金。每个休整期开始时获得 5 资金、2 次免费刷新和 1 个寻呼模块。', tags: ['经济'], incompatibleWith: ['花到上头++'] },
  { name: '超前投资', rarity: '金', effect: '立即获得 3 资金。失去当前所有资金，两回合后获得失去资金的 3 倍。', tags: ['经济'] },
  { name: '重奏之影', rarity: '金', effect: '你下 2 次精锐化时额外选择一次精锐化奖励。', tags: ['经济', '战力'] },
  { name: '余音护航', rarity: '金', effect: '干员释放技能时获得技力条 × 100 的护盾值，可叠加，持续到战斗结束。', tags: ['战斗'] },
  { name: '偏科补课', rarity: '金', effect: '每个休整期结束时，层数最低的一个已激活且可叠层的盟约获得 8 层。若并列，按固定顺序仅选择一个。', tags: ['盟约', '叠层'] },
  { name: '坚定风采+', rarity: '金', effect: '每场战斗每名干员仅触发一次，生命首次低于 30% 时回复 80% 最大生命值，并减伤 20% 持续 3 秒。', tags: ['战斗', '治疗'] },
  { name: '引火成书', rarity: '金', effect: '战斗开始时若炎盟约已激活，每名炎干员本场首次开启主动技能时，为炎增加 5 层。获得两个不同的炎干员（不超过当前调度中心等级）。', tags: ['盟约', '战力'], bond: '炎', logo: true },
  { name: '重锤回响', rarity: '金', effect: '你的维多利亚盟约每通过新的 25 层里程碑实际发放一件维多利亚装备时，额外获得 5 资金；每回合最多 3 次。获得两个不同的维多利亚干员（不超过当前调度中心等级）。', tags: ['盟约', '经济'], bond: '维多利亚', logo: true },
  { name: '背水一战', rarity: '金', effect: '每场战斗开始时，若你的玩家生命不高于本局初始生命的 50%，干员获得 25% 攻击力与 25% 最大生命加成，持续至本场战斗结束。', tags: ['战斗', '生存'] },
  { name: '海克斯装备集成', rarity: '金', effect: '每场战斗开始时，携带至少 2 件装备的干员获得 20% 攻击力与 15% 最大生命加成，持续至本场战斗结束。', tags: ['战斗', '装备'] },
  { name: '华尔街之狼', rarity: '彩', effect: '你始终视为激活投资人盟约，但每回合获得的资金随机减少 1~3。', tags: ['盟约', '经济'], bond: '投资人', bondChanges: { bondId: 'investShip', effects: [{ effect: '始终视为激活投资人盟约；每回合获得的资金随机减少 1~3。' }] } },
  { name: '文火猛炖', rarity: '彩', effect: '每回合获得 2 资金；3 回合后，将当前回合数 ×15 的总层数分配到所有已激活的盟约上。', tags: ['经济', '叠层'] },
  { name: '真正的奇迹！', rarity: '彩', effect: '你始终视为激活奇迹盟约；每个休整期开始时获得 5 × 当前回合数的奇迹层数。', tags: ['盟约', '经济'], bond: '奇迹', incompatibleWith: ['奇迹！'], bondChanges: { bondId: 'miraShip', effects: [{ effect: '始终视为激活奇迹盟约；每个休整期开始时获得 5 × 当前回合数的奇迹层数。' }] } },
  { name: '众志合一++', rarity: '彩', effect: '场上每有一种已激活的盟约，全体干员获得 7% 攻击与生命加成，以及 1.5% 全能穿透。', tags: ['战斗'] },
  { name: '血多不疼', rarity: '彩', effect: '获得 20 点玩家生命值。', tags: ['生存'] },
  { name: '真的真的产能不足喵', rarity: '彩', effect: '获得 20 资金与 4 次免费刷新。欢迎进群赞助给作者充电喵。', tags: ['经济'], natural: { fallbackOnly: true } },
  { name: '越级调度', rarity: '彩', effect: '立即将调度中心提升 1 级，并获得 3 次免费刷新。若已达到 6 级，则改为获得 15 资金与 5 次免费刷新。', tags: ['经济'] },
  { name: '技力传递', rarity: '彩', effect: '干员开启主动技能时，使一名未开启技能的干员获得 5 点技力，优先选择技力充满比例最低者。', tags: ['战斗', '技力'] },
  { name: '少而精', rarity: '彩', effect: '每场战斗开始时，若干员不超过 5 名（不含召唤物、装置），这些干员获得 80% 攻击力、80% 最大生命与 20 点攻击速度，持续至本场战斗结束。', tags: ['战斗'] },
  { name: '第四艺术', rarity: '彩', effect: '干员每完成第 4 次对敌普攻，额外对主目标及其相邻格内最近的另一个敌人各造成相当于自身攻击力 120% 的法术伤害。', tags: ['战斗'] },
  { name: '名刀司命！', rarity: '彩', effect: '本局首次普通战斗结算扣血将淘汰时，改为保留 1 点玩家生命，并在下个休整期获得 12 资金与 2 次免费刷新。全体干员获得 80% 全属性加成。', tags: ['生存', '战斗'] },
  { name: '花到上头++', rarity: '彩', effect: '出售干员时不再获得资金。每个休整期开始时获得 8 资金、2 次免费刷新和 2 个寻呼模块。与「花到上头」互斥。', tags: ['经济'], incompatibleWith: ['花到上头'] },
  { name: '魔王冠冕', rarity: '彩', effect: '干员获得 1 点阻挡数，并获得 50% 全属性提升。每次完美作战使该提升额外 +1%，非完美作战则 -2%；加成无上限，最低 15%。', tags: ['战斗'],
    note: '全属性指攻击力、防御力、最大生命与法术抗性；仅自己的普通战斗计入增减，Boss 战与联合/联防不计。' },
  { name: '深海倾灭', rarity: '彩', presentation: 'mythic', largeBond: true, logo: true, bond: '阿戈尔', tags: ['盟约', '战斗', '经济', '装备'],
    effect: '每个休整阶段开始时获得 1 名原生阿戈尔干员，不超过当前调度中心等级，不含转化干员；调度中心达到 6 级时，一次性获得阿戈尔重刃与变形同构体。阿戈尔盟约新增 9/12 人效果。9 人：阿戈尔盟约提供的生命加成同时提供相同百分比的攻击力加成；阿戈尔干员击倒非阿戈尔干员时，使其永久追加阿戈尔盟约。12 人：阿戈尔干员每次击倒目标，永久获得目标击倒前 1% 全属性，不分敌我。',
    note: '神话属于彩色品质。干员奖励从获得后的下一个休整阶段开始，按获得时的调度中心等级封顶；已达 6 级时选取立即获得装备。转化保留原盟约与所属阵营。全属性指攻击力、防御力、最大生命与法术抗性；成长立即生效，精锐合并累计继承。仅在干员所属的普通战斗生效，联合、联防与首领战不生效。',
    bondChanges: { bondId: 'egirShip', thresholds: [9, 12], effects: [
      { effect: '每个休整阶段开始时获得 1 名原生阿戈尔干员，不超过当前调度中心等级；调度中心达到 6 级时，一次性获得阿戈尔重刃与变形同构体。' },
      { threshold: 9, effect: '阿戈尔盟约的生命加成同时提供相同百分比攻击力加成。阿戈尔干员击倒非阿戈尔干员时，使其永久追加阿戈尔盟约，保留原盟约与所属阵营。' },
      { threshold: 12, effect: '阿戈尔干员每次击倒目标，立即且永久获得目标击倒前攻击力、防御力、最大生命与法术抗性的 1%，不分敌我。' },
    ] } },
];

/** 名称 → 盟约图标文件名（public/assets/bond/<file>.png）。
 *  聚合在数据层使用内部键 docShip，此处按美术资源对应。 */
export const HEX_BOND_ICON = {
  炎: 'yanShip', 阿戈尔: 'egirShip', 卡西米尔: 'kazimierzShip', 莱塔尼亚: 'lethaniaShip',
  萨尔贡: 'sargonShip', 维多利亚: 'victoriaShip', 乌萨斯: 'ursusShip', 谢拉格: 'kjeragShip',
  叙拉古: 'siracusaShip', 伊比利亚: 'iberiaShip',
  奇迹: 'miraShip', 远见: 'visiShip', 独行: 'soloShip', 精准: 'preciShip',
  聚合: 'docShip', 投资人: 'investShip',
};

export const HEX_BY_NAME = new Map(HEX_CATALOG.map(entry => [entry.name, entry]));

/** 盟约卡是否被发放规则锁死：只在第 1 次发放出现，且绑定的盟约未被禁用。
 *  发放（drawHex）与赠予（eligibleGift）共用此判据，不要各自复制条件。 */
export function hexBondCardBlocked(entry, offerIndex, disabledBondNames) {
  if (!entry.tags?.includes('盟约')) return false;
  return offerIndex !== 1 || disabledBondNames.has(entry.bond);
}
