/**
 * Reviewer decisions. Not a TradesQuest write.
 *
 * With KV_REST_API_URL / KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_* pair) set,
 * decisions live in Upstash Redis so every serverless instance sees them.
 * Without them, decisions live in this process only (local runs and tests).
 */

const KEY = "questsignal:confirmations";
const memory = new Map();

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redis(command) {
  const config = redisConfig();
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(4000),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`Review store: ${body.error || response.status}`);
  return body.result;
}

export function storeKind() {
  return redisConfig() ? "redis" : "memory";
}

export async function confirmDraft(apprenticeId, clearsDraftBar, by = "Demo reviewer", at = new Date().toISOString()) {
  const row = {
    at,
    by,
    decision: clearsDraftBar ? "confirm-record" : "keep-in-training",
  };
  if (redisConfig()) await redis(["HSET", KEY, apprenticeId, JSON.stringify(row)]);
  else memory.set(apprenticeId, row);
  return row;
}

export async function getConfirmation(apprenticeId) {
  if (!redisConfig()) return memory.get(apprenticeId) ?? null;
  const raw = await redis(["HGET", KEY, apprenticeId]);
  return raw ? JSON.parse(raw) : null;
}

/** @returns {Promise<Record<string, { at: string, by: string, decision: string }>>} */
export async function allConfirmations() {
  if (!redisConfig()) return Object.fromEntries(memory);
  const flat = (await redis(["HGETALL", KEY])) || [];
  const out = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
  return out;
}

export async function clearConfirmation(apprenticeId) {
  if (redisConfig()) await redis(["HDEL", KEY, apprenticeId]);
  else memory.delete(apprenticeId);
}

export async function clearConfirmations() {
  if (redisConfig()) await redis(["DEL", KEY]);
  else memory.clear();
}

const cache = new Map();

/** Small JSON cache for model output. Redis when configured, process memory otherwise. */
export async function getCached(key) {
  if (!redisConfig()) return cache.get(key) ?? null;
  const raw = await redis(["GET", `questsignal:cache:${key}`]);
  return raw ? JSON.parse(raw) : null;
}

export async function setCached(key, value, ttlSeconds = 60 * 60 * 24 * 7) {
  if (!redisConfig()) {
    cache.set(key, value);
    return;
  }
  await redis(["SET", `questsignal:cache:${key}`, JSON.stringify(value), "EX", String(ttlSeconds)]);
}
