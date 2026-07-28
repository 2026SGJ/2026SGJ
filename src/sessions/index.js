import room from '../network/index.js';

let playerList = {};
function PlayerEvent() {
    this.messageHandlers = {};
}
PlayerEvent.prototype.trigger = function (event, message) {
    if (this.messageHandlers[event]) {
        this.messageHandlers[event].forEach(handler => handler(message));
    }
};
PlayerEvent.prototype.on = function (event, handler) {
    if (!this.messageHandlers[event]) {
        this.messageHandlers[event] = [];
    }
    this.messageHandlers[event].push(handler);
};

let playerEvent = new PlayerEvent();
export default playerEvent;

room.onMessage('syscmd:playerRemoved', (message) => {
    const src = message.player.uuid;
    if (playerList[src]) {
        delete playerList[src];
        playerEvent.trigger('playerRemoved', { player: src, event: message.msg });
    }
});

room.onMessage('C2SHandshake', (message) => {
    const src = message.who.extra.uuid;
    if (playerList[src]) {
        console.log(`Duplicate C2SHandshake from ${src} ignored.`);
        room.send('S2CKick', JSON.stringify({
            dest: message.who.sessionId,
            seq: 0,
            data: {
                reason: "Duplicate C2SHandshake"
            }
        }));
        return;
    }
    playerList[src] = message.who.sessionId;
    let resp = {
        dest: message.who.sessionId,
        seq: 0, //暂时不防御重放攻击。未来一定加上seq校验
        data: {/* 暂时不填充数据 */ }
    }
    playerEvent.trigger('beforeNewPlayerAdded', { player: src, event: message.msg });
    room.send('S2CHandshake', JSON.stringify(resp));
    playerEvent.trigger('newPlayerAdded', { player: src, event: message.msg });
});
room.onMessage('C2SKeyboardEvent', (message) => {
    const src = message.who.extra.uuid;
    if (!playerList[src]) {
        console.log(`C2SKeyboardEvent from unknown player ${src} ignored.`);
        return;
    }
    playerEvent.trigger('keyboardEvent', { player: src, event: message.msg });
});
room.onMessage('C2SMouseEvent', (message) => {
    const src = message.who.extra.uuid;
    if (!playerList[src]) {
        console.log(`C2SMouseEvent from unknown player ${src} ignored.`);
        return;
    }
    playerEvent.trigger('mouseEvent', { player: src, event: message.msg });
});