import room from "../network/index.js";

/**
 * S2CRender — 唯一渲染通道
 *
 * 所有渲染相关内容（世界实体 / 玩家 / isFixed GUI 实体 / 漂浮文字）统一
 * 通过 S2CRender 推送，不再使用独立的 S2CPopText / S2CShop* / S2CInv 等
 * 专用渲染包（见 src/game/index.js 的 _buildRenderPacket 组装逻辑）。
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
