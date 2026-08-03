import Buff from './buff.js';

/**
 * StrengthBuff — 攻击力提升（buff）
 * 提升自身造成的普攻伤害，level 为提升百分比
 * 例如 level=100 表示伤害提升至 200%（即 +100%）
 */
class StrengthBuff extends Buff {
    constructor(data) {
        super(data);
        this.multiplier = 1 + data.level / 100;
    }

    tick(player) {
        // 每 tick 更新伤害倍率（多个 strength 叠加时取最高值）
        if (!player._strengthMultiplier || this.multiplier > player._strengthMultiplier) {
            player._strengthMultiplier = this.multiplier;
        }
    }

    // onExpire 在 player.processBuffs 中处理，见 Player 类
}

export default StrengthBuff;
