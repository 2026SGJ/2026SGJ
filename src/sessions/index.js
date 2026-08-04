import room from '../network/index.js';

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
    let flag = true;
    if (this.messageHandlers[event]) {
        // this.messageHandlers[event].forEach(handler => handler(message));
        for (const handler of this.messageHandlers[event]) {
            try {
                if (!handler(message)) flag = false;
            } catch (err) {
                console.error(err);
                flag = false;
            }
        }
    }
    return flag;
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
//  syscmd:playerRemoved — 玩家连接断开
// ============================================================
room.onMessage('syscmd:playerRemoved', (message) => {
    const uuid = message.player.uuid;
    const sessionId = message.player.sessionId;

    activeSessions.delete(sessionId);
    playerEvent.trigger('playerRemoved', { sessionId, uuid, event: message.msg });
});

// ============================================================
//  syscmd:newPlayerAdded — 玩家加入但未认证
// ============================================================
room.onMessage('syscmd:newPlayerAdded', (message) => {});

// ============================================================
//  C2SHandshake — 玩家握手/登录
// ============================================================
room.onMessage('C2SHandshake', (message) => {
    const uuid = message.who.extra.uuid;
    const sessionId = message.who.sessionId;

    activeSessions.add(sessionId);
    if (!playerEvent.trigger('beforeNewPlayerAdded', { sessionId, uuid, event: message.msg })) {
        console.log(`beforeNewPlayerAdded handler returned false for sessionId=${sessionId}, uuid=${uuid}. Player not added.`);
        return;
    }

    room.send('S2CHandshake', JSON.stringify({
        dest: sessionId,
        seq: 0,
        data: {}
    }));

    playerEvent.trigger('newPlayerAdded', { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SKeyboardEvent — 键盘事件
// ============================================================
room.onMessage('C2SKeyboardEvent', (message) => {
    const sessionId = message.who.sessionId;

    if (!activeSessions.has(sessionId)) {
        console.log(`C2SKeyboardEvent from unknown session ${sessionId} ignored.`);
        return;
    }

    const uuid = message.who.extra.uuid;
    playerEvent.trigger('keyboardEvent', { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SMouseEvent — 鼠标事件
// ============================================================
room.onMessage('C2SMouseEvent', (message) => {
    const sessionId = message.who.sessionId;

    if (!activeSessions.has(sessionId)) {
        console.log(`C2SMouseEvent from unknown session ${sessionId} ignored.`);
        return;
    }

    const uuid = message.who.extra.uuid;
    playerEvent.trigger('mouseEvent', { sessionId, uuid, event: message.msg });
});

room.onMessage('C2SGamepadEvent', (message) => {
    const sessionId = message.who.sessionId;

    if (!activeSessions.has(sessionId)) {
        console.log(`C2SGamepadEvent from unknown session ${sessionId} ignored.`);
        return;
    }

    const uuid = message.who.extra.uuid;
    playerEvent.trigger('gamepadEvent', { sessionId, uuid, event: message.msg });
});

room.onMessage('C2STouchEvent', (message) => {
    const sessionId = message.who.sessionId;

    if (!activeSessions.has(sessionId)) {
        console.log(`C2STouchEvent from unknown session ${sessionId} ignored.`);
        return;
    }

    const uuid = message.who.extra.uuid;
    playerEvent.trigger('touchEvent', { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SBuyItem — 购买道具请求
// ============================================================
room.onMessage('C2SBuyItem', (message) => {
    const sessionId = message.who.sessionId;
    if (!activeSessions.has(sessionId)) {
        console.log(`C2SBuyItem from unknown session ${sessionId} ignored.`);
        return;
    }
    const uuid = message.who.extra.uuid;
    playerEvent.trigger('buyItem', { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SUseItem — 使用道具请求
// ============================================================
room.onMessage('C2SUseItem', (message) => {
    const sessionId = message.who.sessionId;
    if (!activeSessions.has(sessionId)) {
        console.log(`C2SUseItem from unknown session ${sessionId} ignored.`);
        return;
    }
    const uuid = message.who.extra.uuid;
    playerEvent.trigger('useItem', { sessionId, uuid, event: message.msg });
});

room.onStateChange((newState) => {
    // playerEvent.trigger('stateChange', { newState });
    // console.log(`Room state changed: `, newState.players);
    newState.players.forEach((player, sessionId) => {
        console.log(`State change for session ${sessionId}: `, player);
        if (!activeSessions.has(sessionId)) {
            console.log(`State change for unknown session ${sessionId} ignored.`);
            return;
        }
        const uuid = player.uuid;
        // playerEvent.trigger('stateChange', { sessionId, uuid, event: player });
    });
});