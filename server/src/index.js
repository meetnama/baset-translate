const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { authEnabled, requireAuth } = require('./auth');
const authRoutes = require('./routes/auth');
const translateRoutes = require('./routes/translate');
const customerRoutes = require('./routes/customers');
const wordStatsRoutes = require('./routes/wordStats');
const adminSyncRoutes = require('./routes/adminSync');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.runsDir, { recursive: true });

const app = express();

let lastHeartbeatAt = 0;
let watchdog = null;
let pendingShutdown = null;
const HEARTBEAT_TIMEOUT_MS = 45000;
const SHUTDOWN_GRACE_MS = 2500;

function cancelPendingShutdown() {
  if (pendingShutdown) {
    clearTimeout(pendingShutdown);
    pendingShutdown = null;
  }
}

function scheduleShutdown(reason) {
  if (config.hosted) return;
  cancelPendingShutdown();
  pendingShutdown = setTimeout(() => {
    console.log(`${reason} — shutting down.`);
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
}

function armWatchdog() {
  if (watchdog) clearInterval(watchdog);
  watchdog = setInterval(() => {
    if (!lastHeartbeatAt) return;
    if (Date.now() - lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
      console.log('No browser heartbeat — shutting down.');
      process.exit(0);
    }
  }, 5000);
}

const corsOrigin =
  config.corsOrigin === '*'
    ? true
    : config.corsOrigin.split(',').map((s) => s.trim());

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '5mb' }));

app.use('/api', authRoutes);
app.use('/api', adminSyncRoutes);

// Heartbeat/shutdown public so login screen can keep local server alive.
const publicApi = new Set(['/login', '/logout', '/me', '/health', '/heartbeat', '/shutdown']);

app.use('/api', (req, res, next) => {
  if (publicApi.has(req.path)) return next();
  return requireAuth(req, res, next);
});

app.post('/api/heartbeat', (_req, res) => {
  lastHeartbeatAt = Date.now();
  cancelPendingShutdown();
  res.json({ ok: true });
});

app.post('/api/shutdown', (_req, res) => {
  if (config.hosted) return res.json({ ok: true, ignored: true });
  scheduleShutdown('Browser closed');
  res.json({ ok: true });
});

app.get('/api/shutdown', (_req, res) => {
  if (config.hosted) return res.json({ ok: true, ignored: true });
  scheduleShutdown('Browser closed');
  res.json({ ok: true });
});

app.use('/api', customerRoutes);
app.use('/api', wordStatsRoutes);
app.use('/api', translateRoutes);

const publicDir = config.publicDir;
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `File exceeds the ${config.maxUploadMb} MB limit.` });
  }
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: 'Invalid upload. Please try again.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const DEFAULT_AUTH_SECRET = 'dev-change-me-lingotrust-translate';
if (config.hosted && (!config.auth.secret || config.auth.secret === DEFAULT_AUTH_SECRET)) {
  console.error('Hosted deploy requires a strong AUTH_SECRET (do not use the default).');
  process.exit(1);
}

const server = app.listen(config.port, () => {
  console.log(`LingoTrust Translate listening on http://localhost:${config.port} (${config.mode})`);
  if (config.hosted) {
    console.log('Hosted mode — browser close will not shut down the server.');
  } else {
    console.log('Local mode — stays up while the app tab is open; stops when you close it.');
    armWatchdog();
  }
  if (authEnabled()) {
    console.log('Auth enabled — sign-in required for API use.');
  } else {
    console.log('Auth disabled — set AUTH_ADMIN_USER and AUTH_ADMIN_PASSWORD in .env to create the first admin.');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Close the other LingoTrust Translate instance and try again.`);
    process.exit(1);
  }
  throw err;
});
