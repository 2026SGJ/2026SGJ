/**
 * 区域资源名称枚举
 *
 * 用于地图上「区域区块」静态实体的 asset id 管理。
 * key 为内部标识（与 src/assets/data/areas/ 中的区域 id 对应），
 * value 为客户端渲染用的 asset 字符串。
 *
 * 每个 640×360 区块中心放置一个 type:'entity'、z-index:-1 的区域实体，
 * 客户端据此绘制区域底色 / 贴图（区块之间无缝平铺，无缝隙、无重叠）。
 */
export default {
	/** 安全区 — 无任何效果 */
	AREA_SAFE: "area_safe",
	/** 生命之泉 — 每秒回复生命（正面） */
	AREA_REGEN: "area_regen",
	/** 疾风带 — 移动速度提升（正面） */
	AREA_HASTE: "area_haste",
	/** 泥沼 — 移动速度降低（负面） */
	AREA_SLOW: "area_slow",
	/** 剧毒沼泽 — 每秒受到伤害（负面） */
	AREA_POISON: "area_poison",
	/** 力量回廊 — 伤害提升（正面） */
	AREA_MIGHT: "area_might",
	/** 混沌裂隙 — 掉血同时增伤（风险与收益并存） */
	AREA_RIFT: "area_rift",
	/** B 队基地庇护区 — 基地附近强力回血（正面） */
	AREA_BASE_B: "area_base_B",
	/** A 队基地庇护区 — 基地附近强力回血（正面） */
	AREA_BASE_A: "area_base_A",
};
