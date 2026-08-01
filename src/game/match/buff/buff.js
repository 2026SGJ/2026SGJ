class Buff {
    constructor({ id, level, time}) {
        this.id = id;
        this.duration = time; // Buff 持续时间，单位为毫秒
        this.level = level; // Buff 等级或强度
        this.startTime = Date.now(); // Buff 开始时间
        this.onExpire = onExpire; // Buff 过期时的回调函数
    }

    isExpired() {
        return Date.now() - this.startTime >= this.duration;
    }

    onTick(player) {
        // 这里可以添加每个 tick 的逻辑，例如减少持续时间，应用效果等
        // 例如，如果 Buff 有持续伤害效果，可以在这里处理
    }
}

export default Buff;