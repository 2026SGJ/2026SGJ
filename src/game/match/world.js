import fs from 'fs';
import Entity from './entity/entity.js';
import Title from './entity/title.js';
import Wall from './entity/wall.js';
import Mineral from './entity/mineral.js';

class World {
    constructor({ map_id }) {
        this.map_id = map_id ?? null;
        this.entities = [];
        this.walls = [];
        /** @type {Mineral[]} 矿物实体列表，用于快速查找和重生计时 */
        this.minerals = [];
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
            this.entities.push(new Entity(entity));
        }
    }

    /**
     * 每 tick 调用：检查所有矿物是否需要重生
     */
    tick() {
        const now = Date.now();
        for (const mineral of this.minerals) {
            mineral.tryRespawn(now);
        }
    }

    culling (x, y, halfw, halfh) {
        return this.entities;
    }
}

export default World;
