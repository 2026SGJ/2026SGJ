/**
 * 商店本体元数据
 *
 * 描述商店实体本身的固定属性，与具体商品阵容解耦。
 * 两队商店共用同一份元数据，仅 asset 上按队区分形象。
 *
 * 字段说明：
 * - radius:         玩家靠近商店触发交互的半径（像素），中心对中心距离
 * - openKey:        打开商店的按键（这里与开采同一键 E，优先级最高）
 * - refreshTime:    刷新商品列表的间隔时间（毫秒），到点重新随机一组刷新商品并补满库存
 * - refreshCount:   每次刷新从 refreshPool 中抽取展示的商品数量
 * - refreshStockPerItem: 每个刷新商品每次刷新时补满到的库存数量
 * - interactLockMs: 玩家离开交互半径后多久自动关闭商店（毫秒）
 */
export default {
    radius: 50,
    openKey: 'KeyE',
    refreshTime: 60000,
    refreshCount: 4,
    refreshStockPerItem: 3,
    interactLockMs: 500,
    // 两队商店形象 asset id（与 enum/shop/names.js 对应）
    asset: {
        A: 'shop_A',
        B: 'shop_B',
    },
};
