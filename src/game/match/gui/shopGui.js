import Gui from '../entity/gui.js';
import GUI_ASSETS from '../../../assets/enum/gui/index.js';

/**
 * 商店 GUI 布局（视口归一化坐标 0~100，实体 x/y 为中心点）
 *
 * 面板 46×52 居中偏上，内含：
 *   - 标题（y=22）          — 商店标题贴图
 *   - 金钱（y=29）          — 当前金币数值
 *   - 商品（2 列 × 4 行）    — 8 个商品槽位（常驻在前、刷新在后）
 *   - 关闭按钮（右上角）    — 点击关闭商店
 *   - 选中光标              — 覆盖在当前选中商品上（手柄右摇杆移动）
 */
const LAYOUT = {
    panel:  { x: 50, y: 42, width: 46, height: 52, z: 1000 },
    title:  { x: 50, y: 22, width: 22, height: 5, z: 1001 },
    money:  { x: 50, y: 29, width: 18, height: 4, z: 1001 },
    close:  { x: 68.5, y: 20, width: 6, height: 6, z: 1002 },
    item:   { width: 20, height: 6.5, z: 1001 },
    cursor: { width: 21, height: 7.5, z: 1003 },
    cols: [39, 61],          // 商品列中心 x
    rows: [37, 45, 53, 61],  // 商品行中心 y
    maxItems: 8,             // 商品槽位数（2 列 × 4 行）
};

/** 手柄右摇杆选中灵敏度：摇杆强度累积阈值（强度 × 毫秒） */
const STICK_SELECT_THRESHOLD = 240;
/** 手柄摇杆死区（0~1） */
const STICK_DEADZONE = 0.25;
/** 商店 GUI 每 tick 的摇杆累积增量基数（主循环 50ms / tick） */
const TICK_MS = 1000 / 20;

/** 购买失败原因 → 界面提示文本（配合 S2CRender 漂浮文字展示） */
const FAIL_REASON_TEXT = {
    insufficient_money: '金钱不足',
    out_of_stock: '商品已售罄',
    not_in_shop: '商品不存在',
    no_shop_nearby: '已离开商店范围',
    shop_disabled: '当前阶段无法购买',
    invalid_request: '无效的购买请求',
};

/**
 * ShopGui — 商店界面（isFixed 屏幕实体 GUI）
 *
 * 以「屏幕固定实体」代替旧的 S2CShopOpen / S2CShopClose / S2CShopCatalog /
 * S2CShopBuyResult / S2CShopError 等专用网络包：所有商店界面内容都通过
 * S2CRender 渲染管线推送给玩家自己（每玩家独立 GUI 层）。
 *
 * 职责：
 *   1. build()      — 打开商店时构建面板 / 标题 / 金钱 / 商品 / 关闭按钮 / 光标
 *   2. refresh()    — 每 tick 同步库存刷新、金钱变化、可选/选中状态
 *   3. handleClick()— 鼠标 / 触屏屏幕坐标点击 → 返回 'close' 或 { itemId }
 *   4. handleStick()— 手柄右摇杆移动选中光标（带死区与累积阈值防抖）
 *   5. selectedItemId — 当前选中商品的 itemId（供 Game 层完成购买）
 *
 * 购买的具体逻辑（库存扣减 / 金钱扣除 / 效果施加）仍由 Shop 实体负责，
 * 本类只负责「界面」与「输入命中」，保持职责单一。
 */
class ShopGui {
    /**
     * @param {import('../player/index.js').default} player — 所属玩家
     * @param {import('../entity/shop.js').default} shop    — 正在浏览的商店实体
     */
    constructor(player, shop) {
        /** @type {import('../player/index.js').default} 所属玩家 */
        this.player = player;
        /** @type {import('../entity/shop.js').default} 正在浏览的商店 */
        this.shop = shop;

        /** @type {Gui[]} 当前全部 GUI 实体（渲染增量同步使用） */
        this.entities = [];

        /** @type {Gui[]} 商品实体（顺序对应商品列表） */
        this._itemEntities = [];
        /** @type {Gui|null} 金钱显示实体 */
        this._moneyEntity = null;
        /** @type {Gui|null} 关闭按钮实体 */
        this._closeEntity = null;
        /** @type {Gui|null} 选中光标实体 */
        this._cursorEntity = null;

        /** @type {number} 当前选中的商品下标 */
        this._selectedIndex = 0;
        /** @type {{x: number, y: number}} 手柄右摇杆位移累积器 */
        this._stickAccum = { x: 0, y: 0 };
    }

    // ============================================================
    //  构建 & 销毁
    // ============================================================

    /**
     * 构建商店界面实体（打开商店时由 Game 层调用一次）
     *
     * 商品列表 = 常驻商品（permanent）+ 刷新商品（refresh），
     * 按出现顺序排入 2 列 × 4 行网格，最多 8 个。
     */
    build() {
        const team = this.player.team || 'A';
        const catalog = this.shop.getCatalog(team);
        const items = [...catalog.permanent, ...catalog.refresh].slice(0, LAYOUT.maxItems);

        // ---- 面板（背景容器） ----
        this.entities.push(new Gui({
            id: 'shop_panel',
            x: LAYOUT.panel.x, y: LAYOUT.panel.y,
            width: LAYOUT.panel.width, height: LAYOUT.panel.height,
            asset: GUI_ASSETS.SHOP_PANEL,
            z_index: LAYOUT.panel.z,
        }));

        // ---- 标题 ----
        this.entities.push(new Gui({
            id: 'shop_title',
            x: LAYOUT.title.x, y: LAYOUT.title.y,
            width: LAYOUT.title.width, height: LAYOUT.title.height,
            asset: GUI_ASSETS.SHOP_TITLE,
            z_index: LAYOUT.title.z,
        }));

        // ---- 金钱显示 ----
        this._moneyEntity = new Gui({
            id: 'shop_money',
            x: LAYOUT.money.x, y: LAYOUT.money.y,
            width: LAYOUT.money.width, height: LAYOUT.money.height,
            asset: GUI_ASSETS.SHOP_MONEY,
            z_index: LAYOUT.money.z,
        });
        this.entities.push(this._moneyEntity);

        // ---- 关闭按钮 ----
        this._closeEntity = new Gui({
            id: 'shop_close',
            x: LAYOUT.close.x, y: LAYOUT.close.y,
            width: LAYOUT.close.width, height: LAYOUT.close.height,
            asset: GUI_ASSETS.SHOP_CLOSE,
            z_index: LAYOUT.close.z,
        });
        this.entities.push(this._closeEntity);

        // ---- 商品槽位 ----
        items.forEach((item, i) => {
            const col = i % LAYOUT.cols.length;
            const row = Math.floor(i / LAYOUT.cols.length);
            const entity = new Gui({
                id: `shop_item_${i}`,
                x: LAYOUT.cols[col], y: LAYOUT.rows[row],
                width: LAYOUT.item.width, height: LAYOUT.item.height,
                // 商品 asset id 即商品 id（见 enum/shop/items.js），直接复用
                asset: item.id,
                z_index: LAYOUT.item.z,
                state: {
                    itemId: item.id,
                    name: item.name,
                    price: item.price,
                    stock: item.permanent ? -1 : item.stock, // -1 = 无限库存
                    permanent: !!item.permanent,
                    selected: i === 0,   // 默认选中第一个（手柄初始位置）
                    affordable: this.player.money >= item.price,
                },
            });
            this._itemEntities.push(entity);
            this.entities.push(entity);
        });

        // ---- 选中光标（手柄右摇杆选择高亮） ----
        this._cursorEntity = new Gui({
            id: 'shop_cursor',
            x: LAYOUT.cols[0], y: LAYOUT.rows[0],
            width: LAYOUT.cursor.width, height: LAYOUT.cursor.height,
            asset: GUI_ASSETS.SHOP_CURSOR,
            z_index: LAYOUT.cursor.z,
        });
        this.entities.push(this._cursorEntity);

        // 一次性同步初始状态（金钱 / 可选态 / 选中态）
        this.refresh();
    }

    /**
     * 销毁界面（关闭商店时由 Game 层调用）
     * 各实体由 Game 层统一发送 { type:'delete', id } 删除包，此处仅释放引用
     */
    destroy() {
        this.entities = [];
        this._itemEntities = [];
        this._moneyEntity = null;
        this._closeEntity = null;
        this._cursorEntity = null;
    }

    // ============================================================
    //  状态刷新
    // ============================================================

    /**
     * 每 tick 刷新界面状态（由 Game._syncShopGui 调用）：
     *   - 商店刷新商品到点换货 → 同步库存 / 价格
     *   - 玩家金钱变化 → 同步金币数值与「可购买」高亮
     *   - 选中下标越界（商品换货后数量变化）→ 收敛
     *
     * 状态变化会体现在实体 getData() 输出上，由 Game 的指纹刷新机制
     * 自动检测并进入增量渲染，无需手动标记。
     */
    refresh() {
        const team = this.player.team || 'A';
        const money = this.player.money;
        const catalog = this.shop.getCatalog(team);
        const items = [...catalog.permanent, ...catalog.refresh].slice(0, LAYOUT.maxItems);

        // 选中下标越界时收敛到最后一个商品
        if (this._selectedIndex >= this._itemEntities.length) {
            this._selectedIndex = Math.max(0, this._itemEntities.length - 1);
        }

        items.forEach((item, i) => {
            const entity = this._itemEntities[i];
            if (!entity) return;
            // 刷新换货后商品可能改变：同步图标 asset 与状态
            entity.data.asset = item.id;
            entity.state.price = item.price;
            entity.state.stock = item.permanent ? -1 : item.stock;
            entity.state.permanent = !!item.permanent;
            entity.state.affordable = money >= item.price;
            entity.state.selected = (i === this._selectedIndex);
        });

        if (this._moneyEntity) {
            this._moneyEntity.state.money = money;
        }
        this._updateCursor();
    }

    // ============================================================
    //  输入处理
    // ============================================================

    /**
     * 鼠标 / 触屏点击命中检测（屏幕归一化坐标 0~100）
     *
     * @param {number} x - 视口归一化横坐标
     * @param {number} y - 视口归一化纵坐标
     * @returns {'close'|{action:'buy', itemId:string}|null}
     *   - 'close'          → 点击了关闭按钮
     *   - {action:'buy'}   → 点击了某商品（同时把选中态移到该商品）
     *   - null             → 未命中任何可交互组件
     */
    handleClick(x, y) {
        // 关闭按钮优先判定
        if (this._closeEntity && this._closeEntity.contains(x, y)) {
            return 'close';
        }

        // 商品槽位：命中后同步选中态（鼠标点击也高亮该商品）
        for (let i = 0; i < this._itemEntities.length; i++) {
            const entity = this._itemEntities[i];
            if (entity.contains(x, y)) {
                this.setSelected(i);
                return { action: 'buy', itemId: entity.state.itemId };
            }
        }

        return null;
    }

    /**
     * 手柄右摇杆选择（每 tick 调用）
     *
     * 采用「强度 × 时间」累积阈值：摇杆推到底约 240ms 触发一次位移，
     * 避免持续按住摇杆时每 tick 疯狂跳格；摇杆回中后累积值按帧衰减。
     *
     * @param {number} rx - 右摇杆 X（-1 ~ 1）
     * @param {number} ry - 右摇杆 Y（-1 ~ 1）
     */
    handleStick(rx, ry) {
        // 摇杆回中 → 缓慢清零累积（防残留误触）
        if (Math.abs(rx) < STICK_DEADZONE) this._stickAccum.x *= 0.6;
        if (Math.abs(ry) < STICK_DEADZONE) this._stickAccum.y *= 0.6;

        this._stickAccum.x += rx * TICK_MS;
        this._stickAccum.y += ry * TICK_MS;

        if (Math.abs(this._stickAccum.x) >= STICK_SELECT_THRESHOLD) {
            const dir = Math.sign(this._stickAccum.x);
            this._stickAccum.x = 0;
            this._moveSelection(dir, 0);
        }
        if (Math.abs(this._stickAccum.y) >= STICK_SELECT_THRESHOLD) {
            const dir = Math.sign(this._stickAccum.y);
            this._stickAccum.y = 0;
            this._moveSelection(0, dir);
        }
    }

    /** 摇杆回中时的残留衰减（由 Player 在无摇杆输入时调用） */
    decayStick() {
        this._stickAccum.x *= 0.6;
        this._stickAccum.y *= 0.6;
    }

    // ============================================================
    //  选中管理
    // ============================================================

    /**
     * 在商品网格中移动选中下标（上下左右，越界回绕）
     * @param {number} dx - 水平位移（-1 左 / 1 右）
     * @param {number} dy - 垂直位移（-1 上 / 1 下）
     */
    _moveSelection(dx, dy) {
        const total = this._itemEntities.length;
        const cols = LAYOUT.cols.length;
        if (total === 0) return;

        const rows = Math.ceil(total / cols);
        let row = Math.floor(this._selectedIndex / cols);
        let col = this._selectedIndex % cols;

        row = (row + dy + rows) % rows;
        col = (col + dx + cols) % cols;

        // 最后一行为不满行时，越界列收敛到最后一个商品
        const idx = Math.min(row * cols + col, total - 1);
        this.setSelected(idx);
    }

    /**
     * 设置选中下标并同步实体状态（高亮 + 光标跟随）
     * @param {number} idx
     */
    setSelected(idx) {
        if (idx < 0 || idx >= this._itemEntities.length) return;
        this._selectedIndex = idx;
        this._itemEntities.forEach((entity, i) => {
            entity.state.selected = (i === idx);
        });
        this._updateCursor();
    }

    /** 当前选中商品的 itemId（手柄 A 键购买用） */
    get selectedItemId() {
        const entity = this._itemEntities[this._selectedIndex];
        return entity ? entity.state.itemId : null;
    }

    /** 将光标实体移动到当前选中商品位置 */
    _updateCursor() {
        const entity = this._itemEntities[this._selectedIndex];
        if (this._cursorEntity && entity) {
            this._cursorEntity.data.x = entity.data.x;
            this._cursorEntity.data.y = entity.data.y;
        }
    }
}

export { FAIL_REASON_TEXT };
export default ShopGui;
