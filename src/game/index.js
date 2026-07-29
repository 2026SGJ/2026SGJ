import { matchLoop } from './mainloop.js';
import playerEvent from '../sessions/index.js';
import Player from './player/index.js';
import World from './match/world.js';
import room from '../network/index.js';
import render from './render.js';

/**
 * Game类
 * 游戏主逻辑
 */
class Game {
    constructor() {
        this.matchLoop = null;
        this.players = {};
        this.world = null;
        this.init();
    }

    init() {
        // 初始化游戏
        console.log('游戏初始化');
        this.world = new World({ map_id: 'test' });
        this.matchLoop = setInterval(_=>matchLoop(this.players, this.world), 1000 / 20); // 每秒20 Ticks
        playerEvent.on('newPlayerAdded', ({player, event}) => {
            console.log(player);
            this.players[player] = (new Player(player));
        });
        playerEvent.on('keyboardEvent', ({player, event}) => {
            // console.log(typeof event, typeof event.data, event);
            try {this.players[player].trigger('keyboardEvent', (JSON.parse(event).data));} catch (_){}
        });
        room.onMessage('C2SUpdateRender', ({ who, msg }) => {
            const i = this.players[who.extra.uuid];
            render(who.extra.uuid, i.render(world.culling));
        });
    }

    end() {
        clearInterval(this.matchLoop);
    }
}

export default Game;