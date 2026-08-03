import room from "../network/index.js";

// const render = (playerId, renderData) => {
//     let packet = {
//         dest: playerId,
//         seq: 0,
//         data: renderData
//     }
//     room.send('S2CRender', JSON.stringify(packet));
// };

const renderBatch = (playerId, renderDataBatch) => {
    let packet = {
        dest: playerId,
        seq: 0,
        data: renderDataBatch
    }
    room.send('S2CRenderBatch', JSON.stringify(packet));
};

export default renderBatch;