/**
 * AI 机器人兵种配置（desc.txt「AI 机器人兵种各大数值」）
 *
 * 数值换算与英雄一致：血量 ×1.4，移速 ÷40（引擎单位，见 CHANGELOG 英雄换算说明）。
 * 射速换算为攻击间隔 cd（毫秒）：2发/秒 → 500ms，0.5发/秒 → 2000ms，4发/秒 → 250ms，
 * 1.5发/秒 → 667ms，工程机器人「极低（自卫）」→ 5000ms。
 *
 * ── 重要：机器人 ≠ 玩家 ──
 * 机器人不属于 players 集合：不参与匹配人数 / 复活 / 占领 / 胜负结算 / 队伍统计。
 * 与「人机补位（BotPlayer，被视为玩家）」严格区分。
 * 血量归零：50% 宕机（owner 花费 100 经济 + 10 秒可复活）/ 50% 自爆（无法复活）。
 *
 * 兵种角色（role）：
 *   - miner  工程机器人：仅用于采矿（被攻击时以极低射速自卫）
 *   - combat 步兵 / 英雄 / 无人机：自主移动，攻击敌人与拆塔（无人机专精拆前哨站）
 *   - escort 哨兵机器人：跟随玩家行动，给科学家补伤害
 */
const ROBOT_TYPES = {
	/** 工程机器人 — 血厚耐操，专注采矿 */
	engineer: {
		id: "engineer",
		name: "工程机器人",
		desc: "血厚耐操，专注采矿，自卫火力极低",
		hp: 1400, // 1000 × 1.4
		speed: 6.25, // 250 ÷ 40
		damage: 50, // 单发伤害（仅自卫）
		cd: 5000, // 射速极低（自卫）
		attackRange: 70,
		role: "miner",
		asset: "robot_engineer",
	},
	/** 步兵机器人 — 标准战斗单位，2 发/秒 */
	infantry: {
		id: "infantry",
		name: "步兵机器人",
		desc: "均衡的战斗单位，2 发/秒",
		hp: 1120, // 800 × 1.4
		speed: 8.75, // 350 ÷ 40
		damage: 80,
		cd: 500, // 2 发/秒
		attackRange: 110,
		role: "combat",
		asset: "robot_infantry",
	},
	/** 英雄机器人 — 单发 300 伤害，2 秒一发，超长真空期 */
	hero: {
		id: "hero",
		name: "英雄机器人",
		desc: "单发 300 伤害，2 秒一发，超长真空期",
		hp: 840, // 600 × 1.4
		speed: 4.5, // 180 ÷ 40
		damage: 300,
		cd: 2000, // 0.5 发/秒
		attackRange: 110,
		role: "combat",
		asset: "robot_hero",
	},
	/** 无人机 — 4 发/秒，专精拆前哨站（约 28 秒） */
	drone: {
		id: "drone",
		name: "无人机",
		desc: "4 发/秒，专精拆前哨站（约 28 秒）",
		hp: 1120, // 800 × 1.4
		speed: 7.5, // 300 ÷ 40
		damage: 75,
		cd: 250, // 4 发/秒
		attackRange: 110,
		role: "combat",
		structure: true, // 无人机专精拆塔（优先前哨站）
		asset: "robot_drone",
	},
	/** 哨兵机器人 — 跟随玩家行动，给科学家补伤害 */
	sentinel: {
		id: "sentinel",
		name: "哨兵机器人",
		desc: "跟随玩家行动，给科学家补伤害",
		hp: 1260, // 900 × 1.4
		speed: 7.5, // 300 ÷ 40
		damage: 120,
		cd: 667, // 1.5 发/秒
		attackRange: 120,
		role: "escort",
		asset: "robot_sentinel",
	},
};

/** 机器人 id 列表 */
export const ROBOT_IDS = Object.keys(ROBOT_TYPES);

/** 校验是否为合法机器人类型 */
export const isRobotType = (t) => ROBOT_TYPES[t] != null;

/** 随机选择一种机器人类型（人机补位等场景） */
export const pickRandomRobotType = () =>
	ROBOT_IDS[Math.floor(Math.random() * ROBOT_IDS.length)];

export default ROBOT_TYPES;
