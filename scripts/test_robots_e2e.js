/**
 * AI 机器人端到端集成测试（完整 Game 循环，mock 网络层）
 *
 * 通过 ESM loader（module.register + data: URL 模块 stub）将
 * src/network/index.js 替换为内存 mock，真实加载 src/game/index.js，
 * 走完整链路验证：
 *
 *   1. C2SHandshake 携带 data.robot → 玩家记录机器人兵种
 *   2. 匹配倒计时归零 → _startGame → spawnAll 为每名玩家部署机器人
 *   3. 机器人进入世界实体列表（渲染）但不在 players（不被当作玩家）
 *   4. 真实主循环运行：工程机器人自动采矿（收益归 owner）
 *   5. 玩家移除 → 机器人清理；结算 → 机器人停止行动
 *
 * 运行：node scripts/test_robots_e2e.js
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// ---- 网络层内存 mock（data: URL 模块）----
const netIndexStub = `
const handlers = {};
const sent = [];
export default {
    send(name, payload) { sent.push({ name, payload: JSON.parse(payload) }); },
    onMessage(type, handler) { handlers[type] = handler; },
    onStateChange() {},
};
export { sent, handlers };
`;
const netIndexUrl = "data:text/javascript," + encodeURIComponent(netIndexStub);

const netShopStub = `
import room, { sent } from '${netIndexUrl}';
const sendTo = (name, sessionId, data) => room.send(name, JSON.stringify({ dest: sessionId, seq: 0, data }));
export const sendOpenShop = (s, d) => sendTo('S2COpenShop', s, d);
export const sendShopList = (s, d) => sendTo('S2CShopList', s, d);
export const sendCloseShop = (s, d) => sendTo('S2CCloseShop', s, d);
export const sendBuyItem = (s, d) => sendTo('S2CBuyItem', s, d);
`;
const netShopUrl = "data:text/javascript," + encodeURIComponent(netShopStub);

const loaderStub = `
export function resolve(specifier, context, next) {
    if (specifier.endsWith('network/index.js')) {
        return { url: ${JSON.stringify(netIndexUrl)}, shortCircuit: true };
    }
    if (specifier.endsWith('network/shop.js')) {
        return { url: ${JSON.stringify(netShopUrl)}, shortCircuit: true };
    }
    return next(specifier, context);
}
`;
register(
	"data:text/javascript," + encodeURIComponent(loaderStub),
	pathToFileURL(process.cwd() + "/"),
);
// ---- 网络层内存 mock 结束 ----

const [{ default: Game }, { handlers }] = await Promise.all([
	import("../src/game/index.js"),
	import("../src/network/index.js"),
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (cond, msg) => {
	if (cond) {
		passed++;
		console.log(`  ✓ ${msg}`);
	} else {
		failed++;
		console.log(`  ✗ ${msg}`);
	}
};

// ============================================================
console.log("\n[1] Game 初始化 + 玩家加入（含机器人兵种选择）");
// 等待异步 World.init 完成（地图实体加载）
await sleep(80);
const game = new Game();
await sleep(80);
check(
	game.world.entities.length > 0,
	`世界实体已加载（${game.world.entities.length} 个）`,
);

const who1 = { sessionId: "s1", extra: { uuid: "u1" } };
const who2 = { sessionId: "s2", extra: { uuid: "u2" } };
handlers["C2SHandshake"]({
	who: who1,
	msg: JSON.stringify({ data: { hero: "newton", robot: "engineer" } }),
});
handlers["C2SHandshake"]({
	who: who2,
	msg: JSON.stringify({ data: { hero: "tesla", robot: "drone" } }),
});
check(!!game.players["s1"] && !!game.players["s2"], "两名玩家已创建");
check(game.players["s1"].robotType === "engineer", "s1 选择工程机器人");
check(game.players["s2"].robotType === "drone", "s2 选择无人机");
check(game.robotManager.all().length === 0, "匹配阶段尚未部署机器人");

// 让 s1 靠近金矿（工程机器人可快速采矿验证），s2 移至中场地带（无人机侦查巡逻）
game.players["s1"].x = 1000;
game.players["s1"].y = 3340;
game.players["s2"].x = 1280;
game.players["s2"].y = 4200;

// ============================================================
console.log("\n[2] 倒计时归零 → 对局开始 → 部署机器人");
// 匹配倒计时直接快进到归零（剩余时间 ≤ 0 → 按里程碑补满 8 人再开赛）
game.match.matchStartAt = Date.now() - 1;
game.match.tick();
check(game.match.phase === "playing", "对局开始（playing）");
const totalPlayers = Object.keys(game.players).length;
check(
	game.robotManager.all().length === totalPlayers,
	`每名玩家部署 1 个机器人（${game.robotManager.all().length}/${totalPlayers}）`,
);

const r1 = game.robotManager.forOwner("s1");
const r2 = game.robotManager.forOwner("s2");
check(!!r1 && r1.cfg.role === "miner", "s1 的工程机器人已部署");
check(!!r2 && r2.cfg.role === "combat", "s2 的无人机已部署");
check(r1.canAct === true && r2.canAct === true, "对局中机器人可行动");
check(
	game.world.entities.includes(r1) && game.world.entities.includes(r2),
	"机器人进入世界实体列表（可渲染）",
);
check(
	!("robot_s1" in game.players) && !("robot_s2" in game.players),
	"机器人不在 players（不被当作玩家）",
);

// ============================================================
console.log("\n[3] 真实主循环运行：机器人自主行动");
const moneyBefore = game.players["s1"].money;
const r2x0 = r2.x;
const r2y0 = r2.y;
// 运行约 5 秒（主循环 setInterval 驱动，20 tick/s）
await sleep(5000);
check(
	game.robotManager.all().length === Object.keys(game.players).length,
	"运行后机器人仍在场",
);
check(
	game.players["s1"].money > moneyBefore,
	`工程机器人自动采矿，收益归 owner（${moneyBefore} → ${game.players["s1"].money}）`,
);
const moved = Math.abs(r2.x - r2x0) > 1 || Math.abs(r2.y - r2y0) > 1;
check(
	moved,
	`无人机自主移动（侦查 / 战斗）（${r2x0.toFixed(0)},${r2y0.toFixed(0)} → ${r2.x.toFixed(0)},${r2.y.toFixed(0)}）`,
);

// ============================================================
console.log("\n[4] 玩家移除 → 机器人清理");
const removedId = r2.id;
game.robotManager.removeRobotFor("s2");
check(!game.robotManager.get(removedId), "移除玩家后其机器人被清理");
check(!game.world.entities.includes(r2), "机器人从世界实体移除");

// ============================================================
console.log("\n[5] 结算：机器人停止行动");
const aliveRobot = game.robotManager.forOwner("s1");
game.robotManager.stopAll();
check(aliveRobot.canAct === false, "结算后机器人停止行动");

// 停止主循环（否则进程挂起）
game.end();

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
