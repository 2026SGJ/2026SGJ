/**
 * backend.js — backend（数据库服务器）客户端
 *
 * 对局服务器与 backend 的集成点：
 *   1. 玩家加入对局前，检查其是否已解锁所选英雄（data.type="get"，无需鉴权）
 *   2. 对局结算后，将结算数据推入 backend（data.type="matchResult"，需 Bearer token）
 *
 * 所有请求走 backend 的 GET ?data=<JSON> 约定（见 backend/src/index.js）。
 */

import { config } from './config.js';

/** 构建 backend 请求 URL */
const buildUrl = (data) => {
  const params = new URLSearchParams({ data: JSON.stringify(data) });
  return `${config.backendUrl}/?${params.toString()}`;
};

const buildHeaders = () => {
  const headers = { 'Content-Type': 'application/json' };
  if (config.backendToken) {
    headers.Authorization = `Bearer ${config.backendToken}`;
  }
  return headers;
};

/** 读取玩家档案（backend 会在首次访问时自动建行） */
export const getPlayer = async (uuid) => {
  const res = await fetch(buildUrl({ type: 'get', uuid }), {
    method: 'GET',
    headers: buildHeaders(),
  });
  if (!res.ok) {
    throw new Error(`backend get ${uuid} failed: HTTP ${res.status}`);
  }
  return res.json();
};

/** 解析 unlockedHeroes 列（可能是 JSON 字符串或数组，防御性解析） */
const parseUnlockedHeroes = (row) => {
  if (!row || row.unlockedHeroes == null) return ['newton'];
  let value = row.unlockedHeroes;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return ['newton'];
    }
  }
  return Array.isArray(value) ? value : ['newton'];
};

/**
 * 检查玩家是否已解锁某英雄（backend 为权威数据源）。
 *
 * @param {string} uuid 玩家账号 uuid
 * @param {string} hero 英雄 id（小写，如 'newton'）
 * @returns {Promise<boolean|null>}
 *   - true  已解锁
 *   - false 未解锁
 *   - null  backend 不可达 / 查询失败（调用方决定放行策略，避免阻塞对局）
 */
export const isHeroUnlocked = async (uuid, hero) => {
  try {
    const row = await getPlayer(uuid);
    return parseUnlockedHeroes(row).includes(hero);
  } catch (err) {
    console.warn(`[Backend] 英雄解锁检查失败（视为放行）: ${err.message}`);
    return null;
  }
};

/**
 * 将对局结算数据推入 backend。
 *
 * @param {Object} match 结算数据：
 *   { matchId, startedAt, durationMs, winner, reason, tiebreak, players: [...] }
 * @returns {Promise<Object>} backend 响应体 { ok, matchId, playersUpdated }
 */
export const pushMatchResult = async (match) => {
  const res = await fetch(buildUrl({ type: 'matchResult', match }), {
    method: 'GET',
    headers: buildHeaders(),
  });
  if (!res.ok) {
    throw new Error(`backend matchResult failed: HTTP ${res.status}`);
  }
  return res.json();
};
