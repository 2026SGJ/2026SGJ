/**
 * 矿物资源配置
 * 
 * 每种矿物定义了：
 * - miningTime: 长按E键开采所需的时间（毫秒）
 * - money:     开采成功后增加的经济值
 * - respawnTime: 矿物被采集后重新刷新的时间（毫秒）
 * - asset:     渲染时使用的资源名称
 */
const MINERAL_CONFIG = {
    /** 金矿 — 价值最高，开采最慢，刷新最久 */
    gold: {
        miningTime: 3000,
        money: 50,
        respawnTime: 15000,
        asset: 'mineral_gold',
    },
    /** 银矿 — 中等价值 */
    silver: {
        miningTime: 2000,
        money: 30,
        respawnTime: 10000,
        asset: 'mineral_silver',
    },
    /** 铁矿 — 价值较低，开采快，刷新快 */
    iron: {
        miningTime: 1500,
        money: 15,
        respawnTime: 6000,
        asset: 'mineral_iron',
    },
};

export default MINERAL_CONFIG;
