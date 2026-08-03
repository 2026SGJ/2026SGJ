import HERODATAS from '../../../assets/data/heros/index.js';
import Vec2 from '../../../utils/vec2.js';
import { collisionLeft, collisionRight, collisionTop, collisionBottom } from '../../../utils/collision.js';

class Player {
    constructor(sessionId, data) {
        this.sessionId = sessionId;
        this.x = 0;
        this.y = 0;
        this.dir = 90; // 和移动无关，仅决定渲染
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
        this.animateState = 'idle';
        this.eventHandlers = {};
        this.eventQueue = [];
        // this.frame = 0;
        this.args = HERODATAS[this.hero] || (_=>{throw new Error(`Hero data not found for hero: ${this.hero}`)})();
        this.health = this.args.health;
        this.buffs = [];
        // this.lastAnimateFrame = 0;
        this.on('keyboardEvent', (a) => {
            this.eventQueue.push(a);
        });
    }

    trigger(type, data) {
        if (!this.eventHandlers[type]) this.eventHandlers[type] = [];
        this.eventHandlers[type].forEach(async _=>{
            try {
                _(data);
            } catch (_) {
                console.error(_);
            }
        });
        // console.log(this.eventHandlers[type]);
    }

    on(type, callback) {
        if (!this.eventHandlers[type]) this.eventHandlers[type] = [];
        this.eventHandlers[type].push(callback);
    }

    animate() {
        if (this.speed.lengthSq() == 0) {
            // console.log(this.speed.x, this.speed.y);
            this.animateState = 'idle';
            return 'idle';
        }
        // console.log(this.runAnimate);
        this.runAnimate = (this.runAnimate + this.speed.length()/(1.41421356*this.args.speed)) % this.args.animations.run.frames;
        return `run${Math.trunc(this.runAnimate)+1}`;
    }

    processEvents() {
        while (this.eventQueue.length > 0) {
            const { type, key } = this.eventQueue.shift();
            if (type === 'KeyHolding') {
                this.processKeyholding(key);
            }
        }
    }

    processKeyholding(key) {
        this.dx=this.dy=0;
        let attacking = this.attacking;
        this.attacking = false;
        key.forEach(_=>{
            switch ( _ ) {
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
                    if(!attacking) {
                        this.attackForward = this.args.attacks.basic.forward || 0;
                    }
                    break;
            }
        })
    }

    move(world) {
        const kb = this.knockback.lengthSq();
        if (this.dx && kb <= 16) this.speed.x = this.dx * this.args.speed;
        if (this.dy && kb <= 16) this.speed.y = this.dy * this.args.speed;
        if (this.speed.lengthSq() <=0.09) {
            this.speed = new Vec2(0, 0);
        }
        this.x+=this.speed.x;
        this.y+=this.speed.y;
        this.x+=this.knockback.x;
        this.y+=this.knockback.y;
        for (const wall of world.walls) {
            if (collisionLeft(this.hitbox, wall.hitbox)) {
                this.x+=wall.hitbox.x + wall.hitbox.width - this.hitbox.x;
            }
            if (collisionRight(this.hitbox, wall.hitbox)) {
                this.x+=wall.hitbox.x - (this.hitbox.x + this.hitbox.width);
            }
        }
        for (const wall of world.walls) {
            if (collisionTop(this.hitbox, wall.hitbox)) {
                this.y+=wall.hitbox.y + wall.hitbox.height - this.hitbox.y;
            }
            if (collisionBottom(this.hitbox, wall.hitbox)) {
                this.y+=wall.hitbox.y - (this.hitbox.y + this.hitbox.height);
            }
        }
        this.speed.scale(kb > 16 ? 0.95 : 0.85);
        this.knockback.scale(0.99);
        this.hitbox.x = this.x - 25;
        this.hitbox.y = this.y - 25;
    }

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
        const now = Date.now();
        this.buffs = this.buffs.filter(buff => {
            if (buff.isExpired()) {
                return true;
            } else {
                // Buff 已过期，执行清除逻辑
                if (buff.onExpire) {
                    buff.onExpire(this);
                }
                return false;
            }
        });
    }

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
            }
        };
    }

    tick(players, world) {
        this.processEvents();
        this.move(world );
        this.processSkills(players);
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
        ]
    }

    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            // 玩家死亡逻辑
            console.log(`Player ${this.sessionId} has died.`);
            this.x = this.y = 0; // 重置位置
            this.health = this.args.health; // 重置血量
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
