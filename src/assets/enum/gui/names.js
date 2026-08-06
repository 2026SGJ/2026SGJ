/**
 * GUI 资源名称枚举（屏幕固定 UI）
 *
 * 这里集中管理所有「isFixed:true 屏幕固定实体」渲染所用的 asset id，
 * 供客户端加载对应贴图/精灵。与 src/game/match/entity/gui.js 配套使用。
 *
 * 约定：
 *   - isFixed 实体的 x / y 为「视口归一化坐标」（0~100，中心点），
 *     与客户端 C2SMouseEvent / C2STouch 上报的屏幕坐标同一坐标系。
 *   - 商店面板 / 标题 / 金钱 / 关闭按钮 / 选中光标 均为通用 GUI 组件；
 *     商品图标复用 src/assets/enum/shop/items.js 中的 asset id。
 *
 * 示例：
 *   guiNames.SHOP_PANEL → "shop_panel"
 *   guiNames.SHOP_CURSOR → "shop_cursor"
 */
export default {
    /** 商店面板（背景容器） */
    SHOP_PANEL: 'shop_panel',
    /** 商店标题（如「商店 / SHOP」） */
    SHOP_TITLE: 'shop_title',
    /** 金钱显示（当前金币数值） */
    SHOP_MONEY: 'shop_money',
    /** 关闭按钮（点击关闭商店） */
    SHOP_CLOSE: 'shop_close_btn',
    /** 选中光标（手柄右摇杆选择商品时的高亮框） */
    SHOP_CURSOR: 'shop_cursor',
};
