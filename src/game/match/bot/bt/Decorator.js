import { Decorator, BTStatus } from './Node.js';

/**
 * Inverter（取反节点）
 * 将子节点结果取反：SUCCESS ↔ FAILURE，RUNNING 保持不变。
 */
export class Inverter extends Decorator {
    tick(ctx) {
        const status = this.child.tick(ctx);
        if (status === BTStatus.SUCCESS) return BTStatus.FAILURE;
        if (status === BTStatus.FAILURE) return BTStatus.SUCCESS;
        return status;
    }
}

/**
 * Succeeder（强制成功节点）
 * 无论子节点结果如何，总是返回 SUCCESS（常用于把「可能失败的子树」变为可选步骤）。
 */
export class Succeeder extends Decorator {
    tick(ctx) {
        this.child.tick(ctx);
        return BTStatus.SUCCESS;
    }
}

/**
 * Repeater（重复执行节点）
 * 反复执行子节点：
 *   - times = -1（默认）：无限重复（子节点 RUNNING 时整体 RUNNING）
 *   - times > 0：子节点完成 times 次后返回 SUCCESS
 */
export class Repeater extends Decorator {
    /**
     * @param {string} [name]
     * @param {Node} child
     * @param {number} [times=-1]
     */
    constructor(name = 'Repeater', child, times = -1) {
        super(name, child);
        this.times = times;
        this._count = 0;
    }

    tick(ctx) {
        const status = this.child.tick(ctx);
        if (status === BTStatus.RUNNING) return BTStatus.RUNNING;
        if (this.times < 0) return BTStatus.RUNNING; // 无限重复

        this._count++;
        if (this._count >= this.times) {
            this._count = 0;
            return BTStatus.SUCCESS;
        }
        return BTStatus.RUNNING;
    }

    reset() {
        this._count = 0;
        super.reset();
    }
}

/**
 * RepeatUntilSuccess（直到成功节点）
 * 子节点 FAILURE 或 RUNNING → 整体 RUNNING（继续执行）；
 * 子节点 SUCCESS → 整体 SUCCESS。
 */
export class RepeatUntilSuccess extends Decorator {
    tick(ctx) {
        return this.child.tick(ctx) === BTStatus.SUCCESS
            ? BTStatus.SUCCESS
            : BTStatus.RUNNING;
    }
}

/**
 * RepeatUntilFailure（直到失败节点）
 * 子节点 SUCCESS 或 RUNNING → 整体 RUNNING（继续执行）；
 * 子节点 FAILURE → 整体 SUCCESS。
 */
export class RepeatUntilFailure extends Decorator {
    tick(ctx) {
        return this.child.tick(ctx) === BTStatus.FAILURE
            ? BTStatus.SUCCESS
            : BTStatus.RUNNING;
    }
}

/**
 * Cooldown（冷却节点）
 * 子节点完成（返回 SUCCESS/FAILURE）后进入 cooldownMs 冷却，
 * 冷却期间直接返回 FAILURE，冷却结束后重新执行子节点。
 */
export class Cooldown extends Decorator {
    /**
     * @param {string} [name]
     * @param {Node} child
     * @param {number} cooldownMs
     */
    constructor(name = 'Cooldown', child, cooldownMs) {
        super(name, child);
        this.cooldownMs = cooldownMs;
        this._nextAllowedAt = 0;
    }

    tick(ctx) {
        const now = Date.now();
        if (now < this._nextAllowedAt) return BTStatus.FAILURE;

        const status = this.child.tick(ctx);
        if (status !== BTStatus.RUNNING) {
            this._nextAllowedAt = now + this.cooldownMs;
        }
        return status;
    }

    reset() {
        this._nextAllowedAt = 0;
        super.reset();
    }
}

/**
 * RandomChance（概率门节点）
 * 以 probability 概率放行子节点：
 *   - 未放行 → FAILURE（本次不执行）
 *   - 放行后子节点 RUNNING 期间持续放行，完成后重新掷骰。
 * 用于「偶尔做某事」的行为（例如偶尔逛一次商店）。
 */
export class RandomChance extends Decorator {
    /**
     * @param {string} [name]
     * @param {Node} child
     * @param {number} [probability=0.5]
     */
    constructor(name = 'RandomChance', child, probability = 0.5) {
        super(name, child);
        this.probability = probability;
        this._active = false;
    }

    tick(ctx) {
        if (!this._active) {
            if (Math.random() >= this.probability) return BTStatus.FAILURE;
            this._active = true;
        }
        const status = this.child.tick(ctx);
        if (status !== BTStatus.RUNNING) {
            this._active = false; // 完成或失败，下次重新掷骰
        }
        return status;
    }

    reset() {
        this._active = false;
        super.reset();
    }
}
