/**
 * 词条数据 — 笛卡尔 (Descartes)
 * 效果字段说明见 newton.js 头部注释
 */
export default {
    hero: 'descartes',
    name: '笛卡尔',
    traits: [
        {
            id: 'descartes_anchor_tracking',
            name: '锚点追踪',
            rarity: 'blue',
            description: '【坐标打击】的锚点最多提高至 5 个，且带有锚点的敌人视野暴露',
            effects: [
                { type: 'modifySkill', skill: 'basic', debuffTimeMul: 1.5 }, // 锚点标记 4s → 6s
            ],
        },
        {
            id: 'descartes_geometric_intuition',
            name: '几何直觉',
            rarity: 'blue',
            description: '【绝对直线】的射程增加 30%，且命中带有锚点的敌人时，自身获得 10% 移速加成',
            effects: [
                {
                    type: 'onSkillUse',
                    skill: 'skill2',
                    apply: 'selfBuff',
                    buff: { id: 'speed', level: 10, time: 3000 },
                },
            ],
        },
        {
            id: 'descartes_space_tear',
            name: '空间撕裂',
            rarity: 'purple',
            description: '【空间折叠】的眩晕时间延长至 1.5 秒，且被传送的敌人在落地后 2 秒内无法攻击',
            effects: [
                { type: 'modifyDebuff', skill: 'skill1', index: 0, timeMul: 1.5 }, // 1s → 1.5s
            ],
        },
        {
            id: 'descartes_dimensional_strike',
            name: '降维打击',
            rarity: 'purple',
            description: '【维度降维】期间，敌方每次移动都会受到 30 点真实伤害',
            effects: [
                { type: 'modifyDebuff', skill: 'skill3', index: 0, timeMul: 1.67 }, // 3s → 5s
            ],
        },
        {
            id: 'descartes_euclidean_rage',
            name: '欧几里得之怒',
            rarity: 'gold',
            description: '当场上存在 3 个以上的"坐标锚点"时，【绝对直线】无需消耗锚点即可释放，且伤害提升 50%',
            effects: [
                { type: 'modifySkill', skill: 'skill2', damageMul: 1.5 },
            ],
        },
        {
            id: 'descartes_absolute_domain',
            name: '绝对领域',
            rarity: 'gold',
            description: '【坐标系重构】的护盾吸收量翻倍，且交换位置后，双方获得 3 秒的无敌帧',
            effects: [
                { type: 'modifyBuff', skill: 'skill4', index: 0, levelMul: 2 }, // 200 → 400
            ],
        },
    ],
};
