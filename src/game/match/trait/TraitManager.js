import {
	getHeroTraits,
	TRAIT_RARITY_WEIGHTS,
} from "../../../assets/data/traits/index.js";
import getBuffClassById from "../buff/index.js";
import Skill from "../skills/skill.js";

/**
 * TraitManager — 词条管理器（词条系统运行时）
 *
 * 每个玩家（含人机）持有独立的 TraitManager：
 *   - draw()    按稀有度权重（蓝 55 / 紫 30 / 金 15）从本英雄专属词条库抽取，排除已拥有词条
 *   - grant(id) 记录词条并解释执行其 effects（技能数值修改 / 被动属性 / 事件钩子）
 *   - serialize() 供 remoteData 推送客户端展示
 *
 * 词条效果通过两种方式生效：
 *   1. 静态修改：直接修改玩家的独立英雄配置（player.args，构造时已按玩家深拷贝），
 *      并重建对应 Skill 实例（onUse 读取实例数值）；
 *   2. 事件钩子：监听玩家 trigger 的事件
 *       - 'trait:basicHit'（普攻命中，Player.processBasicAttack 触发）
 *       - 'trait:skillUsed'（技能释放，Player.processSkillCast 触发）
 *       - 被动减伤 / 暴击 / 控制缩减由 Player.takeDamage / giveBuff 读取本管理器
 *         写入的玩家字段（_traitDmgReductions / _critChance / _critDamage / _ccReduction）。
 *
 * 效果 schema 说明见 src/assets/data/traits/newton.js 头部注释。
 */
class TraitManager {
	/**
	 * @param {import('../player/index.js').default} player — 所属玩家
	 */
	constructor(player) {
		this.player = player;
		/** @type {Array<{id:string,name:string,rarity:string,description:string}>} 已获得词条 */
		this.traits = [];
		/** @type {Set<string>} 已获得词条 id（去重） */
		this.traitIds = new Set();
		/** @type {Array} 普攻命中钩子（onBasicHit 效果） */
		this._basicHitEffects = [];
		/** @type {Array} 技能释放钩子（onSkillUse 效果） */
		this._skillUseEffects = [];

		player.traitManager = this;
		this._registerHooks();
	}

	// ============================================================
	//  查询
	// ============================================================

	/** 本英雄专属词条库 */
	pool() {
		return getHeroTraits(this.player.hero);
	}

	/** 是否已拥有某词条 */
	has(id) {
		return this.traitIds.has(id);
	}

	/** 本英雄词条是否已全部抽完 */
	poolExhausted() {
		const pool = this.pool();
		return pool.length > 0 && pool.every((t) => this.traitIds.has(t.id));
	}

	/** 序列化（供 remoteData 推送客户端展示） */
	serialize() {
		return this.traits.map((t) => ({
			id: t.id,
			name: t.name,
			rarity: t.rarity,
		}));
	}

	// ============================================================
	//  抽取
	// ============================================================

	/**
	 * 按稀有度权重从本英雄词条库随机抽取一个未拥有的词条
	 * @param {'blue'|'purple'|'gold'} [minRarity] — 若指定，则只抽不低于该稀有度的词条
	 * @returns {Object|null} { id, name, rarity, description, effects } 或 null（无可用词条）
	 */
	draw(minRarity = null) {
		const pool = this.pool();
		let candidates = pool.filter((t) => !this.traitIds.has(t.id));
		if (candidates.length === 0) return null;
		if (minRarity) {
			const rank = { blue: 0, purple: 1, gold: 2 };
			const need = rank[minRarity] ?? 0;
			const filtered = candidates.filter((t) => rank[t.rarity] >= need);
			if (filtered.length > 0) candidates = filtered;
		}

		// 稀有度加权随机
		const weighted = [];
		let total = 0;
		for (const t of candidates) {
			const w = TRAIT_RARITY_WEIGHTS[t.rarity] || 10;
			weighted.push({ t, w });
			total += w;
		}
		let roll = Math.random() * total;
		for (const { t, w } of weighted) {
			roll -= w;
			if (roll <= 0) return t;
		}
		return weighted[weighted.length - 1].t;
	}

	// ============================================================
	//  授予
	// ============================================================

	/**
	 * 授予词条并解释执行效果
	 * @param {string} traitId
	 * @returns {{id,name,rarity,description}|null} 授予的词条信息（重复/不存在返回 null）
	 */
	grant(traitId) {
		const pool = this.pool();
		const trait = pool.find((t) => t.id === traitId);
		if (!trait || this.traitIds.has(trait.id)) return null;

		this.traitIds.add(trait.id);
		this.traits.push({
			id: trait.id,
			name: trait.name,
			rarity: trait.rarity,
			description: trait.description,
		});
		this._applyEffects(trait.effects || []);

		const player = this.player;
		console.log(
			`[Trait] ${player.sessionId} 获得词条【${trait.name}】(${trait.rarity}，英雄 ${player.hero})`,
		);
		return this.traits[this.traits.length - 1];
	}

	// ============================================================
	//  效果执行（静态修改）
	// ============================================================

	_applyEffects(effects) {
		for (const e of effects) {
			try {
				switch (e.type) {
					case "modifySkill":
						this._applyModifySkill(e);
						break;
					case "modifyDebuff":
						this._applyModifyDebuff(e);
						break;
					case "modifyBuff":
						this._applyModifyBuff(e);
						break;
					case "modifyMagic":
						this._applyModifyMagic(e);
						break;
					case "stat":
						this._applyStat(e);
						break;
					case "onBasicHit":
						this._basicHitEffects.push(e);
						break;
					case "onSkillUse":
						this._skillUseEffects.push(e);
						break;
					default:
						console.warn(`[Trait] 未知效果类型: ${e.type}`);
				}
			} catch (err) {
				console.error(`[Trait] 效果执行失败: ${e.type}`, err);
			}
		}
	}

	/** 修改技能本体数值（damage / cd / forward / knockback 等） */
	_applyModifySkill(e) {
		const atk = this.player.args.attacks?.[e.skill];
		if (!atk) return;
		if (e.damageMul) atk.damage = Math.round((atk.damage || 0) * e.damageMul);
		if (e.damageAdd) atk.damage = (atk.damage || 0) + e.damageAdd;
		if (e.cdMul) atk.cd = Math.round((atk.cd || 0) * e.cdMul);
		if (e.cdAdd) atk.cd = Math.max(0, (atk.cd || 0) + e.cdAdd);
		if (e.forwardMul)
			atk.forward = Math.round((atk.forward || 0) * e.forwardMul);
		if (e.knockbackAdd) atk.knockback = (atk.knockback || 0) + e.knockbackAdd;
		// 整体缩放所有 debuff 持续时间（锚点/标记类词条）
		if (e.debuffTimeMul && Array.isArray(atk.debuff)) {
			atk.debuff.forEach((d) => {
				d.time = Math.round((d.time || 0) * e.debuffTimeMul);
			});
		}
		if (e.addMagic) {
			atk.magic = { ...(atk.magic || {}), ...e.addMagic };
		}
		this._rebuildSkillInstance(e.skill);
	}

	/** 修改技能 debuff（目标减益）数值 */
	_applyModifyDebuff(e) {
		const atk = this.player.args.attacks?.[e.skill];
		const list = atk?.debuff;
		if (!list || list.length === 0) return;
		const d = list[e.index ?? 0];
		if (!d) return;
		if (e.levelMul)
			d.level = Math.round((d.level || 0) * e.levelMul * 100) / 100;
		if (e.levelAdd) d.level = (d.level || 0) + e.levelAdd;
		if (e.timeMul) d.time = Math.round((d.time || 0) * e.timeMul);
		if (e.timeAdd) d.time = Math.max(0, (d.time || 0) + e.timeAdd);
		this._rebuildSkillInstance(e.skill);
	}

	/** 修改技能 buff（自身增益）数值 */
	_applyModifyBuff(e) {
		const atk = this.player.args.attacks?.[e.skill];
		const list = atk?.buff;
		if (!list || list.length === 0) return;
		const b = list[e.index ?? 0];
		if (!b) return;
		if (e.levelMul)
			b.level = Math.round((b.level || 0) * e.levelMul * 100) / 100;
		if (e.levelAdd) b.level = (b.level || 0) + e.levelAdd;
		if (e.timeMul) b.time = Math.round((b.time || 0) * e.timeMul);
		if (e.timeAdd) b.time = Math.max(0, (b.time || 0) + e.timeAdd);
		this._rebuildSkillInstance(e.skill);
	}

	/** 修改技能 magic（AOE 溅射）数值 */
	_applyModifyMagic(e) {
		const atk = this.player.args.attacks?.[e.skill];
		const m = atk?.magic;
		if (!m) return;
		if (e.damageMul) m.damage = Math.round((m.damage || 0) * e.damageMul);
		if (e.damageAdd) m.damage = (m.damage || 0) + e.damageAdd;
		if (e.rangeMul) m.range = Math.round((m.range || 0) * e.rangeMul);
		if (e.rangeAdd) m.range = (m.range || 0) + e.rangeAdd;
		if (e.knockbackAdd) m.knockback = (m.knockback || 0) + e.knockbackAdd;
		this._rebuildSkillInstance(e.skill);
	}

	/** 被动属性（移速 / 血量 / 全局冷却 / 暴击 / 射程 / 减伤 / 控制缩减 / 概率减伤） */
	_applyStat(e) {
		const p = this.player;
		if (e.speedMul)
			p.args.speed = Math.round(p.args.speed * e.speedMul * 100) / 100;
		if (e.maxHealthAdd) {
			p.maxHealth += e.maxHealthAdd;
			p.health = Math.min(p.maxHealth, p.health + e.maxHealthAdd);
		}
		if (e.cdMulAll) {
			for (const key of ["skill1", "skill2", "skill3", "skill4"]) {
				if (p.args.attacks?.[key]) {
					p.args.attacks[key].cd = Math.round(
						(p.args.attacks[key].cd || 0) * e.cdMulAll,
					);
				}
			}
			this._rebuildSkillInstances();
		}
		if (e.critChanceAdd) p._critChance = (p._critChance || 0) + e.critChanceAdd;
		if (e.critDamageSet) p._critDamage = e.critDamageSet;
		if (e.critDamageAdd) p._critDamage = (p._critDamage || 2) + e.critDamageAdd;
		if (e.rangeAdd) p.attackRange = (p.attackRange || 75) + e.rangeAdd;
		if (e.damageReductionAdd)
			p.damageReduction = (p.damageReduction || 0) + e.damageReductionAdd;
		if (e.ccReductionAdd)
			p._ccReduction = (p._ccReduction || 0) + e.ccReductionAdd;
		if (e.dmgReduceChance || e.dmgReduce) {
			if (!p._traitDmgReductions) p._traitDmgReductions = [];
			p._traitDmgReductions.push({
				chance: e.dmgReduceChance || 1,
				reduce: e.dmgReduce || 0,
			});
		}
	}

	/** 重建单个技能实例（onUse 读取实例快照数值） */
	_rebuildSkillInstance(key) {
		if (key === "basic") return; // 普攻直接读 args，无需实例
		const p = this.player;
		const atk = p.args.attacks?.[key];
		if (atk && p.skills[key]) {
			p.skills[key] = Skill.fromHeroData(atk);
		}
	}

	/** 重建全部技能实例 */
	_rebuildSkillInstances() {
		for (const key of ["skill1", "skill2", "skill3", "skill4"]) {
			this._rebuildSkillInstance(key);
		}
	}

	// ============================================================
	//  事件钩子
	// ============================================================

	_registerHooks() {
		const p = this.player;
		p.on("trait:basicHit", ({ target }) => this._onBasicHit(target));
		p.on("trait:skillUsed", ({ skillKey, target }) =>
			this._onSkillUsed(skillKey, target),
		);
	}

	/** 普攻命中 */
	_onBasicHit(target) {
		if (!target) return;
		for (const eff of this._basicHitEffects) {
			if (eff.chance && Math.random() > eff.chance) continue;
			this._applyHitEffect(eff, target);
		}
	}

	/** 技能释放 */
	_onSkillUsed(skillKey, target) {
		for (const eff of this._skillUseEffects) {
			if (eff.skill !== "any" && eff.skill !== skillKey) continue;
			if (eff.chance && Math.random() > eff.chance) continue;
			this._applySkillEffect(eff, skillKey, target);
		}
	}

	/** onBasicHit 效果分派 */
	_applyHitEffect(eff, target) {
		const p = this.player;
		switch (eff.apply) {
			case "selfBuff":
				p.giveBuff(this._buildBuff(p, eff.buff, eff.buffLevelMaxHpRatio));
				break;
			case "selfHeal":
				p.health = Math.min(p.maxHealth, p.health + (eff.amount || 0));
				break;
			case "money":
				p.money += eff.amount || 0;
				break;
			case "targetDebuff":
				// 仅对玩家目标施加（AI 机器人没有 Buff 系统）
				if (eff.debuff && target.giveBuff) {
					target.giveBuff(this._buildBuff(target, eff.debuff, null, p));
				}
				break;
			default:
				console.warn(`[Trait] 未知 onBasicHit 效果: ${eff.apply}`);
		}
	}

	/** onSkillUse 效果分派 */
	_applySkillEffect(eff, skillKey, target) {
		const p = this.player;
		switch (eff.apply) {
			case "selfBuff":
				p.giveBuff(this._buildBuff(p, eff.buff, eff.buffLevelMaxHpRatio));
				break;
			case "selfHeal":
				p.health = Math.min(p.maxHealth, p.health + (eff.amount || 0));
				break;
			case "money":
				p.money += eff.amount || 0;
				break;
			case "cdReset": {
				const key = eff.skillToReset ?? Number(skillKey.replace("skill", ""));
				if (key >= 1 && key <= 4) p.skillCooldowns[key] = 0; // 直接清空冷却
				break;
			}
			case "cdReduceAll":
				this._reduceAllCooldowns(eff.amount || 0);
				break;
			case "targetDebuff":
				// 仅对玩家目标施加（AI 机器人没有 Buff 系统）
				if (target && eff.debuff && target.giveBuff) {
					target.giveBuff(this._buildBuff(target, eff.debuff, null, p));
				}
				break;
			case "targetBonusDamage":
				if (target) target.takeDamage(eff.amount || 0, p);
				break;
			case "targetExecute":
				// 目标生命值低于 30% 时直接"删除"
				if (
					target &&
					target.health > 0 &&
					target.health <= target.maxHealth * 0.3
				) {
					target.takeDamage(target.health, p);
				}
				break;
			case "redrawTrait": {
				const t = this.draw("purple");
				if (t) {
					this.grant(t.id);
					console.log(
						`[Trait] ${p.sessionId} 通过【基因重组·突变】额外获得词条【${t.name}】(${t.rarity})`,
					);
				}
				break;
			}
			default:
				console.warn(`[Trait] 未知 onSkillUse 效果: ${eff.apply}`);
		}
	}

	/** 全局技能冷却缩减（按剩余时间比例） */
	_reduceAllCooldowns(percent) {
		const p = this.player;
		const now = Date.now();
		for (const [k, start] of Object.entries(p.skillCooldowns)) {
			const idx = Number(k);
			if (idx < 1 || idx > 4) continue;
			const cd = p.getSkillData(idx)?.cd || 0;
			const remaining = Math.max(0, cd - (now - start));
			if (remaining > 0) {
				p.skillCooldowns[idx] = now - (cd - remaining * (1 - percent / 100));
			}
		}
	}

	/**
	 * 构建 Buff 实例
	 * @param {Object} owner — 施放者（用于 buffLevelMaxHpRatio 计算与 attacker 归属）
	 * @param {Object} cfg   — { id, level, time }
	 * @param {number} [maxHpRatio] — level 取最大生命值比例（如 0.15 = 15% 最大生命）
	 * @param {Object} [attacker]   — debuff 的施加者（伤害归属）
	 */
	_buildBuff(owner, cfg, maxHpRatio, attacker = null) {
		const BuffClass = getBuffClassById(cfg.id);
		let level = cfg.level || 0;
		if (maxHpRatio)
			level = Math.max(1, Math.round(owner.maxHealth * maxHpRatio));
		return new BuffClass({
			id: cfg.id,
			level,
			time: cfg.time || 0,
			attacker,
		});
	}
}

export default TraitManager;
