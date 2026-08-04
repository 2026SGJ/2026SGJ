/**
 * 爆炸参数配置
 *
 * 所有爆炸类道具（炸弹、火球、地雷等）共享的爆炸行为参数。
 * 按道具 ID 索引，每个条目包含：
 * - damage:         爆炸中心最大伤害值
 * - radius:         爆炸最大影响半径（像素）
 * - knockback:      爆炸中心最大击退力度（像素单位）
 * - ignoreSelf:     对自己是否免疫
 * - ignoreTeammates: 对队友是否免疫
 */

const EXPLOSION_CONFIG = {
    /** 炸弹 — 标准爆炸 */
    bomb: {
        explodeDelay: 4000,       // 放置到爆炸延迟（毫秒）
        explodeDamage: 300,
        explodeRadius: 150,
        explodeKnockback: 25,
        ignoreSelf: true,
        ignoreTeammates: false,
    },

    /** 火球 — 飞行爆炸 */
    fireball: {
        speed: 400,               // 飞行速度（像素/秒）
        maxDistance: 600,         // 最大飞行距离（像素）
        explodeDamage: 250,
        explodeRadius: 120,
        explodeKnockback: 40,
        ignoreSelf: true,
        ignoreTeammates: false,
    },

    /** 地雷 — 触发爆炸 */
    landmine: {
        triggerDistance: 50,      // 触发距离（像素）
        triggerDelay: 500,        // 触发后爆炸前延迟（毫秒）
        explodeDamage: 350,
        explodeRadius: 100,
        explodeKnockback: 60,
        ignoreSelf: true,
        ignoreTeammates: true,
    },

    /** 破片手雷 — 大范围低伤 */
    fragGrenade: {
        explodeDelay: 1500,
        explodeDamage: 80,
        explodeRadius: 250,
        explodeKnockback: 10,
        ignoreSelf: true,
        ignoreTeammates: false,
    },
};

/**
 * 爆炸视觉效果默认参数
 */
const EXPLOSION_VISUAL = {
    /** 爆炸视觉持续时间（毫秒） */
    VISUAL_DURATION: 300,
    /** 默认爆炸颜色（橙红） */
    DEFAULT_COLOR: 0xff4400,
    /** z-index 层级 */
    Z_INDEX: 5000,
};

export { EXPLOSION_CONFIG, EXPLOSION_VISUAL };
