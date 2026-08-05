/**
 * 行为树核心节点（Behavior Tree Core）
 *
 * 节点每次 tick 返回三种状态之一：
 *   SUCCESS — 本帧执行成功
 *   FAILURE — 本帧执行失败（父节点据此回退/切换分支）
 *   RUNNING — 需要后续 tick 继续推进（长时动作：移动/采矿/追击…）
 *
 * 行为树由以下节点组合而成：
 *   - 叶子节点：Condition（条件）、Action（动作）
 *   - 控制节点：Selector（选择/回退）、Sequence（顺序）、Parallel（并行）
 *   - 装饰节点：Inverter / Succeeder / Repeater / Cooldown / RandomChance …
 */

/** 节点执行状态 */
export const BTStatus = Object.freeze({
    SUCCESS: 'success',
    FAILURE: 'failure',
    RUNNING: 'running',
});

/**
 * 节点基类
 */
export class Node {
    /**
     * @param {string} [name] - 节点名称（用于日志/调试）
     */
    constructor(name = 'Node') {
        this.name = name;
    }

    /**
     * 每 tick 由父节点调用
     * @param {Object} ctx - 黑板/上下文（通常为 BotController 实例）
     * @returns {string} BTStatus
     */
    tick(ctx) {
        return BTStatus.SUCCESS;
    }

    /** 重置节点内部记忆（Sequence 的子节点索引、装饰器的计数等） */
    reset() {}

    toString() {
        return this.name;
    }
}

/**
 * 复合节点基类（拥有多个子节点）
 */
export class Composite extends Node {
    /**
     * @param {string} [name]
     * @param {Node[]} [children]
     */
    constructor(name = 'Composite', children = []) {
        super(name);
        this.children = children;
    }

    /** 追加子节点（支持链式调用） */
    addChild(child) {
        this.children.push(child);
        return this;
    }
}

/**
 * 装饰节点基类（包裹单个子节点）
 */
export class Decorator extends Node {
    /**
     * @param {string} [name]
     * @param {Node} child
     */
    constructor(name = 'Decorator', child) {
        super(name);
        this.child = child;
    }
}
