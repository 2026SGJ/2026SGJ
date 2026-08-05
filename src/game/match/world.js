import fs from 'fs';
import Entity from './entity/entity.js';
import Title from './entity/title.js';
import Wall from './entity/wall.js';
import Mineral from './entity/mineral.js';
import Outpost from './entity/outpost.js';
import Shop from './entity/shop.js';
import Base from './entity/base.js';

class World {
    constructor({ map_id }) {
        this.map_id = map_id ?? null;
        this.entities = [];
        this.walls = [];
        /** @type {Mineral[]} 矿物实体列表，用于快速查找和重生计时 */
        this.minerals = [];
        /**
         * 商店实体列表（静态交互实体，玩家靠近按 E 打开商店）
         * @type {Entity[]}
         */
        this.shops = [];
        /**
         * 道具实体列表（炸弹、火球、地雷等动态生成的物品实体）
         * 每 tick 更新并在 tick 中可能产生删除请求
         * @type {import('./match/item/bomb.js').default[]}
         */
        this.itemEntities = [];
        /**
         * 前哨站实体列表（10 个沿 x=1280 中轴线分布）
         * 每 tick 更新占领进度，支持重生点设置
         * @type {Outpost[]}
         */
        this.outposts = [];
        /**
         * 基地实体列表（A/B 两队各一个，血量固定 4000）
         * 由 MatchManager 每 tick 结算基地伤害与复活资格
         * @type {Base[]}
         */
        this.bases = [];

        // ---------- 渲染增量同步（带宽优化） ----------
        /**
         * 全局渲染版本号：每 tick 递增一次（由 refreshRenderTicks 维护）。
         * 实体 / 玩家的 _lastChangeTick 与此比较，决定渲染组装时是否发送。
         * @type {number}
         */
        this.renderTick = 0;
        /**
         * 待通知客户端的「已移除实体」列表（{ id, removedAtTick }）。
         * 客户端采用「缺失沿用上一帧」设计，因此实体从世界中移除时必须显式
         * 发送 { type:'delete', id } 删除包，通知客户端停止跟踪并释放缓存，
         * 否则会残留幽灵渲染并导致客户端内存泄漏。
         * @type {Array<{id: string, removedAtTick: number}>}
         */
        this._pendingRemovals = [];
        // ---------- 渲染增量同步 ----------

        this.init();
    }

    async init() {
        // 初始化地图
        const mapData = JSON.parse(fs.readFileSync(`./src/game/map/${this.map_id}.json`, 'utf-8'));
        this.map_id = mapData.assetId;
        for (const entity of mapData.entities) {
            if (entity.type === 'title') {
                const titleEntity = new Title(entity);
                this.entities.push(titleEntity);
                continue;
            }
            if (entity.type === 'wall') {
                const wallEntity = new Wall(entity);
                this.walls.push(wallEntity);
                this.entities.push(wallEntity);
                continue;
            }
            // 初始化矿物实体
            if (entity.type === 'mineral') {
                const mineralEntity = new Mineral(entity);
                this.minerals.push(mineralEntity);
                this.entities.push(mineralEntity);
                continue;
            }
            // 初始化前哨站实体
            if (entity.type === 'outpost') {
                const outpostEntity = new Outpost(entity);
                this.outposts.push(outpostEntity);
                this.entities.push(outpostEntity);
                console.log(`[World] 前哨站实体已加载: id=${entity.id}, 位置 (${entity.x}, ${entity.y})`);
                continue; // 已加入 entities，避免末尾重复添加普通 Entity 副本
            }
            // 初始化商店实体（静态交互实体，使用 Shop 类以支持库存/刷新等逻辑）
            if (entity.type === 'shop') {
                const shopEntity = new Shop(entity);
                this.shops.push(shopEntity);
                this.entities.push(shopEntity);
                console.log(`[World] 商店实体已加载: id=${entity.id}, 位置 (${entity.x}, ${entity.y})`);
                continue;
            }
            // 初始化基地实体（若地图定义了 base 类型实体）
            if (entity.type === 'base') {
                const baseEntity = new Base(entity);
                this.bases.push(baseEntity);
                this.entities.push(baseEntity);
                console.log(`[World] 基地实体已加载: id=${entity.id}, 队伍=${entity.team}, 位置 (${entity.x}, ${entity.y})`);
                continue;
            }
            this.entities.push(new Entity(entity));
        }

        // 若地图未定义基地实体，则按双方出生点创建默认基地
        // A 队出生点（底部 1280, 6840），B 队出生点（顶部 1280, 360）
        if (this.bases.length === 0) {
            this._addDefaultBases();
        }

        // 初始化渲染增量同步的静态实体标记与指纹缓存
        this._initRenderCaches();
    }

    // ============================================================
    //  渲染增量同步（带宽优化）
    // ============================================================

    /**
     * 初始化渲染缓存：标记静态实体并预缓存指纹
     *
     * 静态实体（wall / title / 普通装饰）的渲染数据在整场对局中永不变化，
     * 只需在玩家首次渲染时发送一次。这里预缓存其指纹，后续 refreshRenderTicks
     * 跳过静态实体，避免每 tick 无谓序列化。
     */
    _initRenderCaches() {
        // 静态实体类型：wall（墙体）/ title（标题）/ 普通 entity（纯装饰）
        // 注意：实体类型存放在 data.type（Entity 实例自身无 type 属性）
        const STATIC_TYPES = new Set(['wall', 'title', 'entity']);
        for (const e of this.entities) {
            e._isStatic = STATIC_TYPES.has(e.data.type);
            if (e._isStatic) {
                // 预缓存指纹；_lastChangeTick 保持 0（首次渲染由玩家的 seen 集合保证发送）
                e._renderFingerprint = JSON.stringify(e.getRenderData());
            }
        }
    }

    /**
     * 每 tick 刷新所有非静态实体的渲染指纹（渲染增量同步核心）
     *
     * 必须在「本 tick 全部游戏逻辑更新完成后」调用（Game 主循环末尾），
     * 以当前递增后的 renderTick 作为统一基准：
     *   1. renderTick 自增
     *   2. 对每个非静态实体生成渲染数据指纹，与上次比对；
     *      不同则记录 _lastChangeTick = renderTick（渲染组装时据此判断是否发送）
     *
     * 该机制与游戏逻辑完全解耦：矿物采集/重生、前哨站占领、基地扣血、
     * 道具实体移动等任何影响 getData() 输出的变化都会被自动捕获，
     * 不存在脏标记的「漏标 / 误标」问题。
     */
    refreshRenderTicks() {
        this.renderTick++;
        for (const e of this.entities) {
            if (e._isStatic) continue; // 静态实体不参与每 tick 指纹刷新
            const fp = JSON.stringify(e.getRenderData());
            if (fp !== e._renderFingerprint) {
                e._renderFingerprint = fp;
                e._lastChangeTick = this.renderTick;
            }
        }
        // 清理过期移除记录：保留最近 5 个 tick（250ms），
        // 给足所有客户端一次渲染请求的机会（防止客户端卡帧漏收隐藏包）
        if (this._pendingRemovals.length > 0) {
            this._pendingRemovals = this._pendingRemovals.filter(
                (r) => this.renderTick - r.removedAtTick < 5
            );
        }
    }

    /**
     * 记录一个实体的移除，供渲染组装时向客户端发送 { type:'delete', id } 删除包，
     * 通知客户端停止跟踪该实体并释放缓存（避免 isShowed:false 只隐藏不释放导致的内存泄漏）
     * （通用入口：道具实体自毁 / 玩家离开 / 人机被踢均复用）
     *
     * @param {{id: string}} entity — 至少包含渲染 id
     */
    markEntityRemoved({ id }) {
        if (!id) return;
        this._pendingRemovals.push({ id, removedAtTick: this.renderTick });
    }

    /**
     * 创建默认基地（A/B 各一个，位于各自出生点）
     * 基地为非阻挡实体，血量固定 4000，供渲染与 MatchManager 结算使用
     */
    _addDefaultBases() {
        const baseA = new Base({
            id: 'base_A', type: 'base', team: 'A',
            x: 1280, y: 6840, asset: 'base_A',
            width: 180, height: 180, isShowed: true, dir: 0, z_index: 2,
        });
        const baseB = new Base({
            id: 'base_B', type: 'base', team: 'B',
            x: 1280, y: 360, asset: 'base_B',
            width: 180, height: 180, isShowed: true, dir: 0, z_index: 2,
        });
        this.bases.push(baseA, baseB);
        this.entities.push(baseA, baseB);
        console.log('[World] 默认基地已创建: A(1280,6840) / B(1280,360)，血量 4000');
    }

    /**
     * 添加道具实体到世界中
     * @param {Entity} entity - 道具实体实例
     */
    addItemEntity(entity) {
        this.itemEntities.push(entity);
        this.entities.push(entity);    // 同时加入渲染列表
    }

    /**
     * 从世界中移除道具实体
     * @param {Entity} entity - 要移除的实体
     */
    removeItemEntity(entity) {
        const idx = this.itemEntities.indexOf(entity);
        if (idx !== -1) {
            this.itemEntities.splice(idx, 1);
        }
        const eIdx = this.entities.indexOf(entity);
        if (eIdx !== -1) {
            this.entities.splice(eIdx, 1);
        }
        // 记录移除：增量渲染下客户端沿用上一帧，需显式发送 delete 包，
        // 通知客户端停止跟踪该实体并释放缓存
        this.markEntityRemoved({ id: entity.data.id });
    }

    /**
     * 每 tick 调用：检查所有矿物是否需要重生，并更新所有道具实体
     * @param {Object<string, import('./match/player/index.js').default>} players - 所有玩家映射
     */
    tick(players) {
        const now = Date.now();
        for (const mineral of this.minerals) {
            mineral.tryRespawn(now);
        }

        // ---- 更新前哨站占领进度 ----
        // 注意：匹配阶段玩家 canAct=false，tickCapture 内部会跳过，
        // 因此前哨站仅在对局开始后才可能被占领。
        for (const outpost of this.outposts) {
            outpost.tickCapture(players);
        }

        // ---- 更新道具实体（炸弹、火球等） ----
        // 反向遍历以便安全移除过期实体
        for (let i = this.itemEntities.length - 1; i >= 0; i--) {
            const entity = this.itemEntities[i];
            let alive = false;

            // 根据实体类型调用不同的 tick 方法
            // 投射物（火球、闪光弹、毒镖）需要 dt、walls、players、world
            if (entity.tick.length >= 3) {
                // 多参数 tick：投射物类型
                const dt = 1000 / 20; // 50ms per tick at 20 ticks/s
                alive = entity.tick(dt, this.walls, players, this);
            } else if (entity.tick.length === 2) {
                // 双参数 tick：放置物类型（炸弹、地雷、手雷等）
                alive = entity.tick(players, this);
            } else {
                // 单参数或无参 tick（爆炸实体等）
                alive = entity.tick() !== false;
            }

            if (!alive) {
                this.removeItemEntity(entity);
            }
        }
    }

    /**
     * 商店接近检测
     *
     * 检查玩家是否靠近任意商店实体（60px 范围内）。
     * 若靠近则返回该商店实体引用，否则返回 null。
     *
     * @param {number} px - 玩家 X 坐标
     * @param {number} py - 玩家 Y 坐标
     * @returns {Entity|null} 最近的可交互商店实体
     */
    getNearbyShop(px, py) {
        const INTERACTION_RANGE = 60; // 商店交互距离（像素）
        for (const shop of this.shops) {
            const sx = shop.data.x;
            const sy = shop.data.y;
            // 使用矩形检测：玩家中心到实体中心的距离
            const dist = Math.hypot(px - sx, py - sy);
            if (dist <= INTERACTION_RANGE) {
                return shop;
            }
        }
        return null;
    }

    /**
     * 前哨站重生点查询
     *
     * 查找玩家附近（25px 内）且已被己方占领的前哨站。
     * 用于玩家按 E 设置重生点。
     *
     * @param {number} px - 玩家 X 坐标
     * @param {number} py - 玩家 Y 坐标
     * @param {string} team - 玩家队伍 'A' | 'B'
     * @returns {Outpost|null} 可设置重生点的前哨站
     */
    getNearbySpawnOutpost(px, py, team) {
        const SPAWN_SET_RADIUS = 25;
        for (const outpost of this.outposts) {
            if (outpost.state.owner === team && outpost.isWithinRange(px, py, SPAWN_SET_RADIUS)) {
                return outpost;
            }
        }
        return null;
    }

    /**
     * [废弃] 旧全量渲染管线的视野裁剪（不再被调用）
     *
     * 增量渲染下静态实体只发一次、动态实体变化才发，全量广播成本已大幅降低；
     * 如需进一步按玩家视野裁剪可见实体，可在此实现（注意离开视野的实体
     * 需要配合 { type:'delete', id } 删除包，避免客户端沿用旧帧残留）。
     */
    culling (x, y, halfw, halfh) {
        // 返回所有实体（包括道具实体），保证渲染完整
        return this.entities;
    }
}

export default World;