import Entity from "./entity.js";

/**
 * ClientText — 客户端文本实体（cloneType: 'text'）
 *
 * 用于在客户端渲染一条文本（玩家 HUD / 头顶交互提示等）。
 *
 * ── 渲染数据约定（与客户端渲染器对齐）──────────────────────
 *   cloneType: 'text'    — 客户端据此创建文本渲染对象（而非贴图实体）
 *   text: string         — 文本内容
 *   textColor: '#RRGGBB' — 文本颜色（# 十六进制字符串）
 *   isFixed: true        — true = 屏幕固定坐标（0~100）；false = 世界坐标
 *   x, y                 — 位置（isFixed=true 时为视口归一化坐标 0~100）
 * ─────────────────────────────────────────────────────────
 *
 * 生命周期约定：客户端专属文本（右上角状态效果列表、交互提示等）统一使用
 * 本类；使用完毕后必须调用 Player.removeClientText / removeAllClientTexts
 * 删除 —— 增量渲染会据此向所属玩家发送 { type:'delete', id } 删除包，
 * 通知客户端停止跟踪并释放缓存。
 */
class ClientText extends Entity {
    constructor({ id, x, y, text, textColor, isFixed = true, z_index = 1000 }) {
        super({
            id,
            type: "text",
            x,
            y,
            asset: "text",
            dir: 0,
            isShowed: true,
            width: 0,
            height: 0,
            z_index,
        });
        // 客户端对象类型：text → 渲染为文本而非贴图
        this.data.cloneType = "text";
        // 文本内容
        this.data.text = String(text ?? "");
        // 文本颜色（# 十六进制，如 '#ff4444'）
        this.data.textColor = textColor || "#ffffff";
        // true = 屏幕固定坐标（0~100）；false = 世界坐标
        this.data.isFixed = isFixed;
    }

    /**
     * 更新文本内容与颜色
     * （渲染指纹由 Game._refreshRenderFingerprints 自动感知变化并增量推送）
     * @param {string} text
     * @param {string} [textColor] — '#RRGGBB'
     */
    setText(text, textColor) {
        this.data.text = String(text ?? "");
        if (textColor) this.data.textColor = textColor;
    }

    /**
     * 更新位置
     * @param {number} x
     * @param {number} y
     */
    setPosition(x, y) {
        this.data.x = x;
        this.data.y = y;
    }
}

export default ClientText;
