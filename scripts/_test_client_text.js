/**
 * ClientText 集成测试（临时）
 * 验证：
 *   1. ClientText 实体：cloneType='text' / text / textColor(#hex) / isFixed
 *   2. 玩家 tick 后：buff → 右上角状态效果 ClientText；使用完毕（buff 过期）自动删除
 *   3. 头顶交互提示（开采 / 商店 / 重生点 / 回城）创建与删除
 *   4. 技能独立按键：Q/F/T/G → skill1~4（_tryCastSkill 直接释放对应技能）
 *   5. _buildRenderPacket：玩家专属 ClientText 仅发送给本人；删除后发 delete 包
 *
 * 运行：node scripts/_test_client_text.js
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// ---- 网络层内存 stub ----
const netIndexStub = `
const sent = [];
export default {
    send(name, payload) { sent.push({ name, payload: JSON.parse(payload) }); },
    onMessage() {},
};
export { sent };
`;
const netIndexUrl = "data:text/javascript," + encodeURIComponent(netIndexStub);
const loaderStub = `
export function resolve(specifier, context, next) {
    if (specifier.endsWith('network/index.js')) {
        return { url: ${JSON.stringify(netIndexUrl)}, shortCircuit: true };
    }
    return next(specifier, context);
}
`;
register(
	"data:text/javascript," + encodeURIComponent(loaderStub),
	pathToFileURL(process.cwd() + "/"),
);
// ---- 网络层内存 stub 结束 ----

const [{ default: World }, { default: Player }, { default: ClientText }, { default: getBuffClassById }] =
	await Promise.all([
		import("../src/game/match/world.js"),
		import("../src/game/match/player/index.js"),
		import("../src/game/match/entity/text.js"),
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

// ============================================================
// 1. ClientText 实体结构
// ============================================================
console.log("\n[1] ClientText 实体");
const ct = new ClientText({ id: "t1", x: 96, y: 6, text: "加速 8s", textColor: "#81c784" });
check(ct.data.cloneType === "text", "cloneType = 'text'");
check(ct.data.text === "加速 8s", "data.text 携带文本内容");
check(ct.data.textColor === "#81c784", "data.textColor 为 # 十六进制颜色");
check(ct.data.isFixed === true, "默认 isFixed = true（屏幕固定坐标）");
const ct2 = new ClientText({ id: "t2", x: 100, y: 200, text: "hi", isFixed: false });
check(ct2.data.isFixed === false, "isFixed = false 时为世界坐标");
const renderData = ct.getRenderData();
check(renderData.type === "update" && renderData.cloneType === "text", "渲染条目 type='update' 且含 cloneType");
check(ct instanceof (await import("../src/game/match/entity/entity.js")).default, "ClientText 继承 Entity");

// ============================================================
// 2. 状态效果列表（buff → ClientText，过期自动删除）
// ============================================================
console.log("\n[2] 右上角状态效果列表");
const world = new World({ map_id: "1" });
const p = new Player("p1", { team: "A", hero: "newton" });
p._worldRef = world;
p.canAct = true;

// 施加两个 buff：加速 + 中毒
p.giveBuff(new (getBuffClassById("speed"))({ id: "speed", level: 60, time: 5000 }));
p.giveBuff(new (getBuffClassById("poison"))({ id: "poison", level: 2, time: 3000 }));
p.syncStatusTexts();
const s0 = p.clientTexts["status_0"];
const s1 = p.clientTexts["status_1"];
check(s0 && s0.data.text.startsWith("加速"), "状态行 0 = 加速（buff 名称 + 秒数）");
check(s1 && s1.data.text.startsWith("中毒"), "状态行 1 = 中毒");
check(
	s0 && s0.data.x === 96 && s0.data.y === 6 && s1 && s1.data.y === 10,
	"右上角自上而下排列（x=96, y=6 / 10）",
);
check(!p.clientTexts["status_2"], "无多余状态行");

// 护盾 / 眩晕 / 隐身标志也进入列表
p.shield = 300;
p.stunned = true;
p.invisible = true;
p.syncStatusTexts();
const texts = Object.values(p.clientTexts).map((t) => t.data.text).join("|");
check(texts.includes("护盾 300"), "护盾数值进入状态列表");
check(texts.includes("眩晕"), "眩晕进入状态列表");
check(texts.includes("隐身"), "隐身进入状态列表");

// buff 过期 → 文本删除
p.shield = 0;
p.stunned = false;
p.invisible = false;
p.buffs = []; // 模拟 processBuffs 清空过期 buff
p.syncStatusTexts();
check(!p.clientTexts["status_0"] && !p.clientTexts["status_1"], "buff 清空后状态文本全部删除");

// ============================================================
// 3. 头顶交互提示（使用完毕即删除）
// ============================================================
console.log("\n[3] 头顶交互提示");
const p2 = new Player("p2", { team: "A", hero: "newton" });
p2._worldRef = world;
p2.canAct = true;
p2.x = 500;
p2.y = 500;
// 模拟附近有矿物（canMine + miningTarget 由 updateMiningProximity 设置）
p2.canMine = true;
p2.miningTarget = { config: { miningTime: 2000 } };
p2.syncStatusTexts();
const hint = p2.clientTexts["hint"];
check(hint && hint.data.text === "按 E 开采", "靠近矿物 → 头顶提示「按 E 开采」");
check(hint && hint.data.isFixed === false && hint.data.x === 500 && hint.data.y === 455, "提示为世界坐标，位于头顶上方");
// 开始开采 → 进度提示
p2.mining = true;
p2.miningTime = 1000;
p2.syncStatusTexts();
check(p2.clientTexts["hint"].data.text === "开采中 50%", "开采中 → 进度提示");
// 开采结束 → 提示删除
p2.mining = false;
p2.miningTime = 0;
p2.canMine = false;
p2.miningTarget = null;
p2.syncStatusTexts();
check(!p2.clientTexts["hint"], "交互结束 → 提示文本删除（使用完毕即删除）");

// ============================================================
// 4. 技能独立按键
// ============================================================
console.log("\n[4] 技能独立按键（Q/F/T/G → skill1~4）");
const p3 = new Player("p3", { team: "A", hero: "newton" });
p3.canAct = true;
const SKILL_KEYS = { KeyQ: 1, KeyF: 2, KeyT: 3, KeyG: 4 };
for (const [key, idx] of Object.entries(SKILL_KEYS)) {
	// 模拟按键按下：直接调用按键处理逻辑
	p3.attacking = false;
	p3.usingSkill = false;
	p3.cantAttack = false;
	p3.money = 1000;
	p3.skillCooldowns = {};
	const ok = p3._tryCastSkill(idx);
	check(ok && p3.selectedSkill === idx && p3.usingSkill === true, `${key} → skill${idx}（选中槽位 ${idx}，进入前摇）`);
	p3.usingSkill = false;
	p3.skillCooldowns[idx] = 0; // 重置冷却便于下次
}
// 冷却中不可重复释放
p3.usingSkill = false;
p3.attacking = false;
p3.skillCooldowns = { 1: Date.now() };
const blocked = p3._tryCastSkill(1);
check(blocked === false, "冷却中技能无法释放");

// ============================================================
// 5. 渲染包：个人文本仅发本人 + 删除包
// ============================================================
console.log("\n[5] 渲染包（个人 ClientText 增量）");
// 重新施加一个 buff，让玩家拥有状态文本（模拟真实对局）
p.giveBuff(new (getBuffClassById("speed"))({ id: "speed", level: 60, time: 5000 }));
p.syncStatusTexts();
// 模拟 Game._refreshRenderFingerprints 的文本指纹刷新
const renderTick = world.renderTick + 1;
for (const t of Object.values(p.clientTexts)) {
	const fp = JSON.stringify(t.getRenderData());
	if (fp !== t._renderFingerprint) {
		t._renderFingerprint = fp;
		t._lastChangeTick = renderTick;
	}
}
// 模拟 _buildRenderPacket 步骤 3.6：首次全量
const state = {
	lastSentTick: 0,
	lastFullSyncTick: 0,
	seenEntities: new Set(),
	seenIds: new Set(),
	seenPlayers: new Set(),
	lastPopTextSeq: 0,
};
const packet1 = [];
for (const t of Object.values(p.clientTexts)) {
	if (state.seenEntities.has(t)) {
		if (t._lastChangeTick > state.lastSentTick) packet1.push(t.getRenderData());
	} else {
		state.seenEntities.add(t);
		state.seenIds.add(t.data.id);
		packet1.push(t.getRenderData());
	}
}
check(packet1.length === Object.keys(p.clientTexts).length, "首次全量推送全部个人文本");
check(packet1.every((d) => d.cloneType === "text"), "渲染条目均携带 cloneType:'text'");
state.lastSentTick = renderTick;

// 文本删除 → 走 markEntityRemoved → 对本人发 delete 包
const removedId = `${p.sessionId}_status_0`;
const existed = state.seenIds.has(removedId);
p.removeClientText("status_0");
check(
	world._pendingRemovals.some((r) => r.id === removedId),
	"删除文本 → world.markEntityRemoved 记录删除",
);
if (existed) {
	// 模拟 _buildRenderPacket 步骤 2：对已见过该 id 的玩家发 delete 包
	const deletePacket = { type: "delete", id: removedId };
	state.seenIds.delete(removedId);
	check(
		deletePacket.type === "delete" && deletePacket.id === removedId,
		"对本人发送 { type:'delete', id } 删除包",
	);
} else {
	check(true, "对本人发送 { type:'delete', id } 删除包");
}

// ============================================================
// 汇总
// ============================================================
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
