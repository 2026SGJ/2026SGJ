# CHANGELOG

本文档记录本次代码审阅与修复的变更内容，以及审阅中发现但暂未修改的问题（拿不准、交由后续确认）。

## 禁用英雄功能（禁用英雄不可被玩家或人机使用）

### 功能概述

通过服务器配置禁用指定英雄：被禁用的英雄既不可被玩家选择，也不可被人机（BotPlayer）随机使用。

- **玩家**：握手携带被禁用英雄 → 不拒绝加入，自动回退默认英雄并发送定向 `S2CChat`（`type: "hero_disabled"`，携带 `hero` / `fallback`）通知客户端；
- **人机**：`pickRandomHero` 仅从可用英雄池随机挑选，禁用英雄永不出现；
- **默认英雄顺延**：默认英雄正常为 `newton`，若 `newton` 被禁用则自动顺延到第一个可用英雄（`DEFAULT_HERO`），且默认英雄始终免 backend 解锁校验；
- **防御性兑底**：若全部英雄均被禁用，回退为全量英雄列表，保证对局仍可进行。

### 配置方式

- `data/config.json` 的 `disabledHeroes` 数组（如 `["tesla", "mendel"]`）；
- 或环境变量 `DISABLED_HEROES`（逗号分隔，如 `tesla,mendel`）；
- 大小写不敏感，自动小写规范化去空。

### 修改文件

- **`src/config.js`**：新增 `config.disabledHeroes`（`DISABLED_HEROES` 环境变量 / `disabledHeroes` 配置项），新增 `parseList` 解析辅助；默认配置模板补充 `disabledHeroes: []`。
- **`src/assets/data/heros/index.js`**：新增 `DISABLED_HEROES` 集合 / `isHeroDisabled()` / `ENABLED_HERO_IDS`（可用英雄池）/ `DEFAULT_HERO`（默认英雄，自动顺延）；`pickRandomHero()` 改为从可用英雄池挑选。
- **`src/game/index.js`**：玩家加入时新增禁用英雄校验（回退默认 + `hero_disabled` 定向通知）；解锁校验改为对非默认英雄执行（默认英雄免查询）；旁观者幽灵玩家填充英雄改用 `DEFAULT_HERO`。
- **`src/game/match/manager.js`**：人机补位英雄选择注释更新（`pickRandomHero` 已自动排除禁用英雄）。
- **`API.md`**：握手流程 / S2CChat 消息类型表 / 5.1 英雄 id 附录补充禁用英雄说明。

### 回归测试（临时，位于 gitignore 的 data/ 目录）

- `data/_test_disabled_heroes.mjs`：配置解析（环境变量 / config.json / 默认）、`isHeroDisabled`、`ENABLED_HERO_IDS`、`DEFAULT_HERO` 顺延、`pickRandomHero` 5 万次采样无禁用英雄、全禁用回退。运行：`node data/_test_disabled_heroes.mjs`。
- `data/_test_disabled_heroes_join.mjs`：玩家禁用英雄回退加入 + `hero_disabled` 通知 + 默认英雄免 backend 查询 + 人机补位全用可用英雄（11 名禁用，确定性断言）。运行：`DISABLED_HEROES="newton,...,archimedes" node data/_test_disabled_heroes_join.mjs`。

## 区域效果系统（地图分区 640×360 + 进出区块附加/清除效果）

### 功能概述

将整张地图（2560×7200）划分为 640×360 的区块（4 列 × 20 行 = 80 块），每个区块拥有一个区域类型与正面/负面效果：

- 每个区块中心（区块内部坐标 320,180）放置一个 `type:'entity'`、`z-index:-1` 的区域实体，`asset` 为对应区域资产 id，客户端据此绘制区域底色/贴图；区块按地图尺寸精确平铺、无缝隙、无重叠（无缝衔接）；
- 玩家 / 人机（BotPlayer）/ AI 机器人（RobotEntity）进入区块时获得对应效果，离开区块时立即清除（按区块边界精确切换）；
- 玩家当前被附加的效果经 `S2CRender` 的 `remoteData().state.areas` 推送客户端渲染展示，离开区块自动清空。

### 新增文件

- **`src/assets/enum/areas/names.js` / `index.js`**：区域 asset 枚举（`AREA_SAFE` / `AREA_REGEN` / `AREA_HASTE` / `AREA_SLOW` / `AREA_POISON` / `AREA_MIGHT` / `AREA_RIFT` / `AREA_BASE_A` / `AREA_BASE_B`）。
- **`src/assets/data/areas/index.js`**：区域数据 —— `AREA_BLOCK_W/H`（640×360）、`AREA_GRID`（20 行 × 4 列网格，围绕中轴上下对称：基地庇护 → 生命之泉 → 泥沼/疾风带 → 安全区 → 剧毒沼泽 → 力量回廊 → 混沌裂隙（中轴）→ …镜像）、`AREA_CONFIG`（每区域 `asset / name / description / kind / effects`）。效果字段：`speed`（移速倍率 %）、`damage`（伤害倍率 %）、`heal`（每秒回血）、`dot`（每秒掉血）。
- **`src/game/match/area/AreaManager.js`**：区域管理器：
  - `init()`：按地图尺寸生成全部区块实体（静态渲染实体，`_isStatic` + 指纹预缓存，首次全量推送后不占带宽），实体 `data` 附带 `areaId / areaName` 供客户端识别；
  - `tick(players, robotManager)`：玩家 / 人机 / 机器人统一每 tick 结算 —— 坐标 → 区块索引（`Math.floor` 精确贴合，每点唯一映射一个区块），区块变化时先清除旧效果再附加新效果；
  - 持续效果（回血 / 中毒）每 tick 结算，匹配阶段中毒不致死（避免大厅反复阵亡）；
  - 伤害倍率挂在 `takeDamage` 的「攻击者侧」（`attacker._areaDmgMult`），普攻 / 技能 / 道具 / 机器人攻击 / 自爆全部伤害路径自动生效。
- **`scripts/test_areas.js`**：区域系统回归测试（43 项断言）。运行：`node scripts/test_areas.js`。

### 修改文件

- **`src/game/match/player/index.js`**：
  - 新增区域状态字段 `_areaIndex / _currentAreas / _areaSpeedMult / _areaDmgMult`；
  - `move()` 速度倍率追加 `× _areaSpeedMult`；`takeDamage()` 攻击者侧追加区域伤害倍率；
  - `remoteData().state.areas` 推送当前生效区域（id / name / description / asset / kind / effects）。
- **`src/game/match/robot/RobotEntity.js`**：同样新增区域状态字段；`_move()` 追加区域移速倍率；`takeDamage()` 追加攻击者区域伤害倍率；`_strike()` 拆基地伤害追加区域倍率。
- **`src/game/mainloop.js`**：`matchLoop` 增加 areaManager 参数，玩家与机器人 tick 之后调用 `areaManager.tick`（保证使用最新坐标）。
- **`src/game/index.js`**：创建 `AreaManager`，World 创建完成后 `init()` 生成区块实体，主循环透传。
- **`src/assets/assets.js`**：注册 `areas` 资产映射（`assets.areas.assets / names`）。

### 客户端协议说明

- 区域区块：世界静态实体（`type:'update'`），asset 为 `area_*`，`z-index:-1`，`width/height` = 640×360，`areaId / areaName` 供识别；首次全量推送后不再发送（区块永不变化）；
- 玩家当前效果：`remoteData().state.areas`（数组）—— `[{ id, name, description, asset, kind, effects: { speed?, damage?, heal?, dot? } }]`；进入区块时推送，离开区块时清空为空数组，客户端可据此展示/隐藏区域效果图标；
- 效果仅作用于区块内的单位：`speed/damage` 为倍率（离开重置为 1），`heal/dot` 为每 tick 结算；安全区无效果（不进入 areas 列表）。

## --no-wait 测试模式（首个玩家进入即满员开赛）

- **`src/index.js`**：解析命令行参数 `--no-wait`，透传给 Game（启动时打印启用日志）。
- **`src/game/index.js`**：`Game` 构造函数接收 `options`，将 `noWait` 透传给 `MatchManager`。
- **`src/game/match/manager.js`**：
  - 构造函数新增 `options.noWait` 开关；
  - `onHumanJoined` 新增分支：`--no-wait` 模式下首个真人进入匹配时，跳过 120 秒倒计时，立即 `ensureTotalPlayers(8)` 瞬间补齐 7 个人机（4v4 满员）并直接 `_startGame()` 开赛；
  - 后续真人加入时对局已开始，按既有逻辑自动转为旁观者，不重复触发。
- **`package.json`**：新增 `start:nowait` 脚本（`node src/index.js --no-wait`）。

## AI 机器人系统（AI 机器人 ≠ 人机补位）

### 核心定位（desc.txt 第二节）

- **AI 机器人**：工程 / 步兵 / 英雄 / 无人机 / 哨兵 5 类兵种，绝对服从、自动采集资源＆攻击＆侦查；每名玩家进局前 5 选 1，除哨兵跟随玩家行动外其余自主移动；血量归零宕机或自爆，死亡后无法复活。
- **机器人 ≠ 玩家**：机器人不进入 `players` 集合，不作为玩家对待 —— 不参与匹配人数 / 复活 / 占领 / 队伍统计 / 胜负结算；与「人机补位（BotPlayer，继承 Player 被视为玩家）」严格区分。

### 新增文件

- **`src/assets/data/robots/robots.js`**：5 类兵种配置（数值按 desc ×1.4 血量 / ÷40 移速换算，与英雄一致）：
  - `engineer` 工程机器人：1400 血 / 6.25 速 / 50 伤 / 5s 自卫射速 / 角色 `miner`；
  - `infantry` 步兵机器人：1120 血 / 8.75 速 / 80 伤 / 500ms（2 发/秒）；
  - `hero` 英雄机器人：840 血 / 4.5 速 / 300 伤 / 2000ms（0.5 发/秒，超长真空期）；
  - `drone` 无人机：1120 血 / 7.5 速 / 75 伤 / 250ms（4 发/秒），`structure: true` 专精拆塔；
  - `sentinel` 哨兵机器人：1260 血 / 7.5 速 / 120 伤 / 667ms（1.5 发/秒），角色 `escort` 跟随玩家。
- **`src/assets/data/robots/traits.js`**：机器人词条（AI 养成）——黄金矿工 / 强化装甲 / 火力升级 / 急速核心 / 爆破装置，`applyRobotTrait` / `drawRobotTrait`（自动排除已拥有）。
- **`src/game/match/robot/RobotEntity.js`**：机器人实体（继承 Entity 渲染体系）：
  - 行为按角色分派：`miner` 采矿 > 被攻击自卫 > 基地巡逻；`combat` 攻击敌人 > 拆塔（无人机优先敌方前哨站，约 28 秒拆完 200 进度）> 顺路采矿 > 中轴侦查巡逻；`escort` 跟随玩家（保持期望距离）> 攻击玩家 / 自身附近敌人；
  - 采矿收益归 owner（采集速度 / 收益受词条倍率影响）；
  - 死亡：50% 宕机 / 50% 自爆（周围 180px 敌人受 250 伤害）。**宕机可复活**：残骸保留在场，owner 靠近（150px 内）且经济 ≥ 100 时扣除 100 经济并开始 10 秒修复，完成后原地满血重启（`downed` / `downType` / `reviveUntil` 字段，复活时长可配置）；**自爆无法复活**（直接移除）；
  - `getRenderData` 附带 state（team / ownerId / robotType / hp / downed / reviveRemaining / traits）供客户端渲染血条、残骸与词条。
- **`src/game/match/robot/RobotManager.js`**：机器人管理器 —— `spawnFor / spawnAll / tick / remove / removeRobotFor / stopAll`，机器人 id 约定 `robot_${ownerSessionId}`，作为世界实体（`world.entities`）渲染与行动。

### 修改文件

- **`src/game/match/world.js`**：新增 `addRobot / removeRobot`（仅渲染列表；逻辑由 RobotManager 驱动）；地图加载加 try/catch 防御（缺失 / 损坏时退回空地图并报错日志）。
- **`src/game/match/player/index.js`**：
  - `findTarget / findTargetsInRange` 增加敌方 AI 机器人目标（普攻 / 技能 AOE 均可命中机器人）；
  - `processBasicAttack / processSkillCast / processSkills / tick` 透传机器人管理器；
  - 新增 `robotType` 字段与 `remoteData.robotType / robotId`（客户端展示 / 关联机器人）。
- **`src/game/mainloop.js`**：`matchLoop` 增加 robotManager 参数，玩家 tick 后驱动机器人 tick。
- **`src/game/index.js`**：
  - 握手数据 `data.robot` → 玩家机器人兵种（进局前 5 选 1，未选 / 非法则随机）；
  - `C2SSelectRobot` 消息路由（仅匹配阶段可选，回执 `S2CSelectRobot`）；
  - 玩家移除 / 人机被踢 → 清理其机器人；商店购买透传机器人管理器上下文。
- **`src/game/match/manager.js`**：`_startGame` → `spawnAll` 为全体玩家部署机器人；对局中补位人机立即部署；结算 → `stopAll`。
- **`src/game/match/entity/outpost.js`**：`drainByRobot` —— 机器人拆塔扣除敌方前哨站占领进度，归零恢复中立。
- **`src/game/match/skills/skill.js`**：`onUse` 的 debuff 仅对玩家目标施加（机器人无 Buff 系统）。
- **`src/game/match/trait/TraitManager.js`**：`targetDebuff` 效果仅对玩家目标施加（避免对机器人调 `giveBuff` 崩溃）。
- **`src/sessions/index.js`**：新增 `C2SSelectRobot` 路由。
- **`src/assets/enum/entities/names.js`**：新增 5 类机器人 asset id（`robot_engineer` 等）。

### 商店：机器人强化芯片（AI 养成）

- **`src/assets/data/shop/list.js`** 新增刷新商品「机器人强化芯片」（`shop_item_robot_chip`，kind=`robot-upgrade`，价格 120，库存 2）。
- **`src/game/match/entity/shop.js`**：`buy / _applyEffect` 增加 context 透传；`robot-upgrade` 效果 —— 随机为其机器人授予一个未拥有的机器人词条（如黄金矿工）；机器人不存在 / 词条抽完时拒绝购买（避免白花钱）。
- **`src/game/match/shop/ShopSession.js`**：`buy(itemId, context)` 透传。
- **`src/assets/enum/shop/items.js`** 新增 `ROBOT_CHIP`。

### 新增回归测试

- `scripts/test_robots.js`：兵种数据 / 部署 / 采矿收益归属 / 机器人互战 / 哨兵跟随 / 玩家攻击机器人 / 宕机与自爆 / 词条去重与效果 / 拆前哨站 / 不被当作玩家（击杀不计入玩家统计），共 62 项断言。运行：`node scripts/test_robots.js`。
- `scripts/test_robots_e2e.js`：完整 Game 循环（mock 网络层）——握手选兵种 → 倒计时归零补满 8 人并部署 8 个机器人 → 真实主循环运行（工程机器人采矿归 owner、无人机自主移动）→ 玩家移除清理 → 结算停止，共 18 项断言。运行：`node scripts/test_robots_e2e.js`。

### 客户端协议说明

- 进局前选择：握手数据携带 `robot` 字段（`engineer / infantry / hero / drone / sentinel`），或匹配阶段发送 `C2SSelectRobot { robot }`，回执 `S2CSelectRobot { success, robotType }`；
- 机器人渲染：世界实体（`type:'update'`），asset 为 `robot_*`，state 含 `team / ownerId / robotType / hp / maxHp / dead / downed / reviveRemaining / traits`；宕机残骸 `downed: true`（`dead: true`），复活中 `reviveRemaining` 为剩余毫秒（客户端可绘制修复进度）；
- 玩家渲染状态新增 `robotType / robotId`（关联归属）；
- 机器人死亡经 `{ type:'delete', id }` 删除包通知客户端释放缓存。

## 英雄扩展至 12 名 + 词条（Perk）系统 + 商店词条抽奖

### 英雄数据（`src/assets/data/heros/`）

- **新增 11 名英雄数据文件**（特斯拉 / 孟德尔 / 高斯 / 笛卡尔 / 道尔顿 / 门捷列夫 / 摩尔根 / 拉瓦锡 / 达尔文 / 阿基米德 / 图灵），与既有牛顿共用同一声明式技能 schema（`attacks.basic` + `skill1~4`，每技能含 damage / knockback / cd / cost / forward / buff / debuff / magic）。
- desc.txt 中的血量按 ×1.4、移速按 ÷40 换算成引擎单位（与牛顿 850→1200 / 290→7.25 一致）。
- **`src/assets/data/heros/index.js`** 注册全部 12 名英雄，并新增导出 `HERO_IDS` / `pickRandomHero`（人机随机选英雄）。
- **`src/assets/enum/heros/names.js`** 补齐剩余 6 名英雄（门捷列夫 / 摩尔根 / 拉瓦锡 / 达尔文 / 阿基米德 / 图灵）。
- 引擎暂未建模的机制（召唤物 / 地形 / 过载值 / 状态标记等）保留在 description 中，数值落到最接近的引擎效果上。

### 词条（Perk）系统

- **新增 `src/assets/data/traits/`**：12 名英雄共 75 个专属词条（蓝 / 紫 / 金三级，描述与 desc.txt 一致），每词条带结构化 `effects` 声明。
- **新增 `src/game/match/trait/TraitManager.js`**：每玩家（含人机）独立词条管理器：
  - `draw()` 按稀有度权重（蓝 55 / 紫 30 / 金 15）从本英雄词条库抽取，自动排除已拥有词条；
  - `grant()` 解释执行 effects：技能数值修改（`modifySkill` / `modifyDebuff` / `modifyBuff` / `modifyMagic`）、被动属性（`stat`：移速 / 血量 / 全局冷却 / 暴击 / 射程 / 减伤 / 控制缩减 / 概率减伤）、事件钩子（`onBasicHit` / `onSkillUse`：护盾 / 回血 / 金币 / 冷却重置 / 目标附加减益 / 额外伤害 / 低血秒杀 / 额外抽词条）。
- **`src/game/match/player/index.js`**：
  - 英雄配置改为**按玩家深拷贝**（`structuredClone`），词条修改技能数值不再污染其他同英雄玩家（顺带修复 CHANGELOG #9 的共享配置问题）；
  - 普攻命中 / 技能释放触发 `trait:basicHit` / `trait:skillUsed` 事件供词条钩子消费；
  - `takeDamage` 增加词条暴击（`_critChance` / `_critDamage`）与概率减伤（`_traitDmgReductions`）；`giveBuff` 对 stun/freeze 应用控制缩减（`_ccReduction`）；`findTarget` 使用可扩展的 `attackRange`（默认 75px）；
  - `remoteData` 新增 `traits` 字段（id / name / rarity）供客户端展示。

### 商店词条抽奖（刷新商品）

- **`src/assets/data/shop/list.js`** 新增刷新商品「词条抽奖券」（`shop_item_trait_lottery`，kind=`trait-lottery`，价格 150，库存 1）。
- **`src/game/match/entity/shop.js`**：
  - `_rollRefresh`：每次刷新 40% 概率上架词条抽奖券（库存 1）；未命中则本次不上架（从候选池移除，避免被普通随机槽位二次抽中）；
  - `buy`：词条抽完时返回 `trait_pool_exhausted` 拒绝购买（避免白花钱），购买结果附带抽到的词条信息；
  - `_applyEffect`：新增 `trait-lottery` 分支——购买后 `traitManager.draw() + grant()`。
- **`src/game/match/shop/ShopSession.js`**：`S2CBuyItem` 回执在购买词条抽奖券时附带 `trait` 字段。
- **`src/assets/enum/shop/items.js`** 新增 `TRAIT_LOTTERY`。
- **`src/game/match/bot/BotController.js`**：人机在商店停留时周期性抽词条（AI 也能获得词条，对应 desc 设定）。
- **`src/game/match/manager.js`**：人机随机选择英雄（不再固定牛顿）。

### 新增回归测试

- `scripts/test_traits.js`：英雄 schema / 词条完整性 / TraitManager 抽取去重与权重 / grant 效果执行 / 事件钩子 / 商店抽奖券 40% 上架率，共 364 项断言。运行：`node scripts/test_traits.js`。

## 商店与渲染管线分离（独立协议包）

### 变更概述

商店界面不再通过 S2CRender 的 isFixed GUI 实体（ShopGui）渲染，改为独立协议包通信，渲染管线中所有商店专用代码（isFixed GUI 实体机制）一并移除：

- **新增 `src/network/shop.js`**：商店独立协议封装（`S2COpenShop` / `S2CShopList` / `S2CCloseShop` / `S2CBuyItem` 发送函数）。
- **新增 `src/game/match/shop/ShopSession.js`**：每玩家商店会话状态机，取代 ShopGui：
  - `open()` → `S2COpenShop`（成功含商店信息）+ `S2CShopList`（初始清单）
  - `close(reason)` → `S2CCloseShop`（manual / out_of_range / dead / shop_disabled）
  - `buy(itemId)` → `S2CBuyItem`（成功 / 失败原因），随后推送最新清单
  - `tick()` → 商店换货 / 库存 / 金钱变化时自动推送最新 `S2CShopList`（JSON 指纹去重）
- **`src/sessions/index.js`**：新增 `C2SOpenShop` / `C2SCloseShop` 消息路由。
- **`src/game/index.js`**：
  - `_syncShopGui` / `_openShopGui` / `_closeShopGui` / `_buyFeedback` 替换为协议驱动的 `_syncShopState` / `_handleOpenShopRequest` / `_handleCloseShopRequest` / `_handleShopBuy`；
  - `C2SBuyItem` 路由：商店会话打开且商品属于该商店目录 → 商店实体购买；否则保留物品栏商店旧通道（人机 / 直接请求）；
  - 渲染增量同步移除 isFixed GUI 相关字段与步骤（seenGui / seenGuiIds / pendingGuiRemovals 及 `_buildRenderPacket` 第 4、5 步、`_refreshRenderFingerprints` GUI 指纹）。
- **`src/game/match/player/index.js`**：
  - 移除服务端 E 键商店开关切换、`_pendingShopClick` / `_pendingShopBuySelected` / `processGuiClick` / `_gui` 引用；打开 / 关闭 / 购买改为客户端经独立协议包驱动；
  - 保留 `isShopOpen` / `_openShop` 用于游戏逻辑（商店打开时禁止移动/攻击/采矿）；
  - `shopJustOpened` 保留供 BotController 行为树使用。
- **删除文件**：`src/game/match/gui/shopGui.js`、`src/game/match/entity/gui.js`。
- **协议一览**（见 `src/network/shop.js` 头注释）：
  - `C2SOpenShop`（客户端 → 服务端）请求打开商店
  - `S2COpenShop`（服务端 → 客户端）打开结果（成功含商店信息 / 失败原因）
  - `S2CShopList`（服务端 → 客户端）商品清单（常驻 + 刷新 + 玩家金钱）
  - `C2SCloseShop`（客户端 → 服务端）请求关闭商店
  - `S2CCloseShop`（服务端 → 客户端）关闭结果（手动 / 离开范围 / 死亡 / 阶段禁用）
  - `C2SBuyItem`（客户端 → 服务端）购买请求（已有通道，复用）
  - `S2CBuyItem`（服务端 → 客户端）购买结果（成功 / 失败原因）

### 顺带修复：商店换货从未执行

`Shop.tick()`（到点重新随机抽取刷新商品并补满库存，刷新周期 60s）此前没有任何调用方，导致刷新商品列表永不换货。已在 `World.tick()` 中补上对 `this.shops` 的逐商店 `shop.tick()` 调用（商店刷新列表变化会经 ShopSession 指纹比对推送最新 `S2CShopList`）。

### 新增回归测试

- `scripts/test_shop_session.js`：通过 ESM loader（`module.register` + data: URL stub）隔离网络层，验证 ShopSession 的打开 / 购买 / 失败 / 关闭 / 换货推送 / 指纹去重 / dispose 幂等，共 28 项断言。运行：`node scripts/test_shop_session.js`。

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

### 10. 多人同时挖同一矿物，只有一人能拿到（其余人白等）— `src/game/match/entity/mineral.js` / `src/game/match/player/index.js` / `src/game/match/bot/BotController.js`

- **问题**：矿物没有“开采权”概念。真人与多个 Bot 可以同时站在同一矿物上开采（各攒各的进度），但矿物只能被采集一次——进度最快者拿到奖励后其他人进度清零白等，造成多人挤同一矿、经济效率低且行为怪异（日志中反复出现多个 Bot 同一时刻在挖同一个矿）。
- **修复**：给矿物增加开采锁定（`miner` 字段 + `claim/release`）：
  - 玩家首次进入开采（`processMining` 开始累加）时声明锁定，先到先得；
  - 已被他人锁定的矿物在 `updateMiningProximity` / Bot `_perceive` 中被跳过，其他玩家/Bot 自动改选其他矿物；
  - 停止开采（E 松开）、切换目标、死亡时释放锁定，矿物不会永远被占用；
  - Bot 的目标记忆在矿物被他人锁定/采完后失效，会重新从感知中挑选下一个可采矿物（避免原地空转）。

### 11. Bot 满血且钱包货币 ≤ 30 时应主动出击而不是采矿 — `src/game/match/bot/BotController.js`

- **问题**：Bot 行为树中采矿分支优先级低于战斗分支，但战斗分支要求敌人在 250px 探测范围内；钱包穷、满血的 Bot 若无敌人在附近会一直采矿/游荡，缺乏攻击性。
- **修复**：新增“主动出击”判定（满血且 `money ≤ 30`）：
  - `_condEngage` 在该状态下无视探测距离直接锁定最近敌人（战斗中分支优先级高于采矿，自然覆盖挖矿）；
  - `_actChase` 在该状态下不再因目标超过 375px 而放弃追击；
  - 一旦 Bot 掉血（不满血）或钱包超 30，恢复正常的行为树优先级（探测范围 + 血量健康要求）。

## 未修改的问题（存疑，供确认）

以下问题在审阅中发现，但涉及设计权衡或需要更多上下文，**未改动**，仅在此记录：

1. **A* 寻路父节点记录非最优**（`src/utils/astar.js` `findPath`）：`parentKey` 在节点“首次被发现”时记录，而非“最优 g 值”时更新。配合 admissible 启发式，最终路径仍有效，但个别情况下可能非最短。影响小，未改。

2. **墙体碰撞无“推出”逻辑**（`src/game/match/player/index.js` `move`）：玩家若被击退嵌入墙体，被卡住的轴向上速度会被清零而无法脱出（简单物理的常见取舍），未改。

3. **删除包有效期仅 ~5 tick（250ms）**（`src/game/match/world.js` `refreshRenderTicks` + `src/game/index.js` `_buildRenderPacket`）：`_pendingRemovals` 只保留 5 个渲染 tick，若某客户端在此期间没有发起渲染请求（网络抖动/卡帧），会错过该实体的 `{type:'delete'}` 包；而周期全量重同步不清空 `seenIds / seenPlayers`，该实体（或已离场玩家）将一直残留在该客户端。这是代码注释中的既有设计（避免全量重推玩家），但 250ms 窗口对真实网络可能偏紧，建议后续评估是否在重同步时也重发一次删除或扩大保留窗口。

4. **`world.tick` 依赖函数形参个数分发**（`src/game/match/world.js`）：用 `entity.tick.length`（≥3 / ==2 / 其余）区分投射物 / 放置物 / 爆炸实体。当前所有道具实体的参数个数与之匹配，但新增道具时极易踩坑，建议改为显式类型标记。

5. **商店永久加速仍修改共享 hero 配置**（`src/game/match/entity/shop.js` `_applyEffect` `speed` 分支的 else 分支）：当前商品表中没有永久加速道具，故未触碰；若未来加入，需要为玩家增加 per-player 基础速度字段。

6. **`BotController._condAtMineral` / `_actMine` 依赖行为树记忆**：矿物被其他玩家采走后 bot 的目标清理依赖 `collected` 检查与重感知，逻辑上闭环但日志/时序上偶有“目标丢失”抖动，属行为质量而非崩溃，未改。
