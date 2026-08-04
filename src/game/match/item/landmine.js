import Entity from '../entity/entity.js';
import ExplosionEntity from './explosionEntity.js';

/**
 * LandmineEntity — 地雷实体
 * 
 * 由玩家放置在地面，对队友和自己免疫。
 * 当敌方玩家进入触发距离时，经过短暂延迟后爆炸。
 * 
 * 状态机：
 *   1. IDLE（待触发）：检测敌人接近
 *   2. ARMED（已触发）：短暂延迟后爆炸
 *   3. EXPLODED（已爆炸）：自毁
 */
class LandmineEntity extends Entity {
    /**
     * @param {number} x - 放置 X 坐标
     * @param {number} y - 放置 Y 坐标
     * @param {Object} config - 地雷配置（来自 ITEM_CONFIG.landmine.data）
     * @param {string} ownerSessionId - 放置者 sessionId
     * @param {string} ownerTeam - 放置者所属队伍
     */
    constructor(x, y, config, ownerSessionId, ownerTeam) {
        const uniqueId = `landmine_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        super({
            id: uniqueId,
            type: 'landmine',
            x: x,
            y: y,
            asset: 'landmine',           // 客户端地雷精灵
            dir: 0,
            isShowed: true,              // 地雷对所有人可见（但仅敌人触发）
            effects: {
                color: 0x444444,         // 暗色标记
                scale: 40,
                ghost: 0,
            },
            width: 24,
            height: 24,
            z_index: 50,
        });

        /** @type {number} 敌人触发距离（像素） */
        this.triggerDistance = config.triggerDistance || 50;

        /** @type {number} 触发后爆炸前延迟（毫秒） */
        this.triggerDelay = config.triggerDelay || 500;

        /** @type {number} 触发时间戳（0 = 未触发） */
        this.triggerTime = 0;

        /** @type {Object} 爆炸配置 */
        this.explosionConfig = {
            damage: config.explodeDamage || 350,
            radius: config.explodeRadius || 100,
            knockback: config.explodeKnockback || 60,
            ignoreSelf: config.ignoreSelf !== false,
            ignoreTeammates: config.ignoreTeammates !== false,
        };

        /** @type {string} */
        this.ownerSessionId = ownerSessionId;

        /** @type {string} */
        this.ownerTeam = ownerTeam;
    }

    /**
     * 每 tick 调用：检测敌人接近 → 触发 → 爆炸
     * 
     * @param {Object<string, import('../player/index.js').default>} players - 所有玩家
     * @param {import('../world.js').default} world - 世界实例
     * @returns {boolean} true 存活，false 应移除
     */
    tick(players, world) {
        // 已触发 → 等待爆炸延迟
        if (this.triggerTime > 0) {
            if (Date.now() - this.triggerTime >= this.triggerDelay) {
                // 爆炸
                const explosion = new ExplosionEntity(
                    this.data.x,
                    this.data.y,
                    this.explosionConfig,
                    players,
                    this.ownerSessionId
                );
                world.addItemEntity(explosion);
                console.log(
                    `[Landmine] ${this.ownerSessionId} 的地雷于 ` +
                    `(${this.data.x.toFixed(0)}, ${this.data.y.toFixed(0)}) 爆炸`
                );
                return false; // 自毁
            }
            return true;
        }

        // 待触发 → 检测敌人接近
        for (const [sid, player] of Object.entries(players)) {
            // 略过自己和队友
            if (sid === this.ownerSessionId) continue;
            if (player.team === this.ownerTeam) continue;

            const dist = Math.hypot(player.x - this.data.x, player.y - this.data.y);
            if (dist <= this.triggerDistance) {
                this.triggerTime = Date.now();
                console.log(
                    `[Landmine] 地雷被 ${sid} 触发，距离 ${dist.toFixed(0)}px, ` +
                    `${this.triggerDelay}ms 后爆炸`
                );
                // 触发后改变外观提示
                this.data.effects = { ...this.data.effects, color: 0xff0000, scale: 55 };
                break;
            }
        }

        return true;
    }
}

export default LandmineEntity;
