# 对局服务器通信协议（API.md）

> 本文档描述 matchserver（`src/network/`、`src/sessions/`、`src/game/`）与客户端之间的全部
> 网络数据包：**C2S**（客户端 → 服务端）与 **S2C**（服务端 → 客户端）。

---

## 1. 传输与通用包格式

### 1.1 传输链路

matchserver 通过 `colyseus.js` 客户端（`src/network/client.js`）加入 ccw.site 的
中继房间（`config.roomType`，默认 `broadcast`），客户端与 matchserver 之间的一切
消息均经该中继房间转发。房间加入参数（握手选项）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 玩家显示名（可空，空时回退 sessionId） |
| `uuid` | string | 账号 uuid（结算上报 backend 使用） |
| `gid` | string | `${projectId}-${roomId}`，房间组标识 |
| `extra` | string | 附加信息（原样透传，含 `uuid`） |
| `filter` | object | `{ name: 'match' }` 房间过滤 |

### 1.2 C2S 消息外层格式（中继房间投递）

```jsonc
{
  "who": {
    "sessionId": "abc123",          // 会话 id（房间内唯一）
    "name": "玩家名",                // 可选
    "extra": { "uuid": "..." }      // 账号 uuid
  },
  "msg": { "data": { /* 包体数据，见各包定义 */ } }
}
```

- `who.sessionId` 是服务端追踪玩家的主键；`who.extra.uuid` 是账号主键（同一账号允许多会话）。
- `msg` 即客户端发送的包体。多数包约定为 `{ data: {...} }` 形态。

### 1.3 S2C 消息外层格式（服务端发送）

```jsonc
{
  "dest": "abc123",   // 目标玩家 sessionId；"" = 广播给房间内所有客户端
  "seq": 0,           // 序号（当前实现恒为 0，客户端可忽略）
  "data": { /* 包体数据，见各包定义 */ }
}
```

- 定向包（`dest` 为具体 sessionId）：`S2CHandshake`、`S2CRender`、`S2CChat`、
  `S2CUpdateAssets`、`S2CSelectRobot`、`S2CUseItem`、`S2COpenShop`、`S2CShopList`、
  `S2CCloseShop`、`S2CBuyItem`。
- 广播包（`dest` 为 `""`）：`C2CChat`（公屏聊天，历史命名，实为 S2C 广播）。

### 1.4 包名命名规则

| 前缀 | 含义 |
| --- | --- |
| `C2S*` | Client → Server，客户端主动请求 |
| `S2C*` | Server → Client，服务端回执 / 推送 |
| `C2CChat` | 历史命名（聊天广播），实际是 Server → Client 广播 |
| `syscmd:*` | 中继房间系统消息（玩家进出房间的通知，服务端内部处理） |

### 1.5 阶段与行动许可

服务端按 `MatchManager.phase` 控制玩家行为，多数 C2S 请求受阶段限制：

| 阶段 | 值 | 说明 |
| --- | --- | --- |
| 匹配 | `matching` | 仅可移动；禁止攻击 / 采矿 / 技能 / 道具 / 商店 / 选机器人之外的请求 |
| 正常对局 | `playing` | 0 ~ 7 分钟，全功能 |
| 加时赛 | `suddenDeath` | 7 ~ 10 分钟，禁止复活、禁止打开商店，允许使用道具 |
| 已结算 | `finished` | 停止一切行动 |

对局已开始（非 `matching`）后加入的玩家自动成为**旁观者**：不参与战斗，仅接收
`S2CRender` 与聊天消息，可 WASD 自由移动（幽灵玩家，仅自己可见）。

---

## 2. C2S 包（客户端 → 服务端）

### 2.1 C2SHandshake — 握手 / 加入对局

**触发**：客户端加入房间后立即发送；服务端完成校验后回 `S2CHandshake`。

**包体**（`msg`）：

```jsonc
{
  "data": {
    "hero": "newton",     // 可选；英雄 id（小写），非法值回退默认英雄（见 5.1）
    "robot": "drone",     // 可选；AI 机器人兵种，非法值为 null（开局随机部署）
    "name": "玩家名"       // 可选；显示名
  }
}
```

**服务端行为**：

1. 非匹配阶段 → 玩家成为旁观者，回 `S2CChat`（`type: "spectator_joined"`）。
2. 匹配阶段满 8 名真人（4v4）→ 拒绝加入。
3. 禁用英雄校验（`config.disabledHeroes` / 环境变量 `DISABLED_HEROES`）：被禁用的英雄不可被玩家使用 →
   不拒绝加入，回退默认英雄并回 `S2CChat`（`type: "hero_disabled"`，客户端可据此刷新英雄选择）。
4. 英雄解锁校验（`backend.js` 的 `isHeroUnlocked`）：非默认英雄未解锁 →
   拒绝并回 `S2CChat`（`type: "hero_locked"`）；backend 不可达 → 放行并记录警告。
5. 队伍分配：加入人数较少的队伍，相同则随机。
6. 创建 Player 实体，初始化渲染增量状态，推送懒加载资源清单
   （每条目一个 `S2CUpdateAssets`），通知匹配管理器 `onHumanJoined`。
7. 成功 → 回 `S2CHandshake`；失败 → 不回执（客户端等待超时后重试 / 更换英雄重连）。

### 2.2 C2SKeyboardEvent — 键盘事件

**触发**：键盘输入（PC 端）。

**包体**（`msg.data`）：

```jsonc
{
  "type": "KeyHolding",          // 'KeyHolding' | 'KeyDown' | 'KeyUp'
  "key": ["KeyW", "KeyR"]        // KeyHolding：当前按住的全部按键列表；
}                                // KeyDown/KeyUp：单个按键码
```

**按键码语义**（服务端 `processKeyholding`）：

| 按键码 | 行为 |
| --- | --- |
| `KeyW` / `KeyA` / `KeyS` / `KeyD` | 移动（上 / 左 / 下 / 右） |
| `KeyR` | 普攻（冷却就绪且非技能释放中） |
| `KeyF` | 释放当前选中技能（扣金钱、进入前摇、记冷却） |
| `KeyE` | 边沿触发：靠近己方前哨站（25px）设置重生点；按住：开采矿物 |
| `Digit1` ~ `Digit9` / `Digit0` | 使用物品栏 1 ~ 10 号位道具（边沿触发） |

服务端每 tick 合并键盘 + 手柄 + 触屏按键后统一处理（`mergeInputKeys`）。

### 2.3 C2SMouseEvent — 鼠标事件

**触发**：鼠标点击（商店 GUI 点击购买 / 世界坐标点击瞄准）。

**包体**（`msg.data`）：

```jsonc
{
  "x": 50,              // 坐标 X
  "y": 30,              // 坐标 Y
  "world": false,       // false：视口归一化坐标（0~100），商店打开时用于商品命中检测；
  "button": 0,          // 可选；鼠标键位
  "type": "Click"       // 可选；事件类型
}
```

`world: true` 时 `x/y` 为世界坐标，用于设置瞄准方向（影响道具投射物发射方向）。

### 2.4 C2SGamepad / C2SGamepadEvent — 手柄事件

**触发**：手柄输入（三端操作之一）。两个包名路由到同一处理函数。

**包体**（`msg.data`，支持三种形态）：

```jsonc
// ① 快照型（推荐）
{
  "type": "GamepadHolding",        // 'GamepadHolding' | 'GamepadState' | 'GamepadChanged'
  "axes": { "leftX": 0, "leftY": -1, "rightX": 0.5, "rightY": 0 },  // 或 [lx, ly, rx, ry]（-1~1）
  "buttons": { "a": true, "b": false, "x": false, "y": false,
               "lb": false, "rb": false, "lt": 0, "rt": 0.8 }        // 或 [{pressed},...] 标准布局
}
// ② 平铺型：{ type, leftX, leftY, rightX, rightY, a, b, x, y, lt, rt, lb, rb }
// ③ 单按钮增量：{ type: 'GamepadDown'|'GamepadUp', button: 'a' } 或 { control: 'a', pressed: true }
```

**映射**（服务端 `processGamepadInput`，左摇杆 ± 死区 0.2）：

| 控件 | 折叠为 |
| --- | --- |
| 左摇杆 | 移动（KeyW/A/S/D） |
| 右摇杆 | 瞄准方向（aimDir，影响道具发射方向） |
| A | 普攻（KeyR） |
| X | 释放技能（KeyF） |
| B | 交互（KeyE：商店 / 开采 / 设置重生点） |
| RT | 普攻（KeyR） |
| LT | 使用 1 号位道具（Digit1） |

未上报的字段沿用上一次的值（支持增量上报）。

### 2.5 C2STouch / C2STouchEvent — 触屏事件

**触发**：移动端触屏输入。两个包名路由到同一处理函数。

**包体**（`msg.data`，支持三种形态）：

```jsonc
// ① 虚拟控件事件
{
  "virtual": true,
  "type": "joystick",             // 'joystick' | 'button'
  "control": "move",              // joystick: 'move' | 'aim'
                                  // button: 'attack' | 'skill' | 'interact' | 'useItem'
                                  //         | 'item1' ~ 'item10'
  "x": 0.8, "y": 0,               // joystick 方向（-1~1）
  "pressed": true
}
// ② 点击坐标事件
{ "virtual": false, "x": 123, "y": 456, "world": false }   // world=true 为世界坐标（瞄准）
// ③ 快照型
{
  "type": "TouchHolding",          // 'TouchHolding' | 'TouchState'
  "joystick": { "x": 0, "y": -1 }, // 左虚拟摇杆（移动），null = 松开
  "aim": { "x": 1, "y": 0 },       // 右虚拟摇杆（瞄准），null = 松开
  "buttons": { "attack": true },   // 虚拟按键集合
  "click": { "x": 100, "y": 200 }, // 点击坐标（可选）
  "world": false
}
```

**映射**（服务端 `processTouchInput`）：

| 控件 | 折叠为 |
| --- | --- |
| 左虚拟摇杆 | 移动（KeyW/A/S/D） |
| 右虚拟摇杆 / 世界坐标点击 | 瞄准方向 |
| `attack` | 普攻（KeyR） |
| `skill` | 释放技能（KeyF） |
| `interact` | 交互（KeyE） |
| `useItem` | 使用 1 号位道具（Digit1） |
| `item1` ~ `item10` | 使用对应槽位道具（Digit1 ~ Digit0） |

### 2.6 C2SSelectRobot — 选择 AI 机器人兵种

**触发**：进局前 5 选 1（仅匹配阶段有效）。

**包体**（`msg.data`）：

```jsonc
{ "robot": "drone" }
```

**兵种枚举**：`engineer`（工程）、`infantry`（步兵）、`hero`（英雄）、`drone`（无人机）、
`sentinel`（哨兵）。非法值回 `S2CSelectRobot`（`reason: "invalid_robot_type"`）。

**服务端行为**：匹配阶段可重复选择（覆盖 `player.robotType`）；对局开始后拒绝
（`reason: "game_started"`）。成功后广播 `C2CChat`（`type: "robot_select"`）。
AI 机器人 ≠ 人机补位：不进入 `players`，开局由 `RobotManager.spawnAll` 部署。

### 2.7 C2SSwitchSkills — 切换当前选中技能

**触发**：客户端直选技能槽位（替代旧的 C 键轮换）。

**包体**（`msg.data`）：

```jsonc
{ "id": 2 }   // 1 | 2 | 3 | 4，对应 skill1 ~ skill4
```

**服务端行为**：`player.switchSkill(id)` 直接设置 `selectedSkill`；id 非法或技能不存在
时静默忽略（返回 false，无回执）。技能数据（名称 / 冷却 / 金钱消耗）见英雄配置
`src/assets/data/heros/*.js` 的 `attacks.skill1~4`。

### 2.8 C2SOpenShop — 打开商店请求

**触发**：玩家在商店交互范围内按 E 键 / 触屏按钮。

**包体**：`{ "data": {} }`（无需参数）。

**服务端行为**（`Game._handleOpenShopRequest`）：

1. 已打开 → 忽略重复请求。
2. 阶段校验：仅 `playing` 可打开；否则回 `S2COpenShop`（`reason: "shop_disabled"`）。
3. 距离校验：商店实体 `isPlayerNear`（半径 `SHOP_META.radius` = 50px）判定；
   不在范围回 `S2COpenShop`（`reason: "no_shop_nearby"`）。
4. 通过 → 创建 `ShopSession` 并 `open()`：回 `S2COpenShop`（成功）+ 首份 `S2CShopList`。

### 2.9 C2SCloseShop — 关闭商店请求

**触发**：玩家主动关闭商店（E 键 / 关闭按钮）。

**包体**：`{ "data": {} }`（无需参数）。

**服务端行为**：会话打开时 `session.close("manual")` → 回 `S2CCloseShop`（`reason: "manual"`）；
未打开则忽略。服务端也会在离开范围 / 死亡 / 阶段禁用时主动关闭并回执
（见 `S2CCloseShop`）。

### 2.10 C2SBuyItem — 购买请求

**触发**：点击商品（商店 GUI）/ 手柄 A 键。路由见 `Game` 的 `buyItem` 事件。

**包体**（`msg.data`）：

```jsonc
{ "itemId": "shop_item_potion_health" }
```

**服务端行为**：

1. 缺 `itemId` → 回 `S2CBuyItem`（`reason: "缺少 itemId 参数"`）。
2. 玩家已打开商店会话且商品属于该商店目录 → 走商店实体购买
   （`Game._handleShopBuy`，结果经 `S2CBuyItem` 回执，随后自动推送最新 `S2CShopList`）。
3. 否则走旧物品栏商店通道（`Shop.buy`，供人机 / 直接请求）：
   仅 `playing` 阶段允许，否则回 `S2CBuyItem`（`reason: "当前阶段无法购买道具"`）。

**商品 id**：常驻商品如 `shop_item_potion_health`（治疗药水）、`shop_item_potion_speed`（疾速药水）、
`shop_item_scroll_teleport`（回城卷轴）、`shop_item_ward_vision`（视野守卫）等；
刷新商品含 `trait-lottery`（词条抽奖券）、`robot-upgrade`（机器人强化芯片）等
（见 `src/assets/data/shop/list.js` 与 `src/assets/data/shop/shop.js`）。

### 2.11 C2SUseItem — 使用道具请求

**触发**：使用物品栏道具（道具快捷键或 GUI）。

**包体**（`msg.data`）：

```jsonc
{ "itemId": "bomb" }
```

**道具 id 枚举**（`src/assets/data/items/items.js` 的 `ITEM_CONFIG`）：`pill`、`bandage`、
`medicalKit`、`bomb`、`fireball`、`landmine`、`fragGrenade`、`flashBang`、`smokeGrenade`、
`poisonDart`、`freezeTrap`、`teleportScroll`、`speedPotion`、`invisibleCloak`、
`shieldStone`、`thornArmor`、`healingTotem`。

**服务端行为**：

1. 阶段校验：`playing` / `suddenDeath` 允许；`matching` 拒绝
   （`reason: "当前阶段无法使用道具"`）。
2. 缺 `itemId` → 回 `S2CUseItem`（`reason: "缺少 itemId 参数"`）。
3. `player.useItem(itemId, { world, players })`：校验道具存在 / 数量 / 冷却，
   按类型派发（consumable 消耗品 / placeable 放置物 / projectile 投射物 / utility 工具）。
4. 回 `S2CUseItem`：`{ success, itemId }` 或 `{ success: false, reason }`。

### 2.12 C2SUpdateRender — 渲染请求（拉模型）

**触发**：客户端每帧请求增量渲染数据（`dest` 使用 sessionId）。

**包体**：`{ "data": {} }`（无需参数；服务端只使用 `who.sessionId` 定位目标）。

**服务端行为**：普通玩家与旁观者均可请求。服务端组装增量渲染包并回 `S2CRender`
（详见 §3.2）。客户端约定：**渲染数据中缺失的实体沿用上一帧**，故服务端只发送
新增 / 变化 / 移除的条目。

### 2.13 系统消息（中继房间 → 服务端）

| 包名 | 说明 |
| --- | --- |
| `syscmd:newPlayerAdded` | 玩家进入房间但尚未握手（仅记录日志） |
| `syscmd:playerRemoved` | 玩家连接断开；服务端清理玩家 / 旁观者 / 机器人 / 商店会话，广播 `C2CChat`（`player_leave`），并通知匹配管理器补人机 |

---

## 3. S2C 包（服务端 → 客户端）

### 3.1 S2CHandshake — 握手成功回执

**触发**：`C2SHandshake` 校验全部通过、玩家已创建后发送（定向）。

**包体**：

```jsonc
{ "data": {} }
```

客户端收到此包即表示已正式加入对局（普通玩家或旁观者）。失败时服务端不回执，
而是回定向 `S2CChat` 说明原因（见 §3.5）。

### 3.2 S2CRender — 渲染通道（核心）

**触发**：响应 `C2SUpdateRender`（拉模型），定向发送。

**包体**：

```jsonc
{
  "data": [
    /* 渲染条目数组：实体更新 / 玩家更新 / 删除 / 漂浮文字 */
  ]
}
```

**增量同步语义**：

- 服务端维护每客户端的 `seenEntities` / `seenIds` / `seenPlayers` / `lastSentTick`；
- 首次出现的实体 / 玩家全量推送一次（建立客户端缓存）；
- 之后仅发送 `_lastChangeTick > lastSentTick`（自上次发送以来变化）的条目；
- 每 100 渲染 tick（5 秒）强制清空 `seenEntities` 做一次全量重同步，防止初始推送
  丢失后静态实体永不恢复；
- 实体从世界移除时发送 `{ type: "delete", id }`，客户端须停止跟踪并释放缓存。

#### 3.2.1 实体更新条目（`type: "update"`）

```jsonc
{
  "type": "update",
  "id": "mineral_1",          // 实体唯一 id
  "x": 1280.5, "y": 6840,     // 世界坐标（0.1px 精度）
  "asset": "mineral_copper",  // 渲染资源 id
  "dir": 90,                  // 朝向
  "isShowed": true,           // false = 隐藏但不删除
  "color": 0,                 // 染色（effects.color，0 = 无）
  "ghost": 0,                 // 透明度 0~100
  "scale": 100,               // 缩放百分比
  "width": 64, "height": 64,  // 尺寸（像素）
  "z-index": 0,               // 渲染层级
  /* ── 按实体类型扩展 ── */
  "mineralType": "copper",    // 矿物：矿种
  "collected": false,         // 矿物：是否已采完（重生后恢复）
  "state": {                  // 前哨站 / 基地 / AI 机器人
    "owner": null,            //   前哨站：占有方 'A' | 'B' | null
    "progress": 0,            //   前哨站：占领进度 0 → 200
    "spawnSet": {},           //   前哨站：已设重生点的玩家集合
    "team": "A",              //   基地：归属队伍
    "hp": 4000, "maxHp": 4000,//   基地 / 机器人：血量
    "destroyed": false,       //   基地：是否被摧毁
    "ownerId": "abc123",      //   机器人：所属玩家 sessionId
    "robotType": "drone",     //   机器人：兵种
    "dead": false,            //   机器人：是否死亡
    "downed": false,          //   机器人：是否宕机（可复活）
    "reviveRemaining": 0,     //   机器人：复活剩余毫秒
    "traits": []              //   机器人：已获得词条
  }
}
```

实体类型（来自地图 `src/game/map/1.json` 与运行时）：`entity`（装饰）、`wall`（墙体）、
`title`（标题）、`mineral`（矿物）、`outpost`（前哨站）、`shop`（商店）、`base`（基地），
以及运行时生成的**道具实体**（炸弹 / 火球 / 地雷 / 手雷 / 闪光弹 / 烟雾弹 / 毒镖 /
冰冻陷阱 / 治疗图腾，见 `src/game/match/item/*.js`）与 **AI 机器人**（`robot_<sessionId>`）。
墙体 / 标题 / 装饰为静态实体，仅首次全量发送一次。

#### 3.2.2 玩家更新条目（`type: "update"`）

```jsonc
{
  "type": "update",
  "x": 1280.5, "y": 6840.2,   // 世界坐标
  "asset": "newton_run2",      // 渲染资源（`${hero}_${动画状态}`；旁观者恒为 "none"）
  "isShowed": true,            // 死亡玩家为 false（隐藏模型）
  "id": "abc123",              // sessionId
  "scale": 100,
  "dir": 90,
  "fz": 1,
  "z-index": 1000,
  "state": {
    "health": 850, "maxHealth": 850,  // 血量
    "money": 120,                      // 金钱
    "dead": false,                     // 已死亡且无法复活
    "kills": 3,                        // 累计击杀
    "mining": false, "miningTime": 0, "canMine": false,   // 开采状态
    "canShop": false, "canOpenShop": false, "isShopOpen": false,  // 商店状态
    "canSetSpawn": false, "spawnOutpostId": null,          // 重生点状态
    "selectedSkill": 1, "casting": false,                  // 技能
    "skillStates": {                                      // 技能 1~4 状态
      "1": { "name": "质量抛掷", "cd": 8000, "cost": 0,
             "remaining": 0, "ready": true }
    },
    "basicReady": true, "needToPredict": true,
    "team": "A",
    "robotType": "drone", "robotId": "robot_abc123",      // AI 机器人
    "autoTargetId": null,                                 // 自动索敌目标 id
    "inputMode": "keyboard",                              // 'keyboard'|'gamepad'|'touch'
    "aiming": false,
    "aimDir": "{\"x\":0,\"y\":-1}",                       // 瞄准方向（JSON 字符串）
    "lastClick": null,                                    // 最近点击坐标
    "speed": "{\"x\":0,\"y\":0}",                         // 速度（JSON 字符串）
    "buffs": [ { "id": "speed", "level": 1, "remaining": 5000 } ],  // Buff 列表
    "areas": [],                                          // 当前区域效果
    "inventory": [                                        // 物品栏
      { "itemId": "bomb", "count": 2, "name": "炸弹",
        "description": "...", "type": "placeable",
        "cd": 5000, "cdRemaining": 0 }
    ],
    "shield": 0, "invisible": false, "stunned": false,    // 状态标志
    "traits": [],                                         // 词条列表
    "channelingTeleport": false, "teleportRemaining": 0   // 回城卷轴引导
  }
}
```

#### 3.2.3 删除条目（`type: "delete"`）

```jsonc
{ "type": "delete", "id": "bot_3" }
```

实体从世界移除（道具自毁 / 玩家离开 / 人机被踢 / 机器人宕机移除）时发送，
通知客户端停止跟踪并释放缓存。仅发给「曾见过该 id」的玩家。

#### 3.2.4 漂浮文字条目（`type: "popText"`）

```jsonc
{
  "type": "popText",
  "id": "poptext_12",      // 唯一 id（客户端动画键）
  "isFixed": false,        // true = 屏幕固定坐标（0~100）；false = 世界坐标
  "x": 1280, "y": 6800,    // 位置
  "text": "40",            // 文字内容（伤害数字等）
  "color": 16711680,       // 颜色（0xRRGGBB）
  "vx": 0, "vy": -50,      // 漂浮动量（像素/秒）
  "duration": 800,         // 持续时间（毫秒），到期自动消失
  "ghost": 0               // 透明度 0~100（0 = 不透明）
}
```

每条文字带全局递增 `seq`，服务端按玩家记录 `lastPopTextSeq` 保证每条恰好投递一次，
过期（超过 duration）条目不再投递。

### 3.3 C2CChat — 公屏聊天广播

> ⚠️ 历史命名：虽为 `C2C` 前缀，实为 **Server → Client 广播**（`dest: ""`），
> 发送给房间内所有真人玩家与旁观者。

**触发**：匹配进度、玩家加入 / 退出、机器人选择、阶段切换、基地摧毁、对局结算等系统消息。

**包体**：

```jsonc
{
  "dest": "",
  "seq": 0,
  "data": {
    "type": "match_progress",   // 消息类别（见下表）
    "text": "[匹配] 等待玩家加入…",  // 展示文本
    /* ── 按 type 附加字段 ── */
    "phase": "matching",
    "humans": 2, "total": 2, "remaining": 118
  }
}
```

**`type` 枚举**：

| type | 触发时机 | 附加字段 |
| --- | --- | --- |
| `match_progress` | 匹配阶段每 5 秒广播 | `phase`, `humans`, `total`, `remaining`（剩余秒数，未启动倒计时为 null） |
| `player_join` | 真人 / 人机加入 | `player`, `name`, `team`, `isBot` |
| `player_leave` | 真人退出 / 人机被踢 | `player`, `name`, `team`, `isBot` |
| `robot_select` | 玩家选择 AI 机器人兵种 | `player`, `name`, `robotType` |
| `game_start` | 匹配完成开赛 | `text` 含双方阵容摘要 |
| `sudden_death` | 7 分钟进入加时赛 | — |
| `base_destroyed` | 基地被摧毁 | `team` |
| `game_result` | 对局结算 | `winner`（'A'/'B'/null=平局）, `reason`, `tiebreak` |

### 3.4 S2CChat — 定向聊天消息

**触发**：仅发给单个玩家的系统提示（定向，`dest` = 目标 sessionId）。

**包体**：

```jsonc
{
  "dest": "abc123",
  "seq": 0,
  "data": {
    "type": "hero_locked",     // 'hero_locked' | 'hero_disabled' | 'spectator_joined'
    "hero": "tesla",           // hero_locked / hero_disabled：被拒绝 / 被禁用的英雄
    "fallback": "newton",      // hero_disabled：回退到的默认英雄
    "phase": "playing",        // spectator_joined：当前阶段
    "text": "[系统] ..."
  }
}
```

| type | 触发时机 |
| --- | --- |
| `hero_locked` | 尝试使用未解锁英雄被拒绝加入（随后客户端应更换英雄重连） |
| `hero_disabled` | 尝试使用被禁用英雄（配置 `disabledHeroes`）→ 不拒绝，回退默认英雄并通知 |
| `spectator_joined` | 对局已开始，以旁观者身份加入 |

### 3.5 S2CUpdateAssets — 懒加载资源清单

**触发**：玩家（含旁观者）成功加入时，每个资源条目发送一个包（定向）。

**包体**：

```jsonc
{
  "dest": "abc123",
  "seq": 0,
  "data": { "asset": "newton_idle", "url": "/assets/heros/newton_idle.png" }
}
```

客户端按 `asset` 键缓存资源 URL，首次渲染对应实体时按需加载
（清单见 `src/assets/lazyload/lazyload.json`）。

### 3.6 S2CSelectRobot — 选机器人回执

**触发**：响应 `C2SSelectRobot`（定向）。

**包体**：

```jsonc
// 成功
{ "dest": "abc123", "seq": 0, "data": { "success": true, "robotType": "drone" } }
// 失败
{ "dest": "abc123", "seq": 0, "data": { "success": false, "reason": "invalid_robot_type" | "game_started" } }
```

| reason | 含义 |
| --- | --- |
| `invalid_robot_type` | 兵种 id 非法 |
| `game_started` | 对局已开始，机器人已部署，禁止更换 |

### 3.7 S2CUseItem — 使用道具回执

**触发**：响应 `C2SUseItem`（定向）。

**包体**：

```jsonc
// 成功
{ "dest": "abc123", "seq": 0, "data": { "success": true, "itemId": "bomb" } }
// 失败
{ "dest": "abc123", "seq": 0, "data": { "success": false, "reason": "..." } }
```

| reason | 含义 |
| --- | --- |
| `当前阶段无法使用道具` | 匹配阶段禁止使用道具 |
| `缺少 itemId 参数` | 包体缺 itemId |
| `服务器内部错误` | 处理异常 |
| （无 reason） | `player.useItem` 返回 false：道具不存在 / 数量不足 / 冷却中 |

### 3.8 S2COpenShop — 打开商店回执

**触发**：响应 `C2SOpenShop`（定向）。

**包体**：

```jsonc
// 成功
{
  "dest": "abc123", "seq": 0,
  "data": {
    "success": true,
    "shop": {
      "id": "shop_base_A",       // 商店实体 id
      "team": "A",               // 归属队伍 'A' | 'B'
      "x": 1280, "y": 6400,      // 世界坐标
      "radius": 50,              // 交互半径（像素）
      "refreshTime": 60000       // 刷新周期（毫秒）
    }
  }
}
// 失败
{ "dest": "abc123", "seq": 0, "data": { "success": false, "reason": "no_shop_nearby" | "shop_disabled" } }
```

| reason | 含义 |
| --- | --- |
| `no_shop_nearby` | 不在任何商店交互范围内 |
| `shop_disabled` | 当前阶段禁止商店（匹配中 / 加时赛） |

成功后服务端紧接着推送首份 `S2CShopList`。

### 3.9 S2CShopList — 商品清单

**触发**：打开商店时全量推送；此后「商店换货 / 库存变化 / 玩家金钱变化」时增量推送
（服务端 JSON 指纹比对，内容未变不发送；定向）。

**包体**：

```jsonc
{
  "dest": "abc123", "seq": 0,
  "data": {
    "permanent": [   // 常驻商品（无限库存）
      { "id": "shop_item_potion_health", "name": "治疗药水", "kind": "potion-health",
        "price": 60, "stock": Infinity, "permanent": true }
    ],
    "refresh": [     // 刷新商品（有库存上限，每次刷新重新抽取并补满）
      { "id": "shop_item_trait_lottery", "name": "词条抽奖券", "kind": "trait-lottery",
        "price": 100, "stock": 3, "permanent": false, "nextRefreshAt": 1723104000000 }
    ],
    "money": 120     // 玩家当前金钱
  }
}
```

渲染顺序约定：`permanent` 在前、`refresh` 在后。

### 3.10 S2CCloseShop — 关闭商店回执

**触发**：玩家主动关闭（`C2SCloseShop`）或服务端强制关闭（离开范围 / 死亡 / 阶段禁用）时
（定向）。

**包体**：

```jsonc
{ "dest": "abc123", "seq": 0, "data": { "reason": "manual" } }
```

| reason | 含义 |
| --- | --- |
| `manual` | 玩家主动关闭（C2SCloseShop） |
| `out_of_range` | 玩家离开商店交互范围（被推离等），服务端自动关闭 |
| `dead` | 玩家死亡，服务端自动关闭 |
| `shop_disabled` | 当前阶段禁止商店（如进入加时赛），服务端自动关闭 |

### 3.11 S2CBuyItem — 购买回执

**触发**：响应 `C2SBuyItem`（定向）。

**包体**：

```jsonc
// 成功
{
  "dest": "abc123", "seq": 0,
  "data": {
    "success": true,
    "itemId": "shop_item_potion_health",
    "money": 60,             // 购买后剩余金钱
    "trait": { ... }         // 仅词条抽奖券 / 机器人强化芯片：抽到的词条信息
  }
}
// 失败
{ "dest": "abc123", "seq": 0, "data": { "success": false, "itemId": "...", "reason": "..." } }
```

**`reason` 枚举**（商店实体购买路径）：

| reason | 含义 |
| --- | --- |
| `insufficient_money` | 金钱不足 |
| `out_of_stock` | 刷新商品已售罄 |
| `not_in_shop` | 商品不在本商店目录 |
| `trait_pool_exhausted` | 词条抽奖券：本英雄词条已抽完 |
| `robot_missing` | 机器人强化芯片：AI 机器人不存在或已死亡 |
| `robot_traits_exhausted` | 机器人强化芯片：机器人词条已抽完 |
| `shop_not_open` | 未打开商店会话 |
| `shop_disabled` | 当前阶段禁止购买（加时赛），并自动关闭商店 |
| `no_shop_nearby` | 被推离商店范围，并自动关闭商店 |

旧物品栏商店通道（`Shop.buy`）的失败原因：`当前阶段无法购买道具`、`缺少 itemId 参数`、
`服务器内部错误` 及商品效果校验失败原因。

购买成功后库存 / 金钱变化会触发服务端推送最新 `S2CShopList`。

---

## 4. 典型消息时序

### 4.1 玩家加入（匹配阶段）

```
客户端                     matchserver
  │  join room               │
  │ ── C2SHandshake ────────▶│  英雄解锁校验 / 队伍分配 / 创建 Player
  │ ◀── S2CUpdateAssets ─────│  （每个懒加载资源一个包）
  │ ◀── S2CHandshake ────────│
  │ ◀── C2CChat(player_join)─│  （广播）
  │ ◀── C2CChat(match_progress)─│ （每 5 秒，含剩余秒数）
```

### 4.2 渲染（拉模型，每帧）

```
客户端                     matchserver
  │ ── C2SUpdateRender ────▶│  组装增量条目（新增/变化/删除/漂浮文字）
  │ ◀── S2CRender ──────────│  （首次全量，之后仅增量；每 5 秒周期全量重同步）
```

### 4.3 商店

```
客户端                     matchserver
  │ ── C2SOpenShop ────────▶│  阶段/距离校验
  │ ◀── S2COpenShop ────────│  成功（含商店信息）或失败（reason）
  │ ◀── S2CShopList ────────│  首份清单
  │ ── C2SBuyItem ─────────▶│  库存/金钱校验，扣减
  │ ◀── S2CBuyItem ─────────│  成功（剩余金钱）或失败（reason）
  │ ◀── S2CShopList ────────│  库存/金钱变化后的最新清单
  │ ── C2SCloseShop ───────▶│
  │ ◀── S2CCloseShop ───────│  reason: "manual"
  （离开范围 / 死亡时服务端主动：S2CCloseShop  reason: out_of_range / dead）
```

### 4.4 对局结算

```
客户端                     matchserver
  │ ◀── C2CChat(game_result)─│  winner / reason / tiebreak
  │                         │  停止主循环，结算数据推入 backend，1.5s 后退出进程
```

---

## 5. 附录

### 5.1 英雄 id（`C2SHandshake.data.hero`）

`newton`、`tesla`、`mendel`、`gauss`、`descartes`、`darwin`、`dalton`、`lavoisier`、
`archimedes`、`mendeleev`、`morgan`、`turing`（见 `src/assets/data/heros/index.js` 的
`HERO_IDS`）。

**默认英雄**：`newton`（`DEFAULT_HERO`，免 backend 解锁校验；若 `newton` 被禁用则自动顺延到
第一个可用英雄）。非法英雄名 / 未携带 / 被禁用 → 回退默认英雄。

**禁用英雄**：通过 `data/config.json` 的 `disabledHeroes`（数组）或环境变量 `DISABLED_HEROES`
（逗号分隔，如 `tesla,mendel`）配置。被禁用的英雄不可被玩家选择（回退默认英雄 +
`S2CChat`（`type: "hero_disabled"`）通知），也不可被人机（BotPlayer）随机使用
（`pickRandomHero` 仅从可用英雄池挑选）。若全部英雄被禁用则防御性回退为全量列表。

### 5.2 AI 机器人兵种 id（`C2SSelectRobot.data.robot`）

`engineer`（工程）、`infantry`（步兵）、`hero`（英雄）、`drone`（无人机）、
`sentinel`（哨兵）（见 `src/assets/data/robots/robots.js`）。

### 5.3 商店商品 kind（`S2CShopList` 条目）

`potion-health`（治疗药水）、`potion-speed`（疾速药水）、`scroll-teleport`（回城卷轴）、
`ward-vision`（视野守卫）、`trait-lottery`（词条抽奖券）、`robot-upgrade`（机器人强化芯片）等
（见 `src/assets/data/shop/list.js`）。

### 5.4 道具 id（`C2SUseItem.data.itemId`）

`pill`、`bandage`、`medicalKit`、`bomb`、`fireball`、`landmine`、`fragGrenade`、
`flashBang`、`smokeGrenade`、`poisonDart`、`freezeTrap`、`teleportScroll`、
`speedPotion`、`invisibleCloak`、`shieldStone`、`thornArmor`、`healingTotem`
（见 `src/assets/data/items/items.js`）。

### 5.5 相关源码索引

| 模块 | 文件 |
| --- | --- |
| 中继房间接入 / 握手 | `src/network/index.js`、`src/network/client.js`、`src/network/session.js` |
| C2S 路由（onMessage） | `src/sessions/index.js` |
| 商店独立协议包 | `src/network/shop.js`、`src/game/match/shop/ShopSession.js` |
| 渲染通道 | `src/game/render.js`、`src/game/index.js`（`_buildRenderPacket`） |
| 聊天广播 | `src/game/chat.js`、`src/game/match/manager.js` |
| 漂浮文字 | `src/game/popText.js` |
| 玩家输入处理 | `src/game/match/player/index.js` |
| 匹配 / 阶段 / 结算 | `src/game/match/manager.js` |
| backend 上报（非房间协议） | `src/backend.js` |
