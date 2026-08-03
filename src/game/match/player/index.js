import HERODATAS from '../../../assets/data/heros/index.js';
import Vec2 from '../../../utils/vec2.js';
import { collisionLeft, collisionRight, collisionTop, collisionBottom } from '../../../utils/collision.js';

/**
 * Player — 玩家实体
 * 
 * 负责处理输入、移动、技能、开采矿物等全部玩家逻辑。
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

        // ---------- 矿物开采相关 ----------
        /** @type {boolean} 当前 tick 是否按下 E 键且附近有矿物 */
        this.mining = false;
        /** @type {number} 持续开采的累计时间（毫秒） */
        this.miningTime = 0;
        /** @type {boolean} 玩家附近是否存在可开采矿物 */
        this.canMine = false;
        /** @type {import('./entity/mineral.js').default|null} 当前最近的开采目标 */
        this.miningTarget = null;
        /** @type {number} 玩家经济（金钱） */
        this.money = 0;
        // ---------- 矿物开采相关 ----------

        this.animateState = 'idle';
        this.eventHandlers = {};
        this.eventQueue = [];

        /** @type {string[]} 当前帧已按下的按键列表（'KeyW', 'KeyA', ...） */
        this.heldKeys = [];

        this.args = HERODATAS[this.hero] || (() => { throw new Error(`Hero data not found for hero: ${this.hero}`); })();
        this.health = this.args.health;
        this.buffs = [];
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
     */
    processEvents() {
        while (this.eventQueue.length > 0) {
            const { type, key } = this.eventQueue.shift();
            if (type === 'KeyHolding') {
                // 保存最新的按键状态，供后续 processKeyholding 使用
                this.heldKeys = key;
            }
        }
    }

    /**
     * 根据当前按键状态更新移动方向 / 攻击 / 开采标记
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
                    this.attacking = true;
                    if (!wasAttacking) {
                        this.attackForward = this.args.attacks.basic.forward || 0;
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
        // 开采期间禁止移动，同时刹车惯性速度
        if (this.mining) {
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

    processSkills(players) {
        if (this.attacking) {
            this.attackForward = Math.max(0, this.attackForward - 0.1);
            if (this.attackForward <= 0) {
                this.attacking = false;
                const target = this.findTarget(players);
                if (target) {
                    target.takeDamage(this.args.attacks.basic.damage);
                    const knockback = this.args.attacks.basic.knockback;
                    if (knockback) {
                        const direction = new Vec2(target.x - this.x, target.y - this.y).normalize();
                        target.takeKnockback(direction.scale(knockback));
                    }
                }
            }
        }
    }

    processBuffs() {
        this.buffs = this.buffs.filter(buff => {
            if (buff.isExpired()) {
                return true;
            } else {
                if (buff.onExpire) {
                    buff.onExpire(this);
                }
                return false;
            }
        });
    }

    // ---------- 网络同步 ----------

    remoteData() {
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
                money: this.money,
                mining: this.mining,
                miningTime: this.miningTime,
                canMine: this.canMine,
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

    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            console.log(`Player ${this.sessionId} has died.`);
            this.x = this.y = 0;
            this.health = this.args.health;
        }
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
