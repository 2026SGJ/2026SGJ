/**
 * 商店商品清单
 *
 * 商品分为两类：
 * - permanent: 常驻商品，永远可买，无库存限制（无限库存）
 * - refresh:   刷新商品，从该池中随机抽取一部分上架，有库存限制，买完即缺货，
 *              下次刷新时重新抽取并补满库存。
 *
 * 商品条目字段：
 * - id:       商品唯一标识（对应 enum/shop/items.js 中的 asset id）
 * - name:     商品名称（仅用于日志 / UI 展示）
 * - kind:     商品类型标识，供购买逻辑派发效果（potion / buff / scroll / elixir ...）
 * - price:    单价，购买时扣除玩家 money
 * - stock:    仅 refresh 商品生效，表示初始 / 每次刷新补满的库存
 *             permanent 商品忽略此项
 * - effect:   购买后对玩家施加的效果，具体格式由 effect.kind 决定
 *   - kind: 'heal'      → { amount }          立即回血
 *   - kind: 'maxhealth'→ { amount }          永久提升最大血量并回满
 *   - kind: 'speed'    → { amount, time }     临时移速加成（time 毫秒，0 表示永久）
 *   - kind: 'buff'     → { buffId, level, time } 施加一个 buff
 *   - kind: 'teleport' → { team }             立即传送回己方基地
 *
 * 商店内展示与购买的「顺序」即本文件中 permanent 与 refresh 数组的出现顺序。
 * 客户端应按 permanent 在前、refresh 在后的顺序渲染。
 */
export default {
	/** 常驻商品：可以一直购买，无库存上限 */
	permanent: [
		{
			id: "shop_item_potion_health",
			name: "治疗药水",
			kind: "potion-health",
			price: 60,
			effect: { kind: "heal", amount: 400 },
		},
		{
			id: "shop_item_potion_speed",
			name: "疾速药水",
			kind: "potion-speed",
			price: 50,
			effect: { kind: "speed", amount: 3, time: 8000 },
		},
		{
			id: "shop_item_scroll_teleport",
			name: "回城卷轴",
			kind: "scroll-teleport",
			price: 40,
			effect: { kind: "teleport" },
		},
		{
			id: "shop_item_ward_vision",
			name: "视野守卫",
			kind: "ward-vision",
			price: 30,
			effect: { kind: "buff", buffId: "damage", level: 0, time: 0 },
		},
	],

	/** 刷新商品池：每次刷新随机抽取一部分上架，有库存上限 */
	refresh: [
		{
			id: "shop_item_trait_lottery",
			name: "词条抽奖券",
			kind: "trait-lottery",
			price: 150,
			stock: 1, // 库存固定为 1，每次刷新 40% 概率上架（见 Shop._rollRefresh）
			effect: { kind: "trait-lottery" }, // 购买后随机抽取一个本英雄专属词条
		},
		{
			id: "shop_item_robot_chip",
			name: "机器人强化芯片",
			kind: "robot-upgrade",
			price: 120,
			stock: 2,
			effect: { kind: "robot-upgrade" }, // 随机为其 AI 机器人授予一个未拥有的机器人词条（如黄金矿工）
		},
		{
			id: "shop_item_armor_plate",
			name: "护甲板",
			kind: "armor-plate",
			price: 150,
			stock: 3,
			effect: { kind: "maxhealth", amount: 300 },
		},
		{
			id: "shop_item_buff_strength",
			name: "力量药水",
			kind: "buff-strength",
			price: 200,
			stock: 3,
			effect: { kind: "buff", buffId: "strength", level: 100, time: 10000 },
		},
		{
			id: "shop_item_buff_rebound",
			name: "反伤护盾",
			kind: "buff-rebound",
			price: 200,
			stock: 3,
			effect: { kind: "buff", buffId: "rebound", level: 40, time: 5000 },
		},
		{
			id: "shop_item_elixir_berserk",
			name: "狂暴药剂",
			kind: "elixir-berserk",
			price: 180,
			stock: 2,
			effect: { kind: "buff", buffId: "strength", level: 200, time: 6000 },
		},
	],
};
