/**
 * RobotEntity — AI 机器人实体（AI 机器人，≠ 玩家）
 *
 * desc.txt「AI 工程＆哨兵＆英雄＆步兵＆无人机机器人」：
 *   绝对服从，自动帮玩家采集资源＆攻击＆侦查。除哨兵跟随玩家行动外，
 *   其他均自主移动。血量归零宕机或自爆：
 *     - 宕机（50%）：保留残骸在场，owner 靠近花费 100 经济 + 10 秒修复后可满血复活；
 *     - 自爆（50%）：对周围敌人造成范围伤害，移除，无法复活。
 *
 * ── 与「人机补位」（BotPlayer）的本质区别 ──
 *  BotPlayer 继承 Player 并存在于 players 集合中，被视为玩家（参与匹配 /
 *  复活 / 占领 / 结算）；RobotEntity 不继承 Player、不进 players 集合，
 *  只作为世界实体（world.entities）渲染与行动，不参与任何玩家维度统计。
 *
 * 行为按兵种 role 分派（每 tick 优先级结构，非行为树）：
 *   - miner  (工程机器人)：采矿 > 被攻击自卫 > 基地附近巡逻
 *   - combat (步兵/英雄/无人机)：攻击敌人 > 拆塔（无人机优先前哨站）> 顺路采矿 > 侦查巡逻
 *   - escort (哨兵机器人)：跟随玩家 > 攻击玩家 / 自身附近的敌人
 */

import Entity from "../entity/entity.js";
import ROBOT_TYPES from "../../../assets/data/robots/robots.js";
import {
	collisionLeft,
	collisionRight,
	collisionTop,
	collisionBottom,
} from "../../../utils/collision.js";
import { pushChat } from "../../chat.js";

/** 每 tick 毫秒数（20 ticks/s） */
const TICK_MS = 1000 / 20;

/** 机器人视野半径（像素）：探测敌人 / 侦查 */
const VISION_RANGE = 420;
/** 工程机器人自卫判定距离（像素） */
const ENGINEER_SELF_DEFENSE_RANGE = 120;
/** 哨兵跟随玩家的期望距离（像素） */
const ESCORT_DESIRED_DIST = 110;
/** 哨兵脱离玩家过近的最小距离（像素） */
const ESCORT_MIN_DIST = 55;
/** 哨兵攻击玩家附近敌人的判定距离（像素） */
const ESCORT_GUARD_RADIUS = 170;
/** 采矿交互距离（像素） */
const MINING_RANGE = 35;
/** 战斗机器人顺路采矿的最远距离（像素） */
const COMBAT_NEAR_MINE_RANGE = 260;
/** 被攻击后的反击仇恨时间（毫秒，工程机器人自卫） */
const AGGRO_DURATION = 4000;
/** 自爆范围（像素）与基础伤害 */
const SELF_DESTRUCT_RADIUS = 180;
const SELF_DESTRUCT_DAMAGE = 250;
/** 宕机复活：owner 需花费的经济 */
const REVIVE_COST = 100;
/** 宕机复活：修复时长（毫秒） */
const REVIVE_TIME_MS = 10_000;
/** 宕机复活：owner 靠近残骸触发复活的判定距离（像素） */
const REVIVE_TRIGGER_RANGE = 150;
/** 无人机拆前哨站的每发扣除进度（200 进度 ≈ 28 秒 × 4 发/秒 → 每发 ≈ 1.8） */
const OUTPOST_DRAIN_PER_HIT = 2;
/** 机器人攻击敌方基地的判定距离（像素） */
const BASE_ATTACK_RANGE = 260;
/** 机器人拆前哨站的判定距离（像素） */
const OUTPOST_ATTACK_RANGE = 460;
/** 到达移动目标点的容差（像素） */
const ARRIVE_TOLERANCE = 20;

export default class RobotEntity extends Entity {
	/**
	 * @param {Object} options
	 * @param {string} options.id       — 唯一 ID（约定 `robot_${ownerSessionId}`）
	 * @param {string} options.ownerId  — 所属玩家 sessionId
	 * @param {'A'|'B'} options.team    — 所属队伍
	 * @param {string} options.robotType — 兵种（engineer / infantry / hero / drone / sentinel）
	 * @param {number} options.x / options.y — 出生坐标
	 */
	constructor({ id, ownerId, team, robotType, x, y }) {
		const cfg = ROBOT_TYPES[robotType] || ROBOT_TYPES.infantry;
		super({
			id,
			type: "robot", // 渲染层类型（非静态实体，参与每 tick 指纹刷新）
			x,
			y,
			asset: cfg.asset,
			dir: 90,
			isShowed: true,
			width: 50,
			height: 50,
			z_index: 950,
		});

		this.x = x;
		this.y = y;
		this.dir = 90;

		/** @type {string} 机器人唯一 id（`robot_${ownerSessionId}`，与 data.id 一致） */
		this.id = id;

		/** @type {string} 兵种 id */
		this.robotType = cfg.id;
		/** @type {Object} 兵种配置 */
		this.cfg = cfg;
		/** @type {'A'|'B'} 所属队伍 */
		this.team = team;
		/** @type {string} 所属玩家 sessionId */
		this.ownerId = ownerId;

		/** @type {number} 当前 / 最大生命 */
		this.hp = cfg.hp;
		this.maxHp = cfg.hp;
		/** @type {boolean} 存活（宕机 / 自爆后不可复活） */
		this.alive = true;
		/** @type {boolean} 行动许可（MatchManager 阶段控制，与玩家 canAct 语义一致） */
		this.canAct = false;
		/** @type {string[]} 已获得的机器人词条 id */
		this.traits = [];

		this.hitbox = {
			type: "rect",
			x: this.x - 25,
			y: this.y - 25,
			width: 50,
			height: 50,
		};

		// ---------- 受击 / 死亡 / 复活状态 ----------
		this.downed = false; // 是否处于宕机状态（可复活）
		this.downType = null; // 宕机类型：'shutdown'（可复活）| 'boom'（不可复活）
		this._reviving = false; // 是否正在复活通道中
		this.reviveUntil = 0; // 复活完成时间戳
		this._reviveCost = REVIVE_COST; // 复活花费（测试可缩短）
		this._reviveMs = REVIVE_TIME_MS; // 复活时长（测试可缩短）
		this._reviveRange = REVIVE_TRIGGER_RANGE; // 触发距离
		this._forceDown = false; // 测试/调试：强制走宕机分支（可复活）

		// ---------- 词条倍率（applyRobotTrait 修改） ----------
		this._mineSpeedMult = 1;
		this._mineMoneyMult = 1;
		this._dmgMult = 1;
		this._speedMult = 1;
		this._boomMult = 1;
		this._guaranteeBoom = false;

		// ---------- 行为状态 ----------
		this._attackReadyAt = 0; // 下次可攻击时间戳
		this._mining = false; // 是否正在采矿
		this._miningTarget = null; // 当前矿物目标
		this._miningTime = 0; // 采矿累计时间
		this._aggroTarget = null; // 反击目标（工程机器人自卫）
		this._aggroUntil = 0; // 仇恨截止时间戳
		this._wanderAngle = Math.random() * Math.PI * 2;
		this._patrolPoint = null; // 侦查巡逻点
		this._knock = { x: 0, y: 0 }; // 击退累积

		// 运行期引用（每 tick 注入）
		this._manager = null;
		this._players = {};
	}

	// ============================================================
	//  主更新入口（每 tick，由 RobotManager.tick 驱动）
	// ============================================================

	/**
	 * @param {Object} ctx
	 * @param {Object<string, import('../player/index.js').default>} ctx.players
	 * @param {import('../../world.js').default} ctx.world
	 * @param {import('./RobotManager.js').default} ctx.manager
	 * @param {import('../player/index.js').default|null} ctx.owner
	 */
	tick({ players, world, manager, owner }) {
		this._manager = manager;
		this._players = players;

		// 宕机 / 未解锁行动：静止
		if (!this.alive || !this.canAct) {
			this.dx = 0;
			this.dy = 0;
			this._mining = false;
			this._syncRender();
			return;
		}

		// 每 tick 重置执行意图
		this._target = null; // 攻击目标（玩家 / 机器人 / 结构体）
		this._movePoint = null; // 移动目标点
		this._mining = false;

		const enemies = this._scanEnemies(players, manager, VISION_RANGE);

		// 按兵种角色分派行为
		switch (this.cfg.role) {
			case "miner":
				this._actMiner(enemies, world);
				break;
			case "escort":
				this._actEscort(enemies, world, owner);
				break;
			default:
				this._actCombat(enemies, world);
				break;
		}

		// ---- 统一执行：攻击 / 移动 / 采矿 ----
		if (this._target) {
			const d = this._distTo(this._target);
			if (d <= this.cfg.attackRange) {
				this._stopMoving();
				this._strike(this._target);
			} else {
				this._seek(this._target);
			}
		} else if (this._mining) {
			if (
				this._miningTarget &&
				this._distTo(this._miningTarget) <= MINING_RANGE
			) {
				this._stopMoving();
				this._processMining(world, owner);
			} else if (this._movePoint) {
				this._seek(this._movePoint);
			} else {
				this._stopMoving();
			}
		} else if (this._movePoint) {
			if (this._distToPoint(this._movePoint) <= ARRIVE_TOLERANCE) {
				this._movePoint = null;
				this._stopMoving();
			} else {
				this._seek(this._movePoint);
			}
		} else {
			this._stopMoving();
		}

		this._move(world);
		this._syncRender();
	}

	// ============================================================
	//  行为分派（每 tick）
	// ============================================================

	/** combat：攻击敌人 > 拆塔（无人机优先前哨站）> 顺路采矿 > 侦查巡逻 */
	_actCombat(enemies, world) {
		// 1) 视野内有敌人 → 攻击最近者
		if (enemies.length > 0) {
			this._target = enemies[0].unit;
			return;
		}
		// 2) 拆塔：附近有敌方前哨站（无人机优先）或敌方基地
		const structure = this._findStructureTarget(world);
		if (structure) {
			this._target = structure;
			return;
		}
		// 3) 顺路采矿（附近 260px 内的无主矿物）
		const mineral = this._findMineral(world, COMBAT_NEAR_MINE_RANGE);
		if (mineral) {
			this._miningTarget = mineral;
			this._mining = true;
			this._movePoint = { x: mineral.data.x, y: mineral.data.y };
			return;
		}
		// 4) 侦查：向地图中部 / 敌方半场推进
		this._movePoint = this._nextPatrolPoint(world);
	}

	/** miner（工程机器人）：采矿 > 被攻击自卫 > 基地附近巡逻 */
	_actMiner(enemies, world) {
		// 1) 被攻击 → 自卫反击（仇恨 4 秒）
		if (
			this._aggroTarget &&
			Date.now() < this._aggroUntil &&
			this._isAlive(this._aggroTarget)
		) {
			this._target = this._aggroTarget;
			return;
		}
		// 2) 近身威胁（< 120px）才自卫，否则专注采矿
		if (enemies.length > 0 && enemies[0].d <= ENGINEER_SELF_DEFENSE_RANGE) {
			this._aggroTarget = enemies[0].unit;
			this._aggroUntil = Date.now() + AGGRO_DURATION;
			this._target = enemies[0].unit;
			return;
		}
		// 3) 采矿：最近的无主矿物
		const mineral = this._findMineral(world, Infinity);
		if (mineral) {
			this._miningTarget = mineral;
			this._mining = true;
			this._movePoint = { x: mineral.data.x, y: mineral.data.y };
			return;
		}
		// 4) 无矿 → 基地附近巡逻
		this._movePoint = this._nearBasePoint(world);
	}

	/** escort（哨兵机器人）：跟随玩家 > 攻击玩家 / 自身附近的敌人 */
	_actEscort(enemies, world, owner) {
		// 1) 攻击：玩家附近（170px）或自身 230px 内的敌人
		if (enemies.length > 0) {
			const best = enemies[0];
			if (owner && owner.health > 0 && !owner.dead) {
				const dOwner = Math.hypot(owner.x - best.unit.x, owner.y - best.unit.y);
				if (dOwner <= ESCORT_GUARD_RADIUS) {
					this._target = best.unit;
					return;
				}
			}
			if (best.d <= 230) {
				this._target = best.unit;
				return;
			}
		}
		// 2) 跟随玩家：保持期望距离
		if (owner && owner.health > 0 && !owner.dead) {
			const d = Math.hypot(this.x - owner.x, this.y - owner.y);
			if (d > ESCORT_DESIRED_DIST + 40) {
				this._movePoint = { x: owner.x, y: owner.y };
			} else if (d < ESCORT_MIN_DIST) {
				// 太近 → 拉开
				const nx = this.x - owner.x;
				const ny = this.y - owner.y;
				const dl = Math.hypot(nx, ny) || 1;
				this._movePoint = {
					x: this.x + (nx / dl) * 90,
					y: this.y + (ny / dl) * 90,
				};
			}
		} else {
			// 玩家不在（死亡 / 离线）→ 基地附近巡逻
			this._movePoint = this._nearBasePoint(world);
		}
	}

	// ============================================================
	//  感知
	// ============================================================

	/** 扫描范围内的敌方单位（玩家 + 敌方机器人），按距离升序 */
	_scanEnemies(players, manager, range) {
		const list = [];
		for (const p of Object.values(players)) {
			if (p.team === this.team) continue;
			if (p.dead || p.health <= 0) continue;
			const d = this._distTo(p);
			if (d <= range) list.push({ unit: p, d });
		}
		if (manager) {
			for (const r of manager.all()) {
				if (r === this || r.team === this.team) continue;
				if (!r.alive || r.hp <= 0) continue;
				const d = this._distTo(r);
				if (d <= range) list.push({ unit: r, d });
			}
		}
		list.sort((a, b) => a.d - b.d);
		return list;
	}

	/** 寻找拆塔目标：无人机优先敌方前哨站，其次所有战斗机器人攻击敌方基地 */
	_findStructureTarget(world) {
		if (this.cfg.structure) {
			let best = null;
			let bestD = Infinity;
			for (const o of world.outposts) {
				if (o.state.owner === null || o.state.owner === this.team) continue;
				const d = this._distTo(o);
				if (d <= OUTPOST_ATTACK_RANGE && d < bestD) {
					bestD = d;
					best = {
						x: o.data.x,
						y: o.data.y,
						isStructure: true,
						ref: o,
						kind: "outpost",
					};
				}
			}
			if (best) return best;
		}
		for (const b of world.bases) {
			if (b.team === this.team) continue;
			const d = this._distTo(b);
			if (d <= BASE_ATTACK_RANGE) {
				return {
					x: b.data.x,
					y: b.data.y,
					isStructure: true,
					ref: b,
					kind: "base",
				};
			}
		}
		return null;
	}

	/** 寻找无主矿物（maxRange 内最近者；Infinity = 全图） */
	_findMineral(world, maxRange) {
		let best = null;
		let bestD = Infinity;
		for (const m of world.minerals) {
			if (m.collected) continue;
			if (m.miner && m.miner !== this.id) continue; // 已被其他玩家 / 机器人锁定
			const d = this._distTo(m);
			if (d <= maxRange && d < bestD) {
				bestD = d;
				best = m;
			}
		}
		return best;
	}

	// ============================================================
	//  行动执行
	// ============================================================

	/** 攻击目标：单位（玩家 / 机器人）或结构体（前哨站 / 基地） */
	_strike(target) {
		const now = Date.now();
		if (now < this._attackReadyAt) return;
		this._attackReadyAt = now + this.cfg.cd;

		// 面朝目标
		const tx = (target.x != null ? target.x : target.data.x) - this.x;
		this.dir = tx >= 0 ? 90 : -90;

		// ---- 结构体：拆塔 ----
		if (target.isStructure) {
			if (target.kind === "outpost") {
				const ref = target.ref;
				if (ref.drainByRobot)
					ref.drainByRobot(this.team, OUTPOST_DRAIN_PER_HIT);
			} else if (target.kind === "base") {
				const ref = target.ref;
				if (ref.hp > 0) {
					ref.hp = Math.max(0, ref.hp - this.cfg.damage * this._dmgMult);
					if (ref.hp <= 0) {
						pushChat({
							type: "base_destroyed",
							team: ref.team,
							text: `[基地] ${ref.team} 队基地被${this.cfg.name}摧毁，该队玩家无法复活！`,
						});
						console.log(`[Base] ${ref.team} 队基地被机器人 ${this.id} 摧毁`);
					}
				}
			}
			return;
		}

		// ---- 单位：玩家 / 敌方机器人 ----
		const dmg = this.cfg.damage * this._dmgMult;
		if (target.takeDamage) {
			target.takeDamage(dmg, this);
		}
	}

	/** 采矿进度（矿物收益归属 owner；采集速度 / 收益受词条倍率影响） */
	_processMining(world, owner) {
		const t = this._miningTarget;
		if (!t || t.collected || !t.config) {
			this._mining = false;
			this._miningTime = 0;
			this._miningTarget = null;
			return;
		}
		// 被其他玩家 / 机器人抢先锁定 → 放弃，重新找
		if (t.miner && t.miner !== this.id) {
			this._mining = false;
			this._miningTime = 0;
			this._miningTarget = null;
			return;
		}
		if (!t.miner) t.claim(this.id);

		this._miningTime += TICK_MS;
		const required = t.config.miningTime / this._mineSpeedMult;
		if (this._miningTime >= required) {
			const reward = Math.round(t.config.money * this._mineMoneyMult);
			t.collect();
			if (owner && typeof owner.money === "number") {
				owner.money += reward;
			}
			this._mining = false;
			this._miningTime = 0;
			this._miningTarget = null;
			console.log(
				`[Robot] ${this.id} 采完 ${t.mineralType}，+${reward} 归 ${owner ? owner.sessionId : "无主"}`,
			);
		}
	}

	/** 朝目标点移动 */
	_seek(point) {
		const tx = point.x - this.x;
		const ty = point.y - this.y;
		const d = Math.hypot(tx, ty) || 1;
		this.dx = tx / d;
		this.dy = ty / d;
		this.dir = tx > 0 ? 90 : -90;
	}

	_stopMoving() {
		this.dx = 0;
		this.dy = 0;
	}

	/** 移动 + 墙体碰撞（分轴处理，贴墙滑行）+ 击退衰减 */
	_move(world) {
		const spd = this.cfg.speed * this._speedMult;
		const v = {
			x: this.dx * spd + this._knock.x,
			y: this.dy * spd + this._knock.y,
		};
		this._knock = { x: this._knock.x * 0.85, y: this._knock.y * 0.85 };

		for (const wall of world.walls) {
			if (!this.hitbox || !wall?.hitbox) continue;
			if (collisionLeft(this.hitbox, wall.hitbox, v)) v.x = 0;
			if (collisionRight(this.hitbox, wall.hitbox, v)) v.x = 0;
		}
		for (const wall of world.walls) {
			if (!this.hitbox || !wall?.hitbox) continue;
			if (collisionTop(this.hitbox, wall.hitbox, v)) v.y = 0;
			if (collisionBottom(this.hitbox, wall.hitbox, v)) v.y = 0;
		}

		this.x += v.x;
		this.y += v.y;
		this.hitbox.x = this.x - 25;
		this.hitbox.y = this.y - 25;
	}

	// ============================================================
	//  侦查 / 巡逻目标点
	// ============================================================

	/** 侦查巡逻点：己方半场与中轴之间随机推进 */
	_nextPatrolPoint(world) {
		const size = world.mapSize || { width: 2560, height: 7200 };
		const midY = size.height / 2;
		const halfBand = size.height / 2 - 600;
		const x = 1280 + (Math.random() - 0.5) * 600;
		let y;
		if (this.team === "A") {
			y = midY + 300 + Math.random() * halfBand * 0.8; // 中轴与己方半场之间
		} else {
			y = midY - 300 - Math.random() * halfBand * 0.8;
		}
		return { x, y };
	}

	/** 己方基地附近巡逻点 */
	_nearBasePoint(world) {
		const base = (world.bases || []).find((b) => b.team === this.team);
		if (base) {
			const dir = this.team === "A" ? -1 : 1;
			return {
				x: base.data.x + (Math.random() - 0.5) * 400,
				y: base.data.y + dir * (80 + Math.random() * 160),
			};
		}
		return { x: 1280, y: this.team === "A" ? 6600 : 600 };
	}

	// ============================================================
	//  受击 / 死亡（宕机或自爆，无法复活）
	// ============================================================

	/**
	 * 受到伤害（玩家 / 机器人 / 自爆均可）
	 * @param {number} amount
	 * @param {Object} [attacker] — 攻击者（用于工程机器人自卫仇恨）
	 */
	takeDamage(amount, attacker) {
		if (!this.alive || this.hp <= 0) return;
		this.hp -= amount;

		// 记录攻击者（工程机器人自卫 / 哨兵警戒）
		if (attacker && attacker !== this && attacker.team !== this.team) {
			this._aggroTarget = attacker;
			this._aggroUntil = Date.now() + AGGRO_DURATION;
		}

		if (this.hp <= 0) {
			this.hp = 0;
			this._die(attacker);
		}
	}

	/** 击退（机器人没有 Player 的 knockback 向量，用 _knock 累积并在 _move 中衰减） */
	takeKnockback(vector) {
		if (!this.alive) return;
		this._knock.x += vector.x || 0;
		this._knock.y += vector.y || 0;
	}

	/** 死亡处理：50% 宕机 / 50% 自爆，死亡后无法复活 */
	_die(attacker) {
		if (!this.alive) return;
		this.alive = false;
		this.data.isShowed = false;

		const selfDestruct = this._forceDown
			? false
			: this._guaranteeBoom || Math.random() < 0.5;
		const name = `${this.team}队·${this.cfg.name}`;
		const killer =
			attacker && attacker !== this
				? attacker.name || attacker.sessionId || ""
				: "";

		if (selfDestruct) {
			this.downType = "boom"; // 自爆：无法复活
			const dmg = SELF_DESTRUCT_DAMAGE * this._boomMult;
			let hits = 0;
			for (const p of Object.values(this._players)) {
				if (p.team === this.team) continue;
				if (p.dead || p.health <= 0) continue;
				if (this._distTo(p) <= SELF_DESTRUCT_RADIUS) {
					p.takeDamage(dmg, this);
					hits++;
				}
			}
			if (this._manager) {
				for (const r of this._manager.all()) {
					if (r === this || r.team === this.team) continue;
					if (!r.alive || r.hp <= 0) continue;
					if (this._distTo(r) <= SELF_DESTRUCT_RADIUS) {
						r.takeDamage(dmg, this);
						hits++;
					}
				}
			}
			pushChat({
				type: "robot_death",
				player: this.id,
				name: this.cfg.name,
				team: this.team,
				text: `[自爆] ${name} 自爆！对周围造成 ${Math.round(dmg)} 伤害${killer ? `（被 ${killer} 摧毁）` : ""}`,
			});
			console.log(
				`[Robot] ${this.id} (${this.cfg.name}) 自爆，波及 ${hits} 个目标`,
			);
		} else {
			// 宕机：保留在场（残骸），可复活 —— owner 靠近花费经济 + 10 秒
			this.downed = true;
			this.downType = "shutdown";
			this._reviving = false;
			this.data.isShowed = true; // 残骸保持可见（供 owner 寻找触发复活）
			pushChat({
				type: "robot_death",
				player: this.id,
				name: this.cfg.name,
				team: this.team,
				text: `[宕机] ${name} 宕机${killer ? `（被 ${killer} 摧毁）` : ""}，owner 靠近可花费 ${this._reviveCost} 经济复活（${Math.round(this._reviveMs / 1000)} 秒）`,
			});
			console.log(
				`[Robot] ${this.id} (${this.cfg.name}) 宕机，等待复活（${this._reviveCost} 经济 + ${Math.round(this._reviveMs / 1000)}s）`,
			);
		}

		// 释放矿物锁定；宕机保留在场（复活用），自爆移除
		if (this._miningTarget) {
			this._miningTarget.release(this.id);
		}
		if (selfDestruct && this._manager) {
			this._manager.remove(this.id);
		}
	}

	// ============================================================
	//  宕机复活（owner 靠近残骸 → 花费经济 → 10 秒修复 → 重启）
	// ============================================================

	/**
	 * 宕机状态每 tick（由 RobotManager 对 downed 机器人调用）
	 * 触发条件：owner 存活且距残骸 ≤ 判定距离且经济 ≥ 花费 → 扣除经济并开始 10 秒修复
	 */
	tickDowned({ owner }) {
		if (this.alive || !this.downed || this.downType !== "shutdown") return;
		const now = Date.now();

		// 修复通道进行中：到点完成
		if (this._reviving) {
			if (now >= this.reviveUntil) {
				this._revive();
			}
			return;
		}

		// 触发条件：owner 存活 + 距离 ≤ 判定范围 + 经济足够
		if (!owner || owner.dead || owner.health <= 0) return;
		if (owner.money < this._reviveCost) return;
		const d = Math.hypot(this.x - owner.x, this.y - owner.y);
		if (d > this._reviveRange) return;

		// 扣除经济并开始 10 秒修复
		owner.money -= this._reviveCost;
		this._reviving = true;
		this.reviveUntil = now + this._reviveMs;
		pushChat({
			type: "robot_revive_start",
			player: this.id,
			name: this.cfg.name,
			team: this.team,
			owner: owner.sessionId,
			text: `[复活] ${owner.name || owner.sessionId} 花费 ${this._reviveCost} 经济修复 ${this.team}队·${this.cfg.name}（${Math.round(this._reviveMs / 1000)} 秒）`,
		});
		console.log(
			`[Robot] ${this.id} 开始复活（owner=${owner.sessionId}，-${this._reviveCost} 经济，${Math.round(this._reviveMs / 1000)}s）`,
		);
	}

	/** 复活完成：满血重启 */
	_revive() {
		this.alive = true;
		this.downed = false;
		this.downType = null;
		this._reviving = false;
		this.hp = this.maxHp;
		this.data.isShowed = true;
		pushChat({
			type: "robot_revive",
			player: this.id,
			name: this.cfg.name,
			team: this.team,
			text: `[复活] ${this.team}队·${this.cfg.name} 重新启动`,
		});
		console.log(`[Robot] ${this.id} (${this.cfg.name}) 复活完成`);
	}

	// ============================================================
	//  渲染同步
	// ============================================================

	/** 同步逻辑坐标 → 渲染数据（增量渲染指纹比对依赖） */
	_syncRender() {
		this.data.x = Math.round(this.x * 10) / 10;
		this.data.y = Math.round(this.y * 10) / 10;
		this.data.dir = this.dir;
	}

	/**
	 * 渲染数据（供客户端绘制机器人 + 血条 + 词条）
	 * @returns {Object}
	 */
	getRenderData() {
		return {
			...this.data,
			type: "update",
			state: {
				team: this.team,
				ownerId: this.ownerId,
				robotType: this.robotType,
				hp: Math.max(0, Math.round(this.hp)),
				maxHp: this.maxHp,
				dead: !this.alive,
				/** 是否处于宕机状态（可复活） */
				downed: this.downed || false,
				/** 复活剩余毫秒（未在复活中为 0；按 100ms 粒度裁剪避免每 tick 变指纹） */
				reviveRemaining: this._reviving
					? Math.max(0, Math.ceil((this.reviveUntil - Date.now()) / 100) * 100)
					: 0,
				traits: [...this.traits],
			},
		};
	}

	/** 距离计算（兼容 Player / RobotEntity / Entity 结构体） */
	_distTo(u) {
		const ux = u.x != null ? u.x : u.data.x;
		const uy = u.y != null ? u.y : u.data.y;
		return Math.hypot(this.x - ux, this.y - uy);
	}

	_distToPoint(p) {
		return Math.hypot(this.x - p.x, this.y - p.y);
	}

	/** 存活判定（兼容玩家 health / 机器人 hp 两种字段） */
	_isAlive(u) {
		if (!u) return false;
		if (u.alive === false) return false; // 机器人
		if (u.dead === true) return false; // 玩家
		return (u.hp != null ? u.hp : u.health) > 0;
	}
}
