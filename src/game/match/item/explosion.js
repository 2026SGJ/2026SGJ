import Vec2 from '../../../utils/vec2.js';
import { EXPLOSION_VISUAL } from '../../../assets/data/items/explosions.js';

/**
 * ExplosionSystem — 爆炸伤害与击退计算系统
 * 
 * 该模块提供统一的爆炸逻辑，被所有爆炸类道具（炸弹、火球、地雷等）复用。
 * 爆炸以点为中心，伤害和击退随距离衰减。
 * 
 * 衰减规则：
 *   - 伤害：在爆炸中心范围内按线性衰减，超出最大半径则无伤害
 *   - 击退：方向为远离爆炸中心，力度随距离衰减
 *   - 对自己免疫（若提供 owner 参数）
 * 
 * 使用方式：
 *   const system = new ExplosionSystem();
 *   system.explodeAt(x, y, config, players, owner);
 */

class ExplosionSystem {
    /**
     * @param {Object} config - 爆炸配置
     * @param {number} config.damage - 爆炸中心最大伤害值
     * @param {number} config.radius - 爆炸最大影响半径（像素），超出此范围无伤害
     * @param {number} config.knockback - 爆炸中心最大击退力度（像素/tick 单位）
     * @param {number} [config.selfDamageRatio=0] - 对自身的伤害比例（0 = 完全免疫，1 = 全额伤害）
     *   炸弹对自己免疫（0），火球/地雷对自己也会造成伤害（1 或按需调整）
     * @param {boolean} [config.hurtTeammates=false] - 是否对队友造成伤害
     */

    /**
     * 在指定位置触发爆炸，对所有在半径范围内的玩家造成伤害和击退
     * 
     * @param {Vec2|{x:number,y:number}} center - 爆炸中心世界坐标
     * @param {Object} config - 爆炸配置（见上面参数表）
     * @param {Object<string, import('../player/index.js').default>} players - 所有玩家映射 (sessionId → Player)
     * @param {string} ownerSessionId - 道具使用者的 sessionId（用于忽略自身 & 队友判断）
     */
    static applyExplosion(center, config, players, ownerSessionId) {
        const {
            damage: maxDamage = 0,        // 中心最大伤害
            radius: maxRadius = 150,      // 爆炸半径（像素）
            knockback: maxKnockback = 20, // 中心最大击退力度
            ignoreSelf = true,            // 默认炸弹对自己免疫
            ignoreTeammates = true,       // 地雷不伤及队友
        } = config;

        // 获取施法者（owner）信息，用于队友判断
        const owner = players[ownerSessionId];
        const ownerTeam = owner ? owner.team : null;

        // 遍历所有玩家，计算距离、伤害和击退
        for (const [sid, player] of Object.entries(players)) {
            // ----- 伤害豁免判断 -----
            if (ignoreSelf && sid === ownerSessionId) continue;     // 自己免疫
            if (ignoreTeammates && ownerTeam && player.team === ownerTeam) continue; // 队友免疫

            // ----- 计算到爆炸中心的距离 -----
            const dx = player.x - center.x;
            const dy = player.y - center.y;
            const dist = Math.hypot(dx, dy);

            // 超出爆炸半径，无影响
            if (dist > maxRadius || dist <= 0) continue;

            // ----- 线性衰减因子（距离越远伤害/击退越小） -----
            // t = 0（中心）→ 1.0（满伤害），t = 1（半径边缘）→ 0.0（无伤害）
            const t = 1 - (dist / maxRadius);

            // 最终伤害：最大伤害 × 衰减因子
            const finalDamage = Math.round(maxDamage * t);
            if (finalDamage > 0) {
                player.takeDamage(finalDamage, owner);
            }

            // 最终击退：最大击退 × 衰减因子
            const finalKnockback = maxKnockback * t;
            if (finalKnockback > 0) {
                // 击退方向：从爆炸中心向外推
                const dir = new Vec2(dx, dy).normalize();
                player.takeKnockback(dir.scale(finalKnockback));
            }

            // 调试日志
            if (finalDamage > 0) {
                console.log(
                    `[Explosion] ${sid} hit: damage=${finalDamage}, ` +
                    `dist=${dist.toFixed(0)}px, attenuation=${t.toFixed(2)}`
                );
            }
        }
    }

    /**
     * 检查点是否被墙壁阻挡（用于火球/地雷的直线路径检测）
     * 
     * 用 Bresenham 式简化 AABB 交叉检测：从起点到终点采样若干点，
     * 判断路径上是否存在墙壁。
     * 
     * @param {{x:number,y:number}} from - 起始坐标
     * @param {{x:number,y:number}} to - 终点坐标
     * @param {import('../entity/wall.js').default[]} walls - 墙体列表
     * @returns {boolean} true 表示路径被阻挡
     */
    static isBlockedByWall(from, to, walls) {
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        if (dist <= 0) return false;

        const steps = Math.ceil(dist / 25); // 每 25 像素采样一次（墙壁通常 50px 宽）
        for (let i = 0; i <= steps; i++) {
            const t = dist > 0 ? i / steps : 0;
            const sx = from.x + (to.x - from.x) * t;
            const sy = from.y + (to.y - from.y) * t;

            // 对每面墙壁做点 → AABB 碰撞检测
            for (const wall of walls) {
                if (!wall.hitbox) continue;
                const w = wall.hitbox;
                if (
                    sx >= w.x &&
                    sx <= w.x + w.width &&
                    sy >= w.y &&
                    sy <= w.y + w.height
                ) {
                    return true; // 命中墙壁
                }
            }
        }

        return false;
    }
}

export default ExplosionSystem;