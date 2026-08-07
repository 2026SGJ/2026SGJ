/**
 * 实体资源名称枚举
 *
 * 用于地图上静态交互实体的 asset id 管理。
 * key 为内部标识，value 为客户端渲染用的 asset 字符串。
 */
export default {
	/** 商店实体 — 玩家靠近按下 E 键打开商店界面 */
	SHOP: "shop",
	/** 前哨站实体（中立状态）— 站在周围 100px 进行占领，占领后可设置重生点 */
	OUTPOST: "outpost_neutral",
	/** 前哨站实体（A 队占领） */
	OUTPOST_A: "outpost_A",
	/** 前哨站实体（B 队占领） */
	OUTPOST_B: "outpost_B",
	/** AI 机器人（5 选 1）— 工程机器人（采矿） */
	ROBOT_ENGINEER: "robot_engineer",
	/** AI 机器人（5 选 1）— 步兵机器人（均衡战斗） */
	ROBOT_INFANTRY: "robot_infantry",
	/** AI 机器人（5 选 1）— 英雄机器人（高伤慢射速） */
	ROBOT_HERO: "robot_hero",
	/** AI 机器人（5 选 1）— 无人机（高频火力 + 拆塔） */
	ROBOT_DRONE: "robot_drone",
	/** AI 机器人（5 选 1）— 哨兵机器人（跟随玩家补伤害） */
	ROBOT_SENTINEL: "robot_sentinel",
};
