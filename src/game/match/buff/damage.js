import Buff from './buff.js';

/**
 * DamageBuff — 持续伤害（debuff）
 * 每 tick 对拥有者造成 level 点伤害
 */
class DamageBuff extends Buff {
    constructor(data) {
        super(data);
    }

    tick(player) {
        // 每 tick 对目标玩家造成持续伤害
        player.takeDamage(this.level);
    }
}

export default DamageBuff;