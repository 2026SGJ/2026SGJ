import Game from "./game/index.js";
import process from 'process';

const game = new Game();

process.on('SIGINT', () => {
    game.end();
    process.exit();
});
