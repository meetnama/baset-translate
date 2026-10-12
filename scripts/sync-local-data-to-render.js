/**
 * Push local data/ (users, customers, word-stats) to the hosted app.
 * Usage (from lingotrust-translate/): node scripts/sync-local-data-to-render.js
 * Requires RENDER_SERVICE_URL + AUTH_ADMIN_* in .env (admin must exist on host before first import).
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const base = (process.env.RENDER_SERVICE_URL || 'https://baset-translate.onrender.com').replace(
  /\/$/,
  ''
);
const dataDir = path.join(__dirname, '../data');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
}

function cookieFrom(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const list = raw.length ? raw : res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function main() {
  const usersFile = readJson('users.json');
  const customersFile = fs.existsSync(path.join(dataDir, 'customers.json'))
    ? readJson('customers.json')
    : { customers: [] };
  const wordFile = fs.existsSync(path.join(dataDir, 'word-stats.json'))
    ? readJson('word-stats.json')
    : { records: [] };

  const user = process.env.AUTH_ADMIN_USER || 'admin';
  const password = process.env.AUTH_ADMIN_PASSWORD || '';
  if (!password) throw new Error('AUTH_ADMIN_PASSWORD missing in .env');

  const loginRes = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password }),
  });
  const loginText = await loginRes.text();
  if (!loginRes.ok) {
    throw new Error(`login failed ${loginRes.status}: ${loginText}`);
  }
  const cookie = cookieFrom(loginRes);

  const payload = {
    users: usersFile.users || [],
    customers: customersFile.customers || [],
    wordStats: wordFile.records || [],
  };

  const impRes = await fetch(`${base}/api/admin/import-local-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(payload),
  });
  const impText = await impRes.text();
  if (!impRes.ok) throw new Error(`import failed ${impRes.status}: ${impText}`);
  const imp = JSON.parse(impText);
  console.log(
    JSON.stringify(
      {
        ok: imp.ok,
        imported: imp.imported,
        userNames: (imp.users || []).map((u) => u.username),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
