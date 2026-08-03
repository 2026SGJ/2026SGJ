import { matchLoop } from './mainloop.js';
import playerEvent from '../sessions/index.js';
import Player from './match/player/index.js';
import World from './match/world.js';
import room from '../network/index.js';
import render from './render.js';

/**
 * Game类
 * 游戏主逻辑
 * 以 sessionId 为 key 追踪玩家实体
 */
class Game {
    constructor() {
        this.matchLoop = null;
        this.players = {};  // sessionId → Player
        this.world = null;
        this.init();
    }

    init() {
        // 初始化游戏
        console.log('游戏初始化');
        this.world = new World({ map_id: '0' });
        this.matchLoop = setInterval(_=>matchLoop(this.players, this.world), 1000 / 20); // 每秒20 Ticks

        playerEvent.on('beforeNewPlayerAdded', ({ sessionId, uuid, event }) => {
            try {
                const data = JSON.parse(event).data;
                console.log(data);
                this.players[sessionId] = new Player(sessionId, data);
                console.log(`Player added: sessionId=${sessionId}, uuid=${uuid}`);
                const i = this.players[sessionId];
                setInterval(() => {
                    const otherPlayersData = [];
                    for (const [id, player] of Object.entries(this.players)) {
                        if (id !== who.sessionId) {
                            otherPlayersData.push(player.remoteData());
                        }
                    }
                    const selfRender = i.render(this.world.culling.bind(this.world));
                    render(who.sessionId, [...selfRender, ...otherPlayersData]);
                }, 1000 / 30); // 每秒30帧
                return true;
            } catch (_) {
                console.error(_);
                return false;
            }
        });

        // 玩家移除
        playerEvent.on('playerRemoved', ({ sessionId, uuid, event }) => {
            if (this.players[sessionId]) {
                delete this.players[sessionId];
                console.log(`Player removed: sessionId=${sessionId}, uuid=${uuid}`);
            }
        });

        // 键盘事件
        playerEvent.on('keyboardEvent', ({ sessionId, uuid, event }) => {
            const player = this.players[sessionId];
            if (!player) return;
            try {
                player.trigger('keyboardEvent', JSON.parse(event).data);
            } catch (_) {}
        });

        // 渲染请求（dest 使用 sessionId）
        room.onMessage('C2SUpdateRender', ({ who, msg }) => {
            const i = this.players[who.sessionId];
            if (!i) return;
            // 收集其他玩家的远程数据
            const otherPlayersData = [];
            for (const [id, player] of Object.entries(this.players)) {
                if (id !== who.sessionId) {
                    otherPlayersData.push(player.remoteData());
                }
            }
            const selfRender = i.render(this.world.culling.bind(this.world));
            render(who.sessionId, [...selfRender, ...otherPlayersData]);
        });
    }

    end() {
        clearInterval(this.matchLoop);
    }
}

export default Game;
