const express = require('express');
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
  deleteUser,
} = require('../auth');

const router = express.Router();

router.get('/me', (req, res) => {
  if (!authEnabled()) {
    return res.json({ authRequired: false, user: null, isAdmin: false });
  }
  const { user } = readSession(req);
  res.json({
    authRequired: true,
    user: user || null,
    isAdmin: user ? isAdmin(user) : false,
  });
});

router.post('/login', (req, res) => {
  if (!authEnabled()) {
    return res.status(503).json({ error: 'Auth is not configured on this server.' });
  }
  const result = authenticate(req.body?.username, req.body?.password);
  if (!result.ok) {
    return res.status(401).json({ error: result.error });
  }
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
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.status(201).json(result.user);
});

router.patch('/users/:username', requireAuth, requireAdmin, (req, res) => {
  const username = req.params.username;
  if (req.body?.password != null && String(req.body.password).length) {
    const pw = setUserPassword(username, req.body.password);
    if (!pw.ok) return res.status(400).json({ error: pw.error });
  }
  if (req.body?.role != null) {
    const role = setUserRole(username, req.body.role);
    if (!role.ok) return res.status(400).json({ error: role.error });
    return res.json(role.user);
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
