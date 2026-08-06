import Entity from '../entity/entity.js';
import ExplosionSystem from './explosion.js';
import Vec2 from '../../../utils/vec2.js';
import getBuffClassById from '../buff/index.js';

/**
 * FlashBangEntity — 闪光弹投射物实体
 * 
 * 类似火球但无伤害爆炸。碰墙或敌人后瞬间引爆，对范围内敌人施加
 * 眩晕效果（stun debuff），使其无法移动和攻击。
 * 
 * 眩晕机制：向每个受影响的敌人施加一个 StunBuff。
 */
class FlashBangEntity extends Entity {
    /**
     * @param {number} x - 发射点 X
     * @param {number} y - 发射点 Y
     * @param {Vec2} direction - 飞行方向（单位向量）
     * @param {Object} config - 闪光弹配置（来自 ITEM_CONFIG.flashBang.data）
     * @param {string} ownerSessionId - 发射者 sessionId
     */
    constructor(x, y, direction, config, ownerSessionId) {
        const uniqueId = `flashbang_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        super({
            id: uniqueId,
            type: 'flashBang',
            x: x,
            y: y,
            asset: 'flashBang',          // 客户端闪光弹精灵
            dir: Math.atan2(direction.y, direction.x) * (180 / Math.PI),
            isShowed: true,
            effects: {
                color: 0xffffff,         // 白色闪光
                scale: 45,
                ghost: 0,
            },
            width: 18,
            height: 18,
            z_index: 200,
        });

        /** @type {Vec2} 飞行方向 */
        this.direction = direction.normalized();

        /** @type {number} 飞行速度（像素/秒） */
        this.speed = config.speed || 350;

        /** @type {number} 最大飞行距离 */
        this.maxDistance = config.maxDistance || 500;

        /** @type {number} 已飞行距离 */
        this.traveledDistance = 0;

        /** @type {number} 眩晕持续时间（毫秒） */
        this.stunDuration = config.stunDuration || 2000;

        /** @type {number} 眩晕范围（像素） */
        this.stunRadius = config.stunRadius || 200;

        /** @type {string} */
        this.ownerSessionId = ownerSessionId;
    }

    /**
     * 每 tick 调用
     * @param {number} dt - 时间间隔（毫秒）
     * @param {import('../entity/wall.js').default[]} walls
     * @param {Object<string, import('../player/index.js').default>} players
     * @param {import('../world.js').default} world
     * @returns {boolean}
     */
    tick(dt, walls, players, world) {
        const dtSec = dt / 1000;
        const moveDistance = this.speed * dtSec;

        const newX = this.data.x + this.direction.x * moveDistance;
        const newY = this.data.y + this.direction.y * moveDistance;

        const from = { x: this.data.x, y: this.data.y };
        const to = { x: newX, y: newY };

        // --- 检测墙壁碰撞 ---
        if (ExplosionSystem.isBlockedByWall(from, to, walls)) {
            this._detonate(players, world);
            return false;
        }

        // --- 检测敌人碰撞 ---
        const owner = players[this.ownerSessionId];
        const ownerTeam = owner ? owner.team : null;
        for (const [sid, player] of Object.entries(players)) {
            if (sid === this.ownerSessionId) continue;
            if (ownerTeam && player.team === ownerTeam) continue; // 忽略队友

            const distToPlayer = Math.hypot(to.x - player.x, to.y - player.y);
            if (distToPlayer < 30) {
                this.data.x = to.x;
                this.data.y = to.y;
                this._detonate(players, world);
                return false;
            }
        }

        // 更新位置
        this.data.x = newX;
        this.data.y = newY;
        this.traveledDistance += moveDistance;

        if (this.traveledDistance >= this.maxDistance) {
            // 超出距离无声自毁
            return false;
        }

        return true;
    }

    /**
     * 在当前位置引爆闪光弹：对范围内敌人施加眩晕
     * @private
     */
    _detonate(players, world) {
        const owner = players[this.ownerSessionId];
        const ownerTeam = owner ? owner.team : null;

        for (const [sid, player] of Object.entries(players)) {
            // 不对自己施加
            if (sid === this.ownerSessionId) continue;
            // 忽略队友
            if (ownerTeam && player.team === ownerTeam) continue;

            const dist = Math.hypot(player.x - this.data.x, player.y - this.data.y);
            if (dist > this.stunRadius) continue;

            // 施加眩晕 buff（通过注册表获取正确的 StunBuff 类）
            const StunBuffClass = getBuffClassById('stun');
            const stunBuff = new StunBuffClass({
                id: 'stun',
                level: 0,
                time: this.stunDuration,
            });
            player.giveBuff(stunBuff);

            console.log(
                `[FlashBang] ${sid} 被眩晕 ${this.stunDuration}ms, ` +
                `距离=${dist.toFixed(0)}px`
            );
        }

        console.log(
            `[FlashBang] ${this.ownerSessionId} 的闪光弹引爆于 ` +
            `(${this.data.x.toFixed(0)}, ${this.data.y.toFixed(0)})`
        );
    }
}

export default FlashBangEntity;
