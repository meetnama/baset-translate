const fs = require('fs');
const path = require('path');
const config = require('../config');

const DIAAB_TEMPLATE_UID = 'rSLTo7avyCpO65101YU4cb';
const LOC_TEMPLATE_UID = 'FZg60dEA9Yj4nyvp1ka1K4';

const customersFile = path.join(config.dataDir, 'customers.json');

/** @type {Map<string, object>} */
let customers = new Map();

function seedDefaults() {
  return [
    {
      id: 'diaab',
      name: 'Ahmed Diaab',
      hint: 'One pass. Uses this customer’s saved translations, locked terms, and writing rules.',
      templateUid: config.tms.aiTemplateUid || DIAAB_TEMPLATE_UID,
      mode: 'single',
      enabled: true,
    },
    {
      id: 'normal',
      name: 'Normal',
      hint: 'Three-step Loc_Template: machine translation, optimize, then AI translate.',
      templateUid: LOC_TEMPLATE_UID,
      mode: 'workflow',
      enabled: true,
    },
  ];
}

function persist() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const list = [...customers.values()];
  fs.writeFileSync(customersFile, JSON.stringify({ customers: list }, null, 2), 'utf8');
}

function loadFromDisk() {
  customers = new Map();
  if (!fs.existsSync(customersFile)) {
    for (const row of seedDefaults()) customers.set(row.id, row);
    persist();
    return;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(customersFile, 'utf8'));
    const list = Array.isArray(raw?.customers) ? raw.customers : [];
    for (const row of list) {
      const item = normalize(row, { keepId: true });
      if (item) customers.set(item.id, item);
    }
  } catch (err) {
    console.error('Failed to read customers.json:', err.message);
  }
  if (!customers.size) {
    for (const row of seedDefaults()) customers.set(row.id, row);
    persist();
  }
  migrateLegacyCustomers();
  migrateNormalCustomerName();
}

function migrateNormalCustomerName() {
  const normal = customers.get('normal');
  if (!normal || normal.name === 'Normal') return;
  if (normal.name === 'Normal Customer') {
    customers.set('normal', { ...normal, name: 'Normal' });
    persist();
  }
}

function migrateLegacyCustomers() {
  const legacy = customers.get('workflow');
  if (!legacy) return;
  if (!customers.has('normal')) {
    customers.set('normal', {
      ...legacy,
      id: 'normal',
      name: 'Normal',
      hint: 'Three-step Loc_Template: machine translation, optimize, then AI translate.',
      templateUid: LOC_TEMPLATE_UID,
      mode: 'workflow',
      enabled: legacy.enabled !== false,
    });
  }
  customers.delete('workflow');
  persist();
}

function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'customer';
}

function uniqueId(name, keepId) {
  if (keepId) return String(keepId).trim();
  let base = slugify(name);
  if (!customers.has(base)) return base;
  let n = 2;
  while (customers.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function normalize(row, { keepId } = {}) {
  const name = String(row?.name || '').trim();
  if (!name) return null;
  const id = uniqueId(name, keepId ? row.id : '');
  if (!id) return null;
  const mode = row?.mode === 'workflow' ? 'workflow' : 'single';
  const templateUid = String(row?.templateUid || '').trim();
  return {
    id,
    name,
    hint: String(row?.hint || '').trim(),
    templateUid,
    mode,
    enabled: row?.enabled !== false,
  };
}

function publicCustomer(row, { includeTemplate } = {}) {
  const out = {
    id: row.id,
    name: row.name,
    label: row.name,
    hint: row.hint || (row.mode === 'workflow'
      ? 'Three-step process.'
      : 'One pass with this customer’s saved setup.'),
    mode: row.mode,
  };
  if (includeTemplate) out.templateUid = row.templateUid;
  return out;
}

function listCustomers({ includeDisabled = false, includeTemplate = false } = {}) {
  return [...customers.values()]
    .filter((c) => includeDisabled || c.enabled)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      ...publicCustomer(c, { includeTemplate }),
      enabled: c.enabled,
    }));
}

function getCustomer(id) {
  const key = String(id || '').trim();
  const mapped = key === 'workflow' ? 'normal' : key === 'ai' ? 'diaab' : key;
  return customers.get(mapped) || null;
}

function defaultCustomerId() {
  let preferred = String(config.tms.defaultSetup || 'diaab').toLowerCase();
  if (preferred === 'ai') preferred = 'diaab';
  if (preferred === 'workflow') preferred = 'normal';
  const enabled = [...customers.values()].filter((c) => c.enabled);
  if (enabled.some((c) => c.id === preferred)) return preferred;
  return enabled[0]?.id || 'diaab';
}

function publicForUser({ isAdmin, allowedIds } = {}) {
  const all = listCustomers({ includeDisabled: false });
  const hasRestriction = !isAdmin && Array.isArray(allowedIds);
  const allowed = hasRestriction
    ? allowedIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const list = hasRestriction ? all.filter((c) => allowed.includes(c.id)) : all;
  const def = defaultCustomerId();
  const defaultCustomer = list.some((c) => c.id === def) ? def : (list[0]?.id || def);
  return {
    customers: list,
    setups: list,
    defaultSetup: defaultCustomer,
    defaultCustomer,
  };
}

function resolveSetup(id) {
  const raw = String(id || defaultCustomerId() || '').trim();
  const mapped = raw === 'ai' ? 'diaab' : raw;
  const row = getCustomer(mapped) || getCustomer(defaultCustomerId());
  const agentMtId = config.tms.wf3MtId || '';
  if (!row) {
    return {
      id: 'diaab',
      templateUid: config.tms.aiTemplateUid || DIAAB_TEMPLATE_UID,
      useTemplate: true,
      singleStep: true,
      forceThreeSteps: false,
      agentMtId,
    };
  }
  const workflow = row.mode === 'workflow';
  const templateUid = row.templateUid || '';
  return {
    id: row.id,
    templateUid,
    useTemplate: Boolean(templateUid),
    singleStep: !workflow,
    forceThreeSteps: workflow && Boolean(templateUid),
    agentMtId,
  };
}

function createCustomer(body) {
  const draft = normalize(body, { keepId: false });
  if (!draft) return { ok: false, error: 'Customer name is required.' };
  if (!draft.templateUid) return { ok: false, error: 'Template ID is required.' };
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(draft.templateUid)) {
    return { ok: false, error: 'Template ID looks invalid.' };
  }
  customers.set(draft.id, draft);
  persist();
  return { ok: true, customer: { ...publicCustomer(draft, { includeTemplate: true }), enabled: draft.enabled } };
}

function updateCustomer(id, body) {
  const existing = getCustomer(id);
  if (!existing) return { ok: false, error: 'Customer not found.' };
  const next = normalize(
    {
      ...existing,
      ...body,
      id: existing.id,
      name: body?.name != null ? body.name : existing.name,
    },
    { keepId: true }
  );
  if (!next) return { ok: false, error: 'Customer name is required.' };
  if (!next.templateUid) return { ok: false, error: 'Template ID is required.' };
  if (next.enabled === false) {
    const enabledCount = [...customers.values()].filter((c) => c.enabled && c.id !== existing.id).length;
    if (!enabledCount) return { ok: false, error: 'Keep at least one active customer.' };
  }
  customers.set(existing.id, next);
  persist();
  return { ok: true, customer: { ...publicCustomer(next, { includeTemplate: true }), enabled: next.enabled } };
}

function deleteCustomer(id) {
  const existing = getCustomer(id);
  if (!existing) return { ok: false, error: 'Customer not found.' };
  const enabledOthers = [...customers.values()].filter((c) => c.id !== existing.id && c.enabled);
  if (!enabledOthers.length) return { ok: false, error: 'Keep at least one active customer.' };
  customers.delete(existing.id);
  persist();
  return { ok: true, id: existing.id };
}

/** Replace all customers from a local snapshot. */
function importCustomersSnapshot(list) {
  customers = new Map();
  if (Array.isArray(list)) {
    for (const row of list) {
      const item = normalize(row, { keepId: true });
      if (item) customers.set(item.id, item);
    }
  }
  if (!customers.size) {
    for (const row of seedDefaults()) customers.set(row.id, row);
  }
  persist();
  return { ok: true, count: customers.size };
}

loadFromDisk();

module.exports = {
  DIAAB_TEMPLATE_UID,
  LOC_TEMPLATE_UID,
  listCustomers,
  getCustomer,
  publicForUser,
  defaultCustomerId,
  resolveSetup,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  importCustomersSnapshot,
};
