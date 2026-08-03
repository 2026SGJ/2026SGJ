import getBuffClassById from '../buff/index.js';
import Vec2 from '../../../utils/vec2.js';

class Skill {
    constructor(name, description, damage, knockback, forward, buff, debuff, magic) {
        this.name = name;
        this.description = description;
        this.damage = damage;
        this.knockback = knockback;
        this.forward = forward;
        this.buff = buff;
        this.debuff = debuff;
        this.magic = magic || null; // AOE 溅射伤害配置 { damage, knockback, range }
    }

    /**
     * 对单个目标施加技能效果
     * @param {Object} srcPlayer - 施法者
     * @param {Object} targetPlayer - 目标
     */
    onUse(srcPlayer, targetPlayer) {
        // 计算伤害
        targetPlayer.takeDamage(this.damage);

        // 处理击退效果（使用 takeKnockback 保证正确的物理交互）
        // 正值为推开，负值为拉近（如黑洞效果）
        if (this.knockback && this.knockback !== 0) {
            const direction = new Vec2(
                targetPlayer.x - srcPlayer.x,
                targetPlayer.y - srcPlayer.y
            ).normalize();
            targetPlayer.takeKnockback(direction.scale(this.knockback));
        }

        // 处理自身 buff
        if (this.buff) {
            this.buff.forEach((buffData) => {
                const BuffClass = getBuffClassById(buffData.id);
                const buffInstance = new BuffClass(buffData);
                srcPlayer.giveBuff(buffInstance);
            });
        }

        // 处理目标 debuff
        if (this.debuff) {
            this.debuff.forEach((debuffData) => {
                const BuffClass = getBuffClassById(debuffData.id);
                const debuffInstance = new BuffClass(debuffData);
                targetPlayer.giveBuff(debuffInstance);
            });
        }
    }

    /**
     * 创建 Skill 实例的静态工厂方法
     * @param {Object} skillData - 来自 hero data 的技能配置
     */
    static fromHeroData(skillData) {
        return new Skill(
            skillData.name,
            skillData.description,
            skillData.damage || 0,
            skillData.knockback || 0,
            skillData.forward || 0,
            skillData.buff || null,
            skillData.debuff || null,
            skillData.magic || null
        );
    }
}

export default Skill;