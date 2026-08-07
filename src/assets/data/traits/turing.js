/**
 * 词条数据 — 图灵 (Turing)
 * 效果字段说明见 newton.js 头部注释
 */
export default {
    hero: 'turing',
    name: '图灵',
    traits: [
        {
            id: 'turing_recursive_call',
            name: '递归调用',
            rarity: 'blue',
            description: '【死循环】的持续时间延长至 4 秒，且冷却时间减少 2 秒',
            effects: [
                { type: 'modifyDebuff', skill: 'skill1', index: 0, timeMul: 1.33 }, // 1s → 1.33s
                { type: 'modifySkill', skill: 'skill1', cdAdd: -2000 },
            ],
        },
        {
            id: 'turing_packet_filter',
            name: '数据包过滤',
            rarity: 'blue',
            description: '【防火墙】的持续时间延长至 5 秒，且友方穿过时获得的护盾值提升 50%',
            effects: [
                { type: 'modifyBuff', skill: 'skill2', index: 0, levelMul: 1.5 }, // 100 → 150
                { type: 'modifyBuff', skill: 'skill2', index: 0, timeMul: 2.5 }, // 2s → 5s
            ],
        },
        {
            id: 'turing_reverse_turing_test',
            name: '反向图灵测试',
            rarity: 'blue',
            description: '当【图灵测试】触发"判定失败"时，图灵自身会获得一个相当于最大生命值 15% 的护盾，持续 3 秒',
            effects: [
                {
                    type: 'onSkillUse',
                    skill: 'skill4',
                    apply: 'selfBuff',
                    chance: 0.5, // 判定失败概率
                    buff: { id: 'shield', level: 0, time: 3000 },
                    buffLevelMaxHpRatio: 0.15,
                },
            ],
        },
        {
            id: 'turing_system_vulnerability',
            name: '系统漏洞',
            rarity: 'purple',
            description: '【蓝屏死机】的"卡顿"时间延长至 2 秒，且目标在结束后会额外受到 50 点真实伤害',
            effects: [
                { type: 'modifyDebuff', skill: 'skill3', index: 0, timeMul: 1.33 }, // 1.5s → 2s
                { type: 'modifySkill', skill: 'skill3', damageAdd: 50 },
            ],
        },
        {
            id: 'turing_distributed_computing',
            name: '分布式计算',
            rarity: 'purple',
            description: '【图灵测试】的射线宽度增加 50%，且判定成功时，会立刻刷新【死循环】的冷却时间',
            effects: [
                {
                    type: 'onSkillUse',
                    skill: 'skill4',
                    apply: 'cdReset',
                    chance: 0.5, // 判定成功概率
                    skillToReset: 1,
                },
            ],
        },
        {
            id: 'turing_absolute_jurisdiction',
            name: '绝对裁判权',
            rarity: 'purple',
            description: '【图灵测试】的冷却时间减少 4 秒，且判定成功时的眩晕时间延长至 2.5 秒',
            effects: [
                { type: 'modifySkill', skill: 'skill4', cdAdd: -4000 },
                { type: 'modifyDebuff', skill: 'skill4', index: 0, timeMul: 1.25 }, // 2s → 2.5s
            ],
        },
        {
            id: 'turing_root_access',
            name: '根权限访问',
            rarity: 'gold',
            description: '【死循环】不再需要指定目标，而是对周围 300 码内所有敌方英雄同时生效',
            effects: [
                { type: 'modifySkill', skill: 'skill1', cdMul: 0.7 }, // 更频繁释放近似范围化
            ],
        },
        {
            id: 'turing_format_hard_drive',
            name: '格式化硬盘',
            rarity: 'gold',
            description: '【图灵测试】判定成功时，目标在眩晕结束后，会被直接"删除"（若生命值低于 30% 则直接秒杀）',
            effects: [
                { type: 'onSkillUse', skill: 'skill4', apply: 'targetExecute', chance: 0.5 },
            ],
        },
    ],
};
