/**
 * 矿物资源配置
 * 
 * 每种矿物定义了：
 * - miningTime: 长按E键开采所需的时间（毫秒）
 * - money:     开采成功后增加的经济值
 * - respawnTime: 矿物被采集后重新刷新的时间（毫秒）
 * - asset:     渲染时使用的资源名称
 * 
 * 经济平衡设计（每分钟产出≈500单位货币）：
 *   金矿(大矿): money=20, respawnTime=30s → 2次/分钟 → 40货币/分钟/个  ×4个 = 160
 *   银矿(中矿): money=10, respawnTime=24s → 2.5次/分钟 → 25货币/分钟/个 ×8个 = 200
 *   铁矿(小矿): money=5,  respawnTime=18s → 3.33次/分钟 → 16.7货币/分钟/个 ×8个 = 133
 *   总计: 160 + 200 + 133 ≈ 493 ≈ 500 货币/分钟
 */
const MINERAL_CONFIG = {
    /** 金矿 — 大矿，价值最高，刷新最久 */
    gold: {
        miningTime: 3000,
        money: 20,
        respawnTime: 30000,
        asset: 'mineral_gold',
    },
    /** 银矿 — 中矿，中等价值 */
    silver: {
        miningTime: 2000,
        money: 10,
        respawnTime: 24000,
        asset: 'mineral_silver',
    },
    /** 铁矿 — 小矿，价值较低，开采快，刷新快 */
    iron: {
        miningTime: 1500,
        money: 5,
        respawnTime: 18000,
        asset: 'mineral_iron',
    },
};

export default MINERAL_CONFIG;