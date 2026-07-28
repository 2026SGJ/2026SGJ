import fs from 'fs';
import Entity from './entity/entity.js';
import Title from './entity/title.js';

class World {
    constructor({ map_id }) {
        this.map_id = map_id;
        this.entities = [];
    }

    async init() {
        // 初始化地图
        const mapData = JSON.parse(fs.readFileSync(`./data/maps/${this.map_id}.json`, 'utf-8'));
        this.map_id = mapData.assetId;
        for (const entity of mapData.entities) {
            // 初始化实体
            if (entity.type === 'title') {
                // 初始化标题实体
                const titleEntity = new Title(entity);
                this.entities.push(titleEntity);
                continue;
            }
            this.entities.push(new Entity(entity));
        }
    }
}