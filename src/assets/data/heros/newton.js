export default {
    id: 'newton',
    name: '牛顿',
    description: '聚怪、强制位移、阵地战',
    health: 1200,
    speed: 7.25,
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '惯性重击',
            description: '单发伤害 40，自带微退',
            damage: 40, // 造成的物理伤害
            knockback: 2.5, // 击退效果，数值越大击退越远
            cd: 500, // 两次使用之间的最小间隔时间，单位：毫秒
            cost: 0, // 解锁技能消耗的经济值
            forward: 180 // 从开始攻击到攻击生效的时间间隔，单位：毫秒
        },
        skill1: {
            name: '质量抛掷',
            description: '砸向目标造成 40 点 物理伤害，附带 0.5 秒轻微硬直（打断对方普攻或采集动作）',
            damage: 40,
            knockback: 5, // 击退效果，数值越大击退越远
            cd: 8000, // 两次使用之间的最小间隔时间，单位：毫秒
            cost: 0,
            forward: 350,
            debuff: [ // debuff施加给目标玩家
                {
                    id: 'freeze', // buff 的唯一标识符
                    level: 0, // buff 的等级或强度
                    time: 500 // buff 持续时间，单位：毫秒
                }
            ]
        },
        skill2: {
            name: '重力奇点',
            description: '黑洞吸附。每秒造成 60 点 持续伤害，持续 3 秒，总计 180 点',
            cd: 7000,
            cost: 120,
            knockback: -5, // 负数表示吸引，正数表示击退
            forward: 500,
            debuff: [
                {
                    id: 'damage',
                    level: 3, // 每个tick都会触发，故每秒造成 60 点伤害，持续 3 秒，总计 180 点
                    time: 3000
                }
            ]
        },
        skill3: {
            name: '惯性反冲',
            description: '2秒内攻击伤害提升 200%（普攻伤害提升至 120），并对周围造成 150 点 溅射伤害',
            cd: 5000,
            cost: 80,
            forward: 300,
            buff: [ // buff施加给自身
                {
                    id: 'strength',
                    level: 100,
                    time: 2000
                }
            ],
            magic: { // 范围伤害
                damage: 150,
                knockback: 10,
                range: 75 // 溅射范围，单位：像素
            }
        },
        skill4: {
            name: '第三定律',
            description: '激活后持续 8 秒。期间牛顿受到的所有伤害减少40%反弹给攻击者',
            cd: 15000,
            cost: 150,
            forward: 1500,
            buff: [
                {
                    id: 'rebound',
                    level: 40,
                    time: 8000
                }
            ]
        }
    }
}