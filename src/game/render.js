import room from "../network/index.js";
import logger from '../../logger/index.js';

const render = (playerId, renderData) => {
    let packet = {
        dest: playerId,
        seq: 0,
        data: renderData
    };
    logger.debug(`[render] 发送 S2CRender: dest=${playerId}, data项数=${renderData.length}`);
    room.send('S2CRender', JSON.stringify(packet));
};

export default render;
