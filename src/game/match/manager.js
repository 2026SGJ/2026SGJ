import process from 'process';
import room from '../../network/index.js';
import BotPlayer, { BOT_PREFIX } from './bot/BotPlayer.js';
import { BASE_MAX_HP } from './entity/base.js';

/**
 * MatchManager — 对局匹配与胜负判定管理器
 *
 * 负责整个对局的生命周期：
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 匹配阶段 (matching)                                                    │
 * │   • 真人 >= 2 时启动 120 秒倒计时                                        │
 * │   • 真人满 4 / 6 / 8 人时依次压缩倒计时至 60 / 30 / 5 秒                 │
 * │   • 按剩余时间里程碑补人机：90s→3人 60s→4人 45s→5人 30s→6人 15s→7人 5s→8人 │
 * │   • 新真人加入时优先踢掉房内人机                                          │
 * │   • 每 5 秒通过 S2CChat 广播匹配进度                                       │
 * │   • 玩家可在地图移动，但禁止攻击 / 采矿 / 技能 / 道具 / 商店               │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ 正常对局 (playing) 0 ~ 7 分钟                                            │
 * │   • 敌方存活玩家进入基地判定圈时持续对基地造成伤害（4000 血）              │
 * │   • 基地被毁 → 该队无法复活                                               │
 * │   • 一方玩家死绝 → 另一方获胜                                              │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ 加时赛 (suddenDeath) 7 ~ 10 分钟                                         │
 * │   • 双方都无法复活、无法打开商店                                           │
 * │   • 一方玩家死绝 → 另一方获胜                                              │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ 10 分钟强制结算 (finished)                                                │
 * │   • 依次比较：队伍人数 → 占领前哨站 → 钱总和 → 总击杀 → 平局               │
 * │   • 结算完成后停止主循环并退出进程（预留 beforeExit 回调位置）              │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 人机玩家（BotPlayer）与真人玩家在匹配完成后拥有完全同等地位：
 * 同等参与死亡/复活判定、占领、钱与击杀统计、胜负结算。
 */

/** 游戏阶段枚举 */
export const Phase = Object.freeze({
    MATCHING: 'matching',        // 匹配阶段
    PLAYING: 'playing',          // 正常对局（0 ~ 7 分钟）
    SUDDEN_DEATH: 'suddenDeath', // 加时赛（7 ~ 10 分钟）
    FINISHED: 'finished',        // 已结算，等待退出进程
});

// ---------- 匹配倒计时 ----------
/** 初始倒计时时长（至少 2 名真人时启动）：120 秒 */
const COUNTDOWN_INITIAL_MS = 120_000;
/** 真人人数达到阈值时压缩倒计时（剩余时间大于新时长才生效） */
const COUNTDOWN_SPEEDUP = [
    { humans: 4, ms: 60_000 },   // 4 名真人 → 60 秒
    { humans: 6, ms: 30_000 },   // 6 名真人 → 30 秒
    { humans: 8, ms: 5_000 },    // 8 名真人（满人）→ 5 秒
];
/** 匹配进度广播间隔：5 秒 */
const PROGRESS_BROADCAST_INTERVAL_MS = 5_000;

// ---------- 人机补位里程碑 ----------
/** 按「剩余时间」补人机到「目标总人数」（真人 + 人机） */
const BOT_FILL_SCHEDULE = [
    { remaining: 90_000, target: 3 },   // 剩余 90s → 补到 3 人
    { remaining: 60_000, target: 4 },   // 剩余 60s → 补到 4 人
    { remaining: 45_000, target: 5 },   // 剩余 45s → 补到 5 人
    { remaining: 30_000, target: 6 },   // 剩余 30s → 补到 6 人
    { remaining: 15_000, target: 7 },   // 剩余 15s → 补到 7 人
    { remaining: 5_000,  target: 8 },   // 剩余  5s → 补到 8 人
];

// ---------- 对局时长 ----------
/** 正常对局时长：7 分钟（到点进入加时赛） */
const PLAY_TIME_MS = 7 * 60_000;
/** 强制结算时限：10 分钟 */
const TOTAL_TIME_MS = 10 * 60_000;

// ---------- 基地伤害参数 ----------
/** 每个敌方存活玩家每秒对基地造成的伤害 */
const BASE_DAMAGE_PER_SEC = 25;
/** 攻击基地的判定半径（像素） */
const BASE_DAMAGE_RADIUS = 120;
/** 主循环每秒 tick 数（用于把「每秒伤害」折算成「每 tick 伤害」） */
const TICKS_PER_SEC = 20;

class MatchManager {

    /**
     * @param {import('../index.js').default} game — Game 实例（提供 players / world / end）
     */
    constructor(game) {
        this.game = game;

        /** @type {string} 当前阶段（见 Phase 枚举） */
        this.phase = Phase.MATCHING;

        /** @type {number} 对局开始时间戳（Date.now()） */
        this.gameStartedAt = 0;

        /** @type {boolean} 匹配倒计时是否已启动（真人 >= 2） */
        this.countdownStarted = false;
        /** @type {number} 匹配倒计时结束（开始对局）的时间戳 */
        this.matchStartAt = 0;

        /** @type {number} 上次广播匹配进度的时间戳 */
        this.lastBroadcastAt = Date.now();

        /** @type {Object|null} 结算结果：{ winner, reason, tiebreak } */
        this.result = null;

        // ================================================================
        //  process.on('beforeExit') 预留回调位置
        //  ----------------------------------------------------------------
        //  胜负判定完成后，_finish() 会调用 process.exit() 退出进程。
        //  如需在退出前执行自定义逻辑（战绩上报 / 日志落盘 / 数据持久化等），
        //  请在此回调中编写（注意：beforeExit 仅在事件循环自然清空时触发，
        //  若使用 process.exit() 强制退出则不会触发，届时请改用 exit 事件）。
        // ================================================================
        process.on('beforeExit', () => {
            // TODO: 战绩上报 / 日志落盘 / 数据持久化等自定义逻辑（占位）
        });
    }

    // ====================================================================
    //  主入口：由 Game 主循环每 tick 调用
    // ====================================================================

    /**
     * 每 tick 调度：按当前阶段分发处理
     * 在 matchLoop（玩家行动）之后调用，确保看到最新的死亡/占领/金钱状态。
     */
    tick() {
        switch (this.phase) {
            case Phase.MATCHING:
                this._tickMatching();
                break;
            case Phase.PLAYING:
                this._tickPlaying();
                break;
            case Phase.SUDDEN_DEATH:
                this._tickSuddenDeath();
                break;
            default:
                break; // FINISHED：已结算，不再处理
        }
    }

    // ====================================================================
    //  匹配阶段
    // ====================================================================

    /** 匹配阶段每 tick：广播进度 → 补人机 → 倒计时归零开赛 */
    _tickMatching() {
        const now = Date.now();

        // 每 5 秒广播一次匹配进度（S2CChat）
        if (now - this.lastBroadcastAt >= PROGRESS_BROADCAST_INTERVAL_MS) {
            this.lastBroadcastAt = now;
            this._broadcastProgress();
        }

        // 倒计时尚未启动（真人不足 2 名）：等待更多真人
        if (!this.countdownStarted) return;

        // 按剩余时间里程碑补齐人机
        this._fillBotsByRemaining();

        // 倒计时归零 → 开始对局
        if (now >= this.matchStartAt) {
            this._startGame();
        }
    }

    /**
     * 真人加入回调（Game 层在玩家创建完成后调用）
     *
     * 规则：
     *   1. 房内有人机时优先踢掉人机（为真人腾出位置）
     *   2. 真人 >= 2 → 启动 120 秒倒计时
     *   3. 真人满 4 / 6 / 8 → 压缩倒计时至 60 / 30 / 5 秒
     *
     * @param {string} sessionId — 新加入真人玩家的 sessionId
     */
    onHumanJoined(sessionId) {
        if (this.phase !== Phase.MATCHING) return;

        // 1) 新真人加入：匹配阶段禁止战斗/采矿/技能（仅可移动）
        const newPlayer = this.game.players[sessionId];
        if (newPlayer) {
            newPlayer.canAct = false;

            // 若房内有人机，优先踢掉（真人替换人机）
            if (this.botCount() > 0) {
                this.kickBot(newPlayer.team);
            }
        }

        const humans = this.realPlayerCount();

        // 2) 至少 2 名真人 → 启动 120 秒倒计时
        if (!this.countdownStarted && humans >= 2) {
            this.countdownStarted = true;
            this.matchStartAt = Date.now() + COUNTDOWN_INITIAL_MS;
            console.log(`[Match] 匹配倒计时开始：120 秒（当前 ${humans} 名真人）`);
        }

        // 3) 真人人数达到阈值 → 压缩倒计时（若剩余时间大于新时长）
        for (const { humans: n, ms } of COUNTDOWN_SPEEDUP) {
            if (humans >= n) {
                this.matchStartAt = Math.min(this.matchStartAt, Date.now() + ms);
                console.log(`[Match] 真人达到 ${n} 人，倒计时压缩至 ${ms / 1000} 秒`);
            }
        }
    }

    /**
     * 真人离开回调（Game 层在玩家移除后调用）
     *
     * 规则：
     *   - 匹配中：按当前剩余时间重新补齐人机（维持里程碑人数下限）
     *   - 对局中：补充一个人机到原队伍，维持 4v4 均衡
     *     （人机与真人同等地位，避免人数劣势影响后续结算）
     *
     * @param {string} sessionId — 离开的真人 sessionId
     * @param {string} team      — 离开者所属队伍 'A' | 'B'
     */
    onHumanLeft(sessionId, team) {
        if (this.phase === Phase.MATCHING) {
            // 匹配中：重新保证里程碑人数
            this._fillBotsByRemaining();
        } else if (this.phase === Phase.PLAYING || this.phase === Phase.SUDDEN_DEATH) {
            // 对局中：补一个人机到原队伍，保持 4v4 均衡
            if (this.totalPlayers() < 8) {
                this.addBot(team);
            }
        }
    }

    /** 按当前剩余时间补齐人机到对应里程碑人数 */
    _fillBotsByRemaining() {
        if (!this.countdownStarted) return;

        const remaining = this.matchStartAt - Date.now();
        // 取所有已触达里程碑中「目标人数」最大者（里程碑是累计下限）
        let target = 0;
        for (const { remaining: t, target: n } of BOT_FILL_SCHEDULE) {
            if (remaining <= t) target = Math.max(target, n);
        }
        if (target > 0) this.ensureTotalPlayers(target);
    }

    /**
     * 保证房间总人数（真人 + 人机）达到 target，不足则逐个补人机
     * @param {number} target — 目标总人数
     */
    ensureTotalPlayers(target) {
        let added = 0;
        while (this.totalPlayers() < target && added < 8) {
            this.addBot();
            added++;
        }
    }

    /**
     * 添加一个人机玩家
     * @param {string} [team] — 指定队伍；不传则加入人数较少的队伍（相同则随机）
     * @returns {BotPlayer}
     */
    addBot(team) {
        const chosenTeam = team || this._pickTeamWithFewerPlayers();
        this.game.botCounter++;
        const botId = `${BOT_PREFIX}${this.game.botCounter}`;
        const bot = new BotPlayer(botId, { team: chosenTeam, hero: 'newton' });
        // 行动许可跟随阶段：匹配中仅能移动，对局中可完全行动
        bot.canAct = this.phase === Phase.PLAYING || this.phase === Phase.SUDDEN_DEATH;
        this.game.players[botId] = bot;
        console.log(`[Match] 人机加入: ${botId} → ${chosenTeam} 队（当前共 ${this.totalPlayers()} 人）`);
        return bot;
    }

    /**
     * 踢掉一个人机（为真人让位）
     * 优先踢指定队伍的人机，该队无人机则任意踢一个
     * @param {string} [preferredTeam] — 优先被踢的人机所属队伍
     * @returns {boolean} 是否成功踢出
     */
    kickBot(preferredTeam) {
        const bots = Object.keys(this.game.players).filter(id => id.startsWith(BOT_PREFIX));
        if (bots.length === 0) return false;

        const target =
            bots.find(id => this.game.players[id].team === preferredTeam) || bots[0];
        delete this.game.players[target];
        // 增量渲染下客户端沿用上一帧：被踢人机必须显式通知其他客户端不再跟踪，
        // 否则客户端会持续保留该人机的缓存（幽灵 + 内存泄漏）
        this.game.world.markEntityRemoved({ id: target });
        console.log(`[Match] 人机被踢出（为真人让位）: ${target}`);
        return true;
    }

    /** 挑选人数较少的队伍；两队相同时随机 */
    _pickTeamWithFewerPlayers() {
        let a = 0, b = 0;
        for (const p of Object.values(this.game.players)) {
            if (p.team === 'A') a++;
            else if (p.team === 'B') b++;
        }
        if (a < b) return 'A';
        if (b < a) return 'B';
        return Math.random() < 0.5 ? 'A' : 'B';
    }

    // ====================================================================
    //  正常对局（0 ~ 7 分钟）
    // ====================================================================

    /** 正常对局每 tick：基地伤害 → 7 分钟进加时 → 复活资格 → 死绝判负 */
    _tickPlaying() {
        this._tickBases();       // 敌方存活玩家持续攻击基地

        // 7 分钟到 → 先切换至加时赛，再更新复活资格（避免一 tick 延迟）
        if (Date.now() - this.gameStartedAt >= PLAY_TIME_MS) {
            this._enterSuddenDeath();
        }

        this._updateCanRevive(); // 基地被毁 / 加时赛 → 对应玩家无法复活
        if (this._checkTeamWipe()) return; // 一方死绝 → 判负
    }

    /** 加时赛每 tick：基地伤害 → 复活资格 → 死绝判负 → 10 分钟强制结算 */
    _tickSuddenDeath() {
        this._tickBases();
        this._updateCanRevive();
        if (this._checkTeamWipe()) return;
        // 10 分钟到 → 强制结算
        if (Date.now() - this.gameStartedAt >= TOTAL_TIME_MS) {
            this._judgeByTiebreak();
        }
    }

    /**
     * 基地伤害结算：判定圈内的敌方存活玩家按人数持续对基地造成伤害
     * 基地血量 ≤ 0 时，由 _updateCanRevive 阻止该队玩家复活
     */
    _tickBases() {
        for (const base of this.game.world.bases) {
            if (base.hp <= 0) continue; // 已摧毁

            // 统计判定圈内的敌方存活玩家数量
            let attackers = 0;
            for (const p of Object.values(this.game.players)) {
                if (p.team === base.team) continue;          // 己方不造成伤害
                if (p.dead || p.health <= 0) continue;       // 死亡玩家不造成伤害
                if (Math.hypot(p.x - base.data.x, p.y - base.data.y) > BASE_DAMAGE_RADIUS) continue;
                attackers++;
            }
            if (attackers === 0) continue;

            // 每秒伤害按 tick 折算
            const damage = (BASE_DAMAGE_PER_SEC * attackers) / TICKS_PER_SEC;
            base.hp = Math.max(0, base.hp - damage);

            if (base.hp <= 0) {
                console.log(`[Base] ${base.team} 队基地被摧毁！该队玩家无法复活。`);
                this._sendChat({
                    type: 'base_destroyed',
                    team: base.team,
                    text: `[基地] ${base.team} 队基地被摧毁，该队玩家无法复活！`,
                });
            }
        }
    }

    /**
     * 更新所有玩家的复活资格
     *   - 正常对局：基地血量 > 0 的队伍可复活
     *   - 加时赛：双方都不可复活
     *   - 匹配/已结算：不涉及死亡，保持 false 兜底
     */
    _updateCanRevive() {
        const reviveAllowed = this.phase === Phase.PLAYING;
        for (const p of Object.values(this.game.players)) {
            const base = this.game.world.bases.find(b => b.team === p.team);
            p.canRevive = reviveAllowed && !!base && base.hp > 0;
        }
    }

    // ====================================================================
    //  胜负判定
    // ====================================================================

    /**
     * 检查是否有队伍「玩家死绝」
     * 一方存活玩家为 0 → 另一方获胜；双方同时为 0 → 平局（罕见兜底）
     * @returns {boolean} 是否已触发结算
     */
    _checkTeamWipe() {
        const aliveA = this._countAlive('A');
        const aliveB = this._countAlive('B');

        if (aliveA === 0 && aliveB === 0) {
            this._finish({ winner: null, reason: '双方玩家同时全部阵亡', tiebreak: false });
            return true;
        }
        if (aliveA === 0) {
            this._finish({ winner: 'B', reason: 'A 队玩家全部阵亡', tiebreak: false });
            return true;
        }
        if (aliveB === 0) {
            this._finish({ winner: 'A', reason: 'B 队玩家全部阵亡', tiebreak: false });
            return true;
        }
        return false;
    }

    /** 统计某队存活玩家数（未死亡且血量 > 0，人机与真人同等计算） */
    _countAlive(team) {
        let count = 0;
        for (const p of Object.values(this.game.players)) {
            if (p.team !== team) continue;
            if (p.dead || p.health <= 0) continue;
            count++;
        }
        return count;
    }

    /**
     * 10 分钟强制结算（按规则依次比较）：
     *   1. 队伍人数多者胜
     *   2. 占领前哨站多者胜
     *   3. 钱总和多者胜
     *   4. 总击杀数高者胜
     *   5. 全部相同 → 平局
     */
    _judgeByTiebreak() {
        const stats = this._collectTeamStats();
        const A = stats.A;
        const B = stats.B;

        let winner = null;
        if (A.roster !== B.roster) {
            winner = A.roster > B.roster ? 'A' : 'B';          // ① 队伍人数
        } else if (A.outposts !== B.outposts) {
            winner = A.outposts > B.outposts ? 'A' : 'B';      // ② 占领前哨站
        } else if (A.money !== B.money) {
            winner = A.money > B.money ? 'A' : 'B';            // ③ 钱总和
        } else if (A.kills !== B.kills) {
            winner = A.kills > B.kills ? 'A' : 'B';            // ④ 总击杀
        } // ⑤ 全部相同 → 平局（winner 保持 null）

        console.log(
            `[Match] 10 分钟强制结算 | A: 人数=${A.roster} 前哨站=${A.outposts} 钱=${A.money} 击杀=${A.kills} | ` +
            `B: 人数=${B.roster} 前哨站=${B.outposts} 钱=${B.money} 击杀=${B.kills}`
        );
        this._finish({ winner, reason: '10 分钟强制结算', tiebreak: true });
    }

    /**
     * 收集两队结算统计：队伍人数 / 钱总和 / 总击杀 / 占领前哨站数
     * （人机与真人同等计入）
     * @returns {{A: {roster:number,money:number,kills:number,outposts:number}, B: Object}}
     */
    _collectTeamStats() {
        const stats = {
            A: { roster: 0, money: 0, kills: 0, outposts: 0 },
            B: { roster: 0, money: 0, kills: 0, outposts: 0 },
        };
        for (const p of Object.values(this.game.players)) {
            if (!stats[p.team]) continue;
            stats[p.team].roster++;
            stats[p.team].money += p.money || 0;
            stats[p.team].kills += p.kills || 0;
        }
        for (const o of this.game.world.outposts) {
            if (o.state.owner && stats[o.state.owner]) {
                stats[o.state.owner].outposts++;
            }
        }
        return stats;
    }

    /**
     * 对局结算（幂等，仅执行一次）
     *   - 全员停止行动
     *   - 通过 S2CChat 广播结果
     *   - 停止主循环，延迟退出进程（beforeExit 回调位置见构造函数）
     *
     * @param {{winner: string|null, reason: string, tiebreak: boolean}} result
     */
    _finish(result) {
        if (this.phase === Phase.FINISHED) return; // 只结算一次
        this.phase = Phase.FINISHED;
        this.result = result;

        // 全员停止行动
        for (const p of Object.values(this.game.players)) {
            p.canAct = false;
            p.attacking = false;
            p.usingSkill = false;
            p.mining = false;
        }

        const winnerText = result.winner ? `${result.winner} 队获胜` : '平局';
        this._sendChat({
            type: 'game_result',
            winner: result.winner,
            reason: result.reason,
            text: `[结算] ${result.reason} → ${winnerText}`,
        });
        console.log(`[Match] 胜负判定完成: ${result.reason} → ${winnerText}`);

        // 停止主循环，延迟退出让网络包刷出
        this.game.end();
        setTimeout(() => process.exit(0), 1000);
    }

    // ====================================================================
    //  阶段切换
    // ====================================================================

    /** 匹配完成 → 开始对局 */
    _startGame() {
        if (this.phase !== Phase.MATCHING) return;
        this.phase = Phase.PLAYING;
        this.gameStartedAt = Date.now();

        // 全员解锁行动（人机与真人同等地位）
        for (const p of Object.values(this.game.players)) {
            p.canAct = true;
        }

        // 重置基地血量（固定 4000）
        for (const base of this.game.world.bases) {
            base.hp = base.maxHp || BASE_MAX_HP;
        }

        this._sendChat({
            type: 'game_start',
            text: `[匹配] 匹配完成，战斗开始！${this._teamRosterSummary()}`,
        });
        console.log(`[Match] 对局开始！${this._teamRosterSummary()}`);
    }

    /** 7 分钟到 → 进入加时赛：双方无法复活、无法打开商店 */
    _enterSuddenDeath() {
        if (this.phase !== Phase.PLAYING) return;
        this.phase = Phase.SUDDEN_DEATH;

        this._sendChat({
            type: 'sudden_death',
            text: '[加时] 7 分钟已到！双方玩家无法复活，也无法打开商店！',
        });
        console.log('[Match] 进入加时赛（7 分钟）：双方无法复活、无法打开商店');
    }

    // ====================================================================
    //  对外查询
    // ====================================================================

    /** 房间内总玩家数（真人 + 人机） */
    totalPlayers() {
        return Object.keys(this.game.players).length;
    }

    /** 房间内人机数量 */
    botCount() {
        return Object.keys(this.game.players).filter(id => id.startsWith(BOT_PREFIX)).length;
    }

    /** 房间内真人数量 */
    realPlayerCount() {
        return this.totalPlayers() - this.botCount();
    }

    /** 当前是否允许打开商店（仅正常对局；匹配中与加时赛禁止） */
    canOpenShop() {
        return this.phase === Phase.PLAYING;
    }

    /** 当前是否允许使用道具（正常对局与加时赛允许，匹配中禁止） */
    canUseItems() {
        return this.phase === Phase.PLAYING || this.phase === Phase.SUDDEN_DEATH;
    }

    // ====================================================================
    //  网络广播（S2CChat）
    // ====================================================================

    /**
     * 向所有真人玩家发送 S2CChat 消息（人机无客户端连接，跳过）
     *
     * 数据包格式：{ dest: sessionId, seq: 0, data: { type, text, ... } }
     *
     * @param {Object} data — 聊天数据（type 为消息类别，text 为展示文本）
     */
    _sendChat(data) {
        for (const sessionId of Object.keys(this.game.players)) {
            if (String(sessionId).startsWith(BOT_PREFIX)) continue;
            room.send('S2CChat', JSON.stringify({
                dest: sessionId,
                seq: 0,
                data,
            }));
        }
    }

    /** 广播匹配进度（每 5 秒一次） */
    _broadcastProgress() {
        const humans = this.realPlayerCount();
        const total = this.totalPlayers();

        let text;
        let remaining = null;
        if (!this.countdownStarted) {
            text = `[匹配] 等待玩家加入… 当前 ${humans}/8 名真人（共 ${total} 人）`;
        } else {
            remaining = Math.max(0, Math.ceil((this.matchStartAt - Date.now()) / 1000));
            text = `[匹配] ${humans}/8 名真人（共 ${total} 人），约 ${remaining} 秒后开始战斗！`;
        }

        this._sendChat({
            type: 'match_progress',
            text,
            phase: this.phase,
            humans,
            total,
            remaining,
        });
        console.log(`[Match] 进度广播: ${text}`);
    }

    /** 生成双方阵容摘要（用于日志与广播） */
    _teamRosterSummary() {
        let a = 0, b = 0, ha = 0, hb = 0;
        for (const p of Object.values(this.game.players)) {
            const isBot = String(p.sessionId || '').startsWith(BOT_PREFIX);
            if (p.team === 'A') { a++; if (!isBot) ha++; }
            else if (p.team === 'B') { b++; if (!isBot) hb++; }
        }
        return `A队 ${a} 人（真人 ${ha}） vs B队 ${b} 人（真人 ${hb}）`;
    }
}

export default MatchManager;
