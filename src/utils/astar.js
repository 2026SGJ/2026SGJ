/**
 * A* 寻路算法 — 用于人机 NPC 在格子地图上的路径查找
 *
 * 基于格子图（Grid），支持矩形障碍物（wall），支持对角线移动（8 方向）。
 * 格子大小可配置（cellSize），默认 40px。地图尺寸和障碍物由 world 提供。
 */

// ==================== 常量 ====================

/** 格子大小（像素） */
const DEFAULT_CELL_SIZE = 40;

/** 8 方向邻居偏移（含对角线）：代价 = 直走 1.0, 对角 √2 */
const DIRS_8 = [
    { dx:  1, dy:  0, cost: 1 },
    { dx: -1, dy:  0, cost: 1 },
    { dx:  0, dy:  1, cost: 1 },
    { dx:  0, dy: -1, cost: 1 },
    { dx:  1, dy:  1, cost: Math.SQRT2 },
    { dx: -1, dy:  1, cost: Math.SQRT2 },
    { dx:  1, dy: -1, cost: Math.SQRT2 },
    { dx: -1, dy: -1, cost: Math.SQRT2 },
];

// ==================== 最小堆 ====================

class MinHeap {
    constructor() { this.data = []; }
    push(node) {
        this.data.push(node);
        this._siftUp(this.data.length - 1);
    }
    pop() {
        if (this.data.length === 0) return null;
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0) {
            this.data[0] = last;
            this._siftDown(0);
        }
        return top;
    }
    isEmpty() { return this.data.length === 0; }
    _siftUp(idx) {
        while (idx > 0) {
            const p = (idx - 1) >> 1;
            if (this.data[idx].f >= this.data[p].f) break;
            [this.data[idx], this.data[p]] = [this.data[p], this.data[idx]];
            idx = p;
        }
    }
    _siftDown(idx) {
        const n = this.data.length;
        while (true) {
            let small = idx;
            const l = idx * 2 + 1;
            const r = idx * 2 + 2;
            if (l < n && this.data[l].f < this.data[small].f) small = l;
            if (r < n && this.data[r].f < this.data[small].f) small = r;
            if (small === idx) break;
            [this.data[idx], this.data[small]] = [this.data[small], this.data[idx]];
            idx = small;
        }
    }
}

// ==================== 网格构建 ====================

/**
 * @param {number} mapWidth  地图总宽（像素）
 * @param {number} mapHeight 地图总高（像素）
 * @param {number} [size]    格子大小（默认 40）
 * @returns {{ cols: number, rows: number, cellSize: number, grid: boolean[][] }}
 */
export function buildGrid(mapWidth, mapHeight, size = DEFAULT_CELL_SIZE) {
    const cols = Math.ceil(mapWidth / size);
    const rows = Math.ceil(mapHeight / size);
    const grid = Array.from({ length: cols }, () => new Array(rows).fill(false));
    return { cols, rows, cellSize: size, grid };
}

/**
 * 将世界中的 walls 标记到网格上
 * @param {{ grid: boolean[][], cols: number, rows: number, cellSize: number }} gridInfo
 * @param {object[]} walls  — 有 hitbox 的墙体列表
 */
export function markObstacles(gridInfo, walls) {
    const { grid, cols, rows, cellSize } = gridInfo;
    for (const wall of walls) {
        const hb = wall.hitbox;
        if (!hb || hb.type !== 'rect') continue;
        const left   = hb.x;
        const right  = hb.x + hb.width;
        const top    = hb.y;
        const bottom = hb.y + hb.height;
        const c1 = Math.max(0, Math.floor(left / cellSize));
        const c2 = Math.min(cols - 1, Math.floor((right - 1) / cellSize));
        const r1 = Math.max(0, Math.floor(top / cellSize));
        const r2 = Math.min(rows - 1, Math.floor((bottom - 1) / cellSize));
        for (let c = c1; c <= c2; c++)
            for (let r = r1; r <= r2; r++)
                grid[c][r] = true;
    }
}

// ==================== A* ====================

/** Octile 启发（支持 8 方向，admissible） */
function h(cx, cy, gx, gy) {
    const dx = Math.abs(cx - gx);
    const dy = Math.abs(cy - gy);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * A* 寻路
 *
 * @param {{ grid: boolean[][], cols: number, rows: number, cellSize: number }} gridInfo
 * @param {number} sx - 起点 x（像素）
 * @param {number} sy - 起点 y（像素）
 * @param {number} gx - 终点 x（像素）
 * @param {number} gy - 终点 y（像素）
 * @returns {{x:number,y:number}[] | null} 路径点位（像素坐标），或 null
 */
export function findPath(gridInfo, sx, sy, gx, gy) {
    const { grid, cols, rows, cellSize } = gridInfo;
    const sc = Math.floor(sx / cellSize);
    const sr = Math.floor(sy / cellSize);
    const gc = Math.floor(gx / cellSize);
    const gr = Math.floor(gy / cellSize);

    if (sc === gc && sr === gr) return [{ x: gx, y: gy }];
    if (sc < 0 || sc >= cols || sr < 0 || sr >= rows || grid[sc][sr]) return null;
    if (gc < 0 || gc >= cols || gr < 0 || gr >= rows || grid[gc][gr]) return null;

    const open = new MinHeap();
    const closed = Array.from({ length: cols }, () => new Uint8Array(rows));
    const parentKey = Array.from({ length: cols }, () => new Int32Array(rows).fill(-1));
    let goalReached = null;

    const keyOf = (c, r) => c * rows + r;
    const fromKey = (k) => ({ c: Math.floor(k / rows), r: k % rows });

    open.push({ key: keyOf(sc, sr), c: sc, r: sr, g: 0, f: h(sc, sr, gc, gr) });

    while (!open.isEmpty()) {
        const cur = open.pop();
        if (cur.c === gc && cur.r === gr) {
            goalReached = cur;
            break;
        }
        if (closed[cur.c][cur.r]) continue;
        closed[cur.c][cur.r] = 1;

        for (const d of DIRS_8) {
            const nc = cur.c + d.dx;
            const nr = cur.r + d.dy;
            if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
            if (grid[nc][nr] || closed[nc][nr]) continue;
            // 对角 corner check
            if (d.dx !== 0 && d.dy !== 0) {
                if (grid[cur.c + d.dx][cur.r] || grid[cur.c][cur.r + d.dy]) continue;
            }
            const nKey = keyOf(nc, nr);
            const ng = cur.g + d.cost;
            const nf = ng + h(nc, nr, gc, gr);
            open.push({ key: nKey, c: nc, r: nr, g: ng, f: nf });

            const pk = keyOf(cur.c, cur.r);
            if (parentKey[nc][nr] === -1) {
                parentKey[nc][nr] = pk;
            }
        }
    }

    if (!goalReached) return null;

    // 回溯路径
    const raw = [];
    let k = keyOf(gc, gr);
    while (k !== keyOf(sc, sr)) {
        const p = fromKey(k);
        raw.push({ x: p.c * cellSize + cellSize / 2, y: p.r * cellSize + cellSize / 2 });
        k = parentKey[p.c][p.r];
        if (k === -1) break;
    }
    raw.push({ x: sc * cellSize + cellSize / 2, y: sr * cellSize + cellSize / 2 });
    raw.reverse();

    // 简单平滑：保留每 3 个点
    if (raw.length <= 3) return raw;
    const result = [];
    for (let i = 0; i < raw.length; i += 3) result.push(raw[i]);
    const lstR = raw[raw.length - 1];
    const lstRes = result[result.length - 1];
    if (lstRes.x !== lstR.x || lstRes.y !== lstR.y) result.push(lstR);
    return result;
}

// ==================== 便捷包装 ====================

/**
 * @param {import('../game/match/world.js').default} world
 * @param {number} sx, sy  起点像素
 * @param {number} gx, gy  终点像素
 * @param {{ gridInfo: any, _wallCount: number }} [cache]
 * @returns {{x:number,y:number}[] | null}
 */
export function findPathInWorld(world, sx, sy, gx, gy, cache) {
    const MW = world.mapSize?.width || 2560;
    const MH = world.mapSize?.height || 7200;
    let info;
    if (cache && cache.gridInfo && cache._wallCount === world.walls.length) {
        info = cache.gridInfo;
    } else {
        info = buildGrid(MW, MH);
        markObstacles(info, world.walls);
        if (cache) {
            cache.gridInfo = info;
            cache._wallCount = world.walls.length;
        }
    }
    return findPath(info, sx, sy, gx, gy);
}