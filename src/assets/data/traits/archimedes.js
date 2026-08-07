/**
 * 词条数据 — 阿基米德 (Archimedes)
 * 效果字段说明见 newton.js 头部注释
 *
 * 说明：描述中的【重力撬棍】在引擎内并入【撬动地球】（同为以支点为圆心的
 * 强制位移技能），相关词条效果映射到 skill4。
 */
export default {
    hero: 'archimedes',
    name: '阿基米德',
    traits: [
        {
            id: 'archimedes_mechanical_transmission',
            name: '力学传导',
            rarity: 'blue',
            description: '【重力撬棍】撬飞的敌人，如果在空中撞到地形造物，会受到额外 80 点伤害',
            effects: [
                { type: 'modifySkill', skill: 'skill4', damageAdd: 80 },
            ],
        },
        {
            id: 'archimedes_pivot_expansion',
            name: '支点扩张',
            rarity: 'blue',
            description: '【绝对刚体】生成的力场墙长度增加 100 码，且阿基米德在墙附近时，获得 15% 冷却缩减',
            effects: [
                { type: 'stat', cdMulAll: 0.85 },
            ],
        },
        {
            id: 'archimedes_space_folding',
            name: '空间折叠',
            rarity: 'purple',
            description: '阿基米德可以穿过自己生成的【绝对刚体】，穿过时获得 2 秒的 30% 移速加成',
            effects: [],
        },
        {
            id: 'archimedes_gravity_well',
            name: '引力井',
            rarity: 'purple',
            description: '【阿基米德之井】的持续时间延长至 7 秒，且井内的敌方单位受到的所有伤害提升 15%',
            effects: [],
        },
        {
            id: 'archimedes_universal_gravitation',
            name: '万有引力',
            rarity: 'gold',
            description: '【撬动地球】的拉扯距离增加 100 码，且被拉扯的敌方单位，其身上的所有增益 Buff 会被强制剥离',
            effects: [
                { type: 'modifySkill', skill: 'skill4', knockbackAdd: -100 }, // 拉扯得更远
            ],
        },
        {
            id: 'archimedes_eternal_rigid_body',
            name: '永恒刚体',
            rarity: 'gold',
            description: '场上最多可同时存在 3 道【绝对刚体】，且所有地形造物的持续时间延长 3 秒',
            effects: [
                { type: 'modifyBuff', skill: 'skill2', index: 0, timeMul: 1.5 }, // 4s → 6s
            ],
        },
    ],
};
