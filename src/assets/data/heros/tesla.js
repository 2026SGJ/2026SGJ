export default {
    id: 'tesla',
    name: '特斯拉',
    description: '近战/中距离狂战士、高频爆发、能量过载',
    health: 910, // 650 × 1.4
    speed: 7.75, // 310 / 40
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '电弧射击',
            description: '单发伤害 20，命中积攒 5 点"过载值"（上限100点）',
            damage: 20,
            cd: 500,
            cost: 0,
            forward: 100
        },
        skill1: {
            name: '静电场',
            description: '以自身为中心释放静电场，持续 3 秒。对进入范围的敌人造成 20 点伤害，并使其"过载值"瞬间增加 20 点',
            damage: 0,
            cd: 10000,
            cost: 0,
            forward: 200,
            magic: { // 以自身为中心的 AOE
                damage: 20,
                range: 150
            }
        },
        skill2: {
            name: '闪电风暴',
            description: '消耗 50 点"过载值"，对前方扇形区域释放高压电弧，造成 200 点范围伤害，并击退敌人 100 码',
            damage: 200,
            knockback: 100,
            cd: 7000,
            cost: 120,
            forward: 260,
            magic: {
                damage: 200,
                knockback: 100,
                range: 200
            }
        },
        skill3: {
            name: '等离子护盾',
            description: '消耗 30 点"过载值"，生成一个 250 点的等离子护盾，持续 5 秒。护盾存在期间，普攻变为穿透性电弧',
            cd: 12000,
            cost: 150,
            forward: 200,
            buff: [
                {
                    id: 'shield',
                    level: 250,
                    time: 5000
                }
            ]
        },
        skill4: {
            name: '磁暴线圈',
            description: '部署一个持续 10 秒的线圈。每秒对周围 400 码内的敌人造成 50 点伤害，并强制吸取 10 点"过载值"给特斯拉',
            cd: 25000,
            cost: 250,
            forward: 330,
            debuff: [ // 主目标持续受线圈伤害
                {
                    id: 'damage',
                    level: 2.5, // 50/秒
                    time: 10000
                }
            ],
            magic: { // 部署瞬间对周围造成一次线圈伤害
                damage: 50,
                range: 400
            }
        }
    }
}
