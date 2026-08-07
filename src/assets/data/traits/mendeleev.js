/**
 * 词条数据 — 门捷列夫 (Mendeleev)
 * 效果字段说明见 newton.js 头部注释
 */
export default {
    hero: 'mendeleev',
    name: '门捷列夫',
    traits: [
        {
            id: 'mendeleev_element_affinity',
            name: '元素亲和',
            rarity: 'blue',
            description: '【元素掷弹】附加元素状态的概率提升 30%，且同一目标身上的元素状态持续时间延长 2 秒',
            effects: [
                {
                    type: 'onBasicHit',
                    apply: 'targetDebuff',
                    debuff: { id: 'damage', level: 0, time: 5000 }, // 元素状态延长 2s 的标记
                },
            ],
        },
        {
            id: 'mendeleev_period_acceleration',
            name: '周期加速',
            rarity: 'blue',
            description: '【周期律共鸣】的冷却时间减少 3 秒，且攻击力加成上限提升至 5 层',
            effects: [
                { type: 'modifySkill', skill: 'skill1', cdAdd: -3000 },
            ],
        },
        {
            id: 'mendeleev_fission_reaction',
            name: '裂变反应',
            rarity: 'purple',
            description: '【元素周期表】引爆时，若目标身上同时存在 2 种以上元素状态，额外造成 100 点真实伤害',
            effects: [
                { type: 'onSkillUse', skill: 'skill2', apply: 'targetBonusDamage', amount: 100 },
            ],
        },
        {
            id: 'mendeleev_half_life',
            name: '半衰期',
            rarity: 'purple',
            description: '【放射性衰变】的印记叠加速度翻倍，且印记满层时会引发一次小范围爆炸',
            effects: [
                { type: 'modifyDebuff', skill: 'skill4', index: 0, levelMul: 2 }, // 20/s → 40/s
            ],
        },
        {
            id: 'mendeleev_ultimate_period',
            name: '终极周期',
            rarity: 'gold',
            description: '当【周期律共鸣】叠满 5 层时，下一次【元素周期表】无需消耗元素状态即可释放，且伤害提升 80%',
            effects: [
                { type: 'modifySkill', skill: 'skill2', damageMul: 1.8 },
            ],
        },
        {
            id: 'mendeleev_radiation_storm',
            name: '辐射风暴',
            rarity: 'gold',
            description: '【放射性衰变】区域内，敌方单位每次释放技能都会额外叠加 2 层"辐射印记"',
            effects: [
                { type: 'modifyDebuff', skill: 'skill4', index: 0, levelMul: 1.5 }, // 印记叠速提升
            ],
        },
    ],
};
