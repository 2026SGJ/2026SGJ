export default {
    id: 'archimedes',
    name: '阿基米德',
    description: '阵地法师 / 地形改造、强制位移、区域封锁',
    health: 900, // 640 × 1.4
    speed: 7.75, // 310 / 40
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '几何打击',
            description: '造成 45 点物理伤害。如果目标处于阿基米德创造的"地形"上，普攻距离增加 50 码，并附带 10% 减速',
            damage: 45,
            cd: 500,
            cost: 0,
            forward: 100
        },
        skill1: {
            name: '支点放置',
            description: '在指定位置放置一个"支点"（地形造物），最多同时存在 3 个，持续 15 秒。敌方英雄距离支点 200 码内时，阿基米德对其造成的伤害提升 20%（杠杆定律）',
            cd: 6000,
            cost: 0,
            forward: 160,
            magic: { // 支点落点对周围敌人造成少量伤害
                damage: 15,
                range: 120
            }
        },
        skill2: {
            name: '绝对刚体',
            description: '在指定位置生成一道长 300 码、宽 50 码的"不可跨越的力场墙"，持续 4 秒。敌方单位无法穿过，但阿基米德和友方单位可以。墙体具有 350 点生命值（引擎内以护盾近似墙体承伤）',
            cd: 14000,
            cost: 100,
            forward: 260,
            buff: [
                {
                    id: 'shield',
                    level: 350,
                    time: 4000
                }
            ]
        },
        skill3: {
            name: '阿基米德之井',
            description: '在指定区域生成一个直径 200 码的"重力陷阱"（地形），持续 5 秒。处于陷阱内的敌方单位，移速降低 40%，且无法使用位移技能',
            cd: 16000,
            cost: 150,
            forward: 260,
            debuff: [ // 陷阱短暂困住目标
                {
                    id: 'freeze',
                    level: 0,
                    time: 1000
                }
            ],
            magic: {
                damage: 0,
                range: 200
            }
        },
        skill4: {
            name: '撬动地球',
            description: '选中所有"支点"，以支点为圆心，引发一场"空间震荡"。将周围 400 码内的所有敌方单位，强制向"支点"方向拉扯 150 码，并造成 120 点真实伤害。增加 0.75 秒前摇预警',
            damage: 120,
            knockback: -150, // 向支点方向拉扯
            cd: 45000,
            cost: 200,
            forward: 500,
            magic: {
                damage: 120,
                knockback: -150,
                range: 400
            }
        }
    }
}
