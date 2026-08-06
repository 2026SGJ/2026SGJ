/**
 * 道具状态枚举
 *
 * idle:       道具在物品栏中 / 商店中待售
 * active:     道具已被放置或正在生效（炸弹倒计时、烟雾持续等）
 * exploding:  爆炸类道具正在爆炸中
 * used:       消耗品已被使用
 */
export default {
    IDLE: 'idle',
    ACTIVE: 'active',
    EXPLODING: 'exploding',
    USED: 'used',
};
