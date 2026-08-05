import { matchLoop } from './mainloop.js';
import playerEvent from '../sessions/index.js';
import Player from './match/player/index.js';
import BotPlayer from './match/bot/BotPlayer.js';
import World from './match/world.js';
import room from '../network/index.js';
import MatchManager from './match/manager.js';
import { render } from './render.js';
import Shop from './match/item/shop.js';
import { flushPopText } from './popText.js';

/**
 * Game类
 * 游戏主逻辑
 * 以 sessionId 为 key 追踪玩家实体
 */
class Game {
    constructor() {
        this.matchLoop = null;
        this.players = {};  // sessionId → Player（含 BotPlayer）
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
         * 各玩家渲染增量同步状态：sessionId → { lastSentTick, seenEntities, seenIds, seenPlayers }
         * - lastSentTick  上次发送渲染包时的全局渲染 tick（world.renderTick）
         * - seenEntities  已发送过的实体对象集合（按引用追踪：地图存在同 id 的不同实体，
         *                如装饰 base_A 与动态 Base base_A，必须各自独立追踪）
         * - seenIds       已发送过的实体 id 集合（用于实体移除时判断是否发送隐藏包）
         * - seenPlayers   已发送过的玩家 sessionId 集合
         * 客户端约定「缺失的实体沿用上一帧」，故未变化的数据无需重复发送。
         * @type {Object<string, {lastSentTick: number, seenEntities: Set<object>, seenIds: Set<string>, seenPlayers: Set<string>}>}
         */
        this._renderStates = {};
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
            // 对局匹配 / 阶段 / 胜负判定管理（匹配广播、人机补位、基地伤害、死绝判负等）
            this.match.tick();
            // 广播本 tick 内产生的漂浮文字（伤害显示 S2CPopText）
            flushPopText(this.players);
            // 同步所有玩家的物品栏（仅在变动时发送）
            for (const sessionId of Object.keys(this.players)) {
                this._syncInventory(sessionId);
                // 检测商店打开事件，发送 S2CShopOpen
                this._syncShopOpen(sessionId);
            }
            // 渲染增量同步：本 tick 全部逻辑更新完成后，统一刷新实体/玩家渲染指纹
            this._refreshRenderFingerprints();
        }, 1000 / 20); // 每秒20 Ticks

        playerEvent.on('beforeNewPlayerAdded', ({ sessionId, uuid, event }) => {
            try {
                // ---------- 满员 / 非匹配阶段：拒绝加入 ----------
                // 匹配阶段满 8 名真人（4v4 满员），或对局已开始后，不再接受新玩家
                if (this.match.phase !== 'matching' || this.match.realPlayerCount() >= 8) {
                    console.log(
                        `[Match] 拒绝玩家加入 ${sessionId} ` +
                        `（阶段=${this.match.phase}，真人=${this.match.realPlayerCount()}/8）`
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
                    seenEntities: new Set(),
                    seenIds: new Set(),
                    seenPlayers: new Set(),
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
            const removed = this.players[sessionId];
            if (removed) {
                const team = removed.team;
                delete this.players[sessionId];
                delete this._renderStates[sessionId];
                console.log(`Player removed: sessionId=${sessionId}, uuid=${uuid}`);
                // 增量渲染下客户端沿用上一帧：移除玩家必须显式通知其他客户端隐藏，
                // 避免残留幽灵（isShowed:false 隐藏包由渲染组装时消费，type 与常规条目一致）
                this.world.markEntityRemoved({ id: sessionId, type: 'update' });
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

        // ---------- 商店列表查询（C2SShopList / S2CShopList） ----------
        room.onMessage('C2SShopList', ({ who, msg }) => {
            const sessionId = who.sessionId;
            room.send('S2CShopList', JSON.stringify({
                dest: sessionId, seq: 0,
                data: { items: Shop.getShopList() }
            }));
        });

        // ============================================================
        //  商店交互事件处理（实体商店系统 — C2SShopOpen/Close/Buy）
        // ============================================================

        // 商店打开请求 — 客户端 GUI 发起
        playerEvent.on('shopOpen', ({ sessionId, event }) => {
            const player = this.players[sessionId];
            if (!player) return;

            // 使用 player tick 中预计算的最近商店
            const shop = player._nearestShop || this.findNearestShop(player);
            if (!shop) {
                this._sendShopError(sessionId, 'no_shop_nearby');
                return;
            }

            // 发送商品目录给客户端
            const catalog = shop.getCatalog(player.team);
            shop.openedBy.add(sessionId);
            player._openShop = shop;

            this._sendShopCatalog(sessionId, catalog);
            console.log(`[Shop] Player ${sessionId} opened shop (team ${player.team})`);
        });

        // 商店关闭 — 客户端主动关闭
        playerEvent.on('shopClose', ({ sessionId, event }) => {
            const player = this.players[sessionId];
            if (!player) return;

            if (player._openShop) {
                player._openShop.openedBy.delete(sessionId);
                player._openShop = null;
            }
            player._shopOpen = false;
            player._nearestShop = null;

            this._sendShopClose(sessionId);
            console.log(`[Shop] Player ${sessionId} closed shop`);
        });

        // 处理玩家手动触发的 shopAutoClose（离开范围自动关闭）
        // 此事件由 Player.processShopOpen 内部触发
        for (const [sessionId, player] of Object.entries(this.players)) {
            player.on('shopAutoClose', ({ sessionId: sid }) => {
                this._sendShopClose(sid);
                console.log(`[Shop] Player ${sid} left shop range, auto-closed`);
            });
        }

        // 商店购买
        playerEvent.on('shopBuy', ({ sessionId, event }) => {
            const player = this.players[sessionId];
            if (!player) return;

            // 解析购买请求
            let itemId;
            try {
                const parsed = JSON.parse(event);
                itemId = parsed.data?.itemId || parsed.itemId;
            } catch (_) {
                itemId = event;
            }
            if (!itemId) {
                this._sendShopError(sessionId, 'invalid_request');
                return;
            }

            // 查找可交互的商店
            const shop = player._openShop || this.findNearestShop(player);
            if (!shop || !shop.isPlayerNear(player.x, player.y)) {
                this._sendShopError(sessionId, 'no_shop_nearby');
                return;
            }

            const result = shop.buy(player, itemId);
            if (!result.ok) {
                this._sendShopBuyResult(sessionId, { ok: false, reason: result.reason });
                return;
            }

            // 购买成功 — 返回最新目录和购买结果
            this._sendShopBuyResult(sessionId, {
                ok: true,
                itemId: itemId,
                money: player.money,
                catalog: shop.getCatalog(player.team),
            });

            console.log(
                `[Shop] Player ${sessionId} bought ${itemId} ` +
                `(team ${player.team}, money left: ${player.money})`
            );
        });

        // ============================================================
        //  商店交互事件处理（实体商店系统 — C2SShopOpen/Close/Buy）
        // ============================================================

        // 商店打开请求 — 客户端 GUI 发起
        playerEvent.on('shopOpen', ({ sessionId, event }) => {
            const player = this.players[sessionId];
            if (!player) return;

            // 仅正常对局阶段允许打开商店（匹配阶段 / 7 分钟后加时赛禁止）
            if (!this.match.canOpenShop()) {
                this._sendShopError(sessionId, 'shop_disabled');
                return;
            }

            // 使用 player tick 中预计算的最近商店
            const shop = player._nearestShop || this.findNearestShop(player);
            if (!shop) {
                this._sendShopError(sessionId, 'no_shop_nearby');
                return;
            }

            // 发送商品目录给客户端
            const catalog = shop.getCatalog(player.team);
            shop.openedBy.add(sessionId);
            player._openShop = shop;

            this._sendShopCatalog(sessionId, catalog);
            console.log(`[Shop] Player ${sessionId} opened shop (team ${player.team})`);
        });

        // 商店关闭 — 客户端主动关闭
        playerEvent.on('shopClose', ({ sessionId, event }) => {
            const player = this.players[sessionId];
            if (!player) return;

            if (player._openShop) {
                player._openShop.openedBy.delete(sessionId);
                player._openShop = null;
            }
            player._shopOpen = false;
            player._nearestShop = null;

            this._sendShopClose(sessionId);
            console.log(`[Shop] Player ${sessionId} closed shop`);
        });

        // 处理玩家手动触发的 shopAutoClose（离开范围自动关闭）
        // 此事件由 Player.processShopOpen 内部触发
        for (const [sessionId, player] of Object.entries(this.players)) {
            player.on('shopAutoClose', ({ sessionId: sid }) => {
                this._sendShopClose(sid);
                console.log(`[Shop] Player ${sid} left shop range, auto-closed`);
            });
        }

        // 商店购买
        playerEvent.on('shopBuy', ({ sessionId, event }) => {
            const player = this.players[sessionId];
            if (!player) return;

            // 仅正常对局阶段允许购买（匹配阶段 / 7 分钟后加时赛禁止）
            if (!this.match.canOpenShop()) {
                this._sendShopError(sessionId, 'shop_disabled');
                return;
            }

            // 解析购买请求
            let itemId;
            try {
                const parsed = JSON.parse(event);
                itemId = parsed.data?.itemId || parsed.itemId;
            } catch (_) {
                itemId = event;
            }
            if (!itemId) {
                this._sendShopError(sessionId, 'invalid_request');
                return;
            }

            // 查找可交互的商店
            const shop = player._openShop || this.findNearestShop(player);
            if (!shop || !shop.isPlayerNear(player.x, player.y)) {
                this._sendShopError(sessionId, 'no_shop_nearby');
                return;
            }

            const result = shop.buy(player, itemId);
            if (!result.ok) {
                this._sendShopBuyResult(sessionId, { ok: false, reason: result.reason });
                return;
            }

            // 购买成功 — 返回最新目录和购买结果
            this._sendShopBuyResult(sessionId, {
                ok: true,
                itemId: itemId,
                money: player.money,
                catalog: shop.getCatalog(player.team),
            });

            console.log(
                `[Shop] Player ${sessionId} bought ${itemId} ` +
                `(team ${player.team}, money left: ${player.money})`
            );
        });

        // 渲染请求（dest 使用 sessionId）
        room.onMessage('C2SUpdateRender', ({ who, msg }) => {
            const i = this.players[who.sessionId];
            if (!i) return;
            // 组装增量渲染包：仅发送自上次请求以来变化 / 新增的实体与玩家，
            // 未变化的由客户端沿用上一帧（详见 _buildRenderPacket）
            render(who.sessionId, this._buildRenderPacket(who.sessionId));
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
     * ── 进一步优化方向（需客户端配合，破坏性较小但尚未确认）────────
     * 当前每个「变化中的玩家」仍发送完整 remoteData（约 1.5KB），其中
     * skillStates 的 name/cd/cost 与 inventory 明细是静态数据（各占约 350B/400B），
     * 随每帧重复发送。若客户端确认支持「字段级沿用上一帧」或拆分
     * S2CInv 专属同步，可进一步将单玩家降到约 400B（全员移动场景再降约 80%）。
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
    }

    /**
     * 组装单个玩家的增量渲染包（S2CRender 的 data 数组）
     *
     * 客户端设计约定：渲染数据中缺失的实体沿用上一帧的渲染状态。
     * 因此这里只发送：
     *   1. 首次出现的实体 / 玩家（全量推送一次，建立客户端缓存）
     *   2. 自上次发送以来渲染数据发生变化（_lastChangeTick > lastSentTick，
     *      严格大于：上次发送时已包含该 tick 的变化）的实体 / 玩家
     *   3. 已从世界移除的实体（发送 isShowed:false 隐藏包，防止客户端残留幽灵）
     *
     * 静态实体（墙体 / 标题 / 装饰）永不变化：首次全量后不再发送，
     * 动态实体（矿物 / 前哨站 / 商店 / 基地 / 道具）仅在变化时发送，
     * 玩家仅在移动 / 战斗 / 状态变化时发送。
     *
     * @param {string} sessionId - 目标玩家 sessionId
     * @returns {Object[]} 增量渲染数据数组（可直接作为 S2CRender.data）
     */
    _buildRenderPacket(sessionId) {
        const world = this.world;
        const state = this._renderStates[sessionId];
        // 渲染状态不存在（玩家刚被移除等竞态）→ 返回空包
        if (!state) return [];

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

        // ---- 2. 已移除实体 → 显式隐藏包（isShowed:false） ----
        // 仅通知「已见过该 id」的玩家（从未见过的无需隐藏）；
        // 每个玩家的 seen 集合相互独立，故此处可消费式删除：
        // 该隐藏包对当前玩家只发一次，其他玩家仍会各自收到。
        for (const gone of world._pendingRemovals) {
            if (state.seenIds.has(gone.id) || state.seenPlayers.has(gone.id)) {
                packet.push({ id: gone.id, type: gone.type, isShowed: false });
                state.seenIds.delete(gone.id);
                state.seenPlayers.delete(gone.id);
            }
        }

        // ---- 3. 玩家（自己 + 其他）：首次全量，之后仅发送变化的 ----
        for (const [pid, p] of Object.entries(this.players)) {
            if (state.seenPlayers.has(pid)) {
                // 用严格大于：上次发送时已包含该 tick 的变化，避免重复发送
                if (p._lastChangeTick > lastSentTick) {
                    // 复用指纹刷新时缓存的渲染数据，避免重复构建 remoteData
                    packet.push(p._lastRenderData || p.remoteData());
                }
            } else {
                state.seenPlayers.add(pid);
                packet.push(p.remoteData());
            }
        }

        // 记录本次发送时的渲染 tick，供下次增量比较
        state.lastSentTick = world.renderTick;
        return packet;
    }

    // ============================================================
    //  商店 & 物品栏 工具方法（合并自两套商店系统）
    // ============================================================

    /**
     * 向客户端发送物品栏同步 (S2CInv)
     * 仅在物品栏发生变化时调用（增量同步）
     * @param {string} sessionId
     */
    _syncInventory(sessionId) {
        // Bot 玩家跳过网络同步（无对应客户端连接）
        if (BotPlayer.isBotSession(sessionId)) return;

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
        // Bot 玩家跳过网络同步
        if (BotPlayer.isBotSession(sessionId)) return;

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

    /**
     * 发送商店目录给客户端
     * @param {string} sessionId
     * @param {Object} catalog
     */
    _sendShopCatalog(sessionId, catalog) {
        room.send('S2CShopCatalog', JSON.stringify({
            dest: sessionId,
            seq: 0,
            data: catalog,
        }));
    }

    /**
     * 告知客户端关闭商店界面
     */
    _sendShopClose(sessionId) {
        room.send('S2CShopClose', JSON.stringify({
            dest: sessionId,
            seq: 0,
            data: {},
        }));
    }

    /**
     * 发送购买结果给客户端
     */
    _sendShopBuyResult(sessionId, result) {
        room.send('S2CShopBuyResult', JSON.stringify({
            dest: sessionId,
            seq: 0,
            data: result,
        }));
    }

    /**
     * 发送商店错误消息
     */
    _sendShopError(sessionId, reason) {
        room.send('S2CShopError', JSON.stringify({
            dest: sessionId,
            seq: 0,
            data: { reason },
        }));
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

    /**
     * 发送商店目录给客户端
     * @param {string} sessionId
     * @param {Object} catalog
     */
    _sendShopCatalog(sessionId, catalog) {
        room.send('S2CShopCatalog', JSON.stringify({
            dest: sessionId,
            seq: 0,
            data: catalog,
        }));
    }

    /**
     * 告知客户端关闭商店界面
     */
    _sendShopClose(sessionId) {
        room.send('S2CShopClose', JSON.stringify({
            dest: sessionId,
            seq: 0,
            data: {},
        }));
    }

    /**
     * 发送购买结果给客户端
     */
    _sendShopBuyResult(sessionId, result) {
        room.send('S2CShopBuyResult', JSON.stringify({
            dest: sessionId,
            seq: 0,
            data: result,
        }));
    }

    /**
     * 发送商店错误消息
     */
    _sendShopError(sessionId, reason) {
        room.send('S2CShopError', JSON.stringify({
            dest: sessionId,
            seq: 0,
            data: { reason },
        }));
    }

    end() {
        clearInterval(this.matchLoop);
    }
}

export default Game;
