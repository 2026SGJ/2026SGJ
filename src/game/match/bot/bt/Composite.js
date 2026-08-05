import { Composite, BTStatus } from './Node.js';

/**
 * Selector（选择/回退节点）— 无记忆
 *
 * 按顺序 tick 子节点，遇到第一个非 FAILURE 的节点即返回其结果
 * （SUCCESS 或 RUNNING）；所有子节点都 FAILURE 才返回 FAILURE。
 *
 * 无记忆：每 tick 都从第一个子节点重新评估。适合用作根节点，
 * 实现「优先级抢占」——高优先级分支的条件每帧都会被重新检查，
 * 一旦满足立即打断正在执行的低优先级分支。
 */
export class Selector extends Composite {
    tick(ctx) {
        for (const child of this.children) {
            const status = child.tick(ctx);
            if (status !== BTStatus.FAILURE) {
                return status;
            }
        }
        return BTStatus.FAILURE;
    }
}

/**
 * RandomSelector（随机选择节点）— 无记忆
 *
 * 每次 tick 随机打乱子节点顺序后再按 Selector 规则执行。
 * 用于在多个同等可行的选择中随机挑一个，制造行为多样性。
 */
export class RandomSelector extends Composite {
    tick(ctx) {
        // Fisher–Yates 洗牌
        const order = this.children.slice();
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        for (const child of order) {
            const status = child.tick(ctx);
            if (status !== BTStatus.FAILURE) {
                return status;
            }
        }
        return BTStatus.FAILURE;
    }
}

/**
 * Sequence（顺序节点）— 带记忆
 *
 * 按顺序执行子节点：全部 SUCCESS 才返回 SUCCESS；
 * 任一子节点 FAILURE 立即失败并重置到第一个子节点；
 * 任一子节点 RUNNING 时保持在该子节点，下次 tick 从同一位置继续，
 * 不会重复评估已经通过的条件（条件只在进入时检查一次）。
 */
export class Sequence extends Composite {
    /**
     * @param {string} [name]
     * @param {Node[]} [children]
     */
    constructor(name = 'Sequence', children = []) {
        super(name, children);
        /** @type {number} 当前正在执行的子节点索引 */
        this._current = 0;
    }

    tick(ctx) {
        while (this._current < this.children.length) {
            const child = this.children[this._current];
            const status = child.tick(ctx);

            if (status === BTStatus.FAILURE) {
                this._current = 0;
                return BTStatus.FAILURE;
            }
            if (status === BTStatus.RUNNING) {
                return BTStatus.RUNNING; // 下次 tick 从同一子节点继续
            }
            // SUCCESS → 推进到下一个子节点
            this._current++;
        }
        // 所有子节点完成
        this._current = 0;
        return BTStatus.SUCCESS;
    }

    reset() {
        this._current = 0;
        super.reset();
    }
}

/**
 * Parallel（并行节点）
 *
 * 每 tick 同时执行所有子节点：
 *   - successCount 个子节点 SUCCESS → 整体 SUCCESS
 *   - failCount 个子节点 FAILURE → 整体 FAILURE
 *   - 否则 → RUNNING
 *
 * 注意：不缓存子节点状态，同一子节点每帧都会被重复 tick，
 * 适合子节点为幂等动作的场景。
 */
export class Parallel extends Composite {
    /**
     * @param {string} [name]
     * @param {Node[]} [children]
     * @param {number} [successCount=1]
     * @param {number} [failCount=Infinity]
     */
    constructor(name = 'Parallel', children = [], successCount = 1, failCount = Infinity) {
        super(name, children);
        this.successCount = successCount;
        this.failCount = failCount;
    }

    tick(ctx) {
        let successes = 0;
        let failures = 0;
        for (const child of this.children) {
            const status = child.tick(ctx);
            if (status === BTStatus.SUCCESS) successes++;
            else if (status === BTStatus.FAILURE) failures++;
        }
        if (successes >= this.successCount) return BTStatus.SUCCESS;
        if (failures >= this.failCount) return BTStatus.FAILURE;
        return BTStatus.RUNNING;
    }
}
