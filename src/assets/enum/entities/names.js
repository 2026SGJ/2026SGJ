/**
 * 实体资源名称枚举
 *
 * 用于地图上静态交互实体的 asset id 管理。
 * key 为内部标识，value 为客户端渲染用的 asset 字符串。
 */
export default {
    /** 商店实体 — 玩家靠近按下 E 键打开商店界面 */
    SHOP: 'shop',
    /** 前哨站实体（中立状态）— 站在周围 100px 进行占领，占领后可设置重生点 */
    OUTPOST: 'outpost_neutral',
    /** 前哨站实体（A 队占领） */
    OUTPOST_A: 'outpost_A',
    /** 前哨站实体（B 队占领） */
    OUTPOST_B: 'outpost_B',
};
