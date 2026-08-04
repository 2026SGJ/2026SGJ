/**
 * Buff/Debuff 参数配置
 *
 * 道具施加的各种 Buff 效果参数集中管理。
 * 按 Buff ID 索引，每个条目包含默认持续时间和效果数值。
 */

const BUFF_PARAMS = {
    /** 眩晕（闪光弹、冰冻陷阱） */
    stun: {
        defaultDuration: 2000,           // 默认眩晕时长（毫秒）
        flashBangDuration: 2000,         // 闪光弹眩晕
        freezeTrapDuration: 2500,        // 冰冻陷阱冻结
    },

    /** 加速（加速药剂） */
    speed: {
        defaultBoost: 0.6,               // 默认加速比例 60%
        defaultDuration: 8000,           // 默认持续 8 秒
    },

    /** 护盾（护盾石） */
    shield: {
        defaultAmount: 500,              // 默认护盾吸收量
        defaultDuration: 10000,          // 默认持续 10 秒
    },

    /** 中毒（毒镖） */
    poison: {
        tickDamage: 2,                   // 每 tick 伤害（对应 40/秒，20 ticks/s）
        defaultDuration: 3000,           // 默认持续 3 秒
        impactDamage: 20,                // 命中瞬间伤害
    },

    /** 隐形（隐形斗篷） */
    invisible: {
        defaultDmgReduction: 0.5,        // 默认减伤 50%
        defaultDuration: 4000,           // 默认持续 4 秒
    },

    /** 反弹（荆棘甲） */
    rebound: {
        defaultReflectPercent: 30,       // 默认反弹 30%
        defaultDuration: 6000,           // 默认持续 6 秒
    },

    /** 中毒全局参数 */
    poisonGlobal: {
        ticksPerSecond: 20,              // 游戏 tick 频率
    },
};

export default BUFF_PARAMS;
