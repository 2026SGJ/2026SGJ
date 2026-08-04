import Entity from '../entity/entity.js';
import ExplosionEntity from './explosionEntity.js';
import { ITEM_CONFIG } from './itemConfig.js';

/**
 * BombEntity — 炸弹实体
 * 
 * 由玩家放置在脚下，经过配置的延迟时间后爆炸。
 * 爆炸对自己免疫，伤害和击退随距离衰减。
 * 
 * 生命周期：
 *   1. 被放置（构造）→ 记录创建时间
 *   2. 每 tick 检查是否到达引爆时间
 *   3. 到达引爆时间 → 创建 ExplosionEntity 并自毁
 */
class BombEntity extends Entity {
    /**
     * @param {number} x - 放置 X 坐标（通常为玩家位置）
     * @param {number} y - 放置 Y 坐标
     * @param {Object} config - 炸弹配置（来自 ITEM_CONFIG.bomb.data）
     * @param {string} ownerSessionId - 放置者 sessionId
     */
    constructor(x, y, config, ownerSessionId) {
        const uniqueId = `bomb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        super({
            id: uniqueId,
            type: 'bomb',
            x: x,
            y: y,
            asset: 'bomb',               // 客户端炸弹精灵
            dir: 0,
            isShowed: true,
            effects: {
                color: 0xff0000,         // 红色标记
                scale: 60,
                ghost: 0,
            },
            width: 30,
            height: 30,
            z_index: 100,
        });

        /** @type {number} 放置时间戳 */
        this.placeTime = Date.now();

        /** @type {number} 引爆延迟（毫秒） */
        this.delay = config.explodeDelay || 4000;

        /**
         * 爆炸配置（传递给 ExplosionEntity / ExplosionSystem）
         * 键名与 ExplosionSystem.applyExplosion 的参数对应
         */
        this.explosionConfig = {
            damage: config.explodeDamage || 300,
            radius: config.explodeRadius || 150,
            knockback: config.explodeKnockback || 25,
            ignoreSelf: config.ignoreSelf !== false,
            ignoreTeammates: config.ignoreTeammates !== false, // 默认不伤队友
        };

        /** @type {string} 放置者 */
        this.ownerSessionId = ownerSessionId;

        /** @type {boolean} 是否已引爆 */
        this.exploded = false;
    }

    /**
     * 每 tick 调用：检查是否到期引爆
     * @param {Object<string, import('../player/index.js').default>} players - 所有玩家
     * @param {import('../world.js').default} world - 世界实例（用于添加 ExplosionEntity）
     * @returns {boolean} true 存活，false 应移除
     */
    tick(players, world) {
        if (this.exploded) return false;

        const elapsed = Date.now() - this.placeTime;
        if (elapsed >= this.delay) {
            this.exploded = true;

            // 创建爆炸实体（伤害在 ExplosionEntity.tick() 首次调用时施加）
            const explosion = new ExplosionEntity(
                this.data.x,
                this.data.y,
                this.explosionConfig,
                players,
                this.ownerSessionId
            );
            world.addItemEntity(explosion);

            console.log(
                `[Bomb] ${this.ownerSessionId} 的炸弹于 ` +
                `(${this.data.x.toFixed(0)}, ${this.data.y.toFixed(0)}) 引爆`
            );

            return false; // 炸弹自身销毁
        }

        return true;
    }
}

export default BombEntity;
