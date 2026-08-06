import room from "../network/index.js";

/** Bot sessionId 前缀（与 BotPlayer.js 中一致） */
const BOT_SESSION_PREFIX = 'bot_';

/**
 * 判断 sessionId 是否为 Bot（无真实客户端连接）
 * 直接在本地判断前缀，避免引入 BotPlayer 造成循环依赖
 * （Player → popText → BotPlayer → Player）
 * @param {string} sessionId
 * @returns {boolean}
 */
const isBotSession = (sessionId) =>
    typeof sessionId === 'string' && sessionId.startsWith(BOT_SESSION_PREFIX);

/**
 * S2CPopText — 漂浮文字包（伤害显示）
 *
 * 当玩家对他人造成伤害时，服务器生成一条漂浮文字（如伤害数字），
 * 并广播给所有人类玩家客户端。
 *
 * 数据包字段：
 *   text      — 文字内容（如 "-40"）
 *   x, y      — 文字位置（世界坐标，像素）
 *   color     — 颜色（0xRRGGBB）
 *   vx, vy    — 动量（文字漂浮速度，像素/秒）
 *   duration  — 持续时间（毫秒），到期后文字消失
 *   ghost     — 透明度 0~100（0=完全不透明，100=完全透明）
 *
 * 实现方式：
 *   实体逻辑深处（Player.takeDamage 等）通过 pushPopText 将漂浮文字
 *   入队，Game 主循环每 tick 调用 flushPopText 统一广播，
 *   避免在实体层直接依赖 players 列表。
 */

/** @type {Object[]} 待发送的漂浮文字队列 */
const popTextQueue = [];

/**
 * 入队一条漂浮文字（伤害显示）
 *
 * @param {Object} options
 * @param {string|number} options.text   - 文字内容（伤害数字等）
 * @param {number} options.x             - 文字位置 X（世界坐标）
 * @param {number} options.y             - 文字位置 Y（世界坐标）
 * @param {number} [options.color=0xff4444] - 颜色（0xRRGGBB）
 * @param {{x:number,y:number}} [options.momentum={x:0,y:-50}] - 动量（漂浮速度，像素/秒）
 * @param {number} [options.duration=800] - 持续时间（毫秒）
 * @param {number} [options.ghost=0]     - 透明度 0~100（0=不透明，100=全透明）
 */
const pushPopText = (options = {}) => {
    const momentum = options.momentum || { x: 0, y: -50 };
    popTextQueue.push({
        text: String(options.text ?? ''),
        x: options.x ?? 0,
        y: options.y ?? 0,
        color: options.color ?? 0xff4444,
        vx: momentum.x ?? 0,
        vy: momentum.y ?? 0,
        duration: options.duration ?? 800,
        ghost: options.ghost ?? 0,
    });
};

/**
 * 每 tick 由 Game 层调用：将队列中的漂浮文字广播给所有人类玩家与旁观者
 *
 * Bot 玩家无真实客户端连接，跳过。
 *
 * @param {Object<string, *>} players — sessionId → Player 映射
 * @param {Object<string, *>} [spectators={}] — sessionId → 旁观者记录
 */
const flushPopText = (players, spectators = {}) => {
    if (popTextQueue.length === 0) return;
    const batch = popTextQueue.splice(0, popTextQueue.length);

    // 向单个接收者发送整批漂浮文字（玩家与旁观者共用）
    const send = (sessionId) => {
        // Bot 玩家跳过网络同步（无对应客户端连接）
        if (isBotSession(sessionId)) return;

        for (const item of batch) {
            room.send('S2CPopText', JSON.stringify({
                dest: sessionId,
                seq: 0,
                data: item,
            }));
        }
    };

    for (const sessionId of Object.keys(players)) send(sessionId);
    for (const sessionId of Object.keys(spectators)) send(sessionId);
};

export { pushPopText, flushPopText };
