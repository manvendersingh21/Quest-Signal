/**
 * Shared cache for model output (reviewer decisions live in the visitor's cookie; see cookie.js).
 *
 * With KV_REST_API_URL / KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_* pair) set,
 * entries live in Upstash Redis so every serverless instance shares them.
 * Without them, entries live in this process only (local runs and tests).
 */

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
  if (!response.ok || body.error) throw new Error(`Model cache: ${body.error || response.status}`);
  return body.result;
}

export function storeKind() {
  return redisConfig() ? "redis" : "memory";
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
