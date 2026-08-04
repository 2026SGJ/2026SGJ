import Entity from './entity.js';

/**
 * Outpost — 前哨站实体
 *
 * 10 个前哨站沿地图中轴线 x=1280 均匀分布。
 * 玩家站在周围 100px 范围内即参与占领。
 *
 * 占领规则：
 * - 默认状态为未占领（owner = null），进度 progress = 0。
 * - 每 tick 检查周围 100px 内的所有玩家。
 * - 若只有单一阵营的玩家在范围内：按人数累加进度。
 * - 若双方阵营都有玩家在范围内：进度不变（争夺中）。
 * - 若已被敌方占领：先按人数扣除占领进度，到 0 后切换为中立，再按己方累加。
 * - 进度达到 CAPTURE_MAX (200) 后标记为已占领，不再增加。
 * - 占领中离开范围则保留进度。
 *
 * 重生点设置：
 * - 当 outpost 处于"已占领"状态时，该队伍的玩家可站在 25px 内按 E 设置重生点。
 * - 若敌方开始解除占领（进度下降但尚未归零），已设置的重生点仍可用。
 * - 一旦敌方完成解除占领并开始重新占领，重生点失效。
 *
 * state 字段含义（存储在实体的 state 属性中）：
 *   - state.owner: null | 'A' | 'B'  当前占有方
 *   - state.progress: number         当前占领进度（0 ~ CAPTURE_MAX）
 *   - state.spawnSet: { [sessionId]: boolean } 哪些玩家在此设置了重生点
 *   - state.asset: string            根据 owner 动态切换渲染 asset
 */

/** 占领进度上限 */
const CAPTURE_MAX = 200;
/** 占领检测半径（像素） */
const CAPTURE_RADIUS = 100;
/** 每玩家每 tick 的占领速度 */
const CAPTURE_SPEED_PER_PLAYER = 2;
/** 解除占领（从敌方夺回）每玩家每 tick 的速度 */
const DECAPTURE_SPEED_PER_PLAYER = 2;
/** 设置重生点的交互半径（像素） */
const SPAWN_SET_RADIUS = 25;

class Outpost extends Entity {
    /**
     * @param {Object} data — 来自地图配置的原始数据
     * @param {string} data.id     — 实体唯一 ID
     * @param {number} data.x      — 世界坐标 X
     * @param {number} data.y      — 世界坐标 Y
     * @param {string} data.asset  — 默认渲染 asset
     */
    constructor(data) {
        super(data);

        /**
         * 前哨站运行时状态（通过 remoteData 同步给客户端）
         * @type {{ owner: string|null, progress: number, spawnSet: Object<string, boolean> }}
         */
        this.state = {
            owner: null,       // 当前占有方：null | 'A' | 'B'
            progress: 0,       // 占领进度：0 → 200
            spawnSet: {},      // 已设置重生点的玩家 sessionId 集合
        };
    }

    // ===================== 公共查询接口 =====================

    /**
     * 判断玩家与 outpost 中心点的距离是否在给定半径内
     * @param {number} px - 玩家 X 坐标
     * @param {number} py - 玩家 Y 坐标
     * @param {number} radius - 检测半径
     * @returns {boolean}
     */
    isWithinRange(px, py, radius) {
        const dx = px - this.data.x;
        const dy = py - this.data.y;
        return dx * dx + dy * dy <= radius * radius;
    }

    /**
     * 该玩家是否可在此 outpost 设置重生点
     * - outpost 必须已被己方占领
     * - 玩家必须在 25px 内
     * @param {import('../player/index.js').default} player
     * @returns {boolean}
     */
    canSetSpawn(player) {
        return (
            this.state.owner === player.team &&
            this.isWithinRange(player.x, player.y, SPAWN_SET_RADIUS)
        );
    }

    /**
     * 为该玩家设置重生点
     * @param {import('../player/index.js').default} player
     */
    setSpawn(player) {
        if (!this.canSetSpawn(player)) return;
        // 将玩家挂载到此 outpost 上
        player.customSpawnOutpost = this;
        this.state.spawnSet[player.sessionId] = true;
        console.log(
            `[Outpost] ${player.sessionId} 在 ${this.data.id} 设置重生点 (owner=${this.state.owner})`
        );
    }

    /**
     * 检查该玩家的重生点是否仍然有效
     * 规则：
     * - 如果 outpost 仍被己方占领 → 有效
     * - 如果敌方正在解除占领（进度 > 0 但 owner 仍是己方）→ 仍然有效
     * - 如果敌方已解除占领完毕且正在重新占领（owner 不再是己方）→ 失效
     * @param {import('../player/index.js').default} player
     * @returns {boolean}
     */
    isSpawnValid(player) {
        return this.state.owner === player.team;
    }

    // ===================== 占领逻辑（每 tick 调用） =====================

    /**
     * 每 tick 更新占领进度
     *
     * 逻辑流程：
     * 1. 收集周围 100px 内所有存活玩家，按队伍分组
     * 2. 若只有单队玩家 → 按人数加/减进度
     * 3. 若两队都有 → 进度不变
     * 4. 进度归零后切换 owner，继续累加
     * 5. 达到 CAPTURE_MAX 后锁定
     *
     * @param {Object<string, import('../player/index.js').default>} players
     */
    tickCapture(players) {
        // 收集范围内的玩家，按队伍分组
        const teams = { A: [], B: [] };
        for (const [sessionId, player] of Object.entries(players)) {
            if (player.health <= 0) continue; // 死亡玩家不参与
            if (!this.isWithinRange(player.x, player.y, CAPTURE_RADIUS)) continue;
            teams[player.team].push(sessionId);
        }

        const countA = teams.A.length;
        const countB = teams.B.length;

        // 双方都有人 → 争夺中，进度不变
        if (countA > 0 && countB > 0) return;

        // 范围内无人 → 不变
        if (countA === 0 && countB === 0) return;

        // 单方有人在范围内
        const activeTeam = countA > 0 ? 'A' : 'B';
        const activeCount = activeTeam === 'A' ? countA : countB;

        if (this.state.owner === null) {
            // 中立状态：累加进度
            this.state.progress = Math.min(
                CAPTURE_MAX,
                this.state.progress + activeCount * CAPTURE_SPEED_PER_PLAYER
            );
            // 检查是否达到完全占领
            if (this.state.progress >= CAPTURE_MAX) {
                this.state.owner = activeTeam;
                this.state.progress = CAPTURE_MAX;
                console.log(
                    `[Outpost] ${this.data.id} 被队伍 ${activeTeam} 占领！`
                );
            }
        } else if (this.state.owner === activeTeam) {
            // 己方已在占领中：累加进度（已达上限则不动）
            if (this.state.progress < CAPTURE_MAX) {
                this.state.progress = Math.min(
                    CAPTURE_MAX,
                    this.state.progress + activeCount * CAPTURE_SPEED_PER_PLAYER
                );
            }
        } else {
            // 敌方占领中：按人数扣除占领进度
            this.state.progress -= activeCount * DECAPTURE_SPEED_PER_PLAYER;
            if (this.state.progress <= 0) {
                // 解除占领完成，切换为中立，剩余溢出进度转为己方占领
                const overflow = -this.state.progress;
                this.state.owner = null;
                this.state.progress = Math.min(
                    CAPTURE_MAX,
                    overflow
                );
                console.log(
                    `[Outpost] ${this.data.id} 被队伍 ${activeTeam} 解除占领，` +
                    `开始重新占领 (进度 ${this.state.progress}/${CAPTURE_MAX})`
                );
                // 清除所有敌方重生点
                this.state.spawnSet = {};
            }
        }

        // 根据 owner 动态切换渲染 asset
        if (this.state.owner === 'A') {
            this.data.asset = 'outpost_A';
        } else if (this.state.owner === 'B') {
            this.data.asset = 'outpost_B';
        } else {
            this.data.asset = 'outpost_neutral';
        }
    }

    // ===================== 网络同步 =====================

    /**
     * 扩展基类 getData，附加 state 信息供客户端渲染
     * @returns {Object}
     */
    getData() {
        return {
            ...this.data,
            state: { ...this.state },
        };
    }
}

export { CAPTURE_MAX, CAPTURE_RADIUS, SPAWN_SET_RADIUS };
export default Outpost;