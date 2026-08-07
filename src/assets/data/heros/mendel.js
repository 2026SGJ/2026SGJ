export default {
    id: 'mendel',
    name: '孟德尔',
    description: '召唤、繁衍、双向续航、持续作战',
    health: 1120, // 800 × 1.4
    speed: 7.1, // 285 / 40
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '藤条抽击',
            description: '单发伤害 35，纯功能性攻击，无自带回血',
            damage: 35,
            cd: 500,
            cost: 0,
            forward: 100
        },
        skill1: {
            name: '人工授粉',
            description: '对前方扇形区域进行"去雄与授粉"操作。造成 25 点伤害，并使目标在 3 秒内受到的所有伤害增加 10%（标记"杂交靶标"）',
            damage: 25,
            cd: 12000,
            cost: 0,
            forward: 200,
            debuff: [ // "杂交靶标"标记（引擎内为无伤害的伤害标记，用于客户端展示）
                {
                    id: 'damage',
                    level: 0,
                    time: 3000
                }
            ]
        },
        skill2: {
            name: '孟德尔的豌豆园',
            description: '在指定区域种下豌豆炮台，持续 12 秒。每秒对周围 200 码内的敌人造成 25 点伤害，并为孟德尔提供 5 点/秒的生命回复',
            cd: 10000,
            cost: 120,
            forward: 260,
            debuff: [ // 炮台对主目标的持续伤害
                {
                    id: 'damage',
                    level: 1.25, // 25/秒
                    time: 12000
                }
            ],
            magic: { // 炮台落点伤害
                damage: 25,
                range: 200
            }
        },
        skill3: {
            name: '基因重组',
            description: '献祭当前 15% 的最大生命值，立即刷新所有基础技能冷却时间，并获得一个等同于献祭生命值 200% 的临时护盾（引擎内以固定护盾近似）',
            cd: 18000,
            cost: 180,
            forward: 200,
            buff: [
                {
                    id: 'shield',
                    level: 300,
                    time: 3000
                }
            ]
        },
        skill4: {
            name: '共生体',
            description: '与 AI 助手或一名队友建立共生链接，持续 10 秒。期间双方共享 30% 的伤害与治疗，且孟德尔的普攻会为目标叠加"共生印记"（每层提升 3% 伤害，最高叠 5 层）',
            cd: 25000,
            cost: 220,
            forward: 200,
            buff: [
                {
                    id: 'strength',
                    level: 15, // 近似共生链接的伤害共享收益
                    time: 10000
                }
            ]
        }
    }
}
