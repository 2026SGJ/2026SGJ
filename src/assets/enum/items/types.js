/**
 * 道具类型枚举
 *
 * consumable:  消耗品 — 使用后立即恢复状态（药丸、绷带、急救包）
 * placeable:   放置物 — 使用后在场景中创建实体（炸弹、地雷、破片手雷、烟雾弹）
 * projectile:  投射物 — 发射后会飞行的物体（火球、闪光弹、毒镖）
 * utility:     功能道具 — 特殊效果（回城卷轴、加速药剂、隐形斗篷、护盾石）
 */
export default {
    CONSUMABLE: 'consumable',
    PLACEABLE: 'placeable',
    PROJECTILE: 'projectile',
    UTILITY: 'utility',
};
