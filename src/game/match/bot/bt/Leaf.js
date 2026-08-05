import { Node, BTStatus } from './Node.js';

/**
 * Condition（条件节点）
 *
 * fn(ctx) → boolean：返回 true → SUCCESS，false → FAILURE。
 * 条件必须「无副作用、无记忆」，每 tick 都可能被重新评估。
 */
export class Condition extends Node {
    /**
     * @param {string} [name]
     * @param {(ctx: Object) => boolean} fn
     */
    constructor(name = 'Condition', fn) {
        super(name);
        this.fn = fn;
    }

    tick(ctx) {
        return this.fn(ctx) ? BTStatus.SUCCESS : BTStatus.FAILURE;
    }
}

/**
 * Action（动作节点）
 *
 * fn(ctx) → BTStatus | boolean：
 *   - 返回 true / false 时自动映射为 SUCCESS / FAILURE
 *   - 返回 BTStatus.RUNNING 表示长时动作，需要后续 tick 继续推进
 * 动作可以读写 ctx（黑板）上的状态（目标记忆、dx/dy 等）。
 */
export class Action extends Node {
    /**
     * @param {string} [name]
     * @param {(ctx: Object) => string | boolean} fn
     */
    constructor(name = 'Action', fn) {
        super(name);
        this.fn = fn;
    }

    tick(ctx) {
        const result = this.fn(ctx);
        if (result === true) return BTStatus.SUCCESS;
        if (result === false) return BTStatus.FAILURE;
        return result;
    }
}
