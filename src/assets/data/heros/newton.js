export default {
    id: 'newton',
    description: '聚怪、强制位移、阵地战',
    health: 1200,
    speed: 290,
    attacks: {
        basic: {
            name: '惯性重击',
            description: '单发伤害 40，自带微退',
            damage: 40,
            knockback: 0.5,
        },
        skill1: {
            name: '质量抛掷',
            description: '砸向目标造成 40 点 物理伤害，附带 0.5 秒轻微硬直（打断对方普攻或采集动作）',
            damage: 40,
            knockback: 1,
            freeze: 0.5, // 禁用对方操作时间，单位：秒
            cd: 8, // 两次使用之间的最小间隔时间，单位：秒
            cost: 0
        },
        skill2: {
            name: '重力奇点',
            description: '黑洞吸附。每秒造成 60 点 持续伤害，持续 3 秒，总计 180 点',
            cd: 7,
            cost: 120,
            knockback: -0.2,
            debuff: [
                {
                    id: 'damage',
                    level: 60,
                    time: 3
                }
            ]
        },
        skill3: {
            name: '惯性反冲',
            description: '2秒内攻击伤害提升 200%（普攻伤害提升至 120），并对周围造成 150 点 溅射伤害',
            cd: 5,
            cost: 80,
            buff: [
                {
                    id: 'strength',
                    level: 100,
                    time: 2
                }
            ],
            aoedamage: 150
        },
        skill4: {
            name: '第三定律',
            description: '激活后持续 8 秒。期间牛顿受到的所有伤害减少40%反弹给攻击者',
            cd: 15,
            cost: 150,
            buff: [
                {
                    id: 'rebound',
                    level: 40,
                    time: 8
                }
            ]
        }
    }
}