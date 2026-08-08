/**
 * 区域效果数据 — src/assets/data/areas/
 *
 * 将整张地图（2560×7200）划分为若干 640×360 的区块（4 列 × 20 行 = 80 块），
 * 每个区块拥有一个区域类型（area id），并声明其效果：
 *
 *   - 玩家 / 人机（BotPlayer）/ AI 机器人（RobotEntity）进入区块时获得对应效果，
 *     离开区块时立即清除（按区块边界精确切换，区块之间无缝衔接，无缝隙、无重叠）；
 *   - 效果以「当前生效区域」的形式经 S2CRender 的 remoteData.state.areas 推送
 *     给玩家客户端渲染展示；
 *   - 区域实体（type:'entity'，asset 见 src/assets/enum/areas/，z-index:-1）
 *     放置于每个区块中心（区块内部坐标 320,180），由 AreaManager 生成。
 *
 * ── 效果字段说明（effects）──
 *   speed:   移速倍率百分比（+25 = 移速 ×1.25；-30 = 移速 ×0.7）
 *   damage:  造成的伤害倍率百分比（+20 = 伤害 ×1.2）
 *   heal:    每秒生命回复（与 maxHealth / maxHp 封顶）
 *   dot:     每秒受到的伤害（负面，经过 takeDamage 处理死亡 / 宕机）
 *
 * 区块网格（AREA_GRID）：20 行 × 4 列，行 0 为地图顶部（B 队基地），
 * 行 19 为地图底部（A 队基地），以行 9 / 行 10 交界处为对称轴上下对称。
 */

import AreaNames from "../../enum/areas/index.js";

/** 区块宽度（像素） */
export const AREA_BLOCK_W = 640;
/** 区块高度（像素） */
export const AREA_BLOCK_H = 360;

/**
 * 区域类型配置：area id → { asset, name, description, effects, kind }
 * kind: 'positive' 正面效果 / 'negative' 负面效果 / 'mixed' 混合 / 'neutral' 无效果
 */
export const AREA_CONFIG = {
	safe: {
		asset: AreaNames.AREA_SAFE,
		name: "安全区",
		description: "无任何效果",
		kind: "neutral",
		effects: {},
	},
	regen: {
		asset: AreaNames.AREA_REGEN,
		name: "生命之泉",
		description: "每秒回复 5 点生命",
		kind: "positive",
		effects: { heal: 5 },
	},
	haste: {
		asset: AreaNames.AREA_HASTE,
		name: "疾风带",
		description: "移动速度提升 25%",
		kind: "positive",
		effects: { speed: 25 },
	},
	slow: {
		asset: AreaNames.AREA_SLOW,
		name: "泥沼",
		description: "移动速度降低 30%",
		kind: "negative",
		effects: { speed: -30 },
	},
	poison: {
		asset: AreaNames.AREA_POISON,
		name: "剧毒沼泽",
		description: "每秒受到 8 点伤害",
		kind: "negative",
		effects: { dot: 8 },
	},
	might: {
		asset: AreaNames.AREA_MIGHT,
		name: "力量回廊",
		description: "造成的伤害提升 20%",
		kind: "positive",
		effects: { damage: 20 },
	},
	rift: {
		asset: AreaNames.AREA_RIFT,
		name: "混沌裂隙",
		description: "每秒受到 5 点伤害，同时伤害提升 15%",
		kind: "mixed",
		effects: { dot: 5, damage: 15 },
	},
	base_B: {
		asset: AreaNames.AREA_BASE_B,
		name: "B队基地庇护",
		description: "每秒回复 8 点生命",
		kind: "positive",
		effects: { heal: 8 },
	},
	base_A: {
		asset: AreaNames.AREA_BASE_A,
		name: "A队基地庇护",
		description: "每秒回复 8 点生命",
		kind: "positive",
		effects: { heal: 8 },
	},
};

/**
 * 区块网格：20 行 × 4 列（行 0 = 顶部 / B 队基地，行 19 = 底部 / A 队基地）
 *
 * 布局说明（由顶到底，围绕中轴 r9/r10 对称）：
 *   r0        基地庇护（B 队出生）
 *   r1        生命之泉（B 队出生附近）
 *   r2/r3     两侧泥沼 + 中央疾风带（地形障碍带）
 *   r4        安全区
 *   r5/r6     剧毒沼泽（B 队半场）
 *   r7/r8     力量回廊（B 队半场）
 *   r9        安全区
 *   r10       混沌裂隙（地图中轴，收益与风险并存）
 *   r11       安全区
 *   r12/r13   力量回廊（A 队半场）
 *   r14/r15   剧毒沼泽（A 队半场）
 *   r16       安全区
 *   r17/r18   两侧泥沼 + 中央疾风带
 *   r19       基地庇护（A 队出生）
 */
export const AREA_GRID = [
	["base_B", "base_B", "base_B", "base_B"],
	["regen", "regen", "regen", "regen"],
	["slow", "haste", "haste", "slow"],
	["safe", "haste", "haste", "safe"],
	["safe", "safe", "safe", "safe"],
	["poison", "poison", "poison", "poison"],
	["safe", "poison", "poison", "safe"],
	["might", "might", "might", "might"],
	["safe", "might", "might", "safe"],
	["safe", "safe", "safe", "safe"],
	["rift", "rift", "rift", "rift"],
	["safe", "safe", "safe", "safe"],
	["safe", "might", "might", "safe"],
	["might", "might", "might", "might"],
	["safe", "poison", "poison", "safe"],
	["poison", "poison", "poison", "poison"],
	["safe", "safe", "safe", "safe"],
	["safe", "haste", "haste", "safe"],
	["slow", "haste", "haste", "slow"],
	["base_A", "base_A", "base_A", "base_A"],
];

/**
 * 获取某区域类型的配置
 * @param {string} id — 区域 id（见 AREA_CONFIG）
 * @returns {Object}
 */
export const getAreaConfig = (id) => AREA_CONFIG[id] || AREA_CONFIG.safe;

export default {
	AREA_BLOCK_W,
	AREA_BLOCK_H,
	AREA_GRID,
	AREA_CONFIG,
	getAreaConfig,
};
