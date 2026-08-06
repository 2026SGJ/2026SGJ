import { matchLoop } from './mainloop.js';
import playerEvent from '../sessions/index.js';
import Player from './match/player/index.js';
import BotPlayer from './match/bot/BotPlayer.js';
import World from './match/world.js';
import room from '../network/index.js';
import MatchManager from './match/manager.js';
import { render } from './render.js';
import Shop from './match/item/shop.js';
import ShopGui, { FAIL_REASON_TEXT } from './match/gui/shopGui.js';
import { pushPopText, buildPopTextEntries, prunePopTexts } from './popText.js';

/**
 * 世界实体全量重同步周期（tick 数）
 *
 * 增量渲染协议下，世界实体仅在「首次全量推送」或「数据发生变化」时发送，
 * 客户端约定缺失实体沿用上一帧。若客户端因网络抖动 / 中继丢包 / 加入竞态
 * 错过了首次全量推送，静态实体（墙体/标题/装饰）与长期不变更的动态实体
 * 将永远不会再被发送 —— 而玩家每帧都在变化会持续重发，最终表现就是
 * 「客户端只能看到玩家，看不到任何世界实体」。
 *
 * 该常量控制周期全量重同步：每经过 FULL_RESYNC_TICKS 个渲染 tick，
 * 强制清空每个客户端的 seenEntities（及 seenGui），令下一次渲染请求
 * 全量重推所有世界实体，保证任意客户端都能在有限时间内恢复完整世界。
 *
 * 100 tick = 5 秒（20 tick/s），全量包约 10KB，均摊带宽 ~2KB/s/客户端，
 * 换取「初始推送丢失后最多 5 秒自动恢复」的可靠性保障。
 */
const FULL_RESYNC_TICKS = 100;

/**
 * Game类
 * 游戏主逻辑
 * 以 sessionId 为 key 追踪玩家实体
 */
class Game {
    constructor() {
        this.matchLoop = null;
        this.players = {};  // sessionId → Player（含 BotPlayer）
        /**
         * 旁观者：sessionId → { sessionId, joinedAt }
         *
         * 对局已开始（playing / suddenDeath / finished）后加入的玩家成为旁观者：
         *   - 不进入 players，不作为玩家对待（不参与匹配 / 战斗 / 结算 / 商店等）
         *   - 不被任何玩家渲染（不在 players 中，故任何渲染包都不包含旁观者）
         *   - 旁观者之间互不可见（其渲染包只包含 players 中的真实玩家与人机）
         *   - 仅向其发送状态（S2CRender）与聊天信息（S2CChat）
         * @type {Object<string, {sessionId: string, joinedAt: number}>}
         */
        this.spectators = {};
        this.world = null;
        /** @type {number} Bot 编号计数器 */
        this.botCounter = 0;
        /**
         * 对局匹配 / 阶段 / 胜负判定管理器
         * 负责匹配倒计时、人机补位、基地伤害、死绝判负、强制结算等
         * @type {MatchManager}
         */
        this.match = new MatchManager(this);
        /**
         * 各玩家渲染增量同步状态：sessionId → { lastSentTick, seenEntities, seenIds, seenPlayers, ...GUI }
         * - lastSentTick  上次发送渲染包时的全局渲染 tick（world.renderTick）
         * - lastFullSyncTick 上次「全量重同步」时的渲染 tick（周期全量重推，防初始推送丢失）
         * - seenEntities  已发送过的实体对象集合（按引用追踪：地图存在同 id 的不同实体，
         *                如装饰 base_A 与动态 Base base_A，必须各自独立追踪）
         * - seenIds       已发送过的实体 id 集合（用于实体移除时判断是否发送 delete 包）
         * - seenPlayers   已发送过的玩家 sessionId 集合
         * - seenGui       已发送过的 isFixed GUI 实体对象集合（每玩家独立）
         * - seenGuiIds    已发送过的 GUI 实体 id 集合（删除包去重）
         * - pendingGuiRemovals 待发送删除包的 GUI 实体 id 列表
         * - lastPopTextSeq 已投递的最大漂浮文字 seq（并入 S2CRender 后按玩家去重）
         * 客户端约定「缺失的实体沿用上一帧」，故未变化的数据无需重复发送。
         * @type {Object<string, {
         *   lastSentTick: number, lastFullSyncTick: number, seenEntities: Set<object>,
         *   seenIds: Set<string>, seenPlayers: Set<string>, seenGui: Set<object>,
         *   seenGuiIds: Set<string>, pendingGuiRemovals: Array<{id:string}>,
         *   lastPopTextSeq: number,
         * }>}
         */
        this._renderStates = {};
        this.init();
    }

    init() {
        // 初始化游戏
        console.log('游戏初始化');
        this.world = new World({ map_id: '1' });
        Shop.resetStock();   // 重置商店库存
        // 主循环：每 tick 更新玩家和世界，随后同步商店 GUI
        this.matchLoop = setInterval(() => {
            matchLoop(this.players, this.world);
            // 对局匹配 / 阶段 / 胜负判定管理（匹配广播、人机补位、基地伤害、死绝判负等）
            this.match.tick();
            // 同步所有玩家的物品栏（仅在变动时发送）
            // 清理过期漂浮文字（并入 S2CRender 后由渲染请求按需投递）
            // 注意：漂浮文字已并入 S2CRender 渲染管线（见 _buildRenderPacket 的
            // buildPopTextEntries），不再走独立的 S2CPopText 广播，主循环无需再调用
            // 旧版 flushPopText（该函数已在渲染重构时从 popText.js 移除）。
            prunePopTexts();
            // 商店 GUI（isFixed 屏幕实体）开关 / 点击购买 / 手柄购买 —— 仅真人玩家
            for (const sessionId of Object.keys(this.players)) {
                this._syncShopGui(sessionId);
            }
            // 渲染增量同步：本 tick 全部逻辑更新完成后，统一刷新实体/玩家/GUI 渲染指纹
            this._refreshRenderFingerprints();
        }, 1000 / 20); // 每秒20 Ticks

        playerEvent.on('beforeNewPlayerAdded', ({ sessionId, uuid, event }) => {
            try {
                // ---------- 非匹配阶段：以旁观者身份加入 ----------
                // 对局已开始后，新玩家不再被拒绝加入，而是成为旁观者：
                // 不作为玩家对待，仅接收状态（S2CRender）与聊天信息（S2CChat）。
                if (this.match.phase !== 'matching') {
                    this.spectators[sessionId] = {
                        sessionId,
                        joinedAt: Date.now(),
                    };
                    // 初始化渲染增量同步状态（首次渲染全量发送，之后增量）
                    // 注意：字段必须与普通玩家保持一致（周期全量重同步游标 / GUI 删除包 /
                    // 漂浮文字投递游标），否则 _buildRenderPacket 会因缺失字段而崩溃
                    // （如 state.pendingGuiRemovals 为 undefined → TypeError）或行为异常
                    // （如 lastPopTextSeq 为 undefined → 漂浮文字被重复投递）。
                    this._renderStates[sessionId] = {
                        lastSentTick: 0,
                        // 周期全量重同步游标（0 = 立即允许首次全量，见 _buildRenderPacket）
                        lastFullSyncTick: 0,
                        seenEntities: new Set(),
                        seenIds: new Set(),
                        seenPlayers: new Set(),
                        // ---- GUI（isFixed 屏幕实体）增量同步 ----
                        seenGui: new Set(),
                        seenGuiIds: new Set(),
                        pendingGuiRemovals: [],
                        // ---- 漂浮文字（并入 S2CRender）投递游标 ----
                        lastPopTextSeq: 0,
                    };
                    console.log(
                        `[Match] 游戏已开始（阶段=${this.match.phase}），` +
                        `${sessionId} 以旁观者身份加入`
                    );
                    room.send('S2CChat', JSON.stringify({
                        dest: sessionId,
                        seq: 0,
                        data: {
                            type: 'spectator_joined',
                            phase: this.match.phase,
                            text: '[旁观] 对局已开始，你以旁观者身份加入（仅可观看，不可操作）。',
                        },
                    }));
                    return true;
                }

                // ---------- 匹配阶段满 8 名真人（4v4 满员）：拒绝加入 ----------
                if (this.match.realPlayerCount() >= 8) {
                    console.log(
                        `[Match] 拒绝玩家加入 ${sessionId} ` +
                        `（匹配阶段真人=${this.match.realPlayerCount()}/8）`
                    );
                    return false;
                }

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
                // 初始化渲染增量同步状态（首次渲染全量发送，之后增量）
                this._renderStates[sessionId] = {
                    lastSentTick: 0,
                    // 周期全量重同步游标（0 = 立即允许首次全量，见 _buildRenderPacket）
                    lastFullSyncTick: 0,
                    seenEntities: new Set(),
                    seenIds: new Set(),
                    seenPlayers: new Set(),
                    // ---- GUI（isFixed 屏幕实体）增量同步 ----
                    seenGui: new Set(),            // 已发送过的 GUI 实体对象（按引用追踪）
                    seenGuiIds: new Set(),         // 已发送过的 GUI 实体 id（删除包去重）
                    pendingGuiRemovals: [],        // 待发送删除包的 GUI 实体 id 列表
                    // ---- 漂浮文字（并入 S2CRender）投递游标 ----
                    lastPopTextSeq: 0,             // 已投递的最大漂浮文字 seq
                };

                // 通知匹配管理器：真人加入（匹配阶段禁止行动、踢人机、调整倒计时）
                this.match.onHumanJoined(sessionId);
                return true;
            } catch (_) {
                console.error(_);
                return false;
            }
        });

        // 玩家移除（含对局内人机补位）
        playerEvent.on('playerRemoved', ({ sessionId, uuid, event }) => {
            // 旁观者断开：仅清理旁观者记录与渲染状态（不作为玩家对待，
            // 无需通知他人隐藏——旁观者本就不被任何人渲染）
            if (this.spectators[sessionId]) {
                delete this.spectators[sessionId];
                delete this._renderStates[sessionId];
                console.log(`Spectator removed: sessionId=${sessionId}, uuid=${uuid}`);
                return;
            }
            const removed = this.players[sessionId];
            if (removed) {
                const team = removed.team;
                // 若离开时商店仍处于打开状态：释放商店占用记录（避免 SessionId 残留在 Set 中）
                if (removed._openShop) {
                    removed._openShop.openedBy.delete(sessionId);
                }
                delete this.players[sessionId];
                delete this._renderStates[sessionId];
                console.log(`Player removed: sessionId=${sessionId}, uuid=${uuid}`);
                // 增量渲染下客户端沿用上一帧：移除玩家必须显式通知其他客户端不再跟踪，
                // 避免残留幽灵与内存泄漏（delete 包由渲染组装时消费，通知客户端释放缓存）
                this.world.markEntityRemoved({ id: sessionId });
                // 通知匹配管理器：真人离开（匹配中重新补人机 / 对局中补位保持 4v4）
                this.match.onHumanLeft(sessionId, team);
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

        // 游戏手柄事件（C2SGamepad / C2SGamepadEvent）
        playerEvent.on('gamepadEvent', ({ sessionId, uuid, event }) => {
            const player = this.players[sessionId];
            if (!player) return;
            try {
                const msg = typeof event === 'string' ? JSON.parse(event) : event;
                player.trigger('gamepadEvent', msg && msg.data !== undefined ? msg.data : msg);
            } catch (_) {}
        });

        // 移动端触屏事件（C2STouch / C2STouchEvent）
        playerEvent.on('touchEvent', ({ sessionId, uuid, event }) => {
            const player = this.players[sessionId];
            if (!player) return;
            try {
                const msg = typeof event === 'string' ? JSON.parse(event) : event;
                player.trigger('touchEvent', msg && msg.data !== undefined ? msg.data : msg);
            } catch (_) {}
        });

        // 鼠标事件（C2SMouseEvent）— 商店 GUI 点击购买 / 世界坐标点击瞄准
        playerEvent.on('mouseEvent', ({ sessionId, uuid, event }) => {
            const player = this.players[sessionId];
            if (!player) return;
            try {
                const msg = typeof event === 'string' ? JSON.parse(event) : event;
                player.trigger('mouseEvent', msg && msg.data !== undefined ? msg.data : msg);
            } catch (_) {}
        });

        // ============================================================
        //  道具购买（物品栏系统 — C2SBuyItem）
        // ============================================================
        playerEvent.on('buyItem', ({ sessionId, uuid, event }) => {
            const player = this.players[sessionId];
            if (!player) return;
            // 仅正常对局阶段允许购买（匹配阶段 / 7 分钟后加时赛禁止）
            if (!this.match.canOpenShop()) {
                room.send('S2CBuyItem', JSON.stringify({
                    dest: sessionId, seq: 0,
                    data: { success: false, reason: '当前阶段无法购买道具' }
                }));
                return;
            }
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
            // 匹配阶段禁止使用道具（正常对局与加时赛允许）
            if (!this.match.canUseItems()) {
                room.send('S2CUseItem', JSON.stringify({
                    dest: sessionId, seq: 0,
                    data: { success: false, reason: '当前阶段无法使用道具' }
                }));
                return;
            }
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
            } catch (err) {
                console.error('[UseItem] Error:', err);
                room.send('S2CUseItem', JSON.stringify({
                    dest: sessionId, seq: 0,
                    data: { success: false, reason: '服务器内部错误' }
                }));
            }
        });

        // ============================================================
        //  商店 GUI（isFixed 屏幕实体，见 _syncShopGui / _openShopGui）
        //  商店打开由 Player 的 E 键切换触发（shopJustOpened），
        //  商品购买通过鼠标 / 触屏点击或手柄右摇杆选中 + A 键完成，
        //  界面与反馈全部经 S2CRender 渲染（不再使用 S2CShop* 专用包）。
        // ============================================================

        // 渲染请求（dest 使用 sessionId）
        room.onMessage('C2SUpdateRender', ({ who, msg }) => {
            const sessionId = who.sessionId;
            // 普通玩家与旁观者都可请求渲染。
            // 旁观者包只含世界实体 + players（真实玩家与人机），
            // 不含任何旁观者（旁观者不在 players 中）→ 旁观者之间互不可见。
            const isPlayer = !!this.players[sessionId];
            const isSpectator = !!this.spectators[sessionId];
            if (!isPlayer && !isSpectator) return;
            // 组装增量渲染包：仅发送自上次请求以来变化 / 新增的实体与玩家，
            // 未变化的由客户端沿用上一帧（详见 _buildRenderPacket）
            render(sessionId, this._buildRenderPacket(sessionId));
        });
    }

    // ============================================================
    //  渲染增量同步（S2CRender 带宽优化）
    // ============================================================

    /**
     * 每 tick 刷新所有实体 / 玩家的渲染指纹（增量检测核心）
     *
     * 必须在主循环内「全部游戏逻辑更新完成后」调用，保证：
     *   - 世界实体的变化（矿物采集/重生、前哨站占领、基地扣血、道具移动等）
     *     先于指纹刷新发生，不会被遗漏；
     *   - 实体与玩家使用同一个基准 tick（world.renderTick），
     *     后续渲染组装时的比较逻辑保持一致。
     *
     * 指纹采用 JSON 序列化比对，与逻辑完全解耦：
     * 任何影响渲染数据的状态变化都会被自动发现（无需在逻辑中手动打脏标记）。
     * 玩家静止 / 无冷却时指纹不变，可跳过发送，进一步降低带宽。
     *
     * 覆盖范围：世界实体（world.entities）+ 玩家 + 每玩家独立的
     * isFixed GUI 实体（player._gui.entities，见 ShopGui）。
     * ──────────────────────────────────────────────────────────────
     */
    _refreshRenderFingerprints() {
        // 1) 世界实体指纹（静态实体在 World 初始化时已缓存，跳过）
        this.world.refreshRenderTicks();

        // 2) 玩家指纹：构建一次 remoteData 并缓存，与上次比对
        const renderTick = this.world.renderTick;
        for (const p of Object.values(this.players)) {
            const data = p.remoteData();
            const fp = JSON.stringify(data);
            if (fp !== p._renderFingerprint) {
                p._renderFingerprint = fp;
                p._lastChangeTick = renderTick;
                // 仅在变化时更新缓存对象（静止玩家复用旧引用，内容一致）
                p._lastRenderData = data;
            }
        }

        // 3) GUI 实体指纹（isFixed 屏幕实体，每玩家独立）
        //    商店库存 / 金钱 / 选中态等变化自动进入增量发送
        for (const p of Object.values(this.players)) {
            const gui = p._gui;
            if (!gui) continue;
            for (const e of gui.entities) {
                const fp = JSON.stringify(e.getRenderData());
                if (fp !== e._renderFingerprint) {
                    e._renderFingerprint = fp;
                    e._lastChangeTick = this.world.renderTick;
                }
            }
        }
    }

    /**
     * 组装单个玩家的增量渲染包（S2CRender 的 data 数组）
     *
     * 客户端设计约定：渲染数据中缺失的实体沿用上一帧的渲染状态。
     * 因此这里只发送：
     *   1. 首次出现的实体 / 玩家 / GUI（全量推送一次，建立客户端缓存）
     *   2. 自上次发送以来渲染数据发生变化（_lastChangeTick > lastSentTick，
     *      严格大于：上次发送时已包含该 tick 的变化）的实体 / 玩家 / GUI
     *   3. 已从世界移除的实体 / 已关闭的 GUI（发送 { type:'delete', id } 删除包，
     *      通知客户端停止跟踪并释放缓存）
     *   4. 漂浮文字（{ type:'popText' } 一次性渲染条目，按玩家去重投递）
     *
     * 静态实体（墙体 / 标题 / 装饰）永不变化：首次全量后不再发送，
     * 动态实体（矿物 / 前哨站 / 商店 / 基地 / 道具）仅在变化时发送，
     * 玩家仅在移动 / 战斗 / 状态变化时发送，
     * GUI（isFixed 屏幕实体）仅对所属玩家发送。
     *
     * @param {string} sessionId - 目标玩家 sessionId
     * @returns {Object[]} 增量渲染数据数组（可直接作为 S2CRender.data）
     */
    _buildRenderPacket(sessionId) {
        const world = this.world;
        const state = this._renderStates[sessionId];
        // 渲染状态不存在（玩家刚被移除等竞态）→ 返回空包
        if (!state) return [];

        // ---- 0. 周期全量重同步（防初始推送丢失） ----
        // 世界实体仅在「首次全量」或「数据变化」时发送；若客户端因网络抖动 /
        // 中继丢包 / 加入竞态错过了首次全量推送，静态实体（墙体/标题/装饰）与
        // 长期不变更的动态实体将永远不会再被发送（玩家每帧变化仍会重发，表现
        // 为“客户端只能看到玩家，看不到其他实体”）。
        //
        // 因此每 FULL_RESYNC_TICKS 个渲染 tick 强制清空 seenEntities / seenGui，
        // 令本次渲染请求全量重推所有世界实体与 GUI 实体（幂等覆盖，客户端缓存
        // 天然支持重复 update），保证任意客户端在有限时间内恢复完整世界。
        // 注意：seenIds / seenPlayers 不清空 —— seenIds 用于已移除实体删除包去重，
        // seenPlayers 避免全量重推玩家（玩家变化频繁本就持续重发）。
        if (world.renderTick - state.lastFullSyncTick >= FULL_RESYNC_TICKS) {
            state.seenEntities = new Set();
            state.seenGui = new Set();
            state.lastFullSyncTick = world.renderTick;
        }

        const packet = [];
        const lastSentTick = state.lastSentTick;

        // ---- 1. 世界实体：首次全量，之后仅发送变化的 ----
        // 注意：seenEntities 按「实体对象引用」追踪（地图存在同 id 的不同实体，
        // 如装饰 base_A 与动态 Base base_A，按 id 去重会漏发其中一个）
        for (const e of world.entities) {
            if (state.seenEntities.has(e)) {
                // 已建立缓存：仅当实体数据在「上次发送之后」发生变化才推送
                // （用严格大于：上次发送时已包含该 tick 的变化，避免重复发送）
                if (e._lastChangeTick > lastSentTick) {
                    packet.push(e.getRenderData());
                }
            } else {
                // 首次出现：全量推送，客户端建立缓存（含静态实体，仅此一次）
                state.seenEntities.add(e);
                state.seenIds.add(e.data.id); // 注意：id 在 data 上，实体自身无 id 属性
                packet.push(e.getRenderData());
            }
        }

        // ---- 2. 已移除实体 → 显式删除包（{ type:'delete', id }） ----
        // 仅通知「已见过该 id」的玩家（从未见过的无需通知）。
        // 客户端收到 delete 后停止跟踪该实体并释放其缓存；isShowed:false 仅隐藏不释放，
        // 会导致客户端持续追踪实体造成内存泄漏，故必须使用 delete 语义。
        // 每个玩家的 seen 集合相互独立，故此处可消费式删除：
        // 该删除包对当前玩家只发一次，其他玩家仍会各自收到。
        for (const gone of world._pendingRemovals) {
            if (state.seenIds.has(gone.id) || state.seenPlayers.has(gone.id)) {
                packet.push({ type: 'delete', id: gone.id });
                state.seenIds.delete(gone.id);
                state.seenPlayers.delete(gone.id);
            }
        }

        // ---- 3. 玩家（自己 + 其他）：首次全量，之后仅发送变化的 ----
        // 注意：必须始终调用 remoteData() 获取最新数据，不能依赖 _lastRenderData 缓存。
        // _lastRenderData 在 _refreshRenderFingerprints（主循环末尾）写入，
        // 而 C2SUpdateRender 可能在主循环中途到达，此时 _lastRenderData 仍是上一 tick 的旧位置，
        // 导致「服务端玩家已移动，但发给客户端的位置仍是旧坐标」的 bug。
        for (const [pid, p] of Object.entries(this.players)) {
            if (state.seenPlayers.has(pid)) {
                // 用严格大于：上次发送时已包含该 tick 的变化，避免重复发送
                if (p._lastChangeTick > lastSentTick) {
                    packet.push(p.remoteData());
                }
            } else {
                state.seenPlayers.add(pid);
                packet.push(p.remoteData());
            }
        }

        // ---- 4. GUI 实体删除包（先删后增：先通知客户端释放旧缓存，
        //      再发送新实体，避免同 id 覆盖竞态） ----
        for (const gone of state.pendingGuiRemovals) {
            if (state.seenGuiIds.has(gone.id)) {
                packet.push({ type: 'delete', id: gone.id });
                state.seenGuiIds.delete(gone.id);
            }
        }
        state.pendingGuiRemovals = [];

        // ---- 5. GUI 实体（isFixed 屏幕 UI，每玩家独立）：首次全量，之后仅发送变化的 ----
        const gui = this.players[sessionId]?._gui;
        if (gui) {
            for (const e of gui.entities) {
                if (state.seenGui.has(e)) {
                    if (e._lastChangeTick > lastSentTick) {
                        packet.push(e.getRenderData());
                    }
                } else {
                    state.seenGui.add(e);
                    state.seenGuiIds.add(e.data.id);
                    packet.push(e.getRenderData());
                }
            }
        }

        // ---- 6. 漂浮文字（并入 S2CRender 的一次性渲染条目，按玩家去重投递） ----
        const { entries, lastSeq } = buildPopTextEntries(state.lastPopTextSeq);
        if (entries.length > 0) {
            state.lastPopTextSeq = lastSeq;
            packet.push(...entries);
        }

        // 记录本次发送时的渲染 tick，供下次增量比较
        state.lastSentTick = world.renderTick;
        return packet;
    }

    // ============================================================
    //  商店 GUI（isFixed 屏幕实体）管理
    //  ------------------------------------------------------------
    //  商店界面与商品全部以 isFixed:true 实体渲染（见 ShopGui），
    //  随 S2CRender 增量推送给所属玩家；购买通过鼠标 / 触屏点击或
    //  手柄右摇杆选中 + A 键触发，购买结果以漂浮文字反馈。
    //  不再使用 S2CShopOpen / S2CShopCatalog / S2CShopBuyResult 等专用包。
    // ============================================================

    /**
     * 每 tick 同步商店 GUI 状态（由主循环对每个玩家调用）
     *
     * 职责：
     *   1. 打开：玩家 E 键切换触发 shopJustOpened → 创建 ShopGui
     *   2. 关闭：E 键再次切换 / 离开范围 / 死亡 → 销毁 ShopGui
     *   3. 刷新：库存换货 / 金钱变化 / 选中态 每 tick 同步
     *   4. 购买：消费玩家的点击（鼠标 / 触屏）与手柄 A 键购买意图
     *
     * @param {string} sessionId
     */
    _syncShopGui(sessionId) {
        // Bot 玩家无客户端连接，跳过（人机通过 BotController 直接购物，无 GUI）
        if (BotPlayer.isBotSession(sessionId)) return;

        const player = this.players[sessionId];
        if (!player) return;

        // ---- 1) 打开：E 键边沿触发 → 创建商店 GUI ----
        if (player.shopJustOpened && player.isShopOpen && !player._gui) {
            this._openShopGui(player);
        }

        // ---- 2) 关闭：E 键切换 / 离开范围 / 死亡 → 销毁商店 GUI ----
        if (player._gui && !player.isShopOpen) {
            this._closeShopGui(player);
            return; // 本次 tick 不再处理交互
        }

        const gui = player._gui;
        if (!gui) return;

        // ---- 3) 每 tick 刷新（库存刷新 / 金钱变化 / 选中态） ----
        gui.refresh();

        // ---- 4) 鼠标 / 触屏屏幕坐标点击 → 命中检测 + 购买 ----
        if (player._pendingShopClick) {
            const click = player._pendingShopClick;
            player._pendingShopClick = null;
            const result = gui.handleClick(click.x, click.y);
            if (result === 'close') {
                // 点击关闭按钮 → 关闭商店
                player.isShopOpen = false;
                player.shopJustOpened = false;
            } else if (result) {
                // 点击商品 → 购买
                this._handleShopBuy(player, result.itemId);
            }
        }

        // ---- 5) 手柄 A 键 → 购买当前选中商品 ----
        if (player._pendingShopBuySelected) {
            player._pendingShopBuySelected = false;
            const itemId = gui.selectedItemId;
            if (itemId) this._handleShopBuy(player, itemId);
        }
    }

    /**
     * 创建商店 GUI（打开商店）
     *
     * 校验阶段（仅正常对局）与商店距离，通过后构建 ShopGui 实体组，
     * 实体将在玩家下一次渲染请求时全量发送（seenGui 为空集合）。
     *
     * @param {Player} player
     */
    _openShopGui(player) {
        // 阶段校验：仅正常对局可打开/购买
        if (!this.match.canOpenShop()) {
            player.isShopOpen = false;
            player.shopJustOpened = false;
            this._buyFeedback(null, false, '当前阶段无法打开商店');
            return;
        }

        // 商店目标：优先使用玩家 E 键绑定的商店，否则就近查找
        const shop = player._openShop || this.findNearestShop(player);
        if (!shop || !shop.isPlayerNear(player.x, player.y)) {
            player.isShopOpen = false;
            player.shopJustOpened = false;
            player._openShop = null;
            return;
        }

        // 同一玩家重复打开时清空残留的删除包（新旧实体 id 相同，直接更新缓存）
        const state = this._renderStates[player.sessionId];
        if (state) state.pendingGuiRemovals = [];

        player._openShop = shop;
        shop.openedBy.add(player.sessionId);
        player._gui = new ShopGui(player, shop);
        player._gui.build();
        player.shopJustOpened = false;

        console.log(`[ShopGui] ${player.sessionId} 打开商店（${shop.data.id}）`);
    }

    /**
     * 销毁商店 GUI（关闭商店）
     *
     * 标记所有 GUI 实体为待删除，渲染组装时发送 { type:'delete', id }
     * 通知客户端释放缓存；随后清空玩家引用与商店占用记录。
     *
     * @param {Player} player
     */
    _closeShopGui(player) {
        const gui = player._gui;
        if (!gui) return;

        const state = this._renderStates[player.sessionId];
        if (state) {
            for (const e of gui.entities) {
                state.pendingGuiRemovals.push({ id: e.data.id });
            }
        }
        gui.destroy();

        player._gui = null;
        if (player._openShop) {
            player._openShop.openedBy.delete(player.sessionId);
            player._openShop = null;
        }
        player.isShopOpen = false;
        player.shopJustOpened = false;
        player._pendingShopClick = null;
        player._pendingShopBuySelected = false;

        console.log(`[ShopGui] ${player.sessionId} 关闭商店`);
    }

    /**
     * 执行商店购买（鼠标 / 触屏点击商品、手柄 A 键购买选中商品）
     *
     * 购买逻辑（库存扣减 / 金钱扣除 / 效果施加）由 Shop 实体完成；
     * 结果通过 S2CRender 漂浮文字反馈（成功 / 失败原因），
     * 界面库存与金钱由 GUI 指纹刷新自动同步。
     *
     * @param {Player} player - 购买者
     * @param {string} itemId - 商品 id
     */
    _handleShopBuy(player, itemId) {
        const shop = player._openShop || this.findNearestShop(player);

        // 阶段校验：7 分钟后加时赛禁止购买
        if (!this.match.canOpenShop()) {
            this._buyFeedback(null, false, FAIL_REASON_TEXT.shop_disabled);
            return;
        }
        // 范围校验：被推离商店后禁止购买，并自动关闭界面
        if (!shop || !shop.isPlayerNear(player.x, player.y)) {
            this._buyFeedback(null, false, FAIL_REASON_TEXT.no_shop_nearby);
            player.isShopOpen = false;
            player.shopJustOpened = false;
            return;
        }

        const result = shop.buy(player, itemId);
        if (result.ok) {
            // 购买成功：刷新 GUI（库存 / 金钱 / 可选态）并给出反馈
            player._gui?.refresh();
            this._buyFeedback(null, true);
            console.log(
                `[ShopGui] ${player.sessionId} 购买 ${itemId} ` +
                `（剩余金钱 ${player.money}）`
            );
        } else {
            this._buyFeedback(result.reason, false);
        }
    }

    /**
     * 购买结果漂浮文字反馈（并入 S2CRender，屏幕固定坐标）
     *
     * @param {string|null} reason - 失败原因 key（见 ShopGui.FAIL_REASON_TEXT）
     * @param {boolean} ok         - 是否购买成功
     * @param {string} [customText] - 自定义提示文本（优先于 reason 映射）
     */
    _buyFeedback(reason, ok = false, customText) {
        const text =
            customText ||
            (ok ? '购买成功' : (FAIL_REASON_TEXT[reason] || '购买失败'));
        pushPopText({
            text,
            x: 50, y: 34,          // 商店面板中部的反馈区（归一化坐标）
            isFixed: true,          // 屏幕固定漂浮文字
            color: ok ? 0x44ff44 : 0xff4444,
            duration: 900,
        });
    }

    /**
     * 查找离玩家最近的可交互商店
     * @param {Player} player
     * @returns {import('./match/entity/shop.js').default|null}
     */
    findNearestShop(player) {
        let nearest = null;
        let nearestDist = Infinity;
        for (const shop of this.world.shops) {
            if (!shop.isPlayerNear(player.x, player.y)) continue;
            const dist = Math.hypot(player.x - shop.data.x, player.y - shop.data.y);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = shop;
            }
        }
        return nearest;
    }

    end() {
        clearInterval(this.matchLoop);
    }
}

export default Game;
