import names from './names.js';
import states from './states.js';
import types from './types.js';

/**
 * 道具资源 ID 枚举
 *
 * 组合 道具名称 × 状态，生成渲染用的 asset id。
 *
 * 示例：
 *   items.item_pill_idle       → "item_pill_idle"
 *   items.item_bomb_active     → "item_bomb_active"
 *   items.item_fireball_exploding → "item_fireball_exploding"
 */
const items = {};

for (const nameKey in names) {
    const nameValue = names[nameKey];
    for (const stateKey in states) {
        const stateValue = states[stateKey];
        // asset id 格式: item_{name}_{state}
        items[`item_${nameValue}_${stateValue}`] = `item_${nameValue}_${stateValue}`;
    }
}

export { names as ItemNames, states as ItemStates, types as ItemTypes };
export default items;
