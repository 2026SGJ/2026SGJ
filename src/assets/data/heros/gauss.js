export default {
    id: 'gauss',
    name: '高斯',
    description: '远程消耗、弹道穿透、磁场控制',
    health: 900, // 640 × 1.4
    speed: 7.88, // 315 / 40
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '磁轨射击',
            description: '单发伤害 25，命中积攒 5 点"磁场值"',
            damage: 25,
            cd: 500,
            cost: 0,
            forward: 150
        },
        skill1: {
            name: '磁力牵引',
            description: '向前方发射一道磁场线，造成 30 点伤害。若命中带有"磁场值"超过 50 的目标，会将其向自身方向拉近 100 码',
            damage: 30,
            knockback: -100, // 负数 = 拉近
            cd: 8000,
            cost: 0,
            forward: 300
        },
        skill2: {
            name: '高斯步枪',
            description: '消耗 40 点"磁场值"，发射一道穿透射线，对直线上的敌人造成 220 点伤害。若命中带有"磁场标记"的目标，伤害提升 30%',
            damage: 220,
            cd: 6000,
            cost: 120,
            forward: 400
        },
        skill3: {
            name: '磁场偏转',
            description: '消耗 30 点"磁场值"，在自身周围生成磁场护盾，持续 4 秒。护盾存在期间，反弹 30% 的远程弹道攻击，并减少受到的 20% 伤害',
            cd: 12000,
            cost: 150,
            forward: 300,
            buff: [
                {
                    id: 'shield',
                    level: 200,
                    time: 4000
                }
            ]
        },
        skill4: {
            name: '磁暴干扰',
            description: '在指定区域部署磁场发生器，持续 8 秒。区域内敌方单位无法积攒"过载值/能量"，且每次释放技能都会受到 80 点真实伤害',
            cd: 20000,
            cost: 200,
            forward: 400,
            debuff: [ // 干扰区域持续伤害
                {
                    id: 'damage',
                    level: 4, // 80/秒
                    time: 8000
                }
            ],
            magic: {
                damage: 80,
                range: 200
            }
        }
    }
}
