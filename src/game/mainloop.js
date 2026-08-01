import logger from '../../logger/index.js';

const matchLoop = async (players, world) => {
    const playerCount = Object.keys(players).length;
    if (playerCount > 0) {
        logger.debug(`[mainloop] tick 开始: 玩家数=${playerCount}`);
    }
    for (const i in players) {
        players[i].tick();
    }
};

export {
    matchLoop
};
