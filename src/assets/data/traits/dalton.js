/**
 * 词条数据 — 道尔顿 (Dalton)
 * 效果字段说明见 newton.js 头部注释
 */
export default {
    hero: 'dalton',
    name: '道尔顿',
    traits: [
        {
            id: 'dalton_catalyst',
            name: '催化剂',
            rarity: 'blue',
            description: '【强酸腐蚀池】的伤害提升 20%，且区域内的敌人攻击速度降低 15%',
            effects: [
                { type: 'modifyDebuff', skill: 'skill2', index: 0, levelMul: 1.2 }, // 40/s → 48/s
            ],
        },
        {
            id: 'dalton_stable_isotope',
            name: '稳定同位素',
            rarity: 'blue',
            description: '【惰性气体屏障】的持续时间延长至 5 秒，且开启期间每秒恢复 20 点生命值',
            effects: [
                { type: 'modifyBuff', skill: 'skill1', index: 0, timeMul: 1.25 }, // 4s → 5s
                { type: 'onSkillUse', skill: 'skill1', apply: 'selfHeal', amount: 100 },
            ],
        },
        {
            id: 'dalton_toxic_volatilization',
            name: '剧毒挥发',
            rarity: 'purple',
            description: '带有"腐蚀效果"的敌人被击杀时，会在原地生成一个小型腐蚀池，持续 3 秒',
            effects: [],
        },
        {
            id: 'dalton_bond_energy_release',
            name: '键能释放',
            rarity: 'purple',
            description: '【共价键链接】结束时，若双方累计承受伤害超过 300 点，会向周围释放一次 150 点的范围爆炸',
            effects: [],
        },
        {
            id: 'dalton_absolute_zero_corrosion',
            name: '绝对零度腐蚀',
            rarity: 'gold',
            description: '【强酸腐蚀池】对敌方主基地和前哨站造成真实伤害，且无视建筑自带的减伤效果',
            effects: [],
        },
        {
            id: 'dalton_chain_nuclear_burst',
            name: '链式核爆',
            rarity: 'gold',
            description: '【链式反应】引爆时，若目标处于"腐蚀池"内，伤害额外提升 100%，并清空其所有护盾',
            effects: [
                { type: 'onSkillUse', skill: 'skill4', apply: 'targetBonusDamage', amount: 150 },
            ],
        },
    ],
};
