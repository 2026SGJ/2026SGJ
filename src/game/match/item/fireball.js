import Entity from '../entity/entity.js';
import ExplosionEntity from './explosionEntity.js';
import ExplosionSystem from './explosion.js';
import Vec2 from '../../../utils/vec2.js';

/**
 * FireballEntity — 火球投射物实体
 * 
 * 由玩家向面朝方向发射，以固定速度飞行。
 * 碰到墙壁或敌人时瞬间爆炸，造成范围伤害和击退。
 * 
 * 飞行机制：
 *   - 每 tick 沿方向移动 speed × tickInterval 像素
 *   - 检查与墙壁的碰撞（通过 ExplosionSystem.isBlockedByWall）
 *   - 检查与敌人玩家的接近（距离 < 25px 时引爆）
 *   - 超过最大飞行距离后自毁（不爆炸）
 */
class FireballEntity extends Entity {
    /**
     * @param {number} x - 发射点 X
     * @param {number} y - 发射点 Y
     * @param {Vec2} direction - 飞行方向（单位向量）
     * @param {Object} config - 火球配置（来自 ITEM_CONFIG.fireball.data）
     * @param {string} ownerSessionId - 发射者 sessionId
     */
    constructor(x, y, direction, config, ownerSessionId) {
        const uniqueId = `fireball_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        super({
            id: uniqueId,
            type: 'fireball',
            x: x,
            y: y,
            asset: 'fireball',           // 客户端火球精灵
            dir: Math.atan2(direction.y, direction.x) * (180 / Math.PI),
            isShowed: true,
            effects: {
                color: 0xff6600,         // 橙红色火光
                scale: 50,
                ghost: 0,
            },
            width: 20,
            height: 20,
            z_index: 200,
        });

        /** @type {Vec2} 飞行方向（单位向量） */
        this.direction = direction.normalized();

        /** @type {number} 飞行速度（像素/秒） */
        this.speed = config.speed || 400;

        /** @type {number} 最大飞行距离（像素） */
        this.maxDistance = config.maxDistance || 600;

        /** @type {number} 已飞行距离 */
        this.traveledDistance = 0;

        /** @type {Object} 爆炸配置 */
        this.explosionConfig = {
            damage: config.explodeDamage || 250,
            radius: config.explodeRadius || 120,
            knockback: config.explodeKnockback || 40,
            ignoreSelf: config.ignoreSelf !== false,
            ignoreTeammates: config.ignoreTeammates !== false,
        };

        /** @type {string} 发射者 */
        this.ownerSessionId = ownerSessionId;
    }

    /**
     * 每 tick 调用：移动并检测碰撞
     * 
     * @param {number} dt - 距离上一帧的时间间隔（毫秒）
     * @param {import('../entity/wall.js').default[]} walls - 墙体列表
     * @param {Object<string, import('../player/index.js').default>} players - 所有玩家
     * @param {import('../world.js').default} world - 世界实例
     * @returns {boolean} true 存活，false 应移除
     */
    tick(dt, walls, players, world) {
        // 转换为秒
        const dtSec = dt / 1000;
        const moveDistance = this.speed * dtSec;

        // 计算新位置
        const newX = this.data.x + this.direction.x * moveDistance;
        const newY = this.data.y + this.direction.y * moveDistance;

        const from = { x: this.data.x, y: this.data.y };
        const to = { x: newX, y: newY };

        // --- 检测墙壁碰撞 ---
        if (ExplosionSystem.isBlockedByWall(from, to, walls)) {
            // 碰到墙壁：在碰撞点引爆
            this._explode(players, world);
            return false;
        }

        // --- 检测敌人碰撞 ---
        // 遍历所有玩家，检查火球是否飞入敌人身体范围内（30px）
        const owner = players[this.ownerSessionId];
        const ownerTeam = owner ? owner.team : null;
        for (const [sid, player] of Object.entries(players)) {
            if (sid === this.ownerSessionId) continue; // 略过自己
            if (ownerTeam && player.team === ownerTeam) continue; // 忽略队友

            const distToPlayer = Math.hypot(to.x - player.x, to.y - player.y);
            if (distToPlayer < 30) {
                // 命中敌人：在命中点引爆
                this.data.x = to.x;
                this.data.y = to.y;
                this._explode(players, world);
                return false;
            }
        }

        // --- 更新位置 ---
        this.data.x = newX;
        this.data.y = newY;
        this.traveledDistance += moveDistance;

        // --- 检查最大飞行距离 ---
        if (this.traveledDistance >= this.maxDistance) {
            console.log(`[Fireball] 飞弹超出最大距离 (${this.traveledDistance.toFixed(0)}px)，自毁`);
            return false;
        }

        return true;
    }

    /**
     * 在当前位置引爆火球
     * @private
     */
    _explode(players, world) {
        const explosion = new ExplosionEntity(
            this.data.x,
            this.data.y,
            this.explosionConfig,
            players,
            this.ownerSessionId
        );
        world.addItemEntity(explosion);
        console.log(
            `[Fireball] ${this.ownerSessionId} 的火球于 ` +
            `(${this.data.x.toFixed(0)}, ${this.data.y.toFixed(0)}) 爆炸`
        );
    }
}

export default FireballEntity;
