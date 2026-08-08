import names from "./names.js";

/**
 * 区域资源 ID 枚举
 *
 * 将区域名称映射为客户端渲染用的 asset id。
 *
 * 示例：
 *   areas.AREA_HASTE  → "area_haste"
 */
const areas = {};

// 直接映射名称到 asset id
for (const key in names) {
	areas[key] = names[key];
}

export { names as AreaNames };
export default areas;
