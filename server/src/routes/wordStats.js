const express = require('express');
const { requireAuth, requireAdmin } = require('../auth');
const { listSummary, deleteByDateRange } = require('../services/wordStats');

const router = express.Router();

router.get('/word-stats', requireAuth, requireAdmin, (_req, res) => {
  res.json(listSummary());
});

router.delete('/word-stats', requireAuth, requireAdmin, (req, res) => {
  const from = req.query.from || req.body?.from;
  const to = req.query.to || req.body?.to;
  const result = deleteByDateRange(from, to);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, removed: result.removed, ...listSummary() });
});

module.exports = router;
