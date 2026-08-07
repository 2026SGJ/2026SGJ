/**
 * AI 机器人系统集成测试（AI 机器人 ≠ 人机补位）
 *
 * 通过 ESM loader（module.register + data: URL 模块 stub）将
 * src/network/index.js 替换为内存 stub，无需连接真实服务器即可验证：
 *
 *   1. 兵种数据完整性（5 类机器人，数值与 desc.txt 换算一致）
 *   2. 部署：spawnFor / spawnAll → 机器人进入世界实体列表但不在 players
 *   3. 行为：工程机器人采矿（收益归 owner）、战斗机器人攻击敌人、哨兵跟随玩家
 *   4. 战斗：机器人攻击玩家 / 敌方机器人，玩家可攻击机器人
 *   5. 死亡：宕机 / 自爆，死亡后无法复活，从管理器移除
 *   6. 词条：applyRobotTrait / drawRobotTrait 去重
 *   7. 无人机拆前哨站（drainByRobot）
 *   8. 不被当作玩家：不参与 players 统计（_countAlive 等价逻辑）
 *
 * 运行：node scripts/test_robots.js
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
	{ default: RobotManager },
	{ default: RobotEntity },
	{ default: ROBOT_TYPES },
	{ ROBOT_IDS, isRobotType, pickRandomRobotType },
	{ applyRobotTrait, drawRobotTrait },
	{ default: Mineral },
	{ default: Outpost },
	{ default: Base },
	{ default: Player },
	{ default: HERODATAS },
] = await Promise.all([
	import("../src/game/match/robot/RobotManager.js"),
	import("../src/game/match/robot/RobotEntity.js"),
	import("../src/assets/data/robots/robots.js"),
	import("../src/assets/data/robots/robots.js"),
	import("../src/assets/data/robots/traits.js"),
	import("../src/game/match/entity/mineral.js"),
	import("../src/game/match/entity/outpost.js"),
	import("../src/game/match/entity/base.js"),
	import("../src/game/match/player/index.js"),
	import("../src/assets/data/heros/index.js"),
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
// 1. 兵种数据完整性（desc.txt 数值 × 1.4 / ÷ 40 换算）
// ============================================================
console.log("\n[1] 兵种数据");
check(ROBOT_IDS.length === 5, `5 类机器人（实际 ${ROBOT_IDS.length}）`);
const expect = {
	engineer: { hp: 1400, speed: 6.25, damage: 50, cd: 5000, role: "miner" },
	infantry: { hp: 1120, speed: 8.75, damage: 80, cd: 500, role: "combat" },
	hero: { hp: 840, speed: 4.5, damage: 300, cd: 2000, role: "combat" },
	drone: {
		hp: 1120,
		speed: 7.5,
		damage: 75,
		cd: 250,
		role: "combat",
		structure: true,
	},
	sentinel: { hp: 1260, speed: 7.5, damage: 120, cd: 667, role: "escort" },
};
for (const [type, exp] of Object.entries(expect)) {
	const cfg = ROBOT_TYPES[type];
	check(cfg && cfg.hp === exp.hp, `${type} 血量 ${exp.hp}（实际 ${cfg?.hp}）`);
	check(
		cfg && cfg.speed === exp.speed,
		`${type} 移速 ${exp.speed}（实际 ${cfg?.speed}）`,
	);
	check(
		cfg && cfg.damage === exp.damage,
		`${type} 伤害 ${exp.damage}（实际 ${cfg?.damage}）`,
	);
	check(
		cfg && cfg.cd === exp.cd,
		`${type} 射速间隔 ${exp.cd}ms（实际 ${cfg?.cd}）`,
	);
	check(cfg && cfg.role === exp.role, `${type} 角色 ${exp.role}`);
	if (exp.structure) check(cfg.structure === true, `${type} 可拆塔`);
}
check(isRobotType("drone") && !isRobotType("mecha"), "isRobotType 校验");
check(ROBOT_IDS.includes(pickRandomRobotType()), "pickRandomRobotType 合法");

// ============================================================
// 测试环境：世界 + 玩家桩
// ============================================================
console.log("\n[2] 世界与环境");
const world = {
	mapSize: { width: 2560, height: 7200 },
	walls: [],
	itemEntities: [],
	entities: [],
	minerals: [
		new Mineral({
			id: "m1",
			type: "mineral",
			mineral: "gold",
			x: 1280,
			y: 3200,
			width: 50,
			height: 50,
			asset: "mineral_gold",
			isShowed: true,
		}),
	],
	outposts: [
		new Outpost({
			id: "op1",
			type: "outpost",
			x: 1280,
			y: 1000,
			asset: "outpost_neutral",
			isShowed: true,
		}),
	],
	bases: [
		new Base({
			id: "base_A",
			type: "base",
			team: "A",
			x: 1280,
			y: 6840,
			asset: "base_A",
			isShowed: true,
		}),
		new Base({
			id: "base_B",
			type: "base",
			team: "B",
			x: 1280,
			y: 360,
			asset: "base_B",
			isShowed: true,
		}),
	],
	addRobot(r) {
		this.entities.push(r);
	},
	removeRobot(r) {
		const i = this.entities.indexOf(r);
		if (i !== -1) this.entities.splice(i, 1);
	},
	markEntityRemoved() {},
};

const makePlayer = (sessionId, team, x, y, health = 1000) => ({
	sessionId,
	team,
	x,
	y,
	health,
	maxHealth: health,
	dead: false,
	name: sessionId,
	money: 0,
	kills: 0,
	giveBuff() {},
	takeKnockback() {},
	takeDamage(amount, attacker) {
		this.health -= amount;
		if (this.health <= 0) {
			this.health = 0;
			this.dead = true;
		}
		if (attacker && attacker !== this)
			attacker.kills = (attacker.kills || 0) + 1;
	},
});

const game = {
	match: { phase: "playing" },
	players: {
		humanA: makePlayer("humanA", "A", 1280, 3000),
		botB: makePlayer("botB", "B", 1280, 3400),
	},
	world,
};
const manager = new RobotManager(game);

// ============================================================
// 3. 部署：机器人进入世界实体但不在 players
// ============================================================
console.log("\n[3] 部署");
const ra = manager.spawnFor(game.players.humanA, "engineer");
check(manager.forOwner("humanA") === ra, "spawnFor 注册机器人");
check(world.entities.includes(ra), "机器人加入世界实体列表");
check(!(ra.id in game.players), "机器人不在 players（不被当作玩家）");
check(ra.canAct === true, "对局中机器人可行动");
check(ra.cfg.role === "miner", "engineer 角色为 miner");
const rb = manager.spawnFor(game.players.botB, "drone");
check(rb.cfg.structure === true, "drone 可拆塔");

// ============================================================
// 4. 工程机器人采矿：收益归 owner
// ============================================================
console.log("\n[4] 工程机器人采矿");
// 让工程机器人站在矿物上（距离 0 < MINING_RANGE 35）
ra.x = 1280;
ra.y = 3200;
ra._miningTarget = world.minerals[0];
ra._mining = true;
ra._movePoint = { x: 1280, y: 3200 };
for (let i = 0; i < 80; i++) {
	// 80 tick × 50ms = 4000ms > gold miningTime 3000ms
	ra.tick({
		players: game.players,
		world,
		manager,
		owner: game.players.humanA,
	});
}
check(world.minerals[0].collected === true, "矿物被采集");
check(
	game.players.humanA.money === 20,
	`采矿收益归 owner +20（实际 ${game.players.humanA.money}）`,
);
check(manager.forOwner("humanA") === ra, "采矿后机器人仍在场");

// ============================================================
// 5. 战斗：战斗机器人攻击敌人 / 敌方机器人
// ============================================================
console.log("\n[5] 战斗行为");
// 把无人机放到敌方玩家旁边（攻击范围内）
rb.x = 1280;
rb.y = 3400; // botB 在 (1280, 3400)？botB 是己方，需敌方
game.players.humanA.x = 1280;
game.players.humanA.y = 3400;
// botB 是 B 队，drone 也是 B 队 → 不会攻击 botB；把 humanA 放近
const before = game.players.humanA.health;
for (let i = 0; i < 10; i++) {
	rb.tick({ players: game.players, world, manager, owner: game.players.botB });
}
check(
	game.players.humanA.health < before,
	`无人机攻击敌方玩家（${before} → ${game.players.humanA.health}）`,
);

// 机器人攻击敌方机器人
const humanB = makePlayer("humanB", "B", 1280, 3600);
game.players.humanB = humanB;
const sentinelB = manager.spawnFor(humanB, "sentinel"); // B 队哨兵
const droneA = manager.spawnFor(game.players.humanA, "drone"); // A 队无人机（覆盖 engineer）
droneA.x = 1280;
droneA.y = 3000;
sentinelB.x = 1280;
sentinelB.y = 2950;
const sbBefore = sentinelB.hp;
for (let i = 0; i < 15; i++) {
	droneA.tick({
		players: game.players,
		world,
		manager,
		owner: game.players.humanA,
	});
	sentinelB.tick({ players: game.players, world, manager, owner: humanB });
}
check(
	sentinelB.hp < sbBefore,
	`无人机攻击敌方机器人（${sbBefore} → ${sentinelB.hp}）`,
);

// ============================================================
// 6. 哨兵跟随玩家
// ============================================================
console.log("\n[6] 哨兵跟随");
sentinelB.x = 1280;
sentinelB.y = 3400; // 距 humanB (1280, 3600) 200px
sentinelB.hp = sentinelB.maxHp; // 重置（避免上一段战斗影响）
game.players.humanB.x = 1280;
game.players.humanB.y = 3600;
for (let i = 0; i < 120; i++) {
	sentinelB.tick({
		players: game.players,
		world,
		manager,
		owner: game.players.humanB,
	});
}
const sd = Math.hypot(sentinelB.x - 1280, sentinelB.y - 3600);
check(sd < 220, `哨兵跟随玩家（距离 ${sd.toFixed(0)} < 220）`);

// ============================================================
// 7. 玩家可攻击机器人（真实 Player.findTarget 含机器人）
// ============================================================
console.log("\n[7] 玩家攻击机器人");
// 把哨兵挪回玩家附近供选中
sentinelB.x = 1280;
sentinelB.y = 3000;
sentinelB.hp = sentinelB.maxHp;
const realP = new Player("realA", { team: "A", hero: "newton" });
realP.x = 1280;
realP.y = 2960;
const target = realP.findTarget(game.players, manager);
check(
	target === sentinelB || target === droneA,
	"玩家 findTarget 可选中敌方机器人",
);
const t2 = realP.findTargetsInRange(game.players, 500, manager);
check(
	t2.some(({ player }) => player === sentinelB || player === droneA),
	"AOE findTargetsInRange 含敌方机器人",
);

// ============================================================
// 8. 死亡：宕机（可复活）/ 自爆（无法复活）
// ============================================================
console.log("\n[8] 死亡（宕机可复活 / 自爆不可复活）");
const testRobot = manager.spawnFor(game.players.humanA, "sentinel"); // 覆盖 humanA 的 drone
// 先 tick 一次，注入 players/manager 引用（真实对局中机器人每帧都在 tick）
testRobot.tick({
	players: game.players,
	world,
	manager,
	owner: game.players.humanA,
});
testRobot._forceDown = true; // 强制宕机分支（确定性测试）
testRobot.hp = 1;
testRobot.takeDamage(999, game.players.botB);
check(testRobot.alive === false, "宕机：机器人死亡");
check(
	testRobot.downed === true && testRobot.downType === "shutdown",
	"宕机：进入宕机状态（可复活）",
);
check(manager.get(testRobot.id) === testRobot, "宕机：保留在管理器（未移除）");
check(
	world.entities.includes(testRobot),
	"宕机：残骸保留在世界（供 owner 靠近触发复活）",
);
check(game.players.humanA.dead === false, "宕机：不影响 owner 玩家");

// 复活：owner 靠近残骸 + 经济足够 → 扣除 100 → 修复完成后满血重启
// （缩短复活时长便于测试；真实对局为 10 秒）
testRobot._reviveMs = 100;
testRobot.x = 1280;
testRobot.y = 3000; // 残骸位置
const ownerP = game.players.humanA;
ownerP.x = 1280;
ownerP.y = 3005; // owner 在残骸附近（5px < 150）
// 经济不足 → 不触发
ownerP.money = 50;
manager.tick(game.players, world);
check(testRobot._reviving === false, "复活：经济不足时不触发");
// 经济足够 → 触发并扣除 100
ownerP.money = 200;
manager.tick(game.players, world);
check(testRobot._reviving === true, "复活：触发开始修复");
check(ownerP.money === 100, `复活：扣除 100 经济（实际 ${ownerP.money}）`);
// 修复完成 → 满血重启
testRobot.reviveUntil = Date.now() - 1; // 模拟修复时间到
manager.tick(game.players, world);
check(
	testRobot.alive === true && testRobot.hp === testRobot.maxHp,
	"复活：满血重启",
);
check(
	testRobot.downed === false && testRobot.downType === null,
	"复活：退出宕机状态",
);
check(manager.get(testRobot.id) === testRobot, "复活：仍在管理器");
check(world.entities.includes(testRobot), "复活：仍在世界");

// 自爆分支：被炸玩家应受伤，且自爆无法复活
const boomTest = manager.spawnFor(game.players.botB, "engineer"); // B 队工程机器人
boomTest._guaranteeBoom = true; // 强制自爆
boomTest.x = 1280;
boomTest.y = 2900;
const boomVictim = makePlayer("boomVictim", "A", 1285, 2905, 1000);
game.players.boomVictim = boomVictim;
boomTest.tick({
	players: game.players,
	world,
	manager,
	owner: game.players.botB,
});
boomTest.hp = 1;
boomTest.takeDamage(999, game.players.humanA);
check(
	boomVictim.health < 1000,
	`自爆对周围敌人造成伤害（${boomVictim.health}/1000）`,
);
check(!manager.get(boomTest.id), "自爆机器人已移除");
check(boomTest.downed === false, "自爆：不进入宕机状态（无法复活）");

// ============================================================
// 8.5 工程机器人被玩家攻击 → 自卫反击（玩家用 health 字段）
// ============================================================
console.log("\n[8.5] 工程机器人自卫");
const engSelf = manager.spawnFor(game.players.botB, "engineer"); // B 队工程机器人
engSelf.x = 1280;
engSelf.y = 3200;
const attackerP = makePlayer("attackerP", "A", 1280, 3190, 1000); // A 队玩家贴身
attackerP.team = "A";
const oldA = game.players["humanA"];
game.players["humanA"] = attackerP; // 临时替换，避免 A 队玩家在扫描中干扰
engSelf.tick({
	players: game.players,
	world,
	manager,
	owner: game.players.botB,
});
engSelf.takeDamage(30, attackerP); // 被 A 队玩家攻击 → 记录仇恨
for (let i = 0; i < 30; i++) {
	engSelf.tick({
		players: game.players,
		world,
		manager,
		owner: game.players.botB,
	});
}
check(
	attackerP.health < 1000,
	`工程机器人被攻击后自卫反击（玩家 ${attackerP.health}/1000）`,
);
engSelf.tick({
	players: game.players,
	world,
	manager,
	owner: game.players.botB,
});
// 恢复 humanA
if (oldA) game.players["humanA"] = oldA;

// ============================================================
// 9. 机器人词条（AI 养成）
// ============================================================
console.log("\n[9] 机器人词条");
const traitRobot = manager.spawnFor(game.players.botB, "infantry");
const hpBefore = traitRobot.maxHp;
applyRobotTrait(traitRobot, "armor_plate");
check(
	traitRobot.maxHp === hpBefore + 300,
	`强化装甲 +300 血（${hpBefore} → ${traitRobot.maxHp}）`,
);
applyRobotTrait(traitRobot, "gold_miner");
check(traitRobot._mineMoneyMult === 1.5, "黄金矿工 采矿收益 ×1.5");
applyRobotTrait(traitRobot, "bomb_kit");
check(
	traitRobot._guaranteeBoom === true && traitRobot._boomMult === 1.5,
	"爆破装置 必自爆 ×1.5",
);
check(applyRobotTrait(traitRobot, "armor_plate") === null, "重复词条被拒绝");
const drawn = drawRobotTrait(traitRobot);
check(
	drawn === null || !traitRobot.traits.includes(drawn.id),
	"drawRobotTrait 排除已拥有词条",
);
check(
	traitRobot.traits.length === 3,
	`已拥有 3 个词条（实际 ${traitRobot.traits.length}）`,
);

// ============================================================
// 10. 无人机拆前哨站（drainByRobot）
// ============================================================
console.log("\n[10] 无人机拆前哨站");
const op = world.outposts[0];
op.state.owner = "A";
op.state.progress = 200;
op.drainByRobot("B", 2);
check(op.state.progress === 198, `拆塔扣除进度（200 → ${op.state.progress}）`);
op.state.owner = "A";
op.state.progress = 2;
op.drainByRobot("B", 2);
check(
	op.state.owner === null && op.state.progress === 0,
	"进度归零 → 前哨站恢复中立",
);
op.state.owner = "A";
op.state.progress = 100;
op.drainByRobot("A", 50); // 己方拆自己 → 无效
check(op.state.progress === 100, "己方机器人不拆己方前哨站");

// ============================================================
// 11. 不被当作玩家：计数 / 结算不涉及机器人
// ============================================================
console.log("\n[11] 不被当作玩家");
const aliveA = Object.values(game.players).filter(
	(p) => p.team === "A" && !p.dead && p.health > 0,
).length;
check(
	manager.all().every((r) => !(r.id in game.players)),
	"所有机器人都不在 players",
);
check(aliveA >= 1, "队伍存活计数仅统计 players（机器人不影响）");
// 机器人的击杀数不进入玩家统计
const humanKillsBefore = game.players.botB.kills || 0;
traitRobot.takeDamage(999, game.players.humanA); // 杀死步兵（humanA 为攻击者）
check(
	(game.players.humanA.kills || 0) === 0,
	`击杀机器人不增加玩家击杀数（实际 ${game.players.humanA.kills || 0}）`,
);
check(
	humanKillsBefore === (game.players.botB.kills || 0),
	"击杀者不影响其他玩家统计",
);

// ============================================================
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
