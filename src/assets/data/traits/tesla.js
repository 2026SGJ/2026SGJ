/**
 * 词条数据 — 特斯拉 (Tesla)
 * 效果字段说明见 newton.js 头部注释
 */
export default {
    hero: 'tesla',
    name: '特斯拉',
    traits: [
        {
            id: 'tesla_high_voltage_capacitor',
            name: '高压电容',
            rarity: 'blue',
            description: '普攻积攒"过载值"的速度提升 30%，且【静电场】的范围扩大 20%',
            effects: [
                { type: 'modifyMagic', skill: 'skill1', rangeMul: 1.2 },
            ],
        },
        {
            id: 'tesla_insulation_coating',
            name: '绝缘涂层',
            rarity: 'blue',
            description: '特斯拉受到敌方技能伤害时，有 20% 概率免疫该次伤害的 30%',
            effects: [
                { type: 'stat', dmgReduceChance: 0.2, dmgReduce: 0.3 },
            ],
        },
        {
            id: 'tesla_superconducting_burst',
            name: '超导爆发',
            rarity: 'purple',
            description: '【闪电风暴】的伤害提升 50%，并有 40% 的几率额外造成 1 秒的眩晕',
            effects: [
                { type: 'modifySkill', skill: 'skill2', damageMul: 1.5 },
                { type: 'modifyMagic', skill: 'skill2', damageMul: 1.5 },
                {
                    type: 'onSkillUse',
                    skill: 'skill2',
                    apply: 'targetDebuff',
                    chance: 0.4,
                    debuff: { id: 'stun', level: 0, time: 1000 },
                },
            ],
        },
        {
            id: 'tesla_energy_siphon',
            name: '能量虹吸',
            rarity: 'purple',
            description: '部署【磁暴线圈】时，特斯拉立即回复 100 点生命值，且线圈的吸取过载值速度翻倍',
            effects: [
                { type: 'onSkillUse', skill: 'skill4', apply: 'selfHeal', amount: 100 },
            ],
        },
        {
            id: 'tesla_infinite_overload',
            name: '无限过载',
            rarity: 'purple',
            description: '特斯拉的"过载值"突破 100 点时，所有技能冷却时间缩减 30%',
            effects: [
                { type: 'stat', cdMulAll: 0.7 },
            ],
        },
        {
            id: 'tesla_global_energy_network',
            name: '全球能源网络',
            rarity: 'gold',
            description: '【磁暴线圈】部署后，特斯拉的所有技能冷却时间缩减 30%。当线圈摧毁或结束时，会引发一次全图范围的电磁脉冲，清空所有敌方单位的"过载值"并造成 250 点伤害',
            effects: [
                { type: 'onSkillUse', skill: 'skill4', apply: 'cdReduceAll', amount: 30 },
            ],
        },
    ],
};
