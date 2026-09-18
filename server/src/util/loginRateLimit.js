/**
 * Login rate limit (in-memory):
 * - Progressive delay after each failure (1s, 2s, 4s… up to 32s)
 * - Burst cap: max attempts per IP per minute
 * - Hard lock: 10 failures → 15 minutes
 */

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const BURST_MAX = 20;
const BURST_WINDOW_MS = 60 * 1000;
const DELAY_BASE_MS = 1000;
const DELAY_MAX_MS = 32 * 1000;

/** @type {Map<string, { fails: number, windowStart: number, lockedUntil: number, nextAllowedAt: number, attempts: number[] }>} */
const buckets = new Map();

function now() {
  return Date.now();
}

function progressiveDelayMs(fails) {
  if (fails <= 0) return 0;
  return Math.min(DELAY_BASE_MS * 2 ** (fails - 1), DELAY_MAX_MS);
}

function freshBucket(t = now()) {
  return { fails: 0, windowStart: t, lockedUntil: 0, nextAllowedAt: 0, attempts: [] };
}

function getBucket(key) {
  const t = now();
  let b = buckets.get(key);
  if (!b) {
    b = freshBucket(t);
    buckets.set(key, b);
    return b;
  }
  if (b.lockedUntil && t >= b.lockedUntil) {
    b.fails = 0;
    b.windowStart = t;
    b.lockedUntil = 0;
    b.nextAllowedAt = 0;
  } else if (!b.lockedUntil && t - b.windowStart > WINDOW_MS) {
    b.fails = 0;
    b.windowStart = t;
    b.nextAllowedAt = 0;
  }
  if (!Array.isArray(b.attempts)) b.attempts = [];
  if (typeof b.nextAllowedAt !== 'number') b.nextAllowedAt = 0;
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

function pruneAttempts(b, t = now()) {
  const cutoff = t - BURST_WINDOW_MS;
  b.attempts = (b.attempts || []).filter((ts) => ts > cutoff);
}

function recordAttempt(key) {
  const t = now();
  const b = getBucket(key);
  pruneAttempts(b, t);
  b.attempts.push(t);
  return b.attempts.length;
}

function burstBlocked(key) {
  const b = getBucket(key);
  pruneAttempts(b);
  return b.attempts.length >= BURST_MAX;
}

function delayBlocked(key) {
  const b = getBucket(key);
  const t = now();
  if (b.nextAllowedAt > t) {
    return Math.ceil((b.nextAllowedAt - t) / 1000) || 1;
  }
  return 0;
}

/** @returns {{ ok: true } | { ok: false, error: string, retryAfterSec: number }} */
function assertLoginAllowed(req, username) {
  const ip = clientIp(req);
  const userKey = `user:${String(username || '').trim().toLowerCase()}`;
  const ipKey = `ip:${ip}`;

  // Count every login try toward the IP burst budget (DoS / Intruder flood).
  recordAttempt(ipKey);

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

  if (burstBlocked(ipKey)) {
    return {
      ok: false,
      error: 'Too many sign-in attempts from this network. Wait a minute and try again.',
      retryAfterSec: 60,
    };
  }

  let delaySec = 0;
  for (const key of [userKey, ipKey]) {
    if (!String(username || '').trim() && key.startsWith('user:')) continue;
    delaySec = Math.max(delaySec, delayBlocked(key));
  }
  if (delaySec > 0) {
    return {
      ok: false,
      error: `Please wait ${delaySec} second(s) before trying again.`,
      retryAfterSec: delaySec,
    };
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
    b.nextAllowedAt = t + progressiveDelayMs(b.fails);
    if (b.fails >= MAX_FAILURES) {
      b.lockedUntil = t + WINDOW_MS;
      b.nextAllowedAt = b.lockedUntil;
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
  BURST_MAX,
  BURST_WINDOW_MS,
  DELAY_BASE_MS,
  DELAY_MAX_MS,
  progressiveDelayMs,
  clientIp,
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  _resetLoginRateLimitForTests,
};
