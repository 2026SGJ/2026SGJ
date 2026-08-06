/**
 * 矿物状态枚举
 * 
 * idle:      矿物正常存在，可被开采
 * collected: 矿物已被采集，等待重生（隐藏 / 枯竭态）
 */
export default {
    IDLE: 'idle',
    COLLECTED: 'collected',
};
