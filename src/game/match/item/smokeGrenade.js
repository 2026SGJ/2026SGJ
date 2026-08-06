import Entity from '../entity/entity.js';
import getBuffClassById from '../buff/index.js';

/**
 * SmokeGrenadeEntity — 烟雾弹实体
 * 
 * 在场景中创建一片烟雾区域，持续时间内每 500ms 对范围内的
 * 敌方玩家施加减速 debuff（SpeedBuff 的减速变体，此处用 freeze 效果模拟）。
 * 
 * 减速机制：对烟雾范围内的敌人施加短暂的 freeze debuff（仅降低速度），
 * 实际表现为每 tick 降低其移动速度。
 */
class SmokeGrenadeEntity extends Entity {
    /**
     * @param {number} x - 放置 X 坐标
     * @param {number} y - 放置 Y 坐标
     * @param {Object} config - 烟雾弹配置（来自 ITEM_CONFIG.smokeGrenade.data）
     * @param {string} ownerSessionId - 投掷者 sessionId
     * @param {string} ownerTeam - 投掷者队伍
     */
    constructor(x, y, config, ownerSessionId, ownerTeam) {
        const uniqueId = `smoke_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        super({
            id: uniqueId,
            type: 'smokeGrenade',
            x: x,
            y: y,
            asset: 'smokeGrenade',       // 客户端烟雾精灵
            dir: 0,
            isShowed: true,
            effects: {
                color: 0x888888,         // 灰色烟雾
                scale: Math.min(200, config.radius || 180),
                ghost: 80,               // 半透明效果
            },
            width: (config.radius || 180) * 2,
            height: (config.radius || 180) * 2,
            z_index: 80,
        });

        /** @type {number} 创建时间戳 */
        this.createTime = Date.now();

        /** @type {number} 烟雾持续时间（毫秒） */
        this.duration = config.duration || 6000;

        /** @type {number} 烟雾范围（像素） */
        this.radius = config.radius || 180;

        /** @type {number} 减速比例（0~1） */
        this.slowAmount = config.slowAmount || 0.4;

        /** @type {number} 减速 debuff 施加间隔（毫秒） */
        this.tickInterval = config.tickInterval || 500;

        /** @type {number} 上次施加减速的时间戳 */
        this.lastSlowTick = 0;

        /** @type {string} */
        this.ownerSessionId = ownerSessionId;

        /** @type {string} */
        this.ownerTeam = ownerTeam;
    }

    /**
     * 每 tick 调用：对范围内敌人施加减速
     * @param {Object<string, import('../player/index.js').default>} players
     * @param {import('../world.js').default} world
     * @returns {boolean}
     */
    tick(players, world) {
        const now = Date.now();

        // 检查是否到期
        if (now - this.createTime >= this.duration) {
            console.log(`[SmokeGrenade] 烟雾消散于 (${this.data.x.toFixed(0)}, ${this.data.y.toFixed(0)})`);
            return false;
        }

        // 按间隔施加减速 debuff
        if (now - this.lastSlowTick >= this.tickInterval) {
            this.lastSlowTick = now;

            // 对范围内每个敌人施加短暂减速
            for (const [sid, player] of Object.entries(players)) {
                if (sid === this.ownerSessionId) continue;
                if (player.team === this.ownerTeam) continue; // 不减速队友

                const dist = Math.hypot(player.x - this.data.x, player.y - this.data.y);
                if (dist > this.radius) continue;

                // 施加短暂减速（550ms，刚好覆盖下一次 tick 间隔）
                const FreezeBuffClass = getBuffClassById('freeze');
                const slowBuff = new FreezeBuffClass({
                    id: 'freeze',
                    level: 0,
                    time: 550,
                });
                player.giveBuff(slowBuff);

                // 附加降低速度倍率（副作用：烟雾弹还降低玩家的速度乘数）
                if (!player.slowAmount || this.slowAmount > player.slowAmount) {
                    player.slowAmount = this.slowAmount;
                }
            }
        }

        return true;
    }
}

export default SmokeGrenadeEntity;
