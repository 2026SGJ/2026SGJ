/**
 * 词条数据 — 摩尔根 (Morgan)
 * 效果字段说明见 newton.js 头部注释
 */
export default {
    hero: 'morgan',
    name: '摩尔根',
    traits: [
        {
            id: 'morgan_probe_enhancement',
            name: '探针强化',
            rarity: 'blue',
            description: '【基因探针】的弱点标记持续时间延长至 6 秒，且带有弱点的敌人受到的暴击伤害额外增加 10%',
            effects: [
                { type: 'modifySkill', skill: 'basic', debuffTimeMul: 1.5 }, // 4s → 6s
                { type: 'stat', critDamageAdd: 0.1 },
            ],
        },
        {
            id: 'morgan_chain_reaction',
            name: '连锁反应',
            rarity: 'blue',
            description: '【连锁互换】触发暴击后，自身获得 10% 攻速加成，持续 3 秒',
            effects: [
                {
                    type: 'onBasicHit',
                    apply: 'selfBuff',
                    buff: { id: 'speed', level: 10, time: 3000 },
                },
            ],
        },
        {
            id: 'morgan_gene_defect',
            name: '基因缺陷',
            rarity: 'purple',
            description: '【基因测序】期间，目标每次释放技能都会受到 50 点额外伤害',
            effects: [
                { type: 'onSkillUse', skill: 'skill2', apply: 'targetBonusDamage', amount: 50 },
            ],
        },
        {
            id: 'morgan_dominant_mutation',
            name: '显性突变',
            rarity: 'purple',
            description: '【染色体变异】的变异状态持续时间延长至 8 秒，且基因打击的触发概率提升至 30%',
            effects: [
                { type: 'modifyBuff', skill: 'skill3', index: 0, timeMul: 1.33 }, // 6s → 8s
            ],
        },
        {
            id: 'morgan_perfect_sequencing',
            name: '完美测序',
            rarity: 'gold',
            description: '【基因测序】期间，摩尔根对该目标的所有攻击无视 30% 护甲/魔抗',
            effects: [
                {
                    type: 'onSkillUse',
                    skill: 'skill2',
                    apply: 'selfBuff',
                    buff: { id: 'strength', level: 15, time: 5000 },
                },
            ],
        },
        {
            id: 'morgan_gene_hegemony',
            name: '基因霸权',
            rarity: 'gold',
            description: '【基因掠夺】窃取成功后，自身获得一个持续 5 秒、吸收 300 点伤害的护盾，且被窃取的目标移速降低 20%',
            effects: [
                {
                    type: 'onSkillUse',
                    skill: 'skill4',
                    apply: 'selfBuff',
                    buff: { id: 'shield', level: 300, time: 5000 },
                },
            ],
        },
    ],
};
