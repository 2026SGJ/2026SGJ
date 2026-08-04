import Buff from './buff.js';

/**
 * ShieldBuff — 护盾（buff）
 * 
 * 获得一个吸收伤害的护盾。level 为护盾吸收量。
 * 在 player.takeDamage() 中优先扣除护盾值。
 * 多个护盾叠加时，护盾值累加。
 */
class ShieldBuff extends Buff {
    constructor(data) {
        super(data);
        // level 直接作为护盾吸收量
        this.shieldAmount = data.level;
        this.applied = false;
    }

    onApply(player) {
        if (!this.applied) {
            // 累加到玩家的护盾值上（支持多个护盾叠加）
            player.shield = (player.shield || 0) + this.shieldAmount;
            this.applied = true;
            console.log(
                `[Shield] ${player.sessionId} 获得护盾 +${this.shieldAmount}, ` +
                `总护盾: ${player.shield}`
            );
        }
    }

    onExpire(player) {
        // 护盾过期时移除该部分护盾值
        if (this.applied && player.shield > 0) {
            player.shield = Math.max(0, (player.shield || 0) - this.shieldAmount);
            console.log(
                `[Shield] ${player.sessionId} 护盾过期 -${this.shieldAmount}, ` +
                `剩余护盾: ${player.shield}`
            );
        }
        this.applied = false;
    }
}

export default ShieldBuff;
