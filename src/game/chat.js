import room from '../network/index.js';

/**
 * 公屏聊天广播（玩家加入 / 退出 / 死亡等系统消息）
 *
 * 通过 C2CChat 广播给房间内所有客户端（真人玩家 + 旁观者），
 * 与 MatchManager._sendChat 使用同一通道（见 commit b3907a9
 * 「Refactor chat message sending to broadcast」）。
 *
 * 实现方式与 popText 一致：实体逻辑深处（Player.takeDamage 等）通过
 * pushChat 入队，Game 主循环每 tick 调用 flushChat 统一广播，
 * 避免在实体层直接依赖 players 列表 / room。
 *
 * 数据包格式（与 MatchManager._sendChat 一致）：
 *   { dest: '', seq: 0, data: { type, text, ... } }
 */

/** @type {Object[]} 待广播的公屏聊天消息队列 */
const chatQueue = [];

/**
 * 入队一条公屏播报消息（由 Game 主循环下一 tick flushChat 统一广播）
 *
 * @param {Object} data — 聊天数据（type 为消息类别，text 为展示文本，
 *                        其余字段按消息类型自定义，如 player / team / killer）
 */
const pushChat = (data) => {
    chatQueue.push(data);
};

/**
 * 每 tick 由 Game 层调用：将队列中的消息逐条广播给房间内所有客户端
 */
const flushChat = () => {
    while (chatQueue.length > 0) {
        const data = chatQueue.shift();
        room.send('C2CChat', JSON.stringify({
            dest: '',
            seq: 0,
            data,
        }));
    }
};

export { pushChat, flushChat };
