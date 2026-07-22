const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const archiver = require('archiver');
const config = require('../config');
const { createTmsClient } = require('../tms');
const { createRun, getRun, getRunInternal } = require('../services/pipeline');

const router = express.Router();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(config.dataDir, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const safe = file.originalname.replace(/[^\w.\-()+ ]+/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
});

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

router.get('/meta', async (_req, res) => {
  try {
    const tms = createTmsClient();
    const [languages, fileExtensions] = await Promise.all([
      tms.listLanguages(),
      tms.listFileExtensions(),
    ]);
    res.json({
      languages,
      fileExtensions,
      maxUploadMb: config.maxUploadMb,
    });
  } catch (err) {
    console.error('/meta', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable.' });
  }
});

router.post('/translate', upload.array('files', 20), async (req, res) => {
  try {
    const files = req.files || [];
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
      return res.status(400).json({ error: 'Source and target languages are required.' });
    }

    // Validate extensions against supported set
    const tms = createTmsClient();
    const allowed = new Set((await tms.listFileExtensions()).map((e) => e.toLowerCase()));
    for (const f of files) {
      const ext = (f.originalname.split('.').pop() || '').toLowerCase();
      if (!allowed.has(ext)) {
        return res.status(400).json({
          error: `File type .${ext} is not supported.`,
        });
      }
    }

    const run = await createRun({ files, sourceLang, targetLangs });
    res.status(202).json(run);
  } catch (err) {
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
  const ready = run.files.filter((f) => f.status === 'ready' && f.downloadPath);
  if (!ready.length) return res.status(409).json({ error: 'No files ready yet.' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="locaitra-${run.id.slice(0, 8)}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('zip', err);
    res.status(500).end();
  });
  archive.pipe(res);
  for (const f of ready) {
    archive.file(f.downloadPath, { name: f.downloadName || f.name });
    if (f._extraDownloads) {
      for (const extra of f._extraDownloads) {
        archive.file(extra.path, { name: extra.name });
      }
    }
  }
  archive.finalize();
});

module.exports = router;
