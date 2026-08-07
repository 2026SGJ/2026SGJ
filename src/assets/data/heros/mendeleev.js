export default {
    id: 'mendeleev',
    name: '门捷列夫',
    description: '随机性、状态叠加、团队增益',
    health: 1120, // 800 × 1.4
    speed: 7.5, // 300 / 40
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '元素掷弹',
            description: '单发伤害 25，命中后随机附加一种"元素状态"：灼烧/冰冻/感电，持续 3 秒',
            damage: 25,
            cd: 500,
            cost: 0,
            forward: 150
        },
        skill1: {
            name: '周期律共鸣',
            description: '统计场上所有带有"元素状态"的敌方单位数量。每有一个，为自身和周围 400 码内的队友提供 5% 的攻击力加成，持续 5 秒（最高叠加 4 层）',
            cd: 15000,
            cost: 0,
            forward: 300,
            buff: [
                {
                    id: 'strength',
                    level: 20, // 近似 4 层共鸣
                    time: 5000
                }
            ]
        },
        skill2: {
            name: '元素周期表',
            description: '消耗 3 种不同的"元素状态"，在目标区域引发一次"周期爆发"，造成 200 点范围伤害，并清除范围内所有敌人的元素抗性',
            damage: 200,
            cd: 10000,
            cost: 120,
            forward: 400,
            magic: {
                damage: 200,
                range: 200
            }
        },
        skill3: {
            name: '惰性元素护盾',
            description: '为一名队友施加一个持续 5 秒的护盾。护盾存在期间，该队友的普攻会额外附加随机元素伤害',
            cd: 12000,
            cost: 150,
            forward: 300,
            buff: [
                {
                    id: 'shield',
                    level: 250,
                    time: 5000
                }
            ]
        },
        skill4: {
            name: '放射性衰变',
            description: '在指定区域释放辐射，持续 6 秒。区域内敌人每秒叠加一层"辐射印记"，每层使其受到的所有伤害增加 5%（最高叠 10 层）',
            cd: 22000,
            cost: 200,
            forward: 400,
            debuff: [ // 辐射区域持续伤害
                {
                    id: 'damage',
                    level: 1, // 20/秒
                    time: 6000
                }
            ],
            magic: {
                damage: 0,
                range: 250
            }
        }
    }
}
