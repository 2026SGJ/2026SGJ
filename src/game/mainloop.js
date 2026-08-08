/**
 * 游戏主循环
 *
 * 每个 tick 依次：
 * 1. 世界更新（矿物重生、道具实体更新）
 * 2. 所有玩家更新（输入处理、移动、技能、开采）
 * 3. AI 机器人更新（自主移动 / 采集 / 攻击 / 侦查）
 */
const matchLoop = (players, world, robotManager, areaManager) => {
	// 世界级别的每 tick 更新（矿物重生计时 + 道具实体更新）
	world.tick(players);

	for (const sessionId of Object.keys(players)) {
		players[sessionId].tick(players, world, robotManager || null);
	}

	// AI 机器人更新（机器人 ≠ 玩家；由 RobotManager 驱动）
	if (robotManager) {
		robotManager.tick(players, world);
	}

	// 区域效果更新（玩家 / 人机 / AI 机器人进出区块附加与清除效果）
	// 必须在玩家与机器人 tick 之后调用，保证使用最新坐标
	if (areaManager) {
		areaManager.tick(players, robotManager || null);
	}
};

export { matchLoop };
