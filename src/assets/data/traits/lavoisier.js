/**
 * 词条数据 — 拉瓦锡 (Lavoisier)
 * 效果字段说明见 newton.js 头部注释
 */
export default {
    hero: 'lavoisier',
    name: '拉瓦锡',
    traits: [
        {
            id: 'lavoisier_definite_proportions',
            name: '定比定律',
            rarity: 'blue',
            description: '普攻的"守恒循环"节奏加快，变为每 2 次普攻触发一次溅射',
            effects: [
                { type: 'modifySkill', skill: 'basic', cdMul: 0.75 }, // 攻速提升近似循环加快
            ],
        },
        {
            id: 'lavoisier_acid_base_neutralization',
            name: '酸碱中和',
            rarity: 'blue',
            description: '【剧烈放热】的护盾值提升 50%，且施法距离增加 20%',
            effects: [
                { type: 'modifyBuff', skill: 'skill1', index: 0, levelMul: 1.5 }, // 45 → 67.5
            ],
        },
        {
            id: 'lavoisier_violent_oxidation',
            name: '剧烈氧化',
            rarity: 'purple',
            description: '【氧化反应】引爆时，如果目标身上有"燃烧"效果，会额外造成 1 秒眩晕',
            effects: [
                {
                    type: 'onSkillUse',
                    skill: 'skill2',
                    apply: 'targetDebuff',
                    debuff: { id: 'stun', level: 0, time: 1000 },
                },
            ],
        },
        {
            id: 'lavoisier_catalyst',
            name: '催化剂',
            rarity: 'purple',
            description: '【密闭容器】的持续时间延长至 7 秒，且处于容器内的敌人移速降低 20%',
            effects: [
                { type: 'modifyMagic', skill: 'skill3', rangeMul: 1.2 }, // 力场范围扩大
            ],
        },
        {
            id: 'lavoisier_conservation_of_mass',
            name: '质量守恒·真',
            rarity: 'gold',
            description: '拉瓦锡的所有技能不再消耗冷却时间，而是消耗"质量"（即自身当前 5% 的血量）。施法后，若命中敌方英雄，返还双倍血量',
            effects: [],
        },
        {
            id: 'lavoisier_victory_of_oxygen',
            name: '氧气的胜利',
            rarity: 'gold',
            description: '普攻不再需要第 3 发才溅射，每一发普攻都附带 50% 范围的溅射伤害，且必定施加"氧化"效果',
            effects: [
                { type: 'modifySkill', skill: 'basic', damageMul: 1.5 },
                {
                    type: 'onBasicHit',
                    apply: 'targetDebuff',
                    debuff: { id: 'damage', level: 1, time: 3000 }, // 必定施加"氧化"（燃烧）
                },
            ],
        },
    ],
};
