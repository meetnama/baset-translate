const express = require('express');
const multer = require('multer');
const {
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
  getQuotaStatus,
  deleteUser,
  setUserAvatar,
  clearUserAvatar,
  readUserAvatar,
} = require('../auth');
const {
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
} = require('../util/loginRateLimit');
const config = require('../config');

const router = express.Router();
const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

router.get('/me', (req, res) => {
  if (!authEnabled()) {
    return res.json({
      authRequired: false,
      user: null,
      isAdmin: false,
      wordQuota: null,
      hasAvatar: false,
      appName: config.appName,
    });
  }
  const { user } = readSession(req);
  const avatar = user ? readUserAvatar(user) : null;
  res.json({
    authRequired: true,
    user: user || null,
    isAdmin: user ? isAdmin(user) : false,
    wordQuota: user ? getQuotaStatus(user) : null,
    hasAvatar: Boolean(avatar),
    appName: config.appName,
  });
});

router.get('/me/avatar', requireAuth, (req, res) => {
  const avatar = readUserAvatar(req.user);
  if (!avatar) return res.status(404).json({ error: 'No photo is saved for this account.' });
  res.setHeader('Cache-Control', 'private, no-cache');
  res.type(avatar.ext === 'jpg' ? 'jpeg' : avatar.ext);
  res.sendFile(avatar.file);
});

router.post('/me/avatar', requireAuth, (req, res) => {
  uploadAvatar.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Image must be 2 MB or smaller.' });
    const result = setUserAvatar(req.user, req.file && req.file.buffer);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json(result);
  });
});

router.delete('/me/avatar', requireAuth, (req, res) => {
  const result = clearUserAvatar(req.user);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post('/login', (req, res) => {
  if (!authEnabled()) {
    return res.status(503).json({ error: 'Auth is not configured on this server.' });
  }
  const username = req.body?.username;
  const gate = assertLoginAllowed(req, username);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retryAfterSec || 60));
    return res.status(429).json({ error: gate.error });
  }
  const result = authenticate(username, req.body?.password);
  if (!result.ok) {
    recordLoginFailure(req, username);
    return res.status(401).json({ error: result.error });
  }
  recordLoginSuccess(req, result.user);
  setSessionCookie(res, result.user);
  res.json({ ok: true, user: result.user, isAdmin: result.role === 'admin' });
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/users', requireAuth, requireAdmin, (_req, res) => {
  res.json({ users: listUsers() });
});

router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const result = createUser({
    username: req.body?.username,
    password: req.body?.password,
    role: req.body?.role,
    allowedCustomerIds: req.body?.allowedCustomerIds,
    wordQuota: req.body?.wordQuota,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.status(201).json(result.user);
});

router.patch('/users/:username', requireAuth, requireAdmin, (req, res) => {
  const username = req.params.username;
  const body = req.body || {};

  if (body.password != null && String(body.password).length) {
    const pw = setUserPassword(username, body.password);
    if (!pw.ok) return res.status(400).json({ error: pw.error });
  }
  if (body.role != null) {
    const role = setUserRole(username, body.role);
    if (!role.ok) return res.status(400).json({ error: role.error });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'allowedCustomerIds')) {
    const locked = setUserCustomers(username, body.allowedCustomerIds);
    if (!locked.ok) return res.status(400).json({ error: locked.error });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'wordQuota')) {
    const quota = setUserWordQuota(username, body.wordQuota);
    if (!quota.ok) return res.status(400).json({ error: quota.error });
  }

  const row = listUsers().find((u) => u.username === username);
  if (!row) return res.status(404).json({ error: 'User not found.' });
  res.json(row);
});

router.delete('/users/:username', requireAuth, requireAdmin, (req, res) => {
  const result = deleteUser(req.params.username, req.user);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

module.exports = router;
