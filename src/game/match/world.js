import fs from 'fs';
import Entity from './entity/entity.js';
import Title from './entity/title.js';
import Wall from './entity/wall.js';
import Mineral from './entity/mineral.js';
import Outpost from './entity/outpost.js';
import Shop from './entity/shop.js';

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
            }
            // 初始化商店实体（静态交互实体，使用 Shop 类以支持库存/刷新等逻辑）
            if (entity.type === 'shop') {
                const shopEntity = new Shop(entity);
                this.shops.push(shopEntity);
                this.entities.push(shopEntity);
                console.log(`[World] 商店实体已加载: id=${entity.id}, 位置 (${entity.x}, ${entity.y})`);
                continue;
            }
            this.entities.push(new Entity(entity));
        }
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

    culling (x, y, halfw, halfh) {
        // 返回所有实体（包括道具实体），保证渲染完整
        return this.entities;
    }
}

export default World;