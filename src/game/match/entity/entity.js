/**
 * Entity — 实体基类
 *
 * 提供所有地图 / 道具实体共用的渲染数据字段（this.data）。
 *
 * ── 渲染增量同步（带宽优化）────────────────────────────────
 * 客户端约定：S2CRender 数据中「缺失的实体」沿用上一帧的渲染状态。
 * 因此服务器只需发送「发生变化 / 新增」的实体，无需每帧全量推送。
 *
 * 基类维护以下三个字段支撑增量检测：
 *   - _isStatic          静态实体标记（wall / title / 普通装饰），渲染数据永不变化，
 *                        init 时缓存一次指纹后不再参与每 tick 指纹刷新（省去无谓序列化）
 *   - _renderFingerprint 最近一次渲染数据的 JSON 指纹，用于比对是否发生变化
 *   - _lastChangeTick    渲染数据最后变化的全局渲染 tick（world.renderTick），
 *                        渲染组装时与玩家上次发送 tick 比较，决定是否需要发送
 *
 * 指纹刷新统一由 World.refreshRenderTicks() 在每 tick 游戏逻辑更新后执行，
 * 与具体游戏逻辑完全解耦：任何对 getData() 输出有影响的状态变化都会被自动发现，
 * 不存在「漏标 / 误标」脏标记问题。
 * ─────────────────────────────────────────────────────────
 */
class Entity {
    constructor({ id, type, x, y, asset, dir, isShowed, effects, width, height, z_index }) {
        this.data = {
            id: id,
            type: type,
            x: x,
            y: y,
            asset: asset,
            dir: dir,
            isShowed: isShowed,
            color: effects?.color || 0,
            ghost: effects?.ghost || 0,
            scale: effects?.scale || 100,
            width: width,
            height: height,
            "z-index": z_index ?? 0
        };

        // ---------- 渲染增量同步字段（由 World.refreshRenderTicks 维护） ----------
        /** @type {boolean} 静态实体标记：渲染数据永不变化，指纹只初始化一次 */
        this._isStatic = false;
        /** @type {string|null} 最近一次渲染数据的 JSON 指纹（null = 尚未初始化） */
        this._renderFingerprint = null;
        /** @type {number} 渲染数据最后变化的全局渲染 tick（world.renderTick） */
        this._lastChangeTick = 0;
    }

    getData() {
        return this.data;
    }

    /**
     * 获取用于网络渲染的渲染数据（S2CRender 条目）
     *
     * 协议兼容说明：旧渲染管线将「实体渲染条目」与「玩家渲染条目」统一标记为
     * type:'update'，客户端据此识别这是一条常规渲染更新（实体类型通过 id / asset /
     * 各自扩展字段区分，而非 type 字段）。这里保持该语义，避免破坏客户端解析。
     *
     * 渲染指纹刷新（World.refreshRenderTicks）与增量组装（Game._buildRenderPacket）
     * 统一基于此方法，确保「发送什么就检测什么」，指纹与协议输出严格一致。
     *
     * @returns {Object}
     */
    getRenderData() {
        return {
            ...this.getData(),
            type: 'update',
        };
    }
}

export default Entity;