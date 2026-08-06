# CHANGELOG

本文档记录本次代码审阅与修复的变更内容，以及审阅中发现但暂未修改的问题（拿不准、交由后续确认）。

## 渲染管线重构（降 pps：S2CRender → S2CRenderBatch 批处理）

### 1. 渲染包合并广播 — `src/game/render.js` / `src/game/index.js`
- **问题**：旧管线中，客户端每次 `C2SUpdateRender` 都触发一次独立的 `S2CRender` 广播；而 `room.send` 是广播（投递给房间内所有客户端）。8 名玩家各按 20Hz 请求时，服务器每秒广播 160 个渲染包，每个客户端实际收到全部 160 包/s —— pps 过高导致中继拥塞丢包，增量渲染协议丢一个包就会使客户端缓存缺失实体（沿用上一帧）造成渲染损坏。
- **修复**：新增 `RenderBatcher`（`src/game/render.js`）：所有客户端的增量渲染包先按 sessionId 暂存，由 Game 主循环每 tick 调用 `_flushRenderBatch()` 合并为**单个** `S2CRenderBatch` 广播包（`{ seq, data: { [sessionId]: [条目...] } }`），每个客户端只取 `data[ownSessionId]` 渲染。
  - pps：`客户端数 × 请求频率`（8 人 20Hz ≈ 160 包/s）→ `主循环 tick 频率`（20 包/s）；全静止阶段无待发数据直接跳过发送 → 0 包/s。
  - 请求与发送解耦：`C2SUpdateRender` 仅登记 dirty 集合，增量包在 `_refreshRenderFingerprints` 之后统一构建（顺带消除了「请求恰在主循环中途到达时读到上一 tick 旧坐标」的时序问题）。
- **客户端配合**：渲染消息名由 `S2CRender`（`{dest, seq, data: []}`）改为 `S2CRenderBatch`（`{seq, data: {sessionId: []}}`），收到后取 `data[ownSessionId]` 渲染即可，语义与旧 dest 过滤完全等价。

### 2. 键盘事件差分上报 — `src/game/match/player/index.js` / `src/sessions/index.js`
- **修复**：服务端已支持 `KeyDown`/`KeyUp` 增量事件流，现补充完整协议文档与防御：
  - `processEvents` 文档明确差分上报协议（KeyDown 按下 / KeyUp 抬起），并建议客户端每 1~2 秒或重连后补发一次 `KeyHolding` 完整快照用于对账（纠正 KeyUp 丢包造成的按键偏差）；
  - 事件队列增加上限（`EVENT_QUEUE_MAX = 256`），防御客户端异常高频刷包导致内存无界增长；
  - C2S 方向 pps 从「20 包/s（每帧全量 KeyHold）」降至「按键变化频率」（空闲几乎为零）。

## 修复的 Bug

### 1. 主循环首个 tick 崩溃（进程直接退出）— `src/game/index.js`
- **问题**：主循环中仍调用 `flushPopText(this.players, this.spectators)`，但该函数已在渲染重构（重写渲染）时从 `src/game/popText.js` 中删除，且进程没有任何 `uncaughtException` 处理器。服务器启动后第一个 tick（约 50ms）即抛 `ReferenceError: flushPopText is not defined` 导致进程崩溃。
- **修复**：移除该残留调用。漂浮文字现已在渲染重构后统一并入 S2CRender 渲染管线（`_buildRenderPacket` 中的 `buildPopTextEntries` 按玩家去重投递），主循环无需再单独广播。

### 2. `prunePopTexts` 每 tick 抛错 — `src/game/popText.js`
- **问题**：`prunePopTexts` 尾部残留旧 `flushPopText` 的发送循环，引用了未定义的 `players`、`spectators`、`send`，每次调用（每 tick）抛 `ReferenceError: players is not defined`。
- **修复**：删除残留的发送循环，`prunePopTexts` 只负责清理过期条目（保留 duration + 1s 余量）。

### 3. 旁观者首次渲染请求即崩溃 + 漂浮文字重复投递 — `src/game/index.js`
- **问题**：旁观者加入时初始化的 `_renderStates[sessionId]` 缺少 `pendingGuiRemovals` 等字段：
  - `_buildRenderPacket` 步骤 4 `for (const gone of state.pendingGuiRemovals)` 对 undefined 迭代 → `TypeError: state.pendingGuiRemovals is not iterable`，旁观者第一次请求渲染即抛错；
  - 缺少 `lastPopTextSeq` → 漂浮文字被重复投递（每次渲染请求都重发）；缺少 `lastFullSyncTick` → 旁观者永远不触发周期全量重同步。
- **修复**：旁观者渲染状态改为与普通玩家完全一致的字段集合。

### 4. 任何道具使用即抛 `ReferenceError: world is not defined` — `src/game/match/player/index.js`
- **问题**：`useItem(itemId, options)` 内部直接引用未声明的变量 `world`、`players`（意图是从 `options` 解构），只要玩家实际使用消耗品/放置物/投射物/功能道具（含人机 Bot 的所有道具使用），就会抛错；`useItem` 网络入口的 try/catch 会让玩家无反馈地“使用失败”。
- **修复**：`const { world, players } = options;` 正确解构参数；未传时回退到 `this._worldRef / this._playersRef`（tick 中缓存的引用）。

### 5. 购买/叠加已有道具抛 `ReferenceError: Inventory_MAX_STACK is not defined` — `src/game/match/item/inventory.js`
- **问题**：`add()` 对已有堆叠检查上限时引用了未定义的 `Inventory_MAX_STACK`（应为 `Inventory.MAX_STACK`）。玩家购买第 2 个同类道具时抛错（金钱已扣、道具未加）。
- **修复**：改为 `Inventory.MAX_STACK`。

### 6. 购买时先扣钱后入包，失败会白扣钱 — `src/game/match/item/shop.js`
- **问题**：`Shop.buy` 先 `player.money -= config.price` 再 `inventory.add(...)`；一旦 `add` 失败（例如堆叠/容量异常路径），玩家金钱被扣但未获得道具。
- **修复**：先 `inventory.add`，成功后再扣钱（失败返回明确原因，不扣款）。

### 7. 物品栏序列化排序失效 — `src/game/match/item/inventory.js`
- **问题**：`serialize()` 用 `b.itemId - a.itemId` 排序，itemId 是字符串，减法结果为 `NaN`，比较器失效（排序无实际效果）。
- **修复**：改用 `a.itemId.localeCompare(b.itemId)` 按道具 ID 字典序排列。

### 8. 商店换货后点击购买的是旧商品 — `src/game/match/gui/shopGui.js`
- **问题**：商店刷新商品（换货）后 `refresh()` 只同步了 `asset / price / stock`，没有同步 `state.itemId`；此时点击该槽位会使用旧商品 id 发起购买（大概率 `not_in_shop` 或买错）。
- **修复**：`refresh()` 中同步 `entity.state.itemId = item.id`。

### 9. 商店“疾速药水”临时加速污染全局英雄配置 — `src/game/match/entity/shop.js`
- **问题**：`player.args` 指向 `HERODATAS[hero]`（所有同英雄玩家共享的同一对象）。`_applyEffect` 的 `speed` 分支直接 `player.args.speed += amount`，会同时改变所有同英雄玩家的移速与全局配置，且 `setTimeout` 还原同样殃及他人（例如 A 队购买后 B 队同英雄玩家也变快 8 秒）。
- **修复**：限时加速改为给该玩家施加 `SpeedBuff`（与道具 `speedPotion` 的实现一致，仅作用于购买者自身）；永久加速分支（无商店道具使用）暂保持原样并留待确认（见下文“未修改的问题”）。

## 未修改的问题（存疑，供确认）

以下问题在审阅中发现，但涉及设计权衡或需要更多上下文，**未改动**，仅在此记录：

1. **A* 寻路父节点记录非最优**（`src/utils/astar.js` `findPath`）：`parentKey` 在节点“首次被发现”时记录，而非“最优 g 值”时更新。配合 admissible 启发式，最终路径仍有效，但个别情况下可能非最短。影响小，未改。

2. **墙体碰撞无“推出”逻辑**（`src/game/match/player/index.js` `move`）：玩家若被击退嵌入墙体，被卡住的轴向上速度会被清零而无法脱出（简单物理的常见取舍），未改。

3. **删除包有效期仅 ~5 tick（250ms）**（`src/game/match/world.js` `refreshRenderTicks` + `src/game/index.js` `_buildRenderPacket`）：`_pendingRemovals` 只保留 5 个渲染 tick，若某客户端在此期间没有发起渲染请求（网络抖动/卡帧），会错过该实体的 `{type:'delete'}` 包；而周期全量重同步不清空 `seenIds / seenPlayers`，该实体（或已离场玩家）将一直残留在该客户端。这是代码注释中的既有设计（避免全量重推玩家），但 250ms 窗口对真实网络可能偏紧，建议后续评估是否在重同步时也重发一次删除或扩大保留窗口。

4. **`world.tick` 依赖函数形参个数分发**（`src/game/match/world.js`）：用 `entity.tick.length`（≥3 / ==2 / 其余）区分投射物 / 放置物 / 爆炸实体。当前所有道具实体的参数个数与之匹配，但新增道具时极易踩坑，建议改为显式类型标记。

5. **商店永久加速仍修改共享 hero 配置**（`src/game/match/entity/shop.js` `_applyEffect` `speed` 分支的 else 分支）：当前商品表中没有永久加速道具，故未触碰；若未来加入，需要为玩家增加 per-player 基础速度字段。

6. **`BotController._condAtMineral` / `_actMine` 依赖行为树记忆**：矿物被其他玩家采走后 bot 的目标清理依赖 `collected` 检查与重感知，逻辑上闭环但日志/时序上偶有“目标丢失”抖动，属行为质量而非崩溃，未改。
