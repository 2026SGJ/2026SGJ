export default {
    id: 'dalton',
    name: '道尔顿',
    description: '持续消耗、区域封锁、破盾特化',
    health: 1050, // 750 × 1.4
    speed: 7.38, // 295 / 40
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '酸液飞溅',
            description: '单发伤害 20，附带持续 3 秒的腐蚀效果，每秒造成 5 点伤害',
            damage: 20,
            cd: 500,
            cost: 0,
            forward: 100,
            debuff: [
                {
                    id: 'poison', // 腐蚀
                    level: 0.25, // 5/秒
                    time: 3000
                }
            ]
        },
        skill1: {
            name: '惰性气体屏障',
            description: '释放一团惰性气体包裹自身，持续 4 秒。期间受到的伤害减少 90%，但自身无法进行攻击和释放技能，且移速降低 30%',
            cd: 12000,
            cost: 0,
            forward: 260,
            buff: [
                {
                    id: 'invisible', // 90% 减伤 + 无法攻击
                    level: 90,
                    time: 4000
                }
            ]
        },
        skill2: {
            name: '强酸腐蚀池',
            description: '在指定区域泼洒强酸，持续 5 秒。区域内敌人每秒受到 40 点伤害，且护盾恢复速度降低 50%。对建筑额外造成 30% 伤害',
            cd: 8000,
            cost: 100,
            forward: 260,
            debuff: [ // 酸池持续腐蚀
                {
                    id: 'poison',
                    level: 2, // 40/秒
                    time: 5000
                }
            ],
            magic: {
                damage: 40,
                range: 200
            }
        },
        skill3: {
            name: '共价键链接',
            description: '与一名队友建立链接，持续 6 秒。期间双方受到的伤害由两人平摊，且链接期间双方移速提升 15%',
            cd: 12000,
            cost: 150,
            forward: 200,
            buff: [
                {
                    id: 'speed',
                    level: 15,
                    time: 6000
                }
            ]
        },
        skill4: {
            name: '链式反应',
            description: '引爆范围内所有带有"腐蚀效果"的敌方单位，造成 150 点范围伤害，并使其身上的腐蚀效果持续时间翻倍',
            damage: 150,
            cd: 20000,
            cost: 200,
            forward: 260,
            magic: {
                damage: 150,
                range: 250
            }
        }
    }
}
