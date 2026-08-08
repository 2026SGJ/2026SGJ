import room from "../network/index.js";

// ============================================================
//  以 sessionId 为 key 追踪所有活跃会话
//  sessionId 会话间唯一，uuid 账号间唯一
//  同一账号允许多个会话同时在线，每个会话视为独立玩家
// ============================================================
const activeSessions = new Set();

function PlayerEvent() {
	this.messageHandlers = {};
}
PlayerEvent.prototype.trigger = async function (event, message) {
	let flag = true;
	if (this.messageHandlers[event]) {
		// this.messageHandlers[event].forEach(handler => handler(message));
		for (const handler of this.messageHandlers[event]) {
			try {
				// 支持异步 handler（如英雄解锁检查需要 await backend 查询）
				const result = await handler(message);
				if (result === false) flag = false;
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

const playerEvent = new PlayerEvent();
export default playerEvent;

// ============================================================
//  syscmd:playerRemoved — 玩家连接断开
// ============================================================
room.onMessage("syscmd:playerRemoved", (message) => {
	const uuid = message.player.uuid;
	const sessionId = message.player.sessionId;

	activeSessions.delete(sessionId);
	playerEvent.trigger("playerRemoved", { sessionId, uuid, event: message.msg });
});

// ============================================================
//  syscmd:newPlayerAdded — 玩家加入但未认证（尚未握手）
//  仅记录日志：真正的加入逻辑在 C2SHandshake → beforeNewPlayerAdded
// ============================================================
room.onMessage("syscmd:newPlayerAdded", (message) => {
	console.log(
		`[Session] 未认证玩家进入房间: sessionId=${message.player?.sessionId}, uuid=${message.player?.uuid}`,
	);
});

// ============================================================
//  C2SHandshake — 玩家握手/登录
//  （async：beforeNewPlayerAdded 的 handler 可能需 await backend
//   英雄解锁检查，通过后才发送 S2CHandshake 并创建玩家）
// ============================================================
room.onMessage("C2SHandshake", async (message) => {
	const uuid = message.who.extra.uuid;
	const sessionId = message.who.sessionId;
	const name = message.who && message.who.name ? message.who.name : "";

	activeSessions.add(sessionId);
	const ok = await playerEvent.trigger("beforeNewPlayerAdded", {
		sessionId,
		uuid,
		name,
		event: message.msg,
	});
	if (!ok) {
		console.log(
			`beforeNewPlayerAdded handler returned false for sessionId=${sessionId}, uuid=${uuid}. Player not added.`,
		);
		return;
	}

	room.send(
		"S2CHandshake",
		JSON.stringify({
			dest: sessionId,
			seq: 0,
			data: {},
		}),
	);

	playerEvent.trigger("newPlayerAdded", {
		sessionId,
		uuid,
		event: message.msg,
	});
});

// ============================================================
//  C2SKeyboardEvent — 键盘事件
// ============================================================
room.onMessage("C2SKeyboardEvent", (message) => {
	const sessionId = message.who.sessionId;

	if (!activeSessions.has(sessionId)) {
		console.log(`C2SKeyboardEvent from unknown session ${sessionId} ignored.`);
		return;
	}

	const uuid = message.who.extra.uuid;
	playerEvent.trigger("keyboardEvent", { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SMouseEvent — 鼠标事件
// ============================================================
room.onMessage("C2SMouseEvent", (message) => {
	const sessionId = message.who.sessionId;

	if (!activeSessions.has(sessionId)) {
		console.log(`C2SMouseEvent from unknown session ${sessionId} ignored.`);
		return;
	}

	const uuid = message.who.extra.uuid;
	playerEvent.trigger("mouseEvent", { sessionId, uuid, event: message.msg });
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
	playerEvent.trigger("gamepadEvent", { sessionId, uuid, event: message.msg });
};
room.onMessage("C2SGamepad", handleGamepadMessage);
room.onMessage("C2SGamepadEvent", handleGamepadMessage);

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
	playerEvent.trigger("touchEvent", { sessionId, uuid, event: message.msg });
};
room.onMessage("C2STouch", handleTouchMessage);
room.onMessage("C2STouchEvent", handleTouchMessage);

// ============================================================
//  C2SSelectRobot — 选择 AI 机器人兵种（进局前 5 选 1）
//  仅匹配阶段有效；对局开始后机器人已部署，禁止更换
// ============================================================
room.onMessage("C2SSelectRobot", (message) => {
	const sessionId = message.who.sessionId;
	if (!activeSessions.has(sessionId)) {
		console.log(`C2SSelectRobot from unknown session ${sessionId} ignored.`);
		return;
	}
	const uuid = message.who.extra.uuid;
	playerEvent.trigger("selectRobot", { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SBuyItem — 购买道具请求
// ============================================================
room.onMessage("C2SBuyItem", (message) => {
	const sessionId = message.who.sessionId;
	if (!activeSessions.has(sessionId)) {
		console.log(`C2SBuyItem from unknown session ${sessionId} ignored.`);
		return;
	}
	const uuid = message.who.extra.uuid;
	playerEvent.trigger("buyItem", { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SOpenShop — 打开商店请求（商店独立协议，与渲染管线解耦）
// ============================================================
room.onMessage("C2SOpenShop", (message) => {
	const sessionId = message.who.sessionId;
	if (!activeSessions.has(sessionId)) {
		console.log(`C2SOpenShop from unknown session ${sessionId} ignored.`);
		return;
	}
	const uuid = message.who.extra.uuid;
	playerEvent.trigger("openShop", { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SCloseShop — 关闭商店请求（商店独立协议，与渲染管线解耦）
// ============================================================
room.onMessage("C2SCloseShop", (message) => {
	const sessionId = message.who.sessionId;
	if (!activeSessions.has(sessionId)) {
		console.log(`C2SCloseShop from unknown session ${sessionId} ignored.`);
		return;
	}
	const uuid = message.who.extra.uuid;
	playerEvent.trigger("closeShop", { sessionId, uuid, event: message.msg });
});

// ============================================================
//  C2SUseItem — 使用道具请求
// ============================================================
room.onMessage("C2SUseItem", (message) => {
	const sessionId = message.who.sessionId;
	if (!activeSessions.has(sessionId)) {
		console.log(`C2SUseItem from unknown session ${sessionId} ignored.`);
		return;
	}
	const uuid = message.who.extra.uuid;
	playerEvent.trigger("useItem", { sessionId, uuid, event: message.msg });
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
