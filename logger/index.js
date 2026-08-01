/**
 * Logger 模块
 * 提供 log / warn / error / debug 四个级别
 * 默认输出到 stdout，可通过 setLevel 控制级别
 */

const LOG_LEVELS = {
    DEBUG: 0,
    LOG: 1,
    WARN: 2,
    ERROR: 3,
    SILENT: 4
};

let currentLevel = LOG_LEVELS.DEBUG; // 默认显示所有日志

function timestamp() {
    return new Date().toISOString();
}

function fmt(level, ...args) {
    return [`[${timestamp()}] [${level}]`, ...args];
}

const logger = {
    debug(...args) {
        if (currentLevel <= LOG_LEVELS.DEBUG) {
            console.log(...fmt('DEBUG', ...args));
        }
    },

    log(...args) {
        if (currentLevel <= LOG_LEVELS.LOG) {
            console.log(...fmt('LOG', ...args));
        }
    },

    warn(...args) {
        if (currentLevel <= LOG_LEVELS.WARN) {
            console.warn(...fmt('WARN', ...args));
        }
    },

    error(...args) {
        if (currentLevel <= LOG_LEVELS.ERROR) {
            console.error(...fmt('ERROR', ...args));
        }
    },

    /** 设置日志级别：'DEBUG' | 'LOG' | 'WARN' | 'ERROR' | 'SILENT' */
    setLevel(levelName) {
        if (LOG_LEVELS[levelName] !== undefined) {
            currentLevel = LOG_LEVELS[levelName];
        }
    },

    /** 获取当前日志级别名称 */
    getLevel() {
        for (const [k, v] of Object.entries(LOG_LEVELS)) {
            if (v === currentLevel) return k;
        }
        return 'UNKNOWN';
    },

    LOG_LEVELS
};

export default logger;
