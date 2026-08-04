import names from './names.js';
import items from './items.js';

/**
 * 商店资源 ID 枚举
 *
 * 组合 商店形象（names）× 商品图标（items），统一导出供客户端引用。
 *
 * 示例：
 *   shop.shop_A            → "shop_A"
 *   shop.shop_item_...     → "shop_item_..."
 */
const shop = {};

// 商店实体形象 asset id（原样透传，便于按队区分）
for (const key in names) {
    const value = names[key];
    shop[value] = value;
}

// 商品图标 asset id
for (const key in items) {
    const value = items[key];
    shop[value] = value;
}

export default shop;
