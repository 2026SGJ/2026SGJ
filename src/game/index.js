import { matchLoop } from './mainloop.js';
import playerEvent from '../sessions/index.js';
import Player from './match/player/index.js';
import World from './match/world.js';
import room from '../network/index.js';
import { render, renderBatch} from './render.js';
import Shop from './match/item/shop.js';

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
        Shop.resetStock();   // 重置商店库存
        // 主循环：每 tick 更新玩家和世界，随后同步物品栏
        this.matchLoop = setInterval(() => {
            matchLoop(this.players, this.world);
            // 同步所有玩家的物品栏（仅在变动时发送）
            for (const sessionId of Object.keys(this.players)) {
                this._syncInventory(sessionId);
                // 检测商店打开事件，发送 S2CShopOpen
                this._syncShopOpen(sessionId);
            }
        }, 1000 / 20); // 每秒20 Ticks

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

        // ---------- 道具购买 ----------
        playerEvent.on('buyItem', ({ sessionId, uuid, event }) => {
            const player = this.players[sessionId];
            if (!player) return;
            try {
                const data = JSON.parse(event).data;
                const itemId = data.itemId;
                if (!itemId) {
                    room.send('S2CBuyItem', JSON.stringify({
                        dest: sessionId, seq: 0,
                        data: { success: false, reason: '缺少 itemId 参数' }
                    }));
                    return;
                }

                const result = Shop.buy(player, itemId);
                room.send('S2CBuyItem', JSON.stringify({
                    dest: sessionId, seq: 0,
                    data: result
                }));

                // 购买成功后立即同步物品栏
                if (result.success) {
                    this._syncInventory(sessionId);
                }
            } catch (err) {
                console.error('[BuyItem] Error:', err);
                room.send('S2CBuyItem', JSON.stringify({
                    dest: sessionId, seq: 0,
                    data: { success: false, reason: '服务器内部错误' }
                }));
            }
        });

        // ---------- 道具使用（网络消息） ----------
        playerEvent.on('useItem', ({ sessionId, uuid, event }) => {
            const player = this.players[sessionId];
            if (!player) return;
            try {
                const data = JSON.parse(event).data;
                const itemId = data.itemId;
                if (!itemId) {
                    room.send('S2CUseItem', JSON.stringify({
                        dest: sessionId, seq: 0,
                        data: { success: false, reason: '缺少 itemId 参数' }
                    }));
                    return;
                }

                const success = player.useItem(itemId, {
                    world: this.world,
                    players: this.players
                });

                room.send('S2CUseItem', JSON.stringify({
                    dest: sessionId, seq: 0,
                    data: { success, itemId }
                }));

                // 使用后立即同步物品栏
                if (success) {
                    this._syncInventory(sessionId);
                }
            } catch (err) {
                console.error('[UseItem] Error:', err);
                room.send('S2CUseItem', JSON.stringify({
                    dest: sessionId, seq: 0,
                    data: { success: false, reason: '服务器内部错误' }
                }));
            }
        });

        // ---------- 商店列表查询 ----------
        room.onMessage('C2SShopList', ({ who, msg }) => {
            const sessionId = who.sessionId;
            room.send('S2CShopList', JSON.stringify({
                dest: sessionId, seq: 0,
                data: { items: Shop.getShopList() }
            }));
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

    /**
     * 向客户端发送物品栏同步 (S2CInv)
     * 仅在物品栏发生变化时调用（增量同步）
     * @param {string} sessionId
     */
    _syncInventory(sessionId) {
        const player = this.players[sessionId];
        if (!player || !player.inventory) return;

        const inv = player.inventory;
        if (!inv.changed) return;

        room.send('S2CInv', JSON.stringify({
            dest: sessionId,
            seq: 0,
            data: {
                items: inv.serialize(),
                money: player.money,
            }
        }));
        inv.markSynchronized();
    }

    /**
     * 检测并发送 S2CShopOpen 消息
     *
     * 当玩家靠近商店按下 E 键时，shopJustOpened 标志被置位。
     * 本方法检测该标志，发送 S2CShopOpen 给客户端以打开商店 UI，
     * 然后清除标志避免重复发送。
     *
     * @param {string} sessionId - 玩家会话ID
     */
    _syncShopOpen(sessionId) {
        const player = this.players[sessionId];
        if (!player) return;

        if (player.shopJustOpened && player.isShopOpen) {
            // 发送 S2CShopOpen：包含商店道具列表和玩家当前金钱
            room.send('S2CShopOpen', JSON.stringify({
                dest: sessionId,
                seq: 0,
                data: {
                    items: Shop.getShopList(),
                    money: player.money,
                }
            }));
            console.log(
                `[Shop] S2CShopOpen → ${sessionId}, ` +
                `位置 (${player.x.toFixed(0)}, ${player.y.toFixed(0)}), ` +
                `金钱: ${player.money}`
            );

            // 清除一次性标志，防止每 tick 重复发送
            player.shopJustOpened = false;
        }
    }

    end() {
        clearInterval(this.matchLoop);
    }
}

export default Game;
