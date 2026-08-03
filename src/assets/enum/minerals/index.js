import names from './names.js';
import states from './states.js';

/**
 * 矿物资源 ID 枚举
 * 
 * 组合 矿物类型 × 状态，生成渲染用的 asset id。
 * 
 * 示例：
 *   minerals.mineral_gold_idle      → "mineral_gold_idle"
 *   minerals.mineral_silver_collected → "mineral_silver_collected"
 */
const minerals = {};

for (const typeKey in names) {
    const typeValue = names[typeKey];
    for (const stateKey in states) {
        const stateValue = states[stateKey];
        // asset id 格式: mineral_{type}_{state}
        minerals[`mineral_${typeValue}_${stateValue}`] = `mineral_${typeValue}_${stateValue}`;
    }
}

export default minerals;
