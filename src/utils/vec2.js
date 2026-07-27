class Vec2 {
    constructor (x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    // ---------- 原地运算 ----------
    add ({ x, y }) {
        this.x += x;
        this.y += y;
        return this;
    }

    sub ({ x, y }) {
        this.x -= x;
        this.y -= y;
        return this;
    }

    scale (s) {
        this.x *= s;
        this.y *= s;
        return this;
    }

    // 向量点积（标量）
    dot ({ x, y }) {
        return this.x * x + this.y * y;
    }

    // 二维叉积（标量，z 分量）
    cross ({ x, y }) {
        return this.x * y - this.y * x;
    }

    // ---------- 几何属性 ----------
    length () {
        return Math.hypot(this.x, this.y);
    }

    lengthSq () {
        return this.x * this.x + this.y * this.y;
    }

    // 归一化（原地），若零向量则不变
    normalize () {
        const len = this.length();
        if (len > 0) {
            this.x /= len;
            this.y /= len;
        }
        return this;
    }

    // 返回单位向量（新向量），零向量返回 (0,0)
    normalized () {
        const len = this.length();
        return len > 0 ? new Vec2(this.x / len, this.y / len) : new Vec2(0, 0);
    }

    // 与另一向量的距离
    distanceTo ({ x, y }) {
        return Math.hypot(this.x - x, this.y - y);
    }

    // 与另一向量的夹角（弧度）
    angleTo ({ x, y }) {
        return Math.atan2(this.cross({ x, y }), this.dot({ x, y }));
    }

    // ---------- 变换 ----------
    // 绕原点旋转（弧度）
    rotate (angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const { x, y } = this;
        this.x = x * cos - y * sin;
        this.y = x * sin + y * cos;
        return this;
    }

    // 线性插值（原地）：this = this + (v - this) * t
    lerp ({ x, y }, t) {
        this.x += (x - this.x) * t;
        this.y += (y - this.y) * t;
        return this;
    }

    // ---------- 复制与设置 ----------
    clone () {
        return new Vec2(this.x, this.y);
    }

    copy ({ x, y }) {
        this.x = x;
        this.y = y;
        return this;
    }

    set (x, y) {
        this.x = x;
        this.y = y;
        return this;
    }

    // ---------- 判等与显示 ----------
    equals ({ x, y }, epsilon = 1e-9) {
        return Math.abs(this.x - x) < epsilon && Math.abs(this.y - y) < epsilon;
    }

    toString () {
        return `Vec2(${this.x}, ${this.y})`;
    }

    // ---------- 静态工具（可选） ----------
    static add (a, b) {
        return new Vec2(a.x + b.x, a.y + b.y);
    }

    static sub (a, b) {
        return new Vec2(a.x - b.x, a.y - b.y);
    }

    static scale (v, s) {
        return new Vec2(v.x * s, v.y * s);
    }

    static dot (a, b) {
        return a.x * b.x + a.y * b.y;
    }

    static cross (a, b) {
        return a.x * b.y - a.y * b.x;
    }

    static distance (a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    static lerp (a, b, t) {
        return new Vec2(
            a.x + (b.x - a.x) * t,
            a.y + (b.y - a.y) * t
        );
    }
}

export default Vec2;