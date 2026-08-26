const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const COOKIE_NAME = 'lt_session';
const usersFile = path.join(config.dataDir, 'users.json');
const { getUserWordUsage } = require('./services/wordStats');

/** @type {Map<string, { passwordHash: string, role: 'admin' | 'user', allowedCustomerIds?: string[], wordQuota?: number | null }>} */
let users = new Map();

function parseLegacyUsers(raw) {
  const map = new Map();
  if (!raw || !String(raw).trim()) return map;
  for (const part of String(raw).split('|')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const user = part.slice(0, i).trim();
    const pass = part.slice(i + 1);
    if (user) map.set(user, pass);
  }
  return map;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !String(stored).includes(':')) return false;
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const next = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(next, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizeAllowed(ids) {
  if (ids == null) return undefined;
  if (!Array.isArray(ids)) return undefined;
  const { getCustomer } = require('./services/customers');
  const cleaned = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
    .filter((id) => getCustomer(id));
  return cleaned.length ? cleaned : undefined;
}

function normalizeWordQuota(value) {
  if (value == null || value === '') return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function persist() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const list = [...users.entries()].map(([username, row]) => {
    const out = {
      username,
      passwordHash: row.passwordHash,
      role: row.role === 'admin' ? 'admin' : 'user',
    };
    if (Array.isArray(row.allowedCustomerIds) && row.allowedCustomerIds.length) {
      out.allowedCustomerIds = row.allowedCustomerIds;
    }
    if (row.wordQuota != null && row.wordQuota > 0) {
      out.wordQuota = row.wordQuota;
    }
    return out;
  });
  fs.writeFileSync(usersFile, JSON.stringify({ users: list }, null, 2), 'utf8');
}

function loadFromDisk() {
  users = new Map();
  if (!fs.existsSync(usersFile)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const list = Array.isArray(raw?.users) ? raw.users : [];
    for (const row of list) {
      const username = String(row.username || '').trim();
      if (!username || !row.passwordHash) continue;
      users.set(username, {
        passwordHash: String(row.passwordHash),
        role: row.role === 'admin' ? 'admin' : 'user',
        allowedCustomerIds: Array.isArray(row.allowedCustomerIds) ? row.allowedCustomerIds : undefined,
        wordQuota: row.role === 'admin' ? null : normalizeWordQuota(row.wordQuota),
      });
    }
  } catch (err) {
    console.error('Failed to read users.json:', err.message);
  }
}

function ensureAdminFromEnv() {
  const adminUser = String(config.auth.adminUser || '').trim();
  const adminPass = String(config.auth.adminPassword || '');
  if (!adminUser || !adminPass) return false;

  const existing = users.get(adminUser);
  if (!existing) {
    users.set(adminUser, { passwordHash: hashPassword(adminPass), role: 'admin' });
    persist();
    console.log(`Created admin user "${adminUser}" in data/users.json`);
    return true;
  }

  const syncPassword = config.auth.syncAdminPassword;

  // Default: do not overwrite passwords changed in the UI. Opt in via AUTH_ADMIN_SYNC_PASSWORD.
  if (syncPassword && !verifyPassword(adminPass, existing.passwordHash)) {
    users.set(adminUser, { passwordHash: hashPassword(adminPass), role: 'admin' });
    persist();
    console.log(`Synced admin password for "${adminUser}" from .env`);
    return true;
  }

  if (existing.role !== 'admin') {
    users.set(adminUser, { ...existing, role: 'admin' });
    persist();
    console.log(`Promoted "${adminUser}" to admin from .env`);
  }
  return true;
}

function ensureTestUserFromEnv() {
  const u = String(process.env.TEST_USER_USERNAME || '').trim();
  const p = String(process.env.TEST_USER_PASSWORD || '');
  if (!u || !p || users.has(u)) return;
  const quota = normalizeWordQuota(process.env.TEST_USER_WORD_QUOTA) || 5000;
  const customerIds = String(process.env.TEST_USER_CUSTOMERS || 'normal')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  users.set(u, {
    passwordHash: hashPassword(p),
    role: 'user',
    allowedCustomerIds: normalizeAllowed(customerIds),
    wordQuota: quota,
  });
  persist();
  console.log(`Created test user "${u}" (word quota ${quota}).`);
}

function bootstrapUsers() {
  loadFromDisk();

  if (ensureAdminFromEnv()) {
    ensureTestUserFromEnv();
    return;
  }

  if (users.size > 0) {
    ensureTestUserFromEnv();
    return;
  }

  const legacy = parseLegacyUsers(config.auth.users);
  if (!legacy.size) {
    ensureTestUserFromEnv();
    return;
  }
  let first = true;
  for (const [username, password] of legacy.entries()) {
    users.set(username, {
      passwordHash: hashPassword(password),
      role: first ? 'admin' : 'user',
    });
    first = false;
  }
  persist();
  console.log('Migrated AUTH_USERS into data/users.json (first user is admin).');
  ensureTestUserFromEnv();
}

bootstrapUsers();

function authEnabled() {
  return users.size > 0;
}

function getUserRecord(username) {
  return users.get(String(username || '').trim()) || null;
}

function isAdmin(username) {
  return getUserRecord(username)?.role === 'admin';
}

function publicUser(username, row, { includeUsage = false } = {}) {
  const out = { username, role: row.role };
  if (Array.isArray(row.allowedCustomerIds) && row.allowedCustomerIds.length) {
    out.allowedCustomerIds = row.allowedCustomerIds;
  } else {
    out.allowedCustomerIds = null;
  }
  if (row.role === 'admin') {
    out.wordQuota = null;
  } else if (row.wordQuota != null && row.wordQuota > 0) {
    out.wordQuota = row.wordQuota;
  } else {
    out.wordQuota = null;
  }
  if (includeUsage) {
    const used = getUserWordUsage(username);
    out.wordsUsed = used;
    if (out.wordQuota != null) {
      out.wordsRemaining = Math.max(0, out.wordQuota - used);
    }
  }
  return out;
}

function getQuotaStatus(username) {
  const row = getUserRecord(username);
  if (!row || row.role === 'admin') {
    return { unlimited: true, limit: null, used: 0, remaining: null, exhausted: false };
  }
  const limit = row.wordQuota != null && row.wordQuota > 0 ? row.wordQuota : null;
  if (limit == null) {
    return { unlimited: true, limit: null, used: getUserWordUsage(username), remaining: null, exhausted: false };
  }
  const used = getUserWordUsage(username);
  const remaining = Math.max(0, limit - used);
  return {
    unlimited: false,
    limit,
    used,
    remaining,
    exhausted: used >= limit,
  };
}

function userQuotaAllowsTranslate(username) {
  const status = getQuotaStatus(username);
  return status.unlimited || !status.exhausted;
}

function listUsers() {
  return [...users.entries()]
    .map(([username, row]) => publicUser(username, row, { includeUsage: true }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function getAllowedCustomerIds(username) {
  const row = getUserRecord(username);
  if (!row) return null;
  if (row.role === 'admin') return null;
  return Array.isArray(row.allowedCustomerIds) && row.allowedCustomerIds.length
    ? row.allowedCustomerIds
    : null;
}

function userCanUseCustomer(username, customerId, isAdminUser) {
  if (isAdminUser) return true;
  const allowed = getAllowedCustomerIds(username);
  if (!allowed) return true;
  return allowed.includes(String(customerId || '').trim());
}

function createUser({ username, password, role = 'user', allowedCustomerIds, wordQuota }) {
  const u = String(username || '').trim();
  const p = String(password || '');
  const r = role === 'admin' ? 'admin' : 'user';
  if (!u || !p) return { ok: false, error: 'Username and password are required.' };
  if (!/^[a-zA-Z0-9._@-]{2,64}$/.test(u)) {
    return { ok: false, error: 'Username must be 2–64 characters (letters, numbers, . _ @ -).' };
  }
  if (p.length < 4) return { ok: false, error: 'Password must be at least 4 characters.' };
  if (users.has(u)) return { ok: false, error: 'That username already exists.' };
  users.set(u, {
    passwordHash: hashPassword(p),
    role: r,
    allowedCustomerIds: r === 'admin' ? undefined : normalizeAllowed(allowedCustomerIds),
    wordQuota: r === 'admin' ? null : normalizeWordQuota(wordQuota),
  });
  persist();
  return { ok: true, user: publicUser(u, users.get(u), { includeUsage: true }) };
}

function setUserPassword(username, password) {
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!users.has(u)) return { ok: false, error: 'User not found.' };
  if (p.length < 4) return { ok: false, error: 'Password must be at least 4 characters.' };
  const row = users.get(u);
  users.set(u, { ...row, passwordHash: hashPassword(p) });
  persist();
  return { ok: true };
}

function setUserRole(username, role) {
  const u = String(username || '').trim();
  const r = role === 'admin' ? 'admin' : 'user';
  if (!users.has(u)) return { ok: false, error: 'User not found.' };
  if (r !== 'admin') {
    const admins = [...users.values()].filter((x) => x.role === 'admin').length;
    if (users.get(u).role === 'admin' && admins <= 1) {
      return { ok: false, error: 'Keep at least one admin account.' };
    }
  }
  const row = users.get(u);
  users.set(u, { ...row, role: r });
  persist();
  return { ok: true, user: publicUser(u, users.get(u), { includeUsage: true }) };
}

function setUserCustomers(username, allowedCustomerIds) {
  const u = String(username || '').trim();
  if (!users.has(u)) return { ok: false, error: 'User not found.' };
  const row = users.get(u);
  const nextIds = row.role === 'admin' ? undefined : normalizeAllowed(allowedCustomerIds);
  users.set(u, { ...row, allowedCustomerIds: nextIds });
  persist();
  return { ok: true, user: publicUser(u, users.get(u), { includeUsage: true }) };
}

function setUserWordQuota(username, wordQuota) {
  const u = String(username || '').trim();
  if (!users.has(u)) return { ok: false, error: 'User not found.' };
  const row = users.get(u);
  if (row.role === 'admin') {
    return { ok: false, error: 'Admins have no word quota.' };
  }
  users.set(u, { ...row, wordQuota: normalizeWordQuota(wordQuota) });
  persist();
  return { ok: true, user: publicUser(u, users.get(u), { includeUsage: true }) };
}

function stripCustomerFromUsers(customerId) {
  const id = String(customerId || '').trim();
  if (!id) return;
  let changed = false;
  for (const [username, row] of users.entries()) {
    if (!Array.isArray(row.allowedCustomerIds) || !row.allowedCustomerIds.includes(id)) continue;
    const next = row.allowedCustomerIds.filter((x) => x !== id);
    users.set(username, { ...row, allowedCustomerIds: next.length ? next : undefined });
    changed = true;
  }
  if (changed) persist();
}

function deleteUser(username, actor) {
  const u = String(username || '').trim();
  if (!users.has(u)) return { ok: false, error: 'User not found.' };
  if (u === actor) return { ok: false, error: 'You can’t delete your own account while signed in.' };
  if (users.get(u).role === 'admin') {
    const admins = [...users.values()].filter((x) => x.role === 'admin').length;
    if (admins <= 1) return { ok: false, error: 'Keep at least one admin account.' };
  }
  users.delete(u);
  persist();
  return { ok: true };
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', config.auth.secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', config.auth.secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.u || !payload?.exp || Date.now() > payload.exp) return null;
    if (!users.has(payload.u)) return null;
    return payload;
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function cookieOptions() {
  const maxAge = config.auth.sessionDays * 24 * 60 * 60;
  return [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    config.auth.secureCookie ? 'Secure' : '',
  ].filter(Boolean);
}

function setSessionCookie(res, username) {
  const token = signToken({
    u: username,
    exp: Date.now() + config.auth.sessionDays * 24 * 60 * 60 * 1000,
  });
  const parts = cookieOptions();
  parts[0] = `${COOKIE_NAME}=${encodeURIComponent(token)}`;
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  // Must match Secure (and other flags) used when setting, or browsers keep the cookie.
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    config.auth.secureCookie ? 'Secure' : '',
  ].filter(Boolean);
  res.setHeader('Set-Cookie', parts.join('; '));
}

function readSession(req) {
  if (!authEnabled()) return { user: null, bypass: true };
  const token = getCookie(req, COOKIE_NAME);
  const payload = verifyToken(token);
  return payload ? { user: payload.u, bypass: false } : { user: null, bypass: false };
}

function authenticate(username, password) {
  if (!authEnabled()) return { ok: false, error: 'Auth is not configured.' };
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!u || !p) return { ok: false, error: 'Username and password are required.' };
  const row = users.get(u);
  if (!row || !verifyPassword(p, row.passwordHash)) {
    return { ok: false, error: 'Invalid username or password.' };
  }
  return { ok: true, user: u, role: row.role };
}

function requireAuth(req, res, next) {
  if (!authEnabled()) return next();
  const { user } = readSession(req);
  if (!user) {
    return res.status(401).json({ error: 'Please sign in.' });
  }
  req.user = user;
  req.isAdmin = isAdmin(user);
  return next();
}

function requireAdmin(req, res, next) {
  if (!authEnabled()) {
    return res.status(503).json({ error: 'Auth is not configured.' });
  }
  if (!req.user) {
    return res.status(401).json({ error: 'Please sign in.' });
  }
  if (!isAdmin(req.user)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  return next();
}

module.exports = {
  authEnabled,
  authenticate,
  setSessionCookie,
  clearSessionCookie,
  readSession,
  requireAuth,
  requireAdmin,
  isAdmin,
  listUsers,
  createUser,
  setUserPassword,
  setUserRole,
  setUserCustomers,
  setUserWordQuota,
  stripCustomerFromUsers,
  getAllowedCustomerIds,
  userCanUseCustomer,
  getQuotaStatus,
  userQuotaAllowsTranslate,
  deleteUser,
  COOKIE_NAME,
};
