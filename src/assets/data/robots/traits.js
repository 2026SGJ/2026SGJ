/**
 * AI 机器人词条（AI 养成，desc.txt「AI 养成与弱点」）
 *
 *   AI 也能获得词条，玩家可选择强化 AI（如黄金矿工）；血量归零会宕机或自爆，
 *   死亡后无法复活。
 *
 * 获取途径：玩家在商店购买「机器人强化芯片」（shop_item_robot_chip）→
 * 随机为其机器人授予一个未拥有的机器人词条（见 Shop._applyEffect / shop/list.js）。
 *
 * 效果由 applyRobotTrait 解释执行，作用于 RobotEntity 的字段：
 *   - _mineSpeedMult  采矿速度倍率
 *   - _mineMoneyMult  采集收益倍率
 *   - _dmgMult        攻击伤害倍率
 *   - _speedMult      移动速度倍率
 *   - _maxHpAdd       最大生命增加（并即时回血）
 *   - _guaranteeBoom  宕机时必定自爆
 *   - _boomMult       自爆伤害倍率
 */
export const ROBOT_TRAITS = {
	gold_miner: {
		id: "gold_miner",
		name: "黄金矿工",
		rarity: "blue",
		description: "采矿速度 +50%，采集收益 +50%",
		effects: { mineSpeedMult: 1.5, mineMoneyMult: 1.5 },
	},
	armor_plate: {
		id: "armor_plate",
		name: "强化装甲",
		rarity: "blue",
		description: "最大生命 +300",
		effects: { maxHpAdd: 300 },
	},
	firepower: {
		id: "firepower",
		name: "火力升级",
		rarity: "purple",
		description: "攻击伤害 +30%",
		effects: { dmgMult: 1.3 },
	},
	speed_core: {
		id: "speed_core",
		name: "急速核心",
		rarity: "purple",
		description: "移动速度 +25%",
		effects: { speedMult: 1.25 },
	},
	bomb_kit: {
		id: "bomb_kit",
		name: "爆破装置",
		rarity: "gold",
		description: "宕机时必定自爆，自爆伤害 +50%",
		effects: { guaranteeBoom: true, boomMult: 1.5 },
	},
};

/**
 * 按随机权重抽取一个机器人词条（排除已拥有）
 * @param {import('../../game/match/robot/RobotEntity.js').default} robot
 * @returns {Object|null}
 */
export function drawRobotTrait(robot) {
	const pool = Object.values(ROBOT_TRAITS);
	const candidates = pool.filter((t) => !robot.traits.includes(t.id));
	if (candidates.length === 0) return null;
	return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * 授予机器人词条并解释执行效果
 * @param {import('../../game/match/robot/RobotEntity.js').default} robot
 * @param {string} traitId
 * @returns {Object|null} 授予的词条（重复 / 未知返回 null）
 */
export function applyRobotTrait(robot, traitId) {
	const trait = ROBOT_TRAITS[traitId];
	if (!trait || robot.traits.includes(trait.id)) return null;
	robot.traits.push(trait.id);

	const e = trait.effects || {};
	if (e.mineSpeedMult)
		robot._mineSpeedMult = (robot._mineSpeedMult || 1) * e.mineSpeedMult;
	if (e.mineMoneyMult)
		robot._mineMoneyMult = (robot._mineMoneyMult || 1) * e.mineMoneyMult;
	if (e.dmgMult) robot._dmgMult = (robot._dmgMult || 1) * e.dmgMult;
	if (e.speedMult) robot._speedMult = (robot._speedMult || 1) * e.speedMult;
	if (e.maxHpAdd) {
		robot.maxHp += e.maxHpAdd;
		robot.hp = Math.min(robot.maxHp, robot.hp + e.maxHpAdd);
	}
	if (e.guaranteeBoom) robot._guaranteeBoom = true;
	if (e.boomMult) robot._boomMult = (robot._boomMult || 1) * e.boomMult;

	console.log(
		`[RobotTrait] ${robot.id} 获得词条【${trait.name}】(${trait.rarity})`,
	);
	return trait;
}
