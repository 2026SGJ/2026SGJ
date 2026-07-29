import fs from 'fs';
import Entity from './entity/entity.js';
import Title from './entity/title.js';
import { workerData } from 'worker_threads';

class World {
    constructor({ map_id }) {
        this.map_id = map_id ?? null;
        this.entities = [];
    }

    async init() {
        // 初始化地图
        const mapData = JSON.parse(fs.readFileSync(`./src/map/${this.map_id}.json`, 'utf-8'));
        this.map_id = mapData.assetId;
        for (const entity of mapData.entities) {
            // 初始化实体
            if (entity.type === 'title') {
                // 初始化标题实体
                const titleEntity = new Title(entity);
                this.entities.push(titleEntity);
                continue;
            } else {
                const entity = new Entity(entity);
                this.entities.push(entity);
            }
            this.entities.push(new Entity(entity));
        }
    }

    culling (x, y, halfw, halfh) {
        let visibleEntities = [];
        this.entities.forEach(_=>{
            if(Math.abs(_.x-x) <= halfw && Math.abs(_.y-y) <= halfh) {
                visibleEntities.push(_);
            }
        });
    }
}

export default World;