import room from './index.js';

/**
 * 商店独立协议（与渲染管线完全解耦）
 *
 * 商店界面不再通过 S2CRender 的 isFixed GUI 实体渲染，而是走本文件
 * 定义的专用数据包（每个包 JSON.stringify 后经 colyseus 中继发送）：
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 包名            方向              内容                                 │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ C2SOpenShop     客户端 → 服务端   请求打开商店（E 键 / 触屏按钮）        │
 * │ S2COpenShop     服务端 → 客户端   打开结果（成功含商店信息 / 失败原因）   │
 * │ S2CShopList     服务端 → 客户端   商品清单（常驻 + 刷新 + 玩家金钱）      │
 * │ C2SCloseShop    客户端 → 服务端   请求关闭商店（E 键 / 关闭按钮）        │
 * │ S2CCloseShop    服务端 → 客户端   关闭结果（手动 / 离开范围 / 死亡等）    │
 * │ C2SBuyItem      客户端 → 服务端   购买请求（商品 id）                   │
 * │ S2CBuyItem      服务端 → 客户端   购买结果（成功 / 失败原因）            │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 数据包外层统一格式（与房间内其他包一致）：
 *   { dest: sessionId, seq: 0, data: { ... } }
 *
 * 使用方：src/game/match/shop/ShopSession.js（商店会话状态机）与
 * src/game/index.js（C2SOpenShop / C2SCloseShop / C2SBuyItem 路由）。
 */

/**
 * 发送单个商店协议包
 * @private
 * @param {string} name - 包名（如 'S2COpenShop'）
 * @param {string} sessionId - 目标玩家 sessionId
 * @param {Object} data - 包体数据
 */
const sendTo = (name, sessionId, data) => {
    room.send(name, JSON.stringify({ dest: sessionId, seq: 0, data }));
};

/**
 * S2COpenShop — 打开商店结果
 *
 * @param {string} sessionId
 * @param {Object} data
 * @param {boolean} data.success - 是否打开成功
 * @param {Object} [data.shop] - 打开成功时的商店信息
 * @param {string} data.shop.id - 商店实体 id（如 shop_base_A）
 * @param {string} data.shop.team - 商店归属队伍 'A' | 'B'
 * @param {number} data.shop.x - 商店世界坐标 X
 * @param {number} data.shop.y - 商店世界坐标 Y
 * @param {number} data.shop.radius - 交互半径（像素）
 * @param {number} data.shop.refreshTime - 刷新周期（毫秒）
 * @param {string} [data.reason] - 打开失败原因：'no_shop_nearby' | 'shop_disabled'
 */
export const sendOpenShop = (sessionId, data) => sendTo('S2COpenShop', sessionId, data);

/**
 * S2CShopList — 商品清单
 *
 * 打开商店时全量推送；此后「商店换货 / 库存变化 / 玩家金钱变化」时增量推送
 * （指纹比对，见 ShopSession.tick）。
 *
 * @param {string} sessionId
 * @param {Object} data
 * @param {Array<{id: string, name: string, kind: string, price: number, stock: number, permanent: boolean}>} data.permanent - 常驻商品
 * @param {Array<{id: string, name: string, kind: string, price: number, stock: number, permanent: boolean, nextRefreshAt: number}>} data.refresh - 刷新商品
 * @param {number} data.money - 玩家当前金钱
 */
export const sendShopList = (sessionId, data) => sendTo('S2CShopList', sessionId, data);

/**
 * S2CCloseShop — 关闭商店结果
 *
 * @param {string} sessionId
 * @param {Object} data
 * @param {'manual'|'out_of_range'|'dead'|'shop_disabled'} data.reason - 关闭原因
 *   - manual       玩家主动关闭（C2SCloseShop）
 *   - out_of_range 玩家离开商店交互范围
 *   - dead         玩家死亡
 *   - shop_disabled 当前阶段禁止商店（如进入加时赛）
 */
export const sendCloseShop = (sessionId, data) => sendTo('S2CCloseShop', sessionId, data);

/**
 * S2CBuyItem — 购买结果
 *
 * @param {string} sessionId
 * @param {Object} data
 * @param {boolean} data.success - 是否购买成功
 * @param {string} data.itemId - 商品 id
 * @param {string} [data.reason] - 失败原因：'insufficient_money' | 'out_of_stock' |
 *   'not_in_shop' | 'no_shop_nearby' | 'shop_disabled' | 'shop_not_open' ...
 * @param {number} [data.money] - 购买成功后玩家剩余金钱
 */
export const sendBuyItem = (sessionId, data) => sendTo('S2CBuyItem', sessionId, data);
