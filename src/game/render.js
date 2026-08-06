/**
 * RenderBatcher — 渲染包合并器（S2CRenderBatch）
 *
 * ── 为什么需要批处理 ──────────────────────────────────────────────
 * 旧管线中，客户端每次 C2SUpdateRender 都会触发一次独立的 S2CRender
 * 广播。room.send 是「广播」：同一条消息会投递给房间内**所有**客户端，
 * 客户端再按 dest 过滤是否属于自己。假设房间内有 8 名玩家、每人按 20Hz
 * 请求渲染，则：
 *   • 服务器每秒广播 8 × 20 = 160 个 S2CRender 包；
 *   • 每个客户端都会收到全部 160 个包（其中 159 个并非发给自己的）。
 * 这就是 pps（packets per second）过高的根源。高 pps 导致中继拥塞丢包，
 * 而增量渲染协议下「丢一个包」就会让客户端缓存缺失实体（沿用上一帧），
 * 造成渲染损坏。
 *
 * ── 批处理方案 ──────────────────────────────────────────────────
 * 所有客户端的增量渲染包先按 sessionId 暂存在本合并器中，由 Game 主循环
 * 每 tick 调用 flush()，把多个客户端的包合并为「单个」S2CRenderBatch
 * 广播：
 *
 *   {
 *     seq: 0,
 *     data: {
 *       "<sessionIdA>": [渲染条目, ...],   // A 客户端只取自己的数组
 *       "<sessionIdB>": [渲染条目, ...],   // B 客户端只取自己的数组
 *     }
 *   }
 *
 * 每个客户端只需读取 data[ownSessionId] 并渲染 —— 与旧的 dest 过滤语义
 * 完全等价。若某客户端在该次批处理中没有待发数据，则 data 中不出现其键名，
 * 客户端约定「缺失 = 沿用上一帧」，不会产生任何影响。
 *
 * ── pps 收益 ────────────────────────────────────────────────────
 * 旧：每客户端每秒收到 = 客户端数 × 请求频率（8 人 20Hz ≈ 160 包/s）
 * 新：每客户端每秒至多收到 1 个合并包 × 主循环 tick 数（20Hz）= 20 包/s
 *     且当「该 tick 没有任何客户端有待发数据」时完全跳过发送 → 0 包/s
 * （空闲静止阶段几乎零渲染包；活跃阶段也仅为固定 20 包/s，与客户端数无关）
 * ─────────────────────────────────────────────────────────────
 */
class RenderBatcher {
    /**
     * @param {import('colyseus.js').Room} networkRoom — colyseus 房间实例（room.send 广播）
     */
    constructor(networkRoom) {
        this.room = networkRoom;
        /**
         * 每客户端待发渲染条目：sessionId → 渲染条目数组。
         * 同一客户端在一次批处理窗口内多次入队时按顺序拼接。
         * @type {Map<string, Object[]>}
         */
        this._pending = new Map();
        /** 累计广播次数（统计用） */
        this._sendCount = 0;
        /** 累计合并的客户端数（统计用） */
        this._mergedCount = 0;
        /** 累计合并的渲染条目数（统计用） */
        this._entryCount = 0;
    }

    /**
     * 将某客户端的增量渲染条目并入本批待发队列
     *
     * 约定：空数组（无变化）直接忽略 —— 客户端「缺失 = 沿用上一帧」，
     * 不发送任何内容即可表达「无变化」，这正是零带宽的关键。
     *
     * @param {string} sessionId - 目标客户端 sessionId
     * @param {Object[]} entries - 增量渲染条目数组（_buildRenderPacket 返回值）
     */
    queue(sessionId, entries) {
        if (!sessionId || !Array.isArray(entries) || entries.length === 0) return;
        const prev = this._pending.get(sessionId);
        if (prev) {
            prev.push(...entries);      // 同一批窗口内多次入队 → 顺序拼接
        } else {
            this._pending.set(sessionId, [...entries]);
        }
    }

    /**
     * 将所有客户端的待发数据合并为单个 S2CRenderBatch 广播包
     *
     * - 无任何待发数据 → 跳过发送（返回 0，本 tick 渲染 pps = 0）
     * - 有数据 → 合并为一个包广播，随后清空待发队列
     *
     * @returns {number} 本次合并的客户端数（0 = 未发送）
     */
    flush() {
        if (this._pending.size === 0) return 0;

        // 合并：sessionId → 渲染条目数组（每个客户端只取自己的键）
        const data = {};
        let entries = 0;
        for (const [sid, list] of this._pending) {
            data[sid] = list;
            entries += list.length;
        }
        this._pending.clear();

        // 单个广播包：所有客户端都能收到，各自只取 data[ownSessionId]
        this.room.send('S2CRenderBatch', JSON.stringify({ seq: 0, data }));

        // 统计（供观测）
        this._sendCount++;
        this._mergedCount += Object.keys(data).length;
        this._entryCount += entries;
        return Object.keys(data).length;
    }

    /** 当前待发客户端数（调试 / 观测用） */
    pendingCount() {
        return this._pending.size;
    }

    /** 累计统计（调试 / 观测用） */
    stats() {
        return {
            sends: this._sendCount,
            mergedClients: this._mergedCount,
            mergedEntries: this._entryCount,
        };
    }
}

export default RenderBatcher;
