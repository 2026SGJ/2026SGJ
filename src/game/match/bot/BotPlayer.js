/**
 * BotPlayer — 人机玩家实体
 *
 * 继承 Player，与真实玩家拥有完全同等的拓扑地位：
 *   - 参与同一游戏循环（tick）
 *   - 在同一 players 映射中
 *   - 拥有相同的战斗/移动/技能/道具/死亡重生逻辑
 *   - 客户端可正常渲染（remoteData 格式一致）
 *
 * 与真实玩家的唯一区别：
 *   - 输入来源：FSM 控制器 + 可选 LLM 决策，而非键盘网络事件
 *   - 不接收网络消息推送（跳过 _syncInventory 等）
 */

import Player from '../player/index.js';
import BotController from './BotController.js';

/** Bot sessionId 前缀，用于在 Game 层识别并跳过网络同步 */
export const BOT_PREFIX = 'bot_';

export default class BotPlayer extends Player {

    /**
     * @param {string} sessionId  — 以 'bot_' 为前缀的唯一 ID
     * @param {Object} data       — 同 Player 构造函数参数
     * @param {string} data.team  — bot 所属队伍
     * @param {string} [data.hero]— 使用的英雄（默认 'newton'）
     */
    constructor(sessionId, data) {
        super(sessionId, {
            team: data.team,
            hero: data.hero || 'newton',
        });

        // 覆写：Bot 不需要通过真实网络发送
        this.sessionId = sessionId;

        /**
         * FSM + LLM 行为控制器
         * @type {BotController}
         */
        this.botController = new BotController({
            team: data.team,
        });

        console.log(
            `[BotPlayer] 人机已创建: sessionId=${sessionId}, ` +
            `team=${data.team}, hero=${data.hero || 'newton'}`
        );
    }

    // ==================== 主 tick 覆写 ====================

    /**
     * 每帧更新：FSM 决策 → 执行动作 → 标准物理/skill/buff 处理
     *
     * 跳过了：
     *   - processEvents()     — Bot 无键盘事件
     *   - processKeyholding() — 由 botController.update() 替代
     *
     * @param {Object<string, Player>} players
     * @param {import('../../world.js').default} world
     */
    tick(players, world) {
        // 存储引用（道具使用等逻辑需要）
        this._worldRef = world;
        this._playersRef = players;

        // ---- 1. FSM + LLM 决策：直接设置 this.dx/dy/attacking/mining 等 ----
        this.botController.update(players, world, this);

        // ---- 2. 环境检测（矿物、商店、前哨站接近判断） ----
        this.updateMiningProximity(world);
        this.updateShopProximity(world);
        this.updateOutpostProximity(world);

        // ---- 3. 采购进度处理 ----
        this.processMining();

        // ---- 4. 移动（碰撞检测 & 速度衰减） ----
        this.move(world);

        // ---- 5. 技能处理（普攻 + 技能释放） ----
        this.processSkills(players);

        // ---- 6. Buff 处理（叠加/过期/效果） ----
        this.processBuffs();

        // ---- 7. 回城卷轴引导 ----
        this.processTeleportChannel();

        // ---- 8. 动画状态 ----
        this.costume = `${this.hero}_${this.animate()}`;
    }

    // ==================== 工具方法 ====================

    /**
     * 判断给定 sessionId 是否为 Bot
     * @param {string} sessionId
     * @returns {boolean}
     */
    static isBotSession(sessionId) {
        return typeof sessionId === 'string' && sessionId.startsWith(BOT_PREFIX);
    }
}
