/**
 * ShopSession 集成测试（商店与渲染管线解耦后）
 *
 * 通过 ESM loader（module.register + data: URL 模块 stub）将
 * src/network/shop.js 与 src/network/index.js 替换为内存 stub，
 * 无需连接真实服务器即可验证：
 *   1. open() → S2COpenShop（成功含商店信息）+ S2CShopList（初始清单）
 *   2. buy() 成功 → S2CBuyItem 成功 + 最新清单（库存/金钱变化）
 *   3. buy() 失败（金钱不足 / 未知道具）→ S2CBuyItem 失败原因
 *   4. close() → S2CCloseShop（原因）并清理玩家引用
 *   5. tick() 仅在内容变化时推送清单（指纹去重）
 *   6. 商店换货 → 推送最新清单
 *
 * 运行：node scripts/test_shop_session.js
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// ---- 网络层内存 stub（data: URL 模块）----
const netIndexStub = `
const sent = [];
export default {
    send(name, payload) { sent.push({ name, payload: JSON.parse(payload) }); },
    onMessage() {},
};
export { sent };
`;
const netIndexUrl = 'data:text/javascript,' + encodeURIComponent(netIndexStub);

const netShopStub = `
import room, { sent } from '${netIndexUrl}';
const sendTo = (name, sessionId, data) => room.send(name, JSON.stringify({ dest: sessionId, seq: 0, data }));
export const sendOpenShop = (s, d) => sendTo('S2COpenShop', s, d);
export const sendShopList = (s, d) => sendTo('S2CShopList', s, d);
export const sendCloseShop = (s, d) => sendTo('S2CCloseShop', s, d);
export const sendBuyItem = (s, d) => sendTo('S2CBuyItem', s, d);
export { sent };
`;
const netShopUrl = 'data:text/javascript,' + encodeURIComponent(netShopStub);

const loaderStub = `
export function resolve(specifier, context, next) {
    if (specifier.endsWith('network/shop.js')) {
        return { url: ${JSON.stringify(netShopUrl)}, shortCircuit: true };
    }
    if (specifier.endsWith('network/index.js')) {
        return { url: ${JSON.stringify(netIndexUrl)}, shortCircuit: true };
    }
    return next(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(loaderStub), pathToFileURL(process.cwd() + '/'));
// ---- 网络层内存 stub 结束 ----

// 注意：register() 必须在静态 import 之前生效，因此这里使用动态 import
const [{ default: ShopSession }, { default: ShopEntity }, { sent }] = await Promise.all([
    import('../src/game/match/shop/ShopSession.js'),
    import('../src/game/match/entity/shop.js'),
    import('../src/network/shop.js'),
]);

const log = [];
const take = (name) => {
    const i = sent.findIndex((m) => m.name === name);
    if (i === -1) return null;
    return sent.splice(i, 1)[0].payload.data;
};
const check = (cond, msg) => {
    if (!cond) throw new Error(`FAIL: ${msg}`);
    log.push(`✓ ${msg}`);
};

// ---- 构建测试玩家 ----
const player = {
    sessionId: 'p1',
    team: 'A',
    money: 500,
    health: 100,
    maxHealth: 1000,
    args: { speed: 3 },
    giveBuff: () => {},
    _openShop: null,
    _shopSession: null,
    isShopOpen: false,
    shopJustOpened: false,
};

// ---- 构建商店实体（真实地图数据） ----
const shopData = { id: 'shop_base_A', type: 'shop', team: 'A', x: 1480, y: 6840, width: 60, height: 60, asset: 'shop_A' };
const shop = new ShopEntity(shopData);
if (!shop.isPlayerNear(1480, 6840)) throw new Error('FAIL: shop proximity');

// ---- 模拟 Game（仅提供 match 阶段） ----
const game = { match: { canOpenShop: () => true } };

// ============================================================
// 1. open()
// ============================================================
const session = new ShopSession(game, player, shop);
player._shopSession = session; // 与 Game._handleOpenShopRequest 一致
session.open();
check(player.isShopOpen === true, 'open() 设置 player.isShopOpen');
check(player._openShop === shop, 'open() 绑定 player._openShop');
check(session.isOpen === true, 'session.isOpen = true');
check(shop.openedBy.has('p1'), 'shop.openedBy 记录玩家');

const openPkt = take('S2COpenShop');
check(openPkt && openPkt.success === true, 'S2COpenShop 成功');
check(openPkt.shop.id === 'shop_base_A' && openPkt.shop.team === 'A', 'S2COpenShop 含商店信息');

const list1 = take('S2CShopList');
check(list1 && list1.permanent.length === 4, `S2CShopList 常驻商品 4 个（实际 ${list1?.permanent.length}）`);
check(list1 && list1.refresh.length === 4, `S2CShopList 刷新商品 4 个（实际 ${list1?.refresh.length}）`);
check(list1 && list1.money === 500, 'S2CShopList 含玩家金钱');
check(list1 && list1.permanent[0].id === 'shop_item_potion_health', '清单商品 id 正确');

// 无变化时 tick() 不重复推送
session.tick();
check(!take('S2CShopList'), '无变化时 tick() 不推送清单（指纹去重）');

// ============================================================
// 2. buy() 成功（购买 60 金治疗药水）
// ============================================================
const buyRes = session.buy('shop_item_potion_health');
check(buyRes.ok === true, '购买成功');
check(player.money === 440, `扣款后金钱 440（实际 ${player.money}）`);
const buyPkt = take('S2CBuyItem');
check(buyPkt && buyPkt.success === true && buyPkt.itemId === 'shop_item_potion_health', 'S2CBuyItem 成功回执');
const list2 = take('S2CShopList');
check(list2 && list2.money === 440, '购买后推送最新清单（金钱 440）');

// ============================================================
// 3. buy() 失败（金钱不足 / 未知道具）
// ============================================================
player.money = 100;
const buyFail = session.buy('shop_item_buff_strength');
check(buyFail.ok === false && buyFail.reason === 'insufficient_money', '金钱不足购买失败');
const failPkt = take('S2CBuyItem');
check(failPkt && failPkt.success === false && failPkt.reason === 'insufficient_money', 'S2CBuyItem 失败原因回执');

// 未知道具
const unknown = session.buy('not_exist_item');
check(unknown.ok === false && unknown.reason === 'not_in_shop', '未知道具购买失败（not_in_shop）');

// 上面手动改 money 导致指纹变化，清空因失败购买产生的清单推送
while (take('S2CShopList')) {} // 消费残留清单

// hasItem 路由判断
check(session.hasItem('shop_item_potion_health') === true, 'hasItem 命中商店商品');
check(session.hasItem('bomb') === false, 'hasItem 排除非商店商品（物品栏道具）');

// ============================================================
// 4. close()
// ============================================================
player.money = 100;
session.close('manual');
check(!take('S2CShopList'), 'close() 不再推送清单');
const closePkt = take('S2CCloseShop');
check(closePkt && closePkt.reason === 'manual', 'S2CCloseShop（manual）');
check(player._shopSession === null && player._openShop === null, 'close() 清理玩家引用');
check(player.isShopOpen === false, 'close() 复位 isShopOpen');
check(!shop.openedBy.has('p1'), 'close() 释放商店占用记录');

// ============================================================
// 5. dispose() 幂等
// ============================================================
const s2 = new ShopSession(game, player, shop);
player._shopSession = s2;
s2.open();
check(player._shopSession === s2, '第二次会话建立');
s2.dispose();
s2.dispose(); // 重复调用
check(player._shopSession === null, 'dispose() 幂等清理');

// ============================================================
// 6. 商店刷新（换货）→ 推送最新清单
// ============================================================
const drain = () => {
    let n;
    while ((n = take('S2COpenShop') || take('S2CShopList') || take('S2CCloseShop') || take('S2CBuyItem'))) {}
};
drain(); // 清空 s2 残留包
const s3 = new ShopSession(game, player, shop);
player._shopSession = s3;
s3.open();
drain(); // 清空 s3 初始包（打开 + 首份清单）

// 手动触发换货（把 refresh 列表换成不同的商品）
const st = shop.teamState.A;
st.refreshItems = [{ base: { id: 'shop_item_armor_plate', name: '护甲板', kind: 'armor-plate', price: 150 }, stock: 1 }];
s3.tick();
const list3 = take('S2CShopList');
check(list3 && list3.refresh.length === 1 && list3.refresh[0].id === 'shop_item_armor_plate', '换货后推送最新清单');
s3.close('out_of_range');
take('S2CCloseShop');

console.log('\n===== ShopSession 集成测试全部通过 =====');
console.log(log.join('\n'));
