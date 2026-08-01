import fs from 'fs';
import Entity from './entity/entity.js';
import Title from './entity/title.js';
import logger from '../../../logger/index.js';

class World {
    constructor({ map_id }) {
        logger.debug(`[world] 构造 World: map_id=${map_id}`);
        this.map_id = map_id ?? null;
        this.entities = [];
        this.init();
    }

    async init() {
        logger.debug(`[world] 加载地图: ./src/game/map/${this.map_id}.json`);
        const mapPath = `./src/game/map/${this.map_id}.json`;
        const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
        this.map_id = mapData.assetId;
        logger.debug(`[world] 地图加载完毕: assetId=${this.map_id}, 实体数=${mapData.entities.length}`);
        for (const entity of mapData.entities) {
            if (entity.type === 'title') {
                const titleEntity = new Title(entity);
                this.entities.push(titleEntity);
                logger.debug(`[world] 添加标题实体: id=${entity.id}, pos=(${entity.x}, ${entity.y})`);
                continue;
            }
            this.entities.push(new Entity(entity));
            logger.debug(`[world] 添加实体: id=${entity.id}, type=${entity.type}, pos=(${entity.x}, ${entity.y})`);
        }
        logger.log(`[world] 世界初始化完成: map_id=${this.map_id}, 总实体数=${this.entities.length}`);
    }

    culling(x, y, halfw, halfh) {
        return this.entities;
    }
}

export default World;
