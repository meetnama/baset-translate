# Function / Symbol → Files Map

Entry points only. Paths relative to `lingotrust-translate/`. Prefer this over repo-wide search.

## Client (`client/src/App.jsx`)

| Symbol | Role |
|---|---|
| `api` | `fetch` helper with credentials |
| `LoginScreen` | Login UI + `/api/login` |
| `ManageUsers` | Admin user CRUD + customer lock |
| `ManageCustomers` | Admin customer list (name, template ID, one pass / three-step) |
| `ManageWordStats` | Admin word-count totals by date + delete period |
| `App` | Auth gate, translate UI, local heartbeat, polling |
| `startTranslate` | POST multipart translate + poll status (`customerId`) |
| `logout` | Clear run + `/api/logout` |
| `addFiles` / `onDrop` / `startNewTranslate` | File list + empty/type checks; reset after done job |
| `checkUploadFiles` | Reject empty / unknown types before send |
| `setSource` / `toggleTarget` | Language selection |
| `customerId` | Selected customer (filtered by user lock) |

Styles: `client/src/styles.css`. Bootstrap: `client/src/main.jsx`.

## HTTP / process (`server/src/index.js`)

| Symbol | Role |
|---|---|
| `armWatchdog` | Local-only: exit if heartbeats stop (~45s) |
| `publicApi` set | Paths that skip auth (`/login`, `/logout`, `/me`, `/health`, `/heartbeat`, `/shutdown`) |
| `POST /api/heartbeat` | Keepalive; cancels pending shutdown |
| `POST|GET /api/shutdown` | Local: exit after short grace (refresh-safe); ignored when hosted |
| hosted `AUTH_SECRET` check | Refuse default secret on Render |

## Config (`server/src/config.js`)

| Export area | Role |
|---|---|
| `hosted` | `RENDER` / `HOSTED` |
| `auth.*` | Admin bootstrap, secret, session, `syncAdminPassword`, `secureCookie` |
| `tms.*` | TMS URL/token, 3-step + AI template UIDs, `wf3MtId`, `defaultSetup` |
| `mode` | `live` vs `mock` |
| dirs | `dataDir`, `runsDir`, `publicDir` |

## Auth (`server/src/auth.js`)

| Symbol | Role |
|---|---|
| `bootstrapUsers` / `ensureAdminFromEnv` / `loadFromDisk` / `persist` | `data/users.json` lifecycle |
| `hashPassword` / `verifyPassword` | scrypt |
| `authenticate` | Login check |
| `signToken` / `verifyToken` | HMAC session cookie |
| `setSessionCookie` / `clearSessionCookie` / `readSession` | Cookie `lt_session` |
| `requireAuth` / `requireAdmin` | Middleware |
| `listUsers` / `createUser` / `setUserPassword` / `setUserRole` / `setUserCustomers` / `setUserWordQuota` / `deleteUser` | Admin CRUD |
| `importUsersSnapshot` | Replace all users from local snapshot (keeps hashes) |
| `getQuotaStatus` / `userQuotaAllowsTranslate` | Per-user word limit check |
| `getAllowedCustomerIds` / `userCanUseCustomer` / `stripCustomerFromUsers` | Lock a user to one or more customers |
| `authEnabled` / `isAdmin` | Gates |

Routes: `server/src/routes/auth.js` → `/me`, `/login`, `/logout`, `/users` CRUD.  
Hosted sync: `server/src/routes/adminSync.js` → `POST /api/admin/import-local-data`. Script: `scripts/sync-local-data-to-render.js`.

## Translate routes (`server/src/routes/translate.js`)

| Symbol / route | Role |
|---|---|
| multer `storage` / `uuidSlice` / `cleanupUploads` | Unique upload names; unlink on fail |
| `decodeMultipartFilename` (`util/filenames.js`) | Fix UTF-8 upload names (Arabic/CJK/etc.) after multer Latin-1 |
| `GET /meta` | Languages + extensions + `customers` (filtered by user lock) |
| `POST /translate` | Start run (`customerId`); reject empty/odd files |
| `GET /translate/:id` | Poll public run |
| `GET .../files/:fileId/download` | Single / `downloadId` WF download |
| `GET .../download-all` | Zip from `downloads[]` |

## Pipeline (`server/src/services/pipeline.js`)

| Symbol | Role |
|---|---|
| `createRun` | Queue run, kick `processRun` |
| `getRun` / `getRunInternal` / `publicRun` | Status for API |
| `processRun` / `processFile` | Customer template; one-pass = 1 download; Full workflow = 3-step |
| `publicDownloads` | Hide extra step files for one-pass jobs |
| `projectDateTimeName` | Unique TMS project names |
| `pruneOldRuns` | Drop finished runs after 6h |
| `isEmptyUploadBuffer` | Reject empty/BOM-only |
| `setProgress` | Aggregate file statuses |

## Customers (`server/src/services/customers.js`)

| Symbol | Role |
|---|---|
| `listCustomers` / `createCustomer` / `updateCustomer` / `deleteCustomer` | Persist `data/customers.json` |
| `publicForUser` | Names for `/meta` (no vendor names); honors user lock |
| `resolveSetup` | Customer id → template + one-pass vs three-step |

Seeds: `diaab` (Path A template) + `normal` (“Normal”, Loc_Template `FZg60dEA9Yj4nyvp1ka1K4`, 3-step).

Routes: `server/src/routes/customers.js` → `/customers` CRUD (admin).

## Word stats (`server/src/services/wordStats.js`)

| Symbol | Role |
|---|---|
| `recordWordStat` | Persist one job’s analysis totals (includes `username`) |
| `getUserWordUsage` | Sum words used by one user |
| `listSummary` | Group by date + grand totals |
| `deleteByDateRange` | Remove records in inclusive date range |

Routes: `server/src/routes/wordStats.js` → `GET/DELETE /word-stats` (admin).

Pipeline: after job import, poll project analysis via `runProjectWordAnalysis({ projectUid })` (fallback: `getJob` detail `wordsCount` — list omits it) → `recordWordStat`. Does **not** create a second analysis.

## Translation setups (`server/src/services/setups.js`)

Thin re-export of `customers.js` (`resolveSetup`, `publicSetups`).

## TMS

| Symbol | File |
|---|---|
| `createTmsClient` | `server/src/tms/index.js` |
| `LiveTmsClient` | `server/src/tms/client.js` |
| `MockTmsClient` | `server/src/tms/mock.js` |
| `TMS_FILE_EXTENSIONS` / `FALLBACK_LANGUAGES` | `server/src/tms/formats.js` |

### `LiveTmsClient` methods (same interface on mock)

`ping`, `listLanguages`, `listFileExtensions`, `listMachineTranslateSettings`, `getDefaultMtUid`, `createProject`, `setProjectMtSettings`, `createJob`, `getAsync`, `waitAsync`, `listProjectJobs`, `getProject`, `setProjectMtEngine`, `preTranslate`, `setJobsStatus`, `downloadTarget`, `listProjectAnalyses`, `getAnalysis`, `getJob`, `runProjectWordAnalysis` (poll analysis, else job-detail `wordsCount`), `parseAnalysisSummary` (+ private `_ensureAuthHeader`, `_headers`, `_request`).

## Deploy / ops (docs, not runtime)

| Concern | File(s) |
|---|---|
| Render blueprint | `render.yaml` |
| Deploy notes | `DEPLOY-RENDER.md` |
| Docker | `Dockerfile`, `docker-compose.yml` |
| Env template | `.env.example` |
| Session memory | `MEMORY.md` |
| Parent start scripts | `../Start LingoTrust Translate.*`, `../Start-LingoTrust-Translate.ps1` |

`cat-analysis/` was removed from this workspace (unrelated to LingoTrust Translate).
