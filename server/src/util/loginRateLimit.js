/**
 * Simple in-memory login rate limit: per IP and per username.
 * 10 failures → lock for 15 minutes.
 */

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

/** @type {Map<string, { fails: number, windowStart: number, lockedUntil: number }>} */
const buckets = new Map();

function now() {
  return Date.now();
}

function getBucket(key) {
  const t = now();
  let b = buckets.get(key);
  if (!b) {
    b = { fails: 0, windowStart: t, lockedUntil: 0 };
    buckets.set(key, b);
    return b;
  }
  if (b.lockedUntil && t >= b.lockedUntil) {
    b.fails = 0;
    b.windowStart = t;
    b.lockedUntil = 0;
  } else if (!b.lockedUntil && t - b.windowStart > WINDOW_MS) {
    b.fails = 0;
    b.windowStart = t;
  }
  return b;
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  if (xf) return xf;
  return String(req.socket?.remoteAddress || req.ip || 'unknown');
}

function isLocked(key) {
  const b = getBucket(key);
  return b.lockedUntil > now();
}

function remainingLockMs(key) {
  const b = getBucket(key);
  return Math.max(0, b.lockedUntil - now());
}

/** @returns {{ ok: true } | { ok: false, error: string, retryAfterSec: number }} */
function assertLoginAllowed(req, username) {
  const ip = clientIp(req);
  const userKey = `user:${String(username || '').trim().toLowerCase()}`;
  const ipKey = `ip:${ip}`;

  for (const key of [userKey, ipKey]) {
    if (!String(username || '').trim() && key.startsWith('user:')) continue;
    if (isLocked(key)) {
      const sec = Math.ceil(remainingLockMs(key) / 1000) || 60;
      return {
        ok: false,
        error: `Too many failed sign-in attempts. Try again in about ${Math.ceil(sec / 60)} minute(s).`,
        retryAfterSec: sec,
      };
    }
  }
  return { ok: true };
}

function recordLoginFailure(req, username) {
  const ip = clientIp(req);
  const keys = [`ip:${ip}`];
  const u = String(username || '').trim().toLowerCase();
  if (u) keys.push(`user:${u}`);
  const t = now();
  for (const key of keys) {
    const b = getBucket(key);
    if (b.lockedUntil > t) continue;
    b.fails += 1;
    if (b.fails >= MAX_FAILURES) {
      b.lockedUntil = t + WINDOW_MS;
    }
  }
}

function recordLoginSuccess(req, username) {
  const ip = clientIp(req);
  buckets.delete(`ip:${ip}`);
  const u = String(username || '').trim().toLowerCase();
  if (u) buckets.delete(`user:${u}`);
}

/** Test helper */
function _resetLoginRateLimitForTests() {
  buckets.clear();
}

module.exports = {
  MAX_FAILURES,
  WINDOW_MS,
  clientIp,
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  _resetLoginRateLimitForTests,
};
