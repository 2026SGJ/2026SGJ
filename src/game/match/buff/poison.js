import Buff from './buff.js';

/**
 * PoisonBuff — 中毒（debuff）
 * 
 * 每 tick 对目标造成 level 点伤害。
 * 与 DamageBuff 类似但使用独立的 id，方便区分和叠加。
 */
class PoisonBuff extends Buff {
    constructor(data) {
        super(data);
    }

    tick(player) {
        // 每 tick 造成持续伤害（由施加者归属，触发伤害漂浮文字）
        player.takeDamage(this.level, this.attacker);
    }
}

export default PoisonBuff;
