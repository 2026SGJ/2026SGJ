/**
 * 行为树库（Behavior Tree Library）
 *
 * 通用行为树实现，节点返回 BTStatus（success/failure/running）。
 *
 * 控制节点：
 *   - Selector      选择/回退（无记忆，适合根节点优先级抢占）
 *   - RandomSelector随机选择（随机打乱顺序）
 *   - Sequence      顺序执行（带记忆，长时动作不会被已通过的条件打断）
 *   - Parallel      并行执行
 * 装饰节点：
 *   - Inverter / Succeeder / Repeater / RepeatUntilSuccess / RepeatUntilFailure
 *   - Cooldown / RandomChance
 * 叶子节点：
 *   - Condition     条件（fn(ctx) → boolean）
 *   - Action        动作（fn(ctx) → BTStatus | boolean）
 *
 * 用法示例：
 *   import { Selector, Sequence, Condition, Action, BTStatus } from './index.js';
 *
 *   const tree = new Selector('root', [
 *       new Sequence('吃饭', [
 *           new Condition('饿了', (ctx) => ctx.hungry),
 *           new Action('吃饭', (ctx) => { ctx.eat(); return BTStatus.RUNNING; }),
 *       ]),
 *       new Action('发呆', () => BTStatus.RUNNING),
 *   ]);
 *   tree.tick(blackboard);
 */

export { BTStatus, Node, Composite, Decorator } from './Node.js';
export { Selector, RandomSelector, Sequence, Parallel } from './Composite.js';
export {
    Inverter,
    Succeeder,
    Repeater,
    RepeatUntilSuccess,
    RepeatUntilFailure,
    Cooldown,
    RandomChance,
} from './Decorator.js';
export { Condition, Action } from './Leaf.js';
