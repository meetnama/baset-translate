const express = require('express');
const { requireAuth, requireAdmin, stripCustomerFromUsers } = require('../auth');
const {
  listCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} = require('../services/customers');

const router = express.Router();

router.get('/customers', requireAuth, requireAdmin, (_req, res) => {
  res.json({ customers: listCustomers({ includeDisabled: true, includeTemplate: true }) });
});

router.post('/customers', requireAuth, requireAdmin, (req, res) => {
  const result = createCustomer(req.body || {});
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.status(201).json(result.customer);
});

router.patch('/customers/:id', requireAuth, requireAdmin, (req, res) => {
  const result = updateCustomer(req.params.id, req.body || {});
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result.customer);
});

router.delete('/customers/:id', requireAuth, requireAdmin, (req, res) => {
  const result = deleteCustomer(req.params.id);
  if (!result.ok) return res.status(400).json({ error: result.error });
  stripCustomerFromUsers(result.id);
  res.json({ ok: true });
});

module.exports = router;
