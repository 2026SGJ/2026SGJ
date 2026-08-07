/**
 * AreaManager — 区域效果管理器
 *
 * 将整张地图划分为 640×360 的区块（默认 2560×7200 → 4 列 × 20 行 = 80 块），
 * 负责两件事：
 *
 * 1. 区块实体生成（init）：在每个区块中心（区块内部坐标 320,180）放置一个
 *    type:'entity'、z-index:-1 的区域实体（asset 来自 src/assets/enum/areas/），
 *    区块按地图尺寸精确平铺、无缝隙、无重叠 → 「区块之间无缝衔接」。
 *    区域实体为静态渲染实体（_isStatic），首次全量推送后不再占用带宽。
 *
 * 2. 效果随进出区块附加 / 清除（tick）：
 *    - 玩家（含人机 BotPlayer）与 AI 机器人（RobotEntity）统一处理；
 *    - 每 tick 按坐标计算所在区块，区块变化时先清除旧效果、再附加新效果；
 *    - 进入区块时把当前生效的区域写入 unit._currentAreas，
 *      玩家客户端经 remoteData().state.areas 渲染展示；
 *    - 持续效果（回血 / 中毒掉血）每 tick 结算，离开区块立即停止。
 *
 * 效果字段（见 src/assets/data/areas/index.js）：
 *   speed / damage 为倍率字段（随区块进入设置、离开重置）；
 *   heal / dot 为每 tick 结算字段。
 * 伤害倍率统一在 takeDamage 的「攻击者侧」挂钩（attacker._areaDmgMult），
 * 因此普攻 / 技能 / 道具 / 机器人攻击 / 自爆的全部伤害路径都自动生效。
 */

import Entity from "../entity/entity.js";
import {
	AREA_BLOCK_W,
	AREA_BLOCK_H,
	AREA_GRID,
	AREA_CONFIG,
	getAreaConfig,
} from "../../../assets/data/areas/index.js";

/** 每 tick 毫秒数（20 ticks/s，用于把「每秒效果」折算成「每 tick 效果」） */
const TICK_MS = 1000 / 20;

class AreaManager {
	/**
	 * @param {import('../index.js').default} game — Game 实例（提供 world / match）
	 */
	constructor(game) {
		this.game = game;
		/**
		 * 区块描述数组：{ row, col, x, y, id, config, entity, effects }
		 * @type {Array<{row:number, col:number, x:number, y:number, id:string, config:Object, entity:Entity, effects:Object}>}
		 */
		this.areas = [];
		/** 区块索引：row * cols + col → 区块描述（坐标 → 区块 O(1) 查询） */
		this._lookup = [];
		/** 区块列数 / 行数（由地图尺寸推导） */
		this.cols = 0;
		this.rows = 0;
	}

	// ============================================================
	//  区块实体生成
	// ============================================================

	/**
	 * 生成全部区域区块实体并注册到世界渲染列表
	 * 必须在 World 创建完成后调用（Game.init 中执行）
	 */
	init() {
		// 防御：重复初始化（同一 Game 实例二次调用）时直接返回
		if (this.areas.length > 0) return;

		const world = this.game.world;
		const size = world.mapSize || { width: 2560, height: 7200 };
		this.cols = Math.floor(size.width / AREA_BLOCK_W);
		this.rows = Math.floor(size.height / AREA_BLOCK_H);

		for (let row = 0; row < this.rows; row++) {
			for (let col = 0; col < this.cols; col++) {
				// 区块类型：网格缺行 / 缺列 / 非法 id 时兜底为安全区
				const id = (AREA_GRID[row] && AREA_GRID[row][col]) || "safe";
				const config = getAreaConfig(id);
				// 区块中心（区块内部坐标 320,180）
				const x = col * AREA_BLOCK_W + AREA_BLOCK_W / 2;
				const y = row * AREA_BLOCK_H + AREA_BLOCK_H / 2;

				const entity = new Entity({
					id: `area_${row}_${col}`,
					type: "entity",
					x,
					y,
					asset: config.asset,
					dir: 0,
					isShowed: true,
					width: AREA_BLOCK_W,
					height: AREA_BLOCK_H,
					z_index: -1,
				});
				// 附加区域元信息（供客户端识别 / 展示区域名称）
				entity.data.areaId = id;
				entity.data.areaName = config.name;

				// 静态渲染实体：区块永不变化，标记静态并预缓存指纹，
				// 首次全量推送后不再参与每 tick 指纹刷新（省带宽）
				entity._isStatic = true;
				entity._renderFingerprint = JSON.stringify(entity.getRenderData());

				world.entities.push(entity);

				const area = {
					row,
					col,
					x,
					y,
					id,
					config,
					entity,
					effects: config.effects || {},
				};
				this.areas.push(area);
				this._lookup[row * this.cols + col] = area;
			}
		}

		console.log(
			`[Area] 区域区块已生成: ${this.areas.length} 个（${this.cols}列 × ${this.rows}行，` +
				`区块 ${AREA_BLOCK_W}×${AREA_BLOCK_H}）`,
		);
	}

	// ============================================================
	//  区块判定
	// ============================================================

	/**
	 * 坐标 → 区块索引（row * cols + col）
	 * 区块边界归属：Math.floor 使每一点唯一映射到一个区块，
	 * 相邻区块边界精确贴合（无缝衔接，无缝隙、无重叠）。
	 * 地图外返回 -1（无效果）。
	 *
	 * @param {number} x
	 * @param {number} y
	 * @returns {number}
	 */
	getAreaIndex(x, y) {
		const col = Math.floor(x / AREA_BLOCK_W);
		const row = Math.floor(y / AREA_BLOCK_H);
		if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return -1;
		return row * this.cols + col;
	}

	/**
	 * 查询坐标所在区块描述（无则 null）
	 * @param {number} x
	 * @param {number} y
	 * @returns {Object|null}
	 */
	getAreaAt(x, y) {
		const idx = this.getAreaIndex(x, y);
		return idx >= 0 ? this._lookup[idx] || null : null;
	}

	// ============================================================
	//  每 tick 效果结算
	// ============================================================

	/**
	 * 每 tick 更新所有单位（玩家 / 人机 / AI 机器人）的区域效果
	 * 在主循环玩家与机器人 tick 之后调用（保证使用最新坐标）
	 *
	 * @param {Object<string, import('../player/index.js').default>} players
	 * @param {import('../robot/RobotManager.js').default|null} [robotManager]
	 */
	tick(players, robotManager) {
		for (const p of Object.values(players)) {
			this._tickUnit(p, p.x, p.y);
		}
		if (robotManager) {
			for (const r of robotManager.all()) {
				this._tickUnit(r, r.x, r.y);
			}
		}
	}

	/**
	 * 单个单位：区块切换检测 → 附加 / 清除 → 持续效果结算
	 * @param {Object} unit — Player / BotPlayer / RobotEntity（需含 _areaIndex 等字段）
	 * @param {number} x
	 * @param {number} y
	 */
	_tickUnit(unit, x, y) {
		// 死亡 / 宕机单位不享受区域效果（复活后按新坐标重新判定）
		if (unit.dead === true) return;
		if (unit.alive === false) return;

		const idx = this.getAreaIndex(x, y);
		if (idx !== unit._areaIndex) {
			unit._areaIndex = idx;
			this._applyArea(unit, idx);
		}
		if (idx >= 0) {
			const area = this._lookup[idx];
			if (area) this._tickEffects(unit, area.effects);
		}
	}

	/**
	 * 进入 / 切换区块：先清除旧效果（重置倍率与当前区域列表），
	 * 再按新区块的 effects 附加效果
	 * @param {Object} unit
	 * @param {number} idx — 区块索引（-1 = 地图外，仅清除）
	 */
	_applyArea(unit, idx) {
		// ---- 清除旧效果 ----
		unit._areaSpeedMult = 1;
		unit._areaDmgMult = 1;
		unit._currentAreas = [];

		if (idx < 0) return;
		const area = this._lookup[idx];
		if (!area) return;

		const fx = area.effects;
		// ---- 附加新效果 ----
		if (fx.speed) unit._areaSpeedMult = 1 + fx.speed / 100;
		if (fx.damage) unit._areaDmgMult = 1 + fx.damage / 100;

		// 当前生效区域（供客户端渲染展示；speed/damage 倍率一并携带）。
		// 仅当区块确实存在效果时才展示（安全区/无效果区块不进入列表）
		if (Object.keys(fx).length > 0) {
			unit._currentAreas = [
				{
					id: area.id,
					name: area.config.name,
					description: area.config.description,
					asset: area.config.asset,
					kind: area.config.kind,
					effects: { ...fx },
				},
			];
		}
	}

	/**
	 * 持续效果每 tick 结算（回血 / 中毒掉血）
	 * @param {Object} unit
	 * @param {Object} fx
	 */
	_tickEffects(unit, fx) {
		const dt = TICK_MS / 1000; // 秒

		// ---- 回血（与 maxHealth / maxHp 封顶） ----
		if (fx.heal) {
			const max = unit.maxHealth != null ? unit.maxHealth : unit.maxHp;
			const cur = unit.health != null ? unit.health : unit.hp;
			if (cur < max) {
				const healed = fx.heal * dt;
				if (unit.health != null) {
					unit.health = Math.min(max, cur + healed);
				} else {
					unit.hp = Math.min(max, cur + healed);
				}
			}
		}

		// ---- 中毒掉血（走 takeDamage，统一处理死亡 / 宕机 / 击杀归属） ----
		if (fx.dot) {
			// 匹配阶段为等待大厅：不产生致死伤害（避免大厅内反复阵亡）
			if (this.game.match && this.game.match.phase === "matching") return;
			const dmg = fx.dot * dt;
			if (typeof unit.takeDamage === "function") {
				unit.takeDamage(dmg, null);
			}
		}
	}
}

export default AreaManager;
