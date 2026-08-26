const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const statsFile = path.join(config.dataDir, 'word-stats.json');

/** @type {{ records: object[] }} */
let store = { records: [] };

function dateKey(iso) {
  const d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function persist() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(statsFile, JSON.stringify(store, null, 2), 'utf8');
}

function loadFromDisk() {
  store = { records: [] };
  if (!fs.existsSync(statsFile)) {
    persist();
    return;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    store.records = Array.isArray(raw?.records) ? raw.records : [];
  } catch (err) {
    console.error('Failed to read word-stats.json:', err.message);
    store.records = [];
  }
}

function recordWordStat(entry) {
  const createdAt = entry.createdAt || new Date().toISOString();
  const row = {
    id: uuidv4(),
    runId: entry.runId || null,
    projectUid: entry.projectUid || null,
    projectName: entry.projectName || '',
    customerId: entry.customerId || null,
    username: entry.username ? String(entry.username).trim() : null,
    fileName: entry.fileName || '',
    fileCount: Math.max(0, Number(entry.fileCount) || 0),
    totalWords: Math.max(0, Math.round(Number(entry.totalWords) || 0)),
    createdAt,
    date: dateKey(createdAt),
  };
  store.records.push(row);
  persist();
  return row;
}

function getUserWordUsage(username) {
  const key = String(username || '').trim();
  if (!key) return 0;
  return store.records.reduce(
    (sum, row) => (row.username === key ? sum + (row.totalWords || 0) : sum),
    0
  );
}

function listSummary() {
  const byDateMap = new Map();
  let totalFiles = 0;
  let totalWords = 0;

  for (const row of store.records) {
    totalFiles += row.fileCount;
    totalWords += row.totalWords;
    const key = row.date || dateKey(row.createdAt);
    if (!byDateMap.has(key)) {
      byDateMap.set(key, { date: key, fileCount: 0, totalWords: 0, jobs: [] });
    }
    const bucket = byDateMap.get(key);
    bucket.fileCount += row.fileCount;
    bucket.totalWords += row.totalWords;
    bucket.jobs.push({
      id: row.id,
      createdAt: row.createdAt,
      projectName: row.projectName,
      fileName: row.fileName,
      customerId: row.customerId,
      username: row.username || null,
      fileCount: row.fileCount,
      totalWords: row.totalWords,
    });
  }

  const byDate = [...byDateMap.values()]
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    totals: { fileCount: totalFiles, totalWords, jobCount: store.records.length },
    byDate,
  };
}

function deleteByDateRange(from, to) {
  const start = String(from || '').trim();
  const end = String(to || '').trim();
  if (!start || !end) {
    return { ok: false, error: 'Start and end dates are required.' };
  }
  if (start > end) {
    return { ok: false, error: 'Start date must be on or before end date.' };
  }

  const before = store.records.length;
  store.records = store.records.filter((row) => {
    const d = row.date || dateKey(row.createdAt);
    return d < start || d > end;
  });
  const removed = before - store.records.length;
  persist();
  return { ok: true, removed };
}

loadFromDisk();

module.exports = {
  recordWordStat,
  getUserWordUsage,
  listSummary,
  deleteByDateRange,
};
