import Entity from "./entity.js";
import SHOP_META from "../../../assets/data/shop/shop.js";
import SHOP_LIST from "../../../assets/data/shop/list.js";
import {
	drawRobotTrait,
	applyRobotTrait,
} from "../../../assets/data/robots/traits.js";
import getBuffClassById from "../buff/index.js";

/**
 * Shop — 商店实体
 *
 * 固定在基地附近，玩家靠近 50 像素且按 E 键即可打开商店 GUI。
 * 商品分两类：
 * - 常驻商品（permanent）：无限库存，永远可买
 * - 刷新商品（refresh）：从刷新池中随机抽取一部分上架，有库存上限，买完即缺，
 *   到下次刷新时间点重新随机抽取并补满库存。
 *
 * 关键点：两个队伍可访问同一个商店实体，但各自的库存 / 刷新商品列表互相独立。
 *
 * 并发处理说明：
 * 服务端运行在单线程同步主循环（matchLoop）中。购买在单个同步调用内完成，
 * 库存扣减与金钱扣减在返回前一次性写完，对同一商品不存在中途被打断的写;
 * 即便客户端在一个 tick 内连发多笔购买（鼠标 / 触屏 / 手柄），也会被
 * Game 的商店会话（ShopSession.buy）串行处理，每次购买都基于「当前已最新」
 * 的 stock 判定，天然并发安全。
 */
class Shop extends Entity {
	/**
	 * @param {Object} data — 来自地图配置的原始数据
	 * @param {'A'|'B'} [data.team] 商店归属队伍，仅决定渲染形象与默认基地归属,
	 *        不限制访问队伍（双队都可打开同一商店，各自库存独立）。
	 */
	constructor(data) {
		super(data);

		/** 商店所属队伍（仅决定渲染形象） */
		this.shopTeam = data.team || "A";

		// 强制 asset 按队伍形象覆盖（来自 SHOP_META 配置）
		this.data.asset = SHOP_META.asset[this.shopTeam] || this.data.asset;

		/** 碰撞体积：商店为非阻挡实体，仅用于接近判定 */
		const w = this.data.width || 60;
		const h = this.data.height || 60;
		this.hitbox = {
			type: "rect",
			x: this.data.x - w / 2,
			y: this.data.y - h / 2,
			width: w,
			height: h,
		};

		/**
		 * 按队伍存储独立状态
		 * @type {Object<'A'|'B', {
		 *   refreshItems: Array<{base: Object, stock: number}>,
		 *   nextRefreshAt: number,
		 * }>}
		 */
		this.teamState = {
			A: this._createTeamState(),
			B: this._createTeamState(),
		};

		/** 当前已打开商店 GUI 的玩家 sessionId 集合 */
		this.openedBy = new Set();
	}

	/**
	 * 为单个队伍创建一份独立状态（库存 + 刷新列表）
	 * @private
	 */
	_createTeamState() {
		return {
			refreshItems: this._rollRefresh(),
			nextRefreshAt: Date.now() + SHOP_META.refreshTime,
		};
	}

	/**
	 * 重新随机抽取一组刷新商品并补满库存
	 *
	 * 词条抽奖（kind === 'trait-lottery'）：每次刷新有 40% 概率必定上架
	 * （库存固定为 1），未命中则本次不上架；其余槽位从剩余商品池随机抽取。
	 * @returns {Array<{base: Object, stock: number}>}
	 */
	_rollRefresh() {
		const pool = SHOP_LIST.refresh;
		const count = Math.min(SHOP_META.refreshCount, pool.length);
		const candidates = pool.slice();
		const picked = [];

		// 40% 概率上架词条抽奖券（库存 1）；未命中则本次不上架（移出候选池）
		const lotteryIdx = candidates.findIndex((c) => c.kind === "trait-lottery");
		if (lotteryIdx >= 0) {
			if (Math.random() < 0.4) {
				const base = candidates.splice(lotteryIdx, 1)[0];
				picked.push({ base, stock: base.stock || 1 });
			} else {
				candidates.splice(lotteryIdx, 1);
			}
		}

		// 其余槽位从剩余池随机抽取
		for (let i = picked.length; i < count && candidates.length > 0; i++) {
			const idx = Math.floor(Math.random() * candidates.length);
			const base = candidates.splice(idx, 1)[0];
			picked.push({
				base,
				stock: base.stock || SHOP_META.refreshStockPerItem,
			});
		}
		return picked;
	}

	/**
	 * 判断玩家是否在商店交互范围内（中心距 <= radius）
	 */
	isPlayerNear(playerX, playerY) {
		return (
			Math.hypot(playerX - this.data.x, playerY - this.data.y) <=
			SHOP_META.radius
		);
	}

	/**
	 * 每 tick 调用：检查是否到刷新时间，到点重新随机刷新商品并补满库存
	 */
	tick() {
		const now = Date.now();
		for (const team of ["A", "B"]) {
			const st = this.teamState[team];
			if (now >= st.nextRefreshAt) {
				st.refreshItems = this._rollRefresh();
				st.nextRefreshAt = now + SHOP_META.refreshTime;
				console.log(`[Shop] Team ${team} refreshed items @ ${now}`);
			}
		}
	}

	/**
	 * 获取指定队伍当前可购买商品快照（供客户端 UI 渲染）
	 * @param {'A'|'B'} team
	 */
	getCatalog(team) {
		const st = this.teamState[team];
		return {
			permanent: SHOP_LIST.permanent.map((item) => ({
				id: item.id,
				name: item.name,
				kind: item.kind,
				price: item.price,
				stock: Infinity,
				permanent: true,
			})),
			refresh: st.refreshItems.map(({ base, stock }) => ({
				id: base.id,
				name: base.name,
				kind: base.kind,
				price: base.price,
				stock,
				permanent: false,
				nextRefreshAt: st.nextRefreshAt,
			})),
		};
	}

	/**
	 * 购买商品（库存并发安全，见类头注释）
	 *
	 * @param {Object} player - 购买者（Player 实例）
	 * @param {string} itemId - 商品 id
	 * @param {Object} [context] - 购买上下文（机器人强化等需要外部依赖的效果使用）
	 * @param {import('../robot/RobotManager.js').default} [context.robots] - AI 机器人管理器
	 * @returns {{ok: boolean, reason?: string, item?: Object, catalog?: Object}}
	 */
	buy(player, itemId, context) {
		const team = player.team || "A";
		const st = this.teamState[team];

		// 1) 先查常驻商品
		const permItem = SHOP_LIST.permanent.find((it) => it.id === itemId);
		if (permItem) {
			if (player.money < permItem.price) {
				return { ok: false, reason: "insufficient_money" };
			}
			player.money -= permItem.price;
			this._applyEffect(player, permItem.effect, context);
			return { ok: true, item: permItem, catalog: this.getCatalog(team) };
		}

		// 2) 再查刷新商品（按 stock 扣减）
		const slot = st.refreshItems.find((s) => s.base.id === itemId);
		if (!slot) {
			return { ok: false, reason: "not_in_shop" };
		}
		if (slot.stock <= 0) {
			return { ok: false, reason: "out_of_stock" };
		}
		if (player.money < slot.base.price) {
			return { ok: false, reason: "insufficient_money" };
		}

		// 词条抽奖券：本英雄词条已抽完时拒绝购买（避免白花钱）
		if (
			slot.base.kind === "trait-lottery" &&
			player.traitManager?.poolExhausted()
		) {
			return { ok: false, reason: "trait_pool_exhausted" };
		}

		// 机器人强化芯片：机器人不存在 / 词条已抽完时拒绝购买（避免白花钱）
		if (slot.base.kind === "robot-upgrade") {
			const robot = context?.robots?.forOwner?.(player.sessionId);
			if (!robot || !robot.alive) {
				return { ok: false, reason: "robot_missing" };
			}
			if (drawRobotTrait(robot) === null) {
				return { ok: false, reason: "robot_traits_exhausted" };
			}
		}

		// 同步执行流内一次性扣减库存与金钱，天然并发安全
		slot.stock -= 1;
		player.money -= slot.base.price;
		const trait = this._applyEffect(player, slot.base.effect, context);
		console.log(
			`[Shop] Player ${player.sessionId} bought ${slot.base.id} ` +
				`(team ${team}, stock left ${slot.stock})`,
		);
		return { ok: true, item: slot.base, catalog: this.getCatalog(team), trait };
	}

	/**
	 * 对玩家施加购买效果
	 * @param {Object} player - 购买者（Player 实例）
	 * @param {Object} effect - 商品效果配置
	 * @param {Object} [context] - 购买上下文（机器人强化芯片使用）
	 * @returns {Object|null} 词条抽奖券 / 机器人强化芯片返回授予信息，其余返回 null
	 * @private
	 */
	_applyEffect(player, effect, context) {
		if (!effect) return null;
		switch (effect.kind) {
			case "trait-lottery": {
				// 购买后从本英雄专属词条库随机抽取一个词条
				const tm = player.traitManager;
				if (!tm) return null;
				const trait = tm.draw();
				if (!trait) return null;
				tm.grant(trait.id);
				console.log(
					`[Shop] ${player.sessionId} 词条抽奖 → 【${trait.name}】(${trait.rarity})`,
				);
				return {
					id: trait.id,
					name: trait.name,
					rarity: trait.rarity,
					description: trait.description,
				};
			}
			case "robot-upgrade": {
				// 机器人强化芯片：为其 AI 机器人随机授予一个未拥有的机器人词条
				// （AI 养成：AI 也能获得词条，如黄金矿工）
				const robot = context?.robots?.forOwner?.(player.sessionId);
				if (!robot || !robot.alive) return null;
				const trait = drawRobotTrait(robot);
				if (!trait) return null;
				applyRobotTrait(robot, trait.id);
				console.log(
					`[Shop] ${player.sessionId} 强化机器人 → 【${trait.name}】(${trait.rarity})`,
				);
				return {
					id: trait.id,
					name: trait.name,
					rarity: trait.rarity,
					description: trait.description,
				};
			}
			case "heal":
				player.health = Math.min(
					player.maxHealth,
					player.health + (effect.amount || 0),
				);
				break;
			case "maxhealth":
				player.maxHealth += effect.amount || 0;
				player.health = player.maxHealth;
				break;
			case "speed":
				if (effect.time && effect.time > 0) {
					// 临时加速：使用 SpeedBuff 施加到玩家自身。
					// 不能直接修改 player.args.speed —— args 是 hero 全局配置对象
					// （所有同英雄玩家共享），直接加减会同时影响所有同英雄玩家甚至
					// 全局配置，且 setTimeout 还原也会殃及他人。
					const SpeedBuffClass = getBuffClassById("speed");
					player.giveBuff(
						new SpeedBuffClass({
							id: "speed",
							level: Math.max(
								1,
								Math.round(
									((effect.amount || 0) / (player.args.speed || 1)) * 100,
								),
							),
							time: effect.time,
						}),
					);
				} else {
					// 永久加速：仍会修改共享的 args 对象（影响所有同英雄玩家），
					// 缺少 per-player 基础速度字段，暂不做永久型商店道具（见 CHANGELOG）。
					player.args.speed += effect.amount || 0;
				}
				break;
			case "buff": {
				if (effect.buffId) {
					const BuffClass = getBuffClassById(effect.buffId);
					if (BuffClass) {
						player.giveBuff(
							new BuffClass({
								id: effect.buffId,
								level: effect.level || 0,
								time: effect.time || 0,
							}),
						);
					}
				}
				break;
			}
			case "teleport":
				player.x = 1280;
				player.y = player.team === "A" ? 6840 : 360;
				player.hitbox.x = player.x - 25;
				player.hitbox.y = player.y - 25;
				player.speed.set(0, 0);
				break;
			default:
				console.warn(`[Shop] unknown effect kind: ${effect.kind}`);
		}
	}
}

export default Shop;
