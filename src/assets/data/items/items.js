import { ItemTypes } from '../../enum/items/index.js';

/**
 * 道具平衡配置（主数据文件）
 *
 * 所有道具的经济数值、使用参数、库存限制集中在此处。
 * 修改此处即可全局调整游戏平衡。
 *
 * 经济体系设计（基于矿物每分钟产出 ≈ 500 货币）：
 * - 廉价道具 (15-40):   高频使用，性价比高
 * - 中档道具 (45-75):   战术价值，频率适中
 * - 高档道具 (80-120):  战略价值，限量使用
 */

// ==================== 全局常量 ====================

/** 物品栏系统全局限制 */
export const INVENTORY_LIMITS = {
    /** 物品栏最大分类数（不同道具种类） */
    MAX_SLOTS: 10,
    /** 单格最大堆叠数量 */
    MAX_STACK: 20,
};

/** 道具冷却时间默认值（毫秒） */
export const ITEM_COOLDOWNS = {
    /** 消耗品连续使用冷却 */
    CONSUMABLE_FAST: 2000,
    CONSUMABLE_MEDIUM: 3000,
    CONSUMABLE_SLOW: 6000,
    /** 投射物连续使用冷却 */
    PROJECTILE_FAST: 1000,
    PROJECTILE_SLOW: 3000,
};

// ==================== 道具配置表 ====================

const ITEM_CONFIG = {
    // ===================== 恢复类道具 =====================
    pill: {
        id: 'pill',
        name: '药丸',
        description: '立即回复 80 点生命值',
        price: 15,
        stock: -1,                    // -1 = 无限库存
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.CONSUMABLE,
        data: { healAmount: 80 },
        cd: ITEM_COOLDOWNS.CONSUMABLE_FAST,
    },

    bandage: {
        id: 'bandage',
        name: '绷带',
        description: '立即回复 240 点生命值',
        price: 40,
        stock: -1,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.CONSUMABLE,
        data: { healAmount: 240 },
        cd: ITEM_COOLDOWNS.CONSUMABLE_MEDIUM,
    },

    medicalKit: {
        id: 'medicalKit',
        name: '急救包',
        description: '立即回复 800 点生命值',
        price: 120,
        stock: 5,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.CONSUMABLE,
        data: { healAmount: 800 },
        cd: ITEM_COOLDOWNS.CONSUMABLE_SLOW,
    },

    // ===================== 爆炸道具 =====================
    bomb: {
        id: 'bomb',
        name: '炸弹',
        description: '在脚下放置一枚炸弹，4 秒后爆炸。对自己免疫。伤害随距离衰减',
        price: 60,
        stock: -1,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.PLACEABLE,
        data: {
            explodeDelay: 4000,
            explodeDamage: 300,
            explodeRadius: 150,
            explodeKnockback: 25,
            ignoreSelf: true,
        },
        cd: 0,
    },

    fireball: {
        id: 'fireball',
        name: '火球',
        description: '发射一枚火球，碰墙或敌人后瞬间爆炸。对自己免疫',
        price: 75,
        stock: 8,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.PROJECTILE,
        data: {
            speed: 400,
            maxDistance: 600,
            explodeDamage: 250,
            explodeRadius: 120,
            explodeKnockback: 40,
            ignoreSelf: true,
        },
        cd: ITEM_COOLDOWNS.PROJECTILE_FAST,
    },

    landmine: {
        id: 'landmine',
        name: '地雷',
        description: '在自己脚下放置一个地雷，敌人靠近后爆炸。对队友和自己免疫',
        price: 50,
        stock: 3,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.PLACEABLE,
        data: {
            triggerDistance: 50,
            triggerDelay: 500,
            explodeDamage: 350,
            explodeRadius: 100,
            explodeKnockback: 60,
            ignoreSelf: true,
            ignoreTeammates: true,
        },
        cd: 0,
    },

    fragGrenade: {
        id: 'fragGrenade',
        name: '破片手雷',
        description: '在使用地点放置一个手雷，1.5 秒后爆炸，范围更大但伤害较低',
        price: 30,
        stock: -1,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.PLACEABLE,
        data: {
            explodeDelay: 1500,
            explodeDamage: 80,
            explodeRadius: 250,
            explodeKnockback: 10,
            ignoreSelf: true,
        },
        cd: 0,
    },

    // ===================== 控制道具 =====================
    flashBang: {
        id: 'flashBang',
        name: '闪光弹',
        description: '发射一枚闪光弹，碰墙或敌人后瞬间引爆，造成大范围眩晕（无法移动和攻击）2 秒',
        price: 55,
        stock: 4,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.PROJECTILE,
        data: {
            speed: 350,
            maxDistance: 500,
            stunDuration: 2000,
            stunRadius: 200,
            ignoreSelf: true,
        },
        cd: ITEM_COOLDOWNS.PROJECTILE_SLOW,
    },

    smokeGrenade: {
        id: 'smokeGrenade',
        name: '烟雾弹',
        description: '在脚下放置烟雾弹，生成一片持续 6 秒的烟雾区域，区域内的敌人移动速度降低 40%',
        price: 40,
        stock: -1,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.PLACEABLE,
        data: {
            duration: 6000,
            radius: 180,
            slowAmount: 0.4,
            tickInterval: 500,
        },
        cd: 0,
    },

    poisonDart: {
        id: 'poisonDart',
        name: '毒镖',
        description: '发射一枚毒镖，命中敌人后造成 3 秒中毒效果，每秒造成 40 点伤害（总计 120 点）',
        price: 45,
        stock: -1,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.PROJECTILE,
        data: {
            speed: 500,
            maxDistance: 700,
            poisonDamage: 40,
            poisonDuration: 3000,
            impactDamage: 20,
        },
        cd: 0,
    },

    freezeTrap: {
        id: 'freezeTrap',
        name: '冰冻陷阱',
        description: '放置一个冰冻陷阱，敌人踩中后冻结 2.5 秒（无法移动和攻击）',
        price: 65,
        stock: 2,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.PLACEABLE,
        data: {
            triggerDistance: 45,
            freezeDuration: 2500,
            ignoreTeammates: true,
        },
        cd: 0,
    },

    // ===================== 功能道具 =====================
    teleportScroll: {
        id: 'teleportScroll',
        name: '回城卷轴',
        description: '使用后回到出生点。前摇 5 秒，期间被攻击或移动打断',
        price: 80,
        stock: 3,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.UTILITY,
        data: {
            channelTime: 5000,
        },
        cd: 0,
    },

    speedPotion: {
        id: 'speedPotion',
        name: '加速药剂',
        description: '获得 60% 移动速度加成，持续 8 秒',
        price: 35,
        stock: -1,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.UTILITY,
        data: {
            speedBoost: 0.6,
            duration: 8000,
        },
        cd: 0,
    },

    invisibleCloak: {
        id: 'invisibleCloak',
        name: '隐形斗篷',
        description: '获得 4 秒隐形状态，受到的伤害减少 50%，无法攻击',
        price: 100,
        stock: 2,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.UTILITY,
        data: {
            duration: 4000,
            dmgReduction: 0.5,
        },
        cd: 0,
    },

    shieldStone: {
        id: 'shieldStone',
        name: '护盾石',
        description: '获得一个吸收 500 伤害的护盾，持续 10 秒或直到护盾被打破',
        price: 90,
        stock: -1,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.UTILITY,
        data: {
            shieldAmount: 500,
            duration: 10000,
        },
        cd: 0,
    },

    thornArmor: {
        id: 'thornArmor',
        name: '荆棘甲',
        description: '获得 6 秒荆棘效果：受到伤害时反弹 30% 伤害给攻击者',
        price: 85,
        stock: 3,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.UTILITY,
        data: {
            duration: 6000,
            reflectPercent: 30,
        },
        cd: 0,
    },

    healingTotem: {
        id: 'healingTotem',
        name: '治疗图腾',
        description: '在脚下放置一个治疗图腾，持续 8 秒，每秒为周围队友回复 50 点生命值',
        price: 70,
        stock: 2,
        maxStack: INVENTORY_LIMITS.MAX_STACK,
        type: ItemTypes.PLACEABLE,
        data: {
            duration: 8000,
            radius: 150,
            healPerTick: 50,
            tickInterval: 1000,
        },
        cd: 0,
    },
};

// ==================== 商店库存表 ====================

/**
 * 运行时库存快照
 * stock > 0 的道具在此维护；stock === -1 表示无限
 */
const ITEM_STOCK = {};

for (const [id, cfg] of Object.entries(ITEM_CONFIG)) {
    if (cfg.stock > 0) {
        ITEM_STOCK[id] = cfg.stock;
    }
}

// ==================== 道具分类映射 ====================

/**
 * 按类型分组的道具 ID 列表，方便批量操作
 */
const ITEMS_BY_TYPE = {
    consumable: Object.keys(ITEM_CONFIG).filter(id => ITEM_CONFIG[id].type === ItemTypes.CONSUMABLE),
    placeable: Object.keys(ITEM_CONFIG).filter(id => ITEM_CONFIG[id].type === ItemTypes.PLACEABLE),
    projectile: Object.keys(ITEM_CONFIG).filter(id => ITEM_CONFIG[id].type === ItemTypes.PROJECTILE),
    utility: Object.keys(ITEM_CONFIG).filter(id => ITEM_CONFIG[id].type === ItemTypes.UTILITY),
};

export { ITEM_CONFIG, ITEM_STOCK, ITEMS_BY_TYPE };
