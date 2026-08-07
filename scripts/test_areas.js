/**
 * 区域效果系统集成测试
 *
 * 通过 ESM loader（module.register + data: URL 模块 stub）将
 * src/network/index.js 替换为内存 stub，无需连接真实服务器即可验证：
 *
 *   1. 区域数据：2560×7200 地图划分为 4×20=80 个 640×360 区块，网格 / 配置合法
 *   2. 区块实体：每个区块中心（内部坐标 320,180）生成 type:'entity'、
 *      z-index:-1 的区域实体，asset 来自 enum/areas，区块精确平铺（无缝衔接）
 *   3. 区块判定：边界归属正确（x=639→col0 / x=640→col1），地图外返回 -1
 *   4. 效果附加/清除：进入区块附加（speed/damage 倍率 + _currentAreas），
 *      离开区块清除（倍率重置、当前区域清空）
 *   5. 持续效果：回血 / 中毒掉血每 tick 结算；匹配阶段中毒不致死
 *   6. 伤害倍率：攻击者位于力量回廊/混沌裂隙时，普攻 / 技能 / 机器人攻击伤害提升
 *   7. 机器人：同玩家一样获得区域效果（speed / damage / heal / dot）
 *   8. 客户端展示：remoteData().state.areas 携带当前生效区域（id/name/asset/effects）
 *
 * 运行：node scripts/test_areas.js
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// ---- 网络层内存 stub（data: URL 模块）----
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

const [
	{ default: World },
	{ default: AreaManager },
	{ default: Player },
	{ default: AreaNames },
	{ default: areaData },
	{ default: Entity },
] = await Promise.all([
	import("../src/game/match/world.js"),
	import("../src/game/match/area/AreaManager.js"),
	import("../src/game/match/player/index.js"),
	import("../src/assets/enum/areas/index.js"),
	import("../src/assets/data/areas/index.js"),
	import("../src/game/match/entity/entity.js"),
]);

const { AREA_BLOCK_W, AREA_BLOCK_H, AREA_GRID, AREA_CONFIG } = areaData;

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
// 1. 区域数据完整性
// ============================================================
console.log("\n[1] 区域数据");
const BLOCK_W = 640;
const BLOCK_H = 360;
check(AREA_BLOCK_W === BLOCK_W && AREA_BLOCK_H === BLOCK_H, "区块尺寸 640×360");
const gridRows = AREA_GRID.length;
const gridCols = AREA_GRID[0].length;
check(
	gridRows === 20 && gridCols === 4,
	`区块网格 20 行 × 4 列（实际 ${gridRows}×${gridCols}）`,
);
// 网格中每个 id 都有配置，且配置中的 asset 都能在枚举中找到
const gridIds = new Set();
for (const row of AREA_GRID) for (const id of row) gridIds.add(id);
let badConfig = 0;
for (const id of gridIds) {
	if (!AREA_CONFIG[id]) {
		badConfig++;
		console.log(`  ✗ 网格区域 ${id} 缺少配置`);
	}
	const cfg = AREA_CONFIG[id];
	const found = Object.values(AreaNames).includes(cfg.asset);
	if (!found) {
		badConfig++;
		console.log(`  ✗ 区域 ${id} 的 asset ${cfg.asset} 不在 enum/areas 中`);
	}
}
check(
	badConfig === 0,
	`网格区域全部有配置且 asset 合法（共 ${gridIds.size} 种）`,
);
// 区块总数 = 行 × 列
check(gridRows * gridCols === 80, "区块总数 80");

// ============================================================
// 测试环境：真实 World（读取 map/1.json）+ AreaManager
// ============================================================
console.log("\n[2] 区块实体生成");
const world = new World({ map_id: "1" });
const game = { world, match: { phase: "playing" } };
const am = new AreaManager(game);
am.init();

check(
	am.areas.length === 80,
	`AreaManager 生成 80 个区块（实际 ${am.areas.length}）`,
);
check(
	am.cols === 4 && am.rows === 20,
	`区块网格 4 列 × 20 行（实际 ${am.cols}×${am.rows}）`,
);
// 地图 50 个实体 + 2 个默认基地（地图未定义 base 时 World 自动补建）+ 80 个区域 = 132
check(
	world.entities.length === 50 + 2 + 80,
	`世界实体 50 + 2 默认基地 + 80 区域 = ${50 + 2 + 80}（实际 ${world.entities.length}）`,
);

// 每个区块实体：位于区块中心、type=entity、z-index=-1、asset 来自枚举、静态
let entityOk = 0;
for (const a of am.areas) {
	const e = a.entity;
	const expectX = a.col * BLOCK_W + BLOCK_W / 2;
	const expectY = a.row * BLOCK_H + BLOCK_H / 2;
	if (
		e.data.type === "entity" &&
		e.data.x === expectX &&
		e.data.y === expectY &&
		e.data["z-index"] === -1 &&
		e.data.width === BLOCK_W &&
		e.data.height === BLOCK_H &&
		e.data.asset === AREA_CONFIG[a.id].asset &&
		e.data.areaId === a.id &&
		e._isStatic === true &&
		e._renderFingerprint !== null
	) {
		entityOk++;
	}
}
check(
	entityOk === 80,
	"区块实体全部位于中心(320,180)、type=entity、z-index=-1、asset 正确、静态缓存",
);

// 区块无缝衔接：整图覆盖无缝隙、无重叠（每个点唯一映射一个区块）
let seamlessOk = true;
for (let x = 0; x < 2560; x += 7) {
	for (let y = 0; y < 7200; y += 11) {
		const idx = am.getAreaIndex(x, y);
		const a = am.getAreaAt(x, y);
		if (idx < 0 || !a) {
			seamlessOk = false;
			break;
		}
		// 点必须落在该区块范围内
		if (
			x < a.col * BLOCK_W ||
			x >= (a.col + 1) * BLOCK_W ||
			y < a.row * BLOCK_H ||
			y >= (a.row + 1) * BLOCK_H
		) {
			seamlessOk = false;
			break;
		}
	}
}
check(seamlessOk, "全图逐点采样均唯一映射到区块（无缝隙、无重叠）");

// 边界归属：x=639 → col0，x=640 → col1（相邻区块精确贴合）
check(
	am.getAreaAt(639, 100).col === 0 && am.getAreaAt(640, 100).col === 1,
	"区块边界归属：x=639→col0 / x=640→col1",
);
check(am.getAreaIndex(-1, 100) === -1, "地图外（x<0）返回 -1");
check(am.getAreaIndex(2560, 100) === -1, "地图外（x≥2560）返回 -1");
check(am.getAreaIndex(100, 7200) === -1, "地图外（y≥7200）返回 -1");

// ============================================================
// 测试环境：真实玩家 / 机器人
// ============================================================
const makePlayer = (sessionId, team = "A", x = 1280, y = 6840) => {
	const p = new Player(sessionId, { team, hero: "newton" });
	p.x = x;
	p.y = y;
	return p;
};

const noRobots = null;
const tick = (units, robots = noRobots) => am.tick(units, robots);

console.log("\n[3] 效果附加 / 清除（玩家）");
// 疾风带：speed +25%
const hastePlayer = makePlayer("p_haste", "A", 960, 900); // row2 col1 = haste
tick({ p_haste: hastePlayer });
check(
	Math.abs(hastePlayer._areaSpeedMult - 1.25) < 1e-9,
	`疾风带移速倍率 1.25（实际 ${hastePlayer._areaSpeedMult}）`,
);
check(
	hastePlayer._currentAreas.length === 1 &&
		hastePlayer._currentAreas[0].id === "haste",
	"当前区域列表包含 haste（id 正确）",
);
check(
	hastePlayer._currentAreas[0].asset === AreaNames.AREA_HASTE &&
		hastePlayer._currentAreas[0].effects.speed === 25,
	"当前区域携带 asset 与 effects",
);

// 泥沼：speed -30%
const slowPlayer = makePlayer("p_slow", "A", 320, 900); // row2 col0 = slow
tick({ p_slow: slowPlayer });
check(
	Math.abs(slowPlayer._areaSpeedMult - 0.7) < 1e-9,
	`泥沼移速倍率 0.7（实际 ${slowPlayer._areaSpeedMult}）`,
);

// 安全区：无效果
const safePlayer = makePlayer("p_safe", "A", 960, 1440); // row4 col1 = safe
tick({ p_safe: safePlayer });
check(
	safePlayer._areaSpeedMult === 1 &&
		safePlayer._areaDmgMult === 1 &&
		safePlayer._currentAreas.length === 0,
	"安全区无任何效果",
);

// 混沌裂隙：damage +15%（无 speed）
const riftPlayer = makePlayer("p_rift", "A", 1600, 3780); // row10 col2 = rift
tick({ p_rift: riftPlayer });
check(
	Math.abs(riftPlayer._areaDmgMult - 1.15) < 1e-9 &&
		riftPlayer._areaSpeedMult === 1,
	`混沌裂隙伤害倍率 1.15、移速不变（实际 ${riftPlayer._areaDmgMult}）`,
);
check(riftPlayer._currentAreas[0].id === "rift", "混沌裂隙进入 _currentAreas");

// 离开区块 → 效果清除（移动到安全区：row9 col1）
riftPlayer.x = 960;
riftPlayer.y = 3420;
tick({ p_rift: riftPlayer });
check(
	riftPlayer._areaDmgMult === 1 &&
		riftPlayer._areaSpeedMult === 1 &&
		riftPlayer._currentAreas.length === 0,
	"离开区块后效果清除（倍率重置、当前区域清空）",
);

// 跨区块直接切换（例如 slow → haste 相邻边界）
slowPlayer.x = 960; // row2 col1 = haste（相邻）
slowPlayer.y = 900;
tick({ p_slow: slowPlayer });
check(
	Math.abs(slowPlayer._areaSpeedMult - 1.25) < 1e-9 &&
		slowPlayer._currentAreas[0].id === "haste",
	"相邻区块直接切换效果（slow → haste）",
);

console.log("\n[4] 持续效果（回血 / 中毒）");
// 生命之泉：每秒回 5
const regenPlayer = makePlayer("p_regen", "A", 960, 540); // row1 col1 = regen
regenPlayer.health = regenPlayer.maxHealth - 40;
tick({ p_regen: regenPlayer });
const regenBefore = regenPlayer.health;
for (let i = 0; i < 20; i++) tick({ p_regen: regenPlayer }); // 1 秒
const regenHealed = regenPlayer.health - regenBefore;
check(
	regenHealed >= 4.5 && regenHealed <= 5.5,
	`生命之泉 1 秒回复 ≈ 5 点（实际 +${regenHealed.toFixed(2)}）`,
);

// 剧毒沼泽：每秒掉 8
const poisonPlayer = makePlayer("p_poison", "A", 960, 1980); // row5 col1 = poison
tick({ p_poison: poisonPlayer });
const poisonBefore = poisonPlayer.health;
for (let i = 0; i < 20; i++) tick({ p_poison: poisonPlayer }); // 1 秒
const poisonTaken = poisonBefore - poisonPlayer.health;
check(
	poisonTaken >= 7.5 && poisonTaken <= 8.5,
	`剧毒沼泽 1 秒受到 ≈ 8 点伤害（实际 -${poisonTaken.toFixed(2)}）`,
);

// 中毒致死：足够长时间后死亡（血量为 1200，8/s 需 150 秒；改用低血量直接验证）
// 注意：canRevive 默认 true → 死亡后会在基地满血复活，测试置为 false 验证真正死亡
const fragile = makePlayer("p_fragile", "A", 960, 1980);
fragile.health = 10;
fragile.canRevive = false;
tick({ p_fragile: fragile });
for (let i = 0; i < 60; i++) tick({ p_fragile: fragile }); // 3 秒
check(
	fragile.dead === true && fragile.health <= 0,
	`中毒可致死（dead=${fragile.dead}, health=${fragile.health.toFixed(1)}）`,
);

// 匹配阶段：中毒不致死
const lobbyPlayer = makePlayer("p_lobby", "A", 960, 1980);
lobbyPlayer.health = 10;
game.match.phase = "matching";
tick({ p_lobby: lobbyPlayer });
for (let i = 0; i < 60; i++) tick({ p_lobby: lobbyPlayer });
check(lobbyPlayer.health === 10, "匹配阶段中毒不掉血（大厅不致死）");
game.match.phase = "playing";

console.log("\n[4.5] 人机（BotPlayer）同样获得区域效果");
// BotPlayer 继承 Player，区域效果由 AreaManager 外部结算，与真人玩家完全一致
const { default: BotPlayer } = await import(
	"../src/game/match/bot/BotPlayer.js"
);
const bot = new BotPlayer("bot_area_test", { team: "A", hero: "newton" });
bot.x = 960; // row2 col1 = haste
bot.y = 900;
tick({ bot_area_test: bot });
check(
	Math.abs(bot._areaSpeedMult - 1.25) < 1e-9 &&
		bot._currentAreas[0].id === "haste",
	`人机进入疾风带移速倍率 1.25（实际 ${bot._areaSpeedMult}）`,
);
bot.x = 960; // row5 col1 = poison
bot.y = 1980;
bot.health = bot.maxHealth - 30;
tick({ bot_area_test: bot });
for (let i = 0; i < 20; i++) tick({ bot_area_test: bot });
check(
	bot.health < bot.maxHealth - 30 + 1,
	`人机在剧毒沼泽持续掉血（health=${bot.health.toFixed(1)}）`,
);

console.log("\n[5] 伤害倍率（攻击者侧挂钩）");
// 力量回廊：damage +20%
const mightPlayer = makePlayer("p_might", "A", 960, 2700); // row7 col1 = might
tick({ p_might: mightPlayer });
check(
	Math.abs(mightPlayer._areaDmgMult - 1.2) < 1e-9,
	`力量回廊伤害倍率 1.2（实际 ${mightPlayer._areaDmgMult}）`,
);

const victim1 = makePlayer("p_victim1", "B", 1280, 3000);
victim1.health = 1000;
victim1.takeDamage(100, mightPlayer); // 攻击者在力量回廊
check(
	Math.abs(victim1.health - (1000 - 120)) < 1e-9,
	`玩家普攻/技能伤害 ×1.2（-120，实际 -${1000 - victim1.health}）`,
);

// 无区域效果时不受影响
const plainPlayer = makePlayer("p_plain", "A", 960, 1440); // safe
tick({ p_plain: plainPlayer });
const victim2 = makePlayer("p_victim2", "B", 1280, 3000);
victim2.health = 1000;
victim2.takeDamage(100, plainPlayer);
check(victim2.health === 900, "安全区攻击者伤害不变化（-100）");

// 机器人攻击也享受区域伤害倍率
const { default: RobotEntity } = await import(
	"../src/game/match/robot/RobotEntity.js"
);
const mightRobot = new RobotEntity({
	id: "robot_test",
	ownerId: "p_might",
	team: "A",
	robotType: "infantry",
	x: 960,
	y: 2700,
});
tick({ p_might: mightPlayer }, { all: () => [mightRobot] });
check(
	Math.abs(mightRobot._areaDmgMult - 1.2) < 1e-9,
	`机器人进入力量回廊伤害倍率 1.2（实际 ${mightRobot._areaDmgMult}）`,
);
const victim3 = makePlayer("p_victim3", "B", 1280, 3000);
victim3.health = 1000;
victim3.takeDamage(100, mightRobot);
check(
	Math.abs(victim3.health - (1000 - 120)) < 1e-9,
	`机器人攻击伤害 ×1.2（-120，实际 -${1000 - victim3.health}）`,
);

console.log("\n[6] 机器人持续效果");
// 生命之泉回血（机器人 hp 字段）
const regenRobot = new RobotEntity({
	id: "robot_regen",
	ownerId: "p_regen",
	team: "A",
	robotType: "infantry",
	x: 960,
	y: 540,
});
regenRobot.hp = regenRobot.maxHp - 40;
tick({ p_regen: regenPlayer }, { all: () => [regenRobot] });
const rBefore = regenRobot.hp;
for (let i = 0; i < 20; i++)
	tick({ p_regen: regenPlayer }, { all: () => [regenRobot] });
const rHealed = regenRobot.hp - rBefore;
check(
	rHealed >= 4.5 && rHealed <= 5.5,
	`机器人 1 秒回复 ≈ 5 点（实际 +${rHealed.toFixed(2)}）`,
);

// 剧毒沼泽掉血（机器人 hp 字段）
const poisonRobot = new RobotEntity({
	id: "robot_poison",
	ownerId: "p_poison",
	team: "A",
	robotType: "infantry",
	x: 960,
	y: 1980,
});
tick({ p_poison: poisonPlayer }, { all: () => [poisonRobot] });
const rPBefore = poisonRobot.hp;
for (let i = 0; i < 20; i++)
	tick({ p_poison: poisonPlayer }, { all: () => [poisonRobot] });
const rPTaken = rPBefore - poisonRobot.hp;
check(
	rPTaken >= 7.5 && rPTaken <= 8.5,
	`机器人 1 秒受到 ≈ 8 点伤害（实际 -${rPTaken.toFixed(2)}）`,
);

// 宕机后不享受效果
poisonRobot.hp = 5;
tick({ p_poison: poisonPlayer }, { all: () => [poisonRobot] });
for (let i = 0; i < 40; i++)
	tick({ p_poison: poisonPlayer }, { all: () => [poisonRobot] });
check(
	!poisonRobot.alive || poisonRobot.hp === 0,
	"机器人宕机后不再结算区域效果",
);

// 机器人移速倍率
const hasteRobot = new RobotEntity({
	id: "robot_haste",
	ownerId: "p_haste",
	team: "A",
	robotType: "infantry",
	x: 960,
	y: 900,
});
tick({ p_haste: hastePlayer }, { all: () => [hasteRobot] });
check(
	Math.abs(hasteRobot._areaSpeedMult - 1.25) < 1e-9,
	`机器人疾风带移速倍率 1.25（实际 ${hasteRobot._areaSpeedMult}）`,
);

console.log("\n[7] 客户端渲染展示");
const clientPlayer = makePlayer("p_client", "A", 1600, 3780); // rift
tick({ p_client: clientPlayer });
const rd = clientPlayer.remoteData();
check(
	Array.isArray(rd.state.areas) &&
		rd.state.areas.length === 1 &&
		rd.state.areas[0].id === "rift",
	"remoteData().state.areas 携带当前区域",
);
check(
	rd.state.areas[0].name === "混沌裂隙" &&
		rd.state.areas[0].asset === AreaNames.AREA_RIFT,
	"areas 携带展示用 name / asset",
);
check(
	rd.state.areas[0].effects.dot === 5 &&
		rd.state.areas[0].effects.damage === 15,
	"areas 携带 effects 明细",
);

// 离开后 areas 清空（移动到安全区：row9 col1）
clientPlayer.x = 960;
clientPlayer.y = 3420;
tick({ p_client: clientPlayer });
const rd2 = clientPlayer.remoteData();
check(
	Array.isArray(rd2.state.areas) && rd2.state.areas.length === 0,
	"离开区块后 areas 清空（客户端可隐藏展示）",
);

// 基地庇护：回血
const basePlayer = makePlayer("p_base", "A", 1600, 7020); // row19 col2 = base_A
tick({ p_base: basePlayer });
check(
	basePlayer._currentAreas[0] && basePlayer._currentAreas[0].id === "base_A",
	"A 队基地庇护区生效",
);
basePlayer.health = basePlayer.maxHealth - 40;
const baseBefore = basePlayer.health;
for (let i = 0; i < 20; i++) tick({ p_base: basePlayer });
check(
	basePlayer.health - baseBefore >= 7.5 &&
		basePlayer.health - baseBefore <= 8.5,
	`基地庇护 1 秒回复 ≈ 8 点（实际 +${(basePlayer.health - baseBefore).toFixed(2)}）`,
);

// ============================================================
// 汇总
// ============================================================
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
