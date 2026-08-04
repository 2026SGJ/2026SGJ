import { matchLoop } from './mainloop.js';
import playerEvent from '../sessions/index.js';
import Player from './match/player/index.js';
import World from './match/world.js';
import room from '../network/index.js';
import { render, renderBatch} from './render.js';

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
        this.renderBuffer = {};  // sessionId → Array<RenderData>
        this.init();
    }

    init() {
        // 初始化游戏
        console.log('游戏初始化');
        this.world = new World({ map_id: '1' });
        this.matchLoop = setInterval(_=>matchLoop(this.players, this.world), 1000 / 20); // 每秒20 Ticks

        playerEvent.on('beforeNewPlayerAdded', ({ sessionId, uuid, event }) => {
            try {
                const data = JSON.parse(event).data;

                // ---------- 队伍分配 ----------
                // 统计当前两队人数，新玩家加入人数较少的队伍；
                // 若两队人数相同，随机选择一队。
                let teamACount = 0;
                let teamBCount = 0;
                for (const p of Object.values(this.players)) {
                    if (p.team === 'A') teamACount++;
                    else if (p.team === 'B') teamBCount++;
                }
                let assignedTeam;
                if (teamACount < teamBCount) {
                    assignedTeam = 'A';
                } else if (teamBCount < teamACount) {
                    assignedTeam = 'B';
                } else {
                    assignedTeam = Math.random() < 0.5 ? 'A' : 'B';
                }
                data.team = assignedTeam;
                console.log(`[Team] ${sessionId} assigned to team ${assignedTeam} (A:${teamACount}, B:${teamBCount})`);
                // ---------- 队伍分配 ----------

                this.players[sessionId] = new Player(sessionId, data);
                console.log(`Player added: sessionId=${sessionId}, uuid=${uuid}`);
                const i = this.players[sessionId];
                this.renderBuffer[sessionId] = [];
                // setInterval(() => {
                //     if (this.renderBuffer[sessionId].length > 2) return; // 如果渲染缓冲区过长，跳过本次渲染
                //     const startTime = Date.now();
                //     const otherPlayersData = [];
                //     for (const [id, player] of Object.entries(this.players)) {
                //         if (id !== sessionId) {
                //             otherPlayersData.push(player.remoteData());
                //         }
                //     }
                //     const selfRender = i.render(this.world.culling.bind(this.world));
                //     // render(sessionId, [...selfRender, ...otherPlayersData]);
                //     const data = [...selfRender, ...otherPlayersData];
                //     // this.renderBuffer[sessionId].push(data);
                //     render(sessionId, data);
                //     const endTime = Date.now();
                //     if (endTime - startTime > 50) {
                //         console.warn(`渲染耗时过长: ${endTime - startTime}ms`);
                //     }
                // }, 1000 / 20); // 每秒20帧
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
            // console.log(`渲染请求: sessionId=${who.sessionId}, cachedFrames=${this.renderBuffer[who.sessionId].length}`);
            // while (this.renderBuffer[who.sessionId].length > 0) {
            //     const renderData = this.renderBuffer[who.sessionId].shift();
            //     render(who.sessionId, renderData);
            // }
            // if (this.renderBuffer[who.sessionId].length !== 0) {
            //     renderBatch(who.sessionId, this.renderBuffer[who.sessionId]);
            // }
            const startTime = Date.now();
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
