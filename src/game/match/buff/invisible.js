import Buff from './buff.js';

/**
 * InvisibleBuff — 隐形（buff）
 * 
 * 施加期间：
 *   1. 设置 player.invisible = true（客户端据此隐藏角色）
 *   2. 受到的伤害减少（damageReduction 比例）
 *   3. 无法攻击（通过 player.cantAttack 标志）
 * 
 * level 为减伤百分比，例如 level=50 表示减伤 50%
 */
class InvisibleBuff extends Buff {
    constructor(data) {
        super(data);
        // level=50 → 0.5 减伤比例
        this.dmgReduction = data.level / 100;
    }

    onApply(player) {
        player.invisible = true;
        player.cantAttack = true;
        player.damageReduction = (player.damageReduction || 0) + this.dmgReduction;
    }

    tick(player) {
        // 维持状态标志
        player.invisible = true;
        player.cantAttack = true;
    }

    onExpire(player) {
        player.invisible = false;
        player.cantAttack = false;
        player.damageReduction = Math.max(0, (player.damageReduction || 0) - this.dmgReduction);
    }
}

export default InvisibleBuff;
