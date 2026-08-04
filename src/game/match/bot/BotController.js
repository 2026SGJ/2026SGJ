/**
 * BotController — 人机行为控制器（FSM + 可选 LLM）
 *
 * 管理 AI 玩家的状态机，每 tick 根据环境感知做出决策。
 *
 * FSM 状态：
 *   IDLE             — 初始/空闲，评估下一步行动
 *   MOVING_TO_MINERAL— 正在走向矿物
 *   MINING           — 正在开采矿物
 *   MOVING_TO_SHOP   — 正在走向商店
 *   SHOPPING         — 正在商店购买
 *   CHASING          — 正在追击敌人
 *   FIGHTING         — 近身战斗中
 *   FLEEING          — 低血量逃跑
 *   MOVING_TO_OUTPOST— 正在走向前哨站
 *   CAPTURING        — 正在占领前哨站
 *
 * 决策节点（LLM 可选介入）：
 *   1. IDLE 状态评估下一步行动
 *   2. 看到敌人时：追击/忽略/逃跑
 *   3. 血量低时：使用治疗道具/逃跑/回城
 *   4. 有钱在商店旁：买什么道具
 */

import { isLLMEnabled, queryLLM, getLLMConfig } from './llmDecision.js';
import Shop from '../item/shop.js';

// ==================== 状态枚举 ====================

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
/** 到达目标点的距离容差（像素） */
const ARRIVE_TOLERANCE = 10;
/** 决策评估间隔（tick 数，避免每帧做复杂计算） */
const DECISION_TICK_INTERVAL = 10;
/** 战斗中重新评估间隔（tick 数） */
const COMBAT_TICK_INTERVAL = 5;
/** 随机扰动幅度（避免 bot 行为过于机械） */
const WANDER_JITTER = 0.15;

// ==================== 工具函数 ====================

function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

// ==================== BotController 类 ====================

export default class BotController {

    /**
     * @param {Object} options
     * @param {string} options.team - bot 所属队伍 'A' | 'B'
     */
    constructor({ team }) {
        this.team = team;

        /** @type {string} 当前 FSM 状态 */
        this.state = BotState.IDLE;

        /** @type {string} 上一个状态（用于检测状态转移） */
        this.prevState = null;

        /** @type {{ x: number, y: number } | null} 当前移动目标 */
        this.moveTarget = null;

        /** @type {import('../player/index.js').default | null} 当前战斗目标 */
        this.combatTarget = null;

        /** @type {Object | null} 当前矿物目标 */
        this.mineralTarget = null;

        /** @type {Object | null} 当前商店目标 */
        this.shopTargetObj = null;

        /** @type {Object | null} 当前前哨站目标 */
        this.outpostTarget = null;

        /** @type {number} tick 计数器 */
        this.tickCount = 0;

        /** @type {number} 逃跑开始时间 */
        this.fleeStartedAt = 0;

        /** @type {number} 商店停留计时 */
        this.shopStayTimer = 0;

        /** @type {number} 在某个状态停留的 tick 数 */
        this.stateTicks = 0;

        // ---------- LLM 集成 ----------
        /** @type {Object | null} 缓存的 LLM 决策 */
        this.llmCachedDecision = null;
        /** @type {boolean} 是否正在等待 LLM 响应 */
        this.llmPending = false;
        /** @type {number} 上次 LLM 调用时间 */
        this.lastLlmCallTime = 0;

        // ---------- 随机种子 ----------
        /** @type {number} 当前偏航角偏移（随机游走） */
        this.wanderAngle = Math.random() * Math.PI * 2;
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

        // ---- 眩晕时无法行动 ----
        if (self.stunned) {
            self.dx = 0;
            self.dy = 0;
            return;
        }

        // ---- 周期性环境感知 ----
        const shouldDecide = (this.tickCount % DECISION_TICK_INTERVAL === 0);
        const shouldCombatDecide = (this.tickCount % COMBAT_TICK_INTERVAL === 0);

        // ---- 收集感知数据 ----
        const perception = this._perceive(players, world, self);
        const nearestEnemy = perception.nearestEnemy;
        const nearestMineral = perception.nearestMineral;
        const nearestShop = perception.nearestShop;
        const nearestOutpost = perception.nearestOutpost;

        // ---- 全局紧急优先级：死亡（bot 死亡由 Player.onDeath 处理）----
        // ---- 全局紧急优先级：极低血量 → 强制逃跑 ----
        const hpRatio = self.health / self.maxHealth;

        if (hpRatio < LOW_HP_RATIO && nearestEnemy && nearestEnemy.dist < ENEMY_DETECT_RANGE) {
            // 有治疗道具且不在冷却中 → 使用治疗
            if (this._hasHealingItem(self) && this._canUseHealingItem(self)) {
                this._useHealingItem(self, players, world);
            } else {
                // 没有治疗道具 → 逃跑
                this._transitionTo(BotState.FLEEING, self);
            }
        }

        // ---- FSM 状态机 ----
        switch (this.state) {
            case BotState.IDLE:
                this._updateIdle(perception, self, shouldDecide);
                break;
            case BotState.MOVING_TO_MINERAL:
                this._updateMovingToMineral(perception, self);
                break;
            case BotState.MINING:
                this._updateMining(perception, self, shouldDecide);
                break;
            case BotState.MOVING_TO_SHOP:
                this._updateMovingToShop(perception, self);
                break;
            case BotState.SHOPPING:
                this._updateShopping(perception, self);
                break;
            case BotState.CHASING:
                this._updateChasing(perception, self, shouldCombatDecide);
                break;
            case BotState.FIGHTING:
                this._updateFighting(perception, self, shouldCombatDecide);
                break;
            case BotState.FLEEING:
                this._updateFleeing(perception, self, shouldDecide);
                break;
            case BotState.MOVING_TO_OUTPOST:
                this._updateMovingToOutpost(perception, self);
                break;
            case BotState.CAPTURING:
                this._updateCapturing(perception, self, shouldDecide);
                break;
        }

        this.stateTicks++;
    }

    // ==================== 环境感知 ====================

    /**
     * 收集 bot 周围的环境信息
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

        // 前哨站
        const outposts = [];
        let nearestOutpost = null;
        let nearestOutpostDist = Infinity;
        for (const o of world.outposts) {
            const d = dist(self, { x: o.data.x, y: o.data.y });
            const capturable = o.state.owner !== self.team; // 只关心可占领的（中立或敌方）
            outposts.push({ ref: o, dist: d, capturable });
            if (capturable && d < nearestOutpostDist) {
                nearestOutpostDist = d;
                nearestOutpost = { ref: o, dist: d };
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

    // ==================== IDLE 状态 ====================

    _updateIdle(perception, self, shouldDecide) {
        if (!shouldDecide) return;

        // 如果有 LLM 缓存，优先使用
        const llmDecision = this._tryGetLLMDecision(perception);

        let action = llmDecision?.action || null;

        // FSM 默认规则（LLM 不可用或未返回决策时）
        if (!action) {
            action = this._defaultIdleDecision(perception);
        }

        switch (action) {
            case 'mine':
                if (perception.nearestMineral) {
                    this._startMoveTo(perception.nearestMineral.ref.data, BotState.MOVING_TO_MINERAL);
                    this.mineralTarget = perception.nearestMineral.ref;
                }
                break;
            case 'attack':
                if (perception.nearestEnemy) {
                    this.combatTarget = perception.nearestEnemy.player;
                    this._transitionTo(BotState.CHASING, self);
                }
                break;
            case 'shop':
                if (perception.nearestShop) {
                    this._startMoveTo(perception.nearestShop.ref.data, BotState.MOVING_TO_SHOP);
                    this.shopTargetObj = perception.nearestShop.ref;
                }
                break;
            case 'capture':
                if (perception.nearestOutpost) {
                    this._startMoveTo(
                        { x: perception.nearestOutpost.ref.data.x, y: perception.nearestOutpost.ref.data.y },
                        BotState.MOVING_TO_OUTPOST
                    );
                    this.outpostTarget = perception.nearestOutpost.ref;
                }
                break;
            case 'flee':
                this._transitionTo(BotState.FLEEING, self);
                break;
            case 'use_item':
                this._useHealingItem(self, perception._playersRef, perception._worldRef);
                // 使用后继续 IDLE 重新评估
                break;
            default:
                // 默认去采矿
                if (perception.nearestMineral) {
                    this._startMoveTo(perception.nearestMineral.ref.data, BotState.MOVING_TO_MINERAL);
                    this.mineralTarget = perception.nearestMineral.ref;
                } else {
                    this._wander(self);
                }
                break;
        }
    }

    /**
     * 纯 FSM 默认决策逻辑
     */
    _defaultIdleDecision(perception) {
        // 优先级1：附近有敌人 → 战斗（血量健康）或逃跑（血量低）
        if (perception.nearestEnemy && perception.nearestEnemy.dist < ENEMY_DETECT_RANGE) {
            if (perception.hpRatio >= HEALTHY_HP_RATIO) {
                return 'attack';
            } else {
                // 有治疗道具 → 使用
                if (perception.hasHealingItem && perception.canUseHealing) {
                    return 'use_item';
                }
                return 'flee';
            }
        }

        // 优先级2：有钱且在商店附近 → 购物
        if (perception.money >= SHOP_MONEY_THRESHOLD &&
            perception.nearestShop && perception.nearestShop.dist < 200) {
            // 随机概率（不是每次都去商店）
            if (Math.random() < 0.3) {
                return 'shop';
            }
        }

        // 优先级3：附近有可占领前哨站 → 占领
        if (perception.nearestOutpost && perception.nearestOutpost.dist < 250) {
            if (Math.random() < 0.25) {
                return 'capture';
            }
        }

        // 优先级4：采矿
        if (perception.nearestMineral) {
            return 'mine';
        }

        // 兜底：空闲（会转为 wander）
        return 'idle';
    }

    // ==================== 移动至矿物 ====================

    _updateMovingToMineral(perception, self) {
        // 矿物已被采集 → 回到 IDLE
        if (!perception.nearestMineral || perception.nearestMineral.ref.collected) {
            this.mineralTarget = null;
            this._transitionTo(BotState.IDLE, self);
            return;
        }

        // 途中发现敌人且血量健康 → 转战斗
        if (perception.nearestEnemy &&
            perception.nearestEnemy.dist < ENEMY_DETECT_RANGE &&
            perception.hpRatio >= HEALTHY_HP_RATIO) {
            this.mineralTarget = null;
            this.combatTarget = perception.nearestEnemy.player;
            this._transitionTo(BotState.CHASING, self);
            return;
        }

        // 到达矿物 → 开始采集
        const md = perception.nearestMineral.dist;
        if (md <= 35) {
            // 已足够近，停止移动，设置采矿
            self.dx = 0;
            self.dy = 0;
            this._transitionTo(BotState.MINING, self);
            return;
        }

        // 继续移动
        this._moveToward(self, perception.nearestMineral.ref.data);
    }

    // ==================== 采矿状态 ====================

    _updateMining(perception, self, shouldDecide) {
        // 矿物被采完了 → IDLE
        if (this.mineralTarget && this.mineralTarget.collected) {
            this.mineralTarget = null;
            self.mining = false;
            self.miningTime = 0;
            this._transitionTo(BotState.IDLE, self);
            return;
        }

        // 附近没有可开采矿物了
        if (!perception.nearestMineral || perception.nearestMineral.dist > 35) {
            self.mining = false;
            self.miningTime = 0;
            this.mineralTarget = null;
            this._transitionTo(BotState.IDLE, self);
            return;
        }

        // 敌人靠近 → 决策
        if (shouldDecide && perception.nearestEnemy &&
            perception.nearestEnemy.dist < ENEMY_DETECT_RANGE) {
            if (perception.hpRatio >= HEALTHY_HP_RATIO) {
                self.mining = false;
                self.miningTime = 0;
                this.combatTarget = perception.nearestEnemy.player;
                this._transitionTo(BotState.CHASING, self);
                return;
            } else {
                // 血量低 → 逃跑前先尝试用治疗道具
                if (perception.hasHealingItem && perception.canUseHealing) {
                    this._useHealingItem(self);
                } else {
                    self.mining = false;
                    self.miningTime = 0;
                    this._transitionTo(BotState.FLEEING, self);
                    return;
                }
            }
        }

        // 继续采矿（设置 mining = true 由 BotPlayer 的 processMining 处理）
        // 停止移动
        self.dx = 0;
        self.dy = 0;

        // 确保采矿目标正确
        if (this.mineralTarget && !this.mineralTarget.collected) {
            self.mining = true;
            self.miningTarget = this.mineralTarget;
            self.canMine = true;
        }
    }

    // ==================== 移动至商店 ====================

    _updateMovingToShop(perception, self) {
        // 商店目标无效
        if (!perception.nearestShop) {
            this._transitionTo(BotState.IDLE, self);
            return;
        }

        const sd = perception.nearestShop.dist;

        // 到达商店 → 进入购买
        if (sd <= 65) {
            self.dx = 0;
            self.dy = 0;
            this._transitionTo(BotState.SHOPPING, self);
            this.shopStayTimer = 0;
            return;
        }

        // 途中敌人靠近且血量健康 → 转战斗
        if (perception.nearestEnemy &&
            perception.nearestEnemy.dist < ENEMY_DETECT_RANGE &&
            perception.hpRatio >= HEALTHY_HP_RATIO) {
            this.combatTarget = perception.nearestEnemy.player;
            this._transitionTo(BotState.CHASING, self);
            return;
        }

        // 继续移动
        this._moveToward(self, perception.nearestShop.ref.data);
    }

    // ==================== 购物状态 ====================

    _updateShopping(perception, self) {
        this.shopStayTimer++;

        // 靠近商店打开商店 UI（通过设置 isShopOpen）
        if (!self.isShopOpen && perception.nearestShop && perception.nearestShop.dist <= 65) {
            self.isShopOpen = true;
            self.shopJustOpened = true;
        }

        // 买不起东西 → 离开
        if (self.money < 15) {
            self.isShopOpen = false;
            this._transitionTo(BotState.IDLE, self);
            return;
        }

        // 执行购买（每隔一定 tick 尝试一次）
        if (this.shopStayTimer % 15 === 0) {
            const itemId = this._chooseItemToBuy(self);
            if (itemId) {
                this._buyItemSync(self, itemId);
            } else {
                // 没有合适的道具可买 → 离开
                self.isShopOpen = false;
                this._transitionTo(BotState.IDLE, self);
                return;
            }
        }

        // 最多在商店停留 60 ticks (约3秒)
        if (this.shopStayTimer > 60) {
            self.isShopOpen = false;
            this._transitionTo(BotState.IDLE, self);
            return;
        }

        // 站定不动
        self.dx = 0;
        self.dy = 0;
    }

    /**
     * 选择要购买的道具（简单规则）
     */
    _chooseItemToBuy(self) {
        const inventory = self.inventory;
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
            const count = inventory.count(pri.id);
            if (count < pri.maxWanted) {
                // 检查价格（Shop.buy 会在内部验证）
                return pri.id;
            }
        }
        return null;
    }

    /**
     * 同步购买道具（使用静态导入的 Shop）
     */
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

    // ==================== 追击状态 ====================

    _updateChasing(perception, self, shouldDecide) {
        // 目标丢失
        if (!this.combatTarget || this.combatTarget.health <= 0) {
            this.combatTarget = null;
            this._transitionTo(BotState.IDLE, self);
            return;
        }

        // 检查血量：是否需要逃跑
        if (shouldDecide && perception.hpRatio < LOW_HP_RATIO) {
            this.combatTarget = null;
            this._transitionTo(BotState.FLEEING, self);
            return;
        }

        const targetDist = dist(self, this.combatTarget);

        // 到达近战范围 → 开始战斗
        if (targetDist <= MELEE_RANGE) {
            this._transitionTo(BotState.FIGHTING, self);
            return;
        }

        // 追击目标
        this._moveToward(self, this.combatTarget);

        // 如果目标太远，放弃追击
        if (targetDist > ENEMY_DETECT_RANGE * 1.5) {
            this.combatTarget = null;
            this._transitionTo(BotState.IDLE, self);
            return;
        }
    }

    // ==================== 战斗状态 ====================

    _updateFighting(perception, self, shouldDecide) {
        // 目标丢失或死亡
        if (!this.combatTarget || this.combatTarget.health <= 0) {
            this.combatTarget = null;
            this._transitionTo(BotState.IDLE, self);
            return;
        }

        const targetDist = dist(self, this.combatTarget);

        // 目标跑远了 → 切回追击
        if (targetDist > MELEE_RANGE * 1.5) {
            this._transitionTo(BotState.CHASING, self);
            return;
        }

        // 血量过低 → 逃跑
        if (shouldDecide && perception.hpRatio < LOW_HP_RATIO) {
            this.combatTarget = null;
            this._transitionTo(BotState.FLEEING, self);
            return;
        }

        // 战斗中：面朝敌人，普攻 + 技能
        self.dir = (this.combatTarget.x - self.x) > 0 ? 90 : -90;

        // 普攻
        if (self.isBasicReady() && !self.usingSkill && !self.cantAttack) {
            self.attacking = true;
            if (!self.attackForward || self.attackForward <= 0) {
                self.attackForward = self.args.attacks.basic.forward || 0;
            }
        }

        // 使用技能（优先高伤害技能）
        if (shouldDecide && !self.attacking && !self.usingSkill && !self.cantAttack) {
            this._tryUseSkill(self);
        }

        // 战斗中使用道具
        if (shouldDecide) {
            this._tryUseCombatItem(self, perception);
        }

        // 小幅度移动以保持近战范围（带有随机性）
        const toTargetX = this.combatTarget.x - self.x;
        const toTargetY = this.combatTarget.y - self.y;
        const toTargetDist = Math.hypot(toTargetX, toTargetY) || 1;
        // 向目标移动，但有随机偏移
        const jitterX = (Math.random() - 0.5) * 0.3;
        const jitterY = (Math.random() - 0.5) * 0.3;
        self.dx = toTargetX / toTargetDist + jitterX;
        self.dy = toTargetY / toTargetDist + jitterY;
    }

    /**
     * 尝试使用当前可用的技能
     */
    _tryUseSkill(self) {
        // 尝试技能释放：按技能优先级（选择冷却好且消耗够的）
        for (let i = 4; i >= 1; i--) {
            const skillData = self.getSkillData(i);
            if (!skillData) continue;
            if (!self.isSkillReady(i)) continue;
            if ((skillData.cost || 0) > self.money) continue;

            // 有些技能是 buff 类型，只对自己有效（skill3 惯性反冲, skill4 第三定律）
            // 战斗中有敌人时优先用伤害技能
            const isBuffSkill = skillData.buff && !skillData.damage && !skillData.magic;
            const isCombatSkill = skillData.damage > 0 || skillData.magic || skillData.debuff;

            if (isCombatSkill || (isBuffSkill && Math.random() < 0.5)) {
                // 计算并选择技能（取备选技能中的第一个）
                const selectedSkill = i;
                self.money -= (skillData.cost || 0);
                self.usingSkill = true;
                self.skillCastForward = skillData.forward || 0;
                self.skillCooldowns[selectedSkill] = Date.now();
                self.selectedSkill = selectedSkill;
                console.log(`[Bot] ${self.sessionId} 使用技能 ${skillData.name}`);
                return;
            }
        }
    }

    /**
     * 战斗中尝试使用道具
     */
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

    // ==================== 逃跑状态 ====================

    _updateFleeing(perception, self, shouldDecide) {
        // 安全了 → 回到 IDLE
        const noEnemyNear = !perception.nearestEnemy ||
            perception.nearestEnemy.dist > FLEE_SAFE_DIST;

        if (noEnemyNear) {
            // 血量恢复一些再回去
            if (perception.hpRatio >= LOW_HP_RATIO + 0.1) {
                this._transitionTo(BotState.IDLE, self);
                return;
            }
            // 血量仍很低但有治疗道具
            if (perception.hasHealingItem && perception.canUseHealing) {
                this._useHealingItem(self);
                if (perception.hpRatio >= 0.5) {
                    this._transitionTo(BotState.IDLE, self);
                }
                return;
            }
        }

        // 朝己方基地方向逃跑
        const baseX = 1280;
        const baseY = self.team === 'A' ? 6840 : 360;

        // 如果已经接近基地，站住回血
        const distToBase = Math.hypot(self.x - baseX, self.y - baseY);
        if (distToBase < 100 && noEnemyNear) {
            self.dx = 0;
            self.dy = 0;
            // 回血等待后回IDLE
            if (perception.hpRatio >= 0.7) {
                this._transitionTo(BotState.IDLE, self);
            }
            return;
        }

        // 逃离敌人方向
        if (perception.nearestEnemy) {
            const awayX = self.x - perception.nearestEnemy.player.x;
            const awayY = self.y - perception.nearestEnemy.player.y;
            const awayDist = Math.hypot(awayX, awayY) || 1;
            // 混合远离敌人和朝向基地
            const toBaseX = baseX - self.x;
            const toBaseY = baseY - self.y;
            const toBaseDist = Math.hypot(toBaseX, toBaseY) || 1;
            self.dx = (awayX / awayDist) * 0.6 + (toBaseX / toBaseDist) * 0.4;
            self.dy = (awayY / awayDist) * 0.6 + (toBaseY / toBaseDist) * 0.4;
        } else {
            this._moveToward(self, { x: baseX, y: baseY });
        }

        // 如果有加速药水，使用它逃跑
        if (self.inventory.count('speedPotion') > 0 && self.inventory.usesCooledDown('speedPotion')) {
            self.useItem('speedPotion');
        }
    }

    // ==================== 移动至前哨站 ====================

    _updateMovingToOutpost(perception, self) {
        if (!perception.nearestOutpost || !perception.nearestOutpost.capturable) {
            this._transitionTo(BotState.IDLE, self);
            return;
        }

        const od = perception.nearestOutpost.dist;

        // 到达前哨站范围
        if (od <= 105) {
            self.dx = 0;
            self.dy = 0;
            this._transitionTo(BotState.CAPTURING, self);
            return;
        }

        // 途中发现敌人且血量健康 → 战斗
        if (perception.nearestEnemy &&
            perception.nearestEnemy.dist < ENEMY_DETECT_RANGE &&
            perception.hpRatio >= HEALTHY_HP_RATIO) {
            this.combatTarget = perception.nearestEnemy.player;
            this._transitionTo(BotState.CHASING, self);
            return;
        }

        this._moveToward(self, {
            x: perception.nearestOutpost.ref.data.x,
            y: perception.nearestOutpost.ref.data.y,
        });
    }

    // ==================== 占领状态 ====================

    _updateCapturing(perception, self, shouldDecide) {
        // 检查前哨站是否已被己方占领
        if (this.outpostTarget && this.outpostTarget.state.owner === self.team) {
            // 设置重生点
            if (this.outpostTarget.canSetSpawn && this.outpostTarget.canSetSpawn(self)) {
                this.outpostTarget.setSpawn(self);
            }
            this._transitionTo(BotState.IDLE, self);
            return;
        }

        // 前哨站不在范围内
        const od = this.outpostTarget
            ? Math.hypot(self.x - this.outpostTarget.data.x, self.y - this.outpostTarget.data.y)
            : 999;

        if (od > 110) {
            this._transitionTo(BotState.IDLE, self);
            return;
        }

        // 敌人靠近 → 战斗或逃跑
        if (shouldDecide && perception.nearestEnemy &&
            perception.nearestEnemy.dist < ENEMY_DETECT_RANGE) {
            if (perception.hpRatio >= HEALTHY_HP_RATIO) {
                this.combatTarget = perception.nearestEnemy.player;
                this._transitionTo(BotState.CHASING, self);
            } else {
                this._transitionTo(BotState.FLEEING, self);
            }
            return;
        }

        // 站定占领
        self.dx = 0;
        self.dy = 0;
    }

    // ==================== 移动辅助 ====================

    /**
     * 向目标点移动
     */
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

    /**
     * 随机游走（无目标时）
     */
    _wander(self) {
        this.wanderAngle += (Math.random() - 0.5) * 0.4;
        self.dx = Math.cos(this.wanderAngle) * 0.5;
        self.dy = Math.sin(this.wanderAngle) * 0.5;
    }

    /**
     * 开始向目标移动
     */
    _startMoveTo(target, newState) {
        this.moveTarget = { x: target.x, y: target.y };
        this._transitionToSimple(newState);
    }

    // ==================== 状态转移 ====================

    _transitionTo(newState, self) {
        if (this.state === newState) return;

        this.prevState = this.state;
        this.state = newState;
        this.stateTicks = 0;

        console.log(
            `[Bot] ${self.sessionId}: ${this.prevState} → ${newState}`
        );
    }

    _transitionToSimple(newState) {
        this.prevState = this.state;
        this.state = newState;
        this.stateTicks = 0;
    }

    // ==================== 道具辅助 ====================

    /**
     * 检查是否有治疗道具
     */
    _hasHealingItem(self) {
        const inv = self.inventory;
        return inv.count('pill') > 0 ||
            inv.count('bandage') > 0 ||
            inv.count('medicalKit') > 0;
    }

    /**
     * 检查治疗道具是否冷却完毕
     */
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

    /**
     * 使用治疗道具
     */
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

    // ==================== LLM 集成 ====================

    /**
     * 尝试获取 LLM 决策（缓存 / 新请求）
     *
     * @returns {Object | null}
     */
    _tryGetLLMDecision(perception) {
        if (!isLLMEnabled()) return null;

        // 使用缓存的决策
        if (this.llmCachedDecision) {
            const cached = this.llmCachedDecision;
            this.llmCachedDecision = null; // 一次性使用
            return cached;
        }

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

        const botState = this._buildBotStateForLLM(perception);
        queryLLM(botState).then(decision => {
            if (decision) {
                this.llmCachedDecision = decision;
                // 将决策的 targetId 解析为实际目标（如果提供）
                if (decision.targetId) {
                    this._resolveLLMTarget(decision, perception);
                }
            }
        }).catch(() => {
            // 已在上层处理
        }).finally(() => {
            this.llmPending = false;
        });

        return null; // 本次 tick 不等待 LLM，下次用缓存
    }

    /**
     * 构建发送给 LLM 的游戏状态
     */
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
            currentAction: this.state,
        };
    }

    /**
     * 将 LLM 返回的 targetId 解析为感知中的实际目标引用
     */
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
