const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const archiver = require('archiver');
const config = require('../config');
const { createTmsClient } = require('../tms');
const { createRun, getRunInternal, publicRun, canAccessRun, isEmptyUploadBuffer } = require('../services/pipeline');
const { publicForUser, getCustomer } = require('../services/customers');
const {
  authEnabled,
  getAllowedCustomerIds,
  userCanUseCustomer,
  userQuotaAllowsTranslate,
  getQuotaStatus,
} = require('../auth');
const { publicErrorText } = require('../util/publicError');
const { decodeMultipartFilename } = require('../util/filenames');
const {
  scanUploadForPromptInjection,
  estimateUploadWords,
  sanitizeUploadBuffer,
} = require('../util/promptSafety');

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

function getAccessibleRun(req, res) {
  const missing = 'This translation was not found. It may have expired. Start a new one.';
  const run = getRunInternal(req.params.id);
  if (!run) {
    res.status(404).json({ error: missing });
    return null;
  }
  if (!canAccessRun(run, {
    authEnabled: authEnabled(),
    username: req.user,
    isAdmin: !!req.isAdmin,
  })) {
    // Same wording either way, so one user cannot tell that another user's job exists.
    res.status(404).json({ error: missing });
    return null;
  }
  return run;
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
    res.status(503).json({
      error: publicErrorText(
        err.message,
        'Couldn’t load the language list because the translation service did not respond.'
      ),
    });
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
        let buf = fs.readFileSync(f.path);
        if (isEmptyUploadBuffer(buf)) {
          cleanupUploads(files);
          return res.status(400).json({ error: `${f.originalname} is empty. Add content and try again.` });
        }
        buf = sanitizeUploadBuffer(buf, f.originalname);
        fs.writeFileSync(f.path, buf);
        f.size = buf.length;
        const inj = scanUploadForPromptInjection(buf, f.originalname);
        if (!inj.ok) {
          cleanupUploads(files);
          return res.status(400).json({ error: inj.error });
        }
      } catch {
        cleanupUploads(files);
        return res.status(400).json({ error: `Couldn’t read ${f.originalname}. The file may be damaged or still open in another program.` });
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

    // Early quota gate: refuse clearly oversized uploads before starting a run.
    if (req.user) {
      const q = getQuotaStatus(req.user);
      if (!q.unlimited && q.remaining != null) {
        let estimated = 0;
        for (const f of files) {
          try {
            const buf = fs.readFileSync(f.path);
            estimated += estimateUploadWords(buf, f.originalname) || 0;
          } catch {
            /* skip */
          }
        }
        if (estimated > q.remaining) {
          cleanupUploads(files);
          return res.status(403).json({
            error: `This upload looks larger than your remaining word quota (${estimated.toLocaleString()} estimated vs ${q.remaining.toLocaleString()} left). Contact admin for more.`,
            wordQuota: q,
          });
        }
      }
    }

    const run = await createRun({
      files,
      sourceLang,
      targetLangs,
      setupId: customerId,
      username: req.user || null,
      quotaRemainingAtStart:
        req.user && !getQuotaStatus(req.user).unlimited
          ? getQuotaStatus(req.user).remaining
          : null,
    });
    res.status(202).json(run);
  } catch (err) {
    cleanupUploads(files);
    if (err && err.code === 'QUOTA') {
      return res.status(403).json({ error: err.message, wordQuota: err.wordQuota || undefined });
    }
    console.error('/translate', err.message);
    res.status(500).json({
      error: publicErrorText(err.message, 'Couldn’t start translation, and the server did not return a reason.'),
    });
  }
});

router.get('/translate/:id', (req, res) => {
  const run = getAccessibleRun(req, res);
  if (!run) return;
  res.json(publicRun(run));
});

router.get('/translate/:id/files/:fileId/download', (req, res) => {
  const run = getAccessibleRun(req, res);
  if (!run) return;
  const file = run.files.find((f) => f.id === req.params.fileId);
  if (!file || file.status !== 'ready') {
    const why = file?.error
      ? file.error
      : file?.status === 'failed'
        ? 'This file failed. See the reason on the Progress card.'
        : 'This file is still translating. Wait until it finishes, then download.';
    return res.status(409).json({ error: why });
  }

  const downloadId = req.query.downloadId ? String(req.query.downloadId) : null;
  if (downloadId && Array.isArray(file.downloads)) {
    const item = file.downloads.find((d) => d.id === downloadId);
    if (!item?.path) return res.status(404).json({ error: 'That download is no longer available. Run the translation again.' });
    return res.download(item.path, item.name || file.name);
  }

  if (!file.downloadPath) {
    return res.status(409).json({ error: 'The translated file is missing on the server. Run the translation again.' });
  }
  res.download(file.downloadPath, file.downloadName || file.name);
});

router.get('/translate/:id/download-all', (req, res) => {
  const run = getAccessibleRun(req, res);
  if (!run) return;

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
  if (!entries.length) return res.status(409).json({ error: 'Nothing is ready to download yet. Wait until a file finishes, or check the reason if it failed.' });

  const usedNames = new Set();
  const uniqueZipName = (name) => {
    const raw = String(name || 'translated-file');
    let candidate = raw;
    let n = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      const parsed = path.parse(raw);
      candidate = `${parsed.name} (${n})${parsed.ext}`;
      n += 1;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  };

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
    archive.file(entry.path, { name: uniqueZipName(entry.name) });
  }
  archive.finalize();
});

module.exports = router;
