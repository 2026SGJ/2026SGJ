import Buff from './buff.js';

class DamageBuff extends Buff {
    constructor(data) {
        super(data);
        // this.level = data.level; // 每秒伤害点数
    }

    onTick(player) {
        // 在每个 tick 中应用伤害提升效果
        player.takeDamage(this.level);
    }
}

export default DamageBuff;