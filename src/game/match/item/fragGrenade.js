import Entity from '../entity/entity.js';
import ExplosionEntity from './explosionEntity.js';

/**
 * FragGrenadeEntity — 破片手雷实体
 * 
 * 投掷到脚下，引信时间短（1.5 秒），范围大（250px）但伤害低。
 * 适合清场和骚扰。
 */
class FragGrenadeEntity extends Entity {
    /**
     * @param {number} x - 放置 X 坐标
     * @param {number} y - 放置 Y 坐标
     * @param {Object} config - 手雷配置（来自 ITEM_CONFIG.fragGrenade.data）
     * @param {string} ownerSessionId - 投掷者 sessionId
     */
    constructor(x, y, config, ownerSessionId) {
        const uniqueId = `grenade_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        super({
            id: uniqueId,
            type: 'fragGrenade',
            x: x,
            y: y,
            asset: 'fragGrenade',        // 客户端手雷精灵
            dir: 0,
            isShowed: true,
            effects: {
                color: 0x88aa00,         // 军绿色标记
                scale: 50,
                ghost: 0,
            },
            width: 24,
            height: 24,
            z_index: 100,
        });

        /** @type {number} 放置时间戳 */
        this.placeTime = Date.now();

        /** @type {number} 引信延迟（毫秒） */
        this.delay = config.explodeDelay || 1500;

        /** @type {Object} 爆炸配置 */
        this.explosionConfig = {
            damage: config.explodeDamage || 80,
            radius: config.explodeRadius || 250,
            knockback: config.explodeKnockback || 10,
            ignoreSelf: config.ignoreSelf !== false,
            ignoreTeammates: false,        // 手雷伤队友（注意误伤）
        };

        /** @type {string} */
        this.ownerSessionId = ownerSessionId;

        /** @type {boolean} */
        this.exploded = false;
    }

    /**
     * 每 tick 调用：检查引信是否到期
     * @param {Object<string, import('../player/index.js').default>} players
     * @param {import('../world.js').default} world
     * @returns {boolean}
     */
    tick(players, world) {
        if (this.exploded) return false;

        if (Date.now() - this.placeTime >= this.delay) {
            this.exploded = true;
            const explosion = new ExplosionEntity(
                this.data.x, this.data.y,
                this.explosionConfig,
                players, this.ownerSessionId
            );
            world.addItemEntity(explosion);
            console.log(`[FragGrenade] 破片手雷引爆于 (${this.data.x.toFixed(0)}, ${this.data.y.toFixed(0)})`);
            return false;
        }
        return true;
    }
}

export default FragGrenadeEntity;
