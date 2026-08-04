/**
 * LLM 决策模块 —— 可选的 AI 高层决策
 *
 * 读取 data/llm.json 配置，若 enable === true 则在决策节点调用 LLM API。
 * 若 enable === false 或 API 调用失败/超时，则回退到纯 FSM 决策。
 *
 * 设计要点：
 *   - 异步调用，不阻塞游戏主循环
 *   - 冷却限制（decisionCooldown）防止过高频率
 *   - 超时失败自动回退 FSM
 *   - 缓存最新 LLM 决策，FSM 在缓存有效时优先使用
 */

import fs from 'fs';
import path from 'path';

// ==================== 配置加载 ====================

/** @type {Object|null} LLM 配置缓存 */
let _config = null;
let _configLoaded = false;

function loadConfig() {
    if (_configLoaded) return _config;
    _configLoaded = true;
    try {
        const configPath = path.resolve(process.cwd(), 'data', 'llm.json');
        if (!fs.existsSync(configPath)) {
            console.warn('[LLM] data/llm.json 不存在，LLM 功能不可用');
            _config = { enable: false };
            return _config;
        }
        const raw = fs.readFileSync(configPath, 'utf-8');
        _config = JSON.parse(raw);
        console.log(`[LLM] 配置加载完成, enable=${_config.enable}, model=${_config.model || 'N/A'}`);
    } catch (err) {
        console.error('[LLM] 配置加载失败:', err.message);
        _config = { enable: false };
    }
    return _config;
}

// ==================== 公开接口 ====================

/**
 * 检查 LLM 决策功能是否已启用
 * @returns {boolean}
 */
export function isLLMEnabled() {
    const cfg = loadConfig();
    return cfg.enable === true && !!cfg.apiKey;
}

/**
 * 获取 LLM 配置
 * @returns {Object}
 */
export function getLLMConfig() {
    return loadConfig();
}

/**
 * 构建发送给 LLM 的游戏状态上下文
 *
 * @param {Object} botState - bot 自身状态
 * @param {Object} botState.self    - { x, y, health, maxHealth, money, team, hero }
 * @param {Array}  botState.enemies - 附近敌方玩家列表 [{ id, x, y, health, dist }]
 * @param {Array}  botState.minerals - 附近矿物列表 [{ id, x, y, type, dist }]
 * @param {Array}  botState.shops    - 附近商店列表 [{ id, x, y, dist }]
 * @param {Array}  botState.outposts - 附近前哨站列表 [{ id, x, y, owner, dist }]
 * @param {Array}  botState.items    - 物品栏 [{ itemId, name, count }]
 * @param {string} botState.currentAction - 当前 FSM 状态
 * @returns {Object} LLM 请求消息
 */
export function buildLLMPrompt(botState) {
    const cfg = getLLMConfig();

    const contextText = JSON.stringify({
        self: botState.self,
        enemies: botState.enemies,
        minerals: botState.minerals,
        shops: botState.shops,
        outposts: botState.outposts,
        items: botState.items,
        currentAction: botState.currentAction,
    }, null, 2);

    return {
        model: cfg.model || 'gpt-4o-mini',
        messages: [
            { role: 'system', content: cfg.systemPrompt || '' },
            { role: 'user', content: `当前游戏状态:\n${contextText}\n\n请做出最佳决策。` },
        ],
        max_tokens: cfg.maxTokens || 300,
        temperature: cfg.temperature ?? 0.7,
    };
}

/**
 * 异步调用 LLM API 获取决策
 *
 * 若调用失败（网络错误、超时、解析错误）则返回 null，
 * 由调用方回退到 FSM 规则决策。
 *
 * @param {Object} botState - 同 buildLLMPrompt 参数
 * @returns {Promise<Object|null>} LLM 决策，失败返回 null
 */
export async function queryLLM(botState) {
    const cfg = getLLMConfig();
    if (!isLLMEnabled()) return null;

    const requestBody = buildLLMPrompt(botState);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), cfg.timeout || 5000);

    try {
        const url = `${cfg.baseURL.replace(/\/+$/, '')}/chat/completions`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        });

        if (!response.ok) {
            console.warn(`[LLM] API 返回非 200: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            console.warn('[LLM] 响应 content 为空');
            return null;
        }

        // 尝试从 LLM 响应中提取 JSON
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('[LLM] 响应中未找到有效 JSON:', content.substring(0, 200));
            return null;
        }

        const decision = JSON.parse(jsonMatch[0]);
        console.log(`[LLM] 决策: action=${decision.action}, reason=${decision.reason || 'N/A'}`);
        return decision;
    } catch (err) {
        if (err.name === 'AbortError') {
            console.warn('[LLM] API 调用超时');
        } else {
            console.error('[LLM] API 调用异常:', err.message);
        }
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}
