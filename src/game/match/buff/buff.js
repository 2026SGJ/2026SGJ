class Buff {
    /**
     * @param {Object} options
     * @param {string} options.id - buff 唯一标识符
     * @param {number} options.level - buff 等级或强度
     * @param {number} options.time - buff 持续时间（毫秒）
     * @param {Function} [options.onExpire] - buff 过期时的回调函数
     * @param {Function} [options.onApply] - buff 应用时的回调函数
     */
    constructor({ id, level, time, onExpire, onApply }) {
        this.id = id;
        this.duration = time; // Buff 持续时间，单位为毫秒
        this.level = level; // Buff 等级或强度
        this.startTime = Date.now(); // Buff 开始时间
        this.onExpire = onExpire || null; // Buff 过期时的回调函数
        this.onApply = onApply || null; // Buff 应用时的回调函数
    }

    isExpired() {
        return Date.now() - this.startTime >= this.duration;
    }

    /**
     * 每 tick 调用一次
     * 子类可以重写此方法以实现每帧效果（如持续伤害）
     * @param {import('../player/index.js').default} player - 拥有此 buff 的玩家
     */
    tick(player) {
        // 基类默认无操作，由子类重写
    }
}

export default Buff;