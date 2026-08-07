/**
 * 词条数据 — 高斯 (Gauss)
 * 效果字段说明见 newton.js 头部注释
 */
export default {
    hero: 'gauss',
    name: '高斯',
    traits: [
        {
            id: 'gauss_maglev_acceleration',
            name: '磁轨加速',
            rarity: 'blue',
            description: '【磁轨射击】的射程增加 20%，且普攻积攒"磁场值"的速度提升 25%',
            effects: [
                { type: 'stat', rangeAdd: 15 }, // 普攻判定范围 75 → 90
            ],
        },
        {
            id: 'gauss_field_resonance',
            name: '磁场共振',
            rarity: 'blue',
            description: '【磁力牵引】的拉近距离增加 50 码，且命中后使目标减速 20%，持续 2 秒',
            effects: [
                { type: 'modifySkill', skill: 'skill1', knockbackAdd: -50 }, // 拉得更近
            ],
        },
        {
            id: 'gauss_superconducting_penetration',
            name: '超导穿透',
            rarity: 'purple',
            description: '【高斯步枪】的穿透次数增加 2 次，且对建筑造成的伤害提升 40%',
            effects: [
                { type: 'modifySkill', skill: 'skill2', damageMul: 1.4 },
            ],
        },
        {
            id: 'gauss_deflection_shield',
            name: '偏转护盾',
            rarity: 'purple',
            description: '【磁场偏转】的持续时间延长至 6 秒，且护盾存在期间，高斯获得 10% 移速加成',
            effects: [
                { type: 'modifyBuff', skill: 'skill3', index: 0, timeMul: 1.5 }, // 4s → 6s
                {
                    type: 'onSkillUse',
                    skill: 'skill3',
                    apply: 'selfBuff',
                    buff: { id: 'speed', level: 10, time: 6000 },
                },
            ],
        },
        {
            id: 'gauss_absolute_zero_field',
            name: '绝对零度磁场',
            rarity: 'gold',
            description: '【磁暴干扰】区域内的敌方单位，每停留 1 秒，受到的伤害增加 5%（最高叠加 10 层）',
            effects: [
                { type: 'modifyDebuff', skill: 'skill4', index: 0, levelMul: 2 }, // 80/s → 160/s
            ],
        },
        {
            id: 'gauss_beauty_of_math',
            name: '数学之美',
            rarity: 'gold',
            description: '当高斯的"磁场值"溢出 100 点时，下一次【高斯步枪】必定暴击（伤害提升 100%），且无视目标 30% 的护盾',
            effects: [
                { type: 'stat', critChanceAdd: 0.15, critDamageSet: 2 },
            ],
        },
    ],
};
