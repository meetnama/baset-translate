# UI → Files Map

Use this before opening code. Paths are relative to `lingotrust-translate/`.
Styles for all UI live in `client/src/styles.css`. Entry: `client/src/main.jsx` → `App.jsx`.

| UI element / screen | Primary file(s) | Related API / server |
|---|---|---|
| Loading splash (skeleton) | `client/src/App.jsx` (`App`, `authReady`); styles `.loading-screen` | `GET /api/me` → `server/src/routes/auth.js` |
| Login screen (split aside + form, Sign in) | `client/src/App.jsx` (`LoginScreen`); styles `.login-shell` | `POST /api/login` → `routes/auth.js`, `auth.js` |
| Login error banner | `App.jsx` (`LoginScreen` error) | login route |
| Top header / brand (LingoTrust logo + “Translate”) | `App.jsx` (`BrandLogo`, header `.top`); `client/public/lingotrust-logo.png`; styles `.logo` `.brand` | — |
| Login aside brand logo | `App.jsx` (`LoginScreen`, `BrandLogo`) | — |
| Auth bar (username · admin) | `App.jsx` (`.auth-bar`) | `/api/me` |
| **Manage** / **Back to translate** | `App.jsx` (`showAdmin`, admin button) | — |
| **Sign out** | `App.jsx` (`logout`) | `POST /api/logout` → `auth.js` `clearSessionCookie` |
| Manage users panel (list + **Add user** / **Edit** dialog: role, process, word quota) | `App.jsx` (`ManageUsers`, `UserEditorDialog`) | `/api/users*` → `routes/auth.js`, `auth.js` CRUD |
| **Word quota** card (non-admin users with a limit) | `App.jsx` (translate view); styles `.quota-card` | `/api/me`, `/api/meta` `wordQuota`; blocked at `POST /api/translate` |
| **Customers** admin list (add/edit/remove, template ID, one pass vs three-step) | `App.jsx` (`ManageCustomers`); styles `.customer-admin-form` `.lock-checks` | `/api/customers*` → `routes/customers.js`, `services/customers.js` |
| Admin import local data (users/customers/word-stats) | `routes/adminSync.js` `POST /api/admin/import-local-data` | `auth.importUsersSnapshot`, `customers.importCustomersSnapshot`, `wordStats.importWordStatsSnapshot` |
| Error / meta error banner (translate view) | `App.jsx` | `/api/meta`, translate status |
| **Customer** picker | `App.jsx` (`customerId`); styles `.setup-option` | `GET /api/meta` `customers` → `server/src/services/customers.js` |
| **Languages** card (From select) | `App.jsx` (`sourceLang`, `setSource`) | `GET /api/meta` → `routes/translate.js` |
| **To** multi-select (trigger, search, checkboxes) | `App.jsx` (`targetLangs`, multi-select) | same `/api/meta` languages |
| **Files** card / dropzone / browse | `App.jsx` (`.drop`, `addFiles`, `onDrop`) | upload via `POST /api/translate` |
| Format chips preview | `App.jsx` (`previewFormats`) | `meta.fileExtensions` from TMS |
| File list rows + remove (✕) | `App.jsx` (`files` state) | — |
| **Translate** button | `App.jsx` (`startTranslate`) | `POST /api/translate` → `pipeline.js`; dimmed while translating or after job done until **New translate** |
| **Progress** card / bar / status pills | `App.jsx` (`run` poll) | `GET /api/translate/:id` |
| Per-file / per-WF **Download** links | `App.jsx` (download `<a>`) | `GET /api/translate/:id/files/:fileId/download` |
| **Download all** | `App.jsx` | `GET /api/translate/:id/download-all` (zip) |
| **New translate** (Progress, after done/fail) | `App.jsx` (`startNewTranslate`) | Clears Progress + files; re-enables Translate |
| Footer note | `App.jsx` | — |
| Tab open / close (local) | `App.jsx` (heartbeat + `pagehide`) | `POST /api/heartbeat`, `/api/shutdown` → `server/src/index.js` |

## Notes

- There is **one** React component file for product UI: `client/src/App.jsx`. Almost every button lives there.
- Built static UI served from `server/public/` (rebuild client after UI changes).
- Vendor / TMS brand names must not appear in UI copy.
