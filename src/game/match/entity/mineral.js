import Entity from './entity.js';
import MINERAL_CONFIG from '../../../assets/data/minerals/minerals.js';

/**
 * Mineral — 矿物实体
 * 
 * 地图上固定点位刷新的可采集矿物。玩家靠近后长按 E 键开采，
 * 开采完成后获得经济（this.money），矿物进入冷却等待重生。
 */
class Mineral extends Entity {
    /**
     * @param {Object} data — 来自地图配置的原始数据
     * @param {string} data.mineral — 矿物类型（'gold' | 'silver' | 'iron'）
     * @param {number} data.x, data.y — 矿物世界坐标
     * @param {number} data.width, data.height — 矿物碰撞体积尺寸
     */
    constructor(data) {
        super(data);

        /** @type {string} 矿物类型标识 */
        this.mineralType = data.mineral;

        /** @type {Object|null} 该类型矿物的配置参数 */
        this.config = MINERAL_CONFIG[this.mineralType] || null;

        /** @type {boolean} 是否已被采集（进入冷却） */
        this.collected = false;

        /** @type {number} 被采集时的时间戳（毫秒），用于重生计时 */
        this.collectedAt = 0;

        /** 碰撞体积：以 (x, y) 为中心，width×height 的矩形 */
        this.hitbox = {
            type: 'rect',
            x: this.data.x - this.data.width / 2,
            y: this.data.y - this.data.height / 2,
            width: this.data.width,
            height: this.data.height,
        };
    }

    /**
     * 判断玩家是否在矿物附近（30 像素以内）
     * 
     * 计算玩家碰撞体与矿物碰撞体之间的最短距离。
     * 
     * @param {number} playerX - 玩家中心 x 坐标
     * @param {number} playerY - 玩家中心 y 坐标
     * @param {number} playerHalfW - 玩家碰撞体半宽（默认 25）
     * @param {number} playerHalfH - 玩家碰撞体半高（默认 25）
     * @returns {boolean} 玩家是否在矿物 30px 范围内
     */
    isPlayerNear(playerX, playerY, playerHalfW = 25, playerHalfH = 25) {
        if (this.collected) return false;

        // 两个 AABB 之间的最短距离
        const dx = Math.max(
            0,
            Math.abs(playerX - this.data.x) - playerHalfW - this.data.width / 2
        );
        const dy = Math.max(
            0,
            Math.abs(playerY - this.data.y) - playerHalfH - this.data.height / 2
        );

        return Math.hypot(dx, dy) <= 30;
    }

    /**
     * 采集矿物：标记为已采集，记录时间戳，隐藏渲染
     */
    collect() {
        this.collected = true;
        this.collectedAt = Date.now();
        this.data.isShowed = false;
    }

    /**
     * 尝试重生矿物
     * 
     * 当距离采集时间超过 respawnTime 后，矿物重新可用。
     * 
     * @param {number} now - 当前时间戳（毫秒）
     * @returns {boolean} 本次调用是否触发了重生
     */
    tryRespawn(now) {
        if (!this.collected || !this.config) return false;
        if (now - this.collectedAt >= this.config.respawnTime) {
            this.collected = false;
            this.data.isShowed = true;
            return true;
        }
        return false;
    }

    /**
     * 获取矿物渲染数据（扩展基类，附带矿物类型信息）
     * @returns {Object}
     */
    getData() {
        return {
            ...this.data,
            mineralType: this.mineralType,
            collected: this.collected,
        };
    }
}

export default Mineral;
