/**
 * config.js — matchserver 统一配置
 *
 * 加载优先级：环境变量 > data/config.json > 默认值
 *
 * 环境变量（供控制平面注入，见 controlplane/.env.example 的 MS_* 变量）：
 *   CCW_UUID / CCW_NAME / CCW_PASSWORD / CCW_SERVER / CCW_ROOM_TYPE /
 *   CCW_PROJECT_ID / CCW_ROOM_ID / CCW_EXTRA  — 对局服务器（ccw.site）凭据
 *   BACKEND_URL   — backend（数据库服务器）地址，默认 http://127.0.0.1:8787
 *   BACKEND_TOKEN — backend 管理令牌（结算上报 matchResult 需要）
 *
 * data/config.json 被 .gitignore 忽略，控制平面拉取的实例克隆中不含该文件，
 * 因此被控制平面托管的实例完全依赖环境变量注入。
 */

import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** data 目录（与 src 同级） */
export const configDir = path.join(__dirname, '..', 'data');
export const configPath = path.join(configDir, 'config.json');

/** 读取 data/config.json（不存在 / 解析失败 → 空对象，不抛错） */
function loadJsonConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    console.warn(`[Config] 读取 ${configPath} 失败: ${err.message}`);
  }
  return {};
}

const json = loadJsonConfig();

/** env 变量 → config.json 字段 → 默认值 */
const pick = (envName, jsonKey, def) => {
  const envVal = process.env[envName];
  if (envVal !== undefined && envVal !== '') return envVal;
  const jsonVal = json && json[jsonKey];
  if (jsonVal !== undefined && jsonVal !== null && jsonVal !== '') return jsonVal;
  return def;
};

export const config = {
  // ---- 对局服务器（ccw.site）凭据 ----
  uuid: pick('CCW_UUID', 'uuid', ''),
  name: pick('CCW_NAME', 'name', ''),
  extra: pick('CCW_EXTRA', 'extra', ''),
  password: pick('CCW_PASSWORD', 'password', ''),
  server: pick('CCW_SERVER', 'server', 'wss://mo.ccw.site'),
  roomType: pick('CCW_ROOM_TYPE', 'roomType', 'broadcast'),
  projectId: pick('CCW_PROJECT_ID', 'projectId', ''),
  roomId: pick('CCW_ROOM_ID', 'roomId', ''),

  // ---- backend（数据库服务器）----
  backendUrl: (pick('BACKEND_URL', 'backendUrl', '') || 'http://127.0.0.1:8787').replace(
    /\/+$/,
    '',
  ),
  backendToken: pick('BACKEND_TOKEN', 'backendToken', ''),
};

/** 是否具备可用的对局服务器登录凭据（占位符不算） */
export const hasCcwCredentials = () =>
  !!config.uuid &&
  !!config.password &&
  !!config.projectId &&
  !!config.roomId &&
  config.uuid !== 'your-uuid';

/** 若 data/config.json 不存在则写入默认模板，返回是否创建了文件 */
export function writeDefaultConfigIfMissing() {
  if (fs.existsSync(configPath)) return false;
  const defaultConfig = {
    uuid: 'your-uuid',
    name: 'your-name',
    extra: '',
    password: 'your-password',
    server: 'wss://mo.ccw.site',
    roomType: 'broadcast',
    projectId: 'your-project-id',
    roomId: 'your-room-id',
    backendUrl: 'http://127.0.0.1:8787',
    backendToken: '',
  };
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 4));
  return true;
}
