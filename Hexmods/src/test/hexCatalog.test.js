import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_CATALOG, HEX_NATURAL_RULES, HEX_BOND_ICON } from '../shared/hexCatalog.js';
import { HEX_LOGOS } from '../public/js/ui/hexLogos.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// public/assets 是构建时链接复用的大型素材目录，不在源码树内；按游戏根目录定位。
const bondDir = resolve(srcRoot, '..', '..', 'public/assets/bond');

const byName = name => HEX_CATALOG.find(entry => entry.name === name);

test('目录包含全部名称、品质和非空效果原文', () => {
  const expected = {
    银: ['一阶增援', '维多利亚的低级补给', '可露希尔的资金夹', '炎小队增援', '阿戈尔小队增援', '卡西米尔小队增援', '莱塔尼亚小队增援', '萨尔贡小队增援', '维多利亚小队增援', '乌萨斯小队增援', '谢拉格小队增援', '叙拉古小队增援', '伊比利亚小队增援', '人生切片', '小小运营下', '安慰奖', '随机白银', '低阶调香', '众志合一', '苟住', '产能不足喵', '再就业回执', '空装上阵', '备用电容', '热身完毕', '结阵', '坚定风采'],
    金: ['奇迹！', '真知灼见', '不再孤独', '屠宰与手术', '愈合于铿锵战火', '随机黄金', '众志合一+', '真得苟住', '真的产能不足喵', '花到上头', '超前投资', '重奏之影', '余音护航', '偏科补课', '坚定风采+', '引火成书', '重锤回响', '背水一战', '海克斯装备集成'],
    彩: ['华尔街之狼', '文火猛炖', '真正的奇迹！', '众志合一++', '血多不疼', '真的真的产能不足喵', '越级调度', '技力传递', '少而精', '第四艺术', '名刀司命！', '花到上头++', '魔王冠冕', '深海倾灭'],
  };
  assert.equal(HEX_CATALOG.length, 60);
  assert.equal(new Set(HEX_CATALOG.map(entry => entry.name)).size, 60);
  for (const [rarity, names] of Object.entries(expected)) {
    assert.deepEqual(HEX_CATALOG.filter(entry => entry.rarity === rarity).map(entry => entry.name), names);
  }
  for (const entry of HEX_CATALOG) {
    assert.ok(entry.effect && entry.tags.length, entry.name);
  }
});

test('盟约小队原文、成员及标签完整', () => {
  const squads = {
    炎: ['拜松', '矩', '乌有'], 阿戈尔: ['幽灵鲨', '安哲拉', '深巡'],
    卡西米尔: ['野鬃', '砾', '历阵锐枪芬'], 莱塔尼亚: ['地灵', '折光', '车尔尼'],
    萨尔贡: ['艾斯黛尔', '泡泡', '卡涅利安'], 维多利亚: ['慕斯', '哈洛德', '凯瑟琳'],
    乌萨斯: ['折桠', '真理', '乌啾'], 谢拉格: ['角峰', '哈洛德', '初雪'],
    叙拉古: ['拉普兰德', '奥斯塔', '伺夜'], 伊比利亚: ['深靛', '瑰盐', '海沫'],
  };
  for (const [bond, operators] of Object.entries(squads)) {
    const entry = byName(`${bond}小队增援`);
    assert.equal(entry.bond, bond);
    assert.deepEqual(entry.operators, operators);
    assert.equal(entry.effect, `获得${operators.join('、')}各一张。`);
    assert.deepEqual(entry.tags, ['盟约', '增援', '经济']);
  }
});

test('自然出现限制、自选例外与互斥关系是声明式数据', () => {
  assert.deepEqual(HEX_NATURAL_RULES.bondTag, { offerIndex: 1, excludeDisabledBond: true });
  assert.deepEqual(HEX_NATURAL_RULES.bondReinforcement, { requiredTags: ['盟约', '增援'], maxPerGame: 1 });
  assert.equal(HEX_NATURAL_RULES.manualSelectionBypassesAppearanceRestrictions, true);
  assert.equal(byName('人生切片').natural.maxRound, 3);
  assert.deepEqual(HEX_CATALOG.filter(entry => entry.natural?.fallbackOnly).map(entry => entry.name),
    ['产能不足喵', '真的产能不足喵', '真的真的产能不足喵']);
  assert.deepEqual(byName('奇迹！').incompatibleWith, ['真正的奇迹！']);
  assert.deepEqual(byName('真正的奇迹！').incompatibleWith, ['奇迹！']);
  assert.deepEqual(byName('花到上头').incompatibleWith, ['花到上头++']);
  assert.deepEqual(byName('花到上头++').incompatibleWith, ['花到上头']);
  // 带「盟约」标签的卡一律遵守原生规则锁死：仅第 1 次发放出现，对应盟约禁用则不出现，不允许特例绕过
  for (const entry of HEX_CATALOG.filter(entry => entry.tags.includes('盟约'))) {
    assert.ok(!('bondFlex' in entry), `${entry.name} 不应再声明 bondFlex`);
    if (entry.bond) assert.ok(HEX_BOND_ICON[entry.bond], `${entry.name} 绑定的盟约必须已知`);
  }
});

test('每一项都有可显示的图标：盟约用原始图标，其余用专属 Logo', () => {
  const missing = [];
  const usesLogo = entry => !!entry.logo || !entry.bond; // 声明 logo 的盟约卡保留专属图标
  for (const entry of HEX_CATALOG) {
    if (usesLogo(entry)) {
      if (!HEX_LOGOS[entry.name]) missing.push(`${entry.name}:logo`);
    } else {
      const file = HEX_BOND_ICON[entry.bond];
      if (!file || !existsSync(resolve(bondDir, `${file}.png`))) missing.push(`${entry.name}:${entry.bond}`);
    }
  }
  assert.deepEqual(missing, []);
  assert.equal(HEX_CATALOG.filter(usesLogo).length, Object.keys(HEX_LOGOS).length);
});

test('深海神话展示与大型盟约的额外档位声明完整', () => {
  const deepSea = byName('深海倾灭');
  assert.equal(deepSea.rarity, '彩');
  assert.equal(deepSea.presentation, 'mythic');
  assert.equal(deepSea.largeBond, true);
  assert.equal(deepSea.bondChanges.bondId, 'egirShip');
  assert.deepEqual(deepSea.bondChanges.thresholds, [9, 12]);
  assert.deepEqual(deepSea.bondChanges.effects.map(e => e.threshold), [undefined, 9, 12]);
  assert.equal(deepSea.logo, true);
  assert.ok(HEX_LOGOS['深海倾灭']);
  assert.match(deepSea.effect, /每个休整阶段开始时获得 1 名原生阿戈尔/);
  assert.match(deepSea.effect, /6 级时.*阿戈尔重刃与变形同构体/);
  const healing = byName('愈合于铿锵战火');
  assert.equal(healing.largeBond, true);
  assert.equal(healing.bondChanges.bondId, 'docShip');
  assert.deepEqual(healing.bondChanges.thresholds, [6]);
  assert.deepEqual(healing.bondChanges.effects.map(e => e.threshold), [undefined, 6]);
  for (const card of [deepSea, healing]) {
    assert.ok(card.bondChanges.effects.every(e => typeof e.effect === 'string' && e.effect.length > 0));
  }
});

test('保留复杂效果中的关键限制与数值', () => {
  assert.equal(byName('真知灼见').effect, '获得渡桥、空弦各一张。你的远见每累计 10 层时，保留原有的 2 资金奖励，并额外使全体干员攻击力 +2%。');
  assert.equal(byName('人生切片').effect, '立即获得一张当前回合数 ÷ 2（向上取整）阶的干员；此后每个休整期开始时再获得一张，直到获得 6 阶干员后停止。');
  assert.equal(byName('屠宰与手术').effect, '获得两张精准干员（不超过当前盟约等级）。你的精准干员造成的伤害视为弱点伤害；若已能造成弱点伤害，则额外造成该次结算伤害 10% 的真实伤害。');
  assert.equal(byName('愈合于铿锵战火').effect, '始终视为激活聚合的 2 人效果。聚合新增 6 人效果：实际达到 6 人时，全体友军阻挡数 +2、攻击力 +20%；全体敌人攻速 -10%，并获得 10% 脆弱。');
  assert.equal(byName('文火猛炖').effect, '每回合获得 2 资金；3 回合后，将当前回合数 ×15 的总层数分配到所有已激活的盟约上。');
});
