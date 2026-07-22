const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const mode = (process.env.TRANSLATION_MODE || 'mock').toLowerCase();

module.exports = {
  port: Number(process.env.PORT) || 8787,
  mode: mode === 'live' ? 'live' : 'mock',
  // Render sets RENDER=true; also allow HOSTED=true elsewhere
  hosted:
    String(process.env.RENDER || '').toLowerCase() === 'true'
    || String(process.env.HOSTED || '').toLowerCase() === 'true',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 50,
  dataDir: path.join(__dirname, '../../data'),
  runsDir: path.join(__dirname, '../../data/runs'),
  publicDir: path.join(__dirname, '../public'),
  auth: {
    // First-time bootstrap only (creates admin in data/users.json). Prefer UI after that.
    adminUser: process.env.AUTH_ADMIN_USER || '',
    adminPassword: process.env.AUTH_ADMIN_PASSWORD || '',
    // Legacy: user1:pass1|user2:pass2 — migrated once into data/users.json if file empty
    users: process.env.AUTH_USERS || '',
    secret: process.env.AUTH_SECRET || 'dev-change-me-locaitra-translate',
    sessionDays: Number(process.env.AUTH_SESSION_DAYS) || 7,
    secureCookie:
      String(process.env.AUTH_SECURE_COOKIE || '').toLowerCase() === 'true'
      || String(process.env.RENDER || '').toLowerCase() === 'true'
      || String(process.env.HOSTED || '').toLowerCase() === 'true',
  },
  tms: {
    baseUrl: (process.env.PHRASE_BASE_URL || 'https://cloud.memsource.com/web').replace(/\/$/, ''),
    token: process.env.PHRASE_API_TOKEN || '',
    // platform = Phrase Platform access token → exchange for JWT (Bearer)
    // apitoken = legacy TMS ApiToken header (token used as-is)
    authMode: (process.env.PHRASE_AUTH_MODE || 'platform').toLowerCase(),
    oauthUrl: process.env.PHRASE_OAUTH_URL || 'https://eu.phrase.com/idm/oauth/token',
    // When set, projects are created from this Phrase project template (settings/MT/workflow).
    projectTemplateUid: (process.env.PHRASE_PROJECT_TEMPLATE_UID || '').trim(),
    // MT engine id for the last workflow step (AI Translation Agent). Empty = use project settings.
    wf3MtId: (process.env.PHRASE_WF3_MT_ID || '5239171').trim(),
  },
};
