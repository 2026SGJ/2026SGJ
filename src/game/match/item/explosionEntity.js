import Entity from '../entity/entity.js';
import ExplosionSystem from './explosion.js';

/**
 * ExplosionEntity — 爆炸视觉实体
 * 
 * 在场景中出现短暂时间（通常 300ms），显示爆炸动画效果。
 * 伤害和击退在创建时立即通过 ExplosionSystem.applyExplosion 施加，
 * ExplosionEntity 本身仅负责视觉反馈和到期自毁。
 * 
 * 使用方式：
 *   const exp = new ExplosionEntity(x, y, { damage, radius, knockback, ignoreSelf, ignoreTeammates }, players, ownerSessionId);
 *   world.addItemEntity(exp);
 */
class ExplosionEntity extends Entity {
    /**
     * @param {number} x - 爆炸中心 X 坐标
     * @param {number} y - 爆炸中心 Y 坐标
     * @param {Object} explosionConfig - 爆炸参数（传递给 ExplosionSystem）
     * @param {Object<string, import('../player/index.js').default>} players - 所有玩家映射
     * @param {string} ownerSessionId - 施法者 sessionId
     */
    constructor(x, y, explosionConfig, players, ownerSessionId) {
        // 生成唯一 ID：基于时间戳 + 随机数
        const uniqueId = `explosion_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        super({
            id: uniqueId,
            type: 'explosion',
            x: x,
            y: y,
            asset: 'explosion',           // 客户端爆炸动画资源
            dir: 0,
            isShowed: true,
            effects: {
                color: 0xff4400,          // 爆炸暖色光
                scale: explosionConfig.radius ? Math.min(200, explosionConfig.radius) : 100,
                ghost: 0,
            },
            width: explosionConfig.radius ? explosionConfig.radius * 2 : 200,
            height: explosionConfig.radius ? explosionConfig.radius * 2 : 200,
            z_index: 5000,                // 爆炸显示在最顶层
        });

        /** @type {number} 爆炸创建时间戳 */
        this.createTime = Date.now();

        /** @type {number} 爆炸视觉持续时间（毫秒） */
        this.visualDuration = 300;

        /** @type {boolean} 伤害是否已施加（避免重复） */
        this.damageApplied = false;

        /** @type {Object} 爆炸参数（供 tick 中首次施加伤害） */
        this.explosionConfig = explosionConfig;

        /** @type {Object<string, import('../player/index.js').default>} */
        this.players = players;

        /** @type {string} */
        this.ownerSessionId = ownerSessionId;
    }

    /**
     * 每 tick 调用
     * 首次 tick 时施加伤害和击退，后续仅检查是否到期
     * @returns {boolean} true 表示实体仍存活，false 表示可以移除
     */
    tick() {
        // --- 首次 tick：施加爆炸伤害和击退 ---
        if (!this.damageApplied) {
            this.damageApplied = true;
            ExplosionSystem.applyExplosion(
                { x: this.data.x, y: this.data.y },
                this.explosionConfig,
                this.players,
                this.ownerSessionId
            );
            console.log(
                `[ExplosionEntity] 爆炸于 (${this.data.x.toFixed(0)}, ${this.data.y.toFixed(0)}), ` +
                `damage=${this.explosionConfig.damage || 0}, radius=${this.explosionConfig.radius || 0}`
            );
        }

        // --- 视觉持续时间结束后自毁 ---
        if (Date.now() - this.createTime >= this.visualDuration) {
            return false; // 通知调用者移除此实体
        }
        return true;
    }
}

export default ExplosionEntity;
