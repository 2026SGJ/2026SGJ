class Entity {
    constructor({ id, type, x, y, asset, dir, isShowed, effects }) {
        this.data = {
            id: id,
            type: type,
            x: x,
            y: y,
            asset: asset,
            dir: dir,
            isShowed: isShowed,
            color: effects?.color || 0,
            ghost: effects?.ghost || 0,
            scale: effects?.scale || 100
        };
    }

    getData() {
        return this.data;
    }
}

export default Entity;