/**
 * 词条数据 — 牛顿 (Newton)
 *
 * 词条效果字段说明（由 src/game/match/trait/TraitManager.js 解释执行）：
 * - modifySkill   → { skill, damageMul, damageAdd, cdMul, cdAdd, forwardMul, knockbackAdd, addMagic }
 * - modifyDebuff  → { skill, index, levelMul, levelAdd, timeMul, timeAdd }
 * - modifyBuff    → { skill, index, levelMul, timeMul, timeAdd }
 * - modifyMagic   → { skill, damageMul, damageAdd, rangeMul, rangeAdd, knockbackAdd }
 * - stat          → { speedMul, maxHealthAdd, cdMulAll, critChanceAdd, critDamageAdd, rangeAdd,
 *                     damageReductionAdd, ccReductionAdd, dmgReduceChance, dmgReduce }
 * - onBasicHit    → { apply: 'selfBuff'|'selfHeal'|'money'|'targetDebuff', buff?, amount?, chance?,
 *                     buffLevelMaxHpRatio? }
 * - onSkillUse    → { skill, apply: 'selfBuff'|'selfHeal'|'money'|'cdReset'|'cdReduceAll'|
 *                     'targetDebuff'|'targetBonusDamage'|'targetExecute'|'redrawTrait',
 *                     buff?, amount?, chance?, buffLevelMaxHpRatio?, skillToReset? }
 *
 * 引擎暂未建模的机制（召唤物、地形、过载值等）以 description 保留原设计，
 * effects 落到最接近的引擎效果上。
 */
export default {
    hero: 'newton',
    name: '牛顿',
    traits: [
        {
            id: 'newton_mass_conservation',
            name: '质量守恒',
            rarity: 'blue',
            description: '每次普攻命中敌方单位，自身获得 10 点护盾，持续 5 秒',
            effects: [
                {
                    type: 'onBasicHit',
                    apply: 'selfBuff',
                    buff: { id: 'shield', level: 10, time: 5000 },
                },
            ],
        },
        {
            id: 'newton_momentum_theorem',
            name: '动量定理',
            rarity: 'blue',
            description: '【质量抛掷】的硬直时间延长至 0.8 秒，且命中后自身获得 10% 攻速加成',
            effects: [
                { type: 'modifyDebuff', skill: 'skill1', index: 0, timeMul: 1.6 }, // 500 → 800ms
                { type: 'modifySkill', skill: 'basic', cdMul: 0.9 }, // 10% 攻速
            ],
        },
        {
            id: 'newton_gravitation',
            name: '万有引力',
            rarity: 'purple',
            description: '【重力奇点】的吸附范围扩大 40%，且吸附期间敌方无法使用位移技能',
            effects: [
                { type: 'modifyMagic', skill: 'skill2', rangeMul: 1.4 },
            ],
        },
        {
            id: 'newton_elastic_collision',
            name: '弹性碰撞',
            rarity: 'purple',
            description: '触发【惯性反冲】时，额外击退周围敌人 200 码，并使其减速 30% 持续 2 秒',
            effects: [
                { type: 'modifyMagic', skill: 'skill3', knockbackAdd: 200 },
            ],
        },
        {
            id: 'newton_absolute_inertia',
            name: '绝对惯性',
            rarity: 'gold',
            description: '牛顿受到的强制位移效果及控制时间减少 50%。【重力奇点】的持续时间延长至 5 秒，且每秒抽取敌方 5% 最大生命值转化为自身护盾',
            effects: [
                { type: 'stat', ccReductionAdd: 0.5 },
                { type: 'modifyDebuff', skill: 'skill2', index: 0, timeMul: 1.67 }, // 3000 → 5000ms
            ],
        },
    ],
};
