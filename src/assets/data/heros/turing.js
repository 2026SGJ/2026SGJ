export default {
    id: 'turing',
    name: '图灵',
    description: '软辅 / 逻辑控制 / 战术干扰',
    health: 840, // 600 × 1.4
    speed: 7.5, // 300 / 40
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '代码流',
            description: '向目标发射一串代码，造成 25 点魔法伤害。若命中敌方英雄，会标记目标 3 秒，期间图灵对其造成伤害时，会恢复自身 10 点生命值',
            damage: 25,
            cd: 500,
            cost: 0,
            forward: 100
        },
        skill1: {
            name: '死循环',
            description: '指定一名敌方英雄，使其陷入"逻辑死锁"。目标在接下来的 3 秒内无法释放任何技能，且下一次普攻伤害降低 50%（引擎内以眩晕近似无法释放技能）',
            cd: 12000,
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
            name: '防火墙',
            description: '在指定区域生成一道持续 4 秒的逻辑屏障。敌方穿过：触发"系统冲突"，50% 概率被禁言（禁止移动）2 秒；50% 概率被强制加速（移速翻倍但无法攻击和释放技能）2 秒。友方穿过：获得一个持续 2 秒的护盾，并提升 20% 移速',
            cd: 16000,
            cost: 120,
            forward: 260,
            buff: [
                {
                    id: 'shield',
                    level: 100,
                    time: 2000
                }
            ],
            magic: {
                damage: 0,
                range: 200
            }
        },
        skill3: {
            name: '蓝屏死机',
            description: '指定一名敌方英雄，使其在原地"卡顿"1.5 秒（无法移动、攻击、释放技能），随后受到 120 点伤害并减速 40%，持续 2 秒',
            damage: 120,
            cd: 20000,
            cost: 180,
            forward: 260,
            debuff: [
                {
                    id: 'stun',
                    level: 0,
                    time: 1500
                }
            ]
        },
        skill4: {
            name: '图灵测试',
            description: '向指定方向发射一道"测试射线"，对命中的第一个敌方英雄进行身份判定，判定概率各 50%。判定成功（判定为机器）：目标被系统强制"死机"，造成 200 点伤害，眩晕并沉默 2 秒。判定失败（判定为人类）：目标暴露了"人类弱点"，受到的所有伤害增加 20%，持续 3 秒',
            damage: 200,
            cd: 22000,
            cost: 200,
            forward: 330,
            debuff: [
                {
                    id: 'stun',
                    level: 0,
                    time: 2000
                }
            ]
        }
    }
}
