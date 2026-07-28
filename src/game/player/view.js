import World from "../../world.js";

class PlayerView {
    constructor({ player, world }) {
        this.player = player;
        this.world = world;
    }

    render() {
        // 渲染玩家视图
        const entities = this.world.entities.map(entity => { let t = entity.data; t.action = 'update'; return t; });
        return {
            player: this.player.data,
            entities: entities
        };
    }
}

export default PlayerView;