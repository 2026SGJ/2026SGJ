import fs from 'fs';
import Entity from './entity/entity.js';
import Title from './entity/title.js';
import Wall from './entity/wall.js';

class World {
    constructor({ map_id }) {
        this.map_id = map_id ?? null;
        this.entities = [];
        this.walls = [];
        this.init();
    }

    async init() {
        // 初始化地图
        const mapData = JSON.parse(fs.readFileSync(`./src/game/map/${this.map_id}.json`, 'utf-8'));
        this.map_id = mapData.assetId;
        for (const entity of mapData.entities) {
            // 初始化实体
            if (entity.type === 'title') {
                // 初始化标题实体
                const titleEntity = new Title(entity);
                this.entities.push(titleEntity);
                continue;
            }
            if (entity.type === 'wall') {
                // 初始化墙体实体
                const wallEntity = new Wall(entity);
                this.walls.push(wallEntity);
                this.entities.push(wallEntity);
                continue;
            }
            this.entities.push(new Entity(entity));
        }
    }

    culling (x, y, halfw, halfh) {
        // let visibleEntities = [];
        // this.entities.forEach(_=>{
        //     if(Math.abs(_.x-x) <= halfw && Math.abs(_.y-y) <= halfh) {
        //         visibleEntities.push(_);
        //     }
        // });
        // console.log(visibleEntities);
        // return visibleEntities;
        return this.entities;
    }
}

export default World;