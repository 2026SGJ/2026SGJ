export default {
    id: 'descartes',
    name: '笛卡尔',
    description: '空间控制、强制位移、战术分割',
    health: 920, // 660 × 1.4
    speed: 7.63, // 305 / 40
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '坐标打击',
            description: '单发伤害 30，命中敌方单位有 50% 的概率会在其脚下生成一个"坐标锚点"，场上最多的坐标锚点不得超过 3 个',
            damage: 30,
            cd: 500,
            cost: 0,
            forward: 100
        },
        skill1: {
            name: '空间折叠',
            description: '随机传送到场上标记的锚点，传送过程造成 50 点伤害，并使其眩晕 1 秒',
            damage: 50,
            cd: 10000,
            cost: 0,
            forward: 230,
            debuff: [
                {
                    id: 'stun',
                    level: 0,
                    time: 1000
                }
            ]
        },
        skill2: {
            name: '绝对直线',
            description: '消耗一个"坐标锚点"，向该锚点发射一道不可阻挡的几何射线，对直线上所有敌人造成 150 点伤害',
            damage: 150,
            cd: 8000,
            cost: 100,
            forward: 260
        },
        skill3: {
            name: '维度降维',
            description: '将指定区域（半径 200 码）内的敌方单位"降维"为 2D 平面状态，持续 3 秒。降维期间，敌人无法使用位移技能，且受到的所有伤害增加 20%',
            cd: 15000,
            cost: 180,
            forward: 260,
            debuff: [ // "降维"标记
                {
                    id: 'damage',
                    level: 0,
                    time: 3000
                }
            ],
            magic: {
                damage: 0,
                range: 200
            }
        },
        skill4: {
            name: '坐标系重构',
            description: '瞬间交换自身与一名队友（或 AI）的位置，并为双方提供一个持续 4 秒、吸收 200 点伤害的"几何护盾"',
            cd: 25000,
            cost: 220,
            forward: 230,
            buff: [
                {
                    id: 'shield',
                    level: 200,
                    time: 4000
                }
            ]
        }
    }
}
