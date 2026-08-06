/**
 * Bot 模块汇总导出
 *
 * 人机玩家系统：
 *   - BotPlayer: 与真实玩家同等地位的 AI 控制角色
 *   - BotController: 行为树（Behavior Tree）+ 可选 LLM 行为决策引擎
 *   - bt/: 通用行为树库（Selector / Sequence / Condition / Action / Decorator …）
 *   - llmDecision: LLM API 集成（可选）
 */

export { default as BotPlayer, BOT_PREFIX } from './BotPlayer.js';
export { default as BotController, BotState } from './BotController.js';
export * from './bt/index.js';
export { isLLMEnabled, queryLLM, getLLMConfig } from './llmDecision.js';
