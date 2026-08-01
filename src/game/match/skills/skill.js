import getBuffClassById from '../buff/index.js';

class Skill {
    constructor(name, description, damage, knockback, forward, buff, debuff) {
        this.name = name;
        this.description = description;
        this.damage = damage;
        this.knockback = knockback;
        this.forward = forward;
        this.buff = buff;
        this.debuff = debuff;
    }

    onUse(srcPlayer, targetPlayer) {
        // 计算伤害
        targetPlayer.takeDamage(this.damage);
        // 处理击退效果
        if (this.knockback) {
            const direction = new Vec2(targetPlayer.x - srcPlayer.x, targetPlayer.y - srcPlayer.y).normalize();
            targetPlayer.speed.add(direction.scale(this.knockback));
        }
        // 处理buff和debuff
        if (this.buff) {
            this.buff.forEach((buffData) => {
                const BuffClass = getBuffClassById(buffData.id);
                const buffInstance = new BuffClass(buffData);
                srcPlayer.giveBuff(buffInstance);
            });
        }
        if (this.debuff) {
            this.debuff.forEach((debuffData) => {
                const BuffClass = getBuffClassById(debuffData.id);
                const debuffInstance = new BuffClass(debuffData);
                targetPlayer.giveBuff(debuffInstance);
            });
        }
    }
}

export default Skill;