const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const archiver = require('archiver');
const config = require('../config');
const { createTmsClient } = require('../tms');
const { createRun, getRun, getRunInternal, isEmptyUploadBuffer } = require('../services/pipeline');
const { publicForUser, getCustomer } = require('../services/customers');
const { getAllowedCustomerIds, userCanUseCustomer, userQuotaAllowsTranslate, getQuotaStatus } = require('../auth');
const { decodeMultipartFilename } = require('../util/filenames');

const router = express.Router();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(config.dataDir, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const display = decodeMultipartFilename(file.originalname);
    const safe = display.replace(/[^\w.\-()+ ]+/g, '_');
    // Date.now() alone collides when multiple files land in the same millisecond.
    cb(null, `${Date.now()}-${uuidSlice()}-${safe}`);
  },
});

function uuidSlice() {
  return `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

function cleanupUploads(files) {
  for (const f of files || []) {
    if (!f?.path) continue;
    try {
      fs.unlinkSync(f.path);
    } catch {
      /* ignore */
    }
  }
}

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
});

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

router.get('/meta', async (req, res) => {
  try {
    const tms = createTmsClient();
    const [languages, fileExtensions] = await Promise.all([
      tms.listLanguages(),
      tms.listFileExtensions(),
    ]);
    const allowedIds = req.user ? getAllowedCustomerIds(req.user) : null;
    const quota = req.user ? getQuotaStatus(req.user) : null;
    res.json({
      languages,
      fileExtensions,
      maxUploadMb: config.maxUploadMb,
      wordQuota: quota,
      ...publicForUser({ isAdmin: !!req.isAdmin, allowedIds }),
    });
  } catch (err) {
    console.error('/meta', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable.' });
  }
});

router.post('/translate', upload.array('files', 20), async (req, res) => {
  const files = req.files || [];
  for (const f of files) {
    f.originalname = decodeMultipartFilename(f.originalname);
  }
  try {
    if (!files.length) {
      return res.status(400).json({ error: 'Please upload at least one file.' });
    }

    const sourceLang = String(req.body.sourceLang || '').trim();
    let targetLangs = req.body.targetLangs;
    if (typeof targetLangs === 'string') {
      try {
        targetLangs = JSON.parse(targetLangs);
      } catch {
        targetLangs = targetLangs.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    if (!Array.isArray(targetLangs)) targetLangs = [targetLangs].filter(Boolean);

    if (!sourceLang || !targetLangs.length) {
      cleanupUploads(files);
      return res.status(400).json({ error: 'Source and target languages are required.' });
    }

    const tms = createTmsClient();
    const allowed = new Set((await tms.listFileExtensions()).map((e) => e.toLowerCase()));
    for (const f of files) {
      const ext = (f.originalname.split('.').pop() || '').toLowerCase();
      const hasDot = String(f.originalname || '').includes('.');
      if (!hasDot || !ext) {
        cleanupUploads(files);
        return res.status(400).json({ error: `${f.originalname || 'A file'} has no file type.` });
      }
      if (!allowed.has(ext)) {
        cleanupUploads(files);
        return res.status(400).json({
          error: `File type .${ext} is not supported.`,
        });
      }
      if (!f.size) {
        cleanupUploads(files);
        return res.status(400).json({ error: `${f.originalname} is empty.` });
      }
      try {
        const buf = fs.readFileSync(f.path);
        if (isEmptyUploadBuffer(buf)) {
          cleanupUploads(files);
          return res.status(400).json({ error: `${f.originalname} is empty. Add content and try again.` });
        }
      } catch {
        cleanupUploads(files);
        return res.status(400).json({ error: `Couldn’t read ${f.originalname}.` });
      }
    }

    const customerId = String(req.body.customerId || req.body.setupId || '').trim();
    if (customerId && !getCustomer(customerId)) {
      cleanupUploads(files);
      return res.status(400).json({ error: 'Unknown customer.' });
    }
    if (req.user && !userCanUseCustomer(req.user, customerId, !!req.isAdmin)) {
      cleanupUploads(files);
      return res.status(403).json({ error: 'You can’t use that customer.' });
    }
    if (req.user && !userQuotaAllowsTranslate(req.user)) {
      cleanupUploads(files);
      const q = getQuotaStatus(req.user);
      return res.status(403).json({
        error: `Word quota reached (${q.used.toLocaleString()} / ${q.limit.toLocaleString()} words). Contact admin for more.`,
        wordQuota: q,
      });
    }

    const run = await createRun({
      files,
      sourceLang,
      targetLangs,
      setupId: customerId,
      username: req.user || null,
    });
    res.status(202).json(run);
  } catch (err) {
    cleanupUploads(files);
    console.error('/translate', err.message);
    res.status(500).json({ error: 'Couldn’t start translation. Please try again.' });
  }
});

router.get('/translate/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Not found.' });
  res.json(run);
});

router.get('/translate/:id/files/:fileId/download', (req, res) => {
  const run = getRunInternal(req.params.id);
  if (!run) return res.status(404).json({ error: 'Not found.' });
  const file = run.files.find((f) => f.id === req.params.fileId);
  if (!file || file.status !== 'ready') {
    return res.status(409).json({ error: 'File is not ready yet.' });
  }

  const downloadId = req.query.downloadId ? String(req.query.downloadId) : null;
  if (downloadId && Array.isArray(file.downloads)) {
    const item = file.downloads.find((d) => d.id === downloadId);
    if (!item?.path) return res.status(404).json({ error: 'Download not found.' });
    return res.download(item.path, item.name || file.name);
  }

  if (!file.downloadPath) {
    return res.status(409).json({ error: 'File is not ready yet.' });
  }
  res.download(file.downloadPath, file.downloadName || file.name);
});

router.get('/translate/:id/download-all', (req, res) => {
  const run = getRunInternal(req.params.id);
  if (!run) return res.status(404).json({ error: 'Not found.' });

  const singleStep = Boolean(run.singleStep);
  const entries = [];
  for (const f of run.files) {
    if (f.status !== 'ready') continue;
    let list = Array.isArray(f.downloads) ? f.downloads : [];
    if (singleStep && list.length > 1) {
      const byLang = new Map();
      for (const d of list) byLang.set(d.lang || '_', d);
      list = [...byLang.values()];
    }
    if (list.length) {
      for (const d of list) {
        if (d?.path) entries.push({ path: d.path, name: d.name || f.name });
      }
    } else if (f.downloadPath) {
      entries.push({ path: f.downloadPath, name: f.downloadName || f.name });
    }
  }
  if (!entries.length) return res.status(409).json({ error: 'No files ready yet.' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="lingotrust-${run.id.slice(0, 8)}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('zip', err);
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  archive.pipe(res);
  for (const entry of entries) {
    archive.file(entry.path, { name: entry.name });
  }
  archive.finalize();
});

module.exports = router;
