const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { authEnabled, requireAuth } = require('./auth');
const authRoutes = require('./routes/auth');
const translateRoutes = require('./routes/translate');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.runsDir, { recursive: true });

const app = express();

let lastHeartbeatAt = 0;
let watchdog = null;
const HEARTBEAT_TIMEOUT_MS = 20000;

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
app.use(express.json({ limit: '1mb' }));

app.use('/api', authRoutes);

const publicApi = new Set(['/login', '/logout', '/me', '/health']);

app.use('/api', (req, res, next) => {
  if (publicApi.has(req.path)) return next();
  return requireAuth(req, res, next);
});

app.post('/api/heartbeat', (_req, res) => {
  lastHeartbeatAt = Date.now();
  res.json({ ok: true });
});

app.post('/api/shutdown', (_req, res) => {
  if (config.hosted) return res.json({ ok: true, ignored: true });
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 300);
});

// sendBeacon may POST without JSON content-type
app.get('/api/shutdown', (_req, res) => {
  if (config.hosted) return res.json({ ok: true, ignored: true });
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 300);
});

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

const server = app.listen(config.port, () => {
  console.log(`Locaitra Translate listening on http://localhost:${config.port} (${config.mode})`);
  if (config.hosted) {
    console.log('Hosted mode — browser close will not shut down the server.');
  }
  if (authEnabled()) {
    console.log('Auth enabled — sign-in required for API use.');
  } else {
    console.log('Auth disabled — set AUTH_ADMIN_USER and AUTH_ADMIN_PASSWORD in .env to create the first admin.');
  }
  if (!config.hosted) armWatchdog();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Close the other Locaitra Translate instance and try again.`);
    process.exit(1);
  }
  throw err;
});
