import room from '../network/index.js';

// ============================================================
//  一号多登白名单 (未来从数据库读取，当前硬编码)
//  白名单内的 uuid 允许同时保持多个连接，每个连接视为独立玩家
//  非白名单玩家重复登录时，踢掉旧会话，保留世界状态，清空事件队列
// ============================================================
const MULTI_LOGIN_WHITELIST = [
    // 在此添加允许一号多登的 uuid
    // 'example-uuid-1',
    // 'example-uuid-2',
];

// 非白名单: uuid → 当前主 sessionId（单连接）
let playerList = {};
// 白名单: uuid → Set of sessionIds（多连接追踪）
let playerSessions = {};

function PlayerEvent() {
    this.messageHandlers = {};
}
PlayerEvent.prototype.trigger = function (event, message) {
    if (this.messageHandlers[event]) {
        this.messageHandlers[event].forEach(handler => handler(message));
    }
};
PlayerEvent.prototype.on = function (event, handler) {
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

    if (MULTI_LOGIN_WHITELIST.includes(uuid)) {
        // 白名单玩家：仅移除本次断开的 session，其他会话不受影响
        if (playerSessions[uuid]) {
            playerSessions[uuid].delete(sessionId);
            if (playerSessions[uuid].size === 0) {
                delete playerSessions[uuid];
                delete playerList[uuid];
                playerEvent.trigger('playerRemoved', { sessionId, uuid, event: message.msg });
            } else {
                // 还有其他会话存活，只移除此 session 对应的玩家实体
                playerEvent.trigger('playerRemoved', { sessionId, uuid, event: message.msg });
                console.log(`Whitelist player ${uuid} session ${sessionId} removed, ${playerSessions[uuid].size} remaining`);
            }
        }
    } else {
        // 非白名单：仅当断开的 sessionId 匹配当前主 sessionId 时才清理
        if (playerList[uuid] && playerList[uuid] === sessionId) {
            delete playerList[uuid];
            playerEvent.trigger('playerRemoved', { sessionId, uuid, event: message.msg });
        }
        // 不匹配说明是被踢掉的旧连接，忽略
    }
});

// ============================================================
//  C2SHandshake — 玩家握手/登录
// ============================================================
room.onMessage('C2SHandshake', (message) => {
    const uuid = message.who.extra.uuid;
    const sessionId = message.who.sessionId;

    const sendHandshake = () => {
        room.send('S2CHandshake', JSON.stringify({
            dest: sessionId,
            seq: 0, //暂时不防御重放攻击。未来一定加上seq校验
            data: {/* 暂时不填充数据 */ }
        }));
    };

    if (MULTI_LOGIN_WHITELIST.includes(uuid)) {
        // --- 白名单：允许多登，每个 session 当独立玩家 ---
        if (!playerSessions[uuid]) {
            playerSessions[uuid] = new Set();
            playerList[uuid] = sessionId;
        }
        playerSessions[uuid].add(sessionId);

        playerEvent.trigger('beforeNewPlayerAdded', { sessionId, uuid, event: message.msg });
        sendHandshake();
        playerEvent.trigger('newPlayerAdded', { sessionId, uuid, event: message.msg });
        console.log(`Whitelist player ${uuid} session ${sessionId} added (${playerSessions[uuid].size} total)`);
    } else {
        // --- 非白名单：踢旧留新 ---
        if (playerList[uuid]) {
            const oldSessionId = playerList[uuid];

            // 踢掉旧会话
            room.send('S2CKick', JSON.stringify({
                dest: oldSessionId,
                seq: 0,
                data: {
                    reason: "Duplicate login: new session connected"
                }
            }));
            console.log(`Kicked old session [${oldSessionId}] for player ${uuid}, new session [${sessionId}]`);

            // 更新为新的主会话
            playerList[uuid] = sessionId;

            // 保留世界状态，清空事件队列
            playerEvent.trigger('playerReconnected', { oldSessionId, newSessionId: sessionId, uuid, event: message.msg });

            sendHandshake();
        } else {
            // 首次连接
            playerList[uuid] = sessionId;
            playerEvent.trigger('beforeNewPlayerAdded', { sessionId, uuid, event: message.msg });
            sendHandshake();
            playerEvent.trigger('newPlayerAdded', { sessionId, uuid, event: message.msg });
        }
    }
});

// ============================================================
//  C2SKeyboardEvent — 键盘事件
// ============================================================
room.onMessage('C2SKeyboardEvent', (message) => {
    const uuid = message.who.extra.uuid;
    const sessionId = message.who.sessionId;

    // 白名单：检查 sessionId 是否在集合中
    if (MULTI_LOGIN_WHITELIST.includes(uuid)) {
        if (!playerSessions[uuid] || !playerSessions[uuid].has(sessionId)) {
            console.log(`C2SKeyboardEvent from unknown session ${sessionId} (uuid ${uuid}) ignored.`);
            return;
        }
    } else {
        // 非白名单：检查 sessionId 是否匹配
        if (!playerList[uuid] || playerList[uuid] !== sessionId) {
            console.log(`C2SKeyboardEvent from unknown player ${uuid} ignored.`);
            return;
        }
    }

    playerEvent.trigger('keyboardEvent', { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SMouseEvent — 鼠标事件
// ============================================================
room.onMessage('C2SMouseEvent', (message) => {
    const uuid = message.who.extra.uuid;
    const sessionId = message.who.sessionId;

    if (MULTI_LOGIN_WHITELIST.includes(uuid)) {
        if (!playerSessions[uuid] || !playerSessions[uuid].has(sessionId)) {
            console.log(`C2SMouseEvent from unknown session ${sessionId} (uuid ${uuid}) ignored.`);
            return;
        }
    } else {
        if (!playerList[uuid] || playerList[uuid] !== sessionId) {
            console.log(`C2SMouseEvent from unknown player ${uuid} ignored.`);
            return;
        }
    }

    playerEvent.trigger('mouseEvent', { sessionId, uuid, event: message.msg });
});
