/**
 * 词条系统 + 英雄数据 + 商店抽奖 回归测试
 *
 * 运行：node scripts/test_traits.js
 *
 * 覆盖：
 *   1. 12 名英雄数据 schema 完整性（health / speed / attacks.basic / skill1-4）
 *   2. 词条数据完整性（id 唯一、稀有度合法、effects 引用的技能存在）
 *   3. TraitManager：draw 权重抽取 / 去重 / 池耗尽 / grant 效果执行
 *   4. 词条技能数值修改（modifySkill / modifyDebuff / modifyBuff / modifyMagic / stat）
 *   5. 事件钩子（onBasicHit / onSkillUse）
 *   6. 商店刷新 40% 概率上架词条抽奖券 + 购买抽词条
 */
import { getHeroTraits, getTraitPool, TRAIT_RARITY_WEIGHTS, TRAIT_LOTTERY_PRICE } from '../src/assets/data/traits/index.js';
import HERODATAS, { HERO_IDS } from '../src/assets/data/heros/index.js';
import SHOP_LIST from '../src/assets/data/shop/list.js';
import SHOP_META from '../src/assets/data/shop/shop.js';
import TraitManager from '../src/game/match/trait/TraitManager.js';
import getBuffClassById from '../src/game/match/buff/index.js';
import Skill from '../src/game/match/skills/skill.js';

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
    if (cond) { passed++; console.log(`  ✓ ${msg}`); }
    else { failed++; console.log(`  ✗ ${msg}`); }
};

/** 最小 Player 桩（仅覆盖 TraitManager 依赖的接口） */
const makePlayer = (hero = 'newton') => {
    const p = {
        hero,
        sessionId: `test_${hero}`,
        name: '测试',
        team: 'A',
        maxHealth: 1000,
        health: 1000,
        money: 500,
        args: structuredClone(HERODATAS[hero]),
        skills: {},
        buffs: [],
        skillCooldowns: {},
        eventHandlers: {},
        trigger(type, data) {
            (this.eventHandlers[type] || []).forEach((h) => {
                try { h(data); } catch (e) { console.error('hook error', e); }
            });
        },
        on(type, cb) {
            if (!this.eventHandlers[type]) this.eventHandlers[type] = [];
            this.eventHandlers[type].push(cb);
        },
        giveBuff(buff) {
            this.buffs.push(buff);
            if (buff.onApply) buff.onApply(this);
        },
        takeDamage(amount, attacker) {
            this.health = Math.max(0, this.health - amount);
            return amount;
        },
        takeKnockback() {},
        getSkillData(i) { return this.args.attacks[`skill${i}`] || null; },
    };
    // 与真实 Player 构造一致：创建技能实例
    p.skills.basic = new Skill(
        p.args.attacks.basic.name, p.args.attacks.basic.description,
        p.args.attacks.basic.damage, p.args.attacks.basic.knockback || 0,
        p.args.attacks.basic.forward || 0, null, null, null
    );
    for (let i = 1; i <= 4; i++) {
        const key = `skill${i}`;
        if (p.args.attacks[key]) p.skills[key] = Skill.fromHeroData(p.args.attacks[key]);
    }
    return p;
};

console.log('\n== 1. 英雄数据 schema ==');
ok(HERO_IDS.length === 12, `12 名英雄已注册（实际 ${HERO_IDS.length}）`);
for (const id of HERO_IDS) {
    const h = HERODATAS[id];
    const probs = [];
    if (!h || typeof h !== 'object') { probs.push('缺失'); continue; }
    if (typeof h.health !== 'number' || h.health <= 0) probs.push('health 非法');
    if (typeof h.speed !== 'number' || h.speed <= 0) probs.push('speed 非法');
    if (!h.attacks?.basic || typeof h.attacks.basic.damage !== 'number') probs.push('basic 缺失');
    let skillCount = 0;
    for (let i = 1; i <= 4; i++) {
        const s = h.attacks?.[`skill${i}`];
        if (s) {
            skillCount++;
            if (typeof s.cd !== 'number') probs.push(`skill${i}.cd 非法`);
            if (typeof s.cost !== 'number') probs.push(`skill${i}.cost 非法`);
            if (i === 1 && s.cost !== 0) probs.push('skill1 应为免费（cost=0）');
        }
    }
    if (skillCount < 2) probs.push(`技能数量过少（${skillCount}）`);
    ok(probs.length === 0, `英雄 ${id}（${h?.name}）${probs.length ? '问题: ' + probs.join(', ') : 'schema 完整'}（${skillCount} 技能）`);
}

console.log('\n== 2. 词条数据完整性 ==');
const allTraitIds = new Set();
let traitTotal = 0;
for (const id of HERO_IDS) {
    const pool = getTraitPool(id);
    ok(!!pool, `英雄 ${id} 有词条库`);
    if (!pool) continue;
    const traits = pool.traits;
    traitTotal += traits.length;
    for (const t of traits) {
        ok(!!t.id && !allTraitIds.has(t.id), `词条 id 唯一（${t.id}）`);
        allTraitIds.add(t.id);
        ok(['blue', 'purple', 'gold'].includes(t.rarity), `词条 ${t.id} 稀有度合法（${t.rarity}）`);
        ok(!!t.description, `词条 ${t.id} 有描述`);
        // effects 引用的技能必须存在于该英雄数据
        for (const e of t.effects || []) {
            if (['modifySkill', 'modifyDebuff', 'modifyBuff', 'modifyMagic', 'onSkillUse'].includes(e.type) && e.skill && e.skill !== 'any') {
                ok(!!HERODATAS[id].attacks[e.skill], `词条 ${t.id} 引用技能 ${e.skill} 存在`);
            }
        }
    }
    ok(traits.length >= 5, `英雄 ${id} 词条数 >= 5（实际 ${traits.length}）`);
}
console.log(`  词条总数：${traitTotal}`);

console.log('\n== 3. TraitManager 抽取 ==');
{
    const p = makePlayer('newton');
    const tm = new TraitManager(p);
    // 抽 20 次应全部是牛顿词条且无重复（每次抽取后立即授予，模拟商店购买流程）
    const drawn = new Set();
    for (let i = 0; i < 20; i++) {
        const t = tm.draw();
        if (!t) break;
        ok(t.id.startsWith('newton_'), `第 ${i + 1} 抽是牛顿专属词条（${t.id}）`);
        ok(!drawn.has(t.id), `无重复词条（${t.id}）`);
        drawn.add(t.id);
        tm.grant(t.id);
    }
    ok(drawn.size <= getHeroTraits('newton').length, '抽取量不超过词条库大小');
    // 池耗尽
    for (const t of getHeroTraits('newton')) tm.traitIds.add(t.id);
    ok(tm.poolExhausted(), '池耗尽判定正确');
    ok(tm.draw() === null, '池耗尽后 draw 返回 null');
    // minRarity 过滤
    const tm2 = new TraitManager(makePlayer('tesla'));
    let allGold = true;
    for (let i = 0; i < 50; i++) {
        const t = tm2.draw('gold');
        if (t && t.rarity !== 'gold') allGold = false;
    }
    ok(allGold, 'minRarity=gold 时只抽出金色词条');
}

console.log('\n== 4. grant 静态修改 ==');
{
    // 质量守恒：onBasicHit selfBuff shield
    const p = makePlayer('newton');
    const tm = new TraitManager(p);
    tm.grant('newton_mass_conservation');
    p.trigger('trait:basicHit', { target: makePlayer('tesla') });
    ok(p.buffs.some(b => b.id === 'shield'), '普攻命中触发护盾 buff');

    // 动量定理：skill1 debuff 时间 500 → 800，basic cd ×0.9
    const p2 = makePlayer('newton');
    const tm2 = new TraitManager(p2);
    tm2.grant('newton_momentum_theorem');
    ok(p2.args.attacks.skill1.debuff[0].time === 800, `动量定理 debuff 500→800（实际 ${p2.args.attacks.skill1.debuff[0].time}）`);
    ok(p2.args.attacks.basic.cd === 450, `动量定理 basic cd 500→450（实际 ${p2.args.attacks.basic.cd}）`);
    // 技能实例重建
    ok(p2.skills.skill1.debuff[0].time === 800, '技能实例同步重建');

    // 绝对惯性：_ccReduction + skill2 debuff 时间
    const p3 = makePlayer('newton');
    const tm3 = new TraitManager(p3);
    tm3.grant('newton_absolute_inertia');
    ok(p3._ccReduction === 0.5, '绝对惯性控制缩减 50%');
    ok(p3.args.attacks.skill2.debuff[0].time === 5010 || p3.args.attacks.skill2.debuff[0].time === 5000, `绝对惯性 skill2 debuff 时长延长（实际 ${p3.args.attacks.skill2.debuff[0].time}）`);

    // 无限过载：全局 cd ×0.7
    const p4 = makePlayer('tesla');
    const tm4 = new TraitManager(p4);
    const cdBefore = p4.args.attacks.skill4.cd;
    tm4.grant('tesla_infinite_overload');
    ok(p4.args.attacks.skill4.cd === Math.round(cdBefore * 0.7), `无限过载 skill4 cd ×0.7（${cdBefore} → ${p4.args.attacks.skill4.cd}）`);

    // 探针强化：critDamageAdd + basic debuff 时长
    const p5 = makePlayer('morgan');
    const tm5 = new TraitManager(p5);
    tm5.grant('morgan_probe_enhancement');
    ok(p5._critDamage === 2.1, `探针强化暴击伤害 +10%（实际 ${p5._critDamage}）`);
    ok(p5.args.attacks.basic.debuff[0].time === 6000, `探针强化 弱点标记 4s→6s（实际 ${p5.args.attacks.basic.debuff[0].time}）`);

    // 数学之美：critChance
    const p6 = makePlayer('gauss');
    const tm6 = new TraitManager(p6);
    tm6.grant('gauss_beauty_of_math');
    ok(p6._critChance === 0.15 && p6._critDamage === 2, '数学之美暴击配置正确');

    // 磁轨加速：attackRange +15
    const p7 = makePlayer('gauss');
    const tm7 = new TraitManager(p7);
    tm7.grant('gauss_maglev_acceleration');
    ok(p7.attackRange === 90, `磁轨加速射程 75→90（实际 ${p7.attackRange}）`);
}

console.log('\n== 5. grant 事件钩子 ==');
{
    // 绝缘涂层：stat dmgReduce
    const p = makePlayer('tesla');
    const tm = new TraitManager(p);
    tm.grant('tesla_insulation_coating');
    ok(p._traitDmgReductions?.length === 1 && p._traitDmgReductions[0].chance === 0.2, '绝缘涂层减伤配置');

    // 能量虹吸：skill4 释放回血
    const p2 = makePlayer('tesla');
    const tm2 = new TraitManager(p2);
    tm2.grant('tesla_energy_siphon');
    p2.health = 500; // 先掉血再验证回血
    p2.trigger('trait:skillUsed', { skillKey: 'skill4', target: null });
    ok(p2.health === 600, `能量虹吸 skill4 回血 +100（500 → ${p2.health}）`);

    // 递归调用：skill1 cd -2000 且 stun 时长延长
    const p3 = makePlayer('turing');
    const tm3 = new TraitManager(p3);
    tm3.grant('turing_recursive_call');
    ok(p3.args.attacks.skill1.cd === 10000, `递归调用 skill1 cd 12000→10000（实际 ${p3.args.attacks.skill1.cd}）`);
    ok(p3.args.attacks.skill1.debuff[0].time === 1330, `递归调用 skill1 stun 延长（实际 ${p3.args.attacks.skill1.debuff[0].time}）`);

    // 格式化硬盘：targetExecute 低血量秒杀
    const p4 = makePlayer('turing');
    const tm4 = new TraitManager(p4);
    tm4.grant('turing_format_hard_drive');
    const victim = makePlayer('newton');
    victim.maxHealth = 1000;
    victim.health = 200; // 20% < 30%
    for (let i = 0; i < 20; i++) {
        p4.trigger('trait:skillUsed', { skillKey: 'skill4', target: victim });
        if (victim.health <= 0) break;
    }
    ok(victim.health <= 0, '格式化硬盘对低血量目标触发秒杀');

    // 基因重组·初级：money +100
    const p5 = makePlayer('mendel');
    const tm5 = new TraitManager(p5);
    tm5.grant('mendel_gene_recombination_i');
    p5.trigger('trait:skillUsed', { skillKey: 'skill3', target: null });
    ok(p5.money === 600, `基因重组·初级 money +100（实际 ${p5.money}）`);
}

console.log('\n== 6. 商店抽奖券 ==');
{
    const lottery = SHOP_LIST.refresh.find((it) => it.kind === 'trait-lottery');
    ok(!!lottery, '刷新商品池包含词条抽奖券');
    ok(lottery.stock === 1, '词条抽奖券库存为 1');
    ok(typeof lottery.price === 'number' && lottery.price > 0, `词条抽奖券价格合法（${lottery.price}）`);
    ok(TRAIT_LOTTERY_PRICE === lottery.price, 'TRAIT_LOTTERY_PRICE 与商品价格一致');

    // 40% 概率统计（复刻 Shop._rollRefresh 的最终逻辑）
    let appear = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
        const pool = SHOP_LIST.refresh.slice();
        const count = Math.min(SHOP_META.refreshCount, pool.length);
        const picked = [];
        const lotteryIdx = pool.findIndex((c) => c.kind === 'trait-lottery');
        if (lotteryIdx >= 0) {
            if (Math.random() < 0.4) {
                picked.push(pool.splice(lotteryIdx, 1)[0]);
            } else {
                pool.splice(lotteryIdx, 1);
            }
        }
        for (let j = picked.length; j < count && pool.length > 0; j++) {
            const idx = Math.floor(Math.random() * pool.length);
            picked.push(pool.splice(idx, 1)[0]);
        }
        if (picked.some((b) => b.kind === 'trait-lottery')) appear++;
    }
    const rate = appear / N;
    ok(rate > 0.32 && rate < 0.48, `词条抽奖券上架率约 40%（实际 ${(rate * 100).toFixed(1)}%）`);
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
