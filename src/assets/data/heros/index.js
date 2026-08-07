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

/** 随机挑选一个英雄 id */
export const pickRandomHero = () =>
	HERO_IDS[Math.floor(Math.random() * HERO_IDS.length)];
