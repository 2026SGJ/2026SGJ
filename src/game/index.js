import { matchLoop } from './mainloop.js';
import playerEvent from '../sessions/index.js';
import Player from './player/index.js';
import World from './match/world.js';
import room from '../network/index.js';
import render from './render.js';
import logger from '../../logger/index.js';

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
        logger.log('[game] ========== 游戏初始化开始 ==========');

        // 初始化世界
        logger.debug('[game] 创建世界实例...');
        this.world = new World({ map_id: 'test' });
        logger.debug('[game] 世界实例创建完成');

        // 启动主循环
        logger.debug('[game] 启动主循环: 20 Ticks/s');
        this.matchLoop = setInterval(_ => matchLoop(this.players, this.world), 1000 / 20);
        logger.log('[game] 主循环已启动');

        // --- 新玩家加入（白名单每个 session 都是新玩家；非白名单首次登录也是新玩家） ---
        playerEvent.on('newPlayerAdded', ({ sessionId, uuid, event }) => {
            logger.log(`[game] >>> newPlayerAdded: sessionId=${sessionId}, uuid=${uuid}`);
            logger.debug(`[game] 当前玩家数: ${Object.keys(this.players).length}`);

            const player = new Player(sessionId, uuid);
            logger.debug(`[game] Player 实例已创建: sessionId=${sessionId}, uuid=${uuid}, hero=${player.hero}`);
            this.players[sessionId] = player;

            logger.log(`[game] 玩家已加入世界: sessionId=${sessionId}, uuid=${uuid}, 当前玩家总数=${Object.keys(this.players).length}`);
        });

        // --- 非白名单玩家重复登录：保留世界状态迁移到新 sessionId，清空事件队列 ---
        playerEvent.on('playerReconnected', ({ oldSessionId, newSessionId, uuid, event }) => {
            logger.log(`[game] >>> playerReconnected: oldSessionId=${oldSessionId}, newSessionId=${newSessionId}, uuid=${uuid}`);
            logger.debug(`[game] 重连前玩家数: ${Object.keys(this.players).length}`);
            if (this.players[oldSessionId]) {
                const player = this.players[oldSessionId];
                logger.debug(`[game] 找到旧玩家实例: oldSessionId=${oldSessionId}, pos=(${player.x}, ${player.y})`);
                player.sessionId = newSessionId;
                player.clearEventQueue();
                this.players[newSessionId] = player;
                delete this.players[oldSessionId];
                logger.log(`[game] 玩家 ${uuid} 重连完成: old=[${oldSessionId}] → new=[${newSessionId}], 事件队列已清空, 世界状态已保留. pos=(${player.x}, ${player.y})`);
            } else {
                logger.warn(`[game] 玩家 ${uuid} 旧 session [${oldSessionId}] 未找到, 创建新实例`);
                this.players[newSessionId] = new Player(newSessionId, uuid);
                logger.debug(`[game] 已为 ${uuid} 创建新 Player 实例: newSessionId=${newSessionId}`);
            }
            logger.debug(`[game] 重连后玩家数: ${Object.keys(this.players).length}`);
        });

        // --- 玩家移除 ---
        playerEvent.on('playerRemoved', ({ sessionId, uuid, event }) => {
            logger.log(`[game] >>> playerRemoved: sessionId=${sessionId}, uuid=${uuid}`);
            logger.debug(`[game] 移除前玩家数: ${Object.keys(this.players).length}`);
            if (this.players[sessionId]) {
                const player = this.players[sessionId];
                logger.debug(`[game] 移除玩家最后位置: pos=(${player.x}, ${player.y})`);
                delete this.players[sessionId];
                logger.log(`[game] 玩家已移除: sessionId=${sessionId}, uuid=${uuid}, 当前玩家总数=${Object.keys(this.players).length}`);
            } else {
                logger.warn(`[game] 尝试移除不存在的玩家: sessionId=${sessionId}, uuid=${uuid}`);
            }
        });

        // --- 键盘事件 ---
        playerEvent.on('keyboardEvent', ({ sessionId, uuid, event }) => {
            const player = this.players[sessionId];
            if (!player) {
                logger.warn(`[game] keyboardEvent: 玩家不存在: sessionId=${sessionId}`);
                return;
            }
            try {
                const parsed = JSON.parse(event);
                player.trigger('keyboardEvent', parsed.data);
                logger.debug(`[game] keyboardEvent 已转发至玩家: sessionId=${sessionId}, keys=${JSON.stringify(parsed.data?.key)}`);
            } catch (e) {
                logger.warn(`[game] keyboardEvent JSON 解析失败: sessionId=${sessionId}`, e);
            }
        });

        // --- 渲染请求（dest 使用 sessionId） ---
        room.onMessage('C2SUpdateRender', ({ who, msg }) => {
            const i = this.players[who.sessionId];
            if (!i) {
                logger.warn(`[game] C2SUpdateRender: 玩家不存在: sessionId=${who.sessionId}`);
                return;
            }
            // 收集其他玩家的远程数据
            const otherPlayersData = [];
            for (const [id, player] of Object.entries(this.players)) {
                if (id !== who.sessionId) {
                    otherPlayersData.push(player.remoteData());
                }
            }
            const selfRender = i.render(this.world.culling.bind(this.world));
            render(who.sessionId, [...selfRender, ...otherPlayersData]);
            logger.debug(`[game] C2SUpdateRender: sessionId=${who.sessionId}, 实体数=${selfRender.length}, 远端玩家数=${otherPlayersData.length}`);
        });

        logger.log('[game] ========== 游戏初始化完成 ==========');
    }

    end() {
        logger.log('[game] 游戏结束, 清理主循环');
        clearInterval(this.matchLoop);
    }
}

export default Game;
