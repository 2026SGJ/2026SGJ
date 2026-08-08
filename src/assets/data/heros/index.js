import { config } from "../../../config.js";
import NEWTON from "./newton.js";
import TESLA from "./tesla.js";
import MENDEL from "./mendel.js";
import GAUSS from "./gauss.js";
import DESCARTES from "./descartes.js";
import DALTON from "./dalton.js";
import MENDELEEV from "./mendeleev.js";
import MORGAN from "./morgan.js";
import LAVOISIER from "./lavoisier.js";
import DARWIN from "./darwin.js";
import ARCHIMEDES from "./archimedes.js";
import TURING from "./turing.js";

export default {
	newton: NEWTON,
	tesla: TESLA,
	mendel: MENDEL,
	gauss: GAUSS,
	descartes: DESCARTES,
	dalton: DALTON,
	mendeleev: MENDELEEV,
	morgan: MORGAN,
	lavoisier: LAVOISIER,
	darwin: DARWIN,
	archimedes: ARCHIMEDES,
	turing: TURING,
};

/** 全部英雄 id 列表（人机随机选英雄等场景使用） */
export const HERO_IDS = Object.keys({
	newton: NEWTON,
	tesla: TESLA,
	mendel: MENDEL,
	gauss: GAUSS,
	descartes: DESCARTES,
	dalton: DALTON,
	mendeleev: MENDELEEV,
	morgan: MORGAN,
	lavoisier: LAVOISIER,
	darwin: DARWIN,
	archimedes: ARCHIMEDES,
	turing: TURING,
});

// ============================================================
//  禁用英雄（禁用英雄不可被玩家选择，也不可被人机随机使用）
//  配置来源：data/config.json 的 disabledHeroes 或环境变量 DISABLED_HEROES
//  （逗号分隔，如 'tesla,mendel'，见 src/config.js）
// ============================================================

/** 禁用英雄 id 集合（小写规范化） */
export const DISABLED_HEROES = new Set(
	(config.disabledHeroes || []).map((id) => String(id).toLowerCase()),
);

/** 某英雄是否被禁用 */
export const isHeroDisabled = (heroId) =>
	DISABLED_HEROES.has(String(heroId || "").toLowerCase());

/**
 * 可用（未被禁用）的英雄 id 列表
 * 防御性兜底：若全部英雄都被禁用，回退为全量列表（保证对局仍可进行）
 */
export const ENABLED_HERO_IDS = (() => {
	const enabled = HERO_IDS.filter((id) => !DISABLED_HEROES.has(id));
	return enabled.length > 0 ? enabled : HERO_IDS;
})();

/**
 * 默认英雄：第一个可用英雄（正常为 'newton'，被禁用时自动顺延到下一个可用英雄）
 * 默认英雄免解锁校验、作为非法值 / 禁用值回退目标
 */
export const DEFAULT_HERO = ENABLED_HERO_IDS[0] || "newton";

/** 随机挑选一个可用（未被禁用）英雄 id */
export const pickRandomHero = () =>
	ENABLED_HERO_IDS[Math.floor(Math.random() * ENABLED_HERO_IDS.length)];
