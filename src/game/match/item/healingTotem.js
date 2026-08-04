import Entity from '../entity/entity.js';

/**
 * HealingTotemEntity — 治疗图腾实体
 * 
 * 放置在场景中，持续时间内每秒为周围队友回复生命值。
 * 对敌人无效果，对自己也有效。
 * 
 * 治疗机制：每 tickInterval 毫秒对范围内队友进行一次治疗。
 */
class HealingTotemEntity extends Entity {
    /**
     * @param {number} x - 放置 X 坐标
     * @param {number} y - 放置 Y 坐标
     * @param {Object} config - 治疗图腾配置（来自 ITEM_CONFIG.healingTotem.data）
     * @param {string} ownerSessionId - 放置者 sessionId
     * @param {string} ownerTeam - 放置者队伍
     */
    constructor(x, y, config, ownerSessionId, ownerTeam) {
        const uniqueId = `totem_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        super({
            id: uniqueId,
            type: 'healingTotem',
            x: x,
            y: y,
            asset: 'healingTotem',       // 客户端治疗图腾精灵
            dir: 0,
            isShowed: true,
            effects: {
                color: 0x00ff88,         // 绿色治疗光
                scale: Math.min(150, config.radius || 150),
                ghost: 0,
            },
            width: 40,
            height: 40,
            z_index: 100,
        });

        /** @type {number} 创建时间戳 */
        this.createTime = Date.now();

        /** @type {number} 图腾持续时间（毫秒） */
        this.duration = config.duration || 8000;

        /** @type {number} 治疗范围（像素） */
        this.radius = config.radius || 150;

        /** @type {number} 每次治疗量 */
        this.healPerTick = config.healPerTick || 50;

        /** @type {number} 治疗间隔（毫秒） */
        this.tickInterval = config.tickInterval || 1000;

        /** @type {number} 上次治疗时间戳 */
        this.lastHealTick = 0;

        /** @type {string} */
        this.ownerSessionId = ownerSessionId;

        /** @type {string} */
        this.ownerTeam = ownerTeam;
    }

    /**
     * 每 tick 调用：按间隔对范围内队友进行治疗
     * @param {Object<string, import('../player/index.js').default>} players
     * @param {import('../world.js').default} world
     * @returns {boolean}
     */
    tick(players, world) {
        const now = Date.now();

        // 检查是否到期
        if (now - this.createTime >= this.duration) {
            console.log(`[HealingTotem] 图腾消散于 (${this.data.x.toFixed(0)}, ${this.data.y.toFixed(0)})`);
            return false;
        }

        // 按间隔治疗
        if (now - this.lastHealTick >= this.tickInterval) {
            this.lastHealTick = now;

            let healCount = 0;
            for (const [sid, player] of Object.entries(players)) {
                // 仅治疗同队队友（包括自己）
                if (player.team !== this.ownerTeam) continue;

                const dist = Math.hypot(player.x - this.data.x, player.y - this.data.y);
                if (dist > this.radius) continue;

                // 治疗：恢复生命值，不超过最大值
                const oldHealth = player.health;
                player.health = Math.min(player.maxHealth, player.health + this.healPerTick);
                const actualHeal = player.health - oldHealth;

                if (actualHeal > 0) {
                    healCount++;
                    console.log(
                        `[HealingTotem] 治疗 ${sid}: +${actualHeal} HP ` +
                        `(${player.health}/${player.maxHealth})`
                    );
                }
            }

            if (healCount > 0) {
                console.log(`[HealingTotem] 本 tick 治疗了 ${healCount} 名队友`);
            }
        }

        return true;
    }
}

export default HealingTotemEntity;
