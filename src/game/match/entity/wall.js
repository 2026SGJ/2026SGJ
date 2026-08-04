import Entity from './entity.js';

class Wall extends Entity {
    constructor({ id, type, x, y, asset, isShowed, effects, isFixed, width, height, dir }) {
        super({ id, type, x, y, asset, isShowed, effects, width, height, dir });
        this.data.isFixed = false;
        this.hitbox = {
            type: 'rect',
            x: this.data.x - this.data.width / 2,
            y: this.data.y - this.data.height / 2,
            width: this.data.width,
            height: this.data.height
        };
    }
}

export default Wall;