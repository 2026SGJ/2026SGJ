import Game from "./game/index.js";
import process from 'process';
import logger from '../logger/index.js';

logger.log('[main] ========== 服务器启动 ==========');

const game = new Game();

process.on('SIGINT', () => {
    logger.log('[main] SIGINT 收到, 正在关闭...');
    game.end();
    logger.log('[main] 服务器已关闭');
    process.exit();
});
