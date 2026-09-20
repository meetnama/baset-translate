const fs = require('fs');
const path = require('path');
const config = require('../config');

const PREMIUM_AI_TEMPLATE_UID = 'rSLTo7avyCpO65101YU4cb';
const FULL_WORKFLOW_TEMPLATE_UID = 'FZg60dEA9Yj4nyvp1ka1K4';

/** Old public/internal ids → current ids (never expose old names in API). */
const ID_ALIASES = {
  diaab: 'premium-ai',
  ai: 'premium-ai',
  normal: 'full-workflow',
  workflow: 'full-workflow',
};

const customersFile = path.join(config.dataDir, 'customers.json');

/** @type {Map<string, object>} */
let customers = new Map();

function canonicalId(id) {
  const key = String(id || '').trim();
  return ID_ALIASES[key] || key;
}

function seedDefaults() {
  return [
    {
      id: 'premium-ai',
      name: 'Premium AI',
      hint: 'A client-specific AI workflow using customized templates, approved terminology, and predefined style and writing rules.',
      templateUid: config.tms.aiTemplateUid || PREMIUM_AI_TEMPLATE_UID,
      mode: 'single',
      enabled: true,
    },
    {
      id: 'full-workflow',
      name: 'Full workflow',
      hint: 'Complete translation workflow combining machine translation, AI optimization, and final AI refinement.',
      templateUid: FULL_WORKFLOW_TEMPLATE_UID,
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

function rewriteUserCustomerIds() {
  const usersFile = path.join(config.dataDir, 'users.json');
  if (!fs.existsSync(usersFile)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const list = Array.isArray(raw?.users) ? raw.users : [];
    let changed = false;
    for (const row of list) {
      if (!Array.isArray(row.allowedCustomerIds)) continue;
      const next = row.allowedCustomerIds.map((id) => canonicalId(id));
      if (JSON.stringify(next) !== JSON.stringify(row.allowedCustomerIds)) {
        row.allowedCustomerIds = next;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(usersFile, JSON.stringify({ users: list }, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('Failed to migrate user customer ids:', err.message);
  }
}

function rewriteWordStatCustomerIds() {
  const statsFile = path.join(config.dataDir, 'word-stats.json');
  if (!fs.existsSync(statsFile)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    const records = Array.isArray(raw?.records) ? raw.records : [];
    let changed = false;
    for (const row of records) {
      if (!row?.customerId) continue;
      const next = canonicalId(row.customerId);
      if (next !== row.customerId) {
        row.customerId = next;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(statsFile, JSON.stringify(raw, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('Failed to migrate word-stat customer ids:', err.message);
  }
}

function migrateLegacyIds() {
  let changed = false;
  for (const [oldId, newId] of Object.entries(ID_ALIASES)) {
    if (oldId === newId) continue;
    if (!customers.has(oldId)) continue;
    const row = customers.get(oldId);
    customers.delete(oldId);
    if (!customers.has(newId)) {
      customers.set(newId, { ...row, id: newId });
    }
    changed = true;
  }
  // Refresh display names if still on old labels
  const premium = customers.get('premium-ai');
  const premiumHintNew =
    'A client-specific AI workflow using customized templates, approved terminology, and predefined style and writing rules.';
  if (
    premium &&
    (premium.name === 'Ahmed Diaab' ||
      premium.name === 'diaab' ||
      premium.hint ===
        'One pass. Uses this customer’s saved translations, locked terms, and writing rules.')
  ) {
    customers.set('premium-ai', {
      ...premium,
      name: 'Premium AI',
      hint: premiumHintNew,
    });
    changed = true;
  }
  const full = customers.get('full-workflow');
  const fullHintNew =
    'Complete translation workflow combining machine translation, AI optimization, and final AI refinement.';
  if (
    full &&
    (full.name === 'Normal' ||
      full.name === 'Normal Customer' ||
      full.hint === 'Three steps: machine translation, optimize, then AI translate.' ||
      /Loc_Template|diaab|normal/i.test(full.hint || ''))
  ) {
    customers.set('full-workflow', {
      ...full,
      name: 'Full workflow',
      hint: fullHintNew,
    });
    changed = true;
  }
  if (changed) persist();
  rewriteUserCustomerIds();
  rewriteWordStatCustomerIds();
}

function loadFromDisk() {
  customers = new Map();
  if (!fs.existsSync(customersFile)) {
    for (const row of seedDefaults()) customers.set(row.id, row);
    persist();
    rewriteUserCustomerIds();
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
  migrateLegacyIds();
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
  if (keepId) return canonicalId(keepId);
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
  return customers.get(canonicalId(id)) || null;
}

function defaultCustomerId() {
  let preferred = String(config.tms.defaultSetup || 'premium-ai').toLowerCase();
  preferred = canonicalId(preferred);
  const enabled = [...customers.values()].filter((c) => c.enabled);
  if (enabled.some((c) => c.id === preferred)) return preferred;
  return enabled[0]?.id || 'premium-ai';
}

function publicForUser({ isAdmin, allowedIds } = {}) {
  const all = listCustomers({ includeDisabled: false });
  const hasRestriction = !isAdmin && Array.isArray(allowedIds);
  const allowed = hasRestriction
    ? allowedIds.map((id) => canonicalId(id)).filter(Boolean)
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
  const mapped = canonicalId(id || defaultCustomerId() || '');
  const row = getCustomer(mapped) || getCustomer(defaultCustomerId());
  const agentMtId = config.tms.wf3MtId || '';
  if (!row) {
    return {
      id: 'premium-ai',
      templateUid: config.tms.aiTemplateUid || PREMIUM_AI_TEMPLATE_UID,
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
  migrateLegacyIds();
  persist();
  return { ok: true, count: customers.size };
}

loadFromDisk();

module.exports = {
  PREMIUM_AI_TEMPLATE_UID,
  FULL_WORKFLOW_TEMPLATE_UID,
  // Back-compat aliases for any older requires
  DIAAB_TEMPLATE_UID: PREMIUM_AI_TEMPLATE_UID,
  LOC_TEMPLATE_UID: FULL_WORKFLOW_TEMPLATE_UID,
  canonicalId,
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
