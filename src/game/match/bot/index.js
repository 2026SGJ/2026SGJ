/**
 * Bot 模块汇总导出
 *
 * 人机玩家系统：
 *   - BotPlayer: 与真实玩家同等地位的 AI 控制角色
 *   - BotController: FSM + 可选 LLM 行为决策引擎
 *   - llmDecision: LLM API 集成（可选）
 */

export { default as BotPlayer, BOT_PREFIX } from './BotPlayer.js';
export { default as BotController, BotState } from './BotController.js';
export { isLLMEnabled, queryLLM, getLLMConfig } from './llmDecision.js';
