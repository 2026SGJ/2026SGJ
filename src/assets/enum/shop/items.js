/**
 * 商店商品资源 id 枚举
 *
 * 每种商品对应一个 asset id，供客户端渲染商品图标。
 * 这些 asset id 与 list.js 中商品条目的 item 字段一一对应。
 *
 * 示例：
 *   shopItems.POTION_HEALTH  → "shop_item_potion_health"
 *   shopItems.POTION_SPEED   → "shop_item_potion_speed"
 *   shopItems.ARMOR_PLATE    → "shop_item_armor_plate"
 *   shopItems.WARD_VISION    → "shop_item_ward_vision"
 */
export default {
    POTION_HEALTH: 'shop_item_potion_health',
    POTION_SPEED: 'shop_item_potion_speed',
    ARMOR_PLATE: 'shop_item_armor_plate',
    WARD_VISION: 'shop_item_ward_vision',
    BUFF_STRENGTH: 'shop_item_buff_strength',
    BUFF_REBOUND: 'shop_item_buff_rebound',
    SCROLL_TELEPORT: 'shop_item_scroll_teleport',
    ELIXIR_BERSERK: 'shop_item_elixir_berserk',
};
