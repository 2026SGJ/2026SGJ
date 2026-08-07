/**
 * Bot 模块汇总导出
 *
 * 人机玩家系统（人机补位，被视为玩家）：
 *   - BotPlayer: 与真实玩家同等地位的 AI 控制角色（继承 Player，在 players 集合中）
 *   - BotController: 行为树（Behavior Tree）+ 可选 LLM 行为决策引擎
 *   - bt/: 通用行为树库（Selector / Sequence / Condition / Action / Decorator …）
 *   - llmDecision: LLM API 集成（可选）
 *
 * 注意：AI 机器人（工程 / 步兵 / 英雄 / 无人机 / 哨兵）是另一套系统，
 * 不继承 Player、不进 players 集合（不被当作玩家），见
 * ../robot/RobotManager.js 与 ../robot/RobotEntity.js。
 */

export { default as BotPlayer, BOT_PREFIX } from "./BotPlayer.js";
export { default as BotController, BotState } from "./BotController.js";
export * from "./bt/index.js";
export { isLLMEnabled, queryLLM, getLLMConfig } from "./llmDecision.js";
