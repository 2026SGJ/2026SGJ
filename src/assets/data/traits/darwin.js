/**
 * 词条数据 — 达尔文 (Darwin)
 * 效果字段说明见 newton.js 头部注释
 */
export default {
    hero: 'darwin',
    name: '达尔文',
    traits: [
        {
            id: 'darwin_natural_selection',
            name: '自然选择',
            rarity: 'blue',
            description: '【自然选择】的强化目标不再局限于单个单位，而是同时强化周围 300 码内生命值最高的 2 个友方单位',
            effects: [
                { type: 'modifyBuff', skill: 'skill1', index: 0, levelMul: 2 }, // 强化翻倍
            ],
        },
        {
            id: 'darwin_symbiotic_feedback',
            name: '共生反馈',
            rarity: 'blue',
            description: '当【共生演化】的链接存在时，达尔文通过普攻为友方单位回血的同时，自身也会回复等量的生命值',
            effects: [
                { type: 'onBasicHit', apply: 'selfHeal', amount: 15 },
            ],
        },
        {
            id: 'darwin_directed_mutation',
            name: '定向变异',
            rarity: 'purple',
            description: '达尔文的普攻有 20% 的概率对敌方施加"基因污染"（持续 4 秒）。带有"基因污染"的敌人，在被达尔文的友方单位攻击时，会受到额外的 30 点真实伤害',
            effects: [
                {
                    type: 'onBasicHit',
                    apply: 'targetDebuff',
                    chance: 0.2,
                    debuff: { id: 'poison', level: 1, time: 4000 }, // 20/s 持续伤害近似"基因污染"
                },
            ],
        },
        {
            id: 'darwin_ecological_isolation',
            name: '生态隔离',
            rarity: 'purple',
            description: '【物种分化】生成的"孢子寄生体"数量上限增加 1 个，且寄生体会优先锁定带有"基因污染"的敌方英雄进行撕咬',
            effects: [],
        },
        {
            id: 'darwin_cambrian_explosion',
            name: '寒武纪大爆发',
            rarity: 'gold',
            description: '大招【寒武纪大爆发】的持续时间延长至 12 秒，且在爆发期间，达尔文的所有友方单位（包括机器人和寄生体）免疫一切控制效果',
            effects: [
                { type: 'modifySkill', skill: 'skill4', cdMul: 0.8 }, // 更频繁的大招
            ],
        },
        {
            id: 'darwin_tree_of_life',
            name: '生命之树',
            rarity: 'gold',
            description: '达尔文的"演化"Buff 层数上限突破 5 层，达到 8 层时，达尔文自身获得"生态主宰"状态：体型增大 50%，周围 400 码内的友方单位攻击力额外提升 30%，且达尔文每次释放技能都会刷新【自然选择】的冷却时间',
            effects: [
                { type: 'stat', cdMulAll: 0.85 },
            ],
        },
    ],
};
