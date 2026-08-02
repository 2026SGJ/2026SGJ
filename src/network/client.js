import { Client } from 'colyseus.js';
import { type, Schema, MapSchema } from '@colyseus/schema';

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
type("number")(Player.prototype, "scale");
type("string")(Player.prototype, "dir");

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
        return room;
    } catch (error) {
        console.error("Failed to join room:", error);
        throw error;
    }
}

export { joinRoom}