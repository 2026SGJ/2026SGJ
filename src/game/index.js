import { matchLoop } from './mainloop.js';
import playerEvent from '../sessions/index.js';
import Player from './player/index.js';

/**
 * Game类
 * 游戏主逻辑
 */
class Game {
    constructor() {
        this.matchLoop = null;
        this.players = {};
        this.init();
    }

    init() {
        // 初始化游戏
        console.log('游戏初始化');
        this.matchLoop = setInterval(_=>matchLoop(this.players), 1000 / 20); // 每秒20 Ticks
        playerEvent.on('newPlayerAdded', ({player, event}) => {
            console.log(player);
            this.players[player] = (new Player(player));
        });
        playerEvent.on('keyboardEvent', ({player, event}) => {
            // console.log(typeof event, typeof event.data, event);
            try {this.players[player].trigger('keyboardEvent', (JSON.parse(event).data));} catch (_){}
        })
    }

    end() {
        // 结束游戏
        console.log('游戏结束');
        clearInterval(this.matchLoop);
    }
}

export default Game;