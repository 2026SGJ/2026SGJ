/**
 * 漂浮文字（PopText）— 伤害显示 / 界面反馈
 *
 * 旧实现使用独立的 S2CPopText 包逐条广播；重构后所有渲染内容统一走
 * S2CRender 渲染管线：漂浮文字以 { type:'popText' } 渲染条目内联进
 * S2CRender.data 数组，与实体 / 玩家 / GUI 共享同一条带宽通道。
 *
 * ── 数据格式（S2CRender 条目）──────────────────────────────
 *   {
 *     type: 'popText',          // 渲染条目类型：一次性漂浮文字
 *     id:   'poptext_12',       // 唯一 ID（客户端动画键，避免复用冲突）
 *     isFixed: false,           // true = 屏幕固定坐标（0~100）；false = 世界坐标
 *     x, y,                     // 位置（世界像素 / 视口归一化 0~100）
 *     text, color,              // 文字内容与颜色（0xRRGGBB）
 *     vx, vy,                   // 漂浮动量（像素/秒）
 *     duration,                 // 持续时间（毫秒），到期自动消失
 *     ghost,                    // 透明度 0~100（0 不透明）
 *   }
 * ─────────────────────────────────────────────────────────
 *
 * 投递策略（每玩家恰好一次）：
 *   队列中的每条文字带有严格递增的 seq；每个玩家的渲染状态记录
 *   lastPopTextSeq（上次已投递的最大 seq）。渲染组装时只取
 *   seq 更新且尚未过期（now - createdAt <= duration）的条目，
 *   保证每条文字对每个玩家只投递一次，且过期文字不再投递。
 *   过期条目由 Game 主循环每 tick 调用 prunePopTexts() 清理。
 */

/** @type {number} 漂浮文字全局自增序号（严格递增，用于按玩家去重投递） */
let popTextSeq = 0;

/** @type {Object[]} 待投递的漂浮文字队列（内部含 seq / createdAt 元数据） */
const popTextQueue = [];

/**
 * 入队一条漂浮文字（伤害显示 / 界面反馈）
 *
 * 实体逻辑深处（Player.takeDamage 等）通过本函数入队，
 * 最终由 S2CRender 渲染请求按需投递给各玩家客户端。
 *
 * @param {Object} options
 * @param {string|number} options.text   - 文字内容（伤害数字等）
 * @param {number} options.x             - 位置 X（世界坐标 / isFixed 时为视口归一化坐标）
 * @param {number} options.y             - 位置 Y（世界坐标 / isFixed 时为视口归一化坐标）
 * @param {boolean} [options.isFixed]    - true = 屏幕固定坐标（0~100）；false = 世界坐标
 * @param {number} [options.color=0xff4444] - 颜色（0xRRGGBB）
 * @param {{x:number,y:number}} [options.momentum={x:0,y:-50}] - 动量（漂浮速度，像素/秒）
 * @param {number} [options.duration=800] - 持续时间（毫秒）
 * @param {number} [options.ghost=0]     - 透明度 0~100（0=不透明，100=全透明）
 */
const pushPopText = (options = {}) => {
    const momentum = options.momentum || { x: 0, y: -50 };
    popTextQueue.push({
        seq: ++popTextSeq,                       // 投递游标（每玩家去重）
        createdAt: Date.now(),                   // 入队时间（过期清理用）
        text: String(options.text ?? ''),
        x: options.x ?? 0,
        y: options.y ?? 0,
        color: options.color ?? 0xff4444,
        vx: momentum.x ?? 0,
        vy: momentum.y ?? 0,
        duration: options.duration ?? 800,
        ghost: options.ghost ?? 0,
        isFixed: !!options.isFixed,
    });
};

/**
 * 每 tick 由 Game 层调用：将队列中的漂浮文字广播给所有人类玩家与旁观者
 * 为单个玩家构建待投递的漂浮文字渲染条目（并入 S2CRender.data）
 *
 * 投递规则：
 *   1. seq <= lastSeq        → 已投递过，跳过
 *   2. now - createdAt > duration → 客户端动画已结束，不再投递
 *   其余条目打包返回，并给出新的 lastSeq 供渲染状态记录。
 *
 * @param {number} lastSeq - 该玩家上次已投递的最大 seq（渲染状态记录）
 * @param {number} [now]   - 当前时间戳（测试可注入）
 * @returns {{entries: Object[], lastSeq: number}} 渲染条目 + 新的投递游标
 */
const buildPopTextEntries = (lastSeq, now = Date.now()) => {
    const entries = [];
    let maxSeq = lastSeq;
    for (const item of popTextQueue) {
        if (item.seq <= lastSeq) continue;                 // 已投递
        if (now - item.createdAt > item.duration) continue; // 已过期
        entries.push({
            type: 'popText',
            id: `poptext_${item.seq}`,
            isFixed: item.isFixed,
            x: item.x,
            y: item.y,
            text: item.text,
            color: item.color,
            vx: item.vx,
            vy: item.vy,
            duration: item.duration,
            ghost: item.ghost,
        });
        maxSeq = Math.max(maxSeq, item.seq);
    }
    return { entries, lastSeq: maxSeq };
};

/**
 * 每 tick 清理过期漂浮文字（保留 duration + 1s 余量，给慢请求玩家兜底）
 * 由 Game 主循环调用。
 *
 * @param {number} [now] - 当前时间戳（测试可注入）
 */
const prunePopTexts = (now = Date.now()) => {
    for (let i = popTextQueue.length - 1; i >= 0; i--) {
        const item = popTextQueue[i];
        if (now - item.createdAt > item.duration + 1000) {
            popTextQueue.splice(i, 1);
        }
    }
    // 注意：漂浮文字已并入 S2CRender 渲染管线（由渲染请求经 buildPopTextEntries
    // 按玩家去重投递），此前的 S2CPopText 广播逻辑（flushPopText）已在渲染重构时
    // 移除，这里只负责清理过期条目，不再向任何客户端直接发送。
};

export { pushPopText, buildPopTextEntries, prunePopTexts };
