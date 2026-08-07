export default {
    id: 'lavoisier',
    name: '拉瓦锡',
    description: '周期性爆发、区域封锁、团战清场',
    health: 1020, // 730 × 1.4
    speed: 7.5, // 300 / 40
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '试剂投掷',
            description: '投掷一瓶化学试剂，单发伤害 30。守恒循环：每进行 3 次普攻，第 3 次投掷的试剂瓶会变为"广口瓶"，命中时发生溅射，对周围小范围造成 100% 伤害并施加一层"氧化"效果',
            damage: 30,
            cd: 500,
            cost: 0,
            forward: 100
        },
        skill1: {
            name: '剧烈放热',
            description: '向指定方向泼洒高浓度助燃剂。对路径上的敌人造成 40 点伤害，并瞬间引爆他们身上所有的"燃烧"效果（层数清零）。补偿收益：每引爆一层燃烧，拉瓦锡获得 15 点护盾（最多 3 层）',
            damage: 40,
            cd: 10000,
            cost: 0,
            forward: 200,
            buff: [ // 每引爆一层燃烧 +15 护盾（最多 3 层）
                {
                    id: 'shield',
                    level: 45,
                    time: 5000
                }
            ]
        },
        skill2: {
            name: '氧化反应',
            description: '引爆目标及周围 300 码范围内所有敌人的"氧化"层数。每层造成 40 点真实伤害，并重新施加一层"燃烧"（每秒 20 伤害，持续 3 秒）',
            damage: 40,
            cd: 6000,
            cost: 120,
            forward: 260,
            debuff: [ // 重新施加的"燃烧"
                {
                    id: 'damage',
                    level: 1, // 20/秒
                    time: 3000
                }
            ],
            magic: {
                damage: 40,
                range: 300
            }
        },
        skill3: {
            name: '密闭容器',
            description: '在指定区域生成一个透明的"密闭力场"，持续 5 秒。力场内的敌方单位无法回血；力场内的友方单位受到的燃烧伤害降低 50%',
            cd: 14000,
            cost: 150,
            forward: 260,
            magic: {
                damage: 0,
                range: 250
            }
        },
        skill4: {
            name: '拉瓦锡天平',
            description: '放置一个天平装置，持续 8 秒。自动称量周围 400 码内敌我双方的"总质量"（当前总血量）。若敌方总质量 > 我方，天平倾斜，对敌方造成每秒 50 点伤害；若我方占优，则为我方提供 10% 伤害加成',
            cd: 20000,
            cost: 200,
            forward: 260,
            magic: {
                damage: 50,
                range: 400
            }
        }
    }
}
