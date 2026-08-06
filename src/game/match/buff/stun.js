import Buff from './buff.js';

/**
 * StunBuff — 眩晕（debuff）
 * 
 * 施加期间目标无法移动也无法攻击。
 * 通过设置 player.stunned 标志来实现，在 player.processKeyholding() 中检查。
 */
class StunBuff extends Buff {
    constructor(data) {
        super(data);
    }

    onApply(player) {
        // 设置眩晕标志，阻止一切行动
        player.stunned = true;
    }

    tick(player) {
        // 每 tick 维持眩晕标志并清零速度
        player.stunned = true;
        player.speed.set(0, 0);
    }

    onExpire(player) {
        // 解除眩晕（仅在无其他眩晕 buff 时）
        // 注意：多个眩晕 buff 叠加时，最后一个过期才会清除标志
        // 这里简化处理：processBuffs 中每个 tick 都会重新计算，过期后自然不再设置
    }
}

export default StunBuff;
