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
    if (Array.isArray(row.allowedCustomerIds)) {
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
  const customerIds = String(process.env.TEST_USER_CUSTOMERS || 'premium-ai')
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
  if (Array.isArray(row.allowedCustomerIds)) {
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
    const q = getQuotaStatus(username);
    out.wordsUsed = q.used;
    out.wordsReserved = q.reserved || 0;
    if (out.wordQuota != null) {
      out.wordsRemaining = q.remaining;
    }
  }
  return out;
}

function getQuotaStatus(username) {
  const row = getUserRecord(username);
  if (!row || row.role === 'admin') {
    return {
      unlimited: true, limit: null, used: 0, reserved: 0, remaining: null, exhausted: false,
    };
  }
  const limit = row.wordQuota != null && row.wordQuota > 0 ? row.wordQuota : null;
  const used = getUserWordUsage(username);
  const reserved = reservedWords(username);
  if (limit == null) {
    return {
      unlimited: true, limit: null, used, reserved: 0, remaining: null, exhausted: false,
    };
  }
  const remaining = Math.max(0, limit - used - reserved);
  return {
    unlimited: false,
    limit,
    used,
    reserved,
    remaining,
    exhausted: used + reserved >= limit,
  };
}

function userQuotaAllowsTranslate(username) {
  const status = getQuotaStatus(username);
  return status.unlimited || !status.exhausted;
}

/** In-flight word holds. username -> holdId -> words. Lost on restart with the jobs. */
const quotaReservations = new Map();
const MAX_CONCURRENT_QUOTA_RUNS = 1;

function holdRunId(holdId) {
  const i = String(holdId || '').indexOf(':');
  return i < 0 ? String(holdId || '') : String(holdId).slice(0, i);
}

function reservationBag(username) {
  return quotaReservations.get(String(username || '').trim()) || null;
}

function reservedWords(username) {
  const bag = reservationBag(username);
  if (!bag) return 0;
  let n = 0;
  for (const w of bag.values()) n += w;
  return n;
}

function activeQuotaRunIds(username) {
  const bag = reservationBag(username);
  const ids = new Set();
  if (!bag) return ids;
  for (const key of bag.keys()) ids.add(holdRunId(key));
  return ids;
}

/**
 * Hold estimated words for every file in a run before the job starts.
 * Check and store happen together so two requests cannot share the same balance.
 */
function reserveRunQuota(username, runId, files) {
  const user = String(username || '').trim();
  const id = String(runId || '').trim();
  if (!user || !id) return { ok: true, skipped: true };
  const status = getQuotaStatus(user);
  if (status.unlimited) return { ok: true, skipped: true };
  const runs = activeQuotaRunIds(user);
  if (runs.size >= MAX_CONCURRENT_QUOTA_RUNS && !runs.has(id)) {
    return {
      ok: false,
      error: 'Another translation is already running on this account. Wait for it to finish, then try again.',
      status: getQuotaStatus(user),
    };
  }
  const need = (files || []).reduce((sum, f) => sum + Math.max(0, Math.round(Number(f.estimate) || 0)), 0);
  if (need > status.remaining) {
    return {
      ok: false,
      error: `This upload looks larger than your remaining word quota (${need.toLocaleString()} estimated vs ${status.remaining.toLocaleString()} left). Contact admin for more.`,
      status,
    };
  }
  let bag = quotaReservations.get(user);
  if (!bag) {
    bag = new Map();
    quotaReservations.set(user, bag);
  }
  for (const f of files || []) {
    bag.set(`${id}:${f.id}`, Math.max(0, Math.round(Number(f.estimate) || 0)));
  }
  if (!(files || []).length) bag.set(`${id}:run`, 0);
  return { ok: true, status: getQuotaStatus(user) };
}

/** Replace one file’s hold with the real word count. Fails closed if it no longer fits. */
function commitQuotaHold(username, holdId, words) {
  const user = String(username || '').trim();
  const id = String(holdId || '').trim();
  const n = Math.max(0, Math.round(Number(words) || 0));
  if (!user || !id) return { ok: true };
  const row = getUserRecord(user);
  if (!row || row.role === 'admin') return { ok: true };
  const limit = row.wordQuota != null && row.wordQuota > 0 ? row.wordQuota : null;
  if (limit == null) return { ok: true };
  const used = getUserWordUsage(user);
  let bag = quotaReservations.get(user);
  let others = 0;
  if (bag) {
    for (const [key, w] of bag) {
      if (key !== id) others += w;
    }
  }
  const remainingForThis = limit - used - others;
  if (n > remainingForThis) {
    return { ok: false, remaining: Math.max(0, remainingForThis) };
  }
  if (!bag) {
    bag = new Map();
    quotaReservations.set(user, bag);
  }
  bag.set(id, n);
  return { ok: true, remaining: remainingForThis - n };
}

function releaseQuotaReservation(username, holdId) {
  const user = String(username || '').trim();
  const bag = quotaReservations.get(user);
  if (!bag) return;
  bag.delete(String(holdId || ''));
  if (!bag.size) quotaReservations.delete(user);
}

function releaseRunQuota(username, runId) {
  const user = String(username || '').trim();
  const id = String(runId || '').trim();
  const bag = quotaReservations.get(user);
  if (!bag || !id) return;
  for (const key of [...bag.keys()]) {
    if (key === id || key.startsWith(`${id}:`)) bag.delete(key);
  }
  if (!bag.size) quotaReservations.delete(user);
}

function _resetQuotaReservationsForTests() {
  quotaReservations.clear();
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
  return Array.isArray(row.allowedCustomerIds) ? row.allowedCustomerIds : null;
}

function canUseCustomerId(allowedCustomerIds, customerId, isAdminUser = false) {
  if (isAdminUser) return true;
  if (!Array.isArray(allowedCustomerIds)) return true;
  return allowedCustomerIds.includes(String(customerId || '').trim());
}

function userCanUseCustomer(username, customerId, isAdminUser) {
  return canUseCustomerId(getAllowedCustomerIds(username), customerId, isAdminUser);
}

/** Common / trivial passwords (lowercase). Blocked even if they meet shape rules. */
const COMMON_PASSWORDS = new Set(
  [
    '0000',
    '1234',
    '12345',
    '123456',
    '1234567',
    '12345678',
    '123456789',
    '1234567890',
    'password',
    'password1',
    'password12',
    'password123',
    'password123!',
    'passw0rd',
    'passw0rd!',
    'qwerty',
    'qwerty1',
    'qwerty12',
    'qwerty123',
    'qwerty123!',
    'admin',
    'admin123',
    'admin123!',
    'welcome',
    'welcome1',
    'welcome12',
    'welcome123',
    'welcome123!',
    'letmein',
    'letmein1',
    'letmein12',
    'letmein123',
    'monkey',
    'dragon',
    'master',
    'login',
    'abc123',
    'abc12345',
    'abcd1234',
    'abcd1234!',
    'changeme',
    'changeme1',
    'changeme!',
    'iloveyou',
    'sunshine',
    'princess',
    'football',
    'baseball',
    'mustang',
    'access',
    'shadow',
    'trustno1',
    'pass1234',
    'pass1234!',
    'p@ssw0rd',
    'p@ssword',
    'p@ssword1',
  ].map((s) => s.toLowerCase())
);

/**
 * New / changed passwords: 8+ chars, upper+lower, number, special char,
 * and not on the common-password list.
 */
function validatePasswordStrength(password) {
  const p = String(password || '');
  if (p.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p)) {
    return {
      ok: false,
      error: 'Password must include both uppercase and lowercase letters.',
    };
  }
  if (!/[0-9]/.test(p)) {
    return { ok: false, error: 'Password must include a number.' };
  }
  if (!/[^A-Za-z0-9]/.test(p)) {
    return {
      ok: false,
      error: 'Password must include a special character (e.g. ! @ # $).',
    };
  }
  if (COMMON_PASSWORDS.has(p.toLowerCase())) {
    return {
      ok: false,
      error: 'This password is too common. Choose something harder to guess.',
    };
  }
  return { ok: true };
}

function createUser({ username, password, role = 'user', allowedCustomerIds, wordQuota }) {
  const u = String(username || '').trim();
  const p = String(password || '');
  const r = role === 'admin' ? 'admin' : 'user';
  if (!u || !p) return { ok: false, error: 'Username and password are required.' };
  if (!/^[a-zA-Z0-9._@-]{2,64}$/.test(u)) {
    return { ok: false, error: 'Username must be 2–64 characters (letters, numbers, . _ @ -).' };
  }
  const strength = validatePasswordStrength(p);
  if (!strength.ok) return strength;
  if (users.has(u)) return { ok: false, error: 'That username already exists.' };
  users.set(u, {
    passwordHash: hashPassword(p),
    role: r,
    allowedCustomerIds:
      r === 'admin'
        ? undefined
        : Array.isArray(allowedCustomerIds)
          ? (normalizeAllowed(allowedCustomerIds) || [])
          : undefined,
    wordQuota: r === 'admin' ? null : normalizeWordQuota(wordQuota),
  });
  persist();
  return { ok: true, user: publicUser(u, users.get(u), { includeUsage: true }) };
}

function setUserPassword(username, password) {
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!users.has(u)) return { ok: false, error: 'User not found.' };
  const strength = validatePasswordStrength(p);
  if (!strength.ok) return strength;
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
  users.set(u, {
    ...row,
    role: r,
    ...(r === 'admin' ? { allowedCustomerIds: undefined, wordQuota: null } : {}),
  });
  persist();
  return { ok: true, user: publicUser(u, users.get(u), { includeUsage: true }) };
}

function setUserCustomers(username, allowedCustomerIds) {
  const u = String(username || '').trim();
  if (!users.has(u)) return { ok: false, error: 'User not found.' };
  const row = users.get(u);
  const nextIds = row.role === 'admin'
    ? undefined
    : Array.isArray(allowedCustomerIds)
      ? (normalizeAllowed(allowedCustomerIds) || [])
      : undefined;
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
    users.set(username, { ...row, allowedCustomerIds: next });
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
    const raw = part.slice(i + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
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

/** Replace all users from a local snapshot (keeps password hashes). */
function importUsersSnapshot(list) {
  if (!Array.isArray(list) || !list.length) {
    return { ok: false, error: 'users array required.' };
  }
  const next = new Map();
  let admins = 0;
  for (const row of list) {
    const u = String(row?.username || '').trim();
    const hash = String(row?.passwordHash || '').trim();
    if (!u || !hash) continue;
    const role = row.role === 'admin' ? 'admin' : 'user';
    if (role === 'admin') admins += 1;
    next.set(u, {
      passwordHash: hash,
      role,
      allowedCustomerIds:
        role === 'admin'
          ? undefined
          : Array.isArray(row.allowedCustomerIds)
            ? (normalizeAllowed(row.allowedCustomerIds) || [])
            : undefined,
      wordQuota: role === 'admin' ? null : normalizeWordQuota(row.wordQuota),
    });
  }
  if (!next.size) return { ok: false, error: 'No valid users in snapshot.' };
  if (admins < 1) return { ok: false, error: 'Snapshot must include at least one admin.' };
  users = next;
  persist();
  return { ok: true, count: users.size };
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
  canUseCustomerId,
  userCanUseCustomer,
  getQuotaStatus,
  userQuotaAllowsTranslate,
  reserveRunQuota,
  commitQuotaHold,
  releaseQuotaReservation,
  releaseRunQuota,
  _resetQuotaReservationsForTests,
  validatePasswordStrength,
  deleteUser,
  importUsersSnapshot,
  COOKIE_NAME,
};
