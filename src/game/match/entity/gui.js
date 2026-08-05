import Entity from './entity.js';

/**
 * Gui — 屏幕固定 GUI 实体（isFixed: true）
 *
 * 用于渲染「商店界面」等固定屏幕 UI。与普通世界实体（isFixed: false）的区别：
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 坐标系约定                                                            │
 * │   • isFixed: true  → 客户端按「屏幕坐标」渲染（不随摄像机移动）          │
 * │   • x / y 为「视口归一化坐标」0~100（中心点），与客户端                  │
 * │     C2SMouseEvent / C2STouch 上报的屏幕坐标使用同一坐标系，             │
 * │     因此服务器可以直接用 contains() 对点击做命中检测。                  │
 * │   • 该实体不进入 world.entities（不对其他玩家可见），而是挂在玩家        │
 * │     的 GUI 层（ShopGui）中，由 Game._buildRenderPacket 增量推送给       │
 * │     该玩家自己的渲染流。                                               │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 渲染增量同步：与普通实体共用 Entity 基类的
 *   _renderFingerprint / _lastChangeTick / _isStatic 机制，
 *   Game._refreshRenderFingerprints 会按玩家逐个刷新 GUI 实体指纹，
 *   变化时（库存 / 金钱 / 选中态等）自动进入增量发送。
 */
class Gui extends Entity {
    /**
     * @param {Object} options
     * @param {string} options.id      — GUI 实体唯一 ID（同一玩家内）
     * @param {number} options.x       — 视口归一化横坐标（0~100，中心点）
     * @param {number} options.y       — 视口归一化纵坐标（0~100，中心点）
     * @param {number} [options.width] — 命中宽度（归一化单位）
     * @param {number} [options.height]- 命中高度（归一化单位）
     * @param {string} options.asset   — 客户端渲染 asset id（见 enum/gui）
     * @param {number} [options.z_index] — 层级（默认 5000，高于世界实体）
     * @param {Object} [options.state] — 附加状态（金钱 / 库存 / 选中态等）
     */
    constructor({ id, x, y, width, height, asset, z_index, state }) {
        super({
            id,
            type: 'gui',
            x,
            y,
            asset,
            dir: 0,
            isShowed: true,
            effects: { scale: 100, ghost: 0, color: 0 },
            width: width ?? 10,
            height: height ?? 5,
            z_index: z_index ?? 5000,
        });

        // 关键标记：屏幕固定实体（客户端按视口坐标渲染）
        this.data.isFixed = true;

        /** @type {Object} GUI 组件附加状态（随 getData 同步给客户端） */
        this.state = state || {};

        // 命中盒：以 (x, y) 为中心的矩形（归一化坐标），供点击命中检测
        this.hitbox = {
            type: 'rect',
            x: this.data.x - this.data.width / 2,
            y: this.data.y - this.data.height / 2,
            width: this.data.width,
            height: this.data.height,
        };
    }

    /**
     * 判断屏幕坐标点是否落在本 GUI 组件范围内（归一化坐标）
     * @param {number} px - 视口归一化横坐标（0~100）
     * @param {number} py - 视口归一化纵坐标（0~100）
     * @returns {boolean}
     */
    contains(px, py) {
        return (
            px >= this.hitbox.x && px <= this.hitbox.x + this.hitbox.width &&
            py >= this.hitbox.y && py <= this.hitbox.y + this.hitbox.height
        );
    }

    /**
     * 扩展基类 getData，附加 GUI 组件状态（金钱 / 库存 / 选中态等）
     * @returns {Object}
     */
    getData() {
        return {
            ...this.data,
            state: this.state,
        };
    }
}

export default Gui;
