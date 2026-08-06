import names from './names.js';

/**
 * 实体资源 ID 枚举
 *
 * 将实体名称映射为客户端渲染用的 asset id。
 *
 * 示例：
 *   entities.SHOP  → "shop"
 */
const entities = {};

// 直接映射名称到 asset id
for (const key in names) {
    entities[key] = names[key];
}

export { names as EntityNames };
export default entities;
