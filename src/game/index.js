import { matchLoop } from "./mainloop.js";
import playerEvent from "../sessions/index.js";
import Player from "./match/player/index.js";
import BotPlayer from "./match/bot/BotPlayer.js";
import World from "./match/world.js";
import room from "../network/index.js";
import MatchManager from "./match/manager.js";
import RobotManager from "./match/robot/RobotManager.js";
import AreaManager from "./match/area/AreaManager.js";
import { isRobotType } from "../assets/data/robots/robots.js";
import ROBOT_TYPES from "../assets/data/robots/robots.js";
import { render } from "./render.js";
import Shop from "./match/item/shop.js";
import ShopSession from "./match/shop/ShopSession.js";
import { sendOpenShop, sendBuyItem } from "../network/shop.js";
import { buildPopTextEntries, prunePopTexts } from "./popText.js";
import { pushChat, flushChat } from "./chat.js";
import { isHeroUnlocked } from "../backend.js";
import { HERO_IDS } from "../assets/data/heros/index.js";
import { getLazyLoadAssets } from "../assets/lazyload/index.js";

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
 * 强制清空每个客户端的 seenEntities，令下一次渲染请求
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
	constructor(options = {}) {
		this.matchLoop = null;
		this.players = {}; // sessionId → Player（含 BotPlayer）
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
		/**
		 * 旁观者幽灵玩家：sessionId → Player 实例（仅在该旁观者自己的视角中渲染）
		 *
		 * 对局已开始后加入的旁观者会获得一份独立的 Player 对象：
		 *   - 不进入 players（不被任何人渲染，不参与战斗 / 匹配 / 结算 / 商店）
		 *   - asset 恒为 "none"（tick 内由 isSpectator 强制），可 WASD 自由移动
		 *   - 出生在地图正中心（world.mapSize 的一半）
		 *   - 仅在 _buildRenderPacket 中追加进该旁观者本人的渲染包
		 * @type {Object<string, import('./match/player/index.js').default>}
		 */
		this.spectatorPlayers = {};
		this.world = null;
		/** @type {number} Bot 编号计数器 */
		this.botCounter = 0;
		/**
		 * 对局匹配 / 阶段 / 胜负判定管理器
		 * 负责匹配倒计时、人机补位、基地伤害、死绝判负、强制结算等
		 * @type {MatchManager}
		 */
		this.match = new MatchManager(this, options);
		/**
		 * AI 机器人管理器（AI 机器人 ≠ 人机补位：不进入 players，不作为玩家对待）
		 * 每名玩家进局前 5 选 1 部署一个机器人，对局开始时 spawnAll
		 * @type {RobotManager}
		 */
		this.robotManager = new RobotManager(this);
		/**
		 * 区域效果管理器（地图划分为 640×360 区块，进出区块附加/清除效果）
		 * 玩家 / 人机 / AI 机器人统一结算，当前效果经 remoteData.state.areas 推送客户端
		 * @type {AreaManager}
		 */
		this.areaManager = new AreaManager(this);
		/**
		 * 各玩家渲染增量同步状态：sessionId → { lastSentTick, seenEntities, seenIds, seenPlayers, lastPopTextSeq }
		 * - lastSentTick  上次发送渲染包时的全局渲染 tick（world.renderTick）
		 * - lastFullSyncTick 上次「全量重同步」时的渲染 tick（周期全量重推，防初始推送丢失）
		 * - seenEntities  已发送过的实体对象集合（按引用追踪：地图存在同 id 的不同实体，
		 *                如装饰 base_A 与动态 Base base_A，必须各自独立追踪）
		 * - seenIds       已发送过的实体 id 集合（用于实体移除时判断是否发送 delete 包）
		 * - seenPlayers   已发送过的玩家 sessionId 集合
		 * - lastPopTextSeq 已投递的最大漂浮文字 seq（并入 S2CRender 后按玩家去重）
		 * 客户端约定「缺失的实体沿用上一帧」，故未变化的数据无需重复发送。
		 * @type {Object<string, {
		 *   lastSentTick: number, lastFullSyncTick: number, seenEntities: Set<object>,
		 *   seenIds: Set<string>, seenPlayers: Set<string>,
		 *   lastPopTextSeq: number,
		 * }>}
		 */
		this._renderStates = {};
		this.init();
	}

	init() {
		// 初始化游戏
		console.log("游戏初始化");
		this.world = new World({ map_id: "1" });
		// 生成区域区块实体并注册到世界渲染列表（需在世界创建完成后调用）
		this.areaManager.init();
		Shop.resetStock(); // 重置商店库存
		// 主循环：每 tick 更新玩家和世界，随后同步商店会话（独立协议包）
		this.matchLoop = setInterval(() => {
			matchLoop(this.players, this.world, this.robotManager, this.areaManager);
			// 旁观者幽灵玩家 tick（仅 WASD 移动，无战斗；不进入 players）
			for (const sp of Object.values(this.spectatorPlayers)) {
				sp.tick(this.players, this.world, null);
			}
			// 对局匹配 / 阶段 / 胜负判定管理（匹配广播、人机补位、基地伤害、死绝判负等）
			this.match.tick();
			// 同步所有玩家的物品栏（仅在变动时发送）
			// 广播本 tick 内产生的公屏聊天消息（玩家加入/退出/死亡播报）
			flushChat();
			// 清理过期漂浮文字（并入 S2CRender 后由渲染请求按需投递）
			// 注意：漂浮文字已并入 S2CRender 渲染管线（见 _buildRenderPacket 的
			// buildPopTextEntries），不再走独立的 S2CPopText 广播，主循环无需再调用
			// 旧版 flushPopText（该函数已在渲染重构时从 popText.js 移除）。
			prunePopTexts();
			// 商店会话同步（独立协议包：自动关闭检测 / 换货与金钱变化推送）—— 仅真人玩家
			for (const sessionId of Object.keys(this.players)) {
				this._syncShopState(sessionId);
			}
			// 渲染增量同步：本 tick 全部逻辑更新完成后，统一刷新实体/玩家渲染指纹
			this._refreshRenderFingerprints();
		}, 1000 / 20); // 每秒20 Ticks

		playerEvent.on(
			"beforeNewPlayerAdded",
			async ({ sessionId, uuid, name, event }) => {
				try {
					// ---------- 非匹配阶段：以旁观者身份加入 ----------
					// 对局已开始后，新玩家不再被拒绝加入，而是成为旁观者：
					// 不作为玩家对待，仅接收状态（S2CRender）与聊天信息（S2CChat）。
					if (this.match.phase !== "matching") {
						this.spectators[sessionId] = {
							sessionId,
							joinedAt: Date.now(),
						};
						// ---------- 旁观者幽灵玩家（仅自己视角可见，asset 为 none） ----------
						// 创建一份独立 Player 实例，仅在本旁观者自己的渲染包中发送：
						//  - 不进入 players：不被任何人渲染，不参与战斗 / 匹配 / 结算 / 商店
						//  - asset 恒为 "none"（tick 内由 isSpectator 强制），可 WASD 自由移动
						//  - 出生在地图正中心
						const ghost = new Player(sessionId, {
							name: name || "旁观者",
							hero: "newton", // 仅用于填充数值，渲染 asset 与 hero 无关
							team: "A",
						});
						ghost.isSpectator = true;
						ghost.canAct = false; // 旁观者禁止攻击 / 采矿 / 技能 / 商店
						ghost.x = Math.round(this.world.mapSize.width / 2);
						ghost.y = Math.round(this.world.mapSize.height / 2);
						ghost.hitbox.x = ghost.x - 25;
						ghost.hitbox.y = ghost.y - 25;
						ghost.costume = "none";
						this.spectatorPlayers[sessionId] = ghost;
						// 懒加载资源清单（旁观者同样渲染世界，需要相同的资源 URL）
						this._sendLazyLoadAssets(sessionId);
						// 初始化渲染增量同步状态（首次渲染全量发送，之后增量）
						// 注意：字段必须与普通玩家保持一致（周期全量重同步游标 / 漂浮文字
						// 投递游标），否则 _buildRenderPacket 会因缺失字段而崩溃
						// （如 lastPopTextSeq 为 undefined → 漂浮文字被重复投递）。
						this._renderStates[sessionId] = {
							lastSentTick: 0,
							// 周期全量重同步游标（0 = 立即允许首次全量，见 _buildRenderPacket）
							lastFullSyncTick: 0,
							seenEntities: new Set(),
							seenIds: new Set(),
							seenPlayers: new Set(),
							// ---- 漂浮文字（并入 S2CRender）投递游标 ----
							lastPopTextSeq: 0,
						};
						console.log(
							`[Match] 游戏已开始（阶段=${this.match.phase}），` +
								`${sessionId} 以旁观者身份加入`,
						);
						room.send(
							"S2CChat",
							JSON.stringify({
								dest: sessionId,
								seq: 0,
								data: {
									type: "spectator_joined",
									phase: this.match.phase,
									text: "[旁观] 对局已开始，你以旁观者身份加入（可 WASD 自由移动观察，不可战斗）。",
								},
							}),
						);
						return true;
					}

					// ---------- 匹配阶段满 8 名真人（4v4 满员）：拒绝加入 ----------
					if (this.match.realPlayerCount() >= 8) {
						console.log(
							`[Match] 拒绝玩家加入 ${sessionId} ` +
								`（匹配阶段真人=${this.match.realPlayerCount()}/8）`,
						);
						return false;
					}

					const data = JSON.parse(event).data;

					// ---------- 英雄选择与解锁校验 ----------
					// 客户端在握手数据中携带 data.hero（未携带默认 'newton'，非法值回退默认）。
					// 真人玩家加入对局前，向 backend 查询该英雄是否已解锁：
					//   - 未解锁 → 拒绝加入并定向通知（客户端可选择已解锁英雄后重连）
					//   - backend 不可达 → 放行并记录警告（不阻塞对局）
					//   - 'newton' 为默认解锁英雄，免查询直接放行
					let hero = typeof data.hero === "string" ? data.hero.toLowerCase() : "";
					if (!HERO_IDS.includes(hero)) hero = "newton";
					data.hero = hero;

					if (hero !== "newton") {
						const unlocked = await isHeroUnlocked(uuid, hero);
						if (unlocked === false) {
							console.warn(
								`[Hero] ${uuid} 尝试使用未解锁英雄 ${hero}，已拒绝加入`,
							);
							room.send(
								"S2CChat",
								JSON.stringify({
									dest: sessionId,
									seq: 0,
									data: {
										type: "hero_locked",
										hero,
										text: `[系统] 英雄 ${hero} 尚未解锁，无法加入对局（默认英雄 牛顿 已解锁）。`,
									},
								}),
							);
							return false;
						} else if (unlocked === null) {
							console.warn(
								`[Hero] backend 不可达，${uuid} 使用英雄 ${hero} 放行`,
							);
						}
					}
					// 记录账号 uuid（对局结算时按玩家推入 backend 需要）
					data.uuid = uuid;
					// ---------- 英雄选择与解锁校验 ----------

					// ---------- AI 机器人兵种选择（进局前 5 选 1） ----------
					// 客户端可在握手数据中携带 data.robot（如 'drone'）；未选 / 非法则
					// 为 null，对局开始时由 RobotManager 随机部署。仅匹配阶段可经
					// C2SSelectRobot 重新选择。
					data.robotType = isRobotType(data.robot) ? data.robot : null;
					// ---------- AI 机器人兵种选择 ----------

					// ---------- 队伍分配 ----------
					// 统计当前两队人数，新玩家加入人数较少的队伍；
					// 若两队人数相同，随机选择一队。
					let teamACount = 0;
					let teamBCount = 0;
					for (const p of Object.values(this.players)) {
						if (p.team === "A") teamACount++;
						else if (p.team === "B") teamBCount++;
					}
					let assignedTeam;
					if (teamACount < teamBCount) {
						assignedTeam = "A";
					} else if (teamBCount < teamACount) {
						assignedTeam = "B";
					} else {
						assignedTeam = Math.random() < 0.5 ? "A" : "B";
					}
					data.team = assignedTeam;
					console.log(
						`[Team] ${sessionId} assigned to team ${assignedTeam} (A:${teamACount}, B:${teamBCount})`,
					);
					// ---------- 队伍分配 ----------

					// 玩家显示名（握手数据未携带时退化为空，展示时回退 sessionId）
					data.name = name || data.name || "";

					this.players[sessionId] = new Player(sessionId, data);
					console.log(`Player added: sessionId=${sessionId}, uuid=${uuid}`);
					// 公屏播报：真人玩家加入（人机加入由 MatchManager.addBot 播报）
					pushChat({
						type: "player_join",
						player: sessionId,
						name: data.name || sessionId,
						team: assignedTeam,
						isBot: false,
						text: `[系统] ${data.name || sessionId} 加入了战斗（${assignedTeam}队）`,
					});
					// 初始化渲染增量同步状态（首次渲染全量发送，之后增量）
					this._renderStates[sessionId] = {
						lastSentTick: 0,
						// 周期全量重同步游标（0 = 立即允许首次全量，见 _buildRenderPacket）
						lastFullSyncTick: 0,
						seenEntities: new Set(),
						seenIds: new Set(),
						seenPlayers: new Set(),
						// ---- 漂浮文字（并入 S2CRender）投递游标 ----
						lastPopTextSeq: 0, // 已投递的最大漂浮文字 seq
					};

					// 通知匹配管理器：真人加入（匹配阶段禁止行动、踢人机、调整倒计时）
					this.match.onHumanJoined(sessionId);
					// 懒加载资源清单（S2CUpdateAssets，每个条目一个包）
					this._sendLazyLoadAssets(sessionId);
					return true;
				} catch (_) {
					console.error(_);
					return false;
				}
			},
		);

		// 玩家移除（含对局内人机补位）
		playerEvent.on("playerRemoved", ({ sessionId, uuid, event }) => {
			// 旁观者断开：仅清理旁观者记录与渲染状态（不作为玩家对待，
			// 无需通知他人隐藏——旁观者本就不被任何人渲染）
			if (this.spectators[sessionId]) {
				delete this.spectators[sessionId];
				// 清理旁观者幽灵玩家（其渲染包只发给自己，断开即无引用）
				delete this.spectatorPlayers[sessionId];
				delete this._renderStates[sessionId];
				console.log(`Spectator removed: sessionId=${sessionId}, uuid=${uuid}`);
				return;
			}
			const removed = this.players[sessionId];
			if (removed) {
				const team = removed.team;
				// 公屏播报：玩家退出（对局内人机补位由 MatchManager.addBot 播报）
				pushChat({
					type: "player_leave",
					player: sessionId,
					name: removed.name || sessionId,
					team,
					isBot: false,
					text: `[系统] ${removed.name || sessionId} 退出了战斗`,
				});
				// 若离开时商店仍处于打开状态：释放商店会话（清理商店占用记录）
				removed._shopSession?.dispose();
				// 清理其 AI 机器人（机器人跟随玩家归属，玩家离开 → 机器人移除）
				this.robotManager.removeRobotFor(sessionId);
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
		playerEvent.on("keyboardEvent", ({ sessionId, uuid, event }) => {
			// 旁观者幽灵玩家同样接收键盘输入（WASD 移动观察）
			const player = this.players[sessionId] || this.spectatorPlayers[sessionId];
			if (!player) return;
			try {
				player.trigger("keyboardEvent", JSON.parse(event).data);
			} catch (_) {}
		});

		// ============================================================
		//  C2SSwitchSkills — 切换当前选中技能（客户端直选，id: 1~4）
		//  已取消 C 键轮换：客户端显式指定目标技能槽位
		// ============================================================
		playerEvent.on("switchSkills", ({ sessionId, uuid, event }) => {
			const player = this.players[sessionId];
			if (!player) return;
			try {
				const msg = typeof event === "string" ? JSON.parse(event) : event;
				const data = msg && msg.data !== undefined ? msg.data : msg;
				const id = data && data.id;
				if (id == null) return;
				player.switchSkill(id);
			} catch (_) {}
		});

		// ============================================================
		//  C2SSelectRobot — 选择 AI 机器人兵种（进局前 5 选 1）
		//  仅匹配阶段可选；对局开始后机器人已部署，禁止更换
		// ============================================================
		playerEvent.on("selectRobot", ({ sessionId, uuid, event }) => {
			const player = this.players[sessionId];
			if (!player) return;
			try {
				const data = JSON.parse(event).data || {};
				const robotType = data.robot;
				const ack = (payload) => {
					room.send(
						"S2CSelectRobot",
						JSON.stringify({
							dest: sessionId,
							seq: 0,
							data: payload,
						}),
					);
				};

				if (!isRobotType(robotType)) {
					ack({ success: false, reason: "invalid_robot_type" });
					return;
				}
				if (this.match.phase !== "matching") {
					ack({ success: false, reason: "game_started" });
					return;
				}

				player.robotType = robotType;
				ack({ success: true, robotType });
				pushChat({
					type: "robot_select",
					player: sessionId,
					name: player.name || sessionId,
					robotType,
					text: `[系统] ${player.name || sessionId} 选择了${ROBOT_TYPES[robotType].name}`,
				});
				console.log(`[Robot] ${sessionId} 选择机器人兵种: ${robotType}`);
			} catch (_) {}
		});

		// 游戏手柄事件（C2SGamepad / C2SGamepadEvent）
		playerEvent.on("gamepadEvent", ({ sessionId, uuid, event }) => {
			const player = this.players[sessionId] || this.spectatorPlayers[sessionId];
			if (!player) return;
			try {
				const msg = typeof event === "string" ? JSON.parse(event) : event;
				player.trigger(
					"gamepadEvent",
					msg && msg.data !== undefined ? msg.data : msg,
				);
			} catch (_) {}
		});

		// 移动端触屏事件（C2STouch / C2STouchEvent）
		playerEvent.on("touchEvent", ({ sessionId, uuid, event }) => {
			const player = this.players[sessionId] || this.spectatorPlayers[sessionId];
			if (!player) return;
			try {
				const msg = typeof event === "string" ? JSON.parse(event) : event;
				player.trigger(
					"touchEvent",
					msg && msg.data !== undefined ? msg.data : msg,
				);
			} catch (_) {}
		});

		// 鼠标事件（C2SMouseEvent）— 商店 GUI 点击购买 / 世界坐标点击瞄准
		playerEvent.on("mouseEvent", ({ sessionId, uuid, event }) => {
			const player = this.players[sessionId] || this.spectatorPlayers[sessionId];
			if (!player) return;
			try {
				const msg = typeof event === "string" ? JSON.parse(event) : event;
				player.trigger(
					"mouseEvent",
					msg && msg.data !== undefined ? msg.data : msg,
				);
			} catch (_) {}
		});

		// ============================================================
		//  购买（C2SBuyItem）
		//  路由：商店实体商品（S2CShopList，需打开商店会话）→ ShopSession；
		//        物品栏系统道具 → Shop.buy（保留旧通道，供人机 / 直接请求）
		// ============================================================
		playerEvent.on("buyItem", ({ sessionId, uuid, event }) => {
			const player = this.players[sessionId];
			if (!player) return;
			try {
				const data = JSON.parse(event).data;
				const itemId = data.itemId;
				if (!itemId) {
					sendBuyItem(sessionId, {
						success: false,
						reason: "缺少 itemId 参数",
					});
					return;
				}

				// ---------- 商店实体购买（S2CShopList 商品）----------
				// 仅当玩家已打开商店会话且商品属于该商店目录时走商店实体购买；
				// 阶段 / 距离 / 库存校验见 _handleShopBuy（结果经 S2CBuyItem 回执）。
				if (
					player._shopSession?.isOpen &&
					player._shopSession.hasItem(itemId)
				) {
					this._handleShopBuy(player, itemId);
					return;
				}

				// ---------- 物品栏商店（旧 C2SBuyItem 通道）----------
				// 仅正常对局阶段允许购买（匹配阶段 / 7 分钟后加时赛禁止）
				if (!this.match.canOpenShop()) {
					sendBuyItem(sessionId, {
						success: false,
						reason: "当前阶段无法购买道具",
					});
					return;
				}
				const result = Shop.buy(player, itemId);
				sendBuyItem(sessionId, result);
			} catch (err) {
				console.error("[BuyItem] Error:", err);
				sendBuyItem(sessionId, { success: false, reason: "服务器内部错误" });
			}
		});

		// ============================================================
		//  商店独立协议（与渲染管线解耦）
		//  C2SOpenShop / C2SCloseShop — 打开 / 关闭商店
		//  商品购买经 C2SBuyItem（见上方路由），清单经 S2CShopList 推送
		// ============================================================
		playerEvent.on("openShop", ({ sessionId, uuid, event }) => {
			const player = this.players[sessionId];
			if (!player) return;
			this._handleOpenShopRequest(player);
		});

		playerEvent.on("closeShop", ({ sessionId, uuid, event }) => {
			const player = this.players[sessionId];
			if (!player) return;
			this._handleCloseShopRequest(player);
		});

		// ---------- 道具使用（网络消息） ----------
		playerEvent.on("useItem", ({ sessionId, uuid, event }) => {
			const player = this.players[sessionId];
			if (!player) return;
			// 匹配阶段禁止使用道具（正常对局与加时赛允许）
			if (!this.match.canUseItems()) {
				room.send(
					"S2CUseItem",
					JSON.stringify({
						dest: sessionId,
						seq: 0,
						data: { success: false, reason: "当前阶段无法使用道具" },
					}),
				);
				return;
			}
			try {
				const data = JSON.parse(event).data;
				const itemId = data.itemId;
				if (!itemId) {
					room.send(
						"S2CUseItem",
						JSON.stringify({
							dest: sessionId,
							seq: 0,
							data: { success: false, reason: "缺少 itemId 参数" },
						}),
					);
					return;
				}

				const success = player.useItem(itemId, {
					world: this.world,
					players: this.players,
				});

				room.send(
					"S2CUseItem",
					JSON.stringify({
						dest: sessionId,
						seq: 0,
						data: { success, itemId },
					}),
				);
			} catch (err) {
				console.error("[UseItem] Error:", err);
				room.send(
					"S2CUseItem",
					JSON.stringify({
						dest: sessionId,
						seq: 0,
						data: { success: false, reason: "服务器内部错误" },
					}),
				);
			}
		});

		// ============================================================
		//  商店（独立协议包，见 src/network/shop.js 与 ShopSession）
		//  打开 / 关闭 / 购买全部经专用包 C2SOpenShop / C2SCloseShop /
		//  C2SBuyItem 驱动，界面数据经 S2COpenShop / S2CShopList / S2CBuyItem
		//  推送，不再使用 S2CRender 渲染商店界面。
		// ============================================================

		// 渲染请求（dest 使用 sessionId）
		room.onMessage("C2SUpdateRender", ({ who, msg }) => {
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
	 * 覆盖范围：世界实体（world.entities）+ 玩家。
	 * （商店界面已与渲染管线解耦，不再通过 isFixed GUI 实体渲染）
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
		// 3) 旁观者幽灵玩家指纹（仅在自己的渲染包中发送，独立参与增量同步）
		for (const sp of Object.values(this.spectatorPlayers)) {
			const data = sp.remoteData();
			const fp = JSON.stringify(data);
			if (fp !== sp._renderFingerprint) {
				sp._renderFingerprint = fp;
				sp._lastChangeTick = renderTick;
				sp._lastRenderData = data;
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
	 *   3. 已从世界移除的实体（发送 { type:'delete', id } 删除包，
	 *      通知客户端停止跟踪并释放缓存）
	 *   4. 漂浮文字（{ type:'popText' } 一次性渲染条目，按玩家去重投递）
	 *
	 * 静态实体（墙体 / 标题 / 装饰）永不变化：首次全量后不再发送，
	 * 动态实体（矿物 / 前哨站 / 商店 / 基地 / 道具）仅在变化时发送，
	 * 玩家仅在移动 / 战斗 / 状态变化时发送。
	 * （商店界面已与渲染管线解耦，经独立协议包通信，见 ShopSession）
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
		// 因此每 FULL_RESYNC_TICKS 个渲染 tick 强制清空 seenEntities，
		// 令本次渲染请求全量重推所有世界实体（幂等覆盖，客户端缓存
		// 天然支持重复 update），保证任意客户端在有限时间内恢复完整世界。
		// 注意：seenIds / seenPlayers 不清空 —— seenIds 用于已移除实体删除包去重，
		// seenPlayers 避免全量重推玩家（玩家变化频繁本就持续重发）。
		if (world.renderTick - state.lastFullSyncTick >= FULL_RESYNC_TICKS) {
			state.seenEntities = new Set();
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
				packet.push({ type: "delete", id: gone.id });
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

		// ---- 3.5 旁观者幽灵玩家：仅出现在该旁观者自己的视角中 ----
		// 旁观者不进入 players，因此不会被任何其他玩家渲染；
		// 这里把自己的幽灵玩家（asset 为 none）追加进本人的渲染包，
		// 增量规则与普通玩家一致（首次全量 + 之后仅发送变化的）。
		const ghost = this.spectatorPlayers[sessionId];
		if (ghost) {
			if (state.seenPlayers.has(ghost.sessionId)) {
				if (ghost._lastChangeTick > lastSentTick) {
					packet.push(ghost.remoteData());
				}
			} else {
				state.seenPlayers.add(ghost.sessionId);
				packet.push(ghost.remoteData());
			}
		}

		// ---- 4. 漂浮文字（并入 S2CRender 的一次性渲染条目，按玩家去重投递） ----
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
	//  商店（独立协议包，与渲染管线解耦）
	//  ------------------------------------------------------------
	//  商店界面的打开 / 关闭 / 商品清单 / 购买结果全部经专用数据包通信
	//  （C2SOpenShop / S2COpenShop / S2CShopList / C2SCloseShop /
	//   S2CCloseShop / C2SBuyItem / S2CBuyItem，见 src/network/shop.js），
	//  不再通过 S2CRender 的 isFixed GUI 实体渲染（ShopGui 已移除）。
	//  服务端仅保留 isShopOpen / _openShop 用于游戏逻辑（打开时禁止移动等）。
	// ============================================================

	/**
	 * 每 tick 同步商店会话（由主循环对每个玩家调用）
	 *
	 * 职责：
	 *   1. 玩家侧强制关闭（离开范围 / 死亡）→ 补发 S2CCloseShop
	 *   2. 商店换货 / 玩家金钱变化 → 指纹比对推送最新 S2CShopList
	 *
	 * @param {string} sessionId
	 */
	_syncShopState(sessionId) {
		// Bot 玩家无客户端连接，跳过（人机通过 BotController 直接购物，无商店会话）
		if (BotPlayer.isBotSession(sessionId)) return;

		const player = this.players[sessionId];
		if (!player) return;

		const session = player._shopSession;
		if (!session) return;

		// 玩家侧已强制关闭（离开范围 / 死亡）→ 服务端补发 S2CCloseShop
		if (!player.isShopOpen) {
			session.close(player.dead ? "dead" : "out_of_range");
			return;
		}

		// 换货 / 金钱变化 → 自动推送最新 S2CShopList
		session.tick();
	}

	/**
	 * C2SOpenShop — 打开商店请求
	 *
	 * 校验阶段（仅正常对局）与商店距离，通过后创建 ShopSession 并推送
	 * S2COpenShop（含商店信息）+ S2CShopList（初始清单）。
	 *
	 * @param {Player} player
	 */
	_handleOpenShopRequest(player) {
		// 已打开：忽略重复请求
		if (player._shopSession?.isOpen) return;

		// 阶段校验：仅正常对局可打开商店
		if (!this.match.canOpenShop()) {
			sendOpenShop(player.sessionId, {
				success: false,
				reason: "shop_disabled",
			});
			return;
		}

		// 商店目标：优先使用玩家绑定的商店，否则就近查找
		const shop = player._openShop || this.findNearestShop(player);
		if (!shop || !shop.isPlayerNear(player.x, player.y)) {
			sendOpenShop(player.sessionId, {
				success: false,
				reason: "no_shop_nearby",
			});
			return;
		}

		player._shopSession = new ShopSession(this, player, shop);
		player._shopSession.open();
	}

	/**
	 * C2SCloseShop — 关闭商店请求（客户端主动关闭）
	 *
	 * @param {Player} player
	 */
	_handleCloseShopRequest(player) {
		const session = player._shopSession;
		if (!session?.isOpen) return;
		session.close("manual");
	}

	/**
	 * C2SBuyItem — 购买商店实体商品（路由：见 buyItem 事件）
	 *
	 * 阶段 / 距离校验通过后由 ShopSession.buy 执行购买（库存扣减 / 金钱扣除 /
	 * 效果施加由 Shop 实体完成），结果经 S2CBuyItem 回执，库存与金钱变化
	 * 随后自动推送最新 S2CShopList。
	 *
	 * @param {Player} player - 购买者
	 * @param {string} itemId - 商品 id
	 */
	_handleShopBuy(player, itemId) {
		const session = player._shopSession;
		if (!session?.isOpen) {
			sendBuyItem(player.sessionId, {
				success: false,
				itemId,
				reason: "shop_not_open",
			});
			return;
		}

		// 阶段校验：7 分钟后加时赛禁止购买
		if (!this.match.canOpenShop()) {
			sendBuyItem(player.sessionId, {
				success: false,
				itemId,
				reason: "shop_disabled",
			});
			session.close("shop_disabled");
			return;
		}

		// 范围校验：被推离商店后禁止购买，并自动关闭商店
		if (!session.shop.isPlayerNear(player.x, player.y)) {
			sendBuyItem(player.sessionId, {
				success: false,
				itemId,
				reason: "no_shop_nearby",
			});
			session.close("out_of_range");
			return;
		}

		// 传入机器人管理器上下文（机器人强化芯片购买需要）
		session.buy(itemId, { robots: this.robotManager });
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
	 * 向指定会话发送懒加载资源清单（S2CUpdateAssets，每个条目一个包）
	 *
	 * 数据包格式：{ dest: sessionId, seq: 0, data: { asset, url } }
	 * data 字段原样传入 lazyload.json 中带有 asset / url 字段的对象。
	 *
	 * @param {string} sessionId - 目标会话（玩家或旁观者）
	 */
	_sendLazyLoadAssets(sessionId) {
		for (const entry of getLazyLoadAssets()) {
			room.send(
				"S2CUpdateAssets",
				JSON.stringify({
					dest: sessionId,
					seq: 0,
					data: { asset: entry.asset, url: entry.url },
				}),
			);
		}
	}

	end() {
		clearInterval(this.matchLoop);
	}
}

export default Game;
