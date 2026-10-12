/**
 * CORS origin allow-list. Never reflect arbitrary Origin when credentials are on.
 */

function parseAllowList(corsOriginEnv, { hosted = false, renderUrl = '' } = {}) {
  const raw = String(corsOriginEnv == null ? '*' : corsOriginEnv).trim();
  const set = new Set();

  if (raw && raw !== '*') {
    for (const part of raw.split(',')) {
      const o = part.trim().replace(/\/$/, '');
      if (o) set.add(o);
    }
  }

  const render = String(renderUrl || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (render) set.add(render);

  if (hosted) {
    // Live default when env was left as *
    if (!set.size) set.add('https://lingotrust-translate.onrender.com');
  } else {
    set.add('http://localhost:5173');
    set.add('http://127.0.0.1:5173');
    set.add('http://localhost:8787');
    set.add('http://127.0.0.1:8787');
  }

  return set;
}

function isLocalDevOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/**
 * cors package origin callback.
 * @returns {(origin: string|undefined, cb: Function) => void}
 */
function createCorsOriginChecker(corsOriginEnv, opts = {}) {
  const allow = parseAllowList(corsOriginEnv, opts);
  const hosted = Boolean(opts.hosted);

  return function corsOrigin(origin, cb) {
    // Same-origin / non-browser / curl: no Origin header
    if (!origin) return cb(null, true);
    const normalized = String(origin).replace(/\/$/, '');
    if (allow.has(normalized)) return cb(null, true);
    if (!hosted && isLocalDevOrigin(normalized)) return cb(null, true);
    return cb(null, false);
  };
}

module.exports = {
  parseAllowList,
  createCorsOriginChecker,
  isLocalDevOrigin,
};
