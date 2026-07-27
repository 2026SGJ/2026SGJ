class Entity {
    constructor({ id, type, x, y, asset, isShowed, effects }) {
        this.data = {
            id: id,
            type: type,
            x: x,
            y: y,
            asset: asset,
            isShowed: isShowed,
            color: effects?.color || 0,
            ghost: effects?.ghost || false,
            scale: effects?.scale || 100
        };
    }

    data() {
        return this.data;
    }
}

export default Entity;