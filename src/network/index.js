import fs from 'fs';
import path from 'path';
import { login } from './session.js';
import { joinRoom } from './client.js';
import logger from '../../logger/index.js';

const configDir = path.join('.', 'data');
if (!fs.existsSync(configDir)) {
    logger.log('[network] data 目录不存在，创建中...');
    fs.mkdirSync(configDir);
}
if (!fs.existsSync(path.join(configDir, 'config.json'))) {
    const defaultConfig = {
        uuid: "your-uuid",
        name: "your-name",
        extra: "",
        password: "your-password",
        server: "wss://mo.ccw.site",
        roomType: "broadcast",
        projectId: "your-project-id",
        roomId: "your-room-id"
    };
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(defaultConfig, null, 4));
    logger.log("[network] 默认配置文件已创建: data/config.json，请填写后重新运行");
    process.exit(0);
}

logger.debug('[network] 读取配置文件...');
const config = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf-8'));
logger.debug(`[network] 配置读取完毕: server=${config.server}, gid=${config.projectId}-${config.roomId}`);

const auth = {
    uuid: config.uuid,
    name: config.name,
    extra: config.extra,
    cookie: await login(config.uuid, config.password)
};

const { server, roomType, projectId, roomId } = config;
logger.debug(`[network] 开始加入房间: ${roomId}`);
const room = await joinRoom(server, roomType, projectId, roomId, auth);

logger.log(`[network] 成功加入房间: ${roomId}, sessionId=${room.sessionId}`);

export default room;
