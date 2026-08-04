import names from './names.js';

/**
 * 地图资源 ID 枚举
 *
 * 目前地图元素暂无状态变化，直接导出名称作为 asset id。
 *
 * 示例：
 *   maps.base_A  → "base_A"
 *   maps.wall    → "wall"
 *   maps.black   → "black"
 */
const maps = {};

for (const key in names) {
    const value = names[key];
    maps[value] = value;
}

export default maps;