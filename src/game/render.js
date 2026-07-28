import room from "../network/index.js";

const render = (playerId, renderData) => {
    //room.send('S2CClear')
    for (const i of renderData) {
        let packet = {
            dest: playerId,
            seq: 0,
            data: i
        }
        room.send('S2CRender', JSON.stringify(packet));
    }
    room.send('S2CFlush', JSON.stringify({
        dest: playerId,
        seq: 0
    }));
};

export default render;