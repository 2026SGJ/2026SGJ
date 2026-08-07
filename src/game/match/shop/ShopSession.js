import {
    sendOpenShop,
    sendShopList,
    sendCloseShop,
    sendBuyItem,
} from '../../../network/shop.js';
import SHOP_META from '../../../assets/data/shop/shop.js';

/**
 * ShopSession — 单个玩家与商店交互的会话（独立协议包，与渲染管线解耦）
 *
 * 取代旧的 ShopGui（isFixed 屏幕实体 GUI）：商店界面的打开 / 关闭 / 商品
 * 清单 / 购买结果全部通过专用网络包与客户端通信，不再占用 S2CRender 带宽：
 *
 *   - open()        → S2COpenShop（成功含商店信息）+ S2CShopList（初始清单）
 *   - close(reason) → S2CCloseShop（手动 / 离开范围 / 死亡 / 阶段禁用）
 *   - buy(itemId)   → S2CBuyItem（成功 / 失败原因），随后推送最新清单
 *   - tick()        → 商店换货 / 玩家金钱变化时自动推送最新 S2CShopList
 *
 * 服务端仍保留 isShopOpen / _openShop 状态用于游戏逻辑（商店打开时禁止
 * 移动 / 攻击 / 采矿），但打开与关闭均由客户端发起（C2SOpenShop /
 * C2SCloseShop），服务端只做校验与回执。
 */
class ShopSession {
    /**
     * @param {import('../index.js').default} game — Game 实例（提供 match 阶段等）
     * @param {import('../player/index.js').default} player — 所属玩家
     * @param {import('../entity/shop.js').default} shop — 正在浏览的商店实体
     */
    constructor(game, player, shop) {
        this.game = game;
        this.player = player;
        this.shop = shop;

        /** @type {boolean} 会话是否处于打开状态 */
        this.isOpen = false;
        /** @type {string|null} 上次推送清单的 JSON 指纹（变化时推送） */
        this._lastCatalogFp = null;
    }

    // ============================================================
    //  打开 & 关闭
    // ============================================================

    /**
     * 打开商店：推送 S2COpenShop（含商店信息）+ 初始 S2CShopList
     * 调用前须由 Game 层完成阶段 / 距离校验。
     */
    open() {
        const { player, shop } = this;
        shop.openedBy.add(player.sessionId);
        player._openShop = shop;
        player.isShopOpen = true;
        this.isOpen = true;

        sendOpenShop(player.sessionId, {
            success: true,
            shop: {
                id: shop.data.id,
                team: shop.shopTeam,
                x: shop.data.x,
                y: shop.data.y,
                radius: SHOP_META.radius,
                refreshTime: SHOP_META.refreshTime,
            },
        });

        // 置空指纹，强制推送首份商品清单
        this._lastCatalogFp = null;
        this.tick();

        console.log(`[Shop] ${player.sessionId} 打开商店（${shop.data.id}）`);
    }

    /**
     * 关闭商店：推送 S2CCloseShop 并清理会话引用
     *
     * @param {'manual'|'out_of_range'|'dead'|'shop_disabled'} [reason]
     */
    close(reason = 'manual') {
        if (!this.isOpen) {
            this.dispose();
            return;
        }
        this.isOpen = false;
        sendCloseShop(this.player.sessionId, { reason });
        this.dispose();
        console.log(`[Shop] ${this.player.sessionId} 关闭商店（${reason}）`);
    }

    /**
     * 清理会话引用（玩家移除等场景调用，不发送网络包）
     * 幂等：重复调用安全。
     */
    dispose() {
        this.shop.openedBy.delete(this.player.sessionId);
        this.player._shopSession = null;
        this.player._openShop = null;
        this.player.isShopOpen = false;
        this.player.shopJustOpened = false;
        this.isOpen = false;
    }

    // ============================================================
    //  购买
    // ============================================================

    /**
     * 购买商品：库存扣减 / 金钱扣除 / 效果施加由 Shop 实体完成，
     * 结果经 S2CBuyItem 回执；库存与金钱变化随后立即推送最新 S2CShopList。
     *
     * @param {string} itemId - 商品 id
     * @returns {{ok: boolean, reason?: string, item?: Object}} Shop 实体的购买结果
     */
    buy(itemId) {
        const result = this.shop.buy(this.player, itemId);
        if (result.ok) {
            sendBuyItem(this.player.sessionId, {
                success: true,
                itemId,
                money: this.player.money,
            });
            console.log(
                `[Shop] ${this.player.sessionId} 购买 ${itemId}（剩余 ${this.player.money} 金币）`
            );
        } else {
            sendBuyItem(this.player.sessionId, {
                success: false,
                itemId,
                reason: result.reason || 'buy_failed',
            });
        }
        // 库存 / 金钱已变化 → 立即推送最新清单
        this.tick();
        return result;
    }

    /**
     * 判断商品 id 是否属于本商店目录（用于 C2SBuyItem 路由）
     * @param {string} itemId
     * @returns {boolean}
     */
    hasItem(itemId) {
        const team = this.player.team || 'A';
        const catalog = this.shop.getCatalog(team);
        return [...catalog.permanent, ...catalog.refresh].some((it) => it.id === itemId);
    }

    // ============================================================
    //  每 tick 同步（换货 / 金钱变化 → 推送最新清单）
    // ============================================================

    /**
     * 商店换货（refreshItems 重新随机抽取 / 库存变化）或玩家金钱变化时，
     * 推送最新 S2CShopList（JSON 指纹比对，内容未变不发送）。
     */
    tick() {
        if (!this.isOpen) return;
        const data = this._catalogData();
        const fp = JSON.stringify(data);
        if (fp !== this._lastCatalogFp) {
            this._lastCatalogFp = fp;
            sendShopList(this.player.sessionId, data);
        }
    }

    /** 构建商品清单数据（含玩家当前金钱） */
    _catalogData() {
        const team = this.player.team || 'A';
        const catalog = this.shop.getCatalog(team);
        return {
            permanent: catalog.permanent,
            refresh: catalog.refresh,
            money: this.player.money,
        };
    }
}

export default ShopSession;
