import HERODATAS from '../../../assets/data/heros/index.js';
import Vec2 from '../../../utils/vec2.js';
import { collisionLeft, collisionRight, collisionTop, collisionBottom } from '../../../utils/collision.js';
import Skill from '../skills/skill.js';
import getBuffClassById from '../buff/index.js';

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
 *   E       — 开采矿物
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
        this.x = 0;
        this.y = 0;
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
        this.runAnimate = (this.runAnimate + this.speed.length() / (1.41421356 * this.args.speed)) % this.args.animations.run.frames;
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
                    // 普攻 — 仅在未释放技能时允许
                    if (!this.usingSkill && this.isBasicReady()) {
                        this.attacking = true;
                        if (!wasAttacking) {
                            this.attackForward = this.args.attacks.basic.forward || 0;
                        }
                    }
                    break;
                case 'KeyF':
                    // 释放当前选中技能 — 仅在未攻击时允许
                    if (!this.attacking && !this.usingSkill) {
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
                    // 仅在附近有可开采的矿物时才进入开采状态
                    if (this.canMine && this.miningTarget && !this.miningTarget.collected) {
                        this.mining = true;
                    }
                    break;
            }
        }

        // 松开 E 键或失去开采目标时，重置开采进度
        if (!this.mining) {
            this.miningTime = 0;
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
        // 开采期间或技能前摇期间禁止移动，同时刹车惯性速度
        if (this.mining || this.usingSkill) {
            this.speed.set(0, 0);
            return;
        }

        const kb = this.knockback.lengthSq();
        if (this.dx && kb <= 16) this.speed.x = this.dx * this.args.speed;
        if (this.dy && kb <= 16) this.speed.y = this.dy * this.args.speed;
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
                selectedSkill: this.selectedSkill,
                casting: this.usingSkill,
                skillStates: skillStates,
                basicReady: this.isBasicReady(),
                needToPridict: true,
            },
            fz: 1
        };
    }

    // ---------- 主 tick ----------

    /**
     * 每帧主更新入口
     * 
     * 执行顺序：
     * 1. 消费事件 → 2. 解析按键 → 3. 矿物接近检测
     * 4. 开采进度 → 5. 移动 → 6. 技能 → 7. Buff → 8. 动画
     */
    tick(players, world) {
        this.processEvents();
        this.processKeyholding();
        this.updateMiningProximity(world);
        this.processMining();
        this.move(world);
        this.processSkills(players);
        this.processBuffs();
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
     * @param {number} amount - 伤害值
     * @param {Player} [attacker] - 攻击者（用于反弹计算）
     */
    takeDamage(amount, attacker) {
        // 反弹伤害：将 _reboundPercent 比例的伤害返回给攻击者
        if (attacker && this._reboundPercent > 0 && amount > 0) {
            const reflected = amount * this._reboundPercent;
            if (reflected > 0) {
                attacker.takeDamage(Math.round(reflected));
                console.log(
                    `[Combat] ${this.sessionId} reflected ${Math.round(reflected)} damage ` +
                    `back to ${attacker.sessionId} (${(this._reboundPercent * 100).toFixed(0)}%)`
                );
            }
        }

        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            console.log(`Player ${this.sessionId} has died.`);
            this.onDeath();
        }
    }

    /**
     * 玩家死亡处理：传送回出生点并重置状态
     */
    onDeath() {
        this.x = 0;
        this.y = 0;
        // 更新碰撞盒
        this.hitbox.x = this.x - 25;
        this.hitbox.y = this.y - 25;
        this.health = this.args.health;
        this.speed.set(0, 0);
        this.knockback.set(0, 0);
        this.buffs = [];
        this._strengthMultiplier = 1.0;
        this._reboundPercent = 0;
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
}

export default Player;
