/**
 * RobotManager — AI 机器人管理器（AI 机器人，≠ 玩家）
 *
 * 管理整场对局的 AI 机器人（每名玩家进局前 5 选 1 部署一个）：
 *   - robots:  id → RobotEntity（id 约定 `robot_${ownerSessionId}`）
 *   - spawnFor / spawnAll：创建并部署机器人（世界实体渲染 + 行动）
 *   - tick：每帧驱动所有机器人行为
 *   - remove / removeRobotFor：死亡 / 玩家离开时清理
 *
 * 机器人只在世界实体（world.entities）中渲染与行动，
 * 不进 players 集合 → 不参与匹配 / 复活 / 占领 / 胜负结算。
 */

import RobotEntity from "./RobotEntity.js";
import {
	pickRandomRobotType,
	isRobotType,
} from "../../../assets/data/robots/robots.js";
import { pushChat } from "../../chat.js";

/** 机器人 id 前缀 */
export const ROBOT_PREFIX = "robot_";

/** 部署时与 owner 的位置偏移（避免与玩家重叠） */
const SPAWN_OFFSET = 90;

class RobotManager {
	/**
	 * @param {import('../index.js').default} game
	 */
	constructor(game) {
		this.game = game;
		/** @type {Object<string, RobotEntity>} id → RobotEntity */
		this.robots = {};
	}

	/** 全部机器人数组 */
	all() {
		return Object.values(this.robots);
	}

	/** 按 id 查询 */
	get(id) {
		return this.robots[id] || null;
	}

	/** 查询某玩家拥有的机器人 */
	forOwner(ownerId) {
		return this.robots[`${ROBOT_PREFIX}${ownerId}`] || null;
	}

	/**
	 * 为单个玩家部署机器人（重复部署先移除旧机）
	 * @param {import('../player/index.js').default} player
	 * @param {string} [robotType] — 未指定 / 非法则随机
	 * @returns {RobotEntity}
	 */
	spawnFor(player, robotType) {
		const type = isRobotType(robotType) ? robotType : pickRandomRobotType();
		const id = `${ROBOT_PREFIX}${player.sessionId}`;
		if (this.robots[id]) this.remove(id);

		// 出生点：玩家旁偏移（对局开始时玩家位于基地）
		const x = player.x + SPAWN_OFFSET;
		const y = player.y + SPAWN_OFFSET;

		const robot = new RobotEntity({
			id,
			ownerId: player.sessionId,
			team: player.team,
			robotType: type,
			x,
			y,
		});

		// 行动许可跟随阶段（匹配阶段不部署机器人，此处按当前阶段设置）
		const phase = this.game.match.phase;
		robot.canAct = phase === "playing" || phase === "suddenDeath";

		this.robots[id] = robot;
		// 记录管理器引用（takeDamage 在非 tick 时机也可能触发死亡清理）
		robot._manager = this;
		this.game.world.addRobot(robot);

		pushChat({
			type: "robot_spawn",
			player: player.sessionId,
			name: player.name || player.sessionId,
			team: player.team,
			robotType: type,
			text: `[系统] ${player.name || player.sessionId}（${player.team}队）部署了${robot.cfg.name}`,
		});
		console.log(
			`[Robot] ${player.sessionId} 部署 ${type} (${id}) @ (${x}, ${y})`,
		);
		return robot;
	}

	/** 为所有玩家部署机器人（对局开始时调用） */
	spawnAll() {
		for (const p of Object.values(this.game.players)) {
			this.spawnFor(p, p.robotType);
		}
	}

	/** 每 tick 更新所有机器人（在玩家 tick 之后调用） */
	tick(players, world) {
		for (const r of Object.values(this.robots)) {
			if (r.downed) {
				// 宕机残骸：仅处理复活（owner 靠近 → 花费经济 → 10 秒修复）
				r.tickDowned({
					owner: players[r.ownerId] || null,
				});
			} else {
				r.tick({
					players,
					world,
					manager: this,
					owner: players[r.ownerId] || null,
				});
			}
		}
	}

	/**
	 * 移除机器人（宕机 / 自爆 / 玩家离开）
	 * @param {string} id
	 */
	remove(id) {
		const r = this.robots[id];
		if (!r) return;
		delete this.robots[id];
		if (r._miningTarget) {
			r._miningTarget.release(id);
		}
		this.game.world.removeRobot(r);
	}

	/** 玩家离开对局时清理其机器人 */
	removeRobotFor(ownerId) {
		this.remove(`${ROBOT_PREFIX}${ownerId}`);
	}

	/** 全员停止行动（对局结算） */
	stopAll() {
		for (const r of Object.values(this.robots)) {
			r.canAct = false;
		}
	}
}

export default RobotManager;
