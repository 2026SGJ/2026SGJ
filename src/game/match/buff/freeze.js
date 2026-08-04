import Buff from './buff.js';

/**
 * FreezeBuff — 冻结/硬直（debuff）
 * 施加期间目标无法移动
 */
class FreezeBuff extends Buff {
    constructor(data) {
        super(data);
    }

    tick(player) {
        // 每 tick 强制将速度归零，阻止移动
        player.speed.set(0, 0);
    }
}

export default FreezeBuff;
