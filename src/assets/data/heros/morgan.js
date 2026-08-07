export default {
    id: 'morgan',
    name: '摩尔根',
    description: '标记、弱点打击、资源掠夺',
    health: 980, // 700 × 1.4
    speed: 7.5, // 300 / 40
    animations: {
        run: {
            frames: 2,
        }
    },
    attacks: {
        basic: {
            name: '基因探针',
            description: '单发伤害 25，命中敌方单位会标记其"基因弱点"，持续 4 秒',
            damage: 25,
            cd: 500,
            cost: 0,
            forward: 150,
            debuff: [ // "基因弱点"标记
                {
                    id: 'damage',
                    level: 0,
                    time: 4000
                }
            ]
        },
        skill1: {
            name: '连锁互换',
            description: '选定一个带有"基因弱点"的目标，自身下一次攻击必定暴击，且暴击伤害提升 50%。若该目标被击杀，则返还此技能 50% 冷却时间',
            damage: 25,
            cd: 10000,
            cost: 0,
            forward: 300
        },
        skill2: {
            name: '基因测序',
            description: '对一名敌方单位进行测序，持续 5 秒。测序期间，该目标受到的所有伤害增加 15%，且其位置在小地图上持续暴露',
            cd: 8000,
            cost: 100,
            forward: 350,
            debuff: [ // "测序"标记
                {
                    id: 'damage',
                    level: 0,
                    time: 5000
                }
            ]
        },
        skill3: {
            name: '染色体变异',
            description: '使一名队友获得"变异"状态，持续 6 秒。变异期间，该队友的普攻会额外触发一次 50% 伤害的基因打击，且每次攻击回复 10 点生命值',
            cd: 15000,
            cost: 180,
            forward: 300,
            buff: [
                {
                    id: 'strength',
                    level: 50, // 额外 50% 伤害的基因打击
                    time: 6000
                }
            ]
        },
        skill4: {
            name: '基因掠夺',
            description: '对一名敌方英雄释放，窃取其当前 10% 的移动速度，并将其转化为自身的攻击力加成，持续 8 秒。若目标处于"基因弱点"状态，则窃取效果翻倍',
            cd: 25000,
            cost: 220,
            forward: 400,
            buff: [
                {
                    id: 'speed',
                    level: 10, // 窃取 10% 移速
                    time: 8000
                }
            ]
        }
    }
}
