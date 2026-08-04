import { ITEM_CONFIG, INVENTORY_LIMITS } from './itemConfig.js';

/**
 * Inventory — 玩家物品栏系统
 * 
 * 每个玩家持有一个 Inventory 实例，管理最多 10 种道具、每种最多 20 个。
 * 
 * 存储结构：Map<itemId, { itemId, config, quantity }>
 * 
 * 设计原则：
 *   1. 仅在物品数量变动时通过 S2CInv 通知客户端
 *   2. 购买、使用、丢弃任何操作都会触发即时同步
 *   3. 超出容量或库存不足时拒绝操作
 */

class Inventory {
    /** 物品栏最大分类数（从资产配置读取） */
    static MAX_SLOTS = INVENTORY_LIMITS.MAX_SLOTS;

    /** 单格最大堆叠数（从资产配置读取） */
    static MAX_STACK = INVENTORY_LIMITS.MAX_STACK;

    /**
     * @param {string} sessionId - 所属玩家 sessionId（用于网络同步）
     */
    constructor(sessionId) {
        /** @type {string} */
        this.sessionId = sessionId;

        /**
         * 物品存储：Map<itemId, { itemId, count }>
         */
        this.items = new Map();

        /**
         * 物品栏是否已改变（用于增量同步 - 仅在变动时发送）
         * @type {boolean}
         */
        this.changed = false;

        /**
         * 回城卷轴 - 最近一次使用的时间戳（用于冷却控制）
         */
        this.teleportScrollLastUsed = 0;

        /**
         * 道具使用冷却记录：Map<itemId, number> → 该道具最后一次使用时间戳
         */
        this.itemCooldowns = new Map();

        /**
         * 主动态 flag：是否正在引导回城
         */
        this.isChannelingTeleport = false;
        this.teleportChannelRemaining = 0;
    }

    /**
     * 在物品栏中查找指定道具
     * @param {string} itemId
     * @returns {{ itemId: string; count: number } | null}
     */
    find(itemId) {
        return this.items.get(itemId) || null;
    }

    /**
     * 获取道具数量
     * @param {string} itemId
     * @returns {number}
     */
    count(itemId) {
        const slot = this.items.get(itemId);
        return slot ? slot.count : 0;
    }

    /**
     * 是否可以添加指定数量的道具（不实际添加）
     * 
     * 当前有新 slot 可用空间 + 已有 slot 可扩充的空间
     * 
     * @param {string} itemId - 道具 ID
     * @param {number} quantity - 要添加的数量
     * @returns {boolean}
     */
    canAdd(itemId, quantity) {
        const config = ITEM_CONFIG[itemId];
        if (!config) return false;

        const existing = this.items.get(itemId);
        if (existing) {
            // 已经在现有 slot 中，只需检查堆叠上限
            return existing.count + quantity <= Inventory.MAX_STACK;
        }

        // 需要新 slot
        return this.items.size < Inventory.MAX_SLOTS;
    }

    /**
     * 添加道具（含容量检查）
     * 
     * @param {string} itemId - 道具 ID
     * @param {number} quantity - 添加数量（默认 1）
     * @returns {boolean} 是否成功添加
     */
    add(itemId, quantity = 1) {
        const config = ITEM_CONFIG[itemId];
        if (!config) {
            console.warn(`[Inventory] Unknown item ${itemId}`);
            return false;
        }

        const existing = this.items.get(itemId);

        if (existing) {
            // 已有此道具：检查堆叠上限
            if (existing.count + quantity > Inventory_MAX_STACK) {
                console.log(`[Inventory] ${this.sessionId}: 道具 ${config.name} 超出堆叠上限（目前 ${existing.count} / ${Inventory.MAX_STACK}）`);
                return false;
            }
            existing.count += quantity;
        } else {
            // 新道具：检查 slot 数量
            if (this.items.size >= Inventory.MAX_SLOTS) {
                console.log(`[Inventory] ${this.sessionId}: 物品栏已满 (${this.items.size}/${Inventory.MAX_SLOTS} 种道具)`);
                return false;
            }
            this.items.set(itemId, { count: quantity });
        }

        this.changed = true;
        console.log(
            `[Inventory] ${this.sessionId}: +${quantity}× ${config.name}, ` +
            `现在 ${this.count(itemId)} 个, ` +
            `${this.items.size} 种道具`
        );
        return true;
    }

    /**
     * 移除道具（使用/丢弃）
     * 
     * @param {string} itemId
     * @param {number} quantity - 要移除的数量（默认 1）
     * @returns {boolean} 是否成功移除
     */
    remove(itemId, quantity = 1) {
        const existing = this.items.get(itemId);
        if (!existing || existing.count < quantity) {
            console.warn(`[Inventory] 移除失败: ${this.sessionId} 没有足够的 ${itemId}`);
            return false;
        }

        existing.count -= quantity;
        if (existing.count <= 0) {
            this.items.delete(itemId);
        }
        this.changed = true;
        return true;
    }

    /**
     * 完全清空物品栏（玩家死亡时）
     */
    clear() {
        this.items.clear();
        this.changed = true;
    }

    /**
     * 检查道具是否进入冷却
     * @param {string} itemId
     * @returns {boolean}
     */
    usesCooledDown(itemId) {
        const config = ITEM_CONFIG[itemId];
        if (!config || !config.cd) return true;
        const lastUsed = this.itemCooldowns.get(itemId);
        if (!lastUsed) return true;
        return Date.now() - lastUsed >= config.cd;
    }

    /**
     * 获取道具冷却剩余时间（毫秒）
     * @param {string} itemId
     * @returns {number} 0 = 已就绪
     */
    getItemCdRemaining(itemId) {
        const config = ITEM_CONFIG[itemId];
        if (!config || !config.cd) return 0;
        const lastUsed = this.itemCooldowns.get(itemId);
        if (!lastUsed) return 0;
        const remaining = config.cd - (Date.now() - lastUsed);
        return Math.max(0, remaining);
    }

    /**
     * 记录道具使用冷却
     * @param {string} itemId
     */
    setItemCooldown(itemId) {
        this.itemCooldowns.set(itemId, Date.now());
    }

    /**
     * 获取序列化数据（用于 S2CInv）
     * @returns {Object[]}
     */
    serialize() {
        const list = [];
        for (const [itemId, item] of this.items) {
            const config = ITEM_CONFIG[itemId];
            list.push({
                itemId: itemId,
                count: item.count,
                name: config ? config.name : item.itemId,
                description: config ? config.description : '',
                type: config ? config.type : 'unknown',
                cd: config ? config.cd : 0,
                cdRemaining: this.getItemCdRemaining(item.itemId),
            });
        }
        return list.sort((a, b) => b.itemId - a.itemId); // 按道具 ID 排序
    }

    /**
     * 重置 changed 标志（在同步后调用）
     */
    markSynchronized() {
        this.changed = false;
    }
}

export default Inventory;