/**
 * Game 集成冒烟测试（临时）— ClientText 全链路
 * 使用网络 stub 实例化真实 Game，验证：
 *   1. 主循环 tick → 玩家 buff → 右上角状态 ClientText 创建
 *   2. _refreshRenderFingerprints → _buildRenderPacket 把个人文本发给本人
 *   3. 文本删除 → _pendingRemovals → 本人收到 { type:'delete' } 包
 *   4. 玩家移除 → removeAllClientTexts 清理
 * 运行：node scripts/_test_game_smoke.js
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const netIndexStub = `
const sent = [];
export default {
    send(name, payload) { sent.push({ name, payload: JSON.parse(payload) }); },
    onMessage() {},
    onStateChange() {},
};
export { sent };
`;
const netIndexUrl = "data:text/javascript," + encodeURIComponent(netIndexStub);
const loaderStub = `
export function resolve(specifier, context, next) {
    // 拦截 src/network/index.js（含 shop.js 的 './index.js' 相对导入）
    const fromNetwork =
        (context.parentURL || '').includes('/src/network/') &&
        specifier.endsWith('/index.js');
    if (specifier.endsWith('network/index.js') || fromNetwork) {
        return { url: ${JSON.stringify(netIndexUrl)}, shortCircuit: true };
    }
    return next(specifier, context);
}
`;
register(
	"data:text/javascript," + encodeURIComponent(loaderStub),
	pathToFileURL(process.cwd() + "/"),
);

const [{ default: Game }, { default: Player }, { default: getBuffClassById }] =
	await Promise.all([
		import("../src/game/index.js"),
		import("../src/game/match/player/index.js"),
		import("../src/game/match/buff/index.js"),
	]);

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

const game = new Game({ noWait: true });

// ---- 手工加入一个玩家（真实路径：players + _renderStates + 渲染状态） ----
const p = new Player("p_smoke", { team: "A", hero: "newton" });
p.canAct = true;
game.players["p_smoke"] = p;
game._renderStates["p_smoke"] = {
	lastSentTick: 0,
	lastFullSyncTick: 0,
	seenEntities: new Set(),
	seenIds: new Set(),
	seenPlayers: new Set(),
	lastPopTextSeq: 0,
};
p._worldRef = game.world;

console.log("\n[1] 主循环 tick → 状态 ClientText");
p.giveBuff(new (getBuffClassById("speed"))({ id: "speed", level: 60, time: 5000 }));
p.giveBuff(new (getBuffClassById("shield"))({ id: "shield", level: 300, time: 10000 }));
p.tick(game.players, game.world, game.robotManager);
check(
	p.clientTexts["status_0"]?.data.text.startsWith("加速"),
	"buff 加速 → 状态行 0",
);
check(
	p.clientTexts["status_1"]?.data.text.startsWith("护盾"),
	"护盾 buff → 状态行 1",
);

console.log("\n[2] 渲染包组装（个人文本发给本人）");
game._refreshRenderFingerprints();
const packet = game._buildRenderPacket("p_smoke");
const textEntries = packet.filter((d) => d.cloneType === "text");
check(textEntries.length >= 2, `渲染包包含个人 ClientText 条目（${textEntries.length} 条）`);
check(
	textEntries.every((d) => d.id.startsWith("p_smoke_")),
	"文本 id 带玩家前缀（其他玩家不可见）",
);
// 模拟客户端已收到，更新游标
game._renderStates["p_smoke"].lastSentTick = game.world.renderTick;
game._renderStates["p_smoke"].seenEntities.clear();

console.log("\n[3] 文本删除 → delete 包");
p.removeClientText("status_0");
game._refreshRenderFingerprints();
const packet2 = game._buildRenderPacket("p_smoke");
check(
	packet2.some((d) => d.type === "delete" && d.id === "p_smoke_status_0"),
	"删除文本 → 本人收到 { type:'delete', id:'p_smoke_status_0' }",
);
check(
	!p.clientTexts["status_0"],
	"clientTexts 中已移除",
);

console.log("\n[4] 玩家移除 → 全部文本清理");
p.clientTexts["status_1"] && p.removeClientText("status_1");
// 再放一条文本模拟残留
p.giveBuff(new (getBuffClassById("poison"))({ id: "poison", level: 2, time: 3000 }));
p.tick(game.players, game.world, game.robotManager);
check(!!p.clientTexts["status_0"], "移除前存在状态文本");
p.removeAllClientTexts();
check(Object.keys(p.clientTexts).length === 0, "removeAllClientTexts 清空全部文本");
game.end();

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
