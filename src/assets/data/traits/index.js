import NEWTON from './newton.js';
import TESLA from './tesla.js';
import MENDEL from './mendel.js';
import GAUSS from './gauss.js';
import DESCARTES from './descartes.js';
import DALTON from './dalton.js';
import MENDELEEV from './mendeleev.js';
import MORGAN from './morgan.js';
import LAVOISIER from './lavoisier.js';
import DARWIN from './darwin.js';
import ARCHIMEDES from './archimedes.js';
import TURING from './turing.js';

/**
 * 词条数据总表
 *
 * 每个英雄一份专属词条库（词条只能抽到本英雄的词条）。
 * 词条按稀有度分级：blue（蓝色）/ purple（紫色）/ gold（金色）。
 *
 * 结构：
 * {
 *   [heroId]: {
 *     hero: string,          // 英雄 id
 *     name: string,          // 英雄名
 *     traits: Array<{
 *       id, name, rarity, description,
 *       effects: Array<{ type, ... }>
 *     }>
 *   }
 * }
 *
 * 效果字段说明见 traits/newton.js 头部注释，
 * 解释执行见 src/game/match/trait/TraitManager.js。
 */

const TRAIT_POOLS = {
    'newton': NEWTON,
    'tesla': TESLA,
    'mendel': MENDEL,
    'gauss': GAUSS,
    'descartes': DESCARTES,
    'dalton': DALTON,
    'mendeleev': MENDELEEV,
    'morgan': MORGAN,
    'lavoisier': LAVOISIER,
    'darwin': DARWIN,
    'archimedes': ARCHIMEDES,
    'turing': TURING,
};

/** 词条稀有度抽取权重（蓝色 / 紫色 / 金色） */
export const TRAIT_RARITY_WEIGHTS = {
    blue: 55,
    purple: 30,
    gold: 15,
};

/** 词条抽奖商品价格（晶元），与 shop/list.js 中 trait-lottery 一致 */
export const TRAIT_LOTTERY_PRICE = 150;

/**
 * 获取某英雄的专属词条库
 * @param {string} heroId
 * @returns {{hero:string,name:string,traits:Array}|null}
 */
export const getTraitPool = (heroId) => TRAIT_POOLS[heroId] || null;

/**
 * 获取某英雄的全部词条（含 id 索引）
 * @param {string} heroId
 * @returns {Array<{id:string,name:string,rarity:string,description:string,effects:Array}>}
 */
export const getHeroTraits = (heroId) => {
    const pool = TRAIT_POOLS[heroId];
    return pool ? pool.traits : [];
};

export default TRAIT_POOLS;
