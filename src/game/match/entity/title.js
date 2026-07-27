import Entity from "./entity.js";

class Title extends Entity {
    constructor({ id, type, x, y, asset, isShowed, effects }) {
        super({ id, type, x, y, asset, isShowed, effects });
    }
}

export default Title;