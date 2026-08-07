import room from "../network/index.js";

/**
 * S2CRender — 渲染通道
 *
 * 所有渲染相关内容（世界实体 / 玩家 / 漂浮文字）统一通过 S2CRender 推送。
 * 商店界面已与渲染管线解耦：其打开 / 关闭 / 商品清单 / 购买结果经独立
 * 协议包通信（见 src/network/shop.js），不再作为 isFixed GUI 实体渲染。
 *
 * 数据包格式：
 *   { dest: playerId, seq: 0, data: [渲染条目, ...] }
 *
 * @param {string} playerId - 目标玩家 sessionId
 * @param {Object[]} renderData - 增量渲染条目数组
 */
const render = (playerId, renderData) => {
    let packet = {
        dest: playerId,
        seq: 0,
        data: renderData
    };
    room.send('S2CRender', JSON.stringify(packet));
};

export { render };
