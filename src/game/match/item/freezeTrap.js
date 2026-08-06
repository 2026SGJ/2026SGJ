import Entity from '../entity/entity.js';
import getBuffClassById from '../buff/index.js';

/**
 * FreezeTrapEntity — 冰冻陷阱实体
 * 
 * 放置在地面的陷阱，敌人踩中后触发，对其施加冻结效果（stun debuff）。
 * 队友和自己免疫。
 */
class FreezeTrapEntity extends Entity {
    /**
     * @param {number} x - 放置 X 坐标
     * @param {number} y - 放置 Y 坐标
     * @param {Object} config - 冰冻陷阱配置（来自 ITEM_CONFIG.freezeTrap.data）
     * @param {string} ownerSessionId - 放置者 sessionId
     * @param {string} ownerTeam - 放置者队伍
     */
    constructor(x, y, config, ownerSessionId, ownerTeam) {
        const uniqueId = `freezeTrap_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        super({
            id: uniqueId,
            type: 'freezeTrap',
            x: x,
            y: y,
            asset: 'freezeTrap',         // 客户端冰冻陷阱精灵
            dir: 0,
            isShowed: true,
            effects: {
                color: 0x44ccff,         // 冰蓝色标记
                scale: 45,
                ghost: 0,
            },
            width: 26,
            height: 26,
            z_index: 50,
        });

        /** @type {number} 触发距离（像素） */
        this.triggerDistance = config.triggerDistance || 45;

        /** @type {number} 冻结持续时间（毫秒） */
        this.freezeDuration = config.freezeDuration || 2500;

        /** @type {boolean} 是否已触发 */
        this.triggered = false;

        /** @type {string} */
        this.ownerSessionId = ownerSessionId;

        /** @type {string} */
        this.ownerTeam = ownerTeam;
    }

    /**
     * 每 tick 调用：检测敌人接近 → 触发冻结
     * @param {Object<string, import('../player/index.js').default>} players
     * @param {import('../world.js').default} world
     * @returns {boolean}
     */
    tick(players, world) {
        if (this.triggered) return false;

        for (const [sid, player] of Object.entries(players)) {
            // 略过自己和队友
            if (sid === this.ownerSessionId) continue;
            if (player.team === this.ownerTeam) continue;

            const dist = Math.hypot(player.x - this.data.x, player.y - this.data.y);
            if (dist <= this.triggerDistance) {
                this.triggered = true;

                // 施加眩晕/冻结效果
                const StunBuffClass = getBuffClassById('stun');
                const freezeBuff = new StunBuffClass({
                    id: 'stun',
                    level: 0,
                    time: this.freezeDuration,
                });
                player.giveBuff(freezeBuff);

                console.log(
                    `[FreezeTrap] ${sid} 踩中冰冻陷阱，冻结 ${this.freezeDuration}ms`
                );

                return false; // 陷阱触发后消失
            }
        }

        return true;
    }
}

export default FreezeTrapEntity;
