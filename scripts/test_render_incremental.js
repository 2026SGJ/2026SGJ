/**
 * 渲染增量同步 — 集成测试
 *
 * 隔离网络层（不连接服务器），验证 S2CRender 带宽优化的核心逻辑：
 *   1. 首次渲染全量发送（52 个实体 + 全部玩家），建立客户端缓存
 *   2. 无变化时后续渲染包为空（客户端沿用上一帧 → 零带宽）
 *   3. 实体变化（矿物采集）→ 仅该实体被发送
 *   4. 玩家移动 → 仅该玩家被发送；静止玩家不发送
 *   5. 道具实体创建 / 移除 → 创建时全量、移除时发送 { type:'delete', id } 删除包
 *   6. 玩家移除 → 发送删除包
 *   7. 所有渲染条目 type 恒为 'update'（协议兼容）
 */
import World from '../src/game/match/world.js';
import Entity from '../src/game/match/entity/entity.js';
import BombEntity from '../src/game/match/item/bomb.js';
import { ITEM_CONFIG } from '../src/game/match/item/itemConfig.js';

// ============================================================
//  1. 创建世界（加载真实地图 1.json，52 个实体）
// ============================================================
const world = new World({ map_id: '1' });
console.log(`[World] 实体总数: ${world.entities.length}（静态 ${world.entities.filter(e => e._isStatic).length}）`);

// ============================================================
//  2. 模拟 Game 层核心逻辑（与 src/game/index.js 保持同构）
// ============================================================
const players = {};
const renderStates = {};

const makePlayer = (id) => ({
    sessionId: id,
    x: 1280, y: 3600, dir: 90, costume: 'newton_idle',
    health: 1000,
    _renderFingerprint: null, _lastChangeTick: 0, _lastRenderData: null,
    remoteData() {
        return {
            type: 'update',
            x: Math.round(this.x * 10) / 10,
            y: Math.round(this.y * 10) / 10,
            asset: this.costume,
            id: this.sessionId,
            state: { health: this.health },
        };
    },
});

const initState = (sid) => {
    renderStates[sid] = { lastSentTick: 0, seenEntities: new Set(), seenIds: new Set(), seenPlayers: new Set() };
};

/** 每 tick 刷新实体/玩家渲染指纹（对应 Game._refreshRenderFingerprints） */
const refreshFingerprints = () => {
    world.refreshRenderTicks();
    const tick = world.renderTick;
    for (const p of Object.values(players)) {
        const data = p.remoteData();
        const fp = JSON.stringify(data);
        if (fp !== p._renderFingerprint) {
            p._renderFingerprint = fp;
            p._lastChangeTick = tick;
            p._lastRenderData = data;
        }
    }
};

/** 组装增量渲染包（对应 Game._buildRenderPacket） */
const buildPacket = (sid) => {
    const state = renderStates[sid];
    const packet = [];
    const last = state.lastSentTick;
    for (const e of world.entities) {
        if (state.seenEntities.has(e)) {
            if (e._lastChangeTick > last) packet.push(e.getRenderData());
        } else {
            state.seenEntities.add(e);
            state.seenIds.add(e.data.id);
            packet.push(e.getRenderData());
        }
    }
    for (const gone of world._pendingRemovals) {
        if (state.seenIds.has(gone.id) || state.seenPlayers.has(gone.id)) {
            packet.push({ type: 'delete', id: gone.id });
            state.seenIds.delete(gone.id);
            state.seenPlayers.delete(gone.id);
        }
    }
    for (const [pid, p] of Object.entries(players)) {
        if (state.seenPlayers.has(pid)) {
            if (p._lastChangeTick > last) packet.push(p.remoteData());
        } else {
            state.seenPlayers.add(pid);
            packet.push(p.remoteData());
        }
    }
    state.lastSentTick = world.renderTick;
    return packet;
};

// ============================================================
//  3. 测试用例
// ============================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
    if (cond) { passed++; console.log(`  ✅ ${msg}`); }
    else { failed++; console.log(`  ❌ ${msg}`); }
};

// ---- 场景 A：首次全量 + 无变化空包 ----
console.log('\n[场景 A] 首次全量 / 增量空包');
players.p1 = makePlayer('p1'); players.p2 = makePlayer('p2');
initState('p1'); initState('p2');
refreshFingerprints();

const first = buildPacket('p1');
assert(first.length === world.entities.length + 2, `首次渲染全量: ${first.length} 条（${world.entities.length} 实体 + 2 玩家）`);
assert(first.every(t => t.type === 'update'), '所有条目 type 恒为 update（协议兼容）');
assert(first.some(t => t.id === 'p1') && first.some(t => t.id === 'p2'), '首次渲染包含所有玩家');

const second = buildPacket('p1'); // 无任何变化
assert(second.length === 0, `无变化时渲染包为空（沿用上一帧，零带宽）: ${second.length} 条`);
assert(world.renderTick >= 1, `渲染 tick 已递增: ${world.renderTick}`);

// ---- 场景 B：实体变化（矿物采集）→ 仅该实体发送 ----
console.log('\n[场景 B] 实体变化（矿物采集）');
const mineral = world.minerals[0];
mineral.collect();
refreshFingerprints();
const afterMine = buildPacket('p1');
assert(afterMine.length === 1, `矿物采集后仅发送 1 条: ${afterMine.length} 条`);
assert(afterMine[0]?.id === mineral.data.id, `发送的是被采集的矿物 ${afterMine[0]?.id}`);
assert(afterMine[0]?.isShowed === false, '矿物 isShowed=false（客户端隐藏）');
assert(afterMine[0]?.collected === true, '矿物 collected=true');

// ---- 场景 C：玩家移动 → 仅该玩家发送；静止玩家不发送 ----
console.log('\n[场景 C] 玩家移动增量');
players.p2.x = 1500; // p2 移动
refreshFingerprints();
const moved = buildPacket('p1');
assert(moved.length === 1 && moved[0].id === 'p2', `仅移动的 p2 被发送: ${moved.map(t => t.id).join(',') || '空'}`);
assert(!moved.some(t => t.id === 'p1'), '静止的 p1 不发送（沿用上一帧）');

// p2 先完成首次渲染（建立缓存），随后验证 p1 微小抖动不触发发送
refreshFingerprints();
buildPacket('p2'); // p2 首次全量，建立 seen 缓存
players.p1.x = 1280.04; // 抖动 < 0.1px（裁剪后仍为 1280）
refreshFingerprints();
const jitter = buildPacket('p2');
assert(jitter.length === 0, `0.04px 抖动不触发发送（精度裁剪）: ${jitter.length} 条`);

// ---- 场景 D：道具实体创建 / 移除 ----
console.log('\n[场景 D] 道具实体创建 / 移除');
const bomb = new BombEntity(1400, 3700, ITEM_CONFIG.bomb.data, 'p1');
world.addItemEntity(bomb);
refreshFingerprints();
const bombCreate = buildPacket('p1');
assert(bombCreate.length === 1 && bombCreate[0].id === bomb.data.id, `新炸弹创建即发送: ${bombCreate[0]?.id}`);
assert(bombCreate[0].type === 'update', '炸弹渲染条目 type=update');

// 炸弹移除 → 删除包（客户端停止跟踪并释放缓存）
world.removeItemEntity(bomb);
const bombRemove = buildPacket('p1');
assert(bombRemove.length === 1, `炸弹移除发送删除包: ${bombRemove.length} 条`);
assert(bombRemove[0].type === 'delete' && bombRemove[0].id === bomb.data.id, '删除包 {type:"delete", id}');

// 删除包不重复发送（pendingRemovals 过期清理）
refreshFingerprints();
const later = buildPacket('p1');
assert(later.length === 0, '删除包不重复发送（记录过期清理）');

// ---- 场景 E：玩家移除 → 删除包 ----
console.log('\n[场景 E] 玩家移除');
delete players.p2; // 模拟真实移除（与 Game.playerRemoved 一致：先删 players 再记录）
world.markEntityRemoved({ id: 'p2' });
const playerGone = buildPacket('p1');
assert(playerGone.length === 1 && playerGone[0].type === 'delete' && playerGone[0].id === 'p2', '玩家移除发送 {type:"delete", id} 删除包');

// ---- 场景 F：多客户端独立 seen 状态 ----
console.log('\n[场景 F] 多客户端独立状态');
// p2 已移除，但 p1 的包已经消费了隐藏包；再次构建应无
refreshFingerprints();
const again = buildPacket('p1');
assert(again.length === 0, '隐藏包已被消费，不再重复');

// ============================================================
//  4. 带宽对比（近似）
// ============================================================
console.log('\n[带宽对比]（每客户端每秒, 20 tick/s）');
const firstBytes = Buffer.byteLength(JSON.stringify({ dest: 'p1', seq: 0, data: first }), 'utf-8');
console.log(`  首次全量: ${firstBytes} B/场（一次性）`);
console.log(`  稳态空包: ~${Buffer.byteLength('[]', 'utf-8')} B/tick ≈ 0 KB/s（无变化时）`);
console.log(`  移动玩家: ~${Math.round(firstBytes / (world.entities.length + 2))} B/玩家/帧（仅变化玩家）`);

console.log(`\n========== 测试结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed > 0 ? 1 : 0);
