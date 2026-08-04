import Buff from './buff.js';

/**
 * SpeedBuff — 移动速度提升（buff）
 * 
 * 修改 player.speedMultiplier 来加速移动。
 * level 为提升百分比，例如 level=60 表示速度提升至 160%（即 +60%）。
 * 多个速度 buff 叠加时取最高值。
 */
class SpeedBuff extends Buff {
    constructor(data) {
        super(data);
        // level=60 → multiplier=1.6
        this.multiplier = 1 + data.level / 100;
    }

    tick(player) {
        // 多个速度 buff 叠加时取最高的倍率
        if (!player.speedMultiplier || this.multiplier > player.speedMultiplier) {
            player.speedMultiplier = this.multiplier;
        }
    }
}

export default SpeedBuff;
