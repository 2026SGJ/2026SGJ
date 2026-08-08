import fs from "fs";

/** lazyload.json 路径（与地图等资源一致，相对进程 cwd） */
const LAZYLOAD_PATH = "./src/assets/lazyload/lazyload.json";

/** 缓存：进程内只读一次文件 */
let _cache = null;

/**
 * 读取懒加载资源清单（数组，每项 { asset, url }）
 * 文件缺失 / 损坏时返回空数组（不阻塞对局）
 * @returns {Array<{asset: string, url: string}>}
 */
export function getLazyLoadAssets() {
	if (_cache) return _cache;
	try {
		const parsed = JSON.parse(fs.readFileSync(LAZYLOAD_PATH, "utf-8"));
		_cache = Array.isArray(parsed) ? parsed : [];
	} catch (err) {
		console.error(`[Assets] lazyload.json 读取失败:`, err.message);
		_cache = [];
	}
	return _cache;
}
