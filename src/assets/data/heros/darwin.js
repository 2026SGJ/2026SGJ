export default {
    id: 'darwin',
    name: '达尔文',
    description: '近战召唤师 / 阵地战核心 / 群体增益',
    health: 940, // 670 × 1.4
    speed: 8, // 320 / 40
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '基因打击',
            description: '造成 40 点物理伤害。每次普攻命中敌方单位，获得 1 点"进化点数"',
            damage: 40,
            cd: 500,
            cost: 0,
            forward: 150
        },
        skill1: {
            name: '自然选择',
            description: '达尔文引导周围的生物能量，强化指定的一名友方单位（优先机器人），使其体型变大，攻击力提升 30%，且普攻附带 20% 的溅射伤害，持续 8 秒',
            cd: 12000,
            cost: 0,
            forward: 300,
            buff: [
                {
                    id: 'strength',
                    level: 30, // 攻击力提升 30%
                    time: 8000
                }
            ]
        },
        skill2: {
            name: '物种分化',
            description: '达尔文在原地投掷一个"进化孢子"，对周围 250 码内的敌人造成 50 点伤害并减速 20%。同时，在原地孵化一个"孢子寄生体"（继承达尔文 20% 血量，持续 10 秒），寄生体会自动追击并撕咬附近的敌人',
            damage: 50,
            cd: 14000,
            cost: 120,
            forward: 400,
            magic: {
                damage: 50,
                range: 250
            }
        },
        skill3: {
            name: '共生演化',
            description: '达尔文与周围 300 码内的所有友方单位建立"共生链接"，持续 6 秒。期间，友方单位受到的伤害由达尔文分摊 30%，且达尔文的每次普攻都会为所有友方单位回复 15 点生命值',
            cd: 16000,
            cost: 150,
            forward: 300,
            buff: [
                {
                    id: 'shield',
                    level: 150,
                    time: 6000
                }
            ]
        },
        skill4: {
            name: '寒武纪大爆发',
            description: '达尔文引爆自身的"演化"Buff，对周围 400 码内的所有敌方单位造成 100 点真实伤害，并强制进化场上所有的友方机器人（包括步兵和哨兵），使其在接下来的 8 秒内攻速翻倍、体型变大、且免疫减速',
            damage: 100,
            cd: 45000,
            cost: 200,
            forward: 600,
            magic: {
                damage: 100,
                range: 400
            }
        }
    }
}
