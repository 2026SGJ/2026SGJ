/**
 * 游戏主循环
 * 
 * 每个 tick 依次：
 * 1. 世界更新（矿物重生、道具实体更新）
 * 2. 所有玩家更新（输入处理、移动、技能、开采）
 */
const matchLoop = (players, world) => {
    // 世界级别的每 tick 更新（矿物重生计时 + 道具实体更新）
    world.tick(players);

    for (const sessionId of Object.keys(players)) {
        players[sessionId].tick(players, world);
    }
};

export { matchLoop };
