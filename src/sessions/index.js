import room from '../network/index.js';
import logger from '../../logger/index.js';

// ============================================================
//  以 sessionId 为 key 追踪所有活跃会话
//  sessionId 会话间唯一，uuid 账号间唯一
//  同一账号允许多个会话同时在线，每个会话视为独立玩家
// ============================================================
let activeSessions = new Set();

function PlayerEvent() {
    this.messageHandlers = {};
}
PlayerEvent.prototype.trigger = function (event, message) {
    logger.debug(`[sessions] 触发事件: ${event}, sessionId=${message.sessionId || '?'}, uuid=${message.uuid || '?'}`);
    if (this.messageHandlers[event]) {
        this.messageHandlers[event].forEach(handler => {
            try {
                handler(message);
            } catch (e) {
                logger.error(`[sessions] 事件处理异常: event=${event}`, e);
            }
        });
    }
};
PlayerEvent.prototype.on = function (event, handler) {
    logger.debug(`[sessions] 注册事件监听: ${event}`);
    if (!this.messageHandlers[event]) {
        this.messageHandlers[event] = [];
    }
    this.messageHandlers[event].push(handler);
};

let playerEvent = new PlayerEvent();
export default playerEvent;

// ============================================================
//  playerRemoved — 玩家连接断开
// ============================================================
room.onMessage('syscmd:playerRemoved', (message) => {
    const uuid = message.player.uuid;
    const sessionId = message.player.sessionId;

    logger.debug(`[sessions] syscmd:playerRemoved 收到: sessionId=${sessionId}, uuid=${uuid}`);
    const wasActive = activeSessions.has(sessionId);
    activeSessions.delete(sessionId);
    logger.debug(`[sessions] 活跃会话数: ${activeSessions.size}, 被移除的 session 之前${wasActive ? '活跃' : '不存在'}`);
    playerEvent.trigger('playerRemoved', { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SHandshake — 玩家握手/登录
// ============================================================
room.onMessage('C2SHandshake', (message) => {
    const uuid = message.who.extra.uuid;
    const sessionId = message.who.sessionId;

    logger.log(`[sessions] >>> C2SHandshake 收到: sessionId=${sessionId}, uuid=${uuid}, name=${message.who.extra.name || '?'}`);
    logger.debug(`[sessions] C2SHandshake 原始消息: who.sessionId=${message.who.sessionId}, who.extra=${JSON.stringify(message.who.extra)}`);

    const alreadyActive = activeSessions.has(sessionId);
    logger.debug(`[sessions] session ${sessionId} 是否已活跃: ${alreadyActive}, 当前活跃会话数: ${activeSessions.size}`);

    activeSessions.add(sessionId);
    logger.debug(`[sessions] session ${sessionId} 已加入活跃会话集合, 当前活跃数: ${activeSessions.size}`);

    // --- 触发 beforeNewPlayerAdded ---
    logger.debug(`[sessions] 触发 beforeNewPlayerAdded: sessionId=${sessionId}, uuid=${uuid}`);
    playerEvent.trigger('beforeNewPlayerAdded', { sessionId, uuid, event: message.msg });

    // --- 发送 S2CHandshake 回执 ---
    logger.debug(`[sessions] 发送 S2CHandshake 回执: dest=${sessionId}`);
    room.send('S2CHandshake', JSON.stringify({
        dest: sessionId,
        seq: 0,
        data: {}
    }));
    logger.debug(`[sessions] S2CHandshake 回执已发送`);

    // --- 触发 newPlayerAdded ---
    logger.log(`[sessions] >>> 触发 newPlayerAdded: sessionId=${sessionId}, uuid=${uuid}`);
    playerEvent.trigger('newPlayerAdded', { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SKeyboardEvent — 键盘事件
// ============================================================
room.onMessage('C2SKeyboardEvent', (message) => {
    const sessionId = message.who.sessionId;

    if (!activeSessions.has(sessionId)) {
        logger.warn(`[sessions] C2SKeyboardEvent 来自未知 session: ${sessionId}, 已忽略`);
        return;
    }

    const uuid = message.who.extra.uuid;
    logger.debug(`[sessions] C2SKeyboardEvent: sessionId=${sessionId}, uuid=${uuid}`);
    playerEvent.trigger('keyboardEvent', { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SMouseEvent — 鼠标事件
// ============================================================
room.onMessage('C2SMouseEvent', (message) => {
    const sessionId = message.who.sessionId;

    if (!activeSessions.has(sessionId)) {
        logger.warn(`[sessions] C2SMouseEvent 来自未知 session: ${sessionId}, 已忽略`);
        return;
    }

    const uuid = message.who.extra.uuid;
    logger.debug(`[sessions] C2SMouseEvent: sessionId=${sessionId}, uuid=${uuid}`);
    playerEvent.trigger('mouseEvent', { sessionId, uuid, event: message.msg });
});
