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
    const name = message.who && message.who.name ? message.who.name : '';

    activeSessions.add(sessionId);
    if (!playerEvent.trigger('beforeNewPlayerAdded', { sessionId, uuid, name, event: message.msg })) {
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
//  C2SKeyboardEvent — 键盘事件（差分上报）
//  客户端约定：仅在按键按下 / 抬起瞬间上报，不再每帧全量上报 KeyHold：
//    { type: 'KeyDown', key: 'KeyW' }  // 按下瞬间上报一次
//    { type: 'KeyUp',   key: 'KeyW' }  // 抬起瞬间上报一次
//    { type: 'KeyHolding', key: ['KeyW', ...] }  // 可选：周期性快照对账
//  服务器按事件流增量维护 heldKeys（见 Player.processEvents），
//  C2S 方向 pps 从「20 包/s（每帧全量）」降至「按键变化频率」。
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

// ============================================================
//  C2SGamepad / C2SGamepadEvent — 游戏手柄事件（三端操作）
//  客户端上报左右双摇杆 + 扳机 + ABXY，数据格式：
//    {
//      type: 'GamepadHolding' | 'GamepadState' | 'GamepadChanged',
//      axes:    { leftX, leftY, rightX, rightY } | [lx, ly, rx, ry],
//      buttons: { a, b, x, y, lb, rb, lt, rt }    | [{pressed}, ...]
//    }
// ============================================================
const handleGamepadMessage = (message) => {
    const sessionId = message.who.sessionId;

    if (!activeSessions.has(sessionId)) {
        console.log(`C2SGamepad from unknown session ${sessionId} ignored.`);
        return;
    }

    const uuid = message.who.extra.uuid;
    playerEvent.trigger('gamepadEvent', { sessionId, uuid, event: message.msg });
};
room.onMessage('C2SGamepad', handleGamepadMessage);
room.onMessage('C2SGamepadEvent', handleGamepadMessage);

// ============================================================
//  C2STouch / C2STouchEvent — 移动端触屏事件（三端操作）
//  客户端约定：
//   - 点击虚拟按键或虚拟摇杆 → 上报虚拟数据：
//       { virtual: true, type: 'joystick'|'button', control: 'move'|'aim'|'attack'|..., x, y, pressed }
//   - 未点击虚拟按键 → 上报点击坐标：
//       { virtual: false, x, y, world: false|true }
// ============================================================
const handleTouchMessage = (message) => {
    const sessionId = message.who.sessionId;

    if (!activeSessions.has(sessionId)) {
        console.log(`C2STouch from unknown session ${sessionId} ignored.`);
        return;
    }

    const uuid = message.who.extra.uuid;
    playerEvent.trigger('touchEvent', { sessionId, uuid, event: message.msg });
};
room.onMessage('C2STouch', handleTouchMessage);
room.onMessage('C2STouchEvent', handleTouchMessage);

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