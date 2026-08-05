import names from './names.js';

/**
 * GUI 资源 ID 枚举
 *
 * 将 GUI 组件名称映射为客户端渲染用的 asset id。
 * 与商店商品图标（enum/shop/items.js）、实体资源（enum/entities/）并列，
 * 统一由 src/assets/assets.js 汇总导出。
 *
 * 示例：
 *   gui.SHOP_PANEL  → "shop_panel"
 *   gui.SHOP_CLOSE  → "shop_close_btn"
 */
const gui = {};

// 直接映射名称到 asset id
for (const key in names) {
    gui[key] = names[key];
}

export { names as GuiNames };
export default gui;
