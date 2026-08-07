/**
 * 词条数据 — 孟德尔 (Mendel)
 * 效果字段说明见 newton.js 头部注释
 */
export default {
    hero: 'mendel',
    name: '孟德尔',
    traits: [
        {
            id: 'mendel_dominant_inheritance',
            name: '显性遗传',
            rarity: 'blue',
            description: '【人工授粉】的"杂交靶标"标记持续时间延长至 5 秒，且自身的治疗回复量提升至 25 点',
            effects: [
                { type: 'modifyDebuff', skill: 'skill1', index: 0, timeMul: 1.67 }, // 3000 → 5000ms
            ],
        },
        {
            id: 'mendel_hybrid_vigor',
            name: '杂交优势',
            rarity: 'blue',
            description: '场上每存在一个【孟德尔的豌豆园】炮台，孟德尔自身获得 5% 移速加成（最多叠加 3 层）',
            effects: [
                { type: 'stat', speedMul: 1.15 }, // 近似 3 层炮台
            ],
        },
        {
            id: 'mendel_gene_recombination_i',
            name: '基因重组·初级',
            rarity: 'blue',
            description: '使用【基因重组】时，额外获得 100 晶元（弥补献祭血量的经济成本）',
            effects: [
                { type: 'onSkillUse', skill: 'skill3', apply: 'money', amount: 100 },
            ],
        },
        {
            id: 'mendel_pea_burst',
            name: '豌豆连射',
            rarity: 'purple',
            description: '【孟德尔的豌豆园】炮台的攻击间隔缩短至 1.0 秒，且豌豆附带 10% 的减速效果，持续 2 秒',
            effects: [
                { type: 'modifyDebuff', skill: 'skill2', index: 0, levelMul: 1.4 }, // 25/s → 35/s
            ],
        },
        {
            id: 'mendel_symbiotic_feedback',
            name: '共生反馈',
            rarity: 'purple',
            description: '在【共生体】持续期间，每分担一次伤害，孟德尔和 AI 同时获得 15 点护盾',
            effects: [
                {
                    type: 'onSkillUse',
                    skill: 'skill4',
                    apply: 'selfBuff',
                    buff: { id: 'shield', level: 15, time: 5000 },
                },
            ],
        },
        {
            id: 'mendel_gene_recombination_mutation',
            name: '基因重组·突变',
            rarity: 'purple',
            description: '使用【基因重组】时，有 30% 的概率直接刷新出【紫色】或【金色】稀有词条',
            effects: [
                { type: 'onSkillUse', skill: 'skill3', apply: 'redrawTrait', chance: 0.3 },
            ],
        },
        {
            id: 'mendel_infinite_reproduction',
            name: '无限繁殖',
            rarity: 'gold',
            description: '【孟德尔的豌豆园】炮台在持续时间结束或摧毁时，有 50% 的概率在原地重新种下一颗豌豆种子（最多触发 3 次）',
            effects: [
                { type: 'modifyDebuff', skill: 'skill2', index: 0, timeMul: 1.5 }, // 12s → 18s
            ],
        },
        {
            id: 'mendel_perfect_evolution',
            name: '基因重组·完美进化',
            rarity: 'gold',
            description: '【基因重组】不再献祭生命值，但冷却时间增加至 35 秒。使用后 5 秒内无法获得治疗的限制移除',
            effects: [
                { type: 'modifySkill', skill: 'skill3', cdAdd: 17000 }, // 18000 → 35000ms
                {
                    type: 'onSkillUse',
                    skill: 'skill3',
                    apply: 'selfBuff',
                    buff: { id: 'shield', level: 200, time: 3000 },
                },
            ],
        },
    ],
};
