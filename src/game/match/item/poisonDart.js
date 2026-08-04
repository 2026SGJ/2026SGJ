import Entity from '../entity/entity.js';
import ExplosionSystem from './explosion.js';
import Vec2 from '../../../utils/vec2.js';
import getBuffClassById from '../buff/index.js';

/**
 * PoisonDartEntity — 毒镖投射物实体
 * 
 * 高速飞行的小型投射物。命中敌人后造成少量即时伤害，
 * 并施加持续中毒效果（PoisonBuff），每秒造成固定伤害。
 */
class PoisonDartEntity extends Entity {
    /**
     * @param {number} x - 发射点 X
     * @param {number} y - 发射点 Y
     * @param {Vec2} direction - 飞行方向（单位向量）
     * @param {Object} config - 毒镖配置（来自 ITEM_CONFIG.poisonDart.data）
     * @param {string} ownerSessionId - 发射者 sessionId
     */
    constructor(x, y, direction, config, ownerSessionId) {
        const uniqueId = `poisonDart_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        super({
            id: uniqueId,
            type: 'poisonDart',
            x: x,
            y: y,
            asset: 'poisonDart',         // 客户端毒镖精灵
            dir: Math.atan2(direction.y, direction.x) * (180 / Math.PI),
            isShowed: true,
            effects: {
                color: 0x00cc00,         // 绿色毒液
                scale: 35,
                ghost: 0,
            },
            width: 12,
            height: 12,
            z_index: 200,
        });

        /** @type {Vec2} 飞行方向 */
        this.direction = direction.normalized();

        /** @type {number} 飞行速度（像素/秒） */
        this.speed = config.speed || 500;

        /** @type {number} 最大飞行距离 */
        this.maxDistance = config.maxDistance || 700;

        /** @type {number} 已飞行距离 */
        this.traveledDistance = 0;

        /** @type {number} 命中瞬间附加伤害 */
        this.impactDamage = config.impactDamage || 20;

        /** @type {number} 每秒中毒伤害（由 PoisonBuff 的 level 控制） */
        this.poisonDamage = config.poisonDamage || 40;

        /** @type {number} 中毒持续时间（毫秒） */
        this.poisonDuration = config.poisonDuration || 3000;

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
            return false; // 撞墙消失（无效果）
        }

        // --- 检测敌人碰撞 ---
        const owner = players[this.ownerSessionId];
        const ownerTeam = owner ? owner.team : null;
        for (const [sid, player] of Object.entries(players)) {
            if (sid === this.ownerSessionId) continue;
            if (ownerTeam && player.team === ownerTeam) continue; // 忽略队友

            const distToPlayer = Math.hypot(to.x - player.x, to.y - player.y);
            if (distToPlayer < 30) {
                this._hitTarget(player, players, world);
                return false;
            }
        }

        // 更新位置
        this.data.x = newX;
        this.data.y = newY;
        this.traveledDistance += moveDistance;

        if (this.traveledDistance >= this.maxDistance) {
            return false;
        }

        return true;
    }

    /**
     * 命中目标：造成即时伤害 + 施加中毒效果
     * @private
     */
    _hitTarget(target, players, world) {
        const owner = players[this.ownerSessionId];

        // --- 即时伤害 ---
        if (this.impactDamage > 0) {
            target.takeDamage(this.impactDamage, owner);
            console.log(
                `[PoisonDart] ${target.sessionId} 受到 ${this.impactDamage} 点命中伤害`
            );
        }

        // --- 施加中毒 debuff ---
        // PoisonBuff.level 是每 tick 的伤害量，DamageBuff 每 tick 造成 level 伤害
        // 游戏 20 ticks/s，所以每秒伤害 = level * 20
        // 我们希望每秒 poisonDamage 伤害，即 level = poisonDamage / 20
        const tickDamage = Math.round(this.poisonDamage / 20);

        if (tickDamage > 0) {
            const PoisonBuffClass = getBuffClassById('poison');
            const poisonBuff = new PoisonBuffClass({
                id: 'poison',
                level: tickDamage,
                time: this.poisonDuration,
            });
            target.giveBuff(poisonBuff);

            console.log(
                `[PoisonDart] ${target.sessionId} 中毒，每 tick ${tickDamage} 伤害, ` +
                `持续 ${this.poisonDuration}ms, 总伤害约 ${this.poisonDamage * (this.poisonDuration / 1000)}`
            );
        }
    }
}

export default PoisonDartEntity;
