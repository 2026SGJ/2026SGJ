/**
 * BotController — 人机行为控制器（行为树 Behavior Tree + 可选 LLM）
 *
 * 以行为树替代旧的 FSM 状态机。每 tick 从根节点按优先级重新评估，
 * 高优先级分支可以随时抢占（打断）低优先级分支，无需显式状态转移。
 *
 *   Root Selector（无记忆，优先级从上到下）
 *   ├── [0] LLM 高层决策（可选：有缓存决策时应用一次，注入目标记忆）
 *   ├── [1] 防御/逃跑    — 血量过低，或敌人贴近且未交战（治疗 → 逃跑）
 *   ├── [2] 战斗          — 敌人在探测范围内（追击 → 近身战斗）
 *   ├── [3] 购物          — 有钱且商店在附近（前往商店 → 购买道具）
 *   ├── [4] 占领前哨站    — 附近有可占领的前哨站
 *   ├── [5] 采矿          — 附近有未采集的矿物
 *   └── [6] 游荡          — 兜底（无目标时随机走动）
 *
 * 相比 FSM 的改进：
 *   - 反应式：每 tick 重估优先级，敌人出现/血量变化立即响应
 *   - 可扩展：新增行为只需往根节点插入一个分支（Sequence/Condition/Action）
 *   - 带记忆：Sequence 记录当前子节点，长时动作（采矿/购物/追击）
 *     不会被重复评估的进入条件打断；被打断后可无缝恢复
 *   - LLM 可选介入：决策以「一次性覆盖」注入树根，由行为树负责执行
 */

import { isLLMEnabled, queryLLM, getLLMConfig } from './llmDecision.js';
import Shop from '../item/shop.js';
import {
    BTStatus,
    Selector,
    Sequence,
    Condition,
    Action,
} from './bt/index.js';

// ==================== 行为标识（兼容旧 BotState 枚举） ====================

/**
 * @deprecated 旧 FSM 状态枚举。行为树已替代状态机，
 * 保留该导出仅为兼容外部引用，取值对应行为树中各动作名。
 */
export const BotState = Object.freeze({
    IDLE:              'idle',
    MOVING_TO_MINERAL: 'moving_to_mineral',
    MINING:            'mining',
    MOVING_TO_SHOP:    'moving_to_shop',
    SHOPPING:          'shopping',
    CHASING:           'chasing',
    FIGHTING:          'fighting',
    FLEEING:           'fleeing',
    MOVING_TO_OUTPOST: 'moving_to_outpost',
    CAPTURING:         'capturing',
});

// ==================== 常量 ====================

/** 敌人探测距离（像素） */
const ENEMY_DETECT_RANGE = 250;
/** 近战攻击距离（像素） */
const MELEE_RANGE = 65;
/** 逃跑安全距离（像素） */
const FLEE_SAFE_DIST = 300;
/** 低血量阈值（比例） */
const LOW_HP_RATIO = 0.35;
/** 血量健康阈值（足以战斗） */
const HEALTHY_HP_RATIO = 0.60;
/** 有钱去商店的阈值 */
const SHOP_MONEY_THRESHOLD = 50;
/** 购物中钱低于此值 → 离开商店 */
const SHOP_MIN_MONEY = 15;
/** 商店交互距离（像素） */
const SHOP_INTERACT_RANGE = 65;
/** 发起购物计划的距离（像素） */
const SHOP_PLAN_RANGE = 200;
/** 前哨站交互距离（像素） */
const CAPTURE_INTERACT_RANGE = 105;
/** 发起占领计划的距离（像素） */
const CAPTURE_PLAN_RANGE = 250;
/** 采矿交互距离（像素） */
const MINING_RANGE = 35;
/** 设置重生点的距离（像素） */
const SPAWN_SET_RANGE = 25;
/** 目标被打断后离所有目标过远 → 放弃该计划（像素） */
const GOAL_ABANDON_RANGE = 400;
/** 到达目标点的距离容差（像素） */
const ARRIVE_TOLERANCE = 10;
/** 决策评估间隔（tick 数，LLM 请求节流） */
const DECISION_TICK_INTERVAL = 10;
/** 战斗中重新评估间隔（tick 数） */
const COMBAT_TICK_INTERVAL = 5;
/** 随机扰动幅度（避免 bot 行为过于机械） */
const WANDER_JITTER = 0.15;

// ==================== 工具函数 ====================

function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

// ==================== BotController 类 ====================

export default class BotController {

    /**
     * @param {Object} options
     * @param {string} options.team - bot 所属队伍 'A' | 'B'
     */
    constructor({ team }) {
        this.team = team;

        // ---------- 行为树黑板：目标记忆 ----------
        /** @type {import('../player/index.js').default | null} 当前战斗目标 */
        this.combatTarget = null;
        /** @type {import('../entity/mineral.js').default | null} 当前矿物目标 */
        this.mineralTarget = null;
        /** @type {import('../entity/shop.js').default | null} 当前商店目标 */
        this.shopTargetObj = null;
        /** @type {import('../entity/outpost.js').default | null} 当前前哨站目标 */
        this.outpostTarget = null;

        // ---------- 行为树黑板：分支激活状态 ----------
        /** @type {boolean} 逃跑进行中（保持逃跑直到安全） */
        this.fleeActive = false;
        /** @type {boolean} 购物进行中 */
        this.shoppingActive = false;
        /** @type {boolean} 占领进行中 */
        this.capturingActive = false;
        /** @type {boolean | null} 已决定的购物计划（null = 未决定） */
        this._shopDecision = null;
        /** @type {boolean | null} 已决定的占领计划（null = 未决定） */
        this._captureDecision = null;
        /** @type {boolean} LLM 请求逃跑（一次性标志） */
        this.llmFleeRequested = false;

        // ---------- 计时 / 计数 ----------
        /** @type {number} tick 计数器 */
        this.tickCount = 0;
        /** @type {number} 商店停留计时 */
        this.shopStayTimer = 0;
        /** @type {number} 随机游走偏航角 */
        this.wanderAngle = Math.random() * Math.PI * 2;

        // ---------- 行为记录（日志 / LLM 上下文） ----------
        /** @type {string} 当前动作名（对应 BotState 取值） */
        this.currentAction = BotState.IDLE;
        /** @type {string} 上一个动作名 */
        this.prevAction = null;
        /** @type {import('../player/index.js').default | null} 本次 tick 的 bot 自身 */
        this.self = null;
        /** @type {Object | null} 本次 tick 的感知数据 */
        this.perception = null;

        // ---------- LLM 集成 ----------
        /** @type {Object | null} 缓存的 LLM 决策 */
        this.llmCachedDecision = null;
        /** @type {boolean} 是否正在等待 LLM 响应 */
        this.llmPending = false;
        /** @type {number} 上次 LLM 调用时间 */
        this.lastLlmCallTime = 0;

        // ---------- 构建行为树 ----------
        this.tree = this._buildTree();
    }

    // ==================== 主更新入口 ====================

    /**
     * 每 tick 调用，由 BotPlayer.tick() 驱动
     *
     * @param {Object<string, import('../player/index.js').default>} players - 所有玩家
     * @param {import('../../world.js').default} world - 世界实例
     * @param {import('../player/index.js').default} self - bot 自身的 Player 实例
     */
    update(players, world, self) {
        this.tickCount++;
        this.self = self;

        // ---- 已死亡且无法复活：保持静止 ----
        if (self.dead) {
            self.dx = 0;
            self.dy = 0;
            self.attacking = false;
            self.mining = false;
            self.usingSkill = false;
            return;
        }

        // ---- 眩晕时无法行动 ----
        if (self.stunned) {
            self.dx = 0;
            self.dy = 0;
            return;
        }

        // ---- 匹配阶段：与真人同权，仅可移动（游荡），禁止攻击/采矿/购物 ----
        // canAct 由 MatchManager 在阶段切换时统一设置
        if (!self.canAct) {
            this._resetGoals(self);
            this._actWander();
            return;
        }

        // ---- 收集感知数据（每 tick） ----
        this.perception = this._perceive(players, world, self);

        // ---- 行为树决策 + 执行 ----
        this.tree.tick(this);

        // ---- 非战斗/非逃跑状态下周期性请求 LLM 高层决策（异步，结果缓存） ----
        if (!this.combatTarget && !this.fleeActive &&
            this.tickCount % DECISION_TICK_INTERVAL === 0) {
            this._tryRequestLLM();
        }
    }

    // ==================== 行为树构建 ====================

    /**
     * 构建根行为树
     * 根 Selector 无记忆 → 每 tick 按优先级重估，高优先级分支可抢占低优先级分支。
     */
    _buildTree() {
        return new Selector('bot 根节点（防御 > 战斗 > 商店 > 前哨站 > 采矿 > 游荡）', [
            this._buildLlmBranch(),      // [0] LLM 高层决策（可选）
            this._buildDefenseBranch(),  // [1] 防御/逃跑
            this._buildFightBranch(),    // [2] 战斗
            this._buildShopBranch(),     // [3] 购物
            this._buildCaptureBranch(),  // [4] 占领前哨站
            this._buildMineBranch(),     // [5] 采矿
            new Action('wander（兜底游荡）', () => this._actWander()),
        ]);
    }

    /** [0] LLM 高层决策：有缓存决策时应用一次（一次性覆盖，交给下方行为树执行） */
    _buildLlmBranch() {
        return new Sequence('LLM 高层决策', [
            new Condition('有缓存决策', () => !!this.llmCachedDecision),
            new Action('应用 LLM 决策', () => this._actApplyLlmDecision()),
        ]);
    }

    /** [1] 防御/逃跑：血量过低或敌人贴近且未交战 → 治疗或逃跑 */
    _buildDefenseBranch() {
        return new Sequence('防御/逃跑', [
            new Condition('需要防御', () => this._condNeedFlee()),
            new Selector('防御执行', [
                new Sequence('优先治疗', [
                    new Condition('有可用治疗道具', () =>
                        this._hasHealingItem(this.self) && this._canUseHealingItem(this.self)),
                    new Action('使用治疗道具', () => {
                        this._useHealingItem(this.self);
                        return BTStatus.SUCCESS;
                    }),
                ]),
                new Action('逃跑', () => this._actFlee()),
            ]),
        ]);
    }

    /** [2] 战斗：敌人在探测范围内 → 近身战斗或追击 */
    _buildFightBranch() {
        return new Sequence('战斗', [
            new Condition('想战斗', () => this._condEngage()),
            new Selector('战斗执行', [
                new Sequence('近身战斗', [
                    new Condition('进入近战距离', () => this._condInMelee()),
                    new Action('战斗', () => this._actFight()),
                ]),
                new Action('追击', () => this._actChase()),
            ]),
        ]);
    }

    /** [3] 购物：有钱且商店在附近 → 前往商店并购买 */
    _buildShopBranch() {
        return new Sequence('购物', [
            new Condition('想购物', () => this._condWantShop()),
            new Selector('购物执行', [
                new Sequence('在商店购买', [
                    new Condition('到达商店', () => this._condAtShop()),
                    new Action('购买道具', () => this._actShopping()),
                ]),
                new Action('前往商店', () => this._actMoveToShop()),
            ]),
        ]);
    }

    /** [4] 占领前哨站：附近有可占领的前哨站 */
    _buildCaptureBranch() {
        return new Sequence('占领前哨站', [
            new Condition('想占领', () => this._condWantCapture()),
            new Selector('占领执行', [
                new Sequence('占领中', [
                    new Condition('到达前哨站', () => this._condAtOutpost()),
                    new Action('占领', () => this._actCapturing()),
                ]),
                new Action('前往前哨站', () => this._actMoveToOutpost()),
            ]),
        ]);
    }

    /** [5] 采矿：附近有未采集的矿物 */
    _buildMineBranch() {
        return new Sequence('采矿', [
            new Condition('有矿物', () => this._condMineAvail()),
            new Selector('采矿执行', [
                new Sequence('开采中', [
                    new Condition('到达矿物', () => this._condAtMineral()),
                    new Action('开采', () => this._actMine()),
                ]),
                new Action('前往矿物', () => this._actMoveToMineral()),
            ]),
        ]);
    }

    // ==================== 条件节点 ====================

    /**
     * 需要防御：
     *   - LLM 请求逃跑（一次性）
     *   - 逃跑进行中（保持逃跑直到安全）
     *   - 敌人贴近 &&（血量极低 || 未交战且血量不健康）
     */
    _condNeedFlee() {
        if (this.llmFleeRequested) {
            this.llmFleeRequested = false;
            return true;
        }
        if (this.fleeActive) return true;

        const p = this.perception;
        if (!p.nearestEnemy) return false;
        if (p.hpRatio < LOW_HP_RATIO) return true;
        return p.hpRatio < HEALTHY_HP_RATIO && !this.combatTarget;
    }

    /**
     * 想战斗：
     *   - 已锁定战斗目标 → 继续（血量不健康也继续，直到防御分支接管）
     *   - 否则要求：敌人在探测范围内 && 血量健康
     */
    _condEngage() {
        const p = this.perception;
        if (!p.nearestEnemy) return false;
        if (this.combatTarget && this.combatTarget.health > 0) return true;
        return p.nearestEnemy.dist < ENEMY_DETECT_RANGE && p.hpRatio >= HEALTHY_HP_RATIO;
    }

    /** 已进入近战距离 */
    _condInMelee() {
        const p = this.perception;
        const target = this.combatTarget || p.nearestEnemy?.player;
        if (!target || target.health <= 0) return false;
        return dist(this.self, target) <= MELEE_RANGE;
    }

    /**
     * 想购物：
     *   - 购物进行中/已决定计划 → 保持（但离商店过远则放弃）
     *   - 否则：无其他既定目标 && 钱足够 && 商店在计划范围内（30% 概率发起）
     */
    _condWantShop() {
        const p = this.perception;
        if (!p.nearestShop || p.money < SHOP_MIN_MONEY) {
            this._shopDecision = null;
            this.shoppingActive = false;
            this.shopTargetObj = null;
            return false;
        }
        if (this.shoppingActive) {
            if (p.nearestShop.dist > GOAL_ABANDON_RANGE) {
                this.shoppingActive = false;
                this._shopDecision = null;
                this.shopTargetObj = null;
                return false;
            }
            return true;
        }
        if (this._shopDecision) {
            if (p.nearestShop.dist > GOAL_ABANDON_RANGE) {
                this._shopDecision = null;
                this.shopTargetObj = null;
                return false;
            }
            return true;
        }
        // 只有空闲（无其他既定目标）时才考虑发起新的购物计划
        if (this._isBusyWithOtherGoal()) return false;

        const decided = p.money >= SHOP_MONEY_THRESHOLD &&
            p.nearestShop.dist < SHOP_PLAN_RANGE &&
            Math.random() < 0.3;
        if (decided) {
            this._shopDecision = true;
            this.shopTargetObj = p.nearestShop.ref;
        }
        return decided;
    }

    /** 已到达商店（以目标记忆优先） */
    _condAtShop() {
        const p = this.perception;
        const shop = this.shopTargetObj || p.nearestShop?.ref;
        if (!shop) return false;
        return Math.hypot(this.self.x - shop.data.x, this.self.y - shop.data.y) <= SHOP_INTERACT_RANGE;
    }

    /**
     * 想占领前哨站：
     *   - 己方刚占领的目标 → 继续收尾（靠近设置重生点）
     *   - 占领中/已决定计划 → 保持（过远则放弃）
     *   - 否则：无其他既定目标 && 可占领前哨站在计划范围内（25% 概率发起）
     */
    _condWantCapture() {
        const p = this.perception;

        // 收尾：己方刚占领的目标，允许继续靠近设置重生点
        const finishing = this.outpostTarget &&
            this.outpostTarget.state.owner === this.self.team;
        if (finishing) return true;

        if (!p.nearestOutpost || !p.nearestOutpost.capturable) {
            this._captureDecision = null;
            this.capturingActive = false;
            this.outpostTarget = null;
            return false;
        }
        if (this.capturingActive) {
            if (p.nearestOutpost.dist > GOAL_ABANDON_RANGE) {
                this.capturingActive = false;
                this._captureDecision = null;
                this.outpostTarget = null;
                return false;
            }
            return true;
        }
        if (this._captureDecision) {
            if (p.nearestOutpost.dist > GOAL_ABANDON_RANGE) {
                this._captureDecision = null;
                this.outpostTarget = null;
                return false;
            }
            return true;
        }
        // 只有空闲（无其他既定目标）时才考虑发起新的占领计划
        if (this._isBusyWithOtherGoal()) return false;

        const decided = p.nearestOutpost.dist < CAPTURE_PLAN_RANGE &&
            Math.random() < 0.25;
        if (decided) {
            this._captureDecision = true;
            this.outpostTarget = p.nearestOutpost.ref;
        }
        return decided;
    }

    /** 已到达前哨站（以目标记忆优先） */
    _condAtOutpost() {
        const p = this.perception;
        const outpost = this.outpostTarget || p.nearestOutpost?.ref;
        if (!outpost) return false;
        return Math.hypot(this.self.x - outpost.data.x, this.self.y - outpost.data.y) <= CAPTURE_INTERACT_RANGE;
    }

    /** 有可采矿物（目标记忆有效或附近存在矿物） */
    _condMineAvail() {
        const p = this.perception;
        if (this.mineralTarget && !this.mineralTarget.collected) return true;
        return !!p.nearestMineral;
    }

    /** 已到达矿物（以目标记忆优先） */
    _condAtMineral() {
        const p = this.perception;
        if (this.mineralTarget && !this.mineralTarget.collected) {
            return Math.hypot(
                this.self.x - this.mineralTarget.data.x,
                this.self.y - this.mineralTarget.data.y
            ) <= MINING_RANGE;
        }
        return !!p.nearestMineral && p.nearestMineral.dist <= MINING_RANGE;
    }

    // ==================== 动作节点 ====================

    /** 应用 LLM 决策（一次性）：把高层意图注入行为树黑板，由下方分支执行 */
    _actApplyLlmDecision() {
        const decision = this.llmCachedDecision;
        this.llmCachedDecision = null;
        const action = decision?.action || null;
        const p = this.perception;

        switch (action) {
            case 'mine':
                if (p.nearestMineral) this.mineralTarget = p.nearestMineral.ref;
                break;
            case 'attack':
                if (!this.combatTarget && p.nearestEnemy) {
                    this.combatTarget = p.nearestEnemy.player;
                }
                break;
            case 'shop':
                if (p.nearestShop) {
                    this._shopDecision = true;
                    this.shopTargetObj = p.nearestShop.ref;
                }
                break;
            case 'capture':
                if (p.nearestOutpost) {
                    this._captureDecision = true;
                    this.outpostTarget = p.nearestOutpost.ref;
                }
                break;
            case 'flee':
                this.llmFleeRequested = true;
                break;
            case 'use_item':
                this._useHealingItem(this.self);
                break;
            default:
                // idle：什么都不做，交给行为树自行决定
                break;
        }
        return BTStatus.SUCCESS;
    }

    /** 逃跑：远离敌人 + 朝基地方向，安全后结束 */
    _actFlee() {
        const self = this.self;
        const p = this.perception;
        this._setAction(BotState.FLEEING);

        this.fleeActive = true;
        this._clearActivities(self);
        this.combatTarget = null;

        const noEnemyNear = !p.nearestEnemy || p.nearestEnemy.dist > FLEE_SAFE_DIST;

        // ---- 安全：尝试治疗 / 血量恢复后结束逃跑 ----
        if (noEnemyNear) {
            if (this._hasHealingItem(self) && this._canUseHealingItem(self)) {
                this._useHealingItem(self);
                if (p.hpRatio >= 0.5) {
                    this.fleeActive = false;
                    return BTStatus.SUCCESS;
                }
                return BTStatus.RUNNING;
            }
            if (p.hpRatio >= LOW_HP_RATIO + 0.1) {
                this.fleeActive = false;
                return BTStatus.SUCCESS;
            }
        }

        const baseX = 1280;
        const baseY = self.team === 'A' ? 6840 : 360;

        // ---- 已到基地且安全 → 结束逃跑 ----
        const distToBase = Math.hypot(self.x - baseX, self.y - baseY);
        if (distToBase < 100 && noEnemyNear) {
            this.fleeActive = false;
            return BTStatus.SUCCESS;
        }

        // ---- 混合「远离敌人」与「朝向基地」 ----
        if (p.nearestEnemy) {
            const awayX = self.x - p.nearestEnemy.player.x;
            const awayY = self.y - p.nearestEnemy.player.y;
            const awayDist = Math.hypot(awayX, awayY) || 1;
            const toBaseX = baseX - self.x;
            const toBaseY = baseY - self.y;
            const toBaseDist = Math.hypot(toBaseX, toBaseY) || 1;
            self.dx = (awayX / awayDist) * 0.6 + (toBaseX / toBaseDist) * 0.4;
            self.dy = (awayY / awayDist) * 0.6 + (toBaseY / toBaseDist) * 0.4;
        } else {
            this._moveToward(self, { x: baseX, y: baseY });
        }

        // ---- 有加速药水就喝 ----
        if (self.inventory.count('speedPotion') > 0 && self.inventory.usesCooledDown('speedPotion')) {
            self.useItem('speedPotion');
        }
        return BTStatus.RUNNING;
    }

    /** 追击：朝战斗目标移动，进入近战距离交给战斗 */
    _actChase() {
        const self = this.self;
        const p = this.perception;
        this._setAction(BotState.CHASING);

        if (!this.combatTarget && p.nearestEnemy) {
            this.combatTarget = p.nearestEnemy.player;
        }
        const t = this.combatTarget;
        if (!t || t.health <= 0) {
            this.combatTarget = null;
            this._clearActivities(self);
            return BTStatus.FAILURE;
        }

        const targetDist = dist(self, t);

        if (targetDist <= MELEE_RANGE) {
            this._clearActivities(self);
            return BTStatus.SUCCESS; // 已进入近战距离 → 交给战斗
        }
        if (p.hpRatio < LOW_HP_RATIO) {
            this.combatTarget = null;
            this._clearActivities(self);
            return BTStatus.FAILURE; // 交给防御分支
        }
        if (targetDist > ENEMY_DETECT_RANGE * 1.5) {
            this.combatTarget = null;
            this._clearActivities(self);
            return BTStatus.FAILURE; // 目标太远，放弃追击
        }

        this._clearActivities(self);
        this._moveToward(self, t);
        return BTStatus.RUNNING;
    }

    /** 近身战斗：面朝敌人，普攻 + 技能 + 道具，小幅移动保持距离 */
    _actFight() {
        const self = this.self;
        const p = this.perception;
        this._setAction(BotState.FIGHTING);

        if (!this.combatTarget && p.nearestEnemy) {
            this.combatTarget = p.nearestEnemy.player;
        }
        const t = this.combatTarget;
        if (!t || t.health <= 0) {
            this.combatTarget = null;
            self.attacking = false;
            return BTStatus.FAILURE;
        }

        const targetDist = dist(self, t);
        if (targetDist > MELEE_RANGE * 1.5) {
            return BTStatus.FAILURE; // 目标跑远 → 交给追击
        }
        if (p.hpRatio < LOW_HP_RATIO) {
            this.combatTarget = null;
            self.attacking = false;
            return BTStatus.FAILURE; // 血量过低 → 交给防御分支
        }

        // 战斗时不采矿、不购物（注意：不能重置 attacking，否则打断普攻蓄力）
        self.mining = false;
        self.miningTime = 0;
        if (self.isShopOpen) self.isShopOpen = false;

        // 面朝敌人
        self.dir = (t.x - self.x) > 0 ? 90 : -90;

        // 普攻
        if (self.isBasicReady() && !self.usingSkill && !self.cantAttack) {
            self.attacking = true;
            if (!self.attackForward || self.attackForward <= 0) {
                self.attackForward = self.args.attacks.basic.forward || 0;
            }
        }

        // 周期性技能 / 战斗道具
        if (this.tickCount % COMBAT_TICK_INTERVAL === 0) {
            if (!self.attacking && !self.usingSkill && !self.cantAttack) {
                this._tryUseSkill(self);
            }
            this._tryUseCombatItem(self, p);
        }

        // 小幅移动保持近战距离（带随机扰动）
        const tx = t.x - self.x;
        const ty = t.y - self.y;
        const td = Math.hypot(tx, ty) || 1;
        self.dx = tx / td + (Math.random() - 0.5) * 0.3;
        self.dy = ty / td + (Math.random() - 0.5) * 0.3;

        return BTStatus.RUNNING;
    }

    /** 前往商店 */
    _actMoveToShop() {
        const self = this.self;
        const p = this.perception;
        this._setAction(BotState.MOVING_TO_SHOP);

        let shop = this.shopTargetObj;
        if (!shop) {
            shop = p.nearestShop?.ref || null;
            this.shopTargetObj = shop;
        }
        if (!shop) {
            this._shopDecision = null;
            this.shopTargetObj = null;
            this._clearActivities(self);
            return BTStatus.FAILURE;
        }

        this._clearActivities(self);
        this._moveToward(self, shop.data);
        return BTStatus.RUNNING;
    }

    /** 在商店购买道具 */
    _actShopping() {
        const self = this.self;
        const p = this.perception;
        this._setAction(BotState.SHOPPING);

        this.shoppingActive = true;
        this.shopStayTimer++;

        // 打开商店标志（渲染用，服务端不真正发网络消息）
        if (!self.isShopOpen && p.nearestShop && p.nearestShop.dist <= SHOP_INTERACT_RANGE) {
            self.isShopOpen = true;
            self.shopJustOpened = true;
        }

        // 被推离商店 → 交给前往商店分支重新靠近（购物目标保持）
        if (p.nearestShop && p.nearestShop.dist > SHOP_INTERACT_RANGE) {
            self.isShopOpen = false;
            return BTStatus.FAILURE;
        }

        // 钱不够 → 离开
        if (self.money < SHOP_MIN_MONEY) {
            this._exitShopping(self);
            return BTStatus.SUCCESS;
        }

        // 周期性尝试购买
        if (this.shopStayTimer % 15 === 0) {
            const itemId = this._chooseItemToBuy(self);
            if (itemId) {
                this._buyItemSync(self, itemId);
            } else {
                // 没有合适的道具可买 → 离开
                this._exitShopping(self);
                return BTStatus.SUCCESS;
            }
        }

        // 最多停留 60 ticks
        if (this.shopStayTimer > 60) {
            this._exitShopping(self);
            return BTStatus.SUCCESS;
        }

        // 站定不动
        self.dx = 0;
        self.dy = 0;
        return BTStatus.RUNNING;
    }

    /** 前往前哨站 */
    _actMoveToOutpost() {
        const self = this.self;
        const p = this.perception;
        this._setAction(BotState.MOVING_TO_OUTPOST);

        let outpost = this.outpostTarget;
        if (!outpost) {
            outpost = p.nearestOutpost?.ref || null;
            this.outpostTarget = outpost;
        }
        if (!outpost || !p.nearestOutpost || !p.nearestOutpost.capturable) {
            this._captureDecision = null;
            this.outpostTarget = null;
            this._clearActivities(self);
            return BTStatus.FAILURE;
        }

        this._clearActivities(self);
        this._moveToward(self, { x: outpost.data.x, y: outpost.data.y });
        return BTStatus.RUNNING;
    }

    /** 占领前哨站（占领完成后靠近中心设置重生点） */
    _actCapturing() {
        const self = this.self;
        const p = this.perception;
        this._setAction(BotState.CAPTURING);

        const t = this.outpostTarget || p.nearestOutpost?.ref;
        if (!t) {
            this.capturingActive = false;
            return BTStatus.FAILURE;
        }
        this.outpostTarget = t;

        // ---- 已由己方占领：靠近中心设置重生点后收尾 ----
        if (t.state.owner === self.team) {
            const d = Math.hypot(self.x - t.data.x, self.y - t.data.y);
            if (d > SPAWN_SET_RANGE) {
                this._moveToward(self, { x: t.data.x, y: t.data.y });
                return BTStatus.RUNNING;
            }
            if (t.canSetSpawn && t.canSetSpawn(self)) {
                t.setSpawn(self);
            }
            this.capturingActive = false;
            this._captureDecision = null;
            this.outpostTarget = null;
            return BTStatus.SUCCESS;
        }

        // ---- 离开占领范围 → 失败（交给前往前哨站分支） ----
        const od = Math.hypot(self.x - t.data.x, self.y - t.data.y);
        if (od > CAPTURE_INTERACT_RANGE + 5) {
            this.capturingActive = false;
            return BTStatus.FAILURE;
        }

        // ---- 站定占领 ----
        this.capturingActive = true;
        this._clearActivities(self);
        self.dx = 0;
        self.dy = 0;
        return BTStatus.RUNNING;
    }

    /** 前往矿物 */
    _actMoveToMineral() {
        const self = this.self;
        const p = this.perception;
        this._setAction(BotState.MOVING_TO_MINERAL);

        let target = this.mineralTarget;
        if (!target || target.collected) {
            target = p.nearestMineral?.ref || null;
            this.mineralTarget = target;
        }
        if (!target || target.collected) {
            this.mineralTarget = null;
            this._clearActivities(self);
            return BTStatus.FAILURE;
        }

        this._clearActivities(self);
        this._moveToward(self, target.data);
        return BTStatus.RUNNING;
    }

    /** 开采矿物 */
    _actMine() {
        const self = this.self;
        const p = this.perception;
        this._setAction(BotState.MINING);

        if (!this.mineralTarget) {
            if (!p.nearestMineral) {
                this._clearActivities(self);
                return BTStatus.FAILURE;
            }
            this.mineralTarget = p.nearestMineral.ref;
        }
        const target = this.mineralTarget;

        // ---- 矿物已被采集 → 开采完成 ----
        if (target.collected) {
            self.mining = false;
            self.miningTime = 0;
            self.miningTarget = null;
            self.canMine = false;
            this.mineralTarget = null;
            return BTStatus.SUCCESS;
        }

        // ---- 已不在矿物附近（被推离/目标丢失） ----
        if (Math.hypot(self.x - target.data.x, self.y - target.data.y) > MINING_RANGE) {
            self.mining = false;
            self.miningTime = 0;
            self.miningTarget = null;
            self.canMine = false;
            this.mineralTarget = null;
            return BTStatus.FAILURE;
        }

        // ---- 站定开采（采矿进度由 Player.processMining 处理） ----
        self.dx = 0;
        self.dy = 0;
        self.mining = true;
        self.miningTarget = target;
        self.canMine = true;
        return BTStatus.RUNNING;
    }

    /** 兜底游荡：随机走动 */
    _actWander() {
        const self = this.self;
        this._setAction('wandering');

        this._clearActivities(self);
        this.wanderAngle += (Math.random() - 0.5) * 0.4;
        self.dx = Math.cos(this.wanderAngle) * 0.5;
        self.dy = Math.sin(this.wanderAngle) * 0.5;
        return BTStatus.RUNNING;
    }

    // ==================== 环境感知 ====================

    /**
     * 收集 bot 周围的环境信息（每 tick）
     */
    _perceive(players, world, self) {
        // 敌人
        const enemies = [];
        let nearestEnemy = null;
        let nearestEnemyDist = Infinity;
        for (const [id, p] of Object.entries(players)) {
            if (id === self.sessionId) continue;
            if (p.team === self.team) continue; // 忽略队友
            if (p.health <= 0) continue;         // 忽略死敌
            const d = dist(self, p);
            enemies.push({ id, player: p, dist: d });
            if (d < nearestEnemyDist) {
                nearestEnemyDist = d;
                nearestEnemy = { id, player: p, dist: d };
            }
        }

        // 矿物
        const minerals = [];
        let nearestMineral = null;
        let nearestMineralDist = Infinity;
        for (const m of world.minerals) {
            if (m.collected) continue;
            const d = dist(self, m.data);
            minerals.push({ ref: m, dist: d });
            if (d < nearestMineralDist) {
                nearestMineralDist = d;
                nearestMineral = { ref: m, dist: d };
            }
        }

        // 商店
        const shops = [];
        let nearestShop = null;
        let nearestShopDist = Infinity;
        for (const s of world.shops) {
            const d = dist(self, s.data);
            shops.push({ ref: s, dist: d });
            if (d < nearestShopDist) {
                nearestShopDist = d;
                nearestShop = { ref: s, dist: d };
            }
        }

        // 前哨站（只关心可占领的：中立或敌方）
        const outposts = [];
        let nearestOutpost = null;
        let nearestOutpostDist = Infinity;
        for (const o of world.outposts) {
            const d = dist(self, { x: o.data.x, y: o.data.y });
            const capturable = o.state.owner !== self.team;
            outposts.push({ ref: o, dist: d, capturable });
            if (capturable && d < nearestOutpostDist) {
                nearestOutpostDist = d;
                nearestOutpost = { ref: o, dist: d, capturable };
            }
        }

        return {
            self,
            enemies,
            nearestEnemy,
            minerals,
            nearestMineral,
            shops,
            nearestShop,
            outposts,
            nearestOutpost,
            hpRatio: self.health / self.maxHealth,
            money: self.money,
            hasHealingItem: this._hasHealingItem(self),
            canUseHealing: this._canUseHealingItem(self),
        };
    }

    // ==================== 辅助方法 ====================

    /**
     * 清除所有行为树目标与激活标志（用于匹配阶段等禁止行动的场合）
     * 确保切换到游荡时不会残留战斗/采矿/购物/占领状态
     * @param {import('../player/index.js').default} self
     */
    _resetGoals(self) {
        this.combatTarget = null;
        this.mineralTarget = null;
        this.shopTargetObj = null;
        this.outpostTarget = null;
        this.fleeActive = false;
        this.shoppingActive = false;
        this.capturingActive = false;
        this._shopDecision = null;
        this._captureDecision = null;
        this.llmFleeRequested = false;
        this.llmCachedDecision = null;
        self.mining = false;
        self.miningTime = 0;
        self.attacking = false;
        self.usingSkill = false;
        self.shopJustOpened = false;
        if (self.isShopOpen) self.isShopOpen = false;
    }

    /** 记录当前动作（仅在变化时打印日志） */
    _setAction(name) {
        if (this.currentAction === name) return;
        this.prevAction = this.currentAction;
        this.currentAction = name;
        if (this.self) {
            console.log(`[Bot] ${this.self.sessionId}: ${this.prevAction} → ${name}`);
        }
    }

    /**
     * 清除所有「持续交互」状态（采矿/普攻/商店），用于切换到其他动作。
     * 注意：不清除目标记忆与分支激活标志（由各动作自行管理）。
     */
    _clearActivities(self) {
        self.mining = false;
        self.miningTime = 0;
        self.attacking = false;
        if (self.isShopOpen) self.isShopOpen = false;
        self.shopJustOpened = false;
    }

    /** 结束购物（清理商店状态与购物目标） */
    _exitShopping(self) {
        self.isShopOpen = false;
        self.shopJustOpened = false;
        this.shoppingActive = false;
        this._shopDecision = null;
        this.shopTargetObj = null;
        this.shopStayTimer = 0;
    }

    /** 是否正忙于其他既定目标（用于决定是否发起新的购物/占领计划） */
    _isBusyWithOtherGoal() {
        return !!this.combatTarget || this.fleeActive ||
            this.shoppingActive || this.capturingActive ||
            !!this.mineralTarget || !!this.outpostTarget ||
            !!this._shopDecision || !!this._captureDecision;
    }

    /** 向目标点移动 */
    _moveToward(self, target) {
        const tx = target.x - self.x;
        const ty = target.y - self.y;
        const d = Math.hypot(tx, ty) || 1;

        // 已到达目标
        if (d <= ARRIVE_TOLERANCE) {
            self.dx = 0;
            self.dy = 0;
            return;
        }

        // 计算归一化方向 + 微小随机扰动
        const jitter = WANDER_JITTER * (Math.random() - 0.5);
        self.dx = tx / d + jitter;
        self.dy = ty / d + jitter * 0.5;

        // 更新朝向
        self.dir = tx > 0 ? 90 : -90;
    }

    /** 尝试使用当前可用的技能 */
    _tryUseSkill(self) {
        // 按技能优先级（选择冷却好且消耗够的）
        for (let i = 4; i >= 1; i--) {
            const skillData = self.getSkillData(i);
            if (!skillData) continue;
            if (!self.isSkillReady(i)) continue;
            if ((skillData.cost || 0) > self.money) continue;

            // 有些技能是 buff 类型，只对自己有效（skill3 惯性反冲, skill4 第三定律）
            const isBuffSkill = skillData.buff && !skillData.damage && !skillData.magic;
            const isCombatSkill = skillData.damage > 0 || skillData.magic || skillData.debuff;

            if (isCombatSkill || (isBuffSkill && Math.random() < 0.5)) {
                self.money -= (skillData.cost || 0);
                self.usingSkill = true;
                self.skillCastForward = skillData.forward || 0;
                self.skillCooldowns[i] = Date.now();
                self.selectedSkill = i;
                console.log(`[Bot] ${self.sessionId} 使用技能 ${skillData.name}`);
                return;
            }
        }
    }

    /** 战斗中尝试使用道具 */
    _tryUseCombatItem(self, perception) {
        // 低血量时使用治疗道具
        if (perception.hpRatio < 0.5 && this._canUseHealingItem(self)) {
            this._useHealingItem(self);
            return;
        }

        // 使用防御道具
        if (perception.hpRatio < 0.6) {
            if (self.inventory.count('shieldStone') > 0 && self.inventory.usesCooledDown('shieldStone')) {
                self.useItem('shieldStone');
                return;
            }
            if (self.inventory.count('speedPotion') > 0 && self.inventory.usesCooledDown('speedPotion')) {
                self.useItem('speedPotion');
                return;
            }
        }

        // 使用攻击道具（对敌人放炸弹等）
        if (self.inventory.count('bomb') > 0 && Math.random() < 0.1) {
            self.useItem('bomb');
        }
    }

    /** 检查是否有治疗道具 */
    _hasHealingItem(self) {
        const inv = self.inventory;
        return inv.count('pill') > 0 ||
            inv.count('bandage') > 0 ||
            inv.count('medicalKit') > 0;
    }

    /** 检查治疗道具是否冷却完毕 */
    _canUseHealingItem(self) {
        const inv = self.inventory;
        const candidates = ['pill', 'bandage', 'medicalKit'];
        for (const id of candidates) {
            if (inv.count(id) > 0 && inv.usesCooledDown(id)) {
                return true;
            }
        }
        return false;
    }

    /** 使用治疗道具 */
    _useHealingItem(self) {
        const inv = self.inventory;
        // 优先用效果最好的
        const priority = ['medicalKit', 'bandage', 'pill'];
        for (const id of priority) {
            if (inv.count(id) > 0 && inv.usesCooledDown(id)) {
                const success = self.useItem(id);
                if (success) {
                    console.log(`[Bot] ${self.sessionId} 使用治疗道具 ${id}`);
                    return true;
                }
            }
        }
        return false;
    }

    /** 选择要购买的道具（简单规则：按优先级补货） */
    _chooseItemToBuy(self) {
        // 优先购买顺序：治疗道具 > 攻击道具 > 功能道具
        const priorityList = [
            // 治疗类
            { id: 'medicalKit', maxWanted: 3 },
            { id: 'bandage', maxWanted: 5 },
            { id: 'pill', maxWanted: 10 },
            // 攻击类
            { id: 'bomb', maxWanted: 3 },
            { id: 'fireball', maxWanted: 3 },
            { id: 'fragGrenade', maxWanted: 5 },
            // 防御/功能类
            { id: 'shieldStone', maxWanted: 2 },
            { id: 'speedPotion', maxWanted: 3 },
            { id: 'thornArmor', maxWanted: 1 },
        ];

        for (const pri of priorityList) {
            if (self.inventory.count(pri.id) < pri.maxWanted) {
                return pri.id;
            }
        }
        return null;
    }

    /** 同步购买道具（使用静态导入的 Shop） */
    _buyItemSync(self, itemId) {
        try {
            const result = Shop.buy(self, itemId);
            if (result.success) {
                console.log(`[Bot] ${self.sessionId} 成功购买 ${itemId}`);
            }
        } catch (err) {
            console.warn(`[Bot] 购买 ${itemId} 异常:`, err.message);
        }
    }

    // ==================== LLM 集成 ====================

    /**
     * 周期性请求 LLM 高层决策（异步，结果缓存到 llmCachedDecision，
     * 由根节点 LLM 分支在下一 tick 应用）。
     */
    _tryRequestLLM() {
        if (!isLLMEnabled()) return null;
        if (this.llmCachedDecision) return this.llmCachedDecision; // 已有待应用决策

        // 冷却中或有待处理请求 → 不发起新请求
        const now = Date.now();
        const cfg = getLLMConfig();
        const cooldown = cfg.decisionCooldown || 2000;
        if (this.llmPending || now - this.lastLlmCallTime < cooldown) {
            return null;
        }

        // 发起异步 LLM 请求
        this.llmPending = true;
        this.lastLlmCallTime = now;

        const botState = this._buildBotStateForLLM(this.perception);
        queryLLM(botState).then(decision => {
            if (decision) {
                this.llmCachedDecision = decision;
                // 将决策的 targetId 解析为实际目标（如果提供）
                if (decision.targetId) {
                    this._resolveLLMTarget(decision, this.perception);
                }
            }
        }).catch(() => {
            // 已在上层处理
        }).finally(() => {
            this.llmPending = false;
        });

        return null; // 本次 tick 不等待 LLM，下次用缓存
    }

    /** 构建发送给 LLM 的游戏状态 */
    _buildBotStateForLLM(perception) {
        return {
            self: {
                x: Math.round(perception.self.x),
                y: Math.round(perception.self.y),
                health: perception.self.health,
                maxHealth: perception.self.maxHealth,
                money: perception.self.money,
                team: perception.self.team,
                hero: perception.self.hero,
            },
            enemies: perception.enemies.map(e => ({
                id: e.id,
                x: Math.round(e.player.x),
                y: Math.round(e.player.y),
                health: e.player.health,
                dist: Math.round(e.dist),
            })),
            minerals: perception.minerals
                .filter(m => m.dist < 400)
                .map(m => ({
                    id: m.ref.data?.id || 'unknown',
                    x: Math.round(m.ref.data.x),
                    y: Math.round(m.ref.data.y),
                    type: m.ref.mineralType,
                    dist: Math.round(m.dist),
                })),
            shops: perception.shops
                .filter(s => s.dist < 400)
                .map(s => ({
                    id: s.ref.data?.id || 'unknown',
                    x: Math.round(s.ref.data.x),
                    y: Math.round(s.ref.data.y),
                    dist: Math.round(s.dist),
                })),
            outposts: perception.outposts
                .filter(o => o.dist < 500)
                .map(o => ({
                    id: o.ref.data?.id || 'unknown',
                    x: Math.round(o.ref.data.x),
                    y: Math.round(o.ref.data.y),
                    owner: o.ref.state?.owner || 'neutral',
                    dist: Math.round(o.dist),
                })),
            items: perception.self.inventory.serialize().map(i => ({
                itemId: i.itemId,
                name: i.name,
                count: i.count,
            })),
            currentAction: this.currentAction,
        };
    }

    /** 将 LLM 返回的 targetId 解析为感知中的实际目标引用 */
    _resolveLLMTarget(decision, perception) {
        const tid = decision.targetId;
        if (!tid) return;

        // 尝试匹配敌人
        for (const e of perception.enemies) {
            if (e.id === tid) {
                this.combatTarget = e.player;
                return;
            }
        }
        // 尝试匹配矿物
        for (const m of perception.minerals) {
            if (m.ref.data?.id === tid) {
                this.mineralTarget = m.ref;
                return;
            }
        }
        // 尝试匹配商店
        for (const s of perception.shops) {
            if (s.ref.data?.id === tid) {
                this.shopTargetObj = s.ref;
                return;
            }
        }
        // 尝试匹配前哨站
        for (const o of perception.outposts) {
            if (o.ref.data?.id === tid) {
                this.outpostTarget = o.ref;
                return;
            }
        }
    }
}
