import { ITEM_CONFIG, ITEM_STOCK } from './itemConfig.js';
import Inventory from './inventory.js';

/**
 * Shop — 商店系统
 * 
 * 管理所有道具的购买逻辑。玩家通过 C2SBuyItem 消息与商店交互。
 * 
 * 购买规则：
 *   1. 玩家必须有足够的金钱
 *   2. 商店必须有足够的库存（或无限库存）
 *   3. 玩家物品栏必须能够容纳该道具
 *   4. 购买成功后扣款、减少库存、添加道具到物品栏
 * 
 * 库存管理：
 *   对于 stock > 0 的道具，全局共享相同的库存总量（不是每玩家独立）
 *   库存存储在 module-level Map ITEM_STOCK 中
 */

class Shop {
    /**
     * 尝试购买道具
     * 
     * @param {import('../player/index.js').default} player - 购买者
     * @param {string} itemId - 道具 ID
     * @returns {{ success: boolean; reason?: string }} 购买结果
     */
    static buy(player, itemId) {
        // ----- 1. 验证道具是否存在 -----
        const config = ITEM_CONFIG[itemId];
        if (!config) {
            return { success: false, reason: '未知道具' };
        }

        // ----- 2. 检查玩家金钱 -----
        if (player.money < config.price) {
            return {
                success: false,
                reason: `金钱不足: 需要 ${config.price} 币，当前 ${player.money} 币`,
            };
        }

        // ----- 3. 检查库存 -----
        if (config.stock > 0) {
            const remaining = ITEM_STOCK[itemId] || 0;
            if (remaining <= 0) {
                return { success: false, reason: '库存已售罄' };
            }
        }

        // ----- 4. 检查物品栏容量 -----
        const inventory = player.inventory;
        if (!inventory) {
            return { success: false, reason: '物品栏系统未初始化' };
        }
        if (!inventory.canAdd(itemId, 1)) {
            return {
                success: false,
                reason: inventory.find(itemId)
                    ? `道具 ${config.name} 已达堆叠上限 (${Inventory.MAX_STACK})`
                    : `物品栏已满 (${inventory.items.size}/${Inventory.MAX_SLOTS} 种道具)`,
            };
        }

        // ----- 5. 执行购买 -----
        player.money -= config.price;
        inventory.add(itemId, 1);

        // 减少库存
        if (config.stock > 0) {
            ITEM_STOCK[itemId] = (ITEM_STOCK[itemId] || config.stock) - 1;
        }

        console.log(
            `[Shop] ${player.sessionId} 购买 ${config.name} (${config.price}币), ` +
            `剩余库存: ${config.stock > 0 ? ITEM_STOCK[itemId] : '无限'}, ` +
            `金钱剩余: ${player.money}`
        );

        return { success: true };
    }

    /**
     * 获取所有可购买的道具信息（供客户端 UI 展示）
     * 
     * @returns {Object[]}
     */
    static getShopList() {
        const list = [];
        for (const [id, cfg] of Object.entries(ITEM_CONFIG)) {
            list.push({
                itemId: id,
                name: cfg.name,
                description: cfg.description,
                price: cfg.price,
                stock: cfg.stock > 0 ? (ITEM_STOCK[id] || 0) : -1, // -1 = 无限
                type: cfg.type,
                maxStack: cfg.maxStack,
                cd: cfg.cd || 0,
            });
        }
        return list.sort((a, b) => a.price - b.price);
    }

    /**
     * 重置库存（对应每局游戏开始时调用）
     */
    static resetStock() {
        for (const [id, cfg] of Object.entries(ITEM_CONFIG)) {
            if (cfg.stock > 0) {
                ITEM_STOCK[id] = cfg.stock;
            }
        }
        console.log('[Shop] 库存已重置');
    }
}

export default Shop;