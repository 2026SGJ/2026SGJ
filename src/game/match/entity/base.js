import Entity from './entity.js';

/**
 * Base — 基地实体
 *
 * 每支队伍拥有一个基地（血量固定为 4000），位于各自出生点：
 *   - A 队基地：地图底部 (1280, 6840)
 *   - B 队基地：地图顶部 (1280, 360)
 *
 * 基地本身为「被动」实体，不主动攻击：
 *   1. 血量由 MatchManager 每 tick 结算 —— 判定圈内的敌方存活玩家
 *      按人数持续对其造成伤害（见 match/manager.js 的 BASE_DAMAGE_* 常量）。
 *   2. 血量 ≤ 0 时该队玩家无法复活（由 MatchManager 更新玩家的 canRevive）。
 *
 * 数据经 getData() 随渲染管线同步给客户端（可绘制基地血条）。
 */

/** 基地固定血量 */
export const BASE_MAX_HP = 4000;

class Base extends Entity {
    /**
     * @param {Object} data — 地图实体数据
     * @param {string} data.team — 归属队伍 'A' | 'B'
     * @param {number} data.x / data.y — 基地世界坐标
     */
    constructor(data) {
        super(data);

        /** @type {'A'|'B'} 基地所属队伍 */
        this.team = data.team || 'A';

        /** @type {number} 当前血量（固定上限 BASE_MAX_HP） */
        this.hp = BASE_MAX_HP;
        /** @type {number} 血量上限 */
        this.maxHp = BASE_MAX_HP;

        // 非阻挡实体：不参与墙体碰撞，仅用于渲染与接近判定
        this.hitbox = {
            type: 'rect',
            x: this.data.x - (this.data.width || 180) / 2,
            y: this.data.y - (this.data.height || 180) / 2,
            width: this.data.width || 180,
            height: this.data.height || 180,
        };
    }

    /**
     * 覆盖基类 getData，附加基地实时状态供客户端渲染（血条等）
     * @returns {Object}
     */
    getData() {
        return {
            ...this.data,
            state: {
                team: this.team,
                hp: Math.max(0, Math.round(this.hp)),
                maxHp: this.maxHp,
                destroyed: this.hp <= 0,
            },
        };
    }
}

export default Base;
