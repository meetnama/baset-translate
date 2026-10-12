# LingoTrust Translate on Namecheap cPanel

Deployment prepared and verified on 2026-10-12 from app commit `308973d`.

## Hosting details

- App URL: https://translate.lingo-trust.ai/
- cPanel: https://premium24.web-hosting.com:2083/
- Hosting account: `lingtckg`; Namecheap account: `AhmedSelimdiaab`.
- Hosting IP: `68.65.122.203`.
- Nameservers: `dns1.namecheaphosting.com`, `dns2.namecheaphosting.com`.
- Node.js application root: `/home/lingtckg/lingotrust-translate`.
- Subdomain document root: `/home/lingtckg/translate.lingo-trust.ai`.
- Runtime: Node.js `20.20.2`, Production.
- Startup file: `server/src/index.js`.
- The main website's `/home/lingtckg/public_html` was not changed.

## Private settings and data

The private application root contains `.env` (0600) and `data/` (0700).
Passwords and API tokens are not recorded in this document or committed to Git.
Only app settings (`TMS_*`, `TRANSLATION_*`, `AUTH_*`, upload limit) were transferred;
the Render API key and hosting-account password were not included.

Required host overrides:

```dotenv
HOSTED=true
AUTH_SECURE_COOKIE=true
AUTH_ADMIN_SYNC_PASSWORD=false
CORS_ORIGIN=https://translate.lingo-trust.ai
```

Transferred the approved local snapshot: 3 users, 2 customer templates, and 7
word-count records (236 words). User passwords remain their existing hashes.
The app data persists on this hosting account; future deployments must preserve
the host's current `data/` and `.env` rather than overwrite them with older local data.
The temporary data-transfer archive was moved to cPanel Trash (recoverable).

## Updating this deployment

1. Commit changes in the app repository; run appropriate tests and `npm run build`.
2. Package `package.json`, `package-lock.json`, and `server/` including its built
   `server/public/`. Exclude `.env`, `data/`, `node_modules/`, and Git metadata.
3. Upload/extract to the private application root using cPanel File Manager.
4. In Setup Node.js App, run NPM Install when dependencies change, then Restart.
5. Verify HTTPS health, login, `/api/meta`, assets, and relevant changed behavior.

## Migration verification

- Existing 32 tests passed and the client production build succeeded.
- Validated HTTPS without disabling certificate verification.
- HTTP redirects to HTTPS with status 301 on the translation subdomain.
- `/api/health` returned 200 with `{"ok":true}`.
- Admin login and Secure session cookies worked on the new host.
- `/api/meta` returned 1160 languages and Premium AI / Full workflow templates.
- Admin APIs confirmed 3 users and 7 usage records totaling 236 words.
- Served HTML and both compiled JS/CSS assets matched the local production build.
- Correct subdomain CORS origin accepted; an unknown origin was not allowed.
- Public HTML and metadata contained no upstream vendor names.
- Public `/.env` request was denied (403).
- Chrome loaded the new HTTPS app. Some DNS resolvers still cached the earlier
  nonexistent subdomain: authoritative DNS and Cloudflare DNS returned the correct
  IP while Google DNS and this PC's default resolver had not refreshed yet.

No new translation job was submitted during these checks. Render was left intact
as a fallback; retiring it is a separate action after acceptance of the new host.
