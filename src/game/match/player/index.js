import HERODATAS from '../../../assets/data/heros/index.js';
import Vec2 from '../../../utils/vec2.js';
import { collisionLeft, collisionRight, collisionTop, collisionBottom } from '../../../utils/collision.js';
import Skill from '../skills/skill.js';
import getBuffClassById from '../buff/index.js';
import Inventory from '../item/inventory.js';
import { ITEM_CONFIG } from '../item/itemConfig.js';
import BombEntity from '../item/bomb.js';
import FireballEntity from '../item/fireball.js';
import LandmineEntity from '../item/landmine.js';
import FragGrenadeEntity from '../item/fragGrenade.js';
import FlashBangEntity from '../item/flashBang.js';
import SmokeGrenadeEntity from '../item/smokeGrenade.js';
import PoisonDartEntity from '../item/poisonDart.js';
import FreezeTrapEntity from '../item/freezeTrap.js';
import HealingTotemEntity from '../item/healingTotem.js';
import { pushPopText } from '../../popText.js';
import { pushChat } from '../../chat.js';

/** 夹取到 [-1, 1]（非有限数值返回 0） */
const clamp1 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
};
/** 夹取到 [0, 1]（非有限数值返回 0） */
const clamp01 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};

/**
 * Player — 玩家实体
 * 
 * 负责处理输入、移动、技能、开采矿物等全部玩家逻辑。
 * 
 * 按键映射（PC 键盘）：
 *   WASD    — 移动
 *   R       — 普攻（basic attack）
 *   F       — 释放当前选中的技能
 *   C       — 切换选中技能（循环 skill1 ~ skill4）
 *   E       — 靠近商店时打开商店（优先级最高）；否则靠近矿物时开采
 * 
 * 三端操作支持：
 *   - 键盘：C2SKeyboardEvent（KeyHolding / KeyDown / KeyUp）
 *   - 手柄：C2SGamepad / C2SGamepadEvent（左右双摇杆 + 扳机 + ABXY，见 processGamepadInput）
 *   - 触屏：C2STouch / C2STouchEvent（虚拟摇杆/虚拟按键 → 虚拟数据；否则点击坐标，见 processTouchInput）
 *   三端共用一套按键状态（effectiveKeys = 键盘 heldKeys ∪ 手柄 _gamepadKeys ∪ 触屏 _touchKeys），
 *   可同时混用；右摇杆 / 瞄准摇杆 / 世界坐标点击提供瞄准方向（aimDir），影响道具发射方向。
 * 
 * 商店交互（重构后 — 独立协议包，与渲染管线解耦）：
 * 1. 每 tick 检查是否靠近商店实体（50px），设置 canShop / shopTarget（供客户端提示）
 * 2. 商店的打开 / 关闭 / 购买由客户端通过专用数据包驱动：
 *      - C2SOpenShop  （E 键按下）→ 服务端校验后回 S2COpenShop + S2CShopList
 *      - C2SCloseShop  （E 键 / 关闭按钮）→ 服务端回 S2CCloseShop
 *      - C2SBuyItem    （点击商品 / 手柄 A）→ 服务端回 S2CBuyItem
 * 3. 商店打开期间服务端禁止移动 / 攻击 / 采矿（isShopOpen 锁定）
 * 4. 离开商店范围 / 死亡时服务端自动关闭并推送 S2CCloseShop
 * 5. 服务端不再渲染任何商店界面（见 ShopSession / src/network/shop.js）
 * 
 * 开采机制：
 * 1. 每 tick 检查是否靠近矿物（30px），若靠近则设置 canMine 标志
 * 2. 玩家长按 E 键时，miningTime 逐帧累加
 * 3. miningTime 达到矿物配置的 miningTime 后，采集成功，获得金钱
 * 4. 松开 E 键则开采被打断，miningTime 清零
 * 5. 开采期间玩家不可移动
 */
class Player {
    static TICK_MS = 1000 / 20; // 每 tick 的毫秒数（20 ticks/s）

    constructor(sessionId, data) {
        this.sessionId = sessionId;
        /** @type {string} 玩家显示名（真人来自握手数据 name，人机在 addBot 时指定） */
        this.name = data.name || '';
        /** @type {'A'|'B'} 玩家所属队伍 */
        this.team = data.team || 'A';
        // 队伍 A 出生点：底部基地 (1280, 6840)
        // 队伍 B 出生点：顶部基地 (1280, 360)
        this.x = this.team === 'A' ? 1280 : 1280;
        this.y = this.team === 'A' ? 6840 : 360;
        this.dir = 90; // 和移动无关，仅决定渲染方向
        this.speed = new Vec2(0, 0);
        this.knockback = new Vec2(0, 0);
        this.dx = 0;
        this.dy = 0;
        this.hitbox = {
            type: 'rect',
            x: this.x - 25,
            y: this.y - 25,
            width: 50,
            height: 50
        };
        this.hero = data.hero || 'newton';
        this.costume = 'empty';
        this.runAnimate = 0;
        this.attackForward = 0;
        this.attacking = false;

        // ---------- 多技能系统 ----------
        /** @type {number} 当前选中的技能索引：1=skill1, 2=skill2, 3=skill3, 4=skill4 */
        this.selectedSkill = 1;
        /** @type {boolean} 是否正在释放技能（带前摇） */
        this.usingSkill = false;
        /** @type {number} 技能释放剩余前摇时间（毫秒） */
        this.skillCastForward = 0;
        /** @type {Object<number, number>} 技能冷却结束时间戳 map: skillIndex → cooldownEndTimestamp */
        this.skillCooldowns = {};
        // ---------- 多技能系统 ----------

        // ---------- 矿物开采相关 ----------
        /** @type {boolean} 当前 tick 是否按下 E 键且附近有矿物 */
        this.mining = false;
        /** @type {number} 持续开采的累计时间（毫秒） */
        this.miningTime = 0;
        /** @type {boolean} 玩家附近是否存在可开采矿物 */
        this.canMine = false;
        /** @type {import('../entity/mineral.js').default|null} 当前最近的开采目标 */
        this.miningTarget = null;
        /** @type {number} 玩家经济（金钱） */
        this.money = 0;
        // ---------- 矿物开采相关 ----------

        // ---------- 商店交互相关 ----------
        /** @type {boolean} 玩家附近是否存在可交互的商店实体 */
        this.canShop = false;
        /**
         * @type {boolean} 商店刚打开标记（BotController 使用，仅供行为树状态；
         * 真人玩家的打开 / 关闭由 C2SOpenShop / C2SCloseShop 独立协议包驱动）
         */
        this.shopJustOpened = false;
        /** @type {boolean} 玩家是否正在浏览商店（打开商店后禁止移动，类似开采状态） */
        this.isShopOpen = false;
        /** @type {import('../entity/entity.js').default|null} 当前最近的商店实体 */
        this.shopTarget = null;
        // ---------- 商店交互相关 ----------

        // ---------- 前哨站重生点相关 ----------
        /**
         * 玩家自定义重生点（绑定到某个已被己方占领的前哨站）
         * 当玩家在己方前哨站 25px 内按 E 时设置
         * @type {import('../entity/outpost.js').default|null}
         */
        this.customSpawnOutpost = null;
        /** @type {boolean} 当前 tick 玩家附近是否有可设置重生点的前哨站 */
        this.canSetSpawn = false;
        /** @type {import('../entity/outpost.js').default|null} 最近的可设置重生点的前哨站 */
        this.spawnOutpostTarget = null;
        // ---------- 前哨站重生点相关 ----------

        // ---------- 商店会话（独立协议包，与渲染管线解耦）----------
        /** @type {import('../entity/shop.js').default|null} 当前打开的商店实体 */
        this._openShop = null;
        /** @type {import('../shop/ShopSession.js').default|null} 当前打开的商店会话（null = 未打开） */
        this._shopSession = null;
        // ---------- 商店会话 ----------

        this.animateState = 'idle';
        this.eventHandlers = {};
        this.eventQueue = [];

        /** @type {string[]} 当前帧已按下的按键列表（'KeyW', 'KeyA', ...）—— 键盘输入专用 */
        this.heldKeys = [];
        /** @type {string[]} 三端合并后的有效按键列表（键盘 + 手柄 + 触屏），由 mergeInputKeys 生成，供 processKeyholding 消费 */
        this.effectiveKeys = [];
        /** @type {string[]} 上一帧的按键列表，用于检测按键增量（KeyC 切换技能等单次触发操作） */
        this.prevHeldKeys = [];

        this.args = HERODATAS[this.hero] || (() => { throw new Error(`Hero data not found for hero: ${this.hero}`); })();
        this.health = this.args.health;
        this.maxHealth = this.args.health;
        this.buffs = [];

        // ---------- 对局状态（由 MatchManager 管理） ----------
        /** @type {boolean} 玩家是否已死亡且无法复活（基地被毁 / 7 分钟加时赛） */
        this.dead = false;
        /** @type {boolean} 当前是否允许复活（MatchManager 每 tick 更新） */
        this.canRevive = true;
        /** @type {boolean} 当前是否允许行动（匹配阶段 false：仅可移动，禁止攻击/采矿/技能/道具） */
        this.canAct = true;
        /** @type {number} 累计击杀数（供队伍结算“总击杀数”比较） */
        this.kills = 0;
        // ---------- 对局状态 ----------

        // ---------- 物品栏系统 ----------
        /** @type {Inventory} 玩家物品栏实例 */
        this.inventory = new Inventory(sessionId);
        // ---------- 物品栏系统 ----------

        // ---------- Buff/Debuff 状态标志 ----------
        /** @type {boolean} 是否被眩晕（无法移动和攻击） */
        this.stunned = false;
        /** @type {number} 当前护盾值（吸收伤害） */
        this.shield = 0;
        /** @type {number} 移动速度倍率（1.0 = 正常速度，由 SpeedBuff 设置） */
        this.speedMultiplier = 1.0;
        /** @type {number} 被减速的比例（由烟雾弹等设置，0 = 无减速，0.4 = 减速 40%） */
        this.slowAmount = 0;
        /** @type {boolean} 是否隐形（客户端据此隐藏模型） */
        this.invisible = false;
        /** @type {number} 伤害减免比例（0~1，由 InvisibleBuff 设置） */
        this.damageReduction = 0;
        /** @type {boolean} 是否被禁止攻击（隐形时） */
        this.cantAttack = false;
        // ---------- Buff/Debuff 状态标志 ----------

        // ---------- 伤害漂浮文字（并入 S2CRender）----------
        /**
         * 每名攻击者的上次伤害漂浮文字发送时间戳
         * 用于节流：同一攻击者对同一目标的最短弹字间隔（避免 DoT 刷屏）
         * @type {Object<string, number>} attackerSessionId → timestamp
         */
        this._popTextLastSent = {};
        // ---------- 伤害漂浮文字（并入 S2CRender）----------

        /** @type {Vec2} 上一次移动方向（用于道具发射方向） */
        this.lastMoveDir = new Vec2(this.dir > 0 ? 1 : -1, 0);

        // ---------- 技能实例 ----------
        this.skills = {
            basic: new Skill(
                this.args.attacks.basic.name,
                this.args.attacks.basic.description,
                this.args.attacks.basic.damage,
                this.args.attacks.basic.knockback || 0,
                this.args.attacks.basic.forward || 0,
                null, null, null
            ),
        };
        for (let i = 1; i <= 4; i++) {
            const key = `skill${i}`;
            if (this.args.attacks[key]) {
                this.skills[key] = Skill.fromHeroData(this.args.attacks[key]);
            }
        }
        // ---------- 技能实例 ----------

        // ---------- Buff 叠加属性 ----------
        this._strengthMultiplier = 1.0;   // 伤害倍率（被 StrengthBuff 修改）
        this._reboundPercent = 0;         // 反弹比例（被 ReboundBuff 修改）
        // ---------- Buff 叠加属性 ----------

        // ---------- 渲染增量同步（带宽优化） ----------
        /**
         * 最近一次渲染数据的 JSON 指纹（由 Game 主循环每 tick 刷新比对），
         * 用于判断本玩家渲染数据是否发生变化：静止 / 无冷却的玩家不变化，
         * 可跳过发送（客户端缺失该玩家时沿用上一帧）。
         * @type {string|null}
         */
        this._renderFingerprint = null;
        /**
         * 渲染数据最后变化的全局渲染 tick（world.renderTick），
         * 渲染组装时与各客户端上次发送 tick 比较，决定是否需要发送。
         * @type {number}
         */
        this._lastChangeTick = 0;
        /**
         * 最近一次构建的渲染数据对象（remoteData() 结果，组装时复用），
         * 避免同一 tick 内多个客户端请求时重复构建。
         * @type {Object|null}
         */
        this._lastRenderData = null;
        // ---------- 渲染增量同步 ----------

        // ---------- 三端操作支持（键盘 / 手柄 / 触屏） ----------
        /**
         * 当前输入设备：'keyboard' | 'gamepad' | 'touch'
         * 由最近一次收到的输入消息决定，供客户端切换操作提示 UI
         */
        this.inputMode = 'keyboard';
        /** @type {Object|null} 归一化手柄状态（_normalizeGamepadEvent 写入） */
        this._gamepadState = null;
        /** @type {Set<string>} 手柄当前折叠出的虚拟按键（供合并入 heldKeys） */
        this._gamepadKeys = new Set();
        /** @type {Object|null} 归一化触屏状态（_normalizeTouchEvent 写入） */
        this._touchState = null;
        /** @type {Set<string>} 触屏当前折叠出的虚拟按键（供合并入 heldKeys） */
        this._touchKeys = new Set();
        /** @type {number} 摇杆/扳机死区（0~1） */
        this._deadzone = 0.2;
        /**
         * 当前瞄准方向（右摇杆 / 瞄准摇杆 / 世界坐标点击）
         * 用于道具投射物的发射方向，见 getFacingDirection
         * @type {Vec2}
         */
        this.aimDir = new Vec2(0, 0);
        /** @type {number} 瞄准方向有效截止时间戳（Date.now()） */
        this._aimUntil = 0;
        /** @type {{x:number,y:number,world:boolean}|null} 最近一次非虚拟控件点击坐标 */
        this.lastClick = null;
        // ---------- 三端操作支持 ----------

        this.on('keyboardEvent', (a) => {
            this.eventQueue.push(a);
        });

        // 手柄 / 触屏 / 鼠标事件（由 game/index.js 从网络层转发而来）
        this.on('gamepadEvent', (a) => {
            this.eventQueue.push({ source: 'gamepad', data: a });
        });
        this.on('touchEvent', (a) => {
            this.eventQueue.push({ source: 'touch', data: a });
        });
        this.on('mouseEvent', (a) => {
            this.eventQueue.push({ source: 'mouse', data: a });
        });
    }

    trigger(type, data) {
        if (!this.eventHandlers[type]) this.eventHandlers[type] = [];
        this.eventHandlers[type].forEach(async (_) => {
            try {
                _(data);
            } catch (_) {
                console.error(_);
            }
        });
    }

    on(type, callback) {
        if (!this.eventHandlers[type]) this.eventHandlers[type] = [];
        this.eventHandlers[type].push(callback);
    }

    // ---------- 动画 ----------
    animate() {
        if (this.speed.lengthSq() == 0) {
            this.animateState = 'idle';
            return 'idle';
        }
        this.runAnimate = (this.runAnimate + this.speed.length() / (1.41421356 * 3 * this.args.speed)) % this.args.animations.run.frames;
        return `run${Math.trunc(this.runAnimate) + 1}`;
    }

    // ---------- 输入处理 ----------

    /**
     * 消费事件队列，更新当前帧的按键状态
     * 支持两种输入模式：
     * - KeyHolding: 客户端每帧发送当前已按下的按键列表
     * - KeyDown / KeyUp: 单个按键按下/抬起事件
     * 
     * 手柄（C2SGamepad）与触屏（C2STouch）输入不直接进入 heldKeys，
     * 而是先归一化到 this._gamepadState / this._touchState，
     * 再由 processGamepadInput / processTouchInput 折叠成统一按键状态。
     */
    processEvents() {
        while (this.eventQueue.length > 0) {
            const event = this.eventQueue.shift();

            // 手柄 / 触屏 / 鼠标输入：交给各自的归一化解析（不参与键盘按键状态）
            if (event && event.source) {
                if (event.source === 'gamepad') {
                    this._normalizeGamepadEvent(event.data);
                } else if (event.source === 'touch') {
                    this._normalizeTouchEvent(event.data);
                } else if (event.source === 'mouse') {
                    this._normalizeMouseEvent(event.data);
                }
                continue;
            }

            const { type, key } = event;
            if (type === 'KeyHolding') {
                // 保存最新的按键状态，供后续 processKeyholding 使用
                this.heldKeys = key;
            } else if (type === 'KeyDown') {
                // 单个按键按下：添加到 heldKeys（避免重复）
                if (!this.heldKeys.includes(key)) {
                    this.heldKeys.push(key);
                }
            } else if (type === 'KeyUp') {
                // 单个按键抬起：从 heldKeys 中移除
                this.heldKeys = this.heldKeys.filter(k => k !== key);
            }
        }
    }

    // ============================================================
    //  手柄 & 触屏输入（三端操作支持）
    // ============================================================

    /**
     * 解析 C2SGamepad 消息 → 归一化手柄状态（存于 this._gamepadState）
     *
     * 支持两种报文形态：
     * 1) 快照型（推荐）：
     *    {
     *      type: 'GamepadHolding' | 'GamepadState' | 'GamepadChanged',
     *      axes:    { leftX, leftY, rightX, rightY } 或 [lx, ly, rx, ry],
     *      buttons: { a, b, x, y, lb, rb, lt, rt }   或 [{pressed}, ...]（标准 Gamepad API 布局）
     *    }
     * 2) 平铺型：
     *    { type, leftX, leftY, rightX, rightY, a, b, x, y, lt, rt, lb, rb }
     * 3) 单按钮增量：{ type: 'GamepadDown'|'GamepadUp', button: 'a' } 或 { control: 'a', pressed: true }
     *
     * 归一化结果：
     *   { axes: {lx,ly,rx,ry}, buttons: {a,b,x,y,lb,rb,lt,rt} }
     * 未出现的字段保持上一次的值（支持增量上报），首次上报用默认值。
     */
    _normalizeGamepadEvent(data) {
        if (!data || typeof data !== 'object') return;
        this.inputMode = 'gamepad';

        const prev = this._gamepadState || {
            axes: { lx: 0, ly: 0, rx: 0, ry: 0 },
            buttons: { a: false, b: false, x: false, y: false, lb: false, rb: false, lt: 0, rt: 0 },
        };
        const state = {
            axes: { ...prev.axes },
            buttons: { ...prev.buttons },
        };

        const axes = data.axes;
        const buttons = data.buttons;

        // ---- 摇杆轴 ----
        if (Array.isArray(axes)) {
            state.axes.lx = clamp1(axes[0] ?? prev.axes.lx);
            state.axes.ly = clamp1(axes[1] ?? prev.axes.ly);
            state.axes.rx = clamp1(axes[2] ?? prev.axes.rx);
            state.axes.ry = clamp1(axes[3] ?? prev.axes.ry);
        } else if (axes && typeof axes === 'object') {
            if (axes.leftX != null) state.axes.lx = clamp1(axes.leftX);
            if (axes.leftY != null) state.axes.ly = clamp1(axes.leftY);
            if (axes.rightX != null) state.axes.rx = clamp1(axes.rightX);
            if (axes.rightY != null) state.axes.ry = clamp1(axes.rightY);
            if (axes.lx != null) state.axes.lx = clamp1(axes.lx);
            if (axes.ly != null) state.axes.ly = clamp1(axes.ly);
            if (axes.rx != null) state.axes.rx = clamp1(axes.rx);
            if (axes.ry != null) state.axes.ry = clamp1(axes.ry);
        }
        // 平铺型轴字段
        if (data.leftX != null) state.axes.lx = clamp1(data.leftX);
        if (data.leftY != null) state.axes.ly = clamp1(data.leftY);
        if (data.rightX != null) state.axes.rx = clamp1(data.rightX);
        if (data.rightY != null) state.axes.ry = clamp1(data.rightY);

        // ---- 按钮 ----
        if (Array.isArray(buttons)) {
            // 标准 Gamepad API 布局：0=A 1=B 2=X 3=Y 4=LB 5=RB 6=LT 7=RT
            const index = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7 };
            for (const [name, i] of Object.entries(index)) {
                const btn = buttons[i];
                if (btn == null) continue;
                state.buttons[name] = typeof btn === 'object' ? !!btn.pressed : !!btn;
            }
        } else if (buttons && typeof buttons === 'object') {
            for (const name of ['a', 'b', 'x', 'y', 'lb', 'rb']) {
                if (buttons[name] != null) state.buttons[name] = !!buttons[name];
            }
            for (const name of ['lt', 'rt']) {
                if (buttons[name] != null) state.buttons[name] = clamp01(buttons[name]);
            }
        }
        // 平铺型按钮字段
        for (const name of ['a', 'b', 'x', 'y', 'lb', 'rb']) {
            if (data[name] != null) state.buttons[name] = !!data[name];
        }
        for (const name of ['lt', 'rt']) {
            if (data[name] != null) state.buttons[name] = clamp01(data[name]);
        }

        // ---- 单按钮增量事件 ----
        const singleBtn = data.button || data.control;
        if (typeof singleBtn === 'string' && singleBtn in state.buttons) {
            const name = singleBtn.toLowerCase();
            const pressed = data.pressed !== undefined ? !!data.pressed : data.type === 'GamepadDown';
            state.buttons[name] = (name === 'lt' || name === 'rt') ? (pressed ? 1 : 0) : pressed;
        }

        this._gamepadState = state;
    }

    /**
     * 解析 C2STouch 消息 → 归一化触屏状态（存于 this._touchState）
     *
     * 客户端约定：
     *  - 点击/滑动虚拟按键或虚拟摇杆 → 上报虚拟数据
     *  - 未点击任何虚拟控件 → 上报点击坐标
     *
     * 支持的报文形态：
     * 1) 虚拟控件事件：
     *    {
     *      virtual: true,
     *      type: 'joystick' | 'button',
     *      control: 'move' | 'aim'                        // joystick
     *             | 'attack' | 'skill' | 'interact' | 'switchSkill'
     *             | 'useItem' | 'item1'..'item10'         // button
     *      x, y,        // joystick 方向 (-1~1)
     *      pressed: true|false
     *    }
     * 2) 点击坐标事件：
     *    { virtual: false, x, y, world: false|true }
     *    world=true 表示 x/y 为世界坐标（用于瞄准）；false 为屏幕坐标
     * 3) 快照型：
     *    {
     *      type: 'TouchHolding' | 'TouchState',
     *      joystick: {x,y} | null,       // 左虚拟摇杆（移动）
     *      aim:      {x,y} | null,       // 右虚拟摇杆（瞄准）
     *      buttons:  { attack: true, skill: true, ... },
     *      click:    {x,y} | null,
     *      world:    false|true
     *    }
     */
    _normalizeTouchEvent(data) {
        if (!data || typeof data !== 'object') return;
        this.inputMode = 'touch';

        if (!this._touchState) {
            this._touchState = {
                joystick: { x: 0, y: 0, active: false },
                aim: { x: 0, y: 0, active: false },
                buttons: new Set(),
                click: null,
            };
        }
        const state = this._touchState;

        // ---- 虚拟控件事件 ----
        if (data.virtual === true) {
            const type = data.type === 'stick' ? 'joystick' : (data.type || 'button');
            const control = data.control;
            const pressed = data.pressed !== false;

            if (type === 'joystick') {
                const target = control === 'aim' ? state.aim : state.joystick;
                if (data.x != null) target.x = clamp1(data.x);
                if (data.y != null) target.y = clamp1(data.y);
                target.active = pressed && Math.hypot(target.x, target.y) > this._deadzone;
            } else if (control) {
                if (pressed) state.buttons.add(control);
                else state.buttons.delete(control);
            }
            return;
        }

        // ---- 快照型 ----
        if (data.type === 'TouchHolding' || data.type === 'TouchState' ||
            data.joystick !== undefined || data.aim !== undefined || data.buttons || data.click !== undefined) {
            // 左虚拟摇杆（移动）
            if (data.joystick !== undefined) {
                if (data.joystick) {
                    state.joystick.x = clamp1(data.joystick.x ?? 0);
                    state.joystick.y = clamp1(data.joystick.y ?? 0);
                    state.joystick.active = Math.hypot(state.joystick.x, state.joystick.y) > this._deadzone;
                } else {
                    // 显式 null = 松开摇杆
                    state.joystick.x = 0;
                    state.joystick.y = 0;
                    state.joystick.active = false;
                }
            }
            // 右虚拟摇杆（瞄准）
            if (data.aim !== undefined) {
                if (data.aim) {
                    state.aim.x = clamp1(data.aim.x ?? 0);
                    state.aim.y = clamp1(data.aim.y ?? 0);
                    state.aim.active = Math.hypot(state.aim.x, state.aim.y) > this._deadzone;
                } else {
                    state.aim.x = 0;
                    state.aim.y = 0;
                    state.aim.active = false;
                }
            }
            if (data.buttons && typeof data.buttons === 'object') {
                for (const [ctrl, v] of Object.entries(data.buttons)) {
                    if (v) state.buttons.add(ctrl);
                    else state.buttons.delete(ctrl);
                }
            }
            if (data.click !== undefined) {
                state.click = data.click ? { x: Number(data.click.x), y: Number(data.click.y), world: !!data.world } : null;
            }
            return;
        }

        // ---- 点击坐标事件 ----
        if (data.x != null && data.y != null) {
            state.click = { x: Number(data.x), y: Number(data.y), world: !!data.world };
        }
    }

    /**
     * 解析 C2SMouseEvent 消息 → 鼠标点击状态（存于 this.lastClick）
     *
     * 与触屏点击约定一致：
     *   - world=false（默认）：x / y 为视口归一化坐标（0~100）
     *     商店 GUI 打开时用于商品命中检测；
     *   - world=true：x / y 为世界坐标（用于瞄准）。
     *
     * 支持报文形态：
     *   { x, y, world?: boolean, button?: number, type?: 'Click'|'MouseDown'|... }
     *
     * @param {Object} data - C2SMouseEvent 消息体
     */
    _normalizeMouseEvent(data) {
        if (!data || typeof data !== 'object') return;
        this.inputMode = 'keyboard';
        if (data.x != null && data.y != null) {
            this.lastClick = {
                x: Number(data.x),
                y: Number(data.y),
                world: !!data.world,
            };
        }
    }

    /**
     * 将归一化的手柄状态折叠进 _gamepadKeys / aimDir
     * 每 tick 在 mergeInputKeys 之前调用（与键盘、触屏共用一套按键状态）
     *
     * 按键映射：
     *   左摇杆   → 移动（KeyW/A/S/D，语义与键盘一致）
     *   右摇杆   → 瞄准方向（影响道具投射物发射方向）
     *   A        → 普攻（KeyR）
     *   X        → 释放技能（KeyF）
     *   Y        → 切换技能（KeyC）
     *   B        → 交互（KeyE：商店/开采/设置重生点）
     *   RT（扳机）→ 普攻（KeyR）
     *   LT（扳机）→ 使用 1 号位道具（Digit1）
     */
    processGamepadInput() {
        const gp = this._gamepadState;
        this._gamepadKeys.clear();
        if (!gp) return;

        const dz = this._deadzone;
        const { lx, ly, rx, ry } = gp.axes;
        const B = gp.buttons;

        // ---- 左摇杆 → 移动 ----
        if (Math.abs(lx) > dz) {
            this._gamepadKeys.add(lx > 0 ? 'KeyD' : 'KeyA');
        }
        if (Math.abs(ly) > dz) {
            // 摇杆向上（标准 y<0）→ KeyW，向下 → KeyS
            this._gamepadKeys.add(ly < 0 ? 'KeyW' : 'KeyS');
        }

        // ---- 右摇杆 → 瞄准方向 ----
        // （商店界面的商品选中由客户端本地处理，不再占用服务端输入通道）
        if (Math.abs(rx) > dz || Math.abs(ry) > dz) {
            this._setAim(rx, ry);
        }

        // ---- ABXY ----
        if (B.a) this._gamepadKeys.add('KeyR');
        if (B.x) this._gamepadKeys.add('KeyF');
        if (B.y) this._gamepadKeys.add('KeyC');
        if (B.b) this._gamepadKeys.add('KeyE');

        // ---- 扳机 ----
        if (B.rt > dz) this._gamepadKeys.add('KeyR');
        if (B.lt > dz) this._gamepadKeys.add('Digit1');
    }

    /**
     * 将归一化的触屏状态折叠进 _touchKeys / aimDir
     * 每 tick 在 mergeInputKeys 之前调用（与键盘、手柄共用一套按键状态）
     *
     * 虚拟控件映射：
     *   左虚拟摇杆       → 移动（KeyW/A/S/D）
     *   右虚拟摇杆(aim)  → 瞄准方向
     *   虚拟按键：
     *     attack      → 普攻（KeyR）
     *     skill       → 释放技能（KeyF）
     *     interact    → 交互（KeyE：商店/开采/设置重生点）
     *     switchSkill → 切换技能（KeyC）
     *     useItem     → 使用 1 号位道具（Digit1）
     *     item1~item10→ 使用对应槽位道具（Digit1~Digit0）
     *   点击坐标（world=true）→ 玩家朝向点击点（瞄准方向）
     */
    processTouchInput() {
        const t = this._touchState;
        this._touchKeys.clear();
        if (!t) return;

        // ---- 左虚拟摇杆 → 移动 ----
        if (t.joystick.active) {
            if (t.joystick.y < -this._deadzone) this._touchKeys.add('KeyW');
            if (t.joystick.y > this._deadzone) this._touchKeys.add('KeyS');
            if (t.joystick.x < -this._deadzone) this._touchKeys.add('KeyA');
            if (t.joystick.x > this._deadzone) this._touchKeys.add('KeyD');
        }

        // ---- 右虚拟摇杆 → 瞄准 ----
        if (t.aim.active) {
            this._setAim(t.aim.x, t.aim.y);
        }

        // ---- 虚拟按键 ----
        const BTN_MAP = {
            attack: 'KeyR',
            skill: 'KeyF',
            interact: 'KeyE',
            switchSkill: 'KeyC',
            useItem: 'Digit1',
        };
        for (const [ctrl, key] of Object.entries(BTN_MAP)) {
            if (t.buttons.has(ctrl)) this._touchKeys.add(key);
        }
        for (let i = 0; i < 10; i++) {
            if (t.buttons.has(`item${i + 1}`)) {
                this._touchKeys.add(i === 9 ? 'Digit0' : `Digit${i + 1}`);
            }
        }

        // ---- 点击坐标 → 瞄准方向（世界坐标） ----
        if (t.click && t.click.world) {
            this.lastClick = { x: t.click.x, y: t.click.y, world: true };
            const dx = t.click.x - this.x;
            const dy = t.click.y - this.y;
            if (Math.hypot(dx, dy) > 1) {
                this._setAim(dx, dy);
            }
        } else if (t.click) {
            this.lastClick = { x: t.click.x, y: t.click.y, world: false };
        }
    }

    /**
     * 合并键盘（heldKeys）与手柄（_gamepadKeys）、触屏（_touchKeys）的按键状态
     * 生成 effectiveKeys 供 processKeyholding 消费，使三端输入可同时生效。
     * 键盘部分保持独立（heldKeys），避免三端合并后互相污染。
     */
    mergeInputKeys() {
        const merged = Array.isArray(this.heldKeys) ? [...this.heldKeys] : [];
        for (const k of this._gamepadKeys) {
            if (!merged.includes(k)) merged.push(k);
        }
        for (const k of this._touchKeys) {
            if (!merged.includes(k)) merged.push(k);
        }
        this.effectiveKeys = merged;
    }

    /**
     * 设置瞄准方向并使其保持一段有效时间（供 getFacingDirection 使用）
     * @param {number} x
     * @param {number} y
     * @param {number} [duration] 有效时长 ms
     */
    _setAim(x, y, duration = 500) {
        if (Math.hypot(x, y) < 0.001) return;
        this.aimDir.set(x, y).normalize();
        this._aimUntil = Date.now() + duration;
    }

    /**
     * 根据当前按键状态更新移动方向 / 攻击 / 技能 / 开采标记
     * 
     * 每 tick 都会调用（而非仅在收到事件时），
     * 确保按键状态在无新事件时也能正确维持。
     */
    processKeyholding() {
        this.dx = this.dy = 0;
        const wasAttacking = this.attacking;
        this.attacking = false;

        // 重置开采状态：如果 E 键不在当前按键列表中，开采被打断
        this.mining = false;

        const key = this.effectiveKeys || [];
        const prevKey = this.prevHeldKeys || [];
        // 行动许可：匹配阶段（canAct=false）仅允许移动，禁止攻击/采矿/技能/道具
        const canAct = this.canAct;

        // ---- 眩晕状态下跳过所有输入 ----
        if (this.stunned) {
            this.prevHeldKeys = [...key];
            return;
        }

        // ---- 商店界面打开：禁止移动/攻击/技能/采矿 ----
        // （打开/关闭/购买均由客户端通过 C2SOpenShop / C2SCloseShop / C2SBuyItem
        //  独立协议包驱动，服务端不再在按键层处理商店 UI）
        if (this.isShopOpen) {
            this.prevHeldKeys = [...key];
            return;
        }

        // ---- 单次触发的按键（仅在首次按下时触发） ----
        // C 键：切换技能（仅在新按下时触发，防止每 tick 反复切换）
        if (key.includes('KeyC') && !prevKey.includes('KeyC')) {
            const available = this.getAvailableSkills();
            if (available.length > 0) {
                const currentIdx = available.indexOf(this.selectedSkill);
                const nextIdx = (currentIdx + 1) % available.length;
                this.selectedSkill = available[nextIdx];
                console.log(
                    `[Skill] ${this.sessionId} switched to skill ${this.selectedSkill} ` +
                    `(${this.getSkillData(this.selectedSkill)?.name || 'unknown'})`
                );
            }
        }

        // ---- 道具快捷键（数字键 1-0 对应物品栏 1-10 号位） ----
        // 匹配阶段禁止使用道具
        const digitKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
                          'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
        for (let slotIdx = 0; slotIdx < digitKeys.length; slotIdx++) {
            const dk = digitKeys[slotIdx];
            if (canAct && key.includes(dk) && !prevKey.includes(dk)) {
                this._useItemBySlot(slotIdx);
            }
        }

        for (const k of key) {
            switch (k) {
                case 'KeyW':
                    this.dy = 1;
                    break;
                case 'KeyS':
                    this.dy = -1;
                    break;
                case 'KeyA':
                    this.dx = -1;
                    this.dir = -90;
                    break;
                case 'KeyD':
                    this.dx = 1;
                    this.dir = 90;
                    break;
                case 'KeyR':
                    // 普攻 — 匹配阶段禁止；仅在未释放技能且未被禁止攻击时允许
                    if (canAct && !this.usingSkill && !this.cantAttack && this.isBasicReady()) {
                        this.attacking = true;
                        if (!wasAttacking) {
                            this.attackForward = this.args.attacks.basic.forward || 0;
                        }
                    }
                    break;
                case 'KeyF':
                    // 释放当前选中技能 — 匹配阶段禁止；仅在未攻击且未被禁止攻击时允许
                    if (canAct && !this.attacking && !this.usingSkill && !this.cantAttack) {
                        const skillKey = `skill${this.selectedSkill}`;
                        if (this.isSkillReady(this.selectedSkill)) {
                            const skillData = this.args.attacks[skillKey];
                            if (skillData) {
                                // 检查金钱消耗
                                if ((skillData.cost || 0) <= this.money) {
                                    this.money -= (skillData.cost || 0);
                                    this.usingSkill = true;
                                    this.skillCastForward = skillData.forward || 0;
                                    // 记录冷却
                                    this.skillCooldowns[this.selectedSkill] = Date.now();
                                }
                            }
                        }
                    }
                    break;
                case 'KeyE':
                    // 匹配阶段禁止商店/采矿/重生点交互
                    if (!canAct) break;
                    // 边沿触发（首次按下）：
                    //  - 商店的打开 / 关闭由客户端发送 C2SOpenShop / C2SCloseShop
                    //    独立协议包驱动（服务端不再在按键层切换商店开关）
                    //  - 前哨站 — 靠近己方占领的前哨站 25px 内按 E 设置重生点
                    if (key.includes('KeyE') && !prevKey.includes('KeyE')) {
                        if (this.canSetSpawn && this.spawnOutpostTarget) {
                            this.spawnOutpostTarget.setSpawn(this);
                        }
                    }
                    // 按住 E 且商店未打开 → 采矿（持续累积开采进度）
                    if (!this.isShopOpen && this.canMine && this.miningTarget && !this.miningTarget.collected) {
                        this.mining = true;
                    }
                    break;
            }
        }

        // 松开 E 键或失去开采/商店目标时，重置开采进度
        if (!this.mining) {
            this.miningTime = 0;
        }

        // 保存当前帧按键状态供下一帧比较
        this.prevHeldKeys = [...key];
    }

    // ---------- 技能辅助方法 ----------

    /**
     * 获取技能数据
     * @param {number} skillIndex - 1~4
     */
    getSkillData(skillIndex) {
        return this.args.attacks[`skill${skillIndex}`] || null;
    }

    /**
     * 获取可用的技能列表（排除 basic）
     * @returns {number[]}
     */
    getAvailableSkills() {
        const skills = [];
        for (let i = 1; i <= 4; i++) {
            if (this.args.attacks[`skill${i}`]) {
                skills.push(i);
            }
        }
        return skills;
    }

    /**
     * 检查普攻是否冷却完毕
     */
    isBasicReady() {
        const basic = this.args.attacks.basic;
        if (!basic || !basic.cd) return true;
        const lastUsed = this.skillCooldowns[0]; // 0 = basic attack
        if (!lastUsed) return true;
        return Date.now() - lastUsed >= basic.cd;
    }

    /**
     * 检查指定技能是否冷却完毕
     * @param {number} skillIndex - 1~4
     */
    isSkillReady(skillIndex) {
        const skillData = this.getSkillData(skillIndex);
        if (!skillData) return false;
        const lastUsed = this.skillCooldowns[skillIndex];
        if (!lastUsed) return true;
        return Date.now() - lastUsed >= skillData.cd;
    }

    /**
     * 获取技能剩余冷却时间（毫秒）
     * @param {number} skillIndex - 1~4
     * @returns {number} 剩余冷却 ms，若已就绪返回 0
     */
    getSkillCooldownRemaining(skillIndex) {
        const skillData = this.getSkillData(skillIndex);
        if (!skillData) return Infinity;
        const lastUsed = this.skillCooldowns[skillIndex];
        if (!lastUsed) return 0;
        const remaining = skillData.cd - (Date.now() - lastUsed);
        return Math.max(0, remaining);
    }

    // ---------- 矿物开采 ----------

    /**
     * 更新矿物接近检测
     * 
     * 检查玩家与所有矿物的距离，在 30px 以内则设置 canMine 标志
     * 并记录最近的可开采目标。
     * 已被其他玩家锁定开采的矿物会跳过，避免多人同时采同一矿物。
     * 
     * @param {import('../world.js').default} world - 世界实例
     */
    updateMiningProximity(world) {
        // 记录上一目标，用于目标切换 / 停止开采时释放矿物锁定
        const prevTarget = this.miningTarget;

        this.canMine = false;
        this.miningTarget = null;

        for (const mineral of world.minerals) {
            if (mineral.collected) continue;
            // 已被其他玩家锁定开采 → 不可用
            if (mineral.miner && mineral.miner !== this.sessionId) continue;
            if (mineral.isPlayerNear(this.x, this.y)) {
                this.canMine = true;
                this.miningTarget = mineral;
                break; // 取第一个在范围内的矿物
            }
        }

        // 目标切换（走远 / 矿物被采完 / 切到其他矿物）→ 释放旧目标锁定
        if (prevTarget && prevTarget !== this.miningTarget) {
            prevTarget.release(this.sessionId);
        }
        // 停止开采（E 松开 / 被打断）→ 释放旧目标锁定
        if (prevTarget && !this.mining && prevTarget.miner === this.sessionId) {
            prevTarget.release(this.sessionId);
        }

        // 如果失去目标（矿物被采完或玩家走远），打断开采
        if (!this.canMine && this.mining) {
            this.mining = false;
            this.miningTime = 0;
        }
    }

    /**
     * 更新商店接近检测
     *
     * 检查玩家是否在商店实体的交互范围内。
     * 若离开范围则自动关闭商店（Game 层据此补发 S2CCloseShop）。
     *
     * @param {import('../world.js').default} world - 世界实例
     */
    updateShopProximity(world) {
        const nearbyShop = world.getNearbyShop(this.x, this.y);

        if (nearbyShop) {
            this.canShop = true;
            this.shopTarget = nearbyShop;
        } else {
            // 离开商店范围时自动关闭商店
            this.canShop = false;
            this.shopTarget = null;
            if (this.isShopOpen) {
                this.isShopOpen = false;
                this.shopJustOpened = false;
            }
        }

        // 已打开的商店实体不再在交互范围内（被推离等）→ 关闭
        if (this._openShop && !this._openShop.isPlayerNear(this.x, this.y)) {
            this._openShop.openedBy.delete(this.sessionId);
            this._openShop = null;
            this.isShopOpen = false;
            this.shopJustOpened = false;
        }
    }

    /**
     * 更新前哨站重生点接近检测
     *
     * 检查玩家是否在己方占领的前哨站 25px 范围内。
     * 若在范围内则标记 canSetSpawn，供 E 键处理使用。
     * 若离开范围则重置相关标志。
     *
     * @param {import('../world.js').default} world - 世界实例
     */
    updateOutpostProximity(world) {
        const nearbyOutpost = world.getNearbySpawnOutpost(this.x, this.y, this.team);

        if (nearbyOutpost) {
            this.canSetSpawn = true;
            this.spawnOutpostTarget = nearbyOutpost;
        } else {
            this.canSetSpawn = false;
            this.spawnOutpostTarget = null;
        }

        // 若玩家已绑定的前哨站不再有效（被敌方占领），清除自定义重生点
        if (this.customSpawnOutpost && !this.customSpawnOutpost.isSpawnValid(this)) {
            console.log(
                `[Outpost] ${this.sessionId} 的自定义重生点失效 ` +
                `(前哨站 ${this.customSpawnOutpost.data.id} 已不再被己方占领)`
            );
            this.customSpawnOutpost = null;
        }
    }

    /**
     * 处理开采进度
     * 
     * 当玩家正在开采（E 按住 + 附近有矿物）时，
     * 每 tick 累加 miningTime，达到阈值后完成采集。
     * 首次进入开采时锁定矿物，防止多人同时采同一矿物（先到先得）。
     * 匹配阶段禁止采矿。
     */
    processMining() {
        if (!this.canAct) {
            // 匹配阶段：强制打断采矿
            this.mining = false;
            this.miningTime = 0;
            return;
        }
        if (!this.mining || !this.miningTarget || !this.miningTarget.config) return;

        // 安全检查：目标可能在两次 tick 间被其他玩家采集
        if (this.miningTarget.collected) {
            this.mining = false;
            this.miningTime = 0;
            this.canMine = false;
            this.miningTarget = null;
            return;
        }

        // 开采锁定：第一次进入开采时声明归属（先到先得）
        if (!this.miningTarget.miner) {
            this.miningTarget.claim(this.sessionId);
        } else if (this.miningTarget.miner !== this.sessionId) {
            // 已被其他玩家锁定 → 立即停止开采，稍后由 updateMiningProximity 重新选目标
            this.mining = false;
            this.miningTime = 0;
            this.canMine = false;
            this.miningTarget = null;
            return;
        }

        // 累加开采时间（每 tick 50ms）
        this.miningTime += Player.TICK_MS;

        const required = this.miningTarget.config.miningTime;

        // 开采完成
        if (this.miningTime >= required) {
            const reward = this.miningTarget.config.money;
            this.money += reward;
            this.miningTarget.collect();
            console.log(
                `[Mineral] Player ${this.sessionId} mined ${this.miningTarget.mineralType}, ` +
                `earned +${reward} money (total: ${this.money})`
            );

            // 重置开采状态
            this.mining = false;
            this.miningTime = 0;
            this.canMine = false;
            this.miningTarget = null;
        }
    }

    // ---------- 移动 ----------

    move(world) {
        // 开采期间或技能前摇期间或眩晕期间或商店打开时禁止移动，同时刹车惯性速度
        if (this.mining || this.usingSkill || this.stunned || this.isShopOpen) {
            this.speed.set(0, 0);
            return;
        }

        // 计算最终速度倍率：SpeedBuff 乘数 × (1 - 烟雾减速)
        const speedMult = this.speedMultiplier * (1 - (this.slowAmount || 0));

        const kb = this.knockback.lengthSq();
        if (this.dx && kb <= 16) this.speed.x = this.dx * this.args.speed * speedMult;
        if (this.dy && kb <= 16) this.speed.y = this.dy * this.args.speed * speedMult;

        // 记录移动方向（用于道具发射）
        if (this.speed.lengthSq() > 0.01) {
            this.lastMoveDir = this.speed.normalized().clone();
        }
        if (this.speed.lengthSq() <= 0.09) {
            this.speed = new Vec2(0, 0);
        }
        this.speed.add(this.knockback);
        this.knockback.scale(0.9);
        for (const wall of world.walls) {
            if (!this.hitbox || !wall?.hitbox) continue;
            if (collisionLeft(this.hitbox, wall.hitbox, this.speed)) {
                this.speed.x = 0;
            }
            if (collisionRight(this.hitbox, wall.hitbox, this.speed)) {
                this.speed.x = 0;
            }
        }
        for (const wall of world.walls) {
            if (!this.hitbox || !wall?.hitbox) continue;
            if (collisionTop(this.hitbox, wall.hitbox, this.speed)) {
                this.speed.y = 0;
            }
            if (collisionBottom(this.hitbox, wall.hitbox, this.speed)) {
                this.speed.y = 0;
            }
        }
        this.x += this.speed.x;
        this.y += this.speed.y;
        this.speed.scale(kb > 16 ? 0.95 : 0.85);
        this.hitbox.x = this.x - 25;
        this.hitbox.y = this.y - 25;
    }

    // ---------- 战斗 ----------

    /**
     * 查找最近的低血量敌人（75px 范围内）
     * 优先血量最低者，同等血量优先距离最近者
     * （跳过已死亡的玩家）
     */
    findTarget(players) {
        let bestTarget = null;
        let bestHealth = Infinity;
        let bestDistance = Infinity;

        for (const [id, player] of Object.entries(players)) {
            if (id === this.sessionId) continue;
            if (player.team === this.team) continue; // 忽略队友
            if (player.dead || player.health <= 0) continue; // 忽略已死亡玩家

            const dist = Math.hypot(this.x - player.x, this.y - player.y);
            if (dist > 75) continue;

            const health = player.health;
            if (health < bestHealth || (health === bestHealth && dist < bestDistance)) {
                bestTarget = player;
                bestHealth = health;
                bestDistance = dist;
            }
        }

        return bestTarget;
    }

    /**
     * 查找范围内所有敌人（用于 AOE，跳过已死亡玩家）
     * @param {number} range - 溅射范围（像素）
     */
    findTargetsInRange(players, range) {
        const targets = [];
        for (const [id, player] of Object.entries(players)) {
            if (id === this.sessionId) continue;
            if (player.team === this.team) continue; // 忽略队友
            if (player.dead || player.health <= 0) continue; // 忽略已死亡玩家
            const dist = Math.hypot(this.x - player.x, this.y - player.y);
            if (dist <= range) {
                targets.push({ player, dist });
            }
        }
        return targets;
    }

    /**
     * 处理普攻
     * 前摇计时 → 计时归零时命中目标
     * 匹配阶段禁止攻击。
     */
    processBasicAttack(players) {
        if (!this.attacking || !this.canAct) return;

        // 使用 TICK_MS 进行时间衰减，而非固定 0.1
        this.attackForward = Math.max(0, this.attackForward - Player.TICK_MS);

        if (this.attackForward <= 0) {
            this.attacking = false;

            // 记录冷却
            this.skillCooldowns[0] = Date.now();

            const target = this.findTarget(players);
            if (target) {
                const damage = this.args.attacks.basic.damage * this._strengthMultiplier;
                target.takeDamage(damage, this);

                const knockback = this.args.attacks.basic.knockback;
                if (knockback) {
                    const direction = new Vec2(target.x - this.x, target.y - this.y).normalize();
                    target.takeKnockback(direction.scale(knockback));
                }

                console.log(
                    `[Combat] ${this.sessionId} basic attacked ${target.sessionId} ` +
                    `for ${Math.round(damage)} damage (multiplier: ${this._strengthMultiplier.toFixed(1)})`
                );
            }
        }
    }

    /**
     * 处理技能释放
     * 前摇计时 → 计时归零时释放技能效果
     * 匹配阶段禁止释放技能。
     */
    processSkillCast(players) {
        if (!this.usingSkill || !this.canAct) return;

        // 使用 TICK_MS 进行时间衰减
        this.skillCastForward = Math.max(0, this.skillCastForward - Player.TICK_MS);

        if (this.skillCastForward <= 0) {
            this.usingSkill = false;

            const skillKey = `skill${this.selectedSkill}`;
            const skillInstance = this.skills[skillKey];
            const skillData = this.getSkillData(this.selectedSkill);

            if (!skillInstance || !skillData) return;

            const target = this.findTarget(players);

            // 对主目标施加技能效果
            if (target) {
                skillInstance.onUse(this, target);
                console.log(
                    `[Combat] ${this.sessionId} used ${skillData.name} ` +
                    `on ${target.sessionId} for ${skillData.damage || 0} damage`
                );
            }

            // 处理 AOE 溅射伤害（如 skill3 的 magic 配置）
            if (skillData.magic && skillData.magic.range) {
                const aoeTargets = this.findTargetsInRange(players, skillData.magic.range);
                for (const { player } of aoeTargets) {
                    // 跳过主目标（已被 onUse 处理过）
                    if (player === target) continue;

                    player.takeDamage(skillData.magic.damage || 0, this);

                    if (skillData.magic.knockback) {
                        const direction = new Vec2(
                            player.x - this.x,
                            player.y - this.y
                        ).normalize();
                        player.takeKnockback(direction.scale(skillData.magic.knockback));
                    }

                    console.log(
                        `[Combat] ${this.sessionId}'s ${skillData.name} ` +
                        `splashed ${player.sessionId} for ${skillData.magic.damage || 0} AOE damage`
                    );
                }
            }

            // 处理 buff（施加给自身），当 onUse 因无目标而跳过自身 buff 时，此处补上
            if (skillData.buff && !target) {
                for (const buffData of skillData.buff) {
                    const BuffClass = getBuffClassById(buffData.id);
                    const buffInstance = new BuffClass(buffData);
                    this.giveBuff(buffInstance);
                }
            }
        }
    }

    /**
     * 统一技能处理入口（兼容旧名称）
     */
    processSkills(players) {
        this.processBasicAttack(players);
        this.processSkillCast(players);
    }

    // ---------- Buff 系统 ----------

    processBuffs() {
        const active = [];
        // 重置 buff 叠加属性（会在 tick 中被重新设置）
        this._strengthMultiplier = 1.0;
        this._reboundPercent = 0;
        this.stunned = false;
        this.invisible = false;
        this.cantAttack = false;
        this.speedMultiplier = 1.0;
        this.slowAmount = 0;
        // 注意：damageReduction 在 InvisibleBuff 的 tick 中设置，这里不重置
        // shield 由 ShieldBuff 的 onExpire 管理，这里不重置

        for (const buff of this.buffs) {
            if (buff.isExpired()) {
                // Buff 过期：调用 onExpire 回调后移除
                if (buff.onExpire) {
                    buff.onExpire(this);
                }
                // 不加入 active，即丢弃
                continue;
            }
            // Buff 仍有效：调用 tick 并保留
            if (buff.tick) {
                buff.tick(this);
            }
            active.push(buff);
        }
        this.buffs = active;
    }

    // ---------- 网络同步 ----------

    /**
     * 坐标精度裁剪：保留 0.1 像素精度（渲染精度足够），
     * 避免浮点累积误差（如 1280.0000000001）撑大 JSON 体积。
     * 仅用于渲染数据，不影响内部逻辑坐标。
     * @param {number} v - 原始坐标值
     * @returns {number} 裁剪后的坐标值
     */
    static _trimCoord(v) {
        return Math.round(v * 10) / 10;
    }

    remoteData() {
        // 构建技能状态信息（供客户端 UI 展示）
        // 注意：getSkillCooldownRemaining 内部使用 Date.now()，其返回值每毫秒变化，
        // 会导致即使玩家原地静止、render 指纹也每 tick 不同，完全破坏增量压缩。
        // 因此对剩余冷却时间做 50ms（≈1 tick）粒度 snap，确保同一 tick 内不变。
        const skillStates = {};
        for (let i = 1; i <= 4; i++) {
            const skillData = this.getSkillData(i);
            if (skillData) {
                const rawRemaining = this.getSkillCooldownRemaining(i);
                skillStates[i] = {
                    name: skillData.name,
                    cd: skillData.cd || 0,
                    cost: skillData.cost || 0,
                    remaining: rawRemaining > 0 ? Math.ceil(rawRemaining / 50) * 50 : 0,
                    ready: rawRemaining <= 0,
                };
            }
        }

        return {
            type: 'update',
            // 坐标裁剪到 0.1px 精度（渲染精度足够，大幅减小 JSON 体积）
            x: Player._trimCoord(this.x),
            y: Player._trimCoord(this.y),
            asset: this.costume,
            isShowed: !this.dead, // 死亡玩家不再显示（客户端可隐藏模型）
            id: this.sessionId,
            scale: 100,
            dir: this.dir,
            state: {
                health: this.health,
                maxHealth: this.maxHealth,
                money: this.money,
                /** 是否已死亡且无法复活（基地被毁 / 加时赛） */
                dead: this.dead,
                /** 累计击杀数（供客户端展示 / 队伍结算） */
                kills: this.kills,
                mining: this.mining,
                miningTime: this.miningTime,
                canMine: this.canMine,
                /** 玩家是否在可交互商店附近 */
                canShop: this.canShop,
                /** 玩家是否已打开商店 UI */
                isShopOpen: this.isShopOpen,
                /** 玩家附近是否有可设置重生点的前哨站（25px 内 + 己方占领） */
                canSetSpawn: this.canSetSpawn,
                /** 玩家当前绑定的自定义重生点前哨站 ID（null 表示无） */
                spawnOutpostId: this.customSpawnOutpost ? this.customSpawnOutpost.data.id : null,
                selectedSkill: this.selectedSkill,
                casting: this.usingSkill,
                skillStates: skillStates,
                basicReady: this.isBasicReady(),
                needToPredict: true,
                team: this.team,
                // 三端输入状态（客户端可据此切换操作提示 UI）
                inputMode: this.inputMode,
                aiming: this._aimUntil > Date.now(),
                // 瞄准方向：保持客户端约定的字符串格式，仅裁剪数值精度（0.01）
                aimDir: JSON.stringify({
                    x: Math.round(this.aimDir.x * 100) / 100,
                    y: Math.round(this.aimDir.y * 100) / 100,
                }),
                // 点击坐标：保持对象格式，仅裁剪数值精度（0.1）
                lastClick: this.lastClick ? {
                    x: Player._trimCoord(this.lastClick.x),
                    y: Player._trimCoord(this.lastClick.y),
                    world: this.lastClick.world,
                } : null,
                // 速度：保持客户端约定的字符串格式，仅裁剪数值精度（0.1）
                speed: JSON.stringify({
                    x: Player._trimCoord(this.speed.x),
                    y: Player._trimCoord(this.speed.y),
                }),
                buffs: this.buffs.map(b => ({
                    id: b.id,
                    level: b.level,
                    remaining: b.getRemainingTime(),
                })),
                // 新增道具/物品栏相关状态
                inventory: this.inventory ? this.inventory.serialize() : [],
                shield: this.shield || 0,
                invisible: this.invisible || false,
                stunned: this.stunned || false,
                channelingTeleport: this.inventory ? this.inventory.isChannelingTeleport : false,
                teleportRemaining: this.inventory ? this.inventory.teleportChannelRemaining : 0,
            },
            fz: 1,
            "z-index": 1000
        };
    }

    // ---------- 主 tick ----------

    /**
     * 每帧主更新入口
     * 
     * 执行顺序：
     * 1. 消费事件 → 2. 附近检测（商店/矿物）→ 3. 解析按键
     * 4. 开采进度 → 5. 移动 → 6. 技能 → 7. Buff → 8. 动画
     */
    tick(players, world) {
        this.dx = this.dy = 0;

        // 已死亡且无法复活：保持静止，不处理任何输入/行动
        if (this.dead) {
            // 清空积压输入队列，防止观战期间无界增长
            this.eventQueue.length = 0;
            this.speed.set(0, 0);
            this.knockback.set(0, 0);
            this.attacking = false;
            this.usingSkill = false;
            this.mining = false;
            return;
        }

        // 存储 world 和 players 引用，供键盘快捷键使用道具时使用
        this._worldRef = world;
        this._playersRef = players;

        this.processEvents();
        // 手柄 / 触屏输入 → 折叠成各自的虚拟按键集
        this.processGamepadInput();
        this.processTouchInput();
        // 合并键盘 + 手柄 + 触屏按键（三端可同时生效）
        this.mergeInputKeys();
        // 先进行附近检测，确保本 tick 按键处理时 canShop/canMine/canSetSpawn 已是最新状态
        this.updateMiningProximity(world);
        this.updateShopProximity(world);
        this.updateOutpostProximity(world);
        this.processKeyholding();
        this.processMining();
        this.move(world);
        this.processSkills(players);
        this.processBuffs();
        this.processTeleportChannel();   // 回城卷轴引导
        this.costume = `${this.hero}_${this.animate()}`;
    }

    /**
     * [废弃] 旧全量渲染管线入口（不再被调用）
     *
     * S2CRender 已改为 Game._buildRenderPacket 的增量同步：
     * 首次全量建立客户端缓存，之后仅发送变化的实体/玩家。
     * 该方法及其依赖的 World.culling 保留仅供参考 / 按视野裁剪扩展。
     */
    render(f) {
        let entities = f(this.x, this.y, 320, 180);
        let renderData = [];
        for (let i of entities) {
            const t = {
                ...i.getData(),
                type: 'update',
            };
            renderData.push(t);
        }
        const selfdata = [this.remoteData()];
        return [
            ...selfdata,
            ...renderData
        ];
    }

    /**
     * 受到伤害
     * 处理顺序：护盾吸收 → 伤害减免 → 反弹 → 扣除生命
     * @param {number} amount - 伤害值
     * @param {Player} [attacker] - 攻击者（用于反弹计算）
     */
    takeDamage(amount, attacker) {
        // 已死亡且无法复活的玩家忽略后续伤害（防止重复触发死亡/击杀计数）
        if (this.dead) return;

        let finalAmount = amount;

        // ----- 护盾吸收 -----
        if (this.shield > 0 && finalAmount > 0) {
            const absorbed = Math.min(this.shield, finalAmount);
            this.shield -= absorbed;
            finalAmount -= absorbed;
            if (absorbed > 0) {
                console.log(
                    `[Combat] ${this.sessionId} 护盾吸收了 ${absorbed} 伤害, ` +
                    `剩余护盾: ${this.shield}`
                );
            }
        }

        // ----- 伤害减免（隐形等） -----
        if (this.damageReduction > 0 && finalAmount > 0) {
            finalAmount = Math.round(finalAmount * (1 - this.damageReduction));
        }

        // ----- 反弹伤害 -----
        if (attacker && this._reboundPercent > 0 && finalAmount > 0) {
            const reflected = finalAmount * this._reboundPercent;
            if (reflected > 0) {
                // 反弹伤害由本玩家（被击者）造成，将反弹者作为 attacker 传递
                attacker.takeDamage(Math.round(reflected), this);
                console.log(
                    `[Combat] ${this.sessionId} reflected ${Math.round(reflected)} damage ` +
                    `back to ${attacker.sessionId} (${(this._reboundPercent * 100).toFixed(0)}%)`
                );
            }
        }

        // ----- 扣除生命 -----
        this.health -= finalAmount;
        if (this.health <= 0) {
            this.health = 0;
            console.log(`Player ${this.sessionId} has died.`);
            // 击杀计数：计入攻击者（人机与真人同等地位，供“总击杀数”结算）
            if (attacker && attacker !== this) {
                attacker.kills = (attacker.kills || 0) + 1;
            }
            // 公屏播报死亡：有击杀者时报击杀，否则（环境/自伤）报阵亡
            const victimName = this.name || this.sessionId;
            if (attacker && attacker !== this) {
                pushChat({
                    type: 'player_death',
                    player: this.sessionId,
                    name: victimName,
                    team: this.team,
                    killer: attacker.sessionId,
                    killerName: attacker.name || attacker.sessionId,
                    killerTeam: attacker.team,
                    text: `[击杀] ${victimName}（${this.team}队）被 ${attacker.name || attacker.sessionId}（${attacker.team}队）击杀！`,
                });
            } else {
                pushChat({
                    type: 'player_death',
                    player: this.sessionId,
                    name: victimName,
                    team: this.team,
                    killer: null,
                    killerName: null,
                    killerTeam: null,
                    text: `[死亡] ${victimName}（${this.team}队）阵亡了！`,
                });
            }
            this.onDeath();
        }

        // ----- 伤害漂浮文字（并入 S2CRender 渲染管线）-----
        // 仅当伤害由他人造成时触发（排除环境伤害 / 自身伤害），
        // 并按攻击者节流，避免持续伤害（毒/灼烧）每 tick 刷屏。
        if (attacker && attacker !== this && finalAmount > 0) {
            const now = Date.now();
            const last = this._popTextLastSent[attacker.sessionId] || 0;
            if (now - last >= 200) {
                this._popTextLastSent[attacker.sessionId] = now;
                pushPopText({
                    text: `-${Math.round(finalAmount)}`,
                    x: this.x,
                    y: this.y,
                    color: 0xff4444,
                    // 轻微随机水平动量，向上漂浮，避免多数字重叠
                    momentum: { x: (Math.random() - 0.5) * 40, y: -60 },
                    duration: 800,
                    ghost: 0,
                });
            }
        }
    }

    /**
     * 玩家死亡处理：
     *   - 可复活（canRevive）：优先使用前哨站自定义重生点，否则传送回基地
     *   - 不可复活（基地被毁 / 7 分钟加时赛）：保持死亡状态（this.dead = true），
     *     由 MatchManager 据此判定“一方玩家死绝”与胜负
     */
    onDeath() {
        // 死亡时释放矿物开采锁定，避免矿物被永久占用
        if (this.miningTarget) {
            this.miningTarget.release(this.sessionId);
            this.miningTarget = null;
        }
        this.mining = false;
        this.miningTime = 0;
        this.canMine = false;

        // 无法复活：保持死亡状态，重置所有战斗状态
        if (!this.canRevive) {
            this.dead = true;
            this.speed.set(0, 0);
            this.knockback.set(0, 0);
            this.buffs = [];
            this._strengthMultiplier = 1.0;
            this._reboundPercent = 0;
            this.stunned = false;
            this.shield = 0;
            this.speedMultiplier = 1.0;
            this.slowAmount = 0;
            this.invisible = false;
            this.cantAttack = false;
            this.damageReduction = 0;
            this._popTextLastSent = {};
            // 死亡时强制关闭商店（Game._syncShopState 会据此补发 S2CCloseShop）
            this.isShopOpen = false;
            this.shopJustOpened = false;
            if (this._openShop) {
                this._openShop.openedBy.delete(this.sessionId);
                this._openShop = null;
            }
            console.log(`Player ${this.sessionId} 无法复活（基地被毁或加时赛），保持阵亡状态`);
            return;
        }

        // 可复活：正常重生
        this.dead = false;

        // 检查是否有有效的前哨站自定义重生点
        if (this.customSpawnOutpost && this.customSpawnOutpost.isSpawnValid(this)) {
            const outpost = this.customSpawnOutpost;
            this.x = outpost.data.x;
            this.y = outpost.data.y;
            console.log(
                `[Outpost] ${this.sessionId} 在前哨站 ${outpost.data.id} 重生 ` +
                `(${this.x.toFixed(0)}, ${this.y.toFixed(0)})`
            );
        } else {
            // 默认回基地
            this.x = this.team === 'A' ? 1280 : 1280;
            this.y = this.team === 'A' ? 6840 : 360;
            // 清除失效的引用
            this.customSpawnOutpost = null;
        }
        // 更新碰撞盒
        this.hitbox.x = this.x - 25;
        this.hitbox.y = this.y - 25;
        this.health = this.args.health;
        this.speed.set(0, 0);
        this.knockback.set(0, 0);
        this.buffs = [];
        this._strengthMultiplier = 1.0;
        this._reboundPercent = 0;
        this.stunned = false;
        this.shield = 0;
        this.speedMultiplier = 1.0;
        this.slowAmount = 0;
        this.invisible = false;
        this.cantAttack = false;
        this.damageReduction = 0;
        // 清空伤害漂浮文字节流记录
        this._popTextLastSent = {};
        // 重置商店状态（死亡时强制关闭商店，Game._syncShopState 会补发 S2CCloseShop）
        this.isShopOpen = false;
        this.shopJustOpened = false;
        this.canShop = false;
        this.shopTarget = null;
        // 死亡不清空物品栏（保留道具）
        // 如果希望死亡掉落，可取消下面注释：
        // this.inventory.clear();
        if (this._openShop) {
            this._openShop.openedBy.delete(this.sessionId);
            this._openShop = null;
        }
    }

    giveBuff(buff) {
        this.buffs.push(buff);
        if (buff.onApply) {
            buff.onApply(this);
        }
    }

    takeKnockback(knockbackVector) {
        this.knockback.add(knockbackVector);
    }

    // ======================== 道具使用系统 ========================

    /**
     * 获取玩家面朝方向（单位向量）
     * 优先使用瞄准方向（手柄右摇杆 / 触屏瞄准摇杆 / 世界坐标点击），
     * 其次为最近一次移动方向，最后根据 dir 判断左右
     * @returns {Vec2}
     */
    getFacingDirection() {
        // 手柄 / 触屏瞄准优先（右摇杆、瞄准摇杆、世界坐标点击）
        if (this._aimUntil > Date.now() && this.aimDir.lengthSq() > 0.001) {
            return this.aimDir.clone();
        }
        if (this.lastMoveDir && this.lastMoveDir.lengthSq() > 0.001) {
            return this.lastMoveDir.clone();
        }
        // 静止时根据 dir 判断：90 = 右, -90 = 左
        return new Vec2(this.dir > 0 ? 1 : -1, 0);
    }

    /**
     * 通过物品栏槽位使用道具（快捷键 1-0 触发）
     * @param {number} slotIndex - 槽位索引 0-9
     * @returns {boolean} 是否成功使用
     */
    _useItemBySlot(slotIndex) {
        const sortedItems = this.inventory.serialize();
        if (slotIndex >= sortedItems.length) return false;

        const itemData = sortedItems[slotIndex];
        if (!itemData || itemData.count <= 0) return false;

        return this.useItem(itemData.itemId);
    }

    /**
     * 使用指定道具
     * @param {string} itemId - 道具 ID
     * @param {Object} [options] - 可选参数
     * @param {import('../world.js').default} [options.world]
     * @param {Object<string, Player>} [options.players]
     * @returns {boolean} 是否成功使用
     */
    useItem(itemId, options = {}) {
        const config = ITEM_CONFIG[itemId];
        if (!config) {
            console.warn(`[ItemUse] ${this.sessionId}: 未知道具 ${itemId}`);
            return false;
        }

        if (this.inventory.count(itemId) <= 0) {
            console.log(`[ItemUse] ${this.sessionId}: 没有道具 ${config.name}`);
            return false;
        }

        if (!this.inventory.usesCooledDown(itemId)) {
            const remaining = this.inventory.getItemCdRemaining(itemId);
            console.log(`[ItemUse] ${this.sessionId}: 道具 ${config.name} 冷却中, 剩余 ${remaining}ms`);
            return false;
        }

        let success = false;
        // 从 options 中解构世界/玩家引用（此前直接引用未声明的 world/players 变量，
        // 任何实际使用道具都会抛出 ReferenceError: world is not defined）
        const { world, players } = options;
        // 若未传入 world/players，使用 tick 中存储的引用
        const effectiveWorld = world || this._worldRef;
        const effectivePlayers = players || this._playersRef;

        switch (config.type) {
            case 'consumable': success = this._useConsumable(config); break;
            case 'placeable': success = this._usePlaceable(config, effectiveWorld); break;
            case 'projectile': success = this._useProjectile(config, effectiveWorld); break;
            case 'utility': success = this._useUtility(config); break;
            default:
                console.warn(`[ItemUse] 未知道具类型: ${config.type}`);
                return false;
        }

        if (success) {
            this.inventory.remove(itemId, 1);
            this.inventory.setItemCooldown(itemId);
            console.log(`[ItemUse] ${this.sessionId} 使用了 ${config.name}, 剩余 ${this.inventory.count(itemId)} 个`);
        }

        return success;
    }

    /**
     * 使用消耗品：直接治疗
     * @private
     */
    _useConsumable(config) {
        const healAmount = config.data.healAmount || 0;
        if (healAmount <= 0) return false;
        const oldHealth = this.health;
        this.health = Math.min(this.maxHealth, this.health + healAmount);
        console.log(`[ItemUse] ${this.sessionId} 使用 ${config.name}, 回复 ${this.health - oldHealth} HP (${this.health}/${this.maxHealth})`);
        return true;
    }

    /**
     * 使用放置物：在脚下创建道具实体
     * @private
     */
    _usePlaceable(config, world) {
        if (!world) { console.warn(`[ItemUse] _usePlaceable 需要 world 参数`); return false; }
        const data = config.data;
        let entity = null;
        switch (config.id) {
            case 'bomb': entity = new BombEntity(this.x, this.y, data, this.sessionId); break;
            case 'landmine': entity = new LandmineEntity(this.x, this.y, data, this.sessionId, this.team); break;
            case 'fragGrenade': entity = new FragGrenadeEntity(this.x, this.y, data, this.sessionId); break;
            case 'smokeGrenade': entity = new SmokeGrenadeEntity(this.x, this.y, data, this.sessionId, this.team); break;
            case 'freezeTrap': entity = new FreezeTrapEntity(this.x, this.y, data, this.sessionId, this.team); break;
            case 'healingTotem': entity = new HealingTotemEntity(this.x, this.y, data, this.sessionId, this.team); break;
            default: console.warn(`[ItemUse] 未处理的放置物类型: ${config.id}`); return false;
        }
        if (entity) {
            world.addItemEntity(entity);
            console.log(`[ItemUse] ${this.sessionId} 放置 ${config.name} 于 (${this.x.toFixed(0)}, ${this.y.toFixed(0)})`);
            return true;
        }
        return false;
    }

    /**
     * 使用投射物：发射飞行道具
     * @private
     */
    _useProjectile(config, world) {
        if (!world) { console.warn(`[ItemUse] _useProjectile 需要 world 参数`); return false; }
        const data = config.data;
        const direction = this.getFacingDirection();
        let entity = null;
        switch (config.id) {
            case 'fireball': entity = new FireballEntity(this.x, this.y, direction, data, this.sessionId); break;
            case 'flashBang': entity = new FlashBangEntity(this.x, this.y, direction, data, this.sessionId); break;
            case 'poisonDart': entity = new PoisonDartEntity(this.x, this.y, direction, data, this.sessionId); break;
            default: console.warn(`[ItemUse] 未处理的投射物类型: ${config.id}`); return false;
        }
        if (entity) {
            world.addItemEntity(entity);
            console.log(`[ItemUse] ${this.sessionId} 发射 ${config.name} 方向 (${direction.x.toFixed(2)}, ${direction.y.toFixed(2)})`);
            return true;
        }
        return false;
    }

    /**
     * 使用功能道具：应用 buff 或特殊效果
     * @private
     */
    _useUtility(config) {
        const data = config.data;
        switch (config.id) {
            case 'teleportScroll': {
                if (this.inventory.isChannelingTeleport) {
                    console.log(`[ItemUse] ${this.sessionId}: 已在引导回城中`);
                    return false;
                }
                this.inventory.isChannelingTeleport = true;
                this.inventory.teleportChannelRemaining = data.channelTime || 5000;
                console.log(`[ItemUse] ${this.sessionId} 开始引导回城, 需要 ${this.inventory.teleportChannelRemaining}ms`);
                return true;
            }
            case 'speedPotion': {
                const SpeedBuffClass = getBuffClassById('speed');
                this.giveBuff(new SpeedBuffClass({ id: 'speed', level: Math.round(data.speedBoost * 100), time: data.duration || 8000 }));
                return true;
            }
            case 'invisibleCloak': {
                const InvisibleBuffClass = getBuffClassById('invisible');
                this.giveBuff(new InvisibleBuffClass({ id: 'invisible', level: Math.round(data.dmgReduction * 100), time: data.duration || 4000 }));
                return true;
            }
            case 'shieldStone': {
                const ShieldBuffClass = getBuffClassById('shield');
                this.giveBuff(new ShieldBuffClass({ id: 'shield', level: data.shieldAmount || 500, time: data.duration || 10000 }));
                return true;
            }
            case 'thornArmor': {
                const ReboundBuffClass = getBuffClassById('rebound');
                this.giveBuff(new ReboundBuffClass({ id: 'rebound', level: data.reflectPercent || 30, time: data.duration || 6000 }));
                return true;
            }
            default:
                console.warn(`[ItemUse] 未处理的功能道具类型: ${config.id}`);
                return false;
        }
    }

    /**
     * 处理回城卷轴引导（每 tick 调用）
     * 检查引导进度和中断条件
     */
    processTeleportChannel() {
        const inv = this.inventory;
        if (!inv.isChannelingTeleport) return;

        // 移动中断引导
        if (this.dx !== 0 || this.dy !== 0) {
            console.log(`[Teleport] ${this.sessionId}: 移动中断回城引导`);
            inv.isChannelingTeleport = false;
            inv.teleportChannelRemaining = 0;
            return;
        }

        inv.teleportChannelRemaining -= Player.TICK_MS;

        if (inv.teleportChannelRemaining <= 0) {
            inv.isChannelingTeleport = false;
            inv.teleportChannelRemaining = 0;
            this.x = this.team === 'A' ? 1280 : 1280;
            this.y = this.team === 'A' ? 6840 : 360;
            this.hitbox.x = this.x - 25;
            this.hitbox.y = this.y - 25;
            this.speed.set(0, 0);
            this.knockback.set(0, 0);
            console.log(`[Teleport] ${this.sessionId} 回城成功 → (${this.x.toFixed(0)}, ${this.y.toFixed(0)})`);
        }
    }
}

export default Player;
