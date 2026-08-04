import HERODATAS from '../../../assets/data/heros/index.js';
import Vec2 from '../../../utils/vec2.js';
import { collisionLeft, collisionRight, collisionTop, collisionBottom } from '../../../utils/collision.js';
import Skill from '../skills/skill.js';
import getBuffClassById from '../buff/index.js';
import Inventory from '../item/inventory.js';
import { ITEM_CONFIG } from '../item/itemConfig.js';
import BombEntity from '../item/bomb.js';
import FireballEntity from '../item/fireball.js';
import LandmineEntity from '../item/landmine.js';
import FragGrenadeEntity from '../item/fragGrenade.js';
import FlashBangEntity from '../item/flashBang.js';
import SmokeGrenadeEntity from '../item/smokeGrenade.js';
import PoisonDartEntity from '../item/poisonDart.js';
import FreezeTrapEntity from '../item/freezeTrap.js';
import HealingTotemEntity from '../item/healingTotem.js';

/**
 * Player — 玩家实体
 * 
 * 负责处理输入、移动、技能、开采矿物等全部玩家逻辑。
 * 
 * 按键映射：
 *   WASD    — 移动
 *   R       — 普攻（basic attack）
 *   F       — 释放当前选中的技能
 *   C       — 切换选中技能（循环 skill1 ~ skill4）
 *   E       — 靠近商店时打开商店（优先级最高）；否则靠近矿物时开采
 * 
 * 商店交互：
 * 1. 每 tick 检查是否靠近商店实体（60px）
 * 2. 玩家按下 E 键时，优先打开商店（发送 S2CShopOpen）
 * 3. 商店打开期间禁止移动
 * 4. 松开 E 键或离开商店范围时自动关闭商店
 * 
 * 开采机制：
 * 1. 每 tick 检查是否靠近矿物（30px），若靠近则设置 canMine 标志
 * 2. 玩家长按 E 键时，miningTime 逐帧累加
 * 3. miningTime 达到矿物配置的 miningTime 后，采集成功，获得金钱
 * 4. 松开 E 键则开采被打断，miningTime 清零
 * 5. 开采期间玩家不可移动
 */
class Player {
    static TICK_MS = 1000 / 20; // 每 tick 的毫秒数（20 ticks/s）

    constructor(sessionId, data) {
        this.sessionId = sessionId;
        /** @type {'A'|'B'} 玩家所属队伍 */
        this.team = data.team || 'A';
        // 队伍 A 出生点：底部基地 (1280, 6840)
        // 队伍 B 出生点：顶部基地 (1280, 360)
        this.x = this.team === 'A' ? 1280 : 1280;
        this.y = this.team === 'A' ? 6840 : 360;
        this.dir = 90; // 和移动无关，仅决定渲染方向
        this.speed = new Vec2(0, 0);
        this.knockback = new Vec2(0, 0);
        this.dx = 0;
        this.dy = 0;
        this.hitbox = {
            type: 'rect',
            x: this.x - 25,
            y: this.y - 25,
            width: 50,
            height: 50
        };
        this.hero = data.hero || 'newton';
        this.costume = 'empty';
        this.runAnimate = 0;
        this.attackForward = 0;
        this.attacking = false;

        // ---------- 多技能系统 ----------
        /** @type {number} 当前选中的技能索引：1=skill1, 2=skill2, 3=skill3, 4=skill4 */
        this.selectedSkill = 1;
        /** @type {boolean} 是否正在释放技能（带前摇） */
        this.usingSkill = false;
        /** @type {number} 技能释放剩余前摇时间（毫秒） */
        this.skillCastForward = 0;
        /** @type {Object<number, number>} 技能冷却结束时间戳 map: skillIndex → cooldownEndTimestamp */
        this.skillCooldowns = {};
        // ---------- 多技能系统 ----------

        // ---------- 矿物开采相关 ----------
        /** @type {boolean} 当前 tick 是否按下 E 键且附近有矿物 */
        this.mining = false;
        /** @type {number} 持续开采的累计时间（毫秒） */
        this.miningTime = 0;
        /** @type {boolean} 玩家附近是否存在可开采矿物 */
        this.canMine = false;
        /** @type {import('../entity/mineral.js').default|null} 当前最近的开采目标 */
        this.miningTarget = null;
        /** @type {number} 玩家经济（金钱） */
        this.money = 0;
        // ---------- 矿物开采相关 ----------

        // ---------- 商店交互相关 ----------
        /** @type {boolean} 玩家附近是否存在可交互的商店实体 */
        this.canShop = false;
        /** @type {boolean} 当前 tick 是否刚刚打开了商店（用于发送 S2CShopOpen 消息） */
        this.shopJustOpened = false;
        /** @type {boolean} 玩家是否正在浏览商店（打开商店后禁止移动，类似开采状态） */
        this.isShopOpen = false;
        /** @type {import('../entity/entity.js').default|null} 当前最近的商店实体 */
        this.shopTarget = null;
        // ---------- 商店交互相关 ----------

        // ---------- 前哨站重生点相关 ----------
        /**
         * 玩家自定义重生点（绑定到某个已被己方占领的前哨站）
         * 当玩家在己方前哨站 25px 内按 E 时设置
         * @type {import('../entity/outpost.js').default|null}
         */
        this.customSpawnOutpost = null;
        /** @type {boolean} 当前 tick 玩家附近是否有可设置重生点的前哨站 */
        this.canSetSpawn = false;
        /** @type {import('../entity/outpost.js').default|null} 最近的可设置重生点的前哨站 */
        this.spawnOutpostTarget = null;
        // ---------- 前哨站重生点相关 ----------

        this.animateState = 'idle';
        this.eventHandlers = {};
        this.eventQueue = [];

        /** @type {string[]} 当前帧已按下的按键列表（'KeyW', 'KeyA', ...） */
        this.heldKeys = [];
        /** @type {string[]} 上一帧的按键列表，用于检测按键增量（KeyC 切换技能等单次触发操作） */
        this.prevHeldKeys = [];

        this.args = HERODATAS[this.hero] || (() => { throw new Error(`Hero data not found for hero: ${this.hero}`); })();
        this.health = this.args.health;
        this.maxHealth = this.args.health;
        this.buffs = [];

        // ---------- 物品栏系统 ----------
        /** @type {Inventory} 玩家物品栏实例 */
        this.inventory = new Inventory(sessionId);
        // ---------- 物品栏系统 ----------

        // ---------- Buff/Debuff 状态标志 ----------
        /** @type {boolean} 是否被眩晕（无法移动和攻击） */
        this.stunned = false;
        /** @type {number} 当前护盾值（吸收伤害） */
        this.shield = 0;
        /** @type {number} 移动速度倍率（1.0 = 正常速度，由 SpeedBuff 设置） */
        this.speedMultiplier = 1.0;
        /** @type {number} 被减速的比例（由烟雾弹等设置，0 = 无减速，0.4 = 减速 40%） */
        this.slowAmount = 0;
        /** @type {boolean} 是否隐形（客户端据此隐藏模型） */
        this.invisible = false;
        /** @type {number} 伤害减免比例（0~1，由 InvisibleBuff 设置） */
        this.damageReduction = 0;
        /** @type {boolean} 是否被禁止攻击（隐形时） */
        this.cantAttack = false;
        // ---------- Buff/Debuff 状态标志 ----------

        /** @type {Vec2} 上一次移动方向（用于道具发射方向） */
        this.lastMoveDir = new Vec2(this.dir > 0 ? 1 : -1, 0);

        // ---------- 技能实例 ----------
        this.skills = {
            basic: new Skill(
                this.args.attacks.basic.name,
                this.args.attacks.basic.description,
                this.args.attacks.basic.damage,
                this.args.attacks.basic.knockback || 0,
                this.args.attacks.basic.forward || 0,
                null, null, null
            ),
        };
        for (let i = 1; i <= 4; i++) {
            const key = `skill${i}`;
            if (this.args.attacks[key]) {
                this.skills[key] = Skill.fromHeroData(this.args.attacks[key]);
            }
        }
        // ---------- 技能实例 ----------

        // ---------- Buff 叠加属性 ----------
        this._strengthMultiplier = 1.0;   // 伤害倍率（被 StrengthBuff 修改）
        this._reboundPercent = 0;         // 反弹比例（被 ReboundBuff 修改）
        // ---------- Buff 叠加属性 ----------

        this.on('keyboardEvent', (a) => {
            this.eventQueue.push(a);
        });
    }

    trigger(type, data) {
        if (!this.eventHandlers[type]) this.eventHandlers[type] = [];
        this.eventHandlers[type].forEach(async (_) => {
            try {
                _(data);
            } catch (_) {
                console.error(_);
            }
        });
    }

    on(type, callback) {
        if (!this.eventHandlers[type]) this.eventHandlers[type] = [];
        this.eventHandlers[type].push(callback);
    }

    // ---------- 动画 ----------
    animate() {
        if (this.speed.lengthSq() == 0) {
            this.animateState = 'idle';
            return 'idle';
        }
        this.runAnimate = (this.runAnimate + this.speed.length() / (1.41421356 * 3 * this.args.speed)) % this.args.animations.run.frames;
        return `run${Math.trunc(this.runAnimate) + 1}`;
    }

    // ---------- 输入处理 ----------

    /**
     * 消费事件队列，更新当前帧的按键状态
     * 支持两种输入模式：
     * - KeyHolding: 客户端每帧发送当前已按下的按键列表
     * - KeyDown / KeyUp: 单个按键按下/抬起事件
     */
    processEvents() {
        while (this.eventQueue.length > 0) {
            const event = this.eventQueue.shift();
            const { type, key } = event;
            if (type === 'KeyHolding') {
                // 保存最新的按键状态，供后续 processKeyholding 使用
                this.heldKeys = key;
            } else if (type === 'KeyDown') {
                // 单个按键按下：添加到 heldKeys（避免重复）
                if (!this.heldKeys.includes(key)) {
                    this.heldKeys.push(key);
                }
            } else if (type === 'KeyUp') {
                // 单个按键抬起：从 heldKeys 中移除
                this.heldKeys = this.heldKeys.filter(k => k !== key);
            }
        }
    }

    /**
     * 根据当前按键状态更新移动方向 / 攻击 / 技能 / 开采标记
     * 
     * 每 tick 都会调用（而非仅在收到事件时），
     * 确保按键状态在无新事件时也能正确维持。
     */
    processKeyholding() {
        this.dx = this.dy = 0;
        const wasAttacking = this.attacking;
        this.attacking = false;

        // 重置开采状态：如果 E 键不在当前按键列表中，开采被打断
        this.mining = false;

        const key = this.heldKeys || [];
        const prevKey = this.prevHeldKeys || [];

        // ---- 眩晕状态下跳过所有输入 ----
        if (this.stunned) {
            this.prevHeldKeys = [...key];
            return;
        }

        // ---- 单次触发的按键（仅在首次按下时触发） ----
        // C 键：切换技能（仅在新按下时触发，防止每 tick 反复切换）
        if (key.includes('KeyC') && !prevKey.includes('KeyC')) {
            const available = this.getAvailableSkills();
            if (available.length > 0) {
                const currentIdx = available.indexOf(this.selectedSkill);
                const nextIdx = (currentIdx + 1) % available.length;
                this.selectedSkill = available[nextIdx];
                console.log(
                    `[Skill] ${this.sessionId} switched to skill ${this.selectedSkill} ` +
                    `(${this.getSkillData(this.selectedSkill)?.name || 'unknown'})`
                );
            }
        }

        // ---- 道具快捷键（数字键 1-0 对应物品栏 1-10 号位） ----
        const digitKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
                          'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
        for (let slotIdx = 0; slotIdx < digitKeys.length; slotIdx++) {
            const dk = digitKeys[slotIdx];
            if (key.includes(dk) && !prevKey.includes(dk)) {
                this._useItemBySlot(slotIdx);
            }
        }

        for (const k of key) {
            switch (k) {
                case 'KeyW':
                    this.dy = 1;
                    break;
                case 'KeyS':
                    this.dy = -1;
                    break;
                case 'KeyA':
                    this.dx = -1;
                    this.dir = -90;
                    break;
                case 'KeyD':
                    this.dx = 1;
                    this.dir = 90;
                    break;
                case 'KeyR':
                    // 普攻 — 仅在未释放技能且未被禁止攻击时允许
                    if (!this.usingSkill && !this.cantAttack && this.isBasicReady()) {
                        this.attacking = true;
                        if (!wasAttacking) {
                            this.attackForward = this.args.attacks.basic.forward || 0;
                        }
                    }
                    break;
                case 'KeyF':
                    // 释放当前选中技能 — 仅在未攻击且未被禁止攻击时允许
                    if (!this.attacking && !this.usingSkill && !this.cantAttack) {
                        const skillKey = `skill${this.selectedSkill}`;
                        if (this.isSkillReady(this.selectedSkill)) {
                            const skillData = this.args.attacks[skillKey];
                            if (skillData) {
                                // 检查金钱消耗
                                if ((skillData.cost || 0) <= this.money) {
                                    this.money -= (skillData.cost || 0);
                                    this.usingSkill = true;
                                    this.skillCastForward = skillData.forward || 0;
                                    // 记录冷却
                                    this.skillCooldowns[this.selectedSkill] = Date.now();
                                }
                            }
                        }
                    }
                    break;
                case 'KeyE':
                    // 优先级1：商店 — 靠近商店时 E 键打开商店
                    if (this.canShop && this.shopTarget) {
                        // 仅在首次按下或未打开商店时触发打开
                        if (!this.isShopOpen) {
                            this.isShopOpen = true;
                            this.shopJustOpened = true;
                        }
                        // 已打开商店后继续按 E 不做额外操作（防止反复开关）
                    }
                    // 优先级2：前哨站 — 靠近己方占领的前哨站 25px 内按 E 设置重生点
                    else if (this.canSetSpawn && this.spawnOutpostTarget) {
                        this.spawnOutpostTarget.setSpawn(this);
                    }
                    // 优先级3：采矿 — 没有商店/前哨站时，E 键正常采矿
                    else if (this.canMine && this.miningTarget && !this.miningTarget.collected) {
                        this.mining = true;
                    }
                    break;
            }
        }

        // 松开 E 键或失去开采/商店目标时，重置状态
        if (!this.mining) {
            this.miningTime = 0;
        }
        // 若 E 键未按下，关闭商店
        if (!key.includes('KeyE')) {
            this.isShopOpen = false;
        }

        // 保存当前帧按键状态供下一帧比较
        this.prevHeldKeys = [...key];
    }

    // ---------- 技能辅助方法 ----------

    /**
     * 获取技能数据
     * @param {number} skillIndex - 1~4
     */
    getSkillData(skillIndex) {
        return this.args.attacks[`skill${skillIndex}`] || null;
    }

    /**
     * 获取可用的技能列表（排除 basic）
     * @returns {number[]}
     */
    getAvailableSkills() {
        const skills = [];
        for (let i = 1; i <= 4; i++) {
            if (this.args.attacks[`skill${i}`]) {
                skills.push(i);
            }
        }
        return skills;
    }

    /**
     * 检查普攻是否冷却完毕
     */
    isBasicReady() {
        const basic = this.args.attacks.basic;
        if (!basic || !basic.cd) return true;
        const lastUsed = this.skillCooldowns[0]; // 0 = basic attack
        if (!lastUsed) return true;
        return Date.now() - lastUsed >= basic.cd;
    }

    /**
     * 检查指定技能是否冷却完毕
     * @param {number} skillIndex - 1~4
     */
    isSkillReady(skillIndex) {
        const skillData = this.getSkillData(skillIndex);
        if (!skillData) return false;
        const lastUsed = this.skillCooldowns[skillIndex];
        if (!lastUsed) return true;
        return Date.now() - lastUsed >= skillData.cd;
    }

    /**
     * 获取技能剩余冷却时间（毫秒）
     * @param {number} skillIndex - 1~4
     * @returns {number} 剩余冷却 ms，若已就绪返回 0
     */
    getSkillCooldownRemaining(skillIndex) {
        const skillData = this.getSkillData(skillIndex);
        if (!skillData) return Infinity;
        const lastUsed = this.skillCooldowns[skillIndex];
        if (!lastUsed) return 0;
        const remaining = skillData.cd - (Date.now() - lastUsed);
        return Math.max(0, remaining);
    }

    // ---------- 矿物开采 ----------

    /**
     * 更新矿物接近检测
     * 
     * 检查玩家与所有矿物的距离，在 30px 以内则设置 canMine 标志
     * 并记录最近的可开采目标。
     * 
     * @param {import('../world.js').default} world - 世界实例
     */
    updateMiningProximity(world) {
        this.canMine = false;
        this.miningTarget = null;

        for (const mineral of world.minerals) {
            if (mineral.isPlayerNear(this.x, this.y)) {
                this.canMine = true;
                this.miningTarget = mineral;
                break; // 取第一个在范围内的矿物
            }
        }

        // 如果失去目标（矿物被采完或玩家走远），打断开采
        if (!this.canMine && this.mining) {
            this.mining = false;
            this.miningTime = 0;
        }
    }

    /**
     * 更新商店接近检测
     *
     * 检查玩家是否在商店实体的交互范围内。
     * 若离开范围则关闭商店并重置相关状态。
     *
     * @param {import('../world.js').default} world - 世界实例
     */
    updateShopProximity(world) {
        const nearbyShop = world.getNearbyShop(this.x, this.y);

        if (nearbyShop) {
            this.canShop = true;
            this.shopTarget = nearbyShop;
        } else {
            // 离开商店范围时自动关闭商店
            this.canShop = false;
            this.shopTarget = null;
            this.isShopOpen = false;
            this.shopJustOpened = false;
        }
    }

    /**
     * 更新前哨站重生点接近检测
     *
     * 检查玩家是否在己方占领的前哨站 25px 范围内。
     * 若在范围内则标记 canSetSpawn，供 E 键处理使用。
     * 若离开范围则重置相关标志。
     *
     * @param {import('../world.js').default} world - 世界实例
     */
    updateOutpostProximity(world) {
        const nearbyOutpost = world.getNearbySpawnOutpost(this.x, this.y, this.team);

        if (nearbyOutpost) {
            this.canSetSpawn = true;
            this.spawnOutpostTarget = nearbyOutpost;
        } else {
            this.canSetSpawn = false;
            this.spawnOutpostTarget = null;
        }

        // 若玩家已绑定的前哨站不再有效（被敌方占领），清除自定义重生点
        if (this.customSpawnOutpost && !this.customSpawnOutpost.isSpawnValid(this)) {
            console.log(
                `[Outpost] ${this.sessionId} 的自定义重生点失效 ` +
                `(前哨站 ${this.customSpawnOutpost.data.id} 已不再被己方占领)`
            );
            this.customSpawnOutpost = null;
        }
    }

    /**
     * 处理开采进度
     * 
     * 当玩家正在开采（E 按住 + 附近有矿物）时，
     * 每 tick 累加 miningTime，达到阈值后完成采集。
     */
    processMining() {
        if (!this.mining || !this.miningTarget || !this.miningTarget.config) return;

        // 安全检查：目标可能在两次 tick 间被其他玩家采集
        if (this.miningTarget.collected) {
            this.mining = false;
            this.miningTime = 0;
            this.canMine = false;
            this.miningTarget = null;
            return;
        }

        // 累加开采时间（每 tick 50ms）
        this.miningTime += Player.TICK_MS;

        const required = this.miningTarget.config.miningTime;

        // 开采完成
        if (this.miningTime >= required) {
            const reward = this.miningTarget.config.money;
            this.money += reward;
            this.miningTarget.collect();
            console.log(
                `[Mineral] Player ${this.sessionId} mined ${this.miningTarget.mineralType}, ` +
                `earned +${reward} money (total: ${this.money})`
            );

            // 重置开采状态
            this.mining = false;
            this.miningTime = 0;
            this.canMine = false;
            this.miningTarget = null;
        }
    }

    // ---------- 移动 ----------

    move(world) {
        // 开采期间或技能前摇期间或眩晕期间或商店打开时禁止移动，同时刹车惯性速度
        if (this.mining || this.usingSkill || this.stunned || this.isShopOpen) {
            this.speed.set(0, 0);
            return;
        }

        // 计算最终速度倍率：SpeedBuff 乘数 × (1 - 烟雾减速)
        const speedMult = this.speedMultiplier * (1 - (this.slowAmount || 0));

        const kb = this.knockback.lengthSq();
        if (this.dx && kb <= 16) this.speed.x = this.dx * this.args.speed * speedMult;
        if (this.dy && kb <= 16) this.speed.y = this.dy * this.args.speed * speedMult;

        // 记录移动方向（用于道具发射）
        if (this.speed.lengthSq() > 0.01) {
            this.lastMoveDir = this.speed.normalized().clone();
        }
        if (this.speed.lengthSq() <= 0.09) {
            this.speed = new Vec2(0, 0);
        }
        this.speed.add(this.knockback);
        this.knockback.scale(0.9);
        for (const wall of world.walls) {
            if (!this.hitbox || !wall?.hitbox) continue;
            if (collisionLeft(this.hitbox, wall.hitbox, this.speed)) {
                this.speed.x = 0;
            }
            if (collisionRight(this.hitbox, wall.hitbox, this.speed)) {
                this.speed.x = 0;
            }
        }
        for (const wall of world.walls) {
            if (!this.hitbox || !wall?.hitbox) continue;
            if (collisionTop(this.hitbox, wall.hitbox, this.speed)) {
                this.speed.y = 0;
            }
            if (collisionBottom(this.hitbox, wall.hitbox, this.speed)) {
                this.speed.y = 0;
            }
        }
        this.x += this.speed.x;
        this.y += this.speed.y;
        this.speed.scale(kb > 16 ? 0.95 : 0.85);
        this.hitbox.x = this.x - 25;
        this.hitbox.y = this.y - 25;
    }

    // ---------- 战斗 ----------

    /**
     * 查找最近的低血量敌人（75px 范围内）
     * 优先血量最低者，同等血量优先距离最近者
     */
    findTarget(players) {
        let bestTarget = null;
        let bestHealth = Infinity;
        let bestDistance = Infinity;

        for (const [id, player] of Object.entries(players)) {
            if (id === this.sessionId) continue;
            if (player.team === this.team) continue; // 忽略队友

            const dist = Math.hypot(this.x - player.x, this.y - player.y);
            if (dist > 75) continue;

            const health = player.health;
            if (health < bestHealth || (health === bestHealth && dist < bestDistance)) {
                bestTarget = player;
                bestHealth = health;
                bestDistance = dist;
            }
        }

        return bestTarget;
    }

    /**
     * 查找范围内所有敌人（用于 AOE）
     * @param {number} range - 溅射范围（像素）
     */
    findTargetsInRange(players, range) {
        const targets = [];
        for (const [id, player] of Object.entries(players)) {
            if (id === this.sessionId) continue;
            if (player.team === this.team) continue; // 忽略队友
            const dist = Math.hypot(this.x - player.x, this.y - player.y);
            if (dist <= range) {
                targets.push({ player, dist });
            }
        }
        return targets;
    }

    /**
     * 处理普攻
     * 前摇计时 → 计时归零时命中目标
     */
    processBasicAttack(players) {
        if (!this.attacking) return;

        // 使用 TICK_MS 进行时间衰减，而非固定 0.1
        this.attackForward = Math.max(0, this.attackForward - Player.TICK_MS);

        if (this.attackForward <= 0) {
            this.attacking = false;

            // 记录冷却
            this.skillCooldowns[0] = Date.now();

            const target = this.findTarget(players);
            if (target) {
                const damage = this.args.attacks.basic.damage * this._strengthMultiplier;
                target.takeDamage(damage, this);

                const knockback = this.args.attacks.basic.knockback;
                if (knockback) {
                    const direction = new Vec2(target.x - this.x, target.y - this.y).normalize();
                    target.takeKnockback(direction.scale(knockback));
                }

                console.log(
                    `[Combat] ${this.sessionId} basic attacked ${target.sessionId} ` +
                    `for ${Math.round(damage)} damage (multiplier: ${this._strengthMultiplier.toFixed(1)})`
                );
            }
        }
    }

    /**
     * 处理技能释放
     * 前摇计时 → 计时归零时释放技能效果
     */
    processSkillCast(players) {
        if (!this.usingSkill) return;

        // 使用 TICK_MS 进行时间衰减
        this.skillCastForward = Math.max(0, this.skillCastForward - Player.TICK_MS);

        if (this.skillCastForward <= 0) {
            this.usingSkill = false;

            const skillKey = `skill${this.selectedSkill}`;
            const skillInstance = this.skills[skillKey];
            const skillData = this.getSkillData(this.selectedSkill);

            if (!skillInstance || !skillData) return;

            const target = this.findTarget(players);

            // 对主目标施加技能效果
            if (target) {
                skillInstance.onUse(this, target);
                console.log(
                    `[Combat] ${this.sessionId} used ${skillData.name} ` +
                    `on ${target.sessionId} for ${skillData.damage || 0} damage`
                );
            }

            // 处理 AOE 溅射伤害（如 skill3 的 magic 配置）
            if (skillData.magic && skillData.magic.range) {
                const aoeTargets = this.findTargetsInRange(players, skillData.magic.range);
                for (const { player } of aoeTargets) {
                    // 跳过主目标（已被 onUse 处理过）
                    if (player === target) continue;

                    player.takeDamage(skillData.magic.damage || 0, this);

                    if (skillData.magic.knockback) {
                        const direction = new Vec2(
                            player.x - this.x,
                            player.y - this.y
                        ).normalize();
                        player.takeKnockback(direction.scale(skillData.magic.knockback));
                    }

                    console.log(
                        `[Combat] ${this.sessionId}'s ${skillData.name} ` +
                        `splashed ${player.sessionId} for ${skillData.magic.damage || 0} AOE damage`
                    );
                }
            }

            // 处理 buff（施加给自身），当 onUse 因无目标而跳过自身 buff 时，此处补上
            if (skillData.buff && !target) {
                for (const buffData of skillData.buff) {
                    const BuffClass = getBuffClassById(buffData.id);
                    const buffInstance = new BuffClass(buffData);
                    this.giveBuff(buffInstance);
                }
            }
        }
    }

    /**
     * 统一技能处理入口（兼容旧名称）
     */
    processSkills(players) {
        this.processBasicAttack(players);
        this.processSkillCast(players);
    }

    // ---------- Buff 系统 ----------

    processBuffs() {
        const active = [];
        // 重置 buff 叠加属性（会在 tick 中被重新设置）
        this._strengthMultiplier = 1.0;
        this._reboundPercent = 0;
        this.stunned = false;
        this.invisible = false;
        this.cantAttack = false;
        this.speedMultiplier = 1.0;
        this.slowAmount = 0;
        // 注意：damageReduction 在 InvisibleBuff 的 tick 中设置，这里不重置
        // shield 由 ShieldBuff 的 onExpire 管理，这里不重置

        for (const buff of this.buffs) {
            if (buff.isExpired()) {
                // Buff 过期：调用 onExpire 回调后移除
                if (buff.onExpire) {
                    buff.onExpire(this);
                }
                // 不加入 active，即丢弃
                continue;
            }
            // Buff 仍有效：调用 tick 并保留
            if (buff.tick) {
                buff.tick(this);
            }
            active.push(buff);
        }
        this.buffs = active;
    }

    // ---------- 网络同步 ----------

    remoteData() {
        // 构建技能状态信息（供客户端 UI 展示）
        const skillStates = {};
        for (let i = 1; i <= 4; i++) {
            const skillData = this.getSkillData(i);
            if (skillData) {
                skillStates[i] = {
                    name: skillData.name,
                    cd: skillData.cd || 0,
                    cost: skillData.cost || 0,
                    remaining: this.getSkillCooldownRemaining(i),
                    ready: this.isSkillReady(i),
                };
            }
        }

        return {
            type: 'update',
            x: this.x,
            y: this.y,
            asset: this.costume,
            isShowed: true,
            id: this.sessionId,
            scale: 100,
            dir: this.dir,
            state: {
                health: this.health,
                maxHealth: this.maxHealth,
                money: this.money,
                mining: this.mining,
                miningTime: this.miningTime,
                canMine: this.canMine,
                /** 玩家是否在可交互商店附近 */
                canShop: this.canShop,
                /** 玩家是否已打开商店 UI */
                isShopOpen: this.isShopOpen,
                /** 玩家附近是否有可设置重生点的前哨站（25px 内 + 己方占领） */
                canSetSpawn: this.canSetSpawn,
                /** 玩家当前绑定的自定义重生点前哨站 ID（null 表示无） */
                spawnOutpostId: this.customSpawnOutpost ? this.customSpawnOutpost.data.id : null,
                selectedSkill: this.selectedSkill,
                casting: this.usingSkill,
                skillStates: skillStates,
                basicReady: this.isBasicReady(),
                needToPredict: true,
                team: this.team,
                speed: JSON.stringify({ x: this.speed.x, y: this.speed.y }),
                buffs: this.buffs.map(b => ({
                    id: b.id,
                    level: b.level,
                    remaining: b.getRemainingTime(),
                })),
                // 新增道具/物品栏相关状态
                inventory: this.inventory ? this.inventory.serialize() : [],
                shield: this.shield || 0,
                invisible: this.invisible || false,
                stunned: this.stunned || false,
                channelingTeleport: this.inventory ? this.inventory.isChannelingTeleport : false,
                teleportRemaining: this.inventory ? this.inventory.teleportChannelRemaining : 0,
            },
            fz: 1,
            "z-index": 1000
        };
    }

    // ---------- 主 tick ----------

    /**
     * 每帧主更新入口
     * 
     * 执行顺序：
     * 1. 消费事件 → 2. 附近检测（商店/矿物）→ 3. 解析按键
     * 4. 开采进度 → 5. 移动 → 6. 技能 → 7. Buff → 8. 动画
     */
    tick(players, world) {
        this.dx = this.dy = 0;

        // 存储 world 和 players 引用，供键盘快捷键使用道具时使用
        this._worldRef = world;
        this._playersRef = players;

        this.processEvents();
        // 先进行附近检测，确保本 tick 按键处理时 canShop/canMine/canSetSpawn 已是最新状态
        this.updateMiningProximity(world);
        this.updateShopProximity(world);
        this.updateOutpostProximity(world);
        this.processKeyholding();
        this.processMining();
        this.move(world);
        this.processSkills(players);
        this.processBuffs();
        this.processTeleportChannel();   // 回城卷轴引导
        this.costume = `${this.hero}_${this.animate()}`;
    }

    render(f) {
        let entities = f(this.x, this.y, 320, 180);
        let renderData = [];
        for (let i of entities) {
            const t = {
                ...i.getData(),
                type: 'update',
            };
            renderData.push(t);
        }
        const selfdata = [this.remoteData()];
        return [
            ...selfdata,
            ...renderData
        ];
    }

    /**
     * 受到伤害
     * 处理顺序：护盾吸收 → 伤害减免 → 反弹 → 扣除生命
     * @param {number} amount - 伤害值
     * @param {Player} [attacker] - 攻击者（用于反弹计算）
     */
    takeDamage(amount, attacker) {
        let finalAmount = amount;

        // ----- 护盾吸收 -----
        if (this.shield > 0 && finalAmount > 0) {
            const absorbed = Math.min(this.shield, finalAmount);
            this.shield -= absorbed;
            finalAmount -= absorbed;
            if (absorbed > 0) {
                console.log(
                    `[Combat] ${this.sessionId} 护盾吸收了 ${absorbed} 伤害, ` +
                    `剩余护盾: ${this.shield}`
                );
            }
        }

        // ----- 伤害减免（隐形等） -----
        if (this.damageReduction > 0 && finalAmount > 0) {
            finalAmount = Math.round(finalAmount * (1 - this.damageReduction));
        }

        // ----- 反弹伤害 -----
        if (attacker && this._reboundPercent > 0 && finalAmount > 0) {
            const reflected = finalAmount * this._reboundPercent;
            if (reflected > 0) {
                attacker.takeDamage(Math.round(reflected));
                console.log(
                    `[Combat] ${this.sessionId} reflected ${Math.round(reflected)} damage ` +
                    `back to ${attacker.sessionId} (${(this._reboundPercent * 100).toFixed(0)}%)`
                );
            }
        }

        // ----- 扣除生命 -----
        this.health -= finalAmount;
        if (this.health <= 0) {
            this.health = 0;
            console.log(`Player ${this.sessionId} has died.`);
            this.onDeath();
        }
    }

    /**
     * 玩家死亡处理：优先使用前哨站自定义重生点，否则传送回基地
     */
    onDeath() {
        // 检查是否有有效的前哨站自定义重生点
        if (this.customSpawnOutpost && this.customSpawnOutpost.isSpawnValid(this)) {
            const outpost = this.customSpawnOutpost;
            this.x = outpost.data.x;
            this.y = outpost.data.y;
            console.log(
                `[Outpost] ${this.sessionId} 在前哨站 ${outpost.data.id} 重生 ` +
                `(${this.x.toFixed(0)}, ${this.y.toFixed(0)})`
            );
        } else {
            // 默认回基地
            this.x = this.team === 'A' ? 1280 : 1280;
            this.y = this.team === 'A' ? 6840 : 360;
            // 清除失效的引用
            this.customSpawnOutpost = null;
        }
        // 更新碰撞盒
        this.hitbox.x = this.x - 25;
        this.hitbox.y = this.y - 25;
        this.health = this.args.health;
        this.speed.set(0, 0);
        this.knockback.set(0, 0);
        this.buffs = [];
        this._strengthMultiplier = 1.0;
        this._reboundPercent = 0;
        this.stunned = false;
        this.shield = 0;
        this.speedMultiplier = 1.0;
        this.slowAmount = 0;
        this.invisible = false;
        this.cantAttack = false;
        this.damageReduction = 0;
        // 重置商店状态（死亡时强制关闭商店）
        this.isShopOpen = false;
        this.shopJustOpened = false;
        this.canShop = false;
        this.shopTarget = null;
        // 死亡不清空物品栏（保留道具）
        // 如果希望死亡掉落，可取消下面注释：
        // this.inventory.clear();
    }

    giveBuff(buff) {
        this.buffs.push(buff);
        if (buff.onApply) {
            buff.onApply(this);
        }
    }

    takeKnockback(knockbackVector) {
        this.knockback.add(knockbackVector);
    }

    // ======================== 道具使用系统 ========================

    /**
     * 获取玩家面朝方向（单位向量）
     * 优先使用最近一次移动方向，其次根据 dir 判断左右
     * @returns {Vec2}
     */
    getFacingDirection() {
        if (this.lastMoveDir && this.lastMoveDir.lengthSq() > 0.001) {
            return this.lastMoveDir.clone();
        }
        // 静止时根据 dir 判断：90 = 右, -90 = 左
        return new Vec2(this.dir > 0 ? 1 : -1, 0);
    }

    /**
     * 通过物品栏槽位使用道具（快捷键 1-0 触发）
     * @param {number} slotIndex - 槽位索引 0-9
     * @returns {boolean} 是否成功使用
     */
    _useItemBySlot(slotIndex) {
        const sortedItems = this.inventory.serialize();
        if (slotIndex >= sortedItems.length) return false;

        const itemData = sortedItems[slotIndex];
        if (!itemData || itemData.count <= 0) return false;

        return this.useItem(itemData.itemId);
    }

    /**
     * 使用指定道具
     * @param {string} itemId - 道具 ID
     * @param {Object} [options] - 可选参数
     * @param {import('../world.js').default} [options.world]
     * @param {Object<string, Player>} [options.players]
     * @returns {boolean} 是否成功使用
     */
    useItem(itemId, options = {}) {
        const config = ITEM_CONFIG[itemId];
        if (!config) {
            console.warn(`[ItemUse] ${this.sessionId}: 未知道具 ${itemId}`);
            return false;
        }

        if (this.inventory.count(itemId) <= 0) {
            console.log(`[ItemUse] ${this.sessionId}: 没有道具 ${config.name}`);
            return false;
        }

        if (!this.inventory.usesCooledDown(itemId)) {
            const remaining = this.inventory.getItemCdRemaining(itemId);
            console.log(`[ItemUse] ${this.sessionId}: 道具 ${config.name} 冷却中, 剩余 ${remaining}ms`);
            return false;
        }

        let success = false;
        // 若未传入 world/players，使用 tick 中存储的引用
        const effectiveWorld = world || this._worldRef;
        const effectivePlayers = players || this._playersRef;

        switch (config.type) {
            case 'consumable': success = this._useConsumable(config); break;
            case 'placeable': success = this._usePlaceable(config, effectiveWorld); break;
            case 'projectile': success = this._useProjectile(config, effectiveWorld); break;
            case 'utility': success = this._useUtility(config); break;
            default:
                console.warn(`[ItemUse] 未知道具类型: ${config.type}`);
                return false;
        }

        if (success) {
            this.inventory.remove(itemId, 1);
            this.inventory.setItemCooldown(itemId);
            console.log(`[ItemUse] ${this.sessionId} 使用了 ${config.name}, 剩余 ${this.inventory.count(itemId)} 个`);
        }

        return success;
    }

    /**
     * 使用消耗品：直接治疗
     * @private
     */
    _useConsumable(config) {
        const healAmount = config.data.healAmount || 0;
        if (healAmount <= 0) return false;
        const oldHealth = this.health;
        this.health = Math.min(this.maxHealth, this.health + healAmount);
        console.log(`[ItemUse] ${this.sessionId} 使用 ${config.name}, 回复 ${this.health - oldHealth} HP (${this.health}/${this.maxHealth})`);
        return true;
    }

    /**
     * 使用放置物：在脚下创建道具实体
     * @private
     */
    _usePlaceable(config, world) {
        if (!world) { console.warn(`[ItemUse] _usePlaceable 需要 world 参数`); return false; }
        const data = config.data;
        let entity = null;
        switch (config.id) {
            case 'bomb': entity = new BombEntity(this.x, this.y, data, this.sessionId); break;
            case 'landmine': entity = new LandmineEntity(this.x, this.y, data, this.sessionId, this.team); break;
            case 'fragGrenade': entity = new FragGrenadeEntity(this.x, this.y, data, this.sessionId); break;
            case 'smokeGrenade': entity = new SmokeGrenadeEntity(this.x, this.y, data, this.sessionId, this.team); break;
            case 'freezeTrap': entity = new FreezeTrapEntity(this.x, this.y, data, this.sessionId, this.team); break;
            case 'healingTotem': entity = new HealingTotemEntity(this.x, this.y, data, this.sessionId, this.team); break;
            default: console.warn(`[ItemUse] 未处理的放置物类型: ${config.id}`); return false;
        }
        if (entity) {
            world.addItemEntity(entity);
            console.log(`[ItemUse] ${this.sessionId} 放置 ${config.name} 于 (${this.x.toFixed(0)}, ${this.y.toFixed(0)})`);
            return true;
        }
        return false;
    }

    /**
     * 使用投射物：发射飞行道具
     * @private
     */
    _useProjectile(config, world) {
        if (!world) { console.warn(`[ItemUse] _useProjectile 需要 world 参数`); return false; }
        const data = config.data;
        const direction = this.getFacingDirection();
        let entity = null;
        switch (config.id) {
            case 'fireball': entity = new FireballEntity(this.x, this.y, direction, data, this.sessionId); break;
            case 'flashBang': entity = new FlashBangEntity(this.x, this.y, direction, data, this.sessionId); break;
            case 'poisonDart': entity = new PoisonDartEntity(this.x, this.y, direction, data, this.sessionId); break;
            default: console.warn(`[ItemUse] 未处理的投射物类型: ${config.id}`); return false;
        }
        if (entity) {
            world.addItemEntity(entity);
            console.log(`[ItemUse] ${this.sessionId} 发射 ${config.name} 方向 (${direction.x.toFixed(2)}, ${direction.y.toFixed(2)})`);
            return true;
        }
        return false;
    }

    /**
     * 使用功能道具：应用 buff 或特殊效果
     * @private
     */
    _useUtility(config) {
        const data = config.data;
        switch (config.id) {
            case 'teleportScroll': {
                if (this.inventory.isChannelingTeleport) {
                    console.log(`[ItemUse] ${this.sessionId}: 已在引导回城中`);
                    return false;
                }
                this.inventory.isChannelingTeleport = true;
                this.inventory.teleportChannelRemaining = data.channelTime || 5000;
                console.log(`[ItemUse] ${this.sessionId} 开始引导回城, 需要 ${this.inventory.teleportChannelRemaining}ms`);
                return true;
            }
            case 'speedPotion': {
                const SpeedBuffClass = getBuffClassById('speed');
                this.giveBuff(new SpeedBuffClass({ id: 'speed', level: Math.round(data.speedBoost * 100), time: data.duration || 8000 }));
                return true;
            }
            case 'invisibleCloak': {
                const InvisibleBuffClass = getBuffClassById('invisible');
                this.giveBuff(new InvisibleBuffClass({ id: 'invisible', level: Math.round(data.dmgReduction * 100), time: data.duration || 4000 }));
                return true;
            }
            case 'shieldStone': {
                const ShieldBuffClass = getBuffClassById('shield');
                this.giveBuff(new ShieldBuffClass({ id: 'shield', level: data.shieldAmount || 500, time: data.duration || 10000 }));
                return true;
            }
            case 'thornArmor': {
                const ReboundBuffClass = getBuffClassById('rebound');
                this.giveBuff(new ReboundBuffClass({ id: 'rebound', level: data.reflectPercent || 30, time: data.duration || 6000 }));
                return true;
            }
            default:
                console.warn(`[ItemUse] 未处理的功能道具类型: ${config.id}`);
                return false;
        }
    }

    /**
     * 处理回城卷轴引导（每 tick 调用）
     * 检查引导进度和中断条件
     */
    processTeleportChannel() {
        const inv = this.inventory;
        if (!inv.isChannelingTeleport) return;

        // 移动中断引导
        if (this.dx !== 0 || this.dy !== 0) {
            console.log(`[Teleport] ${this.sessionId}: 移动中断回城引导`);
            inv.isChannelingTeleport = false;
            inv.teleportChannelRemaining = 0;
            return;
        }

        inv.teleportChannelRemaining -= Player.TICK_MS;

        if (inv.teleportChannelRemaining <= 0) {
            inv.isChannelingTeleport = false;
            inv.teleportChannelRemaining = 0;
            this.x = this.team === 'A' ? 1280 : 1280;
            this.y = this.team === 'A' ? 6840 : 360;
            this.hitbox.x = this.x - 25;
            this.hitbox.y = this.y - 25;
            this.speed.set(0, 0);
            this.knockback.set(0, 0);
            console.log(`[Teleport] ${this.sessionId} 回城成功 → (${this.x.toFixed(0)}, ${this.y.toFixed(0)})`);
        }
    }
}

export default Player;
