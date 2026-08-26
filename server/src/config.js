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
    secret: process.env.AUTH_SECRET || 'dev-change-me-lingotrust-translate',
    sessionDays: Number(process.env.AUTH_SESSION_DAYS) || 7,
    // When true, AUTH_ADMIN_PASSWORD overwrites the admin hash on every boot.
    syncAdminPassword:
      String(process.env.AUTH_ADMIN_SYNC_PASSWORD || '').toLowerCase() === 'true',
    secureCookie:
      String(process.env.AUTH_SECURE_COOKIE || '').toLowerCase() === 'true'
      || String(process.env.RENDER || '').toLowerCase() === 'true'
      || String(process.env.HOSTED || '').toLowerCase() === 'true',
  },
  tms: {
    baseUrl: (process.env.TMS_BASE_URL || 'https://cloud.memsource.com/web').replace(/\/$/, ''),
    token: process.env.TMS_API_TOKEN || '',
    // platform = access token → JWT (Bearer); apitoken = legacy ApiToken header
    authMode: (process.env.TMS_AUTH_MODE || 'platform').toLowerCase(),
    oauthUrl: process.env.TMS_OAUTH_URL || 'https://eu.phrase.com/idm/oauth/token',
    // Loc_Template: 3-step general pipeline (Full workflow).
    projectTemplateUid: (process.env.TMS_PROJECT_TEMPLATE_UID || 'FZg60dEA9Yj4nyvp1ka1K4').trim(),
    // Diaab Path A template (TM + lock TB + Agent). Used for Ahmed Diaab.
    aiTemplateUid: (process.env.TMS_AI_TEMPLATE_UID || 'rSLTo7avyCpO65101YU4cb').trim(),
    // Default product setup: diaab | workflow  (ai is accepted as diaab)
    defaultSetup: (process.env.TRANSLATION_DEFAULT_SETUP || 'diaab').toLowerCase(),
    // MT engine id for AI / last workflow step (AI Translation Agent). Empty = project settings.
    wf3MtId: (process.env.TMS_WF3_MT_ID || '5239171').trim(),
  },
};
