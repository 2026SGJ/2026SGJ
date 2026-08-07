import Game from "./game/index.js";
import process from 'process';

// --no-wait：测试模式参数。首个真人玩家进入匹配后，不再等待 120 秒倒计时，
// 立即补满 8 人（瞬间创建 7 个人机）并直接开始对局。
const NO_WAIT = process.argv.includes('--no-wait');
if (NO_WAIT) {
	console.log('[Match] --no-wait 测试模式已启用：首个玩家进入即满员开赛，不等待倒计时');
}

const game = new Game({ noWait: NO_WAIT });

process.on('SIGINT', () => {
    game.end();
    process.exit();
});
