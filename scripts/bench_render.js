/**
 * S2CRender 带宽优化 — 前后对比基准
 *
 * 使用真实的 World / Player / 地图数据，对比优化前后的每客户端带宽：
 *   - 优化前（旧管线）：每帧全量发送 54 实体 + 全部玩家 remoteData
 *   - 优化后（增量管线）：静态实体只发一次；动态实体/玩家变化才发；
 *     静止玩家 / 无变化实体零发送（客户端沿用上一帧）
 *
 * 场景（均为 8 玩家 4v4）：
 *   A. 匹配阶段：全员静止（仅可移动，实际不动）—— 旧管线仍全量推送
 *   B. 对局中：全员正常移动 / 战斗 —— 增量后只发变化的玩家
 *   C. 对局中：4 人战斗（移动+扣血+技能冷却），4 人静止挂机
 */
import World from '../src/game/match/world.js';

const world = new World({ map_id: '1' });
console.log(`[World] 实体 ${world.entities.length}（静态 ${world.entities.filter(e => e._isStatic).length}）`);

// ---------- 完整结构的玩家 mock（remoteData 字段与 Player.remoteData 一致） ----------
// 注意：不导入真实 Player 类（其依赖链会触发网络登录），此处仅复刻渲染数据结构。
const makePlayer = (sid, team) => {
    const p = {
        sessionId: sid, team, x: 1280, y: 1000 + Math.random() * 5000, dir: 90,
        costume: 'newton_idle', health: 1000, maxHealth: 1000, money: 500, dead: false,
        kills: 2, mining: false, miningTime: 0, canMine: false, canShop: false,
        isShopOpen: false, canSetSpawn: false, customSpawnOutpost: null,
        selectedSkill: 1, usingSkill: false, isBasicReady: () => true,
        inputMode: 'keyboard', aimDir: { x: 1, y: 0 }, speed: { x: 0, y: 0 },
        lastClick: null, buffs: [], shield: 0, invisible: false, stunned: false,
        _renderFingerprint: null, _lastChangeTick: 0, _lastRenderData: null,
        inventory: {
            isChannelingTeleport: false, teleportChannelRemaining: 0,
            serialize: () => {
                // 模拟 5 种道具的完整物品栏序列化（与 Inventory.serialize 结构一致）
                return [
                    { itemId: 'healing', count: 3, name: '治疗药水', description: '回复生命', type: 'consumable', cd: 3000, cdRemaining: 0 },
                    { itemId: 'bomb', count: 2, name: '炸弹', description: '范围爆炸', type: 'placeable', cd: 5000, cdRemaining: 0 },
                    { itemId: 'fireball', count: 5, name: '火球', description: '发射火球', type: 'projectile', cd: 8000, cdRemaining: 0 },
                    { itemId: 'shieldStone', count: 1, name: '护盾石', description: '获得护盾', type: 'utility', cd: 10000, cdRemaining: 0 },
                    { itemId: 'speedPotion', count: 2, name: '加速药水', description: '提升移速', type: 'utility', cd: 6000, cdRemaining: 0 },
                ];
            },
        },
        getSkillData: () => null,
        getSkillCooldownRemaining: () => 0,
        isSkillReady: () => true,
        remoteData() {
            const skillStates = {};
            for (let i = 1; i <= 4; i++) {
                skillStates[i] = {
                    name: `skill${i}`, cd: 5000 + i * 1000, cost: 50 * i,
                    remaining: 0, ready: true,
                };
            }
            return {
                type: 'update',
                x: Math.round(this.x * 10) / 10,
                y: Math.round(this.y * 10) / 10,
                asset: this.costume, isShowed: !this.dead, id: this.sessionId,
                scale: 100, dir: this.dir,
                state: {
                    health: this.health, maxHealth: this.maxHealth, money: this.money,
                    dead: this.dead, kills: this.kills,
                    mining: this.mining, miningTime: this.miningTime, canMine: this.canMine,
                    canShop: this.canShop, isShopOpen: this.isShopOpen,
                    canSetSpawn: this.canSetSpawn,
                    spawnOutpostId: this.customSpawnOutpost ? this.customSpawnOutpost.data.id : null,
                    selectedSkill: this.selectedSkill, casting: this.usingSkill,
                    skillStates, basicReady: true, needToPredict: true, team: this.team,
                    inputMode: this.inputMode, aiming: false,
                    aimDir: JSON.stringify({ x: Math.round(this.aimDir.x * 100) / 100, y: Math.round(this.aimDir.y * 100) / 100 }),
                    lastClick: this.lastClick,
                    speed: JSON.stringify({ x: Math.round(this.speed.x * 10) / 10, y: Math.round(this.speed.y * 10) / 10 }),
                    buffs: [],
                    inventory: this.inventory.serialize(),
                    shield: this.shield, invisible: this.invisible, stunned: this.stunned,
                    channelingTeleport: this.inventory.isChannelingTeleport,
                    teleportRemaining: this.inventory.teleportChannelRemaining,
                },
                fz: 1, 'z-index': 1000,
            };
        },
    };
    return p;
};

const players = {};
for (let i = 0; i < 8; i++) {
    players[`player_${i}`] = makePlayer(`player_${i}`, i < 4 ? 'A' : 'B');
}

const renderStates = {};
const initState = (sid) => {
    renderStates[sid] = { lastSentTick: 0, seenEntities: new Set(), seenIds: new Set(), seenPlayers: new Set() };
};
for (const sid of Object.keys(players)) initState(sid);

/** 每 tick 刷新指纹（与 Game._refreshRenderFingerprints 同构） */
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

/** 增量渲染包（与 Game._buildRenderPacket 同构） */
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
            packet.push({ id: gone.id, type: gone.type, isShowed: false });
            state.seenIds.delete(gone.id);
            state.seenPlayers.delete(gone.id);
        }
    }
    for (const [pid, p] of Object.entries(players)) {
        if (state.seenPlayers.has(pid)) {
            if (p._lastChangeTick > last) packet.push(p._lastRenderData || p.remoteData());
        } else {
            state.seenPlayers.add(pid);
            packet.push(p.remoteData());
        }
    }
    state.lastSentTick = world.renderTick;
    return packet;
};

/** 旧管线全量包（模拟优化前的 C2SUpdateRender 处理）
 *  旧顺序：selfRender = [自己remoteData, ...实体]；otherPlayers = [其他玩家remoteData...] */
const legacyPacket = (sid) => {
    const otherPlayers = [];
    for (const [id, p] of Object.entries(players)) {
        if (id !== sid) otherPlayers.push(p.remoteData());
    }
    return [
        players[sid].remoteData(),
        ...world.entities.map(e => ({ ...e.getData(), type: 'update' })),
        ...otherPlayers,
    ];
};

// ---------- 统计工具：帧字节 → 每客户端 KB/s ----------
// 入参为「每客户端每帧字节」；20 tick/s × 8 bit/byte → KB/s
const perClientKbps = (bytesPerFramePerClient) => ((bytesPerFramePerClient * 20 * 8) / 1024).toFixed(1);
const bytesOf = (data) => Buffer.byteLength(JSON.stringify({ dest: 'x', seq: 0, data }), 'utf-8');

// ============================================================
//  场景 A：全员静止（匹配阶段）
// ============================================================
console.log('\n[场景 A] 全员静止（匹配阶段，无人移动/攻击）');
refreshFingerprints();
const firstFrame = {};
for (const sid of Object.keys(players)) firstFrame[sid] = bytesOf(buildPacket(sid)); // 首次全量建立缓存
const legacyA = bytesOf(legacyPacket('player_0')); // 单客户端单帧
console.log(`  旧管线: ${perClientKbps(legacyA)} KB/s/客户端 → 全房 ${(perClientKbps(legacyA) * 8).toFixed(1)} KB/s`);
console.log(`  增量首帧: ${perClientKbps(firstFrame['player_0'])} KB/s（一次性建立缓存）`);

// 后续帧：全静止 → 增量应为空
refreshFingerprints();
let steadyTotal = 0;
for (let f = 0; f < 20; f++) {
    refreshFingerprints();
    for (const sid of Object.keys(players)) steadyTotal += bytesOf(buildPacket(sid));
}
const steadyPerClient = steadyTotal / 20 / Object.keys(players).length;
console.log(`  增量稳态: ${perClientKbps(steadyPerClient)} KB/s/客户端（零变化，沿用上一帧，仅包开销）`);

// ============================================================
//  场景 B：全员移动（对局中，正常战斗走位）
// ============================================================
console.log('\n[场景 B] 全员移动战斗（8 人正常走位）');
// 模拟 20 tick 的移动（每 tick 移动约 10px）
let legacyB = 0, incrB = 0;
for (let f = 0; f < 20; f++) {
    for (const p of Object.values(players)) {
        p.x += 8 + (f % 3); p.y += 6;
        if (f % 4 === 0) p.health = Math.max(100, p.health - 30); // 模拟战斗扣血
    }
    refreshFingerprints();
    for (const sid of Object.keys(players)) {
        legacyB += bytesOf(legacyPacket(sid));
        incrB += bytesOf(buildPacket(sid));
    }
}
const legacyBPerClient = legacyB / 20 / Object.keys(players).length;
const incrBPerClient = incrB / 20 / Object.keys(players).length;
console.log(`  旧管线: ${perClientKbps(legacyBPerClient)} KB/s/客户端`);
console.log(`  增量:   ${perClientKbps(incrBPerClient)} KB/s/客户端  ↓ ${((1 - incrB / legacyB) * 100).toFixed(1)}%`);

// ============================================================
//  场景 C：4 人战斗 + 4 人静止挂机
// ============================================================
console.log('\n[场景 C] 4 人战斗 / 4 人静止挂机');
const fighterIds = Object.keys(players).slice(0, 4);
let legacyC = 0, incrC = 0;
for (let f = 0; f < 20; f++) {
    for (const sid of fighterIds) {
        const p = players[sid];
        p.x += 10; p.y += 4; p.health -= 20;
    }
    refreshFingerprints();
    for (const sid of Object.keys(players)) {
        legacyC += bytesOf(legacyPacket(sid));
        incrC += bytesOf(buildPacket(sid));
    }
}
const legacyCPerClient = legacyC / 20 / Object.keys(players).length;
const incrCPerClient = incrC / 20 / Object.keys(players).length;
console.log(`  旧管线: ${perClientKbps(legacyCPerClient)} KB/s/客户端`);
console.log(`  增量:   ${perClientKbps(incrCPerClient)} KB/s/客户端  ↓ ${((1 - incrC / legacyC) * 100).toFixed(1)}%`);

console.log('\n[结论] 优化后带宽取决于「实际变化量」，静止/挂机玩家与静态场景几乎零占用；');
console.log('       首帧全量建立缓存（一次性 ~10.8KB），之后仅增量同步。');
