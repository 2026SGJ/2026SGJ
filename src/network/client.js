import { Client } from 'colyseus.js';
import { type, Schema, MapSchema } from '@colyseus/schema';
import logger from '../../logger/index.js';

class Player extends Schema {
  constructor() {
    super();
    this.name = "";
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.sessionId = "";
    this.uuid = "";
    this.extra = "";
  }
}
type("string")(Player.prototype, "name");
type("number")(Player.prototype, "x");
type("number")(Player.prototype, "y");
type("number")(Player.prototype, "rotation");
type("string")(Player.prototype, "sessionId");
type("string")(Player.prototype, "uuid");
type("string")(Player.prototype, "extra");

class GameState extends Schema {
  constructor() {
    super();
    this.onlineCount = 0;
    this.extra = "";
    this.players = new MapSchema();
  }
}
type("number")(GameState.prototype, "onlineCount");
type("string")(GameState.prototype, "extra");
type({ map: Player })(GameState.prototype, "players");

const joinRoom = async (server, roomType, projectId, roomId, auth) => {
    logger.debug(`[client] joinOrCreate 开始: server=${server}, roomType=${roomType}, gid=${projectId}-${roomId}`);
    const client = new Client(server, {
        headers: {
            'Cookie': auth.cookie
        }
    });
    try {
        const room = await client.joinOrCreate(roomType, {
            name: auth.name,
            uuid: auth.uuid,
            gid: `${projectId}-${roomId}`,
            extra: auth.extra,
            filter: { name: 'match'}
        }, GameState);
        logger.log(`[client] joinOrCreate 成功: sessionId=${room.sessionId}, roomId=${room.id}`);
        logger.debug(`[client] room 对象已创建: sessionId=${room.sessionId}, name=${room.name}`);
        return room;
    } catch (error) {
        logger.error(`[client] joinOrCreate 失败: ${error.message}`, error);
        throw error;
    }
};

export { joinRoom };
