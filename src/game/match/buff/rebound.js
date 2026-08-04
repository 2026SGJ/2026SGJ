import Buff from './buff.js';

/**
 * ReboundBuff — 伤害反弹（buff）
 * 受到伤害时，将 level% 的伤害反弹给攻击者
 */
class ReboundBuff extends Buff {
    constructor(data) {
        super(data);
        this.reflectPercent = data.level / 100; // level=40 → 40% 反弹
    }

    tick(player) {
        // 更新反弹比例（多个 rebound 叠加时取最高值）
        if (!player._reboundPercent || this.reflectPercent > player._reboundPercent) {
            player._reboundPercent = this.reflectPercent;
        }
    }
}

export default ReboundBuff;
