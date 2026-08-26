const express = require('express');
const { requireAuth, requireAdmin, importUsersSnapshot, listUsers } = require('../auth');
const { importCustomersSnapshot, listCustomers } = require('../services/customers');
const { importWordStatsSnapshot, listSummary } = require('../services/wordStats');

const router = express.Router();

/**
 * Admin-only: replace users / customers / word-stats from a local data snapshot.
 * Used to make hosted match local after redeploy.
 */
router.post('/admin/import-local-data', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const out = {};

  if (body.users != null) {
    const result = importUsersSnapshot(body.users);
    if (!result.ok) return res.status(400).json({ error: result.error });
    out.users = result.count;
  }
  if (body.customers != null) {
    const result = importCustomersSnapshot(body.customers);
    if (!result.ok) return res.status(400).json({ error: result.error });
    out.customers = result.count;
  }
  if (body.wordStats != null) {
    const records = Array.isArray(body.wordStats)
      ? body.wordStats
      : body.wordStats.records;
    const result = importWordStatsSnapshot(records);
    if (!result.ok) return res.status(400).json({ error: result.error });
    out.wordStats = result.count;
  }

  if (!Object.keys(out).length) {
    return res.status(400).json({ error: 'Provide users, customers, and/or wordStats.' });
  }

  res.json({
    ok: true,
    imported: out,
    users: listUsers(),
    customers: listCustomers({ includeDisabled: true, includeTemplate: true }),
    wordStats: listSummary(),
  });
});

module.exports = router;
